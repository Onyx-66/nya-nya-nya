import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Home notices are unavailable.");
    const [announcements, ads] = await Promise.all([
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
        `SELECT id, eyebrow, title, highlight_text AS highlightText,
                side_icon AS sideIcon, body, action_label AS actionLabel,
                info_blocks_json AS infoBlocksJson,
                destination_url AS destinationUrl,
                image_key AS imageKey, fallback_image_url AS fallbackImageUrl,
                effect, display_slot AS displaySlot,
                primary_color AS primaryColor,
                secondary_color AS secondaryColor,
                background_color AS backgroundColor,
                border_color AS borderColor,
                accent_line_position AS accentLinePosition,
                secondary_actions_json AS secondaryActionsJson,
                reset_key AS resetKey, revision
           FROM floating_ads
          WHERE is_active = 1
            AND (starts_at IS NULL OR datetime(starts_at) <= CURRENT_TIMESTAMP)
            AND (ends_at IS NULL OR datetime(ends_at) > CURRENT_TIMESTAMP)
          ORDER BY display_slot, datetime(updated_at) DESC
          LIMIT 2`,
      ).all<Record<string, unknown>>(),
    ]);
    const floatingAds = ads.results.map((ad) => ({
      ...ad,
      infoBlocks: (() => {
        try {
          const parsed = JSON.parse(String(ad.infoBlocksJson ?? "[]"));
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      })(),
      secondaryActions: (() => {
        try {
          const parsed = JSON.parse(String(ad.secondaryActionsJson ?? "[]"));
          return Array.isArray(parsed)
            ? parsed.filter((action): action is { label: string; url: string } =>
                Boolean(action && typeof action === "object" && typeof action.label === "string" && typeof action.url === "string"),
              ).slice(0, 6)
            : [];
        } catch { return []; }
      })(),
      imageUrl: ad.imageKey
        ? `/api/v1/floating-ad-media?id=${encodeURIComponent(String(ad.id))}&v=${Number(ad.revision)}`
        : ad.fallbackImageUrl || null,
    }));
    return json(requestId, {
      announcements: announcements.results,
      floatingAds,
      floatingAd: floatingAds[0] ?? null,
    }, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
