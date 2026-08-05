import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { preferredSeriesArtworkUrl } from "@/lib/server/series-media-url";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Featured sliders are unavailable.");
    const rows = await env.DB.prepare(
      `SELECT hs.id, hs.series_id AS seriesId, hs.title,
              hs.category_label AS categoryLabel,
              hs.short_description AS shortDescription,
              hs.destination_url AS destinationUrl,
              hs.image_key AS imageKey, hs.revision,
              s.slug AS seriesSlug, s.title AS seriesTitle,
              s.cover_key AS coverKey, s.banner_key AS bannerKey,
              s.slider_key AS seriesSliderKey, s.revision AS seriesRevision
         FROM homepage_sliders hs
         LEFT JOIN series s ON s.id = hs.series_id
        WHERE hs.is_active = 1
          AND (hs.series_id IS NULL OR (
            s.is_published = 1 AND s.archived_at IS NULL
            AND s.rights_status IN ('LICENSED','AUTHORIZED','DEMO_ORIGINAL','TEST_ORIGINAL')
          ))
        ORDER BY hs.sort_order DESC, datetime(hs.created_at) DESC
        LIMIT 9`,
    ).all<Record<string, unknown>>();
    return json(requestId, {
      data: rows.results.map((row) => ({
        ...row,
        imageUrl: row.imageKey
          ? `/api/v1/homepage-slider-media?id=${encodeURIComponent(String(row.id))}&v=${Number(row.revision)}`
          : row.seriesId
            ? preferredSeriesArtworkUrl(
                String(row.seriesId),
                row.seriesRevision ?? row.revision,
                [
                  ["slider", row.seriesSliderKey],
                  ["cover", row.coverKey],
                  ["banner", row.bannerKey],
                ],
              )
            : null,
        href: String(row.destinationUrl || (row.seriesSlug ? `/title/${row.seriesSlug}` : "/browse")),
      })),
    }, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
