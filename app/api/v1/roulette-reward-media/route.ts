import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  key: z.string().trim().min(20).max(320),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Reward images are temporarily unavailable.",
      );
    }
    const key = querySchema.parse({
      key: new URL(request.url).searchParams.get("key"),
    }).key;
    if (!key.startsWith("roulette/rewards/") || key.includes("..")) {
      throw new ApiError(404, "REWARD_MEDIA_NOT_FOUND", "Reward image not found.");
    }
    const object = await env.BUCKET.get(key);
    if (!object) {
      throw new ApiError(404, "REWARD_MEDIA_NOT_FOUND", "Reward image not found.");
    }
    return new Response(object.body, {
      headers: {
        "content-type":
          object.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
        etag: object.httpEtag,
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
