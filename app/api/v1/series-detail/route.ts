import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function publicSeriesMediaUrl(
  seriesId: string,
  objectKey: string | null,
  slot: "cover" | "banner",
  revision: number,
) {
  const key = objectKey?.trim() ?? "";
  if (!key) return null;
  if (key.startsWith("/") || /^https?:\/\//i.test(key)) return key;
  return `/api/v1/series-media?id=${encodeURIComponent(seriesId)}&slot=${slot}&v=${revision}`;
}

function publicTeamLogoUrl(
  teamId: string,
  objectKey: string | null,
  revision: number,
) {
  const key = objectKey?.trim() ?? "";
  if (!key) return null;
  if (key.startsWith("/") || /^https?:\/\//i.test(key)) return key;
  return `/api/v1/team-media?id=${encodeURIComponent(teamId)}&slot=logo&v=${revision}`;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Series details are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const slug = slugSchema.parse(url.searchParams.get("slug"));
    const row = await env.DB.prepare(
      `SELECT s.id, s.slug, s.title, s.synopsis, s.type, s.status,
              s.origin_country AS countryCode,
              s.original_language AS languageCode,
              s.reading_direction AS readingDirection,
              s.publication_year AS publicationYear,
              s.age_rating AS ageRating, s.access_type AS accessType,
              s.rating_tenths AS ratingTenths,
              s.follower_count AS followerCount,
              s.view_count AS viewCount,
              s.cover_key AS coverKey, s.banner_key AS bannerKey,
              s.revision, s.updated_at AS updatedAt,
              CASE WHEN p.id IS NULL THEN 'null'
                   ELSE json_object('id', p.id, 'name', p.name)
              END AS publisherJson,
              COALESCE((
                SELECT json_group_array(json_object(
                  'title', sa.alias, 'language', sa.language
                ))
                FROM series_aliases sa WHERE sa.series_id = s.id
              ), '[]') AS aliasesJson,
              COALESCE((
                SELECT json_group_array(json_object('id', c.id, 'name', c.name))
                FROM series_creators sc
                JOIN creators c ON c.id = sc.creator_id
                WHERE sc.series_id = s.id AND sc.role = 'AUTHOR'
                  AND c.archived_at IS NULL
                ORDER BY sc.sort_order
              ), '[]') AS authorsJson,
              COALESCE((
                SELECT json_group_array(json_object('id', c.id, 'name', c.name))
                FROM series_creators sc
                JOIN creators c ON c.id = sc.creator_id
                WHERE sc.series_id = s.id AND sc.role = 'ARTIST'
                  AND c.archived_at IS NULL
                ORDER BY sc.sort_order
              ), '[]') AS artistsJson,
              COALESCE((
                SELECT json_group_array(json_object('id', g.id, 'name', g.name))
                FROM series_genres sg
                JOIN genres g ON g.id = sg.genre_id
                WHERE sg.series_id = s.id AND g.archived_at IS NULL
                ORDER BY g.name COLLATE NOCASE
              ), '[]') AS genresJson,
              COALESCE((
                SELECT json_group_array(json_object(
                  'id', t.id, 'slug', t.slug, 'name', t.name,
                  'isPrimary', sta.is_primary,
                  'logoKey', t.logo_key,
                  'revision', t.revision
                ))
                FROM series_team_assignments sta
                JOIN teams t ON t.id = sta.team_id
                WHERE sta.series_id = s.id AND t.is_archived = 0
                  AND t.verification_status = 'VERIFIED'
                ORDER BY sta.is_primary DESC, t.name COLLATE NOCASE
              ), '[]') AS teamsJson
       FROM series s
       LEFT JOIN publishers p
         ON p.id = s.publisher_id AND p.archived_at IS NULL
       WHERE s.slug = ? AND s.is_published = 1 AND s.archived_at IS NULL
         AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
         AND s.rights_status IN
           ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
       LIMIT 1`,
    )
      .bind(slug)
      .first<{
        id: string;
        slug: string;
        title: string;
        synopsis: string;
        type: string;
        status: string;
        countryCode: string;
        languageCode: string;
        readingDirection: string;
        publicationYear: number | null;
        ageRating: string;
        accessType: string;
        ratingTenths: number;
        followerCount: number;
        viewCount: number;
        coverKey: string | null;
        bannerKey: string | null;
        revision: number;
        updatedAt: string;
        publisherJson: string;
        aliasesJson: string;
        authorsJson: string;
        artistsJson: string;
        genresJson: string;
        teamsJson: string;
      }>();
    if (!row) {
      throw new ApiError(
        404,
        "SERIES_NOT_FOUND",
        "This series is not available.",
      );
    }
    const chapters = await env.DB.prepare(
      `SELECT c.id, c.slug, c.chapter_number AS chapterNumber,
              c.title, c.volume, c.language, c.version,
              c.access_type AS accessType, c.price_onyx AS priceOnyx,
              c.published_at AS publishedAt, c.page_count AS pageCount,
              t.id AS teamId, t.name AS teamName
       FROM chapters c
       LEFT JOIN teams t ON t.id = c.team_id
       WHERE c.series_id = ? AND c.state = 'PUBLISHED'
         AND c.visibility = 'PUBLIC'
         AND c.published_at IS NOT NULL
         AND datetime(c.published_at) <= datetime('now')
       ORDER BY COALESCE(c.published_at, c.created_at) DESC,
                c.created_at DESC, c.id DESC
       LIMIT 100`,
    )
      .bind(row.id)
      .all();
    return json(
      requestId,
      {
        data: {
          id: row.id,
          slug: row.slug,
          title: row.title,
          alternativeTitles: parseArray(row.aliasesJson),
          synopsis: row.synopsis,
          type: row.type,
          status: row.status,
          ageRating: row.ageRating,
          publicationYear:
            row.publicationYear === null
              ? null
              : Number(row.publicationYear),
          authors: parseArray(row.authorsJson),
          artists: parseArray(row.artistsJson),
          publisher: parseObject(row.publisherJson),
          countryCode: row.countryCode,
          languageCode: row.languageCode,
          readingDirection: row.readingDirection,
          genres: parseArray(row.genresJson),
          teams: parseArray(row.teamsJson).map((entry) => {
            const team = entry as {
              id: string;
              slug: string;
              name: string;
              isPrimary: number;
              logoKey: string | null;
              revision: number;
            };
            return {
              id: team.id,
              slug: team.slug,
              name: team.name,
              isPrimary: team.isPrimary,
              logoUrl: publicTeamLogoUrl(
                team.id,
                team.logoKey,
                Number(team.revision),
              ),
            };
          }),
          accessType: row.accessType,
          rating: Number(row.ratingTenths) / 10,
          followerCount: Number(row.followerCount),
          viewCount: Number(row.viewCount),
          coverUrl: publicSeriesMediaUrl(
            row.id,
            row.coverKey,
            "cover",
            row.revision,
          ),
          bannerUrl: publicSeriesMediaUrl(
            row.id,
            row.bannerKey,
            "banner",
            row.revision,
          ),
          chapters: chapters.results,
          updatedAt: row.updatedAt,
        },
      },
      {
        headers: {
          "cache-control": "public, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
