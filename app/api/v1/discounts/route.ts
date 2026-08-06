import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { listPublicDiscounts } from "@/lib/server/content-discounts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const sort = z
      .enum(["discount", "expiry"])
      .catch("discount")
      .parse(new URL(request.url).searchParams.get("sort"));
    return json(
      requestId,
      { data: await listPublicDiscounts(sort), sort },
      {
        headers: {
          "cache-control": "public, max-age=20, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    const hidden =
      error instanceof ApiError && error.code === "PAID_ECONOMY_HIDDEN";
    return errorResponse(
      requestId,
      hidden
        ? new ApiError(
            404,
            "DISCOUNTS_UNAVAILABLE",
            "Discounts are not available while paid content is disabled.",
          )
        : error,
    );
  }
}
