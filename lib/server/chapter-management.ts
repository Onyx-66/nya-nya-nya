import { env } from "cloudflare:workers";
import { ApiError } from "@/lib/server/api";
import type { Actor } from "@/lib/server/policy";

export type ChapterManagementScope = {
  actorId: string;
  actorRole: Actor["primaryRole"];
  seriesId: string;
  chapterId: string;
  teamId: string | null;
  administrator: boolean;
  canEditMetadata: boolean;
  canManagePages: boolean;
  canPublish: boolean;
  canManageCommerce: boolean;
  allowedLanguages: string[];
};

function actorRoles(actor: Actor) {
  return [...new Set([actor.primaryRole, ...(actor.roles ?? [])])];
}

function isChapterAdministrator(actor: Actor) {
  const roles = new Set(actorRoles(actor));
  return roles.has("OWNER") || roles.has("ADMINISTRATOR");
}

export function chapterManagementAuthorizationClause(
  actor: Actor,
  input: {
    chapterAlias?: string;
    requirePublish?: boolean;
    language?: string;
  } = {},
) {
  const chapterAlias = input.chapterAlias ?? "chapters";
  if (isChapterAdministrator(actor)) {
    return {
      sql: `EXISTS (
        SELECT 1
          FROM users live_actor
         WHERE live_actor.id = ?
           AND live_actor.status = 'ACTIVE'
           AND (
             live_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
             OR EXISTS (
               SELECT 1 FROM user_roles live_role
                WHERE live_role.user_id = live_actor.id
                  AND live_role.role IN ('OWNER', 'ADMINISTRATOR')
             )
           )
      )`,
      bindings: [actor.id] as unknown[],
    };
  }

  return {
    sql: `EXISTS (
      SELECT 1
        FROM users live_actor
        JOIN team_memberships live_membership
          ON live_membership.user_id = live_actor.id
        JOIN teams live_team ON live_team.id = live_membership.team_id
       WHERE live_actor.id = ?
         AND live_actor.status = 'ACTIVE'
         AND live_membership.team_id = ${chapterAlias}.team_id
         AND live_membership.status = 'ACTIVE'
         AND UPPER(live_membership.membership_role) IN
           ('OWNER', 'LEADER', 'UPLOADER')
         AND live_team.is_archived = 0
         AND live_team.verification_status = 'VERIFIED'
         ${
           input.requirePublish
             ? `AND UPPER(live_membership.membership_role) IN
                  ('OWNER', 'LEADER')`
             : ""
         }
    )`,
    bindings: [actor.id] as unknown[],
  };
}

type ManagementMembershipRole =
  | "OWNER"
  | "LEADER"
  | "UPLOADER";

export async function requireChapterManagementScope(
  actor: Actor,
  seriesId: string,
  chapterId: string,
): Promise<ChapterManagementScope> {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Chapter management is temporarily unavailable.",
    );
  }
  const administrator = isChapterAdministrator(actor);
  if (administrator) {
    const authorization = chapterManagementAuthorizationClause(actor, {
      chapterAlias: "c",
    });
    const chapter = await env.DB.prepare(
      `SELECT c.id, c.team_id AS teamId
         FROM chapters c
        WHERE c.id = ?
          AND c.series_id = ?
          AND ${authorization.sql}
        LIMIT 1`,
    )
      .bind(chapterId, seriesId, ...authorization.bindings)
      .first<{ id: string; teamId: string | null }>();
    if (!chapter) {
      throw new ApiError(
        404,
        "CHAPTER_NOT_FOUND",
        "This chapter management route is no longer available.",
      );
    }
    return {
      actorId: actor.id,
      actorRole: actor.primaryRole,
      seriesId,
      chapterId,
      teamId: chapter.teamId,
      administrator: true,
      canEditMetadata: true,
      canManagePages: true,
      canPublish: true,
      canManageCommerce: true,
      allowedLanguages: [],
    };
  }

  const membership = await env.DB.prepare(
    `SELECT c.team_id AS teamId,
            UPPER(tm.membership_role) AS membershipRole
       FROM chapters c
       JOIN teams t
         ON t.id = c.team_id
       JOIN team_memberships tm
         ON tm.team_id = c.team_id
        AND tm.user_id = ?
       JOIN users live_actor
         ON live_actor.id = tm.user_id
      WHERE c.id = ?
        AND c.series_id = ?
        AND c.team_id IS NOT NULL
        AND tm.status = 'ACTIVE'
        AND live_actor.status = 'ACTIVE'
        AND UPPER(tm.membership_role) IN
          ('OWNER', 'LEADER', 'UPLOADER')
        AND t.is_archived = 0
        AND t.verification_status = 'VERIFIED'
      LIMIT 1`,
  )
    .bind(actor.id, chapterId, seriesId)
    .first<{
      teamId: string;
      membershipRole: ManagementMembershipRole;
    }>();
  if (!membership) {
    throw new ApiError(
      403,
      "CHAPTER_MANAGEMENT_FORBIDDEN",
      "Your active team does not own this release or no longer has upload rights.",
    );
  }

  const leader = ["OWNER", "LEADER"].includes(membership.membershipRole);
  return {
    actorId: actor.id,
    actorRole: actor.primaryRole,
    seriesId,
    chapterId,
    teamId: membership.teamId,
    administrator: false,
    canEditMetadata: true,
    canManagePages: true,
    canPublish: leader,
    canManageCommerce: false,
    allowedLanguages: [],
  };
}
