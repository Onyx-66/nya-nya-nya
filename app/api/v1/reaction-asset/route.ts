import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Reaction media is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const id = z.string().min(3).max(160).parse(url.searchParams.get("id"));
    const reaction = await env.DB.prepare(
      "SELECT asset_key AS assetKey FROM custom_reactions WHERE id = ? LIMIT 1",
    )
      .bind(id)
      .first<{ assetKey: string | null }>();
    if (!reaction?.assetKey) {
      throw new ApiError(
        404,
        "REACTION_ASSET_NOT_FOUND",
        "This reaction image is not available.",
      );
    }
    const object = await env.BUCKET.get(reaction.assetKey);
    if (!object) {
      throw new ApiError(
        404,
        "REACTION_ASSET_NOT_FOUND",
        "This reaction image is not available.",
      );
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", "inline");
    headers.set(
      "cache-control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    headers.set("etag", object.httpEtag);
    headers.set("x-request-id", requestId);
    headers.set("x-content-type-options", "nosniff");
    if (request.headers.get("if-none-match") === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
