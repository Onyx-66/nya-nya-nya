import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Store previews are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const itemId = z.string().min(3).max(160).parse(url.searchParams.get("id"));
    const actor = await getActor().catch(() => null);
    const item = await env.DB.prepare(
      `SELECT si.preview_key AS previewKey,
              si.is_published AS isPublished, si.is_hidden AS isHidden,
              si.archived_at AS archivedAt, sc.enabled,
              sc.starts_at AS startsAt, sc.ends_at AS endsAt,
              CASE WHEN ? <> '' AND EXISTS (
                SELECT 1 FROM user_store_items owned
                WHERE owned.user_id = ? AND owned.item_id = si.id
              ) THEN 1 ELSE 0 END AS owned
       FROM store_items si
       JOIN store_collections sc ON sc.id = si.collection_id
       WHERE si.id = ? LIMIT 1`,
    )
      .bind(actor?.id ?? "", actor?.id ?? "", itemId)
      .first<{
        previewKey: string | null;
        isPublished: number;
        isHidden: number;
        archivedAt: string | null;
        enabled: number;
        startsAt: string | null;
        endsAt: string | null;
        owned: number;
      }>();
    const now = Date.now();
    const publicVisible =
      item?.isPublished &&
      !item.isHidden &&
      !item.archivedAt &&
      item.enabled &&
      (!item.startsAt || Date.parse(item.startsAt) <= now) &&
      (!item.endsAt || Date.parse(item.endsAt) > now);
    const administrator =
      actor?.primaryRole === "OWNER" ||
      actor?.primaryRole === "ADMINISTRATOR";
    if (
      !item?.previewKey ||
      (!publicVisible && !item.owned && !administrator)
    ) {
      throw new ApiError(
        404,
        "STORE_PREVIEW_NOT_FOUND",
        "This preview image is not available.",
      );
    }
    const object = await env.BUCKET.get(item.previewKey);
    if (!object) {
      throw new ApiError(
        404,
        "STORE_PREVIEW_NOT_FOUND",
        "This preview image is not available.",
      );
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", "inline");
    headers.set(
      "cache-control",
      publicVisible
        ? "public, max-age=3600, stale-while-revalidate=86400"
        : "private, max-age=300",
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
