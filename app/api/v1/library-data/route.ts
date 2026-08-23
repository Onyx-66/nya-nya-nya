import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import { seriesReadingProgress } from "@/lib/reading-progress";
import {
  publicPaidChapterPredicate,
  publicPaidSeriesPredicate,
} from "@/lib/server/public-content-visibility";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  viewMode: z.enum(["cover", "compact", "list"]),
});

function readSettings(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor("library.manage.own");
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Library data is temporarily unavailable.",
      );
    }
    const [entries, preferences] = await env.DB.batch([
      env.DB.prepare(
        `WITH library_membership AS (
           SELECT le.user_id, le.series_id, le.list_type, le.is_favorite,
                  le.created_at, le.updated_at
             FROM library_entries le
            WHERE le.user_id = ?
           UNION ALL
           SELECT f.user_id, f.series_id, 'PLANNING' AS list_type, 0 AS is_favorite,
                  f.created_at, f.created_at AS updated_at
             FROM follows f
            WHERE f.user_id = ?
              AND NOT EXISTS (
                SELECT 1
                  FROM library_entries existing_entry
                 WHERE existing_entry.user_id = f.user_id
                   AND existing_entry.series_id = f.series_id
              )
         )
         SELECT l.series_id AS seriesId, l.list_type AS listType,
                l.is_favorite AS favorite, l.created_at AS addedAt,
                l.updated_at AS updatedAt,
                s.slug, s.title, s.status, s.revision,
                s.cover_key AS coverKey,
                (
                  SELECT c.chapter_number
                    FROM chapters c
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE c.series_id = s.id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility = 'PUBLIC'
                     AND c.published_at IS NOT NULL
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(c.published_at) DESC, c.id DESC
                   LIMIT 1
                ) AS latestChapter,
                (
                  SELECT c.chapter_number
                    FROM reading_progress rp
                    JOIN chapters c ON c.id = rp.chapter_id
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                   LIMIT 1
                ) AS lastReadChapter,
                (
                  SELECT rp.progress_basis_points
                    FROM reading_progress rp
                    JOIN chapters c ON c.id = rp.chapter_id
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                   LIMIT 1
                ) AS progressBasisPoints,
                (
                  SELECT rp.updated_at
                    FROM reading_progress rp
                    JOIN chapters c ON c.id = rp.chapter_id
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                   ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                   LIMIT 1
                ) AS lastActivity,
                (
                  SELECT COUNT(DISTINCT c.chapter_number)
                    FROM chapters c
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE c.series_id = s.id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility IN ('PUBLIC', 'UNLISTED')
                     AND c.published_at IS NOT NULL
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                ) AS chaptersTotal,
                (
                  SELECT COUNT(DISTINCT c.chapter_number)
                    FROM reading_progress rp
                    JOIN chapters c ON c.id = rp.chapter_id
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE rp.user_id = l.user_id
                     AND c.series_id = l.series_id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility IN ('PUBLIC', 'UNLISTED')
                     AND c.published_at IS NOT NULL
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                     AND (
                       rp.completed_at IS NOT NULL
                       OR rp.progress_basis_points >= 9200
                     )
                ) AS chaptersRead
           FROM library_membership l
           JOIN series s ON s.id = l.series_id
          WHERE l.user_id = ?
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND ${publicPaidSeriesPredicate("s")}
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          ORDER BY datetime(COALESCE(lastActivity, l.updated_at)) DESC,
                   s.title COLLATE NOCASE, s.id`,
      ).bind(actor.id, actor.id, actor.id),
      env.DB.prepare(
        "SELECT settings_json AS settingsJson FROM user_preferences WHERE user_id = ? LIMIT 1",
      ).bind(actor.id),
    ]);
    const settings = readSettings(
      (preferences.results[0] as { settingsJson?: string } | undefined)
        ?.settingsJson ?? null,
    );
    return json(
      requestId,
      {
        data: entries.results.map((entry) => {
          const row = entry as {
            seriesId: string;
            slug: string;
            title: string;
            status: string;
            revision: number;
            coverKey: string | null;
            listType: string;
            favorite: number;
            addedAt: string;
            updatedAt: string;
            latestChapter: string | null;
            lastReadChapter: string | null;
            progressBasisPoints: number | null;
            lastActivity: string | null;
            chaptersRead: number;
            chaptersTotal: number;
          };
          const chaptersRead = Number(row.chaptersRead);
          const chaptersTotal = Number(row.chaptersTotal);
          return {
            ...row,
            favorite: Boolean(row.favorite),
            chaptersRead,
            chaptersTotal,
            unreadCount: Math.max(0, chaptersTotal - chaptersRead),
            progress: seriesReadingProgress(chaptersRead, chaptersTotal),
            chapterProgress: Math.min(
              100,
              Math.max(0, Number(row.progressBasisPoints ?? 0) / 100),
            ),
            coverUrl: row.coverKey
              ? row.coverKey.startsWith("/") ||
                /^https?:\/\//i.test(row.coverKey)
                ? row.coverKey
                : `/api/v1/series-media?id=${encodeURIComponent(row.seriesId)}&slot=cover&v=${row.revision}`
              : null,
          };
        }),
        preferences: {
          viewMode:
            settings.libraryViewMode === "compact" ||
            settings.libraryViewMode === "list"
              ? settings.libraryViewMode
              : "cover",
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
    const actor = await requireActor("library.manage.own");
    const payload = patchSchema.parse(await request.json());
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Library preferences are temporarily unavailable.",
      );
    }
    const current = await env.DB.prepare(
      "SELECT settings_json AS settingsJson FROM user_preferences WHERE user_id = ? LIMIT 1",
    )
      .bind(actor.id)
      .first<{ settingsJson: string }>();
    const settings = {
      ...readSettings(current?.settingsJson ?? null),
      libraryViewMode: payload.viewMode,
    };
    await env.DB.prepare(
      `INSERT INTO user_preferences
       (user_id, theme, content_language, reader_mode, mature_content,
        settings_json, updated_at)
       VALUES (?, 'SYSTEM', 'en', 'VERTICAL', 0, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         settings_json = excluded.settings_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(actor.id, JSON.stringify(settings))
      .run();
    return json(requestId, { saved: true, viewMode: payload.viewMode });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
