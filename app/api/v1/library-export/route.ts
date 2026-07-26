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
    const [records, progress, preferences] = await Promise.all([
      env.DB.prepare(
      `SELECT l.series_id AS seriesId, l.list_type AS libraryStatus,
              l.is_favorite AS isFavorite,
              l.notifications_enabled AS notificationsEnabled,
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
                SELECT c.chapter_number
                  FROM reading_progress rp
                  JOIN chapters c ON c.id = rp.chapter_id
                 WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                 ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                 LIMIT 1
              ) AS lastReadChapter,
              (
                SELECT rp.updated_at
                  FROM reading_progress rp
                  JOIN chapters c ON c.id = rp.chapter_id
                 WHERE rp.user_id = l.user_id AND c.series_id = l.series_id
                 ORDER BY datetime(rp.updated_at) DESC, c.id DESC
                 LIMIT 1
              ) AS lastReadAt,
              (
                SELECT r.rating
                  FROM reviews r
                 WHERE r.user_id = l.user_id AND r.series_id = l.series_id
                 LIMIT 1
              ) AS rating,
              (
                SELECT r.body
                  FROM reviews r
                 WHERE r.user_id = l.user_id AND r.series_id = l.series_id
                 LIMIT 1
              ) AS reviewBody,
              (
                SELECT r.spoiler
                  FROM reviews r
                 WHERE r.user_id = l.user_id AND r.series_id = l.series_id
                 LIMIT 1
              ) AS reviewSpoiler,
              (
                SELECT r.updated_at
                  FROM reviews r
                 WHERE r.user_id = l.user_id AND r.series_id = l.series_id
                 LIMIT 1
              ) AS reviewUpdatedAt
         FROM library_entries l
         JOIN series s ON s.id = l.series_id
        WHERE l.user_id = ?
        ORDER BY datetime(l.updated_at) DESC, l.series_id`,
      )
        .bind(actor.id)
        .all<{
        seriesId: string;
        libraryStatus: string;
        isFavorite: number;
        notificationsEnabled: number;
        followedAt: string;
        libraryUpdatedAt: string;
        slug: string;
        title: string;
        alternativeTitlesJson: string;
        mangaDexId: string | null;
        mangaUpdatesId: string | null;
        lastReadChapter: string | null;
        lastReadAt: string | null;
        rating: number | null;
        reviewBody: string | null;
        reviewSpoiler: number | null;
        reviewUpdatedAt: string | null;
      }>(),
      env.DB.prepare(
        `SELECT c.series_id AS seriesId, c.id AS chapterId,
                c.slug AS chapterSlug, c.chapter_number AS chapterNumber,
                rp.page_index AS page, rp.scroll_offset AS scrollOffset,
                rp.progress_basis_points AS progressBasisPoints,
                rp.completed_at AS completedAt, rp.updated_at AS updatedAt
           FROM reading_progress rp
           JOIN chapters c ON c.id = rp.chapter_id
          WHERE rp.user_id = ?
          ORDER BY c.series_id, datetime(rp.updated_at), c.id`,
      )
        .bind(actor.id)
        .all<{
          seriesId: string;
          chapterId: string;
          chapterSlug: string;
          chapterNumber: string;
          page: number;
          scrollOffset: number;
          progressBasisPoints: number;
          completedAt: string | null;
          updatedAt: string;
        }>(),
      env.DB.prepare(
        `SELECT settings_json AS settingsJson
           FROM user_preferences
          WHERE user_id = ?
          LIMIT 1`,
      )
        .bind(actor.id)
        .first<{ settingsJson: string }>(),
    ]);
    const progressBySeries = new Map<string, typeof progress.results>();
    for (const row of progress.results) {
      progressBySeries.set(row.seriesId, [
        ...(progressBySeries.get(row.seriesId) ?? []),
        row,
      ]);
    }
    let libraryViewMode = "cover";
    try {
      const settings = JSON.parse(preferences?.settingsJson ?? "{}") as {
        libraryViewMode?: unknown;
      };
      if (
        settings.libraryViewMode === "compact" ||
        settings.libraryViewMode === "list"
      ) {
        libraryViewMode = settings.libraryViewMode;
      }
    } catch {
      // Export remains valid when unrelated legacy preference JSON is invalid.
    }
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const payload = {
      format: "nyascans-library-export",
      version: "2.0",
      exportedAt: now.toISOString(),
      user: { id: actor.id },
      preferences: { libraryViewMode },
      series: records.results.map((record) => ({
        seriesId: record.seriesId,
        title: record.title,
        alternativeTitles: safeJsonArray(record.alternativeTitlesJson),
        sourceUrl: `/title/${record.slug}`,
        mangaDexId: record.mangaDexId,
        mangaUpdatesId: record.mangaUpdatesId,
        libraryStatus: record.libraryStatus.toLowerCase(),
        favorite: Boolean(record.isFavorite),
        notificationsEnabled: Boolean(record.notificationsEnabled),
        lastReadChapter: record.lastReadChapter,
        lastReadAt: record.lastReadAt,
        progress: (progressBySeries.get(record.seriesId) ?? []).map((entry) => ({
          chapterId: entry.chapterId,
          chapterSlug: entry.chapterSlug,
          chapterNumber: entry.chapterNumber,
          page: Number(entry.page),
          scrollOffset: Number(entry.scrollOffset),
          progressBasisPoints: Number(entry.progressBasisPoints),
          completedAt: entry.completedAt,
          updatedAt: entry.updatedAt,
        })),
        followedAt: record.followedAt,
        libraryUpdatedAt: record.libraryUpdatedAt,
        review:
          record.rating === null
            ? null
            : {
                rating: Number(record.rating),
                body: record.reviewBody ?? "",
                spoiler: Boolean(record.reviewSpoiler),
                updatedAt: record.reviewUpdatedAt,
              },
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
