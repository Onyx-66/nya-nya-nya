import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import {
  getCommercialSettingsDocument,
  saveCommercialSettings,
} from "@/lib/server/commercial-settings";
import { requireActor, requireOwner } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const mutationSchema = z.object({
  enabled: z.boolean(),
  expectedRevision: z.coerce.number().int().min(0),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireOwner(actor);
    const document = await getCommercialSettingsDocument();
    return json(
      requestId,
      {
        data: {
          enabled: document.settings.economy.premiumEconomyPublic,
          revision: document.revision,
          updatedAt: document.updatedAt,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireOwner(actor);
    const payload = mutationSchema.parse(await request.json());
    const current = await getCommercialSettingsDocument();
    if (current.revision !== payload.expectedRevision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Lock & Pay changed. Reload the control before trying again.",
      );
    }
    const saved = await saveCommercialSettings(
      {
        ...current.settings,
        economy: {
          ...current.settings.economy,
          premiumEconomyPublic: payload.enabled,
        },
      },
      actor.id,
      requestId,
      payload.expectedRevision,
    );
    return json(
      requestId,
      {
        data: {
          enabled: saved.settings.economy.premiumEconomyPublic,
          revision: saved.revision,
          updatedAt: saved.updatedAt,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
