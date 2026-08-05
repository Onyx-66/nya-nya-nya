import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertApiTeam, requireApiKey } from "@/lib/server/api-keys";
import { requestIdFor } from "@/lib/server/admin-utils";
import { requirePaidEconomyPublic } from "@/lib/server/commercial-settings";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

function db() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "The upload API is unavailable.");
  return env.DB;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const principal = await requireApiKey(request, "upload:chapter");
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) throw new ApiError(422, "IDEMPOTENCY_KEY_REQUIRED", "Send a unique Idempotency-Key header.");
    const payload = z.object({
      teamId: z.string().trim().min(3).max(160),
      seriesId: z.string().trim().min(3).max(160),
      chapterNumber: z.string().trim().min(1).max(40),
      volume: z.string().trim().max(40).nullable().default(null),
      title: z.string().trim().max(180).default(""),
      language: z.string().trim().min(2).max(12).default("en"),
      visibility: z.enum(["PUBLIC", "UNLISTED", "HIDDEN"]).default("PUBLIC"),
      pricePaws: z.coerce.number().int().min(0).max(100_000).default(0),
      source: z.object({
        type: z.enum(["IMAGES", "ZIP", "GOOGLE_DRIVE"]),
        googleDriveUrl: z.string().url().max(1_000).optional(),
      }),
    }).parse(await request.json());
    assertApiTeam(principal, payload.teamId);
    if (payload.pricePaws > 0) await requirePaidEconomyPublic();
    if (payload.source.type === "GOOGLE_DRIVE") {
      const url = new URL(payload.source.googleDriveUrl ?? "https://invalid.invalid");
      if (!(["drive.google.com", "docs.google.com"] as string[]).includes(url.hostname)) {
        throw new ApiError(422, "DRIVE_LINK_INVALID", "Use a Google Drive folder or ZIP link.");
      }
    }
    const relationship = await db().prepare(
      `SELECT sta.team_id AS teamId
         FROM series_team_assignments sta
         JOIN teams t ON t.id = sta.team_id
        WHERE sta.series_id = ? AND sta.team_id = ? AND sta.can_upload = 1
          AND t.is_archived = 0 AND t.verification_status = 'VERIFIED'
        LIMIT 1`,
    ).bind(payload.seriesId, payload.teamId).first();
    if (!relationship) throw new ApiError(403, "SERIES_TEAM_REQUIRED", "This team cannot upload to the selected series.");
    const existing = await db().prepare(
      "SELECT id, status FROM upload_jobs WHERE user_id = ? AND idempotency_key = ? LIMIT 1",
    ).bind(principal.actorUserId, idempotencyKey).first<{ id: string; status: string }>();
    if (existing) return json(requestId, { data: existing, replayed: true });
    const jobId = `upload_${randomId()}`;
    const itemId = `upload_item_${randomId()}`;
    const clientKey = `api_${randomId()}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    const sourceType = payload.source.type === "IMAGES" ? "DIRECT_IMAGES" : "DIRECT_FOLDER";
    await db().batch([
      db().prepare(
        `INSERT INTO upload_jobs
         (id, user_id, team_id, series_id, kind, source_type, source_url,
          status, idempotency_key, expires_at)
         VALUES (?, ?, ?, ?, 'SINGLE', ?, ?, 'DRAFT', ?, ?)`,
      ).bind(jobId, principal.actorUserId, payload.teamId, payload.seriesId, sourceType, payload.source.googleDriveUrl ?? null, idempotencyKey, expiresAt),
      db().prepare(
        `INSERT INTO upload_job_items
         (id, job_id, client_key, source_label, series_id, team_id,
          volume, chapter_number, title, language, version, access_type,
          price_onyx, visibility, status)
         VALUES (?, ?, ?, 'Chapter 1', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'DRAFT')`,
      ).bind(itemId, jobId, clientKey, payload.seriesId, payload.teamId, payload.volume, payload.chapterNumber, payload.title, payload.language.toLowerCase(), payload.pricePaws > 0 ? "PAID" : "FREE", payload.pricePaws, payload.visibility),
      db().prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, target_type,
          target_id, target_label, reason, request_id, metadata_json)
         VALUES (?, ?, 'api.upload.create', 'UPLOADS_IMPORTS', 'EXTERNAL_API',
                 'UPLOAD_JOB', ?, ?, 'Created through a scoped API key.', ?, ?)`,
      ).bind(randomId(), principal.actorUserId, jobId, `Chapter ${payload.chapterNumber}`, requestId, JSON.stringify({ apiKeyId: principal.keyId, appName: principal.appName, teamId: payload.teamId, sourceType: payload.source.type })),
    ]);
    return json(requestId, {
      data: {
        id: jobId,
        itemId,
        status: "DRAFT",
        next: payload.source.type === "GOOGLE_DRIVE" ? "QUEUED_IMPORT" : "UPLOAD_FILES",
        filesEndpoint: `/api/external/v1/upload-jobs/${jobId}/files`,
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
