import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const progressSchema = z.object({
  chapterId: z.string().trim().min(1).max(180).optional(),
  chapterSlug: z.string().trim().min(1).max(180).optional(),
  chapterNumber: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(0).max(100_000).default(0),
  scrollOffset: z.coerce.number().int().min(0).max(100_000_000).default(0),
  progressBasisPoints: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(0),
  completedAt: z.string().datetime({ offset: true }).nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

const seriesSchema = z.object({
  seriesId: z.string().trim().min(1).max(180).optional(),
  title: z.string().trim().max(300).optional(),
  sourceUrl: z.string().trim().max(500).optional(),
  mangaDexId: z.string().trim().max(180).nullable().optional(),
  mangaUpdatesId: z.string().trim().max(180).nullable().optional(),
  libraryStatus: z
    .enum(["reading", "completed", "planning", "on_hold", "dropped"])
    .default("reading"),
  favorite: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  followedAt: z.string().datetime({ offset: true }).optional(),
  libraryUpdatedAt: z.string().datetime({ offset: true }).optional(),
  progress: z.union([progressSchema, z.array(progressSchema)]).nullable().optional(),
  rating: z.coerce.number().min(0.5).max(5).nullable().optional(),
  review: z
    .object({
      rating: z.coerce.number().int().min(1).max(10),
      body: z.string().trim().max(5_000).optional(),
      spoiler: z.boolean().optional(),
      updatedAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const importSchema = z.object({
  format: z.literal("nyascans-library-export"),
  version: z.enum(["1.0", "2.0"]),
  preferences: z
    .object({
      libraryViewMode: z.enum(["cover", "compact", "list"]).optional(),
    })
    .optional(),
  series: z.array(seriesSchema).max(5_000),
});

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Library import is temporarily unavailable.",
    );
  }
  return env.DB;
}

function sourceSlug(value?: string) {
  if (!value) return null;
  const match = value.match(/\/title\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function validImportedDateOrNull(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(time) || time > now + 86_400_000) {
    return null;
  }
  return new Date(time).toISOString();
}

async function runInChunks(
  db: D1Database,
  statements: D1PreparedStatement[],
) {
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("library.manage.own");
    const declaredBytes = Number(request.headers.get("content-length") ?? 0);
    if (declaredBytes > 5_000_000) {
      throw new ApiError(
        413,
        "LIBRARY_IMPORT_TOO_LARGE",
        "Choose a NyaScans library export smaller than 5 MB.",
      );
    }
    const payload = importSchema.parse(await request.json());
    const db = database();
    const statements: D1PreparedStatement[] = [];
    const unmatched: Array<{ title: string; reason: string }> = [];
    let matchedSeries = 0;
    let progressRows = 0;
    let reviews = 0;

    for (const entry of payload.series) {
      const slug = sourceSlug(entry.sourceUrl);
      const resolved = await db
        .prepare(
          `SELECT s.id, s.slug
             FROM series s
            WHERE (? <> '' AND s.id = ?)
               OR (? <> '' AND s.slug = ?)
               OR (
                 ? <> '' AND EXISTS (
                   SELECT 1 FROM series_external_sources source
                    WHERE source.series_id = s.id
                      AND source.source = 'MANGADEX'
                      AND source.external_id = ?
                 )
               )
               OR (
                 ? <> '' AND EXISTS (
                   SELECT 1 FROM series_external_sources source
                    WHERE source.series_id = s.id
                      AND source.source = 'MANGAUPDATES'
                      AND source.external_id = ?
                 )
               )
            ORDER BY CASE WHEN s.id = ? THEN 0 WHEN s.slug = ? THEN 1 ELSE 2 END
            LIMIT 1`,
        )
        .bind(
          entry.seriesId ?? "",
          entry.seriesId ?? "",
          slug ?? "",
          slug ?? "",
          entry.mangaDexId ?? "",
          entry.mangaDexId ?? "",
          entry.mangaUpdatesId ?? "",
          entry.mangaUpdatesId ?? "",
          entry.seriesId ?? "",
          slug ?? "",
        )
        .first<{ id: string; slug: string }>();
      if (!resolved) {
        unmatched.push({
          title: entry.title || slug || entry.seriesId || "Unknown series",
          reason: "No matching NyaScans series was found.",
        });
        continue;
      }
      matchedSeries += 1;
      const listType = entry.libraryStatus.toUpperCase();
      const followedAt =
        validImportedDateOrNull(entry.followedAt) ?? new Date().toISOString();
      const importedLibraryUpdatedAt = validImportedDateOrNull(
        entry.libraryUpdatedAt,
      );
      const authoritativeLibraryState =
        payload.version === "2.0" && Boolean(importedLibraryUpdatedAt);
      const libraryUpdatedAt = importedLibraryUpdatedAt ?? followedAt;
      statements.push(
        db
          .prepare(
            `INSERT INTO library_entries
             (user_id, series_id, list_type, is_favorite,
              notifications_enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, series_id) DO UPDATE SET
               list_type = CASE WHEN ? = 1
                 THEN excluded.list_type ELSE library_entries.list_type END,
               is_favorite = CASE WHEN ? = 1
                 THEN excluded.is_favorite ELSE library_entries.is_favorite END,
               notifications_enabled = CASE WHEN ? = 1
                 THEN excluded.notifications_enabled
                 ELSE library_entries.notifications_enabled END,
               updated_at = excluded.updated_at
             WHERE ? = 1
               AND datetime(excluded.updated_at) >=
                   datetime(library_entries.updated_at)`,
          )
          .bind(
            actor.id,
            resolved.id,
            listType,
            entry.favorite ? 1 : 0,
            entry.notificationsEnabled === false ? 0 : 1,
            followedAt,
            libraryUpdatedAt,
            authoritativeLibraryState ? 1 : 0,
            entry.favorite === undefined ? 0 : 1,
            entry.notificationsEnabled === undefined ? 0 : 1,
            authoritativeLibraryState ? 1 : 0,
          ),
      );

      const importedProgress = Array.isArray(entry.progress)
        ? entry.progress
        : entry.progress
          ? [entry.progress]
          : [];
      for (const progress of importedProgress) {
        const chapter = await db
          .prepare(
            `SELECT id
               FROM chapters
              WHERE series_id = ?
                AND (
                  (? <> '' AND id = ?)
                  OR (? <> '' AND slug = ?)
                  OR (? <> '' AND chapter_number = ?)
                )
              ORDER BY CASE WHEN id = ? THEN 0 WHEN slug = ? THEN 1 ELSE 2 END
              LIMIT 1`,
          )
          .bind(
            resolved.id,
            progress.chapterId ?? "",
            progress.chapterId ?? "",
            progress.chapterSlug ?? "",
            progress.chapterSlug ?? "",
            progress.chapterNumber ?? "",
            progress.chapterNumber ?? "",
            progress.chapterId ?? "",
            progress.chapterSlug ?? "",
          )
          .first<{ id: string }>();
        if (!chapter) continue;
        progressRows += 1;
        const importedProgressUpdatedAt = validImportedDateOrNull(
          progress.updatedAt,
        );
        const hasProgressTimestamp = Boolean(importedProgressUpdatedAt);
        const basisPoints =
          payload.version === "1.0" && progress.progressBasisPoints === 0
            ? Math.min(10_000, progress.page > 0 ? 100 : 0)
            : progress.progressBasisPoints;
        statements.push(
          db
            .prepare(
              `INSERT INTO reading_progress
               (user_id, chapter_id, page_index, scroll_offset,
                progress_basis_points, completed_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, chapter_id) DO UPDATE SET
                 page_index = MAX(
                   reading_progress.page_index, excluded.page_index
                 ),
                 scroll_offset = MAX(
                   reading_progress.scroll_offset, excluded.scroll_offset
                 ),
                 progress_basis_points = MAX(
                   reading_progress.progress_basis_points,
                   excluded.progress_basis_points
                 ),
                 completed_at = COALESCE(
                   reading_progress.completed_at,
                   excluded.completed_at
                 ),
                 updated_at = CASE
                   WHEN ? = 1 AND datetime(excluded.updated_at) >=
                     datetime(reading_progress.updated_at)
                   THEN excluded.updated_at
                   ELSE reading_progress.updated_at
                 END
               WHERE (? = 1 AND datetime(excluded.updated_at) >=
                     datetime(reading_progress.updated_at))
                  OR excluded.progress_basis_points >
                     reading_progress.progress_basis_points
                  OR excluded.page_index > reading_progress.page_index
                  OR excluded.scroll_offset > reading_progress.scroll_offset
                  OR (
                    reading_progress.completed_at IS NULL
                    AND excluded.completed_at IS NOT NULL
                  )`,
            )
            .bind(
              actor.id,
              chapter.id,
              progress.page,
              progress.scrollOffset,
              basisPoints,
              progress.completedAt ?? null,
              importedProgressUpdatedAt ?? new Date().toISOString(),
              hasProgressTimestamp ? 1 : 0,
              hasProgressTimestamp ? 1 : 0,
            ),
        );
      }

      const review =
        entry.review ??
        (entry.rating
          ? {
              rating: Math.max(1, Math.min(10, Math.round(entry.rating * 2))),
              body: undefined,
              spoiler: undefined,
              updatedAt: null,
            }
          : null);
      if (review) {
        reviews += 1;
        const importedReviewUpdatedAt = validImportedDateOrNull(
          review.updatedAt,
        );
        const authoritativeReview =
          payload.version === "2.0" && Boolean(importedReviewUpdatedAt);
        statements.push(
          db
            .prepare(
              `INSERT INTO reviews
               (id, user_id, series_id, rating, body, spoiler,
                moderation_status, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'VISIBLE', ?)
               ON CONFLICT(user_id, series_id) DO UPDATE SET
                 rating = excluded.rating,
                 body = CASE WHEN ? = 1
                   THEN excluded.body ELSE reviews.body END,
                 spoiler = CASE WHEN ? = 1
                   THEN excluded.spoiler ELSE reviews.spoiler END,
                 updated_at = excluded.updated_at
               WHERE ? = 1
                 AND datetime(excluded.updated_at) >=
                   datetime(reviews.updated_at)`,
            )
            .bind(
              randomId(),
              actor.id,
              resolved.id,
              review.rating,
              review.body ?? "",
              review.spoiler ? 1 : 0,
              importedReviewUpdatedAt ?? new Date().toISOString(),
              review.body === undefined ? 0 : 1,
              review.spoiler === undefined ? 0 : 1,
              authoritativeReview ? 1 : 0,
            ),
        );
      }
    }

    if (payload.preferences?.libraryViewMode) {
      statements.push(
        db
          .prepare(
            `INSERT INTO user_preferences
             (user_id, theme, content_language, reader_mode, mature_content,
              settings_json, updated_at)
             VALUES (
               ?, 'SYSTEM', 'en', 'VERTICAL', 0,
               json_object('libraryViewMode', ?), CURRENT_TIMESTAMP
             )
             ON CONFLICT(user_id) DO UPDATE SET
               settings_json = json_set(
                 CASE WHEN json_valid(user_preferences.settings_json)
                   THEN user_preferences.settings_json ELSE '{}' END,
                 '$.libraryViewMode', ?
               ),
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            actor.id,
            payload.preferences.libraryViewMode,
            payload.preferences.libraryViewMode,
          ),
      );
    }
    await runInChunks(db, statements);
    return json(
      requestId,
      {
        imported: {
          series: matchedSeries,
          progress: progressRows,
          reviews,
        },
        skipped: unmatched.length,
        unmatched: unmatched.slice(0, 50),
        viewMode: payload.preferences?.libraryViewMode ?? null,
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
