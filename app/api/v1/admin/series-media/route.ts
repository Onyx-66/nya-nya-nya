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

const mediaInputSchema = z.object({
  seriesId: z.string().trim().min(3).max(160),
  slot: z.enum(["cover", "banner"]),
  revision: z.coerce.number().int().min(1),
});

function dependencies() {
  if (!env.DB || !env.BUCKET) {
    throw new ApiError(
      503,
      "MEDIA_UNAVAILABLE",
      "Series media storage is temporarily unavailable.",
    );
  }
  return { db: env.DB, bucket: env.BUCKET };
}

function extensionFor(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

function validateAspect(
  slot: "cover" | "banner",
  dimensions: { width: number; height: number },
) {
  const ratio = dimensions.width / dimensions.height;
  const valid =
    slot === "cover"
      ? ratio >= 0.6 && ratio <= 0.75
      : ratio >= 1.6 && ratio <= 3.5;
  if (!valid) {
    throw new ApiError(
      422,
      "IMAGE_ASPECT_INVALID",
      slot === "cover"
        ? "Cover artwork should use a portrait aspect ratio near 2:3."
        : "Banner artwork should use a wide landscape aspect ratio.",
    );
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const { db, bucket } = dependencies();
    await retryPendingMediaCleanup(db, bucket);
    const form = await request.formData();
    const payload = mediaInputSchema.parse({
      seriesId: form.get("seriesId"),
      slot: form.get("slot"),
      revision: form.get("revision"),
    });
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(
        422,
        "IMAGE_REQUIRED",
        "Choose an image to upload.",
      );
    }
    const image = await validateImageFile(file, {
      label: payload.slot,
      maxBytes: payload.slot === "cover" ? 8_000_000 : 12_000_000,
      minWidth: payload.slot === "cover" ? 300 : 800,
      minHeight: payload.slot === "cover" ? 450 : 300,
      maxWidth: 8_000,
      maxHeight: 10_000,
      allowAnimation: false,
      allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
    });
    validateAspect(payload.slot, image.dimensions);
    const current = await db
      .prepare(
        `SELECT title, revision, cover_key AS coverKey, banner_key AS bannerKey
         FROM series WHERE id = ? LIMIT 1`,
      )
      .bind(payload.seriesId)
      .first<{
        title: string;
        revision: number;
        coverKey: string | null;
        bannerKey: string | null;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "SERIES_NOT_FOUND",
        "This series record no longer exists.",
      );
    }
    if (Number(current.revision) !== payload.revision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this series. Reload it before replacing media.",
      );
    }
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `series/${payload.seriesId}/${payload.slot}/${randomId()}-${digest.slice(0, 12)}.${extensionFor(image.contentType)}`;
    await bucket.put(uploadedKey, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        width: String(image.dimensions.width),
        height: String(image.dimensions.height),
        sha256: digest,
      },
    });
    const column = payload.slot === "cover" ? "cover_key" : "banner_key";
    const updateResults = await db.batch([
      db.prepare(
        `UPDATE series
         SET ${column} = ?, revision = revision + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revision = ?`,
      ).bind(uploadedKey, payload.seriesId, payload.revision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `series.${payload.slot}.replace`,
          category: "SERIES_CHAPTERS",
          sourceArea: "SERIES_MEDIA",
          targetType: "SERIES",
          targetId: payload.seriesId,
          targetLabel: current.title,
          metadata: {
            slot: payload.slot,
            contentType: image.contentType,
            width: image.dimensions.width,
            height: image.dimensions.height,
            byteSize: image.bytes.byteLength,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (Number(updateResults[0]?.meta.changes ?? 0) === 0) {
      await deleteMediaObject(db, bucket, uploadedKey, {
        mediaKind: `SERIES_${payload.slot.toUpperCase()}`,
        targetType: "SERIES",
        targetId: payload.seriesId,
        reason: "Uncommitted series media upload",
      });
      uploadedKey = "";
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this series. Reload it before replacing media.",
      );
    }
    // The database now owns this object. Never remove it from the outer
    // recovery path if cleanup or audit delivery fails afterwards.
    uploadedKey = "";
    const oldKey =
      payload.slot === "cover" ? current.coverKey : current.bannerKey;
    if (oldKey) {
      await deleteMediaObject(db, bucket, oldKey, {
        mediaKind: `SERIES_${payload.slot.toUpperCase()}`,
        targetType: "SERIES",
        targetId: payload.seriesId,
        reason: "Replaced series media",
      });
    }
    return json(requestId, {
      data: {
        slot: payload.slot,
        revision: payload.revision + 1,
        url: `/api/v1/series-media?id=${encodeURIComponent(payload.seriesId)}&slot=${payload.slot}&v=${payload.revision + 1}`,
      },
    });
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "SERIES_MEDIA",
        targetType: "SERIES",
        targetId: "uncommitted",
        reason: "Failed series media upload",
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
    const { db, bucket } = dependencies();
    await retryPendingMediaCleanup(db, bucket);
    const url = new URL(request.url);
    const payload = mediaInputSchema.parse({
      seriesId: url.searchParams.get("seriesId"),
      slot: url.searchParams.get("slot"),
      revision: url.searchParams.get("revision"),
    });
    const current = await db
      .prepare(
        `SELECT title, revision, cover_key AS coverKey, banner_key AS bannerKey
         FROM series WHERE id = ? LIMIT 1`,
      )
      .bind(payload.seriesId)
      .first<{
        title: string;
        revision: number;
        coverKey: string | null;
        bannerKey: string | null;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "SERIES_NOT_FOUND",
        "This series record no longer exists.",
      );
    }
    const oldKey =
      payload.slot === "cover" ? current.coverKey : current.bannerKey;
    const column = payload.slot === "cover" ? "cover_key" : "banner_key";
    const updateResults = await db.batch([
      db.prepare(
        `UPDATE series
         SET ${column} = NULL, revision = revision + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revision = ?`,
      ).bind(payload.seriesId, payload.revision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `series.${payload.slot}.remove`,
          category: "SERIES_CHAPTERS",
          sourceArea: "SERIES_MEDIA",
          targetType: "SERIES",
          targetId: payload.seriesId,
          targetLabel: current.title,
          metadata: { slot: payload.slot },
        },
        "changes() = 1",
      ),
    ]);
    if (Number(updateResults[0]?.meta.changes ?? 0) === 0) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this series. Reload it before removing media.",
      );
    }
    if (oldKey) {
      await deleteMediaObject(db, bucket, oldKey, {
        mediaKind: `SERIES_${payload.slot.toUpperCase()}`,
        targetType: "SERIES",
        targetId: payload.seriesId,
        reason: "Removed series media",
      });
    }
    return json(requestId, {
      data: { slot: payload.slot, revision: payload.revision + 1, url: null },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
