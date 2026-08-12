import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import {
  recordVerifiedAdReward,
  verifyAdRewardCallback,
} from "@/lib/server/ad-unlocks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Ad reward verification is temporarily unavailable.",
      );
    }
    const timestamp = request.headers.get("x-ad-reward-timestamp")?.trim();
    const signature = request.headers.get("x-ad-reward-signature")?.trim();
    if (!timestamp || !signature) {
      throw new ApiError(
        401,
        "AD_REWARD_SIGNATURE_REQUIRED",
        "The ad reward callback signature is missing.",
      );
    }
    const rawBody = await request.text();
    const payload = await verifyAdRewardCallback(
      rawBody,
      timestamp,
      signature,
    );
    return json(
      requestId,
      await recordVerifiedAdReward(env.DB, payload),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
