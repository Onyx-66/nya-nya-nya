import type { ApprovedTeamRight } from "@/lib/series-requests";
import { ApiError } from "@/lib/server/api";
import { auditStatement } from "@/lib/server/admin-utils";
import type { Database } from "@/lib/server/series-request-common";
import type { Actor } from "@/lib/server/policy";

async function assertRightTargets(
  db: Database,
  seriesId: string,
  teamId: string,
) {
  const [series, team] = await db.batch([
    db
      .prepare(
        `SELECT id FROM series
          WHERE id = ?
            AND archived_at IS NULL
          LIMIT 1`,
      )
      .bind(seriesId),
    db
      .prepare(
        `SELECT id FROM teams
          WHERE id = ?
            AND is_archived = 0
            AND verification_status = 'VERIFIED'
          LIMIT 1`,
      )
      .bind(teamId),
  ]);
  if (!series.results.length) {
    throw new ApiError(
      404,
      "SERIES_NOT_FOUND",
      "The selected series is unavailable.",
    );
  }
  if (!team.results.length) {
    throw new ApiError(
      422,
      "TEAM_NOT_AVAILABLE",
      "The selected team is not eligible for publishing rights.",
    );
  }
}

export async function listUploadRights(
  db: Database,
  actor: Actor,
  input: {
    teamId?: string;
    seriesId?: string;
    includeRevoked: boolean;
    page: number;
    limit: number;
  },
) {
  const isAdmin =
    actor.primaryRole === "OWNER" || actor.primaryRole === "ADMINISTRATOR";
  if (
    input.teamId &&
    !isAdmin &&
    !actor.teamIds.includes(input.teamId)
  ) {
    throw new ApiError(
      403,
      "TEAM_ACCESS_DENIED",
      "You can only inspect rights for your own teams.",
    );
  }
  const conditions = [
    `(
      ? = 1
      OR EXISTS (
        SELECT 1 FROM team_memberships tm
         WHERE tm.team_id = sta.team_id
           AND tm.user_id = ?
           AND tm.status = 'ACTIVE'
      )
    )`,
  ];
  const bindings: unknown[] = [isAdmin ? 1 : 0, actor.id];
  if (input.teamId) {
    conditions.push("sta.team_id = ?");
    bindings.push(input.teamId);
  }
  if (input.seriesId) {
    conditions.push("sta.series_id = ?");
    bindings.push(input.seriesId);
  }
  if (!input.includeRevoked) {
    conditions.push("sta.revoked_at IS NULL");
  }
  const where = conditions.join(" AND ");
  const offset = (input.page - 1) * input.limit;
  const [rows, count] = await db.batch([
    db
      .prepare(
        `SELECT sta.series_id AS seriesId,
                s.title AS seriesTitle,
                s.slug AS seriesSlug,
                sta.team_id AS teamId,
                t.name AS teamName,
                sta.can_upload AS canUpload,
                sta.can_publish AS canPublish,
                sta.is_primary AS isPrimary,
                sta.allowed_languages_json AS allowedLanguagesJson,
                sta.upload_requires_review AS uploadRequiresReview,
                sta.revoked_at AS revokedAt,
                sta.restriction_reason AS restrictionReason,
                sta.revision,
                sta.created_at AS assignedAt,
                assigner.display_name AS assignedBy,
                revoker.display_name AS revokedBy
           FROM series_team_assignments sta
           JOIN series s ON s.id = sta.series_id
           JOIN teams t ON t.id = sta.team_id
           LEFT JOIN users assigner ON assigner.id = sta.assigned_by_user_id
           LEFT JOIN users revoker ON revoker.id = sta.revoked_by_user_id
          WHERE ${where}
          ORDER BY sta.revoked_at IS NOT NULL,
                   t.name COLLATE NOCASE,
                   s.title COLLATE NOCASE,
                   s.id
          LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, input.limit, offset),
    db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM series_team_assignments sta
          WHERE ${where}`,
      )
      .bind(...bindings),
  ]);
  const total = Number(
    (count.results[0] as { count?: number } | undefined)?.count ?? 0,
  );
  return {
    data: (rows.results as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      canUpload: Boolean(row.canUpload),
      canPublish: Boolean(row.canPublish),
      isPrimary: Boolean(row.isPrimary),
      uploadRequiresReview: Boolean(row.uploadRequiresReview),
      allowedLanguages: JSON.parse(String(row.allowedLanguagesJson ?? "[]")),
      allowedLanguagesJson: undefined,
      revision: Number(row.revision),
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.max(1, Math.ceil(total / input.limit)),
    },
  };
}

