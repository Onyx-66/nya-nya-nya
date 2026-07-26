import { env } from "cloudflare:workers";
import { normalizeChapterNumber } from "@/lib/chapter-number";
import { canAny } from "@/lib/permissions.mjs";
import { ApiError } from "@/lib/server/api";
import type { Actor } from "@/lib/server/policy";

export type ChapterAccessType = "FREE" | "PAID";

export type ChapterAccessDecision = {
  chapterId: string;
  teamId: string | null;
  seriesSlug: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterLabel: string;
  language: string;
  version: number;
  teamName: string | null;
  accessType: ChapterAccessType;
  priceOnyx: number;
  publishedAt: string | null;
  canRead: boolean;
  isUnlocked: boolean;
  administratorPreview: boolean;
  reason:
    | "FREE"
    | "UNLOCKED"
    | "ADMINISTRATOR_PREVIEW"
    | "SIGN_IN_REQUIRED"
    | "PURCHASE_REQUIRED"
    | "UNAVAILABLE";
};

function decisionBase(chapter: ChapterAccessRecord) {
  const chapterNumber = normalizeChapterNumber(chapter.chapterNumber);
  return {
    chapterId: chapter.id,
    teamId: chapter.teamId,
    seriesSlug: chapter.seriesSlug,
    chapterSlug: chapter.chapterSlug,
    chapterNumber,
    chapterLabel: chapter.chapterLabel.replace(
      /^Chapter\s+\S+/,
      `Chapter ${chapterNumber}`,
    ),
    language: chapter.language,
    version: chapter.version,
    teamName: chapter.teamName,
    accessType: chapter.accessType,
    priceOnyx: chapter.priceOnyx,
    publishedAt: chapter.publishedAt,
  };
}

export type ChapterAccessRecord = {
  id: string;
  teamId: string | null;
  seriesSlug: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterLabel: string;
  language: string;
  version: number;
  teamName: string | null;
  accessType: ChapterAccessType;
  priceOnyx: number;
  publishedAt: string | null;
  state: string;
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  seriesPublished: boolean;
  seriesArchivedAt: string | null;
  rightsStatus: string;
  teamPreviewAllowed: boolean;
};

