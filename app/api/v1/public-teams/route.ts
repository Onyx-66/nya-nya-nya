import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { publicPaidChapterPredicate } from "@/lib/server/public-content-visibility";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(10),
});

function publicTeamMediaUrl(
  teamId: string,
  objectKey: string | null,
  slot: "logo" | "banner",
  revision: number,
) {
  const key = objectKey?.trim() ?? "";
  if (!key) return null;
  if (key.startsWith("/") || /^https?:\/\//i.test(key)) return key;
  return `/api/v1/team-media?id=${encodeURIComponent(teamId)}&slot=${slot}&v=${revision}`;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Publishing teams are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const { limit } = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const records = await env.DB.prepare(
      `WITH public_releases AS (
         SELECT c.id, c.team_id AS teamId, c.series_id AS seriesId,
                LOWER(c.language) AS language
           FROM chapters c
           JOIN series s ON s.id = c.series_id
           LEFT JOIN content_visibility_overrides visibility_override
             ON visibility_override.chapter_id = c.id
          WHERE c.team_id IS NOT NULL
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND c.published_at IS NOT NULL
            AND datetime(c.published_at) <= datetime('now')
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
            AND ${publicPaidChapterPredicate("c", "visibility_override")}
       ),
       public_team_followers AS (
         SELECT release.teamId,
                COUNT(DISTINCT team_follow.user_id) AS followerCount
           FROM public_releases release
           JOIN follows team_follow
             ON team_follow.series_id = release.seriesId
          GROUP BY release.teamId
       ),
       public_team_series AS (
         SELECT DISTINCT release.teamId, release.seriesId, s.slug
           FROM public_releases release
           JOIN series s ON s.id = release.seriesId
       ),
       public_team_activity AS (
         SELECT team_series.teamId,
                COUNT(DISTINCT CASE WHEN ae.event_type IN
                  ('SERIES_VIEW', 'CHAPTER_START', 'CHAPTER_COMPLETE')
                  THEN ae.id END) AS totalViews,
                COUNT(DISTINCT dc.id) AS commentCount
           FROM public_team_series team_series
           LEFT JOIN analytics_events ae ON ae.series_slug = team_series.slug
           LEFT JOIN discussion_comments dc
             ON dc.series_slug = team_series.slug
            AND dc.moderation_status = 'VISIBLE'
            AND dc.deleted_at IS NULL
          GROUP BY team_series.teamId
       )
       SELECT t.id, t.slug, t.name, t.description, t.revision,
              t.logo_key AS logoKey, t.banner_key AS bannerKey,
              COUNT(DISTINCT release.seriesId) AS publicSeriesCount,
              COUNT(DISTINCT release.id) AS releaseCount,
              GROUP_CONCAT(DISTINCT release.language) AS releaseLanguages,
              COALESCE(MAX(public_followers.followerCount), 0)
                AS followerCount,
              COALESCE(MAX(public_activity.totalViews), 0) AS totalViews,
              COALESCE(MAX(public_activity.commentCount), 0) AS commentCount
         FROM teams t
         LEFT JOIN public_team_followers public_followers
           ON public_followers.teamId = t.id
         LEFT JOIN public_releases release ON release.teamId = t.id
         LEFT JOIN public_team_activity public_activity
           ON public_activity.teamId = t.id
        WHERE t.is_archived = 0
          AND t.verification_status = 'VERIFIED'
        GROUP BY t.id
        ORDER BY releaseCount DESC, totalViews DESC, commentCount DESC,
                 followerCount DESC,
                 t.name COLLATE NOCASE, t.id
        LIMIT ?`,
    )
      .bind(limit)
      .all<{
        id: string;
        slug: string;
        name: string;
        description: string;
        revision: number;
        logoKey: string | null;
        bannerKey: string | null;
        publicSeriesCount: number;
        releaseCount: number;
        followerCount: number;
        releaseLanguages: string | null;
        totalViews: number;
        commentCount: number;
      }>();
    return json(
      requestId,
      {
        data: records.results.map((record, index) => ({
          id: record.id,
          slug: record.slug,
          name: record.name,
          description: record.description,
          publicSeriesCount: Number(record.publicSeriesCount),
          releaseCount: Number(record.releaseCount),
          followerCount: Number(record.followerCount),
          releaseLanguages: (record.releaseLanguages ?? "")
            .split(",")
            .map((language) => language.trim())
            .filter(Boolean),
          totalViews: Number(record.totalViews),
          commentCount: Number(record.commentCount),
          rank: index + 1,
          logoUrl: publicTeamMediaUrl(
            record.id,
            record.logoKey,
            "logo",
            record.revision,
          ),
          bannerUrl: publicTeamMediaUrl(
            record.id,
            record.bannerKey,
            "banner",
            record.revision,
          ),
        })),
      },
      {
        headers: {
          "cache-control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
