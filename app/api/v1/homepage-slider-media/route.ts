import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  deleteMediaObject,
  requestIdFor,
  sha256Hex,
  validateImageFile,
} from "@/lib/server/admin-utils";
import { actorHasCapability, getActor, requireActor, requireAdminCapability } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { publicPaidSeriesPredicate } from "@/lib/server/public-content-visibility";

export const dynamic = "force-dynamic";

function dependencies() {
  if (!env.DB || !env.BUCKET) {
    throw new ApiError(503, "MEDIA_UNAVAILABLE", "Slider media is unavailable.");
  }
  return { db: env.DB, bucket: env.BUCKET };
}

function extensionFor(contentType: string) {
  return contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const { db, bucket } = dependencies();
    const id = z.string().trim().min(3).max(160).parse(new URL(request.url).searchParams.get("id"));
    const row = await db.prepare(
      `SELECT hs.image_key AS imageKey, hs.is_active AS isActive
         FROM homepage_sliders hs
         LEFT JOIN series s ON s.id = hs.series_id
        WHERE hs.id = ?
          AND (hs.series_id IS NULL OR ${publicPaidSeriesPredicate("s")})
        LIMIT 1`,
    ).bind(id).first<{ imageKey: string | null; isActive: number }>();
    if (!row?.imageKey) throw new ApiError(404, "MEDIA_NOT_FOUND", "This slider image is not available.");
    if (!row.isActive) {
      const actor = await getActor().catch(() => null);
      if (!actor || !actor.adminPasskeyEnrolled || !actorHasCapability(actor, "content.sliders.manage")) {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "This slider image is not available.");
      }
    }
    const object = await bucket.get(row.imageKey);
    if (!object) throw new ApiError(404, "MEDIA_NOT_FOUND", "This slider image is not available.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", "inline");
    headers.set("cache-control", "private, no-store");
    headers.set("etag", object.httpEtag);
    headers.set("x-request-id", requestId);
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.sliders.manage");
    const { db, bucket } = dependencies();
    const form = await request.formData();
    const payload = z.object({
      id: z.string().trim().min(3).max(160),
      revision: z.coerce.number().int().min(1),
    }).parse({ id: form.get("id"), revision: form.get("revision") });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(422, "IMAGE_REQUIRED", "Choose a slider image.");
    const image = await validateImageFile(file, {
      label: "slider",
      maxBytes: 12_000_000,
      minWidth: 900,
      minHeight: 500,
      maxWidth: 8_000,
      maxHeight: 8_000,
      allowAnimation: false,
      allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
    });
    const ratio = image.dimensions.width / image.dimensions.height;
    if (ratio < 1.35 || ratio > 2.8) throw new ApiError(422, "IMAGE_ASPECT_INVALID", "Slider artwork should use a wide landscape aspect ratio.");
    const current = await db.prepare(
      "SELECT title, image_key AS imageKey, revision FROM homepage_sliders WHERE id = ? LIMIT 1",
    ).bind(payload.id).first<{ title: string; imageKey: string | null; revision: number }>();
    if (!current) throw new ApiError(404, "SLIDER_NOT_FOUND", "This slider no longer exists.");
    if (Number(current.revision) !== payload.revision) throw new ApiError(409, "STALE_VERSION", "Another administrator changed this slider.");
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `sliders/${payload.id}/${randomId()}-${digest.slice(0, 12)}.${extensionFor(image.contentType)}`;
    await bucket.put(uploadedKey, image.bytes, {
      httpMetadata: { contentType: image.contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { width: String(image.dimensions.width), height: String(image.dimensions.height), sha256: digest },
    });
    const update = await db.prepare(
      "UPDATE homepage_sliders SET image_key = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?",
    ).bind(uploadedKey, payload.id, payload.revision).run();
    if (!update.meta.changes) {
      await bucket.delete(uploadedKey);
      uploadedKey = "";
      throw new ApiError(409, "STALE_VERSION", "Another administrator changed this slider.");
    }
    const ownedKey = uploadedKey;
    uploadedKey = "";
    if (current.imageKey) {
      await deleteMediaObject(db, bucket, current.imageKey, {
        mediaKind: "HOMEPAGE_SLIDER",
        targetType: "HOMEPAGE_SLIDER",
        targetId: payload.id,
        reason: "Replaced slider artwork",
      });
    }
    return json(requestId, { data: { revision: payload.revision + 1, imageUrl: `/api/v1/homepage-slider-media?id=${encodeURIComponent(payload.id)}&v=${payload.revision + 1}`, objectKeyOwned: Boolean(ownedKey) } });
  } catch (error) {
    if (uploadedKey && env.BUCKET) await env.BUCKET.delete(uploadedKey).catch(() => undefined);
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "content.sliders.manage");
    const { db, bucket } = dependencies();
    const payload = z.object({ id: z.string().trim().min(3).max(160), revision: z.coerce.number().int().min(1) }).parse(await request.json());
    const current = await db.prepare(
      "SELECT image_key AS imageKey FROM homepage_sliders WHERE id = ? AND revision = ? LIMIT 1",
    ).bind(payload.id, payload.revision).first<{ imageKey: string | null }>();
    if (!current) throw new ApiError(409, "STALE_VERSION", "This slider changed. Reload and try again.");
    const result = await db.prepare(
      "UPDATE homepage_sliders SET image_key = NULL, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?",
    ).bind(payload.id, payload.revision).run();
    if (!result.meta.changes) throw new ApiError(409, "STALE_VERSION", "This slider changed. Reload and try again.");
    if (current.imageKey) await deleteMediaObject(db, bucket, current.imageKey, { mediaKind: "HOMEPAGE_SLIDER", targetType: "HOMEPAGE_SLIDER", targetId: payload.id, reason: "Removed slider artwork" });
    return json(requestId, { ok: true, revision: payload.revision + 1 });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
