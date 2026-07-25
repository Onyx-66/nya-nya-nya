import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Reactions are temporarily unavailable.",
      );
    }
    const rows = await env.DB.prepare(
      `SELECT id, slug, name, accessible_label AS accessibleLabel,
              emoji_fallback AS emojiFallback, asset_key AS assetKey,
              is_animated AS isAnimated, display_order AS displayOrder,
              category, revision, availability_json AS availabilityJson
       FROM custom_reactions
       WHERE is_active = 1 AND is_archived = 0
       ORDER BY display_order, name COLLATE NOCASE`,
    ).all<{
      id: string;
      slug: string;
      name: string;
      accessibleLabel: string;
      emojiFallback: string;
      assetKey: string | null;
      isAnimated: number;
      displayOrder: number;
      category: string | null;
      revision: number;
      availabilityJson: string;
    }>();
    const actor = await getActor().catch(() => null);
    const visible = rows.results.filter((row) => {
      let availability: { scope?: string; teamIds?: unknown } = {};
      try {
        availability = JSON.parse(row.availabilityJson) as typeof availability;
      } catch {
        return false;
      }
      if (availability.scope === "SIGNED_IN") return Boolean(actor);
      if (availability.scope !== "TEAM") return true;
      const teamIds = Array.isArray(availability.teamIds)
        ? availability.teamIds.filter(
            (teamId): teamId is string => typeof teamId === "string",
          )
        : [];
      return Boolean(
        actor && teamIds.some((teamId) => actor.teamIds.includes(teamId)),
      );
    });
    return json(
      requestId,
      {
        data: visible.map((row) => ({
          key: row.slug,
          label: row.accessibleLabel,
          emoji: row.emojiFallback,
          assetUrl: row.assetKey
            ? `/api/v1/reaction-asset?id=${encodeURIComponent(row.id)}&v=${row.revision}`
            : null,
          animated: Boolean(row.isAnimated),
          order: Number(row.displayOrder),
          category: row.category,
        })),
      },
      {
        headers: {
          "cache-control": actor ? "private, no-store" : "public, max-age=60",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
