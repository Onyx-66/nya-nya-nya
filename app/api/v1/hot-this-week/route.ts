import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { seriesMediaUrl } from "@/lib/server/series-media-url";

export const dynamic = "force-dynamic";

type HotSeriesRow = {
  id: string;
  slug: string;
  title: string;
  coverKey: string | null;
  revision: number;
  genres: string;
  uniqueReaders: number;
  chapterStarts: number;
  chapterCompletions: number;
  commentCount: number;
  reactionCount: number;
  latestActivityAt: string;
};

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Weekly reading activity is temporarily unavailable.",
      );
    }
    const rows = await env.DB.prepare(
      `WITH weekly_progress AS (
         SELECT s.slug AS seriesSlug,
                COUNT(DISTINCT rp.user_id) AS uniqueReaders,
                COUNT(DISTINCT rp.user_id || ':' || c.id) AS chapterStarts,
                COUNT(DISTINCT CASE
                  WHEN rp.completed_at IS NOT NULL
                    OR rp.progress_basis_points >= 9200
                  THEN rp.user_id || ':' || c.id
                END) AS chapterCompletions,
                MAX(rp.onsite_activity_at) AS latestActivityAt
           FROM reading_progress rp
           JOIN chapters c ON c.id = rp.chapter_id
           JOIN series s ON s.id = c.series_id
          WHERE rp.onsite_activity_at >= datetime('now', '-7 days')
            AND rp.onsite_activity_at < CURRENT_TIMESTAMP
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND datetime(c.published_at) <= CURRENT_TIMESTAMP
          GROUP BY s.slug
       ),
       weekly_comments AS (
         SELECT dc.series_slug AS seriesSlug,
                COUNT(*) AS commentCount,
                MAX(dc.created_at) AS latestCommentAt
           FROM discussion_comments dc
          WHERE dc.moderation_status = 'VISIBLE'
            AND dc.deleted_at IS NULL
            AND (
              dc.chapter_slug IS NULL
              OR EXISTS (
                SELECT 1
                  FROM series comment_series
                  JOIN chapters comment_chapter
                    ON comment_chapter.series_id = comment_series.id
                 WHERE comment_series.slug = dc.series_slug
                   AND comment_chapter.slug = dc.chapter_slug
                   AND comment_chapter.state = 'PUBLISHED'
                   AND comment_chapter.visibility = 'PUBLIC'
                   AND datetime(comment_chapter.published_at) <= CURRENT_TIMESTAMP
              )
            )
            AND dc.created_at >= datetime('now', '-7 days')
            AND dc.created_at < CURRENT_TIMESTAMP
          GROUP BY dc.series_slug
       ),
       weekly_reactions AS (
         SELECT dc.series_slug AS seriesSlug,
                COUNT(*) AS reactionCount,
                MAX(dr.created_at) AS latestReactionAt
           FROM discussion_reactions dr
           JOIN discussion_comments dc ON dc.id = dr.comment_id
          WHERE dc.moderation_status = 'VISIBLE'
            AND dc.deleted_at IS NULL
            AND (
              dc.chapter_slug IS NULL
              OR EXISTS (
                SELECT 1
                  FROM series reaction_series
                  JOIN chapters reaction_chapter
                    ON reaction_chapter.series_id = reaction_series.id
                 WHERE reaction_series.slug = dc.series_slug
                   AND reaction_chapter.slug = dc.chapter_slug
                   AND reaction_chapter.state = 'PUBLISHED'
                   AND reaction_chapter.visibility = 'PUBLIC'
                   AND datetime(reaction_chapter.published_at) <= CURRENT_TIMESTAMP
              )
            )
            AND dr.created_at >= datetime('now', '-7 days')
            AND dr.created_at < CURRENT_TIMESTAMP
          GROUP BY dc.series_slug
       ),
       weekly_chapter_reactions AS (
         SELECT s.slug AS seriesSlug,
                COUNT(*) AS reactionCount,
                MAX(cr.created_at) AS latestReactionAt
           FROM chapter_reactions cr
           JOIN chapters c ON c.id = cr.chapter_id
           JOIN series s ON s.id = c.series_id
          WHERE cr.created_at >= datetime('now', '-7 days')
            AND cr.created_at < CURRENT_TIMESTAMP
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND datetime(c.published_at) <= CURRENT_TIMESTAMP
          GROUP BY s.slug
       )
       SELECT s.id,
              s.slug,
              s.title,
              s.cover_key AS coverKey,
              s.revision,
              COALESCE((
                SELECT GROUP_CONCAT(g.name, '||')
                  FROM series_genres sg
                  JOIN genres g ON g.id = sg.genre_id
                 WHERE sg.series_id = s.id
                   AND g.archived_at IS NULL
              ), '') AS genres,
              COALESCE(wp.uniqueReaders, 0) AS uniqueReaders,
              COALESCE(wp.chapterStarts, 0) AS chapterStarts,
              COALESCE(wp.chapterCompletions, 0) AS chapterCompletions,
              COALESCE(wc.commentCount, 0) AS commentCount,
              COALESCE(wr.reactionCount, 0)
                + COALESCE(wcr.reactionCount, 0) AS reactionCount,
              MAX(
                COALESCE(wp.latestActivityAt, '1970-01-01 00:00:00'),
                COALESCE(wc.latestCommentAt, '1970-01-01 00:00:00'),
                COALESCE(wr.latestReactionAt, '1970-01-01 00:00:00'),
                COALESCE(wcr.latestReactionAt, '1970-01-01 00:00:00')
              ) AS latestActivityAt
         FROM series s
         LEFT JOIN weekly_progress wp ON wp.seriesSlug = s.slug
         LEFT JOIN weekly_comments wc ON wc.seriesSlug = s.slug
         LEFT JOIN weekly_reactions wr ON wr.seriesSlug = s.slug
         LEFT JOIN weekly_chapter_reactions wcr ON wcr.seriesSlug = s.slug
        WHERE s.is_published = 1
          AND s.archived_at IS NULL
          AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          AND s.rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          AND (
            COALESCE(wp.chapterStarts, 0)
            + COALESCE(wc.commentCount, 0)
            + COALESCE(wr.reactionCount, 0)
            + COALESCE(wcr.reactionCount, 0)
          ) > 0
        ORDER BY uniqueReaders DESC,
                 chapterStarts DESC,
                 commentCount DESC,
                 reactionCount DESC,
                 latestActivityAt DESC,
                 s.id ASC
        LIMIT 9`,
    ).all<HotSeriesRow>();

    return json(
      requestId,
      {
        data: rows.results.map((row, index) => ({
          id: row.id,
          rank: index + 1,
          slug: row.slug,
          title: row.title,
          coverUrl: seriesMediaUrl(
            row.id,
            "cover",
            row.coverKey,
            row.revision,
          ),
          genres: row.genres.split("||").filter(Boolean).slice(0, 3),
          uniqueReaders: Number(row.uniqueReaders),
          chapterStarts: Number(row.chapterStarts),
          chapterCompletions: Number(row.chapterCompletions),
          commentCount: Number(row.commentCount),
          reactionCount: Number(row.reactionCount),
          latestActivityAt: row.latestActivityAt,
        })),
        windowDays: 7,
      },
      {
        headers: {
          "cache-control": "public, max-age=45, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
