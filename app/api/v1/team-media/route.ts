import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  id: z.string().trim().min(3).max(160),
  slot: z.enum(["logo", "banner", "badge"]),
});

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Team media is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const query = querySchema.parse({
      id: url.searchParams.get("id"),
      slot: url.searchParams.get("slot"),
    });
    const column =
      query.slot === "logo"
        ? "logo_key"
        : query.slot === "banner"
          ? "banner_key"
          : "staff_badge_key";
    const team = await env.DB.prepare(
      `SELECT ${column} AS objectKey,
              is_archived AS isArchived,
              verification_status AS verificationStatus
       FROM teams WHERE id = ? LIMIT 1`,
    )
      .bind(query.id)
      .first<{
        objectKey: string | null;
        isArchived: number;
        verificationStatus: string;
      }>();
    if (!team?.objectKey) {
      throw new ApiError(
        404,
        "MEDIA_NOT_FOUND",
        "This team image is not available.",
      );
    }
    const publiclyAvailable =
      !team.isArchived && team.verificationStatus === "VERIFIED";
    if (!publiclyAvailable) {
      const actor = await getActor().catch(() => null);
      if (
        !actor ||
        !["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole)
      ) {
        throw new ApiError(
          404,
          "MEDIA_NOT_FOUND",
          "This team image is not available.",
        );
      }
    }
    const object = await env.BUCKET.get(team.objectKey);
    if (!object) {
      throw new ApiError(
        404,
        "MEDIA_NOT_FOUND",
        "This team image is not available.",
      );
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", "inline");
    headers.set(
      "cache-control",
      publiclyAvailable
        ? "public, max-age=0, must-revalidate"
        : "private, no-store",
    );
    headers.set("etag", object.httpEtag);
    headers.set("x-request-id", requestId);
    if (request.headers.get("if-none-match") === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
