import { env } from "cloudflare:workers";
import { z } from "zod";
import { normalizeChapterNumber } from "@/lib/chapter-number";
import {
  assertSameOrigin,
  auditStatement,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  chapterManagementAuthorizationClause,
  requireChapterManagementScope,
} from "@/lib/server/chapter-management";
import { requireActor } from "@/lib/server/policy";

const identifierSchema = z.string().trim().min(3).max(120);
const creditsSchema = z.object({
  translator: z.string().trim().max(120).default(""),
  cleaner: z.string().trim().max(120).default(""),
  redrawer: z.string().trim().max(120).default(""),
  typesetter: z.string().trim().max(120).default(""),
  proofreader: z.string().trim().max(120).default(""),
  qualityControl: z.string().trim().max(120).default(""),
});
const updateSchema = z
  .object({
    seriesId: identifierSchema,
    chapterId: identifierSchema,
    expectedRevision: z.number().int().min(1),
    chapterNumber: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .transform(normalizeChapterNumber),
    volume: z.string().trim().max(40).default(""),
    title: z.string().trim().max(240).default(""),
    language: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/),
    version: z.number().int().min(1).max(99),
    releaseNotes: z.string().trim().max(2_000).default(""),
    credits: creditsSchema.default({
      translator: "",
      cleaner: "",
      redrawer: "",
      typesetter: "",
      proofreader: "",
      qualityControl: "",
    }),
    state: z.enum(["DRAFT", "READY_FOR_REVIEW", "PUBLISHED"]),
    visibility: z.enum(["PUBLIC", "UNLISTED", "HIDDEN"]),
    publishedAt: z.string().datetime().nullable(),
    accessType: z.enum(["FREE", "PAID"]),
    priceOnyx: z.number().int().min(0).max(100_000),
    commentsEnabled: z.boolean(),
    pageOrder: z.array(identifierSchema).max(500),
    reason: z.string().trim().min(6).max(500),
  })
  .superRefine((value, context) => {
    if (value.accessType === "PAID" && value.priceOnyx < 1) {
      context.addIssue({
        code: "custom",
        path: ["priceOnyx"],
        message: "Paid chapters need a premium coin price of at least 1.",
      });
    }
    if (value.accessType === "FREE" && value.priceOnyx !== 0) {
      context.addIssue({
        code: "custom",
        path: ["priceOnyx"],
        message: "Free chapters cannot have a premium coin price.",
      });
    }
  });

type ChapterRow = {
  id: string;
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  teamId: string | null;
  teamName: string | null;
  slug: string;
  chapterNumber: string;
  volume: string | null;
  title: string;
  language: string;
  format: string;
  version: number;
  releaseNotes: string;
  creditsJson: string;
  state: "DRAFT" | "READY_FOR_REVIEW" | "PUBLISHED";
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  commentsEnabled: number;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  pageCount: number;
  publishedAt: string | null;
  revision: number;
  rightsStatus: string;
  seriesPublished: number;
};

function parsedCredits(value: string) {
  try {
    return creditsSchema.parse(JSON.parse(value));
  } catch {
    return creditsSchema.parse({});
  }
}

