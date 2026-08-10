import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Home notices are unavailable.");
    const [announcements, ad] = await Promise.all([
      env.DB.prepare(
        `SELECT id, type, title, body, link_label AS linkLabel,
                link_url AS linkUrl, sort_order AS sortOrder,
                revision, updated_at AS updatedAt
           FROM site_announcements
          WHERE is_active = 1
            AND (starts_at IS NULL OR datetime(starts_at) <= CURRENT_TIMESTAMP)
            AND (ends_at IS NULL OR datetime(ends_at) > CURRENT_TIMESTAMP)
          ORDER BY sort_order DESC, datetime(created_at) DESC
          LIMIT 12`,
      ).all(),
      env.DB.prepare(
        `SELECT id, eyebrow, title, body, action_label AS actionLabel,
                info_blocks_json AS infoBlocksJson,
                destination_url AS destinationUrl,
                image_key AS imageKey, fallback_image_url AS fallbackImageUrl,
                effect, reset_key AS resetKey, revision
           FROM floating_ads
          WHERE is_active = 1
            AND (starts_at IS NULL OR datetime(starts_at) <= CURRENT_TIMESTAMP)
            AND (ends_at IS NULL OR datetime(ends_at) > CURRENT_TIMESTAMP)
          ORDER BY datetime(updated_at) DESC
          LIMIT 1`,
      ).first<Record<string, unknown>>(),
    ]);
    return json(requestId, {
      announcements: announcements.results,
      floatingAd: ad
        ? {
            ...ad,
            infoBlocks: (() => {
              try { return JSON.parse(String(ad.infoBlocksJson ?? "[]")); }
              catch { return []; }
            })(),
            imageUrl: ad.imageKey
              ? `/api/v1/floating-ad-media?id=${encodeURIComponent(String(ad.id))}&v=${Number(ad.revision)}`
              : ad.fallbackImageUrl || null,
          }
        : null,
    }, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
