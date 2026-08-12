import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import {
  claimStripeWebhookEvent,
  fulfillStripeEvent,
  markStripeWebhookFailed,
} from "@/lib/server/payments/fulfillment";
import { verifyStripeEvent } from "@/lib/server/payments/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  let claimedEventId: string | null = null;
  try {
    if (!env.DB) {
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "Payment event storage is unavailable.");
    }
    const signature = request.headers.get("stripe-signature")?.trim();
    if (!signature) {
      throw new ApiError(400, "STRIPE_SIGNATURE_REQUIRED", "The payment signature is missing.");
    }
    const rawBody = await request.text();
    if (!rawBody || new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
      throw new ApiError(413, "STRIPE_EVENT_TOO_LARGE", "The payment event payload is invalid.");
    }
    const verified = await verifyStripeEvent(rawBody, signature);
    const claimed = await claimStripeWebhookEvent(
      env.DB,
      verified.event,
      verified.payloadSha256,
    );
    if (!claimed) {
      return json(requestId, { received: true, duplicate: true }, {
        headers: { "cache-control": "no-store" },
      });
    }
    claimedEventId = verified.event.id;
    const status = await fulfillStripeEvent(env.DB, verified.event);
    return json(requestId, { received: true, duplicate: false, status }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (env.DB && claimedEventId) {
      await markStripeWebhookFailed(env.DB, claimedEventId, error).catch(() => undefined);
    }
    return errorResponse(requestId, error);
  }
}