async function loadChapter(chapterId: string, seriesId: string) {
  return env.DB!.prepare(
    `SELECT c.id,
            c.series_id AS seriesId,
            s.slug AS seriesSlug,
            s.title AS seriesTitle,
            c.team_id AS teamId,
            t.name AS teamName,
            c.slug,
            c.chapter_number AS chapterNumber,
            c.volume,
            c.title,
            c.language,
            c.format,
            c.version,
            c.release_notes AS releaseNotes,
            c.credits_json AS creditsJson,
            c.state,
            c.visibility,
            c.comments_enabled AS commentsEnabled,
            c.access_type AS accessType,
            c.price_onyx AS priceOnyx,
            c.page_count AS pageCount,
            c.published_at AS publishedAt,
            c.revision,
            s.rights_status AS rightsStatus,
            s.is_published AS seriesPublished
       FROM chapters c
       JOIN series s ON s.id = c.series_id
       LEFT JOIN teams t ON t.id = c.team_id
      WHERE c.id = ?
        AND c.series_id = ?
      LIMIT 1`,
  )
    .bind(chapterId, seriesId)
    .first<ChapterRow>();
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Chapter management is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const seriesId = identifierSchema.parse(url.searchParams.get("seriesId"));
    const chapterId = identifierSchema.parse(url.searchParams.get("chapterId"));
    const actor = await requireActor();
    const scope = await requireChapterManagementScope(
      actor,
      seriesId,
      chapterId,
    );
    const [chapter, pageResult] = await Promise.all([
      loadChapter(chapterId, seriesId),
      env.DB.prepare(
        `SELECT id,
                page_index AS pageIndex,
                width,
                height,
                sha256,
                processing_status AS processingStatus
           FROM chapter_pages
          WHERE chapter_id = ?
          ORDER BY page_index`,
      )
        .bind(chapterId)
        .all<{
          id: string;
          pageIndex: number;
          width: number;
          height: number;
          sha256: string;
          processingStatus: string;
        }>(),
    ]);
    if (!chapter) {
      throw new ApiError(
        404,
        "CHAPTER_NOT_FOUND",
        "This chapter management route is no longer available.",
      );
    }
    return json(
      requestId,
      {
        data: {
          ...chapter,
          chapterNumber: normalizeChapterNumber(chapter.chapterNumber),
          commentsEnabled: Boolean(chapter.commentsEnabled),
          seriesPublished: Boolean(chapter.seriesPublished),
          credits: parsedCredits(chapter.creditsJson),
          creditsJson: undefined,
          pages: pageResult.results.map((page) => ({
            ...page,
            previewUrl:
              `/api/v1/chapter-management-page?pageId=${encodeURIComponent(page.id)}`,
          })),
          permissions: {
            administrator: scope.administrator,
            canEditMetadata: scope.canEditMetadata,
            canManagePages: scope.canManagePages,
            canPublish: scope.canPublish,
            canManageCommerce: scope.canManageCommerce,
          },
        },
      },
      {
        headers: {
          "cache-control": "private, no-store",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Chapter management is temporarily unavailable.",
      );
    }
    const actor = await requireActor();
    const payload = updateSchema.parse(await request.json());
    const scope = await requireChapterManagementScope(
      actor,
      payload.seriesId,
      payload.chapterId,
    );
    const current = await loadChapter(payload.chapterId, payload.seriesId);
    if (!current) {
      throw new ApiError(
        404,
        "CHAPTER_NOT_FOUND",
        "This chapter management route is no longer available.",
      );
    }
    if (Number(current.revision) !== payload.expectedRevision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This release changed in another session. Reload before saving.",
      );
    }

    if (!scope.canManageCommerce) {
      if (
        payload.accessType !== current.accessType ||
        payload.priceOnyx !== Number(current.priceOnyx)
      ) {
        throw new ApiError(
          403,
          "CHAPTER_COMMERCE_FORBIDDEN",
          "Only an administrator can change paid access or the premium coin price.",
        );
      }
    }
    if (
      !scope.administrator &&
      scope.allowedLanguages.length > 0 &&
      !scope.allowedLanguages.includes("*") &&
      !scope.allowedLanguages.includes(payload.language)
    ) {
      throw new ApiError(
        403,
        "RELEASE_LANGUAGE_NOT_ALLOWED",
        `Your team is not authorized to manage ${payload.language} releases for this series.`,
      );
    }
    const requiresPublishAuthority =
      payload.visibility !== current.visibility ||
      payload.publishedAt !== current.publishedAt ||
      (payload.state !== current.state &&
        (payload.state === "PUBLISHED" || current.state === "PUBLISHED"));
    if (!scope.canPublish) {
      if (
        payload.visibility !== current.visibility ||
        payload.publishedAt !== current.publishedAt ||
        (current.state === "PUBLISHED" && payload.state !== current.state) ||
        (current.state !== "PUBLISHED" &&
          !["DRAFT", "READY_FOR_REVIEW"].includes(payload.state))
      ) {
        throw new ApiError(
          403,
          "CHAPTER_PUBLISH_FORBIDDEN",
          "Your current team role can edit this release but cannot publish, hide, or schedule it.",
        );
      }
    }
    if (
      (payload.state === "PUBLISHED" && !payload.publishedAt) ||
      (payload.state !== "PUBLISHED" && payload.publishedAt)
    ) {
      throw new ApiError(
        422,
        "CHAPTER_PUBLICATION_STATE_INVALID",
        payload.state === "PUBLISHED"
          ? "Published chapters need a release or schedule date."
          : "Only published chapters may retain a release or schedule date.",
      );
    }
    if (
      payload.state === "PUBLISHED" &&
      (Number(current.pageCount) < 1 ||
        !Boolean(current.seriesPublished) ||
        !["LICENSED", "AUTHORIZED", "DEMO_ORIGINAL", "TEST_ORIGINAL"].includes(
          current.rightsStatus,
        ))
    ) {
      throw new ApiError(
        409,
        "CHAPTER_NOT_PUBLISHABLE",
        "A published series, approved rights, and at least one verified page are required.",
      );
    }
    const duplicate = await env.DB.prepare(
      `SELECT id
         FROM chapters
        WHERE series_id = ?
          AND id <> ?
          AND LTRIM(chapter_number, '0') = LTRIM(?, '0')
          AND language = ?
          AND COALESCE(team_id, '') = COALESCE(?, '')
          AND version = ?
          AND state IN ('DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED')
        LIMIT 1`,
    )
      .bind(
        payload.seriesId,
        payload.chapterId,
        payload.chapterNumber,
        payload.language,
        current.teamId,
        payload.version,
      )
      .first();
    if (duplicate) {
      throw new ApiError(
        409,
        "DUPLICATE_RELEASE",
        "This team already has the same chapter, language, and version.",
      );
    }

    const pages = await env.DB.prepare(
      `SELECT id
         FROM chapter_pages
        WHERE chapter_id = ?
        ORDER BY page_index`,
    )
      .bind(payload.chapterId)
      .all<{ id: string }>();
    const pageIds = new Set(pages.results.map((page) => page.id));
    if (
      payload.pageOrder.length !== pages.results.length ||
      new Set(payload.pageOrder).size !== payload.pageOrder.length ||
      payload.pageOrder.some((pageId) => !pageIds.has(pageId))
    ) {
      throw new ApiError(
        409,
        "PAGE_ORDER_CHANGED",
        "The page list changed. Reload before saving its order.",
      );
    }

    const guardAuthorization = chapterManagementAuthorizationClause(actor, {
      chapterAlias: "guard_chapter",
      requirePublish: requiresPublishAuthority,
      language: payload.language,
    });
    const guard = `EXISTS (
      SELECT 1
        FROM chapters guard_chapter
       WHERE guard_chapter.id = ?
         AND guard_chapter.revision = ?
         AND ${guardAuthorization.sql}
    )`;
    const pageStatements =
      payload.pageOrder.length > 0
        ? [
            env.DB.prepare(
              `UPDATE chapter_pages
                  SET page_index = page_index + 100000
                WHERE chapter_id = ?
                  AND ${guard}`,
            ).bind(
              payload.chapterId,
              payload.chapterId,
              payload.expectedRevision,
              ...guardAuthorization.bindings,
            ),
            ...payload.pageOrder.map((pageId, pageIndex) =>
              env.DB!.prepare(
                `UPDATE chapter_pages
                    SET page_index = ?
                  WHERE id = ?
                    AND chapter_id = ?
                    AND ${guard}`,
              ).bind(
                pageIndex,
                pageId,
                payload.chapterId,
                payload.chapterId,
                payload.expectedRevision,
                ...guardAuthorization.bindings,
              ),
            ),
          ]
        : [];
    const updateAuthorization = chapterManagementAuthorizationClause(actor, {
      chapterAlias: "chapters",
      requirePublish: requiresPublishAuthority,
      language: payload.language,
    });
    const update = env.DB.prepare(
      `UPDATE chapters
          SET chapter_number = ?,
              volume = NULLIF(?, ''),
              title = ?,
              language = ?,
              version = ?,
              release_notes = ?,
              credits_json = ?,
              state = ?,
              visibility = ?,
              published_at = ?,
              access_type = ?,
              price_onyx = ?,
              comments_enabled = ?,
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND series_id = ?
          AND revision = ?
          AND NOT EXISTS (
            SELECT 1
              FROM chapters duplicate
             WHERE duplicate.series_id = chapters.series_id
               AND duplicate.id <> chapters.id
               AND LTRIM(duplicate.chapter_number, '0') = LTRIM(?, '0')
               AND duplicate.language = ?
               AND COALESCE(duplicate.team_id, '') =
                   COALESCE(chapters.team_id, '')
               AND duplicate.version = ?
               AND duplicate.state IN
                 ('DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED')
          )
          AND ${updateAuthorization.sql}`,
    ).bind(
      payload.chapterNumber,
      payload.volume,
      payload.title,
      payload.language,
      payload.version,
      payload.releaseNotes,
      JSON.stringify(payload.credits),
      payload.state,
      payload.visibility,
      payload.publishedAt,
      payload.accessType,
      payload.accessType === "PAID" ? payload.priceOnyx : 0,
      payload.commentsEnabled ? 1 : 0,
      payload.chapterId,
      payload.seriesId,
      payload.expectedRevision,
      payload.chapterNumber,
      payload.language,
      payload.version,
      ...updateAuthorization.bindings,
    );
    const nextRevision = payload.expectedRevision + 1;
    const results = await env.DB.batch([
      ...pageStatements,
      update,
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: "chapter.management.update",
          category: "SERIES_CHAPTERS",
          sourceArea: scope.administrator
            ? "ADMIN_CHAPTER_MANAGEMENT"
            : "TEAM_CHAPTER_MANAGEMENT",
          targetType: "CHAPTER",
          targetId: payload.chapterId,
          targetLabel: `${current.seriesTitle} · Chapter ${current.chapterNumber}`,
          reason: payload.reason,
          oldValue: current,
          newValue: {
            ...payload,
            revision: nextRevision,
          },
        },
        "changes() = 1",
      ),
    ]);
    const updateResult = results[pageStatements.length];
    if (!updateResult?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This release changed in another session. Reload before saving.",
      );
    }
    return json(
      requestId,
      {
        ok: true,
        data: {
          chapterId: payload.chapterId,
          revision: nextRevision,
        },
      },
      {
        headers: {
          "cache-control": "private, no-store",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