function publishedAtOrBeforeNow(value: string | null) {
  if (!value) return false;
  const normalized =
    value.includes("T") || /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ? value
      : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

async function databaseChapterRecord(
  seriesSlug: string,
  chapterSlug: string,
): Promise<ChapterAccessRecord | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT c.id,
            c.team_id AS teamId,
            s.slug AS seriesSlug,
            c.slug AS chapterSlug,
            c.chapter_number AS chapterNumber,
            CASE
              WHEN c.title = '' THEN 'Chapter ' || c.chapter_number
              ELSE 'Chapter ' || c.chapter_number || ' · ' || c.title
            END AS chapterLabel,
            c.language,
            c.version,
            t.name AS teamName,
            c.access_type AS accessType,
            c.price_onyx AS priceOnyx,
            c.published_at AS publishedAt,
            c.state,
            c.visibility,
            s.is_published AS seriesPublished,
            s.archived_at AS seriesArchivedAt,
            s.rights_status AS rightsStatus,
            EXISTS (
              SELECT 1
                FROM series_team_assignments sta
                JOIN teams preview_team ON preview_team.id = sta.team_id
               WHERE sta.series_id = c.series_id
                 AND sta.team_id = c.team_id
                 AND sta.can_upload = 1
                 AND sta.revoked_at IS NULL
                 AND preview_team.is_archived = 0
                 AND preview_team.verification_status <> 'SUSPENDED'
            ) AS teamPreviewAllowed
       FROM chapters c
       JOIN series s ON s.id = c.series_id
       LEFT JOIN teams t ON t.id = c.team_id
      WHERE s.slug = ? AND c.slug = ?
      LIMIT 1`,
  )
    .bind(seriesSlug, chapterSlug)
    .first<{
      id: string;
      teamId: string | null;
      seriesSlug: string;
      chapterSlug: string;
      chapterNumber: string;
      chapterLabel: string;
      language: string;
      version: number;
      teamName: string | null;
      accessType: ChapterAccessType;
      priceOnyx: number;
      publishedAt: string | null;
      state: string;
      visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
      seriesPublished: number;
      seriesArchivedAt: string | null;
      rightsStatus: string;
      teamPreviewAllowed: number;
    }>();
  if (!row) return null;
  return {
    ...row,
    priceOnyx: Number(row.priceOnyx),
    seriesPublished: Boolean(row.seriesPublished),
    teamPreviewAllowed: Boolean(row.teamPreviewAllowed),
  };
}

export function decideChapterAccess(
  chapter: ChapterAccessRecord,
  actor: Actor | null,
  isUnlocked: boolean,
): ChapterAccessDecision {
  const rightsBlocked =
    Boolean(chapter.seriesArchivedAt) ||
    !["LICENSED", "AUTHORIZED", "DEMO_ORIGINAL", "TEST_ORIGINAL"].includes(
      chapter.rightsStatus,
    );
  if (rightsBlocked) {
    return {
      ...decisionBase(chapter),
      canRead: false,
      isUnlocked: false,
      administratorPreview: false,
      reason: "UNAVAILABLE",
    };
  }
  const actorRoles = actor?.roles?.length
    ? actor.roles
    : actor
      ? [actor.primaryRole]
      : [];
  const administratorPreview = actorRoles.some((role) =>
    ["OWNER", "ADMINISTRATOR"].includes(role),
  );
  const assignedTeamPreview = Boolean(
    chapter.teamId &&
      chapter.teamPreviewAllowed &&
      actor?.teamIds.includes(chapter.teamId) &&
      canAny(actorRoles, "chapter.preview.assigned"),
  );
  const privilegedPreview = administratorPreview || assignedTeamPreview;
  const publicationReady =
    chapter.seriesPublished &&
    chapter.state === "PUBLISHED" &&
    chapter.visibility !== "HIDDEN" &&
    publishedAtOrBeforeNow(chapter.publishedAt);
  if (!publicationReady && !privilegedPreview) {
    return {
      ...decisionBase(chapter),
      canRead: false,
      isUnlocked: false,
      administratorPreview: false,
      reason: "UNAVAILABLE",
    };
  }
  if (privilegedPreview) {
    return {
      ...decisionBase(chapter),
      canRead: true,
      isUnlocked: false,
      administratorPreview,
      reason: "ADMINISTRATOR_PREVIEW",
    };
  }
  if (chapter.accessType === "FREE") {
    return {
      ...decisionBase(chapter),
      canRead: true,
      isUnlocked: false,
      administratorPreview: false,
      reason: "FREE",
    };
  }
  if (isUnlocked) {
    return {
      ...decisionBase(chapter),
      canRead: true,
      isUnlocked: true,
      administratorPreview: false,
      reason: "UNLOCKED",
    };
  }
  if (!actor) {
    return {
      ...decisionBase(chapter),
      canRead: false,
      isUnlocked: false,
      administratorPreview: false,
      reason: "SIGN_IN_REQUIRED",
    };
  }
  return {
    ...decisionBase(chapter),
    canRead: false,
    isUnlocked: false,
    administratorPreview: false,
    reason: "PURCHASE_REQUIRED",
  };
}

export async function getChapterRecord(
  seriesSlug: string,
  chapterSlug: string,
) {
  return databaseChapterRecord(seriesSlug, chapterSlug);
}

export async function resolveChapterAccess(
  actor: Actor | null,
  seriesSlug: string,
  chapterSlug: string,
): Promise<ChapterAccessDecision> {
  const chapter = await getChapterRecord(seriesSlug, chapterSlug);
  if (!chapter) {
    throw new ApiError(
      404,
      "CHAPTER_NOT_FOUND",
      "This chapter is not available.",
    );
  }

  const initial = decideChapterAccess(chapter, actor, false);
  if (initial.reason !== "PURCHASE_REQUIRED" || !actor || !env.DB) {
    return initial;
  }
  let isUnlocked = false;
  if (actor) {
    const entitlement = await env.DB.prepare(
      `SELECT id
         FROM entitlements
        WHERE user_id = ?
          AND chapter_id = ?
          AND revoked_at IS NULL
          AND starts_at <= CURRENT_TIMESTAMP
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT 1`,
    )
      .bind(actor.id, chapter.id)
      .first();
    isUnlocked = Boolean(entitlement);
  }
  return decideChapterAccess(chapter, actor, isUnlocked);
}

export async function requireReadableChapter(
  actor: Actor,
  chapterId: string,
) {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Chapter access storage is unavailable.",
    );
  }
  const chapter = await env.DB.prepare(
    `SELECT s.slug AS seriesSlug, c.slug AS chapterSlug
       FROM chapters c
       JOIN series s ON s.id = c.series_id
      WHERE c.id = ?
      LIMIT 1`,
  )
    .bind(chapterId)
    .first<{ seriesSlug: string; chapterSlug: string }>();
  if (!chapter) {
    throw new ApiError(
      404,
      "CHAPTER_NOT_FOUND",
      "This chapter is not available.",
    );
  }
  const decision = await resolveChapterAccess(
    actor,
    chapter.seriesSlug,
    chapter.chapterSlug,
  );
  if (!decision.canRead) {
    throw new ApiError(
      403,
      "CHAPTER_LOCKED",
      "Unlock this chapter before saving reader activity.",
    );
  }
  return decision;
}
