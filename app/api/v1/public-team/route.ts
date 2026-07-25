import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

type TeamRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoKey: string | null;
  bannerKey: string | null;
  revision: number;
};

type SeriesRow = {
  id: string;
  slug: string;
  title: string;
  type: string;
  status: string;
  coverKey: string | null;
  revision: number;
  latestChapter: string | null;
  latestChapterSlug: string | null;
};

function directMediaUrl(key: string | null) {
  const normalized = key?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function teamMediaUrl(
  team: Pick<TeamRow, "id" | "revision">,
  slot: "logo" | "banner",
  key: string | null,
) {
  return (
    directMediaUrl(key) ??
    (key
      ? `/api/v1/team-media?id=${encodeURIComponent(team.id)}&slot=${slot}&v=${team.revision}`
      : null)
  );
}

function seriesCoverUrl(
  series: Pick<SeriesRow, "id" | "revision" | "coverKey">,
) {
  return (
    directMediaUrl(series.coverKey) ??
    (series.coverKey
      ? `/api/v1/series-media?id=${encodeURIComponent(series.id)}&slot=cover&v=${series.revision}`
      : null)
  );
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Publishing team details are temporarily unavailable.",
      );
    }

    const url = new URL(request.url);
    const { slug } = querySchema.parse({
      slug: url.searchParams.get("slug"),
    });

    const team = await env.DB.prepare(
      `SELECT id, slug, name, description,
              logo_key AS logoKey,
              banner_key AS bannerKey,
              revision
         FROM teams
        WHERE slug = ?
          AND is_archived = 0
          AND verification_status = 'VERIFIED'
        LIMIT 1`,
    )
      .bind(slug)
      .first<TeamRow>();

    if (!team) {
      throw new ApiError(
        404,
        "TEAM_NOT_FOUND",
        "This publishing team is not available.",
      );
    }

    const [seriesRows, releaseCountRow] = await Promise.all([
      env.DB.prepare(
        `SELECT s.id, s.slug, s.title, s.type, s.status,
                s.cover_key AS coverKey,
                s.revision,
                latest.chapter_number AS latestChapter,
                latest.slug AS latestChapterSlug
           FROM series_team_assignments sta
           JOIN series s ON s.id = sta.series_id
           LEFT JOIN chapters latest
             ON latest.id = (
               SELECT newest.id
                 FROM chapters newest
                WHERE newest.series_id = s.id
                  AND newest.team_id = sta.team_id
                  AND newest.state = 'PUBLISHED'
                  AND newest.visibility = 'PUBLIC'
                  AND newest.published_at IS NOT NULL
                  AND datetime(newest.published_at) <= datetime('now')
                ORDER BY datetime(newest.published_at) DESC,
                         datetime(newest.created_at) DESC,
                         newest.id DESC
                LIMIT 1
             )
          WHERE sta.team_id = ?
            AND sta.revoked_at IS NULL
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          ORDER BY
            CASE WHEN latest.published_at IS NULL THEN 1 ELSE 0 END,
            datetime(latest.published_at) DESC,
            s.title COLLATE NOCASE,
            s.id`,
      )
        .bind(team.id)
        .all<SeriesRow>(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT c.id) AS count
           FROM series_team_assignments sta
           JOIN series s ON s.id = sta.series_id
           JOIN chapters c
             ON c.series_id = s.id
            AND c.team_id = sta.team_id
          WHERE sta.team_id = ?
            AND sta.revoked_at IS NULL
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND c.published_at IS NOT NULL
            AND datetime(c.published_at) <= datetime('now')`,
      )
        .bind(team.id)
        .first<{ count: number }>(),
    ]);

    return json(
      requestId,
      {
        data: {
          id: team.id,
          slug: team.slug,
          name: team.name,
          description: team.description,
          logoUrl: teamMediaUrl(team, "logo", team.logoKey),
          bannerUrl: teamMediaUrl(team, "banner", team.bannerKey),
          publicSeriesCount: seriesRows.results.length,
          releaseCount: Number(releaseCountRow?.count ?? 0),
          series: seriesRows.results.map((series) => ({
            id: series.id,
            slug: series.slug,
            title: series.title,
            type: series.type,
            status: series.status,
            coverUrl: seriesCoverUrl(series),
            latestChapter: series.latestChapter,
            latestChapterSlug: series.latestChapterSlug,
          })),
        },
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
