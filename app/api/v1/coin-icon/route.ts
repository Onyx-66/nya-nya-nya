import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  getCommercialSettingsDocument,
  saveCommercialSettings,
} from "@/lib/server/commercial-settings";
import { assertSameOrigin, requestIdFor, sha256Hex } from "@/lib/server/admin-utils";
import { requireActor, requireOwner } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { getFeatureStates } from "@/lib/server/feature-flags";

export const dynamic = "force-dynamic";

function assertSafeSvg(source: string) {
  const normalized = source.trim();
  const lower = normalized.toLowerCase();
  if (
    !/^<svg(?:\s|>)/i.test(normalized) ||
    !lower.includes("</svg>") ||
    lower.includes("<!doctype") ||
    lower.includes("<script") ||
    lower.includes("<foreignobject") ||
    /\son[a-z]+\s*=/.test(lower) ||
    /(?:href|src)\s*=\s*["']\s*(?:https?:|data:|javascript:|\/\/)/.test(lower) ||
    /url\s*\(\s*["']?\s*(?:https?:|data:|javascript:|\/\/)/.test(lower)
  ) {
    throw new ApiError(
      422,
      "UNSAFE_SVG",
      "Use a self-contained SVG without scripts, event handlers, embedded HTML, or external resources.",
    );
  }
  return normalized;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const document = await getCommercialSettingsDocument();
    const featureStates = env.DB ? await getFeatureStates(env.DB) : null;
    if (
      !document.settings.economy.premiumEconomyPublic ||
      !featureStates?.premium_unlocks.effective
    ) {
      throw new ApiError(
        404,
        "COIN_ICON_NOT_FOUND",
        "No public coin icon is configured.",
      );
    }
    const key = document.settings.economy.coinIconKey;
    if (!key || !env.BUCKET) {
      throw new ApiError(404, "COIN_ICON_NOT_FOUND", "No custom coin icon is configured.");
    }
    const object = await env.BUCKET.get(key);
    if (!object) {
      throw new ApiError(404, "COIN_ICON_NOT_FOUND", "The coin icon is unavailable.");
    }
    return new Response(object.body, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  let newKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireOwner(actor);
    if (!env.BUCKET) {
      throw new ApiError(503, "MEDIA_UNAVAILABLE", "Coin icon storage is unavailable.");
    }
    const form = await request.formData();
    const expectedRevision = z.coerce
      .number()
      .int()
      .min(0)
      .parse(form.get("expectedRevision"));
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "image/svg+xml") {
      throw new ApiError(422, "SVG_REQUIRED", "Choose an SVG coin icon.");
    }
    if (file.size <= 0 || file.size > 128_000) {
      throw new ApiError(413, "SVG_TOO_LARGE", "The SVG icon must be 128 KB or smaller.");
    }
    const source = assertSafeSvg(await file.text());
    const bytes = new TextEncoder().encode(source);
    const digest = await sha256Hex(bytes);
    newKey = `site/economy/coin-icon/${randomId()}-${digest.slice(0, 12)}.svg`;
    await env.BUCKET.put(newKey, bytes, {
      httpMetadata: {
        contentType: "image/svg+xml",
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { sha256: digest, uploadedBy: actor.id },
    });
    const current = await getCommercialSettingsDocument();
    if (current.revision !== expectedRevision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Commercial settings changed. Reload them before replacing the icon.",
      );
    }
    const previousKey = current.settings.economy.coinIconKey;
    const saved = await saveCommercialSettings(
      {
        ...current.settings,
        schemaVersion: 2,
        economy: {
          ...current.settings.economy,
          coinIconKey: newKey,
          coinIconRevision: current.settings.economy.coinIconRevision + 1,
        },
      },
      actor.id,
      requestId,
      expectedRevision,
    );
    if (previousKey) {
      await env.BUCKET.delete(previousKey).catch(() => undefined);
    }
    newKey = "";
    return json(requestId, {
      ...saved,
      iconUrl: `/api/v1/coin-icon?v=${saved.settings.economy.coinIconRevision}`,
    });
  } catch (error) {
    if (newKey && env.BUCKET) {
      await env.BUCKET.delete(newKey).catch(() => undefined);
    }
    return errorResponse(requestId, error);
  }
}
