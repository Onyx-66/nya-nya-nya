import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, auditStatement, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

function database() {
  if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Team review queues are unavailable.");
  return env.DB;
}

async function snapshot() {
  const db = database();
  const [claims, titles] = await Promise.all([
    db.prepare(
      `SELECT c.id, c.team_id AS teamId, t.name AS teamName, t.slug AS teamSlug,
              u.display_name AS claimantName, u.email AS claimantEmail,
              c.proof_type AS proofType, c.proof_value AS proofValue,
              c.statement, c.status, c.review_reason AS reviewReason,
              c.revision, c.created_at AS createdAt,
              (SELECT json_group_array(json_object('label', l.label, 'url', l.url, 'linkType', l.link_type)) FROM team_links l WHERE l.team_id = c.team_id) AS linksJson
         FROM team_ownership_claims c JOIN teams t ON t.id = c.team_id
         JOIN users u ON u.id = c.claimant_user_id
        ORDER BY CASE c.status WHEN 'PENDING' THEN 0 ELSE 1 END, datetime(c.created_at) DESC`,
    ).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT r.id, r.team_id AS teamId, t.name AS currentTitle,
              r.requested_title AS requestedTitle, r.reason, r.status,
              r.review_reason AS reviewReason, r.revision,
              u.display_name AS requestedBy, u.email AS requesterEmail,
              r.created_at AS createdAt
         FROM team_title_change_requests r JOIN teams t ON t.id = r.team_id
         JOIN users u ON u.id = r.requested_by_user_id
        ORDER BY CASE r.status WHEN 'PENDING' THEN 0 ELSE 1 END, datetime(r.created_at) DESC`,
    ).all<Record<string, unknown>>(),
  ]);
  return {
    ownershipClaims: claims.results.map((claim) => ({ ...claim, links: (() => { try { return JSON.parse(String(claim.linksJson ?? "[]")); } catch { return []; } })() })),
    titleRequests: titles.results,
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor(); requireAdminCapability(actor, "content.team-requests.review");
    return json(requestId, { data: await snapshot() }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return errorResponse(requestId, error); }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor(); requireAdminCapability(actor, "content.team-requests.review");
    const payload = z.object({
      kind: z.enum(["OWNERSHIP", "TITLE"]),
      id: z.string().trim().min(3).max(160),
      revision: z.number().int().min(1),
      decision: z.enum(["APPROVE", "REJECT"]),
      reason: z.string().trim().min(10).max(1_000),
    }).parse(await request.json());
    const db = database();
    if (payload.kind === "OWNERSHIP") {
      const claim = await db.prepare("SELECT team_id AS teamId, claimant_user_id AS claimantUserId FROM team_ownership_claims WHERE id = ? AND status = 'PENDING' AND revision = ?").bind(payload.id, payload.revision).first<{ teamId: string; claimantUserId: string }>();
      if (!claim) throw new ApiError(409, "TEAM_CLAIM_CHANGED", "This ownership claim is no longer pending.");
      const approved = payload.decision === "APPROVE";
      const decisionRevision = payload.revision + 1;
      const claimMutation = approved
        ? db.prepare(`UPDATE team_ownership_claims
              SET status = 'APPROVED', reviewed_by_user_id = ?, review_reason = ?,
                  reviewed_at = CURRENT_TIMESTAMP, revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'PENDING' AND revision = ?
              AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_ownership_claims.team_id AND t.verification_status = 'PENDING' AND t.is_archived = 0)
              AND EXISTS (SELECT 1 FROM team_links l WHERE l.team_id = team_ownership_claims.team_id AND l.url = team_ownership_claims.proof_value)
              AND EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = team_ownership_claims.team_id AND tm.user_id = team_ownership_claims.claimant_user_id AND tm.membership_role = 'OWNER' AND tm.status = 'PENDING')`)
            .bind(actor.id, payload.reason, payload.id, payload.revision)
        : db.prepare("UPDATE team_ownership_claims SET status = 'REJECTED', reviewed_by_user_id = ?, review_reason = ?, reviewed_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING' AND revision = ?")
            .bind(actor.id, payload.reason, payload.id, payload.revision);
      const claimGate = `EXISTS (SELECT 1 FROM team_ownership_claims c WHERE c.id = ? AND c.status = ? AND c.revision = ? AND c.reviewed_by_user_id = ?)`;
      const results = await db.batch([
        claimMutation,
        ...(approved ? [
          db.prepare(`UPDATE teams SET verification_status = 'VERIFIED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND verification_status = 'PENDING' AND ${claimGate}`).bind(claim.teamId, payload.id, "APPROVED", decisionRevision, actor.id),
          db.prepare(`UPDATE team_memberships SET status = 'ACTIVE', responded_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE team_id = ? AND user_id = ? AND membership_role = 'OWNER' AND status = 'PENDING' AND ${claimGate}`).bind(claim.teamId, claim.claimantUserId, payload.id, "APPROVED", decisionRevision, actor.id),
        ] : []),
        db.prepare(`INSERT INTO notifications (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
          SELECT 'ntf_' || lower(hex(randomblob(16))), ?, 'TEAM_REVIEW', ?, ?, ?, '/dashboard/my-teams', ? WHERE ${claimGate}`).bind(claim.claimantUserId, approved ? "Team ownership approved" : "Team ownership needs changes", payload.reason, `team-claim:${payload.id}:${payload.decision}`, JSON.stringify({ teamId: claim.teamId, decision: payload.decision }), payload.id, approved ? "APPROVED" : "REJECTED", decisionRevision, actor.id),
        auditStatement(db, actor, requestId, { action: approved ? "team.ownership.approve" : "team.ownership.reject", category: "TEAMS_PERMISSIONS", sourceArea: "TEAM_REQUESTS", targetType: "TEAM", targetId: claim.teamId, reason: payload.reason }, "changes() = 1"),
        db.prepare("UPDATE team_ownership_claims SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ? AND revision = ? AND reviewed_by_user_id = ?").bind(payload.id, approved ? "APPROVED" : "REJECTED", decisionRevision, actor.id),
      ]);
      if (!results[0]?.meta.changes) throw new ApiError(409, "TEAM_CLAIM_CHANGED", "This ownership claim changed during review.");
      if (approved && (!results[1]?.meta.changes || !results[2]?.meta.changes)) throw new ApiError(409, "TEAM_CLAIM_INVARIANT", "Ownership could not be activated because its proof or pending owner changed.");
    } else {
      const titleRequest = await db.prepare("SELECT team_id AS teamId, requested_by_user_id AS requestedByUserId, requested_title AS requestedTitle, requested_slug AS requestedSlug FROM team_title_change_requests WHERE id = ? AND status = 'PENDING' AND revision = ?").bind(payload.id, payload.revision).first<{ teamId: string; requestedByUserId: string; requestedTitle: string; requestedSlug: string }>();
      if (!titleRequest) throw new ApiError(409, "TEAM_TITLE_REQUEST_CHANGED", "This title request is no longer pending.");
      const approved = payload.decision === "APPROVE";
      const decisionRevision = payload.revision + 1;
      const requestGate = `EXISTS (SELECT 1 FROM team_title_change_requests r WHERE r.id = ? AND r.status = ? AND r.revision = ? AND r.reviewed_by_user_id = ?)`;
      const titleGate = approved
        ? `${requestGate} AND EXISTS (SELECT 1 FROM teams t WHERE t.id = ? AND t.verification_status = 'VERIFIED' AND t.is_archived = 0 AND t.name = ? AND t.slug = ?)`
        : requestGate;
      const titleDecision = approved
        ? db.prepare(`UPDATE team_title_change_requests
              SET status = 'APPROVED', reviewed_by_user_id = ?, review_reason = ?,
                  reviewed_at = CURRENT_TIMESTAMP, revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'PENDING' AND revision = ?
              AND EXISTS (SELECT 1 FROM teams t WHERE t.id = team_title_change_requests.team_id AND t.verification_status = 'VERIFIED' AND t.is_archived = 0)
              AND EXISTS (SELECT 1 FROM team_memberships requester
                WHERE requester.team_id = team_title_change_requests.team_id
                  AND requester.user_id = team_title_change_requests.requested_by_user_id
                  AND requester.membership_role IN ('OWNER', 'LEADER')
                  AND requester.status = 'ACTIVE')`)
            .bind(actor.id, payload.reason, payload.id, payload.revision)
        : db.prepare("UPDATE team_title_change_requests SET status = 'REJECTED', reviewed_by_user_id = ?, review_reason = ?, reviewed_at = CURRENT_TIMESTAMP, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING' AND revision = ?")
            .bind(actor.id, payload.reason, payload.id, payload.revision);
      const titleGateBindings = approved
        ? [payload.id, "APPROVED", decisionRevision, actor.id, titleRequest.teamId, titleRequest.requestedTitle, titleRequest.requestedSlug]
        : [payload.id, "REJECTED", decisionRevision, actor.id];
      const titleConsume = approved
        ? db.prepare(`UPDATE team_title_change_requests
              SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'APPROVED' AND revision = ?
              AND reviewed_by_user_id = ?
              AND EXISTS (SELECT 1 FROM teams t WHERE t.id = ? AND t.verification_status = 'VERIFIED' AND t.is_archived = 0 AND t.name = ? AND t.slug = ?)`)
            .bind(payload.id, decisionRevision, actor.id, titleRequest.teamId, titleRequest.requestedTitle, titleRequest.requestedSlug)
        : db.prepare("UPDATE team_title_change_requests SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'REJECTED' AND revision = ? AND reviewed_by_user_id = ?")
            .bind(payload.id, decisionRevision, actor.id);
      const results = await db.batch([
        titleDecision,
        ...(approved ? [db.prepare(`UPDATE teams SET name = ?, slug = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND verification_status = 'VERIFIED' AND is_archived = 0 AND ${requestGate}`).bind(titleRequest.requestedTitle, titleRequest.requestedSlug, titleRequest.teamId, payload.id, "APPROVED", decisionRevision, actor.id)] : []),
        db.prepare(`INSERT INTO notifications (id, user_id, kind, title, body, dedupe_key, action_url, metadata_json)
          SELECT 'ntf_' || lower(hex(randomblob(16))), ?, 'TEAM_REVIEW', ?, ?, ?, '/dashboard/my-teams', ? WHERE ${titleGate}`).bind(titleRequest.requestedByUserId, approved ? "Team title change approved" : "Team title change rejected", payload.reason, `team-title:${payload.id}:${payload.decision}`, JSON.stringify({ teamId: titleRequest.teamId, decision: payload.decision }), ...titleGateBindings),
        auditStatement(db, actor, requestId, { action: approved ? "team.title.approve" : "team.title.reject", category: "TEAMS_PERMISSIONS", sourceArea: "TEAM_REQUESTS", targetType: "TEAM", targetId: titleRequest.teamId, targetLabel: titleRequest.requestedTitle, reason: payload.reason }, "changes() = 1"),
        titleConsume,
      ]);
      if (!results[0]?.meta.changes) throw new ApiError(409, "TEAM_TITLE_REQUEST_CHANGED", "This title request changed during review.");
      if (approved && !results[1]?.meta.changes) throw new ApiError(409, "TEAM_TITLE_INVARIANT", "The verified team changed before this title approval could be applied.");
    }
    return json(requestId, { data: await snapshot() });
  } catch (error) { return errorResponse(requestId, error); }
}
