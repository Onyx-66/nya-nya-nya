import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import {
  publicPaidChapterPredicate,
  publicPaidSeriesPredicate,
} from "@/lib/server/public-content-visibility";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(8),
});

function publicCoverUrl(
  seriesId: string,
  objectKey: string | null,
  revision: number,
) {
  const key = objectKey?.trim() ?? "";
  if (!key) return null;
  if (key.startsWith("/") || /^https?:\/\//i.test(key)) return key;
  return `/api/v1/series-media?id=${encodeURIComponent(seriesId)}&slot=cover&v=${revision}`;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "New series are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const { limit } = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const records = await env.DB.prepare(
      `SELECT s.id, s.slug, s.title, s.type, s.status, s.revision,
              s.cover_key AS coverKey,
              s.created_at AS createdAt,
              COALESCE(
                (
                  SELECT MIN(c.published_at)
                    FROM chapters c
                    LEFT JOIN content_visibility_overrides visibility_override
                      ON visibility_override.chapter_id = c.id
                   WHERE c.series_id = s.id
                     AND c.state = 'PUBLISHED'
                     AND c.visibility = 'PUBLIC'
                     AND c.published_at IS NOT NULL
                     AND datetime(c.published_at) <= datetime('now')
                     AND ${publicPaidChapterPredicate("c", "visibility_override")}
                ),
                s.created_at
              ) AS publicAt,
              COALESCE(
                (
                  SELECT json_group_array(name)
                    FROM (
                      SELECT g.name AS name
                        FROM series_genres sg
                        JOIN genres g ON g.id = sg.genre_id
                       WHERE sg.series_id = s.id
                         AND g.archived_at IS NULL
                       ORDER BY g.name COLLATE NOCASE
                       LIMIT 3
                    )
                ),
                '[]'
              ) AS genresJson,
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
              ) AS latestChapter
         FROM series s
        WHERE s.is_published = 1
          AND s.archived_at IS NULL
          AND ${publicPaidSeriesPredicate("s")}
          AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          AND s.rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
        ORDER BY datetime(publicAt) DESC, s.id DESC
        LIMIT ?`,
    )
      .bind(limit)
      .all<{
        id: string;
        slug: string;
        title: string;
        type: string;
        status: string;
        revision: number;
        coverKey: string | null;
        createdAt: string;
        publicAt: string;
        genresJson: string;
        latestChapter: string | null;
      }>();
    return json(
      requestId,
      {
        data: records.results.map((record) => {
          let genres: string[] = [];
          try {
            const parsed = JSON.parse(record.genresJson) as unknown;
            genres = Array.isArray(parsed)
              ? parsed.filter((value): value is string => typeof value === "string")
              : [];
          } catch {
            genres = [];
          }
          return {
            id: record.id,
            slug: record.slug,
            title: record.title,
            type: record.type,
            status: record.status,
            publicAt: record.publicAt,
            genres,
            latestChapter: record.latestChapter,
            coverUrl: publicCoverUrl(
              record.id,
              record.coverKey,
              record.revision,
            ),
          };
        }),
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
