import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  assertSameOrigin,
  auditStatement,
  deleteMediaObject,
  requestIdFor,
  safeFilename,
  sha256Hex,
  validateImageFile,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  chapterManagementAuthorizationClause,
  requireChapterManagementScope,
} from "@/lib/server/chapter-management";
import { requireActor, type Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

const identifierSchema = z.string().trim().min(3).max(120);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const deleteSchema = z.object({
  seriesId: identifierSchema,
  chapterId: identifierSchema,
  pageId: identifierSchema,
  expectedRevision: z.number().int().min(1),
  reason: z.string().trim().min(6).max(500),
});

type StoredPage = {
  id: string;
  chapterId: string;
  seriesId: string;
  objectKey: string;
  pageIndex: number;
  state: string;
  revision: number;
};

async function storedPage(pageId: string) {
  return env.DB!.prepare(
    `SELECT cp.id,
            cp.chapter_id AS chapterId,
            c.series_id AS seriesId,
            cp.object_key AS objectKey,
            cp.page_index AS pageIndex,
            c.state,
            c.revision
       FROM chapter_pages cp
       JOIN chapters c ON c.id = cp.chapter_id
      WHERE cp.id = ?
      LIMIT 1`,
  )
    .bind(pageId)
    .first<StoredPage>();
}

async function assertPageMutationRateLimit(actor: Actor) {
  const recent = await env.DB!.prepare(
    `SELECT COUNT(*) AS count
       FROM audit_logs
      WHERE actor_user_id = ?
        AND action LIKE 'chapter.page.%'
        AND created_at >= datetime('now', '-1 minute')`,
  )
    .bind(actor.id)
    .first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 30) {
    throw new ApiError(
      429,
      "PAGE_MUTATION_RATE_LIMITED",
      "Too many chapter page changes were made at once. Wait a minute and retry.",
    );
  }
}

