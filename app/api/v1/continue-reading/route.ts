import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";
import { seriesReadingProgress } from "@/lib/reading-progress";

export const dynamic = "force-dynamic";

const preferenceSchema = z.object({
  viewMode: z.enum(["LIST", "SHELF"]),
});

type ContinueReadingRow = {
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  coverKey: string | null;
  seriesRevision: number;
  chapterId: string;
  chapterSlug: string;
  chapterNumber: string;
  chapterTitle: string;
  pageIndex: number;
  pageCount: number;
  progressBasisPoints: number;
  lastOpenedAt: string;
  chaptersRead: number;
  chaptersTotal: number;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Continue Reading is temporarily unavailable.",
    );
  }
  return env.DB;
}

function readViewMode(settingsJson: string | null) {
  try {
    const value = JSON.parse(settingsJson ?? "{}") as {
      continueReadingViewMode?: unknown;
    };
    return value.continueReadingViewMode === "SHELF" ? "SHELF" : "LIST";
  } catch {
    return "LIST";
  }
}

function coverUrl(row: ContinueReadingRow) {
  if (!row.coverKey) return null;
  if (
    row.coverKey.startsWith("/") ||
    /^https?:\/\//i.test(row.coverKey)
  ) {
    return row.coverKey;
  }
  return `/api/v1/series-media?id=${encodeURIComponent(row.seriesId)}&slot=cover&v=${row.seriesRevision}`;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor("reader.progress.own");
    const db = database();
    const [recent, preferences] = await db.batch([
      db
        .prepare(
          `WITH ranked_progress AS (
             SELECT s.id AS seriesId,
                    s.slug AS seriesSlug,
                    s.title AS seriesTitle,
                    s.cover_key AS coverKey,
                    s.revision AS seriesRevision,
                    c.id AS chapterId,
                    c.slug AS chapterSlug,
                    c.chapter_number AS chapterNumber,
                    c.title AS chapterTitle,
                    c.page_count AS pageCount,
                    rp.page_index AS pageIndex,
                    rp.progress_basis_points AS progressBasisPoints,
                    rp.updated_at AS lastOpenedAt,
                    (
                      SELECT COUNT(DISTINCT completed_chapter.chapter_number)
                        FROM reading_progress completed
                        JOIN chapters completed_chapter
                          ON completed_chapter.id = completed.chapter_id
                       WHERE completed.user_id = rp.user_id
                         AND completed_chapter.series_id = s.id
                         AND completed_chapter.state = 'PUBLISHED'
                         AND completed_chapter.visibility IN ('PUBLIC', 'UNLISTED')
                         AND completed_chapter.published_at IS NOT NULL
                         AND datetime(completed_chapter.published_at) <=
                           datetime('now')
                         AND (
                           completed.completed_at IS NOT NULL
                           OR completed.progress_basis_points >= 9200
                         )
                    ) AS chaptersRead,
                    (
                      SELECT COUNT(DISTINCT published.chapter_number)
                        FROM chapters published
                       WHERE published.series_id = s.id
                         AND published.state = 'PUBLISHED'
                         AND published.visibility IN ('PUBLIC', 'UNLISTED')
                         AND published.published_at IS NOT NULL
                         AND datetime(published.published_at) <= datetime('now')
                    ) AS chaptersTotal,
                    ROW_NUMBER() OVER (
                      PARTITION BY s.id
                      ORDER BY datetime(rp.updated_at) DESC, rp.chapter_id DESC
                    ) AS recentRank
               FROM reading_progress rp
               JOIN chapters c ON c.id = rp.chapter_id
               JOIN series s ON s.id = c.series_id
              WHERE rp.user_id = ?
                AND c.state = 'PUBLISHED'
                AND c.visibility IN ('PUBLIC', 'UNLISTED')
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
           )
           SELECT seriesId, seriesSlug, seriesTitle, coverKey, seriesRevision,
                  chapterId, chapterSlug, chapterNumber, chapterTitle,
                  pageIndex, pageCount, progressBasisPoints, lastOpenedAt,
                  chaptersRead, chaptersTotal
             FROM ranked_progress
            WHERE recentRank = 1
            ORDER BY datetime(lastOpenedAt) DESC, seriesTitle COLLATE NOCASE
            LIMIT 12`,
        )
        .bind(actor.id),
      db
        .prepare(
          `SELECT settings_json AS settingsJson
             FROM user_preferences
            WHERE user_id = ?
            LIMIT 1`,
        )
        .bind(actor.id),
    ]);
    const rows = recent.results as ContinueReadingRow[];
    const preferenceRow = preferences.results[0] as
      | { settingsJson?: string }
      | undefined;
    return json(
      requestId,
      {
        data: rows.map((row) => {
          const chaptersRead = Number(row.chaptersRead);
          const chaptersTotal = Number(row.chaptersTotal);
          return {
            ...row,
            pageIndex: Number(row.pageIndex),
            pageCount: Number(row.pageCount),
            chaptersRead,
            chaptersTotal,
            progress: seriesReadingProgress(chaptersRead, chaptersTotal),
            chapterProgress: Math.min(
              100,
              Math.max(0, Number(row.progressBasisPoints) / 100),
            ),
            coverUrl: coverUrl(row),
            resumeUrl: `/title/${row.seriesSlug}/chapter/${row.chapterSlug}`,
          };
        }),
        preferences: {
          viewMode: readViewMode(preferenceRow?.settingsJson ?? null),
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
    const actor = await requireActor("reader.progress.own");
    const payload = preferenceSchema.parse(await request.json());
    const db = database();
    await db
      .prepare(
        `INSERT INTO user_preferences
         (user_id, theme, content_language, reader_mode, mature_content,
          settings_json, updated_at)
         VALUES (
           ?, 'SYSTEM', 'en', 'VERTICAL', 0,
           json_object('continueReadingViewMode', ?),
           CURRENT_TIMESTAMP
         )
         ON CONFLICT(user_id) DO UPDATE SET
           settings_json = json_set(
             CASE
               WHEN json_valid(user_preferences.settings_json)
                 THEN user_preferences.settings_json
               ELSE '{}'
             END,
             '$.continueReadingViewMode',
             ?
           ),
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(actor.id, payload.viewMode, payload.viewMode)
      .run();
    return json(requestId, {
      saved: true,
      viewMode: payload.viewMode,
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
