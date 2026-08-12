import { env } from "cloudflare:workers";
import { normalizeChapterNumber } from "@/lib/chapter-number";
import { canAny } from "@/lib/permissions.mjs";
import { ApiError } from "@/lib/server/api";
import { getFeatureStates } from "@/lib/server/feature-flags";
import { resolveActiveChapterDiscount } from "@/lib/server/content-discounts";
import type { Actor } from "@/lib/server/policy";
import {
  effectiveChapterAccessSql,
  paidContentIsPublic,
} from "@/lib/server/public-content-visibility";

export type ChapterAccessType = "FREE" | "PAID";
export type ChapterAccessLevel = ChapterAccessType | "PREMIUM";

export type ChapterAccessDecision = {
  chapterId: string;
  seriesId: string;
  teamId: string | null;
  seriesSlug: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterLabel: string;
  language: string;
  version: number;
  teamName: string | null;
  accessType: ChapterAccessType;
  accessLevel: ChapterAccessLevel;
  priceOnyx: number;
  basePriceOnyx: number;
  discountId: string | null;
  discountRevision: number | null;
  discountTargetType: "SERIES" | "CHAPTER" | null;
  discountPercentage: number | null;
  discountEndsAt: string | null;
  publishedAt: string | null;
  canRead: boolean;
  isUnlocked: boolean;
  administratorPreview: boolean;
  reason:
    | "FREE"
    | "UNLOCKED"
    | "MEMBERSHIP"
    | "ADMINISTRATOR_PREVIEW"
    | "SIGN_IN_REQUIRED"
    | "PURCHASE_REQUIRED"
    | "MEMBERSHIP_REQUIRED"
    | "UNAVAILABLE";
};

function decisionBase(chapter: ChapterAccessRecord) {
  const chapterNumber = normalizeChapterNumber(chapter.chapterNumber);
  return {
    chapterId: chapter.id,
    seriesId: chapter.seriesId,
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
    accessLevel: chapter.accessLevel,
    priceOnyx: chapter.priceOnyx,
    basePriceOnyx: chapter.basePriceOnyx ?? chapter.priceOnyx,
    discountId: chapter.discountId ?? null,
    discountRevision: chapter.discountRevision ?? null,
    discountTargetType: chapter.discountTargetType ?? null,
    discountPercentage: chapter.discountPercentage ?? null,
    discountEndsAt: chapter.discountEndsAt ?? null,
    publishedAt: chapter.publishedAt,
  };
}