async function cleanupIfUnreferenced(
  objectKey: string,
  chapterId: string,
  reason: string,
) {
  if (!env.DB || !env.BUCKET) return;
  const referenced = await env.DB.prepare(
    "SELECT 1 AS found FROM chapter_pages WHERE object_key = ? LIMIT 1",
  )
    .bind(objectKey)
    .first()
    .catch(() => null);
  if (referenced) return;
  await deleteMediaObject(env.DB, env.BUCKET, objectKey, {
    mediaKind: "CHAPTER_PAGE",
    targetType: "CHAPTER",
    targetId: chapterId,
    reason,
  });
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Chapter page previews are temporarily unavailable.",
      );
    }
    const pageId = identifierSchema.parse(
      new URL(request.url).searchParams.get("pageId"),
    );
    const page = await storedPage(pageId);
    if (!page) {
      throw new ApiError(404, "PAGE_NOT_FOUND", "This chapter page was not found.");
    }
    const actor = await requireActor();
    await requireChapterManagementScope(
      actor,
      page.seriesId,
      page.chapterId,
    );
    const object = await env.BUCKET.get(page.objectKey);
    if (!object) {
      throw new ApiError(404, "PAGE_NOT_FOUND", "This chapter page is unavailable.");
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", "inline");
    headers.set("cache-control", "private, no-store");
    headers.set("vary", "cookie");
    headers.set("x-content-type-options", "nosniff");
    headers.set("etag", object.httpEtag);
    if (request.headers.get("if-none-match") === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  let newObjectKey = "";
  let chapterForCleanup = "";
  try {
    assertSameOrigin(request);
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Chapter page storage is temporarily unavailable.",
      );
    }
    const actor = await requireActor();
    await assertPageMutationRateLimit(actor);
    const form = await request.formData();
    const action = z.enum(["ADD", "REPLACE"]).parse(form.get("action"));
    const seriesId = identifierSchema.parse(form.get("seriesId"));
    const chapterId = identifierSchema.parse(form.get("chapterId"));
    const expectedRevision = z.coerce
      .number()
      .int()
      .min(1)
      .parse(form.get("expectedRevision"));
    const reason = z.string().trim().min(6).max(500).parse(form.get("reason"));
    const targetPageId =
      action === "REPLACE"
        ? identifierSchema.parse(form.get("targetPageId"))
        : null;
    const candidate = form.get("file");
    if (!(candidate instanceof File)) {
      throw new ApiError(
        422,
        "PAGE_FILE_REQUIRED",
        "Choose a JPEG, PNG, or WebP chapter page.",
      );
    }
    const originalName = candidate.name.normalize("NFKC");
    const leafName = safeFilename(originalName);
    if (
      originalName.startsWith(".") ||
      originalName.includes("/") ||
      originalName.includes("\\") ||
      ["thumbs.db", "desktop.ini", ".ds_store"].includes(
        originalName.toLowerCase(),
      )
    ) {
      throw new ApiError(
        422,
        "PAGE_FILENAME_UNSAFE",
        "Hidden, system, and path-based filenames are not accepted.",
      );
    }
    const scope = await requireChapterManagementScope(
      actor,
      seriesId,
      chapterId,
    );
    if (!scope.canManagePages) {
      throw new ApiError(
        403,
        "PAGE_MANAGEMENT_FORBIDDEN",
        "You cannot change pages for this release.",
      );
    }
    const chapter = await env.DB.prepare(
      `SELECT revision, state
         FROM chapters
        WHERE id = ?
          AND series_id = ?
        LIMIT 1`,
    )
      .bind(chapterId, seriesId)
      .first<{ revision: number; state: string }>();
    if (!chapter || Number(chapter.revision) !== expectedRevision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This release changed in another session. Reload before changing pages.",
      );
    }
    const target = targetPageId ? await storedPage(targetPageId) : null;
    if (
      action === "REPLACE" &&
      (!target ||
        target.chapterId !== chapterId ||
        target.seriesId !== seriesId)
    ) {
      throw new ApiError(
        404,
        "PAGE_NOT_FOUND",
        "The page selected for replacement no longer exists.",
      );
    }

    const validated = await validateImageFile(candidate, {
      label: "chapter page",
      maxBytes: 25 * 1024 * 1024,
      minWidth: 64,
      minHeight: 64,
      maxWidth: 20_000,
      maxHeight: 40_000,
      maxPixels: 80_000_000,
      allowAnimation: false,
      allowedTypes: imageTypes,
    });
    const sha256 = await sha256Hex(validated.bytes);
    const duplicate = await env.DB.prepare(
      `SELECT id
         FROM chapter_pages
        WHERE chapter_id = ?
          AND sha256 = ?
          AND (? IS NULL OR id <> ?)
        LIMIT 1`,
    )
      .bind(chapterId, sha256, targetPageId, targetPageId)
      .first();
    if (duplicate) {
      throw new ApiError(
        409,
        "DUPLICATE_PAGE",
        "This exact image already exists in the chapter.",
      );
    }
    const extension =
      validated.contentType === "image/jpeg"
        ? "jpg"
        : validated.contentType === "image/png"
          ? "png"
          : "webp";
    newObjectKey =
      `private/chapter-pages/${encodeURIComponent(chapterId)}/${randomId()}.${extension}`;
    chapterForCleanup = chapterId;
    await env.BUCKET.put(newObjectKey, validated.bytes, {
      httpMetadata: { contentType: validated.contentType },
      customMetadata: {
        actorId: actor.id,
        chapterId,
        originalFilename: leafName,
        sha256,
      },
    });

    const pageId = target?.id ?? randomId();
    const pageIndex =
      target?.pageIndex ??
      Number(
        (
          await env.DB.prepare(
            `SELECT COALESCE(MAX(page_index), -1) + 1 AS nextIndex
               FROM chapter_pages
              WHERE chapter_id = ?`,
          )
            .bind(chapterId)
            .first<{ nextIndex: number }>()
        )?.nextIndex ?? 0,
      );
    const authorization = chapterManagementAuthorizationClause(actor, {
      chapterAlias: "authorized_chapter",
    });
    const pageMutation =
      action === "ADD"
        ? env.DB.prepare(
            `INSERT INTO chapter_pages
             (id, chapter_id, page_index, object_key, width, height, sha256,
              processing_status)
             SELECT ?, ?, ?, ?, ?, ?, ?, 'READY'
              WHERE EXISTS (
                SELECT 1 FROM chapters authorized_chapter
                 WHERE authorized_chapter.id = ?
                   AND authorized_chapter.series_id = ?
                   AND authorized_chapter.revision = ?
                   AND ${authorization.sql}
              )`,
          ).bind(
            pageId,
            chapterId,
            pageIndex,
            newObjectKey,
            validated.dimensions.width,
            validated.dimensions.height,
            sha256,
            chapterId,
            seriesId,
            expectedRevision,
            ...authorization.bindings,
          )
        : env.DB.prepare(
            `UPDATE chapter_pages
                SET object_key = ?,
                    width = ?,
                    height = ?,
                    sha256 = ?,
                    processing_status = 'READY'
              WHERE id = ?
                AND chapter_id = ?
                AND EXISTS (
                  SELECT 1 FROM chapters authorized_chapter
                   WHERE authorized_chapter.id = ?
                     AND authorized_chapter.series_id = ?
                     AND authorized_chapter.revision = ?
                     AND ${authorization.sql}
                )`,
          ).bind(
            newObjectKey,
            validated.dimensions.width,
            validated.dimensions.height,
            sha256,
            pageId,
            chapterId,
            chapterId,
            seriesId,
            expectedRevision,
            ...authorization.bindings,
          );
    const updateChapter = env.DB.prepare(
      `UPDATE chapters
          SET page_count = (
                SELECT COUNT(*) FROM chapter_pages WHERE chapter_id = ?
              ),
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND series_id = ?
          AND revision = ?
          AND changes() = 1`,
    ).bind(chapterId, chapterId, seriesId, expectedRevision);
    const results = await env.DB.batch([
      pageMutation,
      updateChapter,
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action:
            action === "ADD" ? "chapter.page.add" : "chapter.page.replace",
          category: "SERIES_CHAPTERS",
          sourceArea: scope.administrator
            ? "ADMIN_CHAPTER_MANAGEMENT"
            : "TEAM_CHAPTER_MANAGEMENT",
          targetType: "CHAPTER_PAGE",
          targetId: pageId,
          targetLabel: leafName,
          reason,
          oldValue: target
            ? { objectKey: target.objectKey, pageIndex: target.pageIndex }
            : null,
          newValue: {
            chapterId,
            pageIndex,
            sha256,
            width: validated.dimensions.width,
            height: validated.dimensions.height,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This release changed in another session. Reload before changing pages.",
      );
    }
    if (target?.objectKey) {
      await deleteMediaObject(env.DB, env.BUCKET, target.objectKey, {
        mediaKind: "CHAPTER_PAGE",
        targetType: "CHAPTER",
        targetId: chapterId,
        reason: "Replaced chapter page",
      });
    }
    return json(
      requestId,
      {
        ok: true,
        data: {
          pageId,
          pageIndex,
          revision: expectedRevision + 1,
        },
      },
      { status: action === "ADD" ? 201 : 200 },
    );
  } catch (error) {
    if (newObjectKey && chapterForCleanup) {
      await cleanupIfUnreferenced(
        newObjectKey,
        chapterForCleanup,
        "Uncommitted chapter page mutation",
      ).catch(() => undefined);
    }
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Chapter page storage is temporarily unavailable.",
      );
    }
    const actor = await requireActor();
    await assertPageMutationRateLimit(actor);
    const payload = deleteSchema.parse(await request.json());
    const scope = await requireChapterManagementScope(
      actor,
      payload.seriesId,
      payload.chapterId,
    );
    if (!scope.canManagePages) {
      throw new ApiError(
        403,
        "PAGE_MANAGEMENT_FORBIDDEN",
        "You cannot change pages for this release.",
      );
    }
    const target = await storedPage(payload.pageId);
    if (
      !target ||
      target.chapterId !== payload.chapterId ||
      target.seriesId !== payload.seriesId
    ) {
      throw new ApiError(
        404,
        "PAGE_NOT_FOUND",
        "The selected page no longer exists.",
      );
    }
    if (Number(target.revision) !== payload.expectedRevision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This release changed in another session. Reload before removing pages.",
      );
    }
    const remaining = await env.DB.prepare(
      `SELECT id
         FROM chapter_pages
        WHERE chapter_id = ?
          AND id <> ?
        ORDER BY page_index`,
    )
      .bind(payload.chapterId, payload.pageId)
      .all<{ id: string }>();
    if (target.state === "PUBLISHED" && remaining.results.length === 0) {
      throw new ApiError(
        409,
        "PUBLISHED_PAGE_REQUIRED",
        "A published chapter must retain at least one verified page.",
      );
    }
    const authorization = chapterManagementAuthorizationClause(actor, {
      chapterAlias: "authorized_chapter",
    });
    const guard = `EXISTS (
      SELECT 1
        FROM chapters authorized_chapter
       WHERE authorized_chapter.id = ?
         AND authorized_chapter.revision = ?
         AND ${authorization.sql}
    )`;
    const deletePage = env.DB.prepare(
      `DELETE FROM chapter_pages
        WHERE id = ?
          AND chapter_id = ?
          AND ${guard}`,
    ).bind(
      payload.pageId,
      payload.chapterId,
      payload.chapterId,
      payload.expectedRevision,
      ...authorization.bindings,
    );
    const shift = env.DB.prepare(
      `UPDATE chapter_pages
          SET page_index = page_index + 100000
        WHERE chapter_id = ?
          AND ${guard}
          AND NOT EXISTS (
            SELECT 1 FROM chapter_pages WHERE id = ?
          )`,
    ).bind(
      payload.chapterId,
      payload.chapterId,
      payload.expectedRevision,
      ...authorization.bindings,
      payload.pageId,
    );
    const reorder = remaining.results.map((page, pageIndex) =>
      env.DB!.prepare(
        `UPDATE chapter_pages
            SET page_index = ?
          WHERE id = ?
            AND chapter_id = ?
            AND ${guard}
            AND NOT EXISTS (
              SELECT 1 FROM chapter_pages WHERE id = ?
            )`,
      ).bind(
        pageIndex,
        page.id,
        payload.chapterId,
        payload.chapterId,
        payload.expectedRevision,
        ...authorization.bindings,
        payload.pageId,
      ),
    );
    const updateChapter = env.DB.prepare(
      `UPDATE chapters
          SET page_count = (
                SELECT COUNT(*) FROM chapter_pages WHERE chapter_id = ?
              ),
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND series_id = ?
          AND revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM chapter_pages WHERE id = ?
          )`,
    ).bind(
      payload.chapterId,
      payload.chapterId,
      payload.seriesId,
      payload.expectedRevision,
      payload.pageId,
    );
    const results = await env.DB.batch([
      deletePage,
      shift,
      ...reorder,
      updateChapter,
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: "chapter.page.remove",
          category: "SERIES_CHAPTERS",
          sourceArea: scope.administrator
            ? "ADMIN_CHAPTER_MANAGEMENT"
            : "TEAM_CHAPTER_MANAGEMENT",
          targetType: "CHAPTER_PAGE",
          targetId: payload.pageId,
          reason: payload.reason,
          oldValue: {
            chapterId: payload.chapterId,
            pageIndex: target.pageIndex,
            objectKey: target.objectKey,
          },
          newValue: null,
        },
        "changes() = 1",
      ),
    ]);
    const updateResult = results[2 + reorder.length];
    if (!results[0]?.meta.changes || !updateResult?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "This release changed in another session. Reload before removing pages.",
      );
    }
    await deleteMediaObject(env.DB, env.BUCKET, target.objectKey, {
      mediaKind: "CHAPTER_PAGE",
      targetType: "CHAPTER",
      targetId: payload.chapterId,
      reason: "Removed chapter page",
    });
    return json(requestId, {
      ok: true,
      data: {
        pageId: payload.pageId,
        revision: payload.expectedRevision + 1,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
