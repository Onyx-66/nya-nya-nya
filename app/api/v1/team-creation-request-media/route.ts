import { ApiError, errorResponse } from "@/lib/server/api";
import { getActor } from "@/lib/server/policy";
import { requestIdFor } from "@/lib/server/admin-utils";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Team request media is temporarily unavailable.");
    const actor = await getActor();
    if (!actor) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to view team request media.");
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    const slot = url.searchParams.get("slot");
    if (!id || (slot !== "logo" && slot !== "banner")) throw new ApiError(400, "INVALID_MEDIA_REQUEST", "A request id and media slot are required.");
    const row = await env.DB.prepare(
      `SELECT requested_by_user_id AS requesterId,
              ${slot === "logo" ? "logo_key" : "banner_key"} AS objectKey
         FROM team_creation_requests WHERE id = ? LIMIT 1`,
    ).bind(id).first<{ requesterId: string; objectKey: string | null }>();
    const isAdmin = ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(actor.primaryRole);
    if (!row || !row.objectKey || (row.requesterId !== actor.id && !isAdmin)) throw new ApiError(404, "MEDIA_NOT_FOUND", "Team request media was not found.");
    const object = await env.BUCKET.get(row.objectKey);
    if (!object) throw new ApiError(404, "MEDIA_NOT_FOUND", "Team request media was not found.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-request-id", requestId);
    return new Response(object.body, { headers });
  } catch (error) { return errorResponse(requestId, error); }
}
