import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, deleteMediaObject, requestIdFor, sha256Hex, validateImageFile } from "@/lib/server/admin-utils";
import { actorHasCapability, getActor, requireActor, requireAdminCapability } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

function dependencies() {
  if (!env.DB || !env.BUCKET) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Floating ad media is unavailable.");
  return { db: env.DB, bucket: env.BUCKET };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const { db, bucket } = dependencies();
    const id = z.string().trim().min(3).max(160).parse(new URL(request.url).searchParams.get("id"));
    const row = await db.prepare("SELECT image_key AS imageKey, is_active AS isActive FROM floating_ads WHERE id = ? LIMIT 1").bind(id).first<{ imageKey: string | null; isActive: number }>();
    if (!row?.imageKey) throw new ApiError(404, "MEDIA_NOT_FOUND", "This ad image is not available.");
    if (!row.isActive) {
      const actor = await getActor().catch(() => null);
      if (!actor || !actor.adminMfaEnrolled || !actorHasCapability(actor, "announcements.manage")) throw new ApiError(404, "MEDIA_NOT_FOUND", "This ad image is not available.");
    }
    const object = await bucket.get(row.imageKey);
    if (!object) throw new ApiError(404, "MEDIA_NOT_FOUND", "This ad image is not available.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("cache-control", row.isActive ? "public, max-age=300" : "private, no-store");
    headers.set("content-disposition", "inline");
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
    requireAdminCapability(actor, "announcements.manage");
    const { db, bucket } = dependencies();
    const form = await request.formData();
    const payload = z.object({ id: z.string().trim().min(3).max(160), revision: z.coerce.number().int().min(1) }).parse({ id: form.get("id"), revision: form.get("revision") });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(422, "IMAGE_REQUIRED", "Choose an advertising image.");
    const image = await validateImageFile(file, { label: "floating ad", maxBytes: 8_000_000, minWidth: 500, minHeight: 400, maxWidth: 8_000, maxHeight: 8_000, allowAnimation: false, allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]) });
    const current = await db.prepare("SELECT image_key AS imageKey, revision FROM floating_ads WHERE id = ? LIMIT 1").bind(payload.id).first<{ imageKey: string | null; revision: number }>();
    if (!current) throw new ApiError(404, "AD_NOT_FOUND", "This floating ad no longer exists.");
    if (Number(current.revision) !== payload.revision) throw new ApiError(409, "STALE_VERSION", "This floating ad changed. Reload and try again.");
    const digest = await sha256Hex(image.bytes);
    const extension = image.contentType === "image/jpeg" ? "jpg" : image.contentType === "image/png" ? "png" : "webp";
    uploadedKey = `floating-ads/${payload.id}/${randomId()}-${digest.slice(0, 12)}.${extension}`;
    await bucket.put(uploadedKey, image.bytes, { httpMetadata: { contentType: image.contentType, cacheControl: "public, max-age=31536000, immutable" } });
    const result = await db.prepare("UPDATE floating_ads SET image_key = ?, revision = revision + 1, reset_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?").bind(uploadedKey, randomId(), payload.id, payload.revision).run();
    if (!result.meta.changes) { await bucket.delete(uploadedKey); uploadedKey = ""; throw new ApiError(409, "STALE_VERSION", "This floating ad changed. Reload and try again."); }
    uploadedKey = "";
    if (current.imageKey) await deleteMediaObject(db, bucket, current.imageKey, { mediaKind: "FLOATING_AD", targetType: "FLOATING_AD", targetId: payload.id, reason: "Replaced floating ad artwork" });
    return json(requestId, { ok: true, revision: payload.revision + 1 });
  } catch (error) {
    if (uploadedKey && env.BUCKET) await env.BUCKET.delete(uploadedKey).catch(() => undefined);
    return errorResponse(requestId, error);
  }
}
