import { env } from "cloudflare:workers";
import { z } from "zod";
import { requestIdFor } from "@/lib/server/admin-utils";
import { ApiError, errorResponse } from "@/lib/server/api";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Series gallery media is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const id = z
      .string()
      .trim()
      .min(3)
      .max(160)
      .parse(url.searchParams.get("id"));
    const asset = await env.DB.prepare(
      `SELECT sga.object_key AS objectKey,
              sga.moderation_status AS moderationStatus,
              sga.submitted_by_user_id AS submittedByUserId,
              s.is_published AS seriesPublished,
              s.archived_at AS seriesArchivedAt,
              s.rights_status AS rightsStatus
         FROM series_gallery_assets sga
         JOIN series s ON s.id = sga.series_id
        WHERE sga.id = ?
        LIMIT 1`,
    )
      .bind(id)
      .first<{
        objectKey: string;
        moderationStatus: "PENDING" | "APPROVED" | "REJECTED";
        submittedByUserId: string;
        seriesPublished: number;
        seriesArchivedAt: string | null;
        rightsStatus: string;
      }>();
    const publiclyAvailable =
      asset?.moderationStatus === "APPROVED" &&
      Boolean(asset.seriesPublished) &&
      !asset.seriesArchivedAt &&
      ["LICENSED", "AUTHORIZED", "DEMO_ORIGINAL", "TEST_ORIGINAL"].includes(
        asset.rightsStatus,
      );
    if (!asset) {
      throw new ApiError(
        404,
        "GALLERY_MEDIA_NOT_FOUND",
        "This gallery image is not available.",
      );
    }
    if (!publiclyAvailable) {
      const actor = await getActor().catch(() => null);
      const roles = new Set(
        actor ? [actor.primaryRole, ...(actor.roles ?? [])] : [],
      );
      if (
        !actor ||
        (actor.id !== asset.submittedByUserId &&
          !roles.has("OWNER") &&
          !roles.has("ADMINISTRATOR"))
      ) {
        throw new ApiError(
          404,
          "GALLERY_MEDIA_NOT_FOUND",
          "This gallery image is not available.",
        );
      }
    }
    const object = await env.BUCKET.get(asset.objectKey);
    if (!object) {
      throw new ApiError(
        404,
        "GALLERY_MEDIA_NOT_FOUND",
        "This gallery image is not available.",
      );
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", "inline");
    headers.set(
      "cache-control",
      publiclyAvailable
        ? "public, max-age=3600, stale-while-revalidate=86400"
        : "private, no-store",
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
