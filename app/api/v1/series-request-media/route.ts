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
import { assertSeriesRequestTeamPermission } from "@/lib/server/series-request-common";
import { requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const mediaSchema = z.object({
  requestId: z.string().trim().min(3).max(160),
  slot: z.enum(["cover", "banner"]),
  revision: z.coerce.number().int().min(1),
});

function dependencies() {
  if (!env.DB || !env.BUCKET) {
    throw new ApiError(
      503,
      "MEDIA_UNAVAILABLE",
      "Series-request media is temporarily unavailable.",
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

async function requestMediaRecord(
  requestId: string,
  actor: Awaited<ReturnType<typeof requireActor>>,
) {
  const { db } = dependencies();
  const row = await db
    .prepare(
      `SELECT id,
              submitting_team_id AS submittingTeamId,
              submitter_user_id AS submitterUserId,
              primary_title AS primaryTitle,
              status,
              revision,
              cover_key AS coverKey,
              banner_key AS bannerKey
         FROM series_requests
        WHERE id = ?
        LIMIT 1`,
    )
    .bind(requestId)
    .first<{
      id: string;
      submittingTeamId: string;
      submitterUserId: string;
      primaryTitle: string;
      status: string;
      revision: number;
      coverKey: string | null;
      bannerKey: string | null;
    }>();
  if (!row) {
    throw new ApiError(
      404,
      "MEDIA_NOT_FOUND",
      "This request image is not available.",
    );
  }
  if (
    actor.primaryRole !== "OWNER" &&
    actor.primaryRole !== "ADMINISTRATOR"
  ) {
    if (row.submitterUserId !== actor.id) {
      await assertSeriesRequestTeamPermission(db, actor, row.submittingTeamId);
    } else {
      await assertSeriesRequestTeamPermission(db, actor, row.submittingTeamId);
    }
  }
  return row;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const { bucket } = dependencies();
    const url = new URL(request.url);
    const query = z
      .object({
        id: z.string().trim().min(3).max(160),
        slot: z.enum(["cover", "banner"]),
      })
      .parse({
        id: url.searchParams.get("id"),
        slot: url.searchParams.get("slot"),
      });
    const current = await requestMediaRecord(query.id, actor);
    const key = query.slot === "cover" ? current.coverKey : current.bannerKey;
    if (!key) {
      throw new ApiError(
        404,
        "MEDIA_NOT_FOUND",
        "This request image is not available.",
      );
    }
    const object = await bucket.get(key);
    if (!object) {
      throw new ApiError(
        404,
        "MEDIA_NOT_FOUND",
        "This request image is not available.",
      );
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", "inline");
    headers.set("cache-control", "private, no-store");
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

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { db, bucket } = dependencies();
    await retryPendingMediaCleanup(db, bucket);
    const form = await request.formData();
    const payload = mediaSchema.parse({
      requestId: form.get("requestId"),
      slot: form.get("slot"),
      revision: form.get("revision"),
    });
    const current = await requestMediaRecord(payload.requestId, actor);
    if (!["DRAFT", "CHANGES_REQUESTED"].includes(current.status)) {
      throw new ApiError(
        409,
        "SERIES_REQUEST_LOCKED",
        "Request media can only be changed while the request is editable.",
      );
    }
    if (Number(current.revision) !== payload.revision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another team member changed this request.",
      );
    }
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
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `series-requests/${payload.requestId}/${payload.slot}-${randomId()}-${digest.slice(0, 16)}.${extensionFor(image.contentType)}`;
    await bucket.put(uploadedKey, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        width: String(image.dimensions.width),
        height: String(image.dimensions.height),
        sha256: digest,
      },
    });
    const column = payload.slot === "cover" ? "cover_key" : "banner_key";
    const results = await db.batch([
      db
        .prepare(
          `UPDATE series_requests
              SET ${column} = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'CHANGES_REQUESTED')`,
        )
        .bind(uploadedKey, payload.requestId, payload.revision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `series.request.${payload.slot}.replace`,
          category: "UPLOADS_IMPORTS",
          sourceArea: "SERIES_REQUEST_MEDIA",
          targetType: "SERIES_REQUEST",
          targetId: payload.requestId,
          targetLabel: current.primaryTitle,
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
    if (!Number(results[0]?.meta.changes ?? 0)) {
      await deleteMediaObject(db, bucket, uploadedKey, {
        mediaKind: `SERIES_REQUEST_${payload.slot.toUpperCase()}`,
        targetType: "SERIES_REQUEST",
        targetId: payload.requestId,
        reason: "Uncommitted request media",
      });
      uploadedKey = "";
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another team member changed this request.",
      );
    }
    uploadedKey = "";
    const oldKey =
      payload.slot === "cover" ? current.coverKey : current.bannerKey;
    if (oldKey) {
      await deleteMediaObject(db, bucket, oldKey, {
        mediaKind: `SERIES_REQUEST_${payload.slot.toUpperCase()}`,
        targetType: "SERIES_REQUEST",
        targetId: payload.requestId,
        reason: "Replaced request media",
      });
    }
    return json(requestId, {
      data: {
        slot: payload.slot,
        revision: payload.revision + 1,
        url: `/api/v1/series-request-media?id=${encodeURIComponent(payload.requestId)}&slot=${payload.slot}&v=${payload.revision + 1}`,
      },
    });
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "SERIES_REQUEST_MEDIA",
        targetType: "SERIES_REQUEST",
        targetId: "uncommitted",
        reason: "Failed request media upload",
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
    const { db, bucket } = dependencies();
    const url = new URL(request.url);
    const payload = mediaSchema.parse({
      requestId: url.searchParams.get("requestId"),
      slot: url.searchParams.get("slot"),
      revision: url.searchParams.get("revision"),
    });
    const current = await requestMediaRecord(payload.requestId, actor);
    if (!["DRAFT", "CHANGES_REQUESTED"].includes(current.status)) {
      throw new ApiError(
        409,
        "SERIES_REQUEST_LOCKED",
        "Request media can only be removed while the request is editable.",
      );
    }
    const column = payload.slot === "cover" ? "cover_key" : "banner_key";
    const oldKey =
      payload.slot === "cover" ? current.coverKey : current.bannerKey;
    const results = await db.batch([
      db
        .prepare(
          `UPDATE series_requests
              SET ${column} = NULL,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'CHANGES_REQUESTED')`,
        )
        .bind(payload.requestId, payload.revision),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `series.request.${payload.slot}.remove`,
          category: "UPLOADS_IMPORTS",
          sourceArea: "SERIES_REQUEST_MEDIA",
          targetType: "SERIES_REQUEST",
          targetId: payload.requestId,
          targetLabel: current.primaryTitle,
          metadata: { slot: payload.slot },
        },
        "changes() = 1",
      ),
    ]);
    if (!Number(results[0]?.meta.changes ?? 0)) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another team member changed this request.",
      );
    }
    if (oldKey) {
      await deleteMediaObject(db, bucket, oldKey, {
        mediaKind: `SERIES_REQUEST_${payload.slot.toUpperCase()}`,
        targetType: "SERIES_REQUEST",
        targetId: payload.requestId,
        reason: "Removed request media",
      });
    }
    return json(requestId, {
      data: {
        slot: payload.slot,
        revision: payload.revision + 1,
        url: null,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
