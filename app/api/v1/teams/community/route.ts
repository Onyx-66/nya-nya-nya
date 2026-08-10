import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, auditStatement, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, type Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(3).max(160);
const linkSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "Team links must use HTTPS."),
  linkType: z.enum(["WEBSITE", "DISCORD", "SOCIAL", "PORTFOLIO", "OTHER"]).default("WEBSITE"),
});
const createSchema = z.object({
  action: z.literal("CREATE"),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(20).max(2_000),
  links: z.array(linkSchema).min(1).max(10),
  proofUrl: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "Ownership proof must use HTTPS."),
  statement: z.string().trim().min(20).max(1_000),
});
const actionSchema = z.discriminatedUnion("action", [
  createSchema,
  z.object({ action: z.literal("UPDATE"), teamId: idSchema, revision: z.number().int().min(1), description: z.string().trim().min(20).max(2_000), links: z.array(linkSchema).min(1).max(10) }),
  z.object({ action: z.literal("INVITE"), teamId: idSchema, email: z.string().trim().email().max(320), membershipRole: z.enum(["LEADER", "UPLOADER"]).default("UPLOADER") }),
  z.object({ action: z.literal("ADD_MEMBER"), teamId: idSchema, email: z.string().trim().email().max(320), membershipRole: z.enum(["LEADER", "UPLOADER"]).default("UPLOADER") }),
  z.object({ action: z.literal("ACCEPT"), teamId: idSchema }),
  z.object({ action: z.literal("DECLINE"), teamId: idSchema }),
  z.object({
    action: z.literal("RESUBMIT_CLAIM"),
    teamId: idSchema,
    proofUrl: z.string().trim().url().max(600).refine((value) => value.startsWith("https://"), "Ownership proof must use HTTPS."),
    statement: z.string().trim().min(20).max(1_000),
  }),
  z.object({ action: z.literal("REQUEST_TITLE"), teamId: idSchema, requestedTitle: z.string().trim().min(2).max(100), reason: z.string().trim().min(20).max(1_000) }),
]);

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Community teams are unavailable.");
  return env.DB;
}

function slugify(value: string) {
  const base = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80);
  return base || `team-${randomId().slice(0, 8)}`;
}

async function uniqueSlug(name: string) {
  const db = database();
  const base = slugify(name);
  if (!await db.prepare("SELECT 1 FROM teams WHERE slug = ? LIMIT 1").bind(base).first()) return base;
  return `${base}-${randomId().slice(0, 6).toLowerCase()}`;
}

async function membership(actor: Actor, teamId: string) {
  const row = await database().prepare(
    `SELECT t.id, t.name, t.slug, t.revision, t.verification_status AS verificationStatus,
            t.created_by_user_id AS createdByUserId, tm.membership_role AS membershipRole,
            tm.status AS membershipStatus
       FROM teams t LEFT JOIN team_memberships tm ON tm.team_id = t.id AND tm.user_id = ?
      WHERE t.id = ? AND t.is_archived = 0 LIMIT 1`,
  ).bind(actor.id, teamId).first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, "TEAM_NOT_FOUND", "This team no longer exists.");
  return row;
}

function canEdit(actor: Actor, team: Record<string, unknown>) {
  const pendingCreator = team.createdByUserId === actor.id &&
    team.verificationStatus === "PENDING" &&
    team.membershipStatus === "PENDING" &&
    team.membershipRole === "OWNER";
  const activeLeader = team.verificationStatus === "VERIFIED" &&
    team.membershipStatus === "ACTIVE" &&
    ["OWNER", "LEADER"].includes(String(team.membershipRole));
  return pendingCreator || activeLeader;
}

