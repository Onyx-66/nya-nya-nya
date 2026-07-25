import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

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
      `SELECT t.id, t.slug, t.name, t.description, t.revision,
              t.logo_key AS logoKey, t.banner_key AS bannerKey,
              COUNT(DISTINCT CASE
                WHEN s.is_published = 1
                 AND s.archived_at IS NULL
                 AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
                 AND sta.revoked_at IS NULL
                 AND s.rights_status IN
                   ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                THEN s.id END
              ) AS publicSeriesCount,
              COUNT(DISTINCT CASE
                WHEN c.state = 'PUBLISHED'
                 AND c.visibility = 'PUBLIC'
                 AND c.published_at IS NOT NULL
                 AND datetime(c.published_at) <= datetime('now')
                 AND s.is_published = 1
                 AND s.archived_at IS NULL
                 AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
                 AND sta.revoked_at IS NULL
                 AND s.rights_status IN
                   ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                THEN c.id END
              ) AS releaseCount
         FROM teams t
         LEFT JOIN series_team_assignments sta ON sta.team_id = t.id
         LEFT JOIN series s ON s.id = sta.series_id
         LEFT JOIN chapters c ON c.series_id = s.id AND c.team_id = t.id
        WHERE t.is_archived = 0
          AND t.verification_status = 'VERIFIED'
        GROUP BY t.id
        ORDER BY publicSeriesCount DESC, releaseCount DESC,
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
      }>();
    return json(
      requestId,
      {
        data: records.results.map((record) => ({
          id: record.id,
          slug: record.slug,
          name: record.name,
          description: record.description,
          publicSeriesCount: Number(record.publicSeriesCount),
          releaseCount: Number(record.releaseCount),
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
