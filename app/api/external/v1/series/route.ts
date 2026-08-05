import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertApiTeam, requireApiKey } from "@/lib/server/api-keys";
import { requestIdFor } from "@/lib/server/admin-utils";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

function db() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "The external API is unavailable.");
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const principal = await requireApiKey(request, "series:read");
    const rows = await db().prepare(
      `SELECT s.id, s.slug, s.title, s.type, s.status, s.original_language AS originalLanguage,
              s.is_published AS isPublished, sta.team_id AS teamId
         FROM series s
         JOIN series_team_assignments sta ON sta.series_id = s.id
        WHERE (? IS NULL OR sta.team_id = ?)
          AND s.archived_at IS NULL
        ORDER BY datetime(s.updated_at) DESC LIMIT 100`,
    ).bind(principal.allowedTeamId, principal.allowedTeamId).all<Record<string, unknown>>();
    return json(requestId, { data: rows.results.map((row) => ({ ...row, isPublished: Boolean(row.isPublished) })) });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const principal = await requireApiKey(request, "series:create");
    const payload = z.object({
      teamId: z.string().trim().min(3).max(160),
      title: z.string().trim().min(2).max(180),
      slug: z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      synopsis: z.string().trim().min(12).max(8_000),
      type: z.enum(["MANGA", "MANHWA", "MANHUA", "COMIC", "NOVEL"]),
      status: z.enum(["ONGOING", "COMPLETED", "HIATUS", "CANCELLED"]).default("ONGOING"),
      originCountry: z.string().trim().length(2).default("KR"),
      originalLanguage: z.string().trim().min(2).max(12).default("ko"),
      readingDirection: z.enum(["LTR", "RTL", "VERTICAL"]).default("VERTICAL"),
    }).parse(await request.json());
    assertApiTeam(principal, payload.teamId);
    const team = await db().prepare(
      "SELECT id FROM teams WHERE id = ? AND is_archived = 0 AND verification_status = 'VERIFIED' LIMIT 1",
    ).bind(payload.teamId).first();
    if (!team) throw new ApiError(422, "TEAM_NOT_AVAILABLE", "The selected team is not available.");
    const id = `series_${randomId()}`;
    await db().batch([
      db().prepare(
        `INSERT INTO series
         (id, slug, title, synopsis, type, status, origin_country,
          original_language, reading_direction, rights_status, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DEMO_ORIGINAL', 0)`,
      ).bind(id, payload.slug, payload.title, payload.synopsis, payload.type, payload.status, payload.originCountry.toUpperCase(), payload.originalLanguage.toLowerCase(), payload.readingDirection),
      db().prepare(
        `INSERT INTO series_team_assignments
         (series_id, team_id, can_upload, can_publish, is_primary, assigned_by_user_id)
         VALUES (?, ?, 1, 0, 1, ?)`,
      ).bind(id, payload.teamId, principal.actorUserId),
      db().prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, target_type,
          target_id, target_label, reason, request_id, metadata_json)
         VALUES (?, ?, 'api.series.create_draft', 'SERIES_CHAPTERS', 'EXTERNAL_API',
                 'SERIES', ?, ?, 'Created through a scoped API key.', ?, ?)`,
      ).bind(randomId(), principal.actorUserId, id, payload.title, requestId, JSON.stringify({ apiKeyId: principal.keyId, appName: principal.appName, teamId: payload.teamId })),
    ]);
    return json(requestId, { data: { id, slug: payload.slug, state: "DRAFT", reviewRequired: true } }, { status: 201 });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
