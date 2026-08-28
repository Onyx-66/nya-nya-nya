import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, auditStatement, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(20).max(2_000),
  websiteUrl: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "Website links must use HTTPS.").nullable().optional(),
  discordUrl: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "Discord links must use HTTPS.").nullable().optional(),
  reason: z.string().trim().min(20).max(1_000),
});

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Team creation requests are unavailable.");
  return env.DB;
}

async function snapshot(actorId: string) {
  const result = await database().prepare(
    `SELECT id, name, slug, description, website_url AS websiteUrl,
            discord_url AS discordUrl, reason, status,
            review_reason AS reviewReason, revision,
            created_at AS createdAt, reviewed_at AS reviewedAt
       FROM team_creation_requests
      WHERE requested_by_user_id = ?
      ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END,
               datetime(created_at) DESC`,
  ).bind(actorId).all<Record<string, unknown>>();
  return { requests: result.results ?? [] };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    if (!actor.canUseUploadCenter) throw new ApiError(403, "UPLOAD_CENTER_REQUIRED", "Upload Center access is required to request a team.");
    return json(requestId, { data: await snapshot(actor.id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!actor.canUseUploadCenter) throw new ApiError(403, "UPLOAD_CENTER_REQUIRED", "Upload Center access is required to request a team.");
    const payload = createSchema.parse(await request.json());
    const db = database();
    const duplicate = await db.prepare(
      `SELECT id FROM team_creation_requests
        WHERE requested_by_user_id = ? AND status = 'PENDING'
          AND lower(name) = lower(?) LIMIT 1`,
    ).bind(actor.id, payload.name).first<{ id: string }>();
    if (duplicate) throw new ApiError(409, "TEAM_CREATION_REQUEST_EXISTS", "You already have a pending request for a team with this name.");
    const id = `team_create_${randomId()}`;
    const slug = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || `team-${randomId().slice(0, 8)}`;
    await db.batch([
      db.prepare(
        `INSERT INTO team_creation_requests
         (id, requested_by_user_id, name, slug, description, website_url, discord_url, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, actor.id, payload.name, slug, payload.description, payload.websiteUrl ?? null, payload.discordUrl ?? null, payload.reason),
      auditStatement(db, actor, requestId, {
        action: "team.creation.request",
        category: "TEAMS_PERMISSIONS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "TEAM_CREATION_REQUEST",
        targetId: id,
        targetLabel: payload.name,
        reason: "New team submitted for administrator review",
      }),
    ]);
    return json(requestId, { data: await snapshot(actor.id) }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}
