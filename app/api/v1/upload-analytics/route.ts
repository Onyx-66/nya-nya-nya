import { env } from "cloudflare:workers";
import { requireActor } from "@/lib/server/policy";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { readUploadAnalytics } from "@/lib/server/upload-analytics";

export async function GET(request: Request) {
  const id = requestIdFor(request);
  try {
    const actor = await requireActor();
    if (!actor.canUseUploadCenter) throw new ApiError(403, "UPLOAD_ACCESS_REQUIRED", "Upload Center access is required.");
    if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Your analytics are temporarily unavailable.");
    const requested = new URL(request.url).searchParams.get("days");
    const days = requested === "7" ? 7 : requested === "90" ? 90 : 30;
    return json(id, await readUploadAnalytics(env.DB, actor.id, days), {
      headers: { "cache-control": "private, no-store", vary: "cookie" },
    });
  } catch (error) { return errorResponse(id, error); }
}
