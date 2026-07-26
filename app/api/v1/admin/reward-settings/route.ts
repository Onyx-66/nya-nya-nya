import { env } from "cloudflare:workers";
import { z } from "zod";
import { rewardSettingsSchema } from "@/lib/reward-settings";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import {
  getRewardSettingsDocument,
  saveRewardSettings,
} from "@/lib/server/reward-settings";
import { requireActor, requireAdmin } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  expectedRevision: z.number().int().min(0),
  settings: rewardSettingsSchema,
});

async function responseData() {
  const document = await getRewardSettingsDocument();
  const items = env.DB
    ? await env.DB.prepare(
        `SELECT id, name, category
           FROM store_items
          WHERE is_published = 1
            AND is_hidden = 0
            AND archived_at IS NULL
          ORDER BY name COLLATE NOCASE`,
      ).all<{ id: string; name: string; category: string }>()
    : { results: [] };
  return {
    ...document,
    storeItems: items.results,
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    return json(requestId, await responseData(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = updateSchema.parse(await request.json());
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Reward settings storage is unavailable.",
      );
    }
    const itemIds = payload.settings.rouletteRewards
      .filter((reward) => reward.enabled && reward.type === "STORE_ITEM")
      .map((reward) => reward.itemId)
      .filter((itemId): itemId is string => Boolean(itemId));
    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => "?").join(",");
      const available = await env.DB.prepare(
        `SELECT id
           FROM store_items
          WHERE id IN (${placeholders})
            AND is_published = 1
            AND is_hidden = 0
            AND archived_at IS NULL`,
      )
        .bind(...itemIds)
        .all<{ id: string }>();
      if (new Set(available.results.map((item) => item.id)).size !== itemIds.length) {
        throw new ApiError(
          422,
          "ROULETTE_ITEM_UNAVAILABLE",
          "One or more Roulette Store rewards are not available.",
        );
      }
    }
    await saveRewardSettings(
      payload.settings,
      actor.id,
      requestId,
      payload.expectedRevision,
    );
    return json(requestId, await responseData(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
