import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, auditStatement, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const roleSchema = z.enum(["OWNER", "LEADER", "UPLOADER"]);

function db() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Team member controls are unavailable.");
  return env.DB;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "content.teams.manage");
    const url = new URL(request.url);
    const teamId = z.string().trim().min(3).max(160).parse(url.searchParams.get("teamId"));
    const query = z.string().trim().min(2).max(120).parse(url.searchParams.get("query"));
    const term = `%${query.toLowerCase()}%`;
    const users = await db().prepare(
      `SELECT u.id, u.display_name AS displayName, u.email,
              tm.status AS membershipStatus, tm.membership_role AS membershipRole
         FROM users u
         LEFT JOIN team_memberships tm ON tm.user_id = u.id AND tm.team_id = ?
        WHERE u.status = 'ACTIVE'
          AND (LOWER(u.display_name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.id) = ?)
        ORDER BY tm.status = 'ACTIVE', u.display_name COLLATE NOCASE
        LIMIT 12`,
    ).bind(teamId, term, term, query.toLowerCase()).all<Record<string, unknown>>();
    return json(requestId, { data: users.results });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.teams.manage");
    const payload = z.object({
      action: z.enum(["ADD", "UPDATE", "REMOVE"]),
      teamId: z.string().trim().min(3).max(160),
      userId: z.string().trim().min(3).max(160),
      role: roleSchema.optional(),
      revision: z.coerce.number().int().min(1).optional(),
    }).superRefine((value, context) => {
      if (value.action !== "REMOVE" && !value.role) context.addIssue({ code: "custom", path: ["role"], message: "Choose Owner, Leader, or Uploader." });
    }).parse(await request.json());
    const database = db();
    const [team, user, current] = await Promise.all([
      database.prepare("SELECT id, name FROM teams WHERE id = ? LIMIT 1").bind(payload.teamId).first<{ id: string; name: string }>(),
      database.prepare("SELECT id, display_name AS displayName FROM users WHERE id = ? AND status = 'ACTIVE' LIMIT 1").bind(payload.userId).first<{ id: string; displayName: string }>(),
      database.prepare("SELECT membership_role AS role, status, revision FROM team_memberships WHERE team_id = ? AND user_id = ? LIMIT 1").bind(payload.teamId, payload.userId).first<{ role: string; status: string; revision: number }>(),
    ]);
    if (!team || !user) throw new ApiError(404, "MEMBER_TARGET_NOT_FOUND", "The selected team or user no longer exists.");
    const removesOwner = current?.status === "ACTIVE" && current.role === "OWNER" && (payload.action === "REMOVE" || payload.role !== "OWNER");
    if (removesOwner) {
      const owners = await database.prepare("SELECT COUNT(*) AS count FROM team_memberships WHERE team_id = ? AND status = 'ACTIVE' AND membership_role = 'OWNER'").bind(payload.teamId).first<{ count: number }>();
      if (Number(owners?.count ?? 0) <= 1) throw new ApiError(409, "FINAL_TEAM_OWNER_PROTECTED", "Assign another active team owner before removing or changing the final owner.");
    }
    if (payload.action === "ADD") {
      await database.batch([
        database.prepare(
          `INSERT INTO team_memberships
           (team_id, user_id, membership_role, status, is_primary, can_request_series)
           VALUES (?, ?, ?, 'ACTIVE', 0, 0)
           ON CONFLICT(team_id, user_id) DO UPDATE SET
             membership_role = excluded.membership_role, status = 'ACTIVE',
             revision = team_memberships.revision + 1, updated_at = CURRENT_TIMESTAMP`,
        ).bind(payload.teamId, payload.userId, payload.role),
        auditStatement(database, actor, requestId, { action: "team.member.add", category: "TEAMS_PERMISSIONS", sourceArea: "TEAM_MANAGEMENT", targetType: "TEAM_MEMBER", targetId: `${payload.teamId}:${payload.userId}`, targetLabel: user.displayName, metadata: { teamId: payload.teamId, role: payload.role } }),
      ]);
    } else if (payload.action === "UPDATE") {
      if (!current) throw new ApiError(404, "TEAM_MEMBER_NOT_FOUND", "This team member no longer exists.");
      const result = await database.prepare(
        `UPDATE team_memberships SET membership_role = ?, status = 'ACTIVE',
                revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE team_id = ? AND user_id = ? AND revision = ?`,
      ).bind(payload.role, payload.teamId, payload.userId, payload.revision).run();
      if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This membership changed. Reload and try again.");
      await auditStatement(database, actor, requestId, { action: "team.member.role.update", category: "TEAMS_PERMISSIONS", sourceArea: "TEAM_MANAGEMENT", targetType: "TEAM_MEMBER", targetId: `${payload.teamId}:${payload.userId}`, targetLabel: user.displayName, oldValue: { role: current.role }, newValue: { role: payload.role } }).run();
    } else {
      if (!current) throw new ApiError(404, "TEAM_MEMBER_NOT_FOUND", "This team member no longer exists.");
      const result = await database.prepare(
        `UPDATE team_memberships SET status = 'INACTIVE', is_primary = 0,
                revision = revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE team_id = ? AND user_id = ? AND revision = ?`,
      ).bind(payload.teamId, payload.userId, payload.revision).run();
      if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This membership changed. Reload and try again.");
      await auditStatement(database, actor, requestId, { action: "team.member.remove", category: "TEAMS_PERMISSIONS", sourceArea: "TEAM_MANAGEMENT", targetType: "TEAM_MEMBER", targetId: `${payload.teamId}:${payload.userId}`, targetLabel: user.displayName, oldValue: { status: current.status, role: current.role }, newValue: { status: "INACTIVE" } }).run();
    }
    return json(requestId, { ok: true });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
