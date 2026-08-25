import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { createHostedCheckout } from "@/lib/server/payments/checkout";
import { requireActor } from "@/lib/server/policy";
import { requireFeature, requirePaidSystem } from "@/lib/server/feature-flags";

export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  productId: z.string().trim().min(3).max(160),
  billingCycle: z.enum(["MONTHLY", "ANNUAL"]).optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(120)
    .regex(/^[A-Za-z0-9._:-]+$/),
});

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!env.DB) {
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "Checkout storage is unavailable.");
    }
    await requirePaidSystem(env.DB);
    await requireFeature("payments", env.DB);
    const payload = checkoutSchema.parse(await request.json());
    return json(requestId, await createHostedCheckout(env.DB, actor, payload), {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
