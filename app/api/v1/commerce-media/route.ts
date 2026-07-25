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
        "Commerce media is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const actor = await getActor().catch(() => null);
    const id = z.string().min(3).max(160).parse(url.searchParams.get("id"));
    const role = z
      .enum(["primary", "banner", "icon"])
      .parse(url.searchParams.get("role"));
    const column =
      role === "primary"
        ? "primary_image_key"
        : role === "banner"
          ? "banner_image_key"
          : "icon_image_key";
    const offer = await env.DB.prepare(
      `SELECT ${column} AS objectKey, lifecycle_status AS status, active,
              starts_at AS startsAt, ends_at AS endsAt,
              archived_at AS archivedAt,
              CASE WHEN ? <> '' AND EXISTS (
                SELECT 1 FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = products.id
                  AND o.user_id = ?
                  AND o.status IN ('PAID', 'COMPLETED')
              ) THEN 1 ELSE 0 END AS purchased
       FROM products WHERE id = ? LIMIT 1`,
    )
      .bind(actor?.id ?? "", actor?.id ?? "", id)
      .first<{
        objectKey: string | null;
        status: string;
        active: number;
        startsAt: string | null;
        endsAt: string | null;
        archivedAt: string | null;
        purchased: number;
      }>();
    if (!offer?.objectKey) {
      throw new ApiError(
        404,
        "MEDIA_NOT_FOUND",
        "This offer image is not available.",
      );
    }
    const now = Date.now();
    const publicVisible =
      Boolean(offer.active) &&
      !offer.archivedAt &&
      ["ACTIVE", "SCHEDULED"].includes(offer.status) &&
      (!offer.startsAt || Date.parse(offer.startsAt) <= now) &&
      (!offer.endsAt || Date.parse(offer.endsAt) > now);
    const administrator =
      actor?.primaryRole === "OWNER" ||
      actor?.primaryRole === "ADMINISTRATOR";
    if (!publicVisible && !administrator && !offer.purchased) {
      throw new ApiError(
        404,
        "MEDIA_NOT_FOUND",
        "This offer image is not available.",
      );
    }
    const object = await env.BUCKET.get(offer.objectKey);
    if (!object) {
      throw new ApiError(
        404,
        "MEDIA_NOT_FOUND",
        "This offer image is not available.",
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