async function snapshot(actor: Actor) {
  const db = database();
  const teams = await db.prepare(
    `SELECT t.id, t.slug, t.name, t.description, t.verification_status AS verificationStatus,
            t.revision, t.created_at AS createdAt, t.updated_at AS updatedAt,
            tm.membership_role AS membershipRole, tm.status AS membershipStatus,
            CASE WHEN t.logo_key IS NULL THEN NULL ELSE '/api/v1/team-media?id=' || t.id || '&slot=logo&v=' || t.revision END AS logoUrl,
            CASE WHEN t.banner_key IS NULL THEN NULL ELSE '/api/v1/team-media?id=' || t.id || '&slot=banner&v=' || t.revision END AS bannerUrl
       FROM teams t LEFT JOIN team_memberships tm ON tm.team_id = t.id AND tm.user_id = ?
      WHERE tm.user_id = ?
        AND tm.status IN ('PENDING', 'INVITED', 'ACTIVE')
      ORDER BY datetime(t.updated_at) DESC`,
  ).bind(actor.id, actor.id).all<Record<string, unknown>>();
  const teamRows = teams.results ?? [];
  const ids = teamRows.map((team) => String(team.id));
  if (!ids.length) return { teams: [], invitations: [] };
  const placeholders = ids.map(() => "?").join(",");
  const [links, members, claims, titleRequests] = await Promise.all([
    db.prepare(`SELECT id, team_id AS teamId, label, url, link_type AS linkType, sort_order AS sortOrder FROM team_links WHERE team_id IN (${placeholders}) ORDER BY sort_order`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT tm.team_id AS teamId, tm.user_id AS userId, u.display_name AS displayName, u.email, tm.membership_role AS membershipRole, tm.status, tm.invited_at AS invitedAt, tm.responded_at AS respondedAt FROM team_memberships tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id IN (${placeholders}) ORDER BY u.display_name COLLATE NOCASE`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, team_id AS teamId, proof_type AS proofType, proof_value AS proofValue, statement, status, review_reason AS reviewReason, revision, created_at AS createdAt FROM team_ownership_claims WHERE team_id IN (${placeholders}) ORDER BY datetime(created_at) DESC`).bind(...ids).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, team_id AS teamId, requested_title AS requestedTitle, reason, status, review_reason AS reviewReason, revision, created_at AS createdAt FROM team_title_change_requests WHERE team_id IN (${placeholders}) ORDER BY datetime(created_at) DESC`).bind(...ids).all<Record<string, unknown>>(),
  ]);
  const visibleTeams = teamRows.filter((team) => team.membershipStatus !== "INVITED");
  return {
    teams: visibleTeams.map((team) => ({
      ...team,
      links: links.results.filter((link) => link.teamId === team.id),
      members: members.results.filter((member) => member.teamId === team.id),
      ownershipClaim: claims.results.find((claim) => claim.teamId === team.id) ?? null,
      titleRequests: titleRequests.results.filter((request) => request.teamId === team.id),
    })),
    invitations: teamRows.filter((team) => team.membershipStatus === "INVITED").map((team) => ({
      id: team.id,
      slug: team.slug,
      name: team.name,
      description: team.description,
      verificationStatus: team.verificationStatus,
      membershipRole: team.membershipRole,
      membershipStatus: team.membershipStatus,
      logoUrl: team.logoUrl,
      bannerUrl: team.bannerUrl,
      revision: team.revision,
      links: [],
      members: [],
      ownershipClaim: null,
      titleRequests: [],
    })),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    return json(requestId, { data: await snapshot(actor) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = actionSchema.parse(await request.json());
    const db = database();
    if (payload.action === "CREATE") {
      if (!payload.links.some((link) => link.url === payload.proofUrl)) throw new ApiError(422, "TEAM_PROOF_LINK_REQUIRED", "The ownership proof URL must be one of the team links.");
      const id = `team_${randomId()}`;
      const claimId = `team_claim_${randomId()}`;
      const slug = await uniqueSlug(payload.name);
      await db.batch([
        db.prepare("INSERT INTO teams (id, slug, name, description, created_by_user_id, verification_status) VALUES (?, ?, ?, ?, ?, 'PENDING')").bind(id, slug, payload.name, payload.description, actor.id),
        ...payload.links.map((link, index) => db.prepare("INSERT INTO team_links (id, team_id, label, url, link_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)").bind(`team_link_${randomId()}`, id, link.label, link.url, link.linkType, index)),
        db.prepare("INSERT INTO team_memberships (team_id, user_id, membership_role, status, invited_by_user_id, invited_at) VALUES (?, ?, 'OWNER', 'PENDING', ?, CURRENT_TIMESTAMP)").bind(id, actor.id, actor.id),
        db.prepare("INSERT INTO team_ownership_claims (id, team_id, claimant_user_id, proof_type, proof_value, statement) VALUES (?, ?, ?, 'LINK_CONTROL', ?, ?)").bind(claimId, id, actor.id, payload.proofUrl, payload.statement),
        auditStatement(db, actor, requestId, { action: "team.community.create", category: "TEAMS_PERMISSIONS", sourceArea: "COMMUNITY_TEAMS", targetType: "TEAM", targetId: id, targetLabel: payload.name, reason: "Ownership pending administrator verification" }),
      ]);
    } else if (payload.action === "UPDATE") {
      const team = await membership(actor, payload.teamId);
      if (team.verificationStatus === "SUSPENDED") throw new ApiError(423, "TEAM_SUSPENDED", "This team is suspended and cannot be edited.");
      if (!canEdit(actor, team)) throw new ApiError(403, "TEAM_MANAGEMENT_REQUIRED", "Only an authorized team member can edit these details.");
      const marker = `team_mutation_${randomId()}`;
      const statements = [
        db.prepare(`UPDATE teams
              SET description = ?, mutation_marker = ?, revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revision = ? AND is_archived = 0
              AND (
                (verification_status = 'PENDING' AND created_by_user_id = ?
                  AND EXISTS (SELECT 1 FROM team_memberships caller
                    WHERE caller.team_id = teams.id AND caller.user_id = ?
                      AND caller.membership_role = 'OWNER' AND caller.status = 'PENDING'))
                OR
                (verification_status = 'VERIFIED'
                  AND EXISTS (SELECT 1 FROM team_memberships caller
                    WHERE caller.team_id = teams.id AND caller.user_id = ?
                      AND caller.membership_role IN ('OWNER', 'LEADER') AND caller.status = 'ACTIVE'))
              )`).bind(payload.description, marker, payload.teamId, payload.revision, actor.id, actor.id, actor.id),
        db.prepare("DELETE FROM team_links WHERE team_id = ? AND EXISTS (SELECT 1 FROM teams WHERE id = ? AND mutation_marker = ?)").bind(payload.teamId, payload.teamId, marker),
        ...payload.links.map((link, index) => db.prepare("INSERT INTO team_links (id, team_id, label, url, link_type, sort_order) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM teams WHERE id = ? AND mutation_marker = ?)").bind(`team_link_${randomId()}`, payload.teamId, link.label, link.url, link.linkType, index, payload.teamId, marker)),
      ];
      const results = await db.batch(statements);
      if (!results[0]?.meta.changes) throw new ApiError(409, "STALE_VERSION", "This team changed. Reload before saving.");
    } else if (payload.action === "INVITE" || payload.action === "ADD_MEMBER") {
      const team = await membership(actor, payload.teamId);
      if (team.verificationStatus !== "VERIFIED") throw new ApiError(423, "TEAM_NOT_ACTIVE", "Members can be added only after ownership is verified.");
      const activeMember = team.membershipStatus === "ACTIVE";
      if (!activeMember) throw new ApiError(403, "TEAM_MEMBERSHIP_REQUIRED", "Only active team members can invite another reader.");
      if (payload.membershipRole === "LEADER" && !["OWNER", "LEADER"].includes(String(team.membershipRole))) throw new ApiError(403, "TEAM_LEADERSHIP_REQUIRED", "Only a team owner or leader can appoint another leader.");
      const target = await db.prepare("SELECT id, display_name AS displayName FROM users WHERE email = ? AND status = 'ACTIVE' LIMIT 1").bind(payload.email.toLowerCase()).first<{ id: string; displayName: string }>();
      if (!target) throw new ApiError(404, "USER_NOT_FOUND", "No active reader account uses that email address.");
      if (target.id === actor.id) throw new ApiError(409, "TEAM_MEMBER_SELF", "You already belong to this team.");
      const status = payload.action === "ADD_MEMBER" ? "ACTIVE" : "INVITED";
      const membershipResult = await db.prepare(`INSERT INTO team_memberships (team_id, user_id, membership_role, status, invited_by_user_id, invited_at, responded_at)
          SELECT ?, target.id, ?, ?, ?, CURRENT_TIMESTAMP, CASE WHEN ? = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE NULL END
            FROM users target
           WHERE target.id = ? AND target.status = 'ACTIVE' AND target.id <> ?
             AND EXISTS (
               SELECT 1 FROM teams current_team
               JOIN team_memberships caller ON caller.team_id = current_team.id
              WHERE current_team.id = ? AND current_team.verification_status = 'VERIFIED'
                AND current_team.is_archived = 0 AND caller.user_id = ? AND caller.status = 'ACTIVE'
                AND (? <> 'LEADER' OR caller.membership_role IN ('OWNER', 'LEADER'))
             )
          ON CONFLICT(team_id, user_id) DO UPDATE SET membership_role = excluded.membership_role, status = excluded.status, invited_by_user_id = excluded.invited_by_user_id, invited_at = CURRENT_TIMESTAMP, responded_at = excluded.responded_at, revision = team_memberships.revision + 1, updated_at = CURRENT_TIMESTAMP
          WHERE team_memberships.status IN ('DECLINED', 'INACTIVE') AND team_memberships.membership_role <> 'OWNER'`).bind(payload.teamId, payload.membershipRole, status, actor.id, status, target.id, actor.id, payload.teamId, actor.id, payload.membershipRole).run();
      if (!membershipResult.meta.changes) throw new ApiError(409, "TEAM_MEMBER_EXISTS_OR_ACCESS_CHANGED", "This reader already has a current membership, or your team permission changed. Reload before trying again.");
      await db.batch([
        db.prepare("INSERT INTO notifications (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json) VALUES (?, ?, 'TEAM_INVITATION', ?, ?, ?, '/dashboard/my-teams', ?)").bind(`ntf_${randomId()}`, target.id, status === "ACTIVE" ? `Added to ${team.name}` : `Invitation from ${team.name}`, status === "ACTIVE" ? `${actor.displayName} added you as ${payload.membershipRole.toLowerCase()}.` : `${actor.displayName} invited you to join as ${payload.membershipRole.toLowerCase()}.`, `team-membership:${payload.teamId}:${target.id}:${Date.now()}`, JSON.stringify({ teamId: payload.teamId, status })),
      ]);
    } else if (payload.action === "ACCEPT" || payload.action === "DECLINE") {
      const team = await membership(actor, payload.teamId);
      if (payload.action === "ACCEPT" && team.verificationStatus !== "VERIFIED") throw new ApiError(423, "TEAM_NOT_ACTIVE", "This invitation cannot be accepted while the team is not verified.");
      const result = await db.prepare(`UPDATE team_memberships
          SET status = ?, responded_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE team_id = ? AND user_id = ? AND status = 'INVITED'
          AND (? = 'DECLINED' OR EXISTS (
            SELECT 1 FROM teams active_team WHERE active_team.id = team_memberships.team_id
              AND active_team.verification_status = 'VERIFIED' AND active_team.is_archived = 0
          ))`).bind(payload.action === "ACCEPT" ? "ACTIVE" : "DECLINED", payload.teamId, actor.id, payload.action === "ACCEPT" ? "ACTIVE" : "DECLINED").run();
      if (!result.meta.changes) throw new ApiError(409, "TEAM_INVITATION_CHANGED", "This invitation is no longer pending.");
    } else if (payload.action === "RESUBMIT_CLAIM") {
      const team = await membership(actor, payload.teamId);
      if (team.createdByUserId !== actor.id || team.verificationStatus !== "PENDING") {
        throw new ApiError(403, "TEAM_CLAIMANT_REQUIRED", "Only the original creator can resubmit a pending ownership claim.");
      }
      const linked = await db.prepare("SELECT 1 FROM team_links WHERE team_id = ? AND url = ? LIMIT 1").bind(payload.teamId, payload.proofUrl).first();
      if (!linked) throw new ApiError(422, "TEAM_PROOF_LINK_REQUIRED", "The ownership proof URL must be one of the team links.");
      const pending = await db.prepare("SELECT 1 FROM team_ownership_claims WHERE team_id = ? AND status = 'PENDING' LIMIT 1").bind(payload.teamId).first();
      if (pending) throw new ApiError(409, "TEAM_CLAIM_PENDING", "An ownership claim is already waiting for review.");
      const claimResult = await db.prepare(`INSERT INTO team_ownership_claims (id, team_id, claimant_user_id, proof_type, proof_value, statement)
          SELECT ?, pending_team.id, ?, 'LINK_CONTROL', ?, ?
            FROM teams pending_team
           WHERE pending_team.id = ? AND pending_team.created_by_user_id = ?
             AND pending_team.verification_status = 'PENDING' AND pending_team.is_archived = 0
             AND EXISTS (SELECT 1 FROM team_memberships caller WHERE caller.team_id = pending_team.id AND caller.user_id = ? AND caller.membership_role = 'OWNER' AND caller.status = 'PENDING')
             AND EXISTS (SELECT 1 FROM team_links proof WHERE proof.team_id = pending_team.id AND proof.url = ?)
             AND NOT EXISTS (SELECT 1 FROM team_ownership_claims open_claim WHERE open_claim.team_id = pending_team.id AND open_claim.status = 'PENDING')`).bind(`team_claim_${randomId()}`, actor.id, payload.proofUrl, payload.statement, payload.teamId, actor.id, actor.id, payload.proofUrl).run();
      if (!claimResult.meta.changes) throw new ApiError(409, "TEAM_CLAIM_ACCESS_CHANGED", "The pending team, proof link, or ownership state changed. Reload before resubmitting.");
    } else if (payload.action === "REQUEST_TITLE") {
      const team = await membership(actor, payload.teamId);
      if (team.verificationStatus !== "VERIFIED") throw new ApiError(423, "TEAM_NOT_ACTIVE", "A suspended or unverified team cannot request a title change.");
      if (!canEdit(actor, team) || team.membershipStatus !== "ACTIVE") throw new ApiError(403, "TEAM_LEADERSHIP_REQUIRED", "Only an active team owner or leader can request a title change.");
      if (String(team.name).toLowerCase() === payload.requestedTitle.toLowerCase()) throw new ApiError(409, "TEAM_TITLE_UNCHANGED", "Enter a different team title.");
      const titleResult = await db.prepare(`INSERT INTO team_title_change_requests (id, team_id, requested_by_user_id, requested_title, requested_slug, reason)
          SELECT ?, active_team.id, ?, ?, ?, ?
            FROM teams active_team
           WHERE active_team.id = ? AND active_team.verification_status = 'VERIFIED' AND active_team.is_archived = 0
             AND EXISTS (SELECT 1 FROM team_memberships caller WHERE caller.team_id = active_team.id AND caller.user_id = ? AND caller.status = 'ACTIVE' AND caller.membership_role IN ('OWNER', 'LEADER'))`).bind(`team_title_request_${randomId()}`, actor.id, payload.requestedTitle, await uniqueSlug(payload.requestedTitle), payload.reason, payload.teamId, actor.id).run();
      if (!titleResult.meta.changes) throw new ApiError(409, "TEAM_TITLE_ACCESS_CHANGED", "The team or your leadership permission changed. Reload before requesting a title change.");
    }
    return json(requestId, { data: await snapshot(actor) });
  } catch (error) { return errorResponse(requestId, error); }
}
