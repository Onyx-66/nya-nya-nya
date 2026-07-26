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
import { deriveCachedCoverUrl } from "@/lib/server/metadata-import";

export const dynamic = "force-dynamic";

const mediaInputSchema = z.object({
  seriesId: z.string().trim().min(3).max(160),
  slot: z.enum(["cover", "banner", "slider"]),
  revision: z.coerce.number().int().min(1),
});

const importedCoverSchema = z.object({
  seriesId: z.string().trim().min(3).max(160),
  revision: z.number().int().min(1),
  source: z.enum(["MANGADEX", "MANGAUPDATES"]),
  externalId: z.string().trim().min(1).max(160),
  responseHash: z.string().regex(/^[a-f0-9]{64}$/i),
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
  slot: "cover" | "banner" | "slider",
  dimensions: { width: number; height: number },
) {
  const ratio = dimensions.width / dimensions.height;
  const valid =
    slot === "cover"
      ? ratio >= 0.6 && ratio <= 0.75
      : slot === "slider"
        ? ratio >= 0.98 && ratio <= 1.02
        : ratio >= 1.6 && ratio <= 3.5;
  if (!valid) {
    throw new ApiError(
      422,
      "IMAGE_ASPECT_INVALID",
      slot === "cover"
        ? "Cover artwork should use a portrait aspect ratio near 2:3."
        : slot === "slider"
          ? "Slider artwork must use a square 1:1 aspect ratio."
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
      maxBytes: payload.slot === "banner" ? 12_000_000 : 8_000_000,
      minWidth:
        payload.slot === "cover" ? 300 : payload.slot === "slider" ? 600 : 800,
      minHeight:
        payload.slot === "cover" ? 450 : payload.slot === "slider" ? 600 : 300,
      maxWidth: 8_000,
      maxHeight: 10_000,
      allowAnimation: false,
      allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
    });
    validateAspect(payload.slot, image.dimensions);
    const current = await db
      .prepare(
        `SELECT title, revision, cover_key AS coverKey,
                banner_key AS bannerKey, slider_key AS sliderKey
         FROM series WHERE id = ? LIMIT 1`,
      )
      .bind(payload.seriesId)
      .first<{
        title: string;
        revision: number;
        coverKey: string | null;
        bannerKey: string | null;
        sliderKey: string | null;
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
    const column =
      payload.slot === "cover"
        ? "cover_key"
        : payload.slot === "banner"
          ? "banner_key"
          : "slider_key";
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
      payload.slot === "cover"
        ? current.coverKey
        : payload.slot === "banner"
          ? current.bannerKey
          : current.sliderKey;
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

function assertImportedCoverHost(
  source: "MANGADEX" | "MANGAUPDATES",
  value: string,
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      422,
      "IMPORTED_COVER_INVALID",
      "The metadata provider did not return a valid cover.",
    );
  }
  const allowed =
    url.protocol === "https:" &&
    (source === "MANGADEX"
      ? url.hostname === "uploads.mangadex.org"
      : url.hostname === "mangaupdates.com" ||
        url.hostname.endsWith(".mangaupdates.com"));
  if (!allowed) {
    throw new ApiError(
      422,
      "IMPORTED_COVER_HOST_INVALID",
      "The provider cover host is not permitted.",
    );
  }
  return url;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const { db, bucket } = dependencies();
    await retryPendingMediaCleanup(db, bucket);
    const payload = importedCoverSchema.parse(await request.json());
    const cached = await db
      .prepare(
        `SELECT response_json AS responseJson
           FROM metadata_import_cache
          WHERE cache_key = ?
            AND source = ?
            AND external_id = ?
            AND response_hash = ?
          LIMIT 1`,
      )
      .bind(
        `${payload.source}:${payload.externalId}`,
        payload.source,
        payload.externalId,
        payload.responseHash,
      )
      .first<{ responseJson: string }>();
    if (!cached) {
      throw new ApiError(
        409,
        "IMPORT_PREVIEW_STALE",
        "Preview the provider again before importing its cover.",
      );
    }
    const derived = deriveCachedCoverUrl(
      payload.source,
      payload.externalId,
      cached.responseJson,
    );
    if (!derived) {
      throw new ApiError(
        422,
        "IMPORTED_COVER_MISSING",
        "This provider record does not include a cover image.",
      );
    }
    assertImportedCoverHost(payload.source, derived);
    const response = await fetch(derived, {
      headers: {
        accept: "image/jpeg,image/png,image/webp",
        "user-agent": "NyaScans-Metadata/1.2",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body) {
      throw new ApiError(
        503,
        "IMPORTED_COVER_UNAVAILABLE",
        "The provider cover could not be downloaded.",
      );
    }
    assertImportedCoverHost(
      payload.source,
      response.url || derived,
    );
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 8_000_000) {
      throw new ApiError(
        422,
        "IMAGE_TOO_LARGE",
        "The imported cover is larger than 8 MB.",
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 8_000_000) {
      throw new ApiError(
        422,
        "IMAGE_TOO_LARGE",
        "The imported cover is larger than 8 MB.",
      );
    }
    const image = await validateImageFile(
      new File([bytes], "provider-cover", {
        type: response.headers.get("content-type")?.split(";")[0] ?? "",
      }),
      {
        label: "cover",
        maxBytes: 8_000_000,
        minWidth: 300,
        minHeight: 450,
        maxWidth: 8_000,
        maxHeight: 10_000,
        allowAnimation: false,
        allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
      },
    );
    validateAspect("cover", image.dimensions);
    const current = await db
      .prepare(
        `SELECT title, revision, cover_key AS coverKey
           FROM series
          WHERE id = ?
          LIMIT 1`,
      )
      .bind(payload.seriesId)
      .first<{
        title: string;
        revision: number;
        coverKey: string | null;
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
        "Another administrator changed this series. Reload it before importing media.",
      );
    }
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `series/${payload.seriesId}/cover/${randomId()}-${digest.slice(0, 12)}.${extensionFor(image.contentType)}`;
    await bucket.put(uploadedKey, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        width: String(image.dimensions.width),
        height: String(image.dimensions.height),
        sha256: digest,
        source: payload.source,
        externalId: payload.externalId,
      },
    });
    const results = await db.batch([
      db
        .prepare(
          `UPDATE series
              SET cover_key = ?, revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND revision = ?`,
        )
        .bind(uploadedKey, payload.seriesId, payload.revision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: "series.cover.import",
          category: "SERIES_CHAPTERS",
          sourceArea: "SERIES_MEDIA",
          targetType: "SERIES",
          targetId: payload.seriesId,
          targetLabel: current.title,
          metadata: {
            source: payload.source,
            externalId: payload.externalId,
            contentType: image.contentType,
            width: image.dimensions.width,
            height: image.dimensions.height,
            byteSize: image.bytes.byteLength,
          },
        },
        "changes() = 1",
      ),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) === 0) {
      await deleteMediaObject(db, bucket, uploadedKey, {
        mediaKind: "SERIES_COVER",
        targetType: "SERIES",
        targetId: payload.seriesId,
        reason: "Uncommitted imported series cover",
      });
      uploadedKey = "";
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this series. Reload it before importing media.",
      );
    }
    uploadedKey = "";
    if (current.coverKey) {
      await deleteMediaObject(db, bucket, current.coverKey, {
        mediaKind: "SERIES_COVER",
        targetType: "SERIES",
        targetId: payload.seriesId,
        reason: "Replaced series cover from metadata provider",
      });
    }
    return json(requestId, {
      data: {
        slot: "cover",
        revision: payload.revision + 1,
        url: `/api/v1/series-media?id=${encodeURIComponent(payload.seriesId)}&slot=cover&v=${payload.revision + 1}`,
      },
    });
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "SERIES_COVER",
        targetType: "SERIES",
        targetId: "uncommitted",
        reason: "Failed imported series cover",
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
        `SELECT title, revision, cover_key AS coverKey,
                banner_key AS bannerKey, slider_key AS sliderKey
         FROM series WHERE id = ? LIMIT 1`,
      )
      .bind(payload.seriesId)
      .first<{
        title: string;
        revision: number;
        coverKey: string | null;
        bannerKey: string | null;
        sliderKey: string | null;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "SERIES_NOT_FOUND",
        "This series record no longer exists.",
      );
    }
    const oldKey =
      payload.slot === "cover"
        ? current.coverKey
        : payload.slot === "banner"
          ? current.bannerKey
          : current.sliderKey;
    const column =
      payload.slot === "cover"
        ? "cover_key"
        : payload.slot === "banner"
          ? "banner_key"
          : "slider_key";
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