export type ChapterAccessRecord = {
  id: string;
  seriesId: string;
  teamId: string | null;
  seriesSlug: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterLabel: string;
  language: string;
  version: number;
  teamName: string | null;
  seriesAccessType: ChapterAccessType;
  accessType: ChapterAccessType;
  accessLevel: ChapterAccessLevel;
  priceOnyx: number;
  basePriceOnyx?: number;
  discountId?: string | null;
  discountRevision?: number | null;
  discountTargetType?: "SERIES" | "CHAPTER" | null;
  discountPercentage?: number | null;
  discountEndsAt?: string | null;
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
            s.id AS seriesId,
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
            s.access_type AS seriesAccessType,
            CASE
              WHEN (${effectiveChapterAccessSql("c", "visibility_override")}) = 'FREE'
              THEN 'FREE' ELSE 'PAID'
            END AS accessType,
            ${effectiveChapterAccessSql("c", "visibility_override")} AS accessLevel,
            CASE
              WHEN (${effectiveChapterAccessSql("c", "visibility_override")})
                   IN ('FREE', 'PREMIUM')
              THEN 0 ELSE c.price_onyx
            END AS priceOnyx,
            c.published_at AS publishedAt,
            c.state,
            c.visibility,
            s.is_published AS seriesPublished,
            s.archived_at AS seriesArchivedAt,
            s.rights_status AS rightsStatus,
            EXISTS (
              SELECT 1
                FROM teams preview_team
               WHERE preview_team.id = c.team_id
                 AND preview_team.is_archived = 0
                 AND preview_team.verification_status = 'VERIFIED'
            ) AS teamPreviewAllowed
       FROM chapters c
       JOIN series s ON s.id = c.series_id
       LEFT JOIN teams t ON t.id = c.team_id
       LEFT JOIN content_visibility_overrides visibility_override
         ON visibility_override.chapter_id = c.id
      WHERE s.slug = ? AND c.slug = ?
      LIMIT 1`,
  )
    .bind(seriesSlug, chapterSlug)
    .first<{
      id: string;
      seriesId: string;
      teamId: string | null;
      seriesSlug: string;
      chapterSlug: string;
      chapterNumber: string;
      chapterLabel: string;
      language: string;
      version: number;
      teamName: string | null;
      seriesAccessType: ChapterAccessType;
      accessType: ChapterAccessType;
      accessLevel: ChapterAccessLevel;
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
  hasMembership = false,
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
  if (chapter.accessLevel === "FREE") {
    return {
      ...decisionBase(chapter),
      canRead: true,
      isUnlocked: false,
      administratorPreview: false,
      reason: "FREE",
    };
  }
  if (chapter.accessLevel === "PREMIUM") {
    if (hasMembership) {
      return {
        ...decisionBase(chapter),
        canRead: true,
        isUnlocked: true,
        administratorPreview: false,
        reason: "MEMBERSHIP",
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
      reason: "MEMBERSHIP_REQUIRED",
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

  let paidFeatureStates: Awaited<ReturnType<typeof getFeatureStates>> | null = null;
  if (chapter.accessLevel !== "FREE") {
    if (!env.DB || !(await paidContentIsPublic(env.DB))) {
      throw new ApiError(
        404,
        "CHAPTER_NOT_FOUND",
        "This chapter is not available.",
      );
    }
  }
  if (chapter.accessLevel !== "FREE") {
    paidFeatureStates = await getFeatureStates();
    if (!paidFeatureStates.premium_unlocks.effective) {
      throw new ApiError(
        404,
        "CHAPTER_NOT_FOUND",
        "This chapter is not available.",
      );
    }
  }

  const price =
    chapter.accessType === "PAID" && chapter.priceOnyx > 0
      ? await resolveActiveChapterDiscount(
          chapter.seriesId,
          chapter.id,
          chapter.priceOnyx,
        )
      : {
          basePriceOnyx: chapter.priceOnyx,
          priceOnyx: chapter.priceOnyx,
          discountId: null,
          discountRevision: null,
          discountTargetType: null,
          discountPercentage: null,
          discountEndsAt: null,
        };
  const pricedChapter = { ...chapter, ...price };
  const initial = decideChapterAccess(pricedChapter, actor, false);
  if (
    !["PURCHASE_REQUIRED", "MEMBERSHIP_REQUIRED"].includes(initial.reason) ||
    !actor ||
    !env.DB
  ) {
    return initial;
  }
  if (initial.reason === "MEMBERSHIP_REQUIRED") {
    paidFeatureStates ??= await getFeatureStates();
    if (!paidFeatureStates.memberships.effective) return initial;
    const membership = await env.DB.prepare(
      `SELECT membership.id FROM user_memberships membership
        WHERE membership.user_id = ?
          AND membership.status IN ('ACTIVE', 'TRIALING')
          AND (membership.current_period_end IS NULL
               OR datetime(membership.current_period_end) > datetime('now'))
          AND NOT EXISTS (
            SELECT 1 FROM payment_financial_states financial_state
             WHERE financial_state.membership_id = membership.id
               AND financial_state.membership_risk_active = 1
          )
        LIMIT 1`,
    )
      .bind(actor.id)
      .first();
    return decideChapterAccess(pricedChapter, actor, false, Boolean(membership));
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
  return decideChapterAccess(pricedChapter, actor, isUnlocked);
}

export async function requireReadableChapter(
  actor: Actor | null,
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
      "This chapter is not available to this account.",
    );
  }
  return decision;
}
