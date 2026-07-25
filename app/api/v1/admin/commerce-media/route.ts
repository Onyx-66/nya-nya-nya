import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  deleteMediaObject,
  requestIdFor,
  retryPendingMediaCleanup,
  sha256Hex,
  validateImageFile,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdmin } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  productId: z.string().trim().min(3).max(160),
  role: z.enum(["primary", "banner", "icon"]),
  revision: z.coerce.number().int().min(1),
});

function extension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/gif") return "gif";
  return "webp";
}

function columnFor(role: z.infer<typeof inputSchema>["role"]) {
  if (role === "primary") return "primary_image_key";
  if (role === "banner") return "banner_image_key";
  return "icon_image_key";
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Commerce media storage is temporarily unavailable.",
      );
    }
    await retryPendingMediaCleanup(env.DB, env.BUCKET);
    const form = await request.formData();
    const payload = inputSchema.parse({
      productId: form.get("productId"),
      role: form.get("role"),
      revision: form.get("revision"),
    });
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "IMAGE_REQUIRED", "Choose an offer image.");
    }
    const image = await validateImageFile(file, {
      label: `offer ${payload.role}`,
      maxBytes: payload.role === "banner" ? 12_000_000 : 8_000_000,
      minWidth: payload.role === "icon" ? 64 : payload.role === "banner" ? 800 : 400,
      minHeight: payload.role === "icon" ? 64 : payload.role === "banner" ? 260 : 300,
      maxWidth: 8_000,
      maxHeight: 8_000,
      allowAnimation: payload.role !== "banner",
      maxGifFrames: 120,
    });
    if (image.dimensions.width * image.dimensions.height > 32_000_000) {
      throw new ApiError(
        422,
        "IMAGE_PIXEL_AREA_INVALID",
        "Offer images may contain at most 32 million pixels.",
      );
    }
    const column = columnFor(payload.role);
    const current = await env.DB.prepare(
      `SELECT name, revision, ${column} AS oldKey
       FROM products WHERE id = ? LIMIT 1`,
    )
      .bind(payload.productId)
      .first<{ name: string; revision: number; oldKey: string | null }>();
    if (!current) {
      throw new ApiError(
        404,
        "OFFER_NOT_FOUND",
        "This commerce offer no longer exists.",
      );
    }
    if (Number(current.revision) !== payload.revision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this offer. Reload it before replacing media.",
      );
    }
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `commerce/${payload.productId}/${payload.role}/${randomId()}-${digest.slice(0, 12)}.${extension(image.contentType)}`;
    await env.BUCKET.put(uploadedKey, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        width: String(image.dimensions.width),
        height: String(image.dimensions.height),
        sha256: digest,
        animated: String(image.animated),
      },
    });
    const updateResults = await env.DB.batch([
      env.DB.prepare(
        `UPDATE products
       SET ${column} = ?, revision = revision + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revision = ?`,
      ).bind(uploadedKey, payload.productId, payload.revision),
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: `commerce.offer.${payload.role}.replace`,
          category: "COMMERCE_STORE",
          sourceArea: "COMMERCE_MEDIA",
          targetType: "PRODUCT",
          targetId: payload.productId,
          targetLabel: current.name,
          metadata: {
            role: payload.role,
            contentType: image.contentType,
            width: image.dimensions.width,
            height: image.dimensions.height,
            byteSize: image.bytes.byteLength,
            animated: image.animated,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (!updateResults[0]?.meta.changes) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: `COMMERCE_${payload.role.toUpperCase()}`,
        targetType: "PRODUCT",
        targetId: payload.productId,
        reason: "Uncommitted commerce media upload",
      });
      uploadedKey = "";
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this offer. Reload it before replacing media.",
      );
    }
    uploadedKey = "";
    if (current.oldKey) {
      await deleteMediaObject(env.DB, env.BUCKET, current.oldKey, {
        mediaKind: `COMMERCE_${payload.role.toUpperCase()}`,
        targetType: "PRODUCT",
        targetId: payload.productId,
        reason: "Replaced commerce media",
      });
    }
    return json(requestId, {
      data: {
        revision: payload.revision + 1,
        url: `/api/v1/commerce-media?id=${encodeURIComponent(payload.productId)}&role=${payload.role}&v=${payload.revision + 1}`,
      },
    });
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "COMMERCE_MEDIA",
        targetType: "PRODUCT",
        targetId: "uncommitted",
        reason: "Failed commerce media upload",
      });
    }
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Commerce media storage is temporarily unavailable.",
      );
    }
    await retryPendingMediaCleanup(env.DB, env.BUCKET);
    const url = new URL(request.url);
    const payload = inputSchema.parse({
      productId: url.searchParams.get("productId"),
      role: url.searchParams.get("role"),
      revision: url.searchParams.get("revision"),
    });
    const column = columnFor(payload.role);
    const current = await env.DB.prepare(
      `SELECT name, ${column} AS oldKey
       FROM products WHERE id = ? LIMIT 1`,
    )
      .bind(payload.productId)
      .first<{ name: string; oldKey: string | null }>();
    if (!current) {
      throw new ApiError(
        404,
        "OFFER_NOT_FOUND",
        "This commerce offer no longer exists.",
      );
    }
    const updateResults = await env.DB.batch([
      env.DB.prepare(
        `UPDATE products SET ${column} = NULL, revision = revision + 1,
                           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revision = ?`,
      ).bind(payload.productId, payload.revision),
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: `commerce.offer.${payload.role}.remove`,
          category: "COMMERCE_STORE",
          sourceArea: "COMMERCE_MEDIA",
          targetType: "PRODUCT",
          targetId: payload.productId,
          targetLabel: current.name,
          metadata: { role: payload.role },
        },
        "changes() = 1",
      ),
    ]);
    if (!updateResults[0]?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this offer. Reload it before removing media.",
      );
    }
    if (current.oldKey) {
      await deleteMediaObject(env.DB, env.BUCKET, current.oldKey, {
        mediaKind: `COMMERCE_${payload.role.toUpperCase()}`,
        targetType: "PRODUCT",
        targetId: payload.productId,
        reason: "Removed commerce media",
      });
    }
    return json(requestId, {
      data: { revision: payload.revision + 1, url: null },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