export async function grantUploadRight(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    seriesId: string;
    right: ApprovedTeamRight;
    reason: string;
  },
) {
  await assertRightTargets(db, input.seriesId, input.right.teamId);
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO series_team_assignments
         (series_id, team_id, can_upload, can_publish, is_primary,
          assigned_by_user_id, allowed_languages_json,
          upload_requires_review, restriction_reason, revision)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, '', 1
          WHERE NOT EXISTS (
            SELECT 1 FROM series_team_assignments
             WHERE series_id = ?
               AND team_id = ?
          )
            AND EXISTS (
              SELECT 1 FROM series
               WHERE id = ?
                 AND archived_at IS NULL
            )
            AND EXISTS (
              SELECT 1 FROM teams
               WHERE id = ?
                 AND is_archived = 0
                 AND verification_status = 'VERIFIED'
            )
            AND EXISTS (
              SELECT 1 FROM users live_actor
               WHERE live_actor.id = ?
                 AND live_actor.status = 'ACTIVE'
                 AND live_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
            )`,
      )
      .bind(
        input.seriesId,
        input.right.teamId,
        input.right.canUpload ? 1 : 0,
        input.right.canPublish ? 1 : 0,
        input.right.isPrimary ? 1 : 0,
        actor.id,
        JSON.stringify(input.right.allowedLanguages),
        input.right.uploadRequiresReview ? 1 : 0,
        input.seriesId,
        input.right.teamId,
        input.seriesId,
        input.right.teamId,
        actor.id,
      ),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.rights.grant",
        category: "TEAMS_PERMISSIONS",
        sourceArea: "UPLOAD_RIGHTS",
        targetType: "SERIES_TEAM_RIGHT",
        targetId: `${input.seriesId}:${input.right.teamId}`,
        reason: input.reason,
        newValue: input.right,
      },
      "changes() = 1",
    ),
  ]);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "RIGHT_ALREADY_EXISTS",
      "That team already has a rights record. Update or restore it instead.",
    );
  }
  return { seriesId: input.seriesId, teamId: input.right.teamId, revision: 1 };
}

export async function updateUploadRight(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    seriesId: string;
    expectedRevision: number;
    right: ApprovedTeamRight;
    reason: string;
  },
) {
  await assertRightTargets(db, input.seriesId, input.right.teamId);
  const nextRevision = input.expectedRevision + 1;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE series_team_assignments
            SET can_upload = ?,
                can_publish = ?,
                is_primary = ?,
                assigned_by_user_id = ?,
                allowed_languages_json = ?,
                upload_requires_review = ?,
                revoked_at = NULL,
                revoked_by_user_id = NULL,
                restriction_reason = '',
                revision = ?
          WHERE series_id = ?
            AND team_id = ?
            AND revision = ?
            AND EXISTS (
              SELECT 1 FROM series live_series
               WHERE live_series.id = series_team_assignments.series_id
                 AND live_series.archived_at IS NULL
            )
            AND EXISTS (
              SELECT 1 FROM teams live_team
               WHERE live_team.id = series_team_assignments.team_id
                 AND live_team.is_archived = 0
                 AND live_team.verification_status = 'VERIFIED'
            )
            AND EXISTS (
              SELECT 1 FROM users live_actor
               WHERE live_actor.id = ?
                 AND live_actor.status = 'ACTIVE'
                 AND live_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
            )`,
      )
      .bind(
        input.right.canUpload ? 1 : 0,
        input.right.canPublish ? 1 : 0,
        input.right.isPrimary ? 1 : 0,
        actor.id,
        JSON.stringify(input.right.allowedLanguages),
        input.right.uploadRequiresReview ? 1 : 0,
        nextRevision,
        input.seriesId,
        input.right.teamId,
        input.expectedRevision,
        actor.id,
      ),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.rights.update",
        category: "TEAMS_PERMISSIONS",
        sourceArea: "UPLOAD_RIGHTS",
        targetType: "SERIES_TEAM_RIGHT",
        targetId: `${input.seriesId}:${input.right.teamId}`,
        reason: input.reason,
        oldValue: { revision: input.expectedRevision },
        newValue: { revision: nextRevision, ...input.right },
      },
      "changes() = 1",
    ),
  ]);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "The rights record changed. Reload it before saving.",
    );
  }
  return {
    seriesId: input.seriesId,
    teamId: input.right.teamId,
    revision: nextRevision,
  };
}

export async function revokeUploadRight(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    seriesId: string;
    teamId: string;
    expectedRevision: number;
    reason: string;
  },
) {
  const nextRevision = input.expectedRevision + 1;
  const operationTime = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE series_team_assignments
            SET can_upload = 0,
                can_publish = 0,
                is_primary = 0,
                revoked_at = ?,
                revoked_by_user_id = ?,
                restriction_reason = ?,
                revision = ?
          WHERE series_id = ?
            AND team_id = ?
            AND revision = ?
            AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1 FROM users live_actor
               WHERE live_actor.id = ?
                 AND live_actor.status = 'ACTIVE'
                 AND live_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
            )`,
      )
      .bind(
        operationTime,
        actor.id,
        input.reason,
        nextRevision,
        input.seriesId,
        input.teamId,
        input.expectedRevision,
        actor.id,
      ),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.rights.revoke",
        category: "TEAMS_PERMISSIONS",
        sourceArea: "UPLOAD_RIGHTS",
        targetType: "SERIES_TEAM_RIGHT",
        targetId: `${input.seriesId}:${input.teamId}`,
        reason: input.reason,
        oldValue: { revision: input.expectedRevision, revokedAt: null },
        newValue: { revision: nextRevision, revokedAt: operationTime },
      },
      "changes() = 1",
    ),
  ]);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "The rights record changed or was already revoked.",
    );
  }
  return {
    seriesId: input.seriesId,
    teamId: input.teamId,
    revision: nextRevision,
    revokedAt: operationTime,
  };
}
