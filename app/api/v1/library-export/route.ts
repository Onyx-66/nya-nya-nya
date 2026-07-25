import { env } from "cloudflare:workers";
import { ApiError, errorResponse } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

function safeJsonArray(value: string | null) {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
        "Library export is temporarily unavailable.",
      );
    }
    const records = await env.DB.prepare(
      `SELECT l.series_id AS seriesId, l.list_type AS libraryStatus,
              l.created_at AS followedAt, l.updated_at AS libraryUpdatedAt,
              s.slug, s.title,
              COALESCE(
                (
                  SELECT json_group_array(
                    json_object('title', sa.alias, 'language', sa.language)
                  )
                    FROM series_aliases sa
                   WHERE sa.series_id = s.id
                ),
                '[]'
              ) AS alternativeTitlesJson,
              (
                SELECT ses.external_id
                  FROM series_external_sources ses
                 WHERE ses.series_id = s.id AND ses.source = 'MANGADEX'
                 LIMIT 1
              ) AS mangaDexId,
              (
                SELECT ses.external_id
                  FROM series_external_sources ses
                 WHERE ses.series_id = s.id AND ses.source = 'MANGAUPDATES'
                 LIMIT 1
              ) AS mangaUpdatesId,
              (
                SELECT c.id
                  FROM reading_progress rp
                  JOIN chapters c ON c.id = rp.chapter_id
                 WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                 ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                 LIMIT 1
              ) AS chapterId,
              (
                SELECT c.chapter_number
                  FROM reading_progress rp
                  JOIN chapters c ON c.id = rp.chapter_id
                 WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                 ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                 LIMIT 1
              ) AS lastReadChapter,
              (
                SELECT rp.page_index
                  FROM reading_progress rp
                  JOIN chapters c ON c.id = rp.chapter_id
                 WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                 ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                 LIMIT 1
              ) AS page,
              (
                SELECT rp.updated_at
                  FROM reading_progress rp
                  JOIN chapters c ON c.id = rp.chapter_id
                 WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                 ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                 LIMIT 1
              ) AS lastReadAt,
              (
                SELECT CAST(r.rating AS REAL) / 2.0
                  FROM reviews r
                 WHERE r.user_id = l.user_id AND r.series_id = l.series_id
                 LIMIT 1
              ) AS rating
         FROM library_entries l
         JOIN series s ON s.id = l.series_id
        WHERE l.user_id = ?
        ORDER BY datetime(l.updated_at) DESC, l.series_id`,
    )
      .bind(actor.id)
      .all<{
        seriesId: string;
        libraryStatus: string;
        followedAt: string;
        libraryUpdatedAt: string;
        slug: string;
        title: string;
        alternativeTitlesJson: string;
        mangaDexId: string | null;
        mangaUpdatesId: string | null;
        chapterId: string | null;
        lastReadChapter: string | null;
        page: number | null;
        lastReadAt: string | null;
        rating: number | null;
      }>();
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const payload = {
      format: "nyascans-library-export",
      version: "1.0",
      exportedAt: now.toISOString(),
      user: { id: actor.id },
      series: records.results.map((record) => ({
        seriesId: record.seriesId,
        title: record.title,
        alternativeTitles: safeJsonArray(record.alternativeTitlesJson),
        sourceUrl: `/title/${record.slug}`,
        mangaDexId: record.mangaDexId,
        mangaUpdatesId: record.mangaUpdatesId,
        libraryStatus: record.libraryStatus.toLowerCase(),
        lastReadChapter: record.lastReadChapter,
        lastReadAt: record.lastReadAt,
        progress: record.chapterId
          ? {
              chapterId: record.chapterId,
              page: Number(record.page ?? 0),
            }
          : null,
        followedAt: record.followedAt,
        rating: record.rating === null ? null : Number(record.rating),
      })),
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="nyascans-library-${date}.json"`,
        "cache-control": "private, no-store",
        vary: "cookie",
        "x-request-id": requestId,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
