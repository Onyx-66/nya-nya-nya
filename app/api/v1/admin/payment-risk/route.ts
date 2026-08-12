import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { paymentRiskSnapshot } from "@/lib/server/payments/adverse-events";
import { requireActor, requireAdminCapability } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(10).max(100).default(25),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdminCapability(actor, "finance.transactions.read");
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Payment risk records are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const query = querySchema.parse({
      q: url.searchParams.get("q") ?? "",
      page: url.searchParams.get("page") ?? 1,
      limit: url.searchParams.get("limit") ?? 25,
    });
    return json(requestId, await paymentRiskSnapshot(env.DB, query), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
