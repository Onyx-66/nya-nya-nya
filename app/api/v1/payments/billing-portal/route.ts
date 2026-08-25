import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { createStripeBillingPortalSession } from "@/lib/server/payments/stripe";
import { requireActor } from "@/lib/server/policy";
import { requirePaidSystem } from "@/lib/server/feature-flags";

export const dynamic = "force-dynamic";

const portalSchema = z.object({
  membershipId: z.string().trim().min(8).max(220).optional(),
});

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Membership billing storage is unavailable.",
      );
    }
    await requirePaidSystem(env.DB);
    const rawBody = await request.text();
    let rawPayload: unknown = {};
    if (rawBody.trim()) {
      try {
        rawPayload = JSON.parse(rawBody);
      } catch {
        throw new ApiError(
          400,
          "INVALID_JSON",
          "The billing-management request is not valid JSON.",
        );
      }
    }
    const payload = portalSchema.parse(rawPayload);
    const membership = await env.DB.prepare(
      `SELECT id, provider_customer_id AS providerCustomerId
         FROM user_memberships
        WHERE user_id = ? AND provider = 'STRIPE'
          AND status IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
          AND provider_customer_id IS NOT NULL
          AND (? IS NULL OR id = ?)
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
      .bind(
        actor.id,
        payload.membershipId ?? null,
        payload.membershipId ?? null,
      )
      .first<{ id: string; providerCustomerId: string }>();
    if (!membership) {
      throw new ApiError(
        404,
        "ACTIVE_MEMBERSHIP_NOT_FOUND",
        "No manageable paid membership belongs to this account.",
      );
    }
    const portal = await createStripeBillingPortalSession(
      membership.providerCustomerId,
    );
    return json(
      requestId,
      { membershipId: membership.id, portalUrl: portal.url },
      {
        status: 201,
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
