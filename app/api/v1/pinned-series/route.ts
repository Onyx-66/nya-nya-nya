import { errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { listPublicPinnedSeries } from "@/lib/server/pinned-series";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    return json(
      requestId,
      { data: await listPublicPinnedSeries() },
      {
        headers: {
          "cache-control": "public, max-age=30, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
