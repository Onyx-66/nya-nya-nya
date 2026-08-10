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
import { requireActor, requireAdminCapability } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  reactionId: z.string().trim().min(3).max(160),
  revision: z.coerce.number().int().min(1),
});

function extension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/gif") return "gif";
  return "webp";
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdminCapability(actor, "comments.moderate.global");
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Reaction media storage is temporarily unavailable.",
      );
    }
    await retryPendingMediaCleanup(env.DB, env.BUCKET);
    const form = await request.formData();
    const payload = inputSchema.parse({
      reactionId: form.get("reactionId"),
      revision: form.get("revision"),
    });
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "IMAGE_REQUIRED", "Choose a reaction image.");
    }
    const image = await validateImageFile(file, {
      label: "reaction",
      maxBytes: 1_250_000,
      minWidth: 24,
      minHeight: 24,
      maxWidth: 512,
      maxHeight: 512,
      allowAnimation: true,
      maxGifFrames: 120,
    });
    if (image.dimensions.width * image.dimensions.height > 262_144) {
      throw new ApiError(
        422,
        "IMAGE_PIXEL_AREA_INVALID",
        "Reaction images may contain at most 262,144 pixels.",
      );
    }
    const current = await env.DB.prepare(
      `SELECT name, asset_key AS assetKey, revision,
              usage_kind AS usageKind
       FROM custom_reactions
       WHERE id = ? AND is_archived = 0 LIMIT 1`,
    )
      .bind(payload.reactionId)
      .first<{
        name: string;
        assetKey: string | null;
        revision: number;
        usageKind: "REACTION" | "COMMENT_GIF";
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "REACTION_NOT_FOUND",
        "This reaction is no longer editable.",
      );
    }
    if (Number(current.revision) !== payload.revision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this reaction. Reload it before replacing media.",
      );
    }
    if (
      current.usageKind === "COMMENT_GIF" &&
      (!image.animated || image.contentType !== "image/gif")
    ) {
      throw new ApiError(
        422,
        "COMMENT_GIF_ANIMATION_REQUIRED",
        "Comment GIF entries require a verified animated GIF file.",
      );
    }
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `reactions/${payload.reactionId}/${randomId()}-${digest.slice(0, 12)}.${extension(image.contentType)}`;
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
        `UPDATE custom_reactions
       SET asset_key = ?, content_type = ?, width = ?, height = ?,
           byte_size = ?, is_animated = ?, revision = revision + 1,
           updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revision = ?`,
      ).bind(
        uploadedKey,
        image.contentType,
        image.dimensions.width,
        image.dimensions.height,
        image.bytes.byteLength,
        image.animated ? 1 : 0,
        actor.id,
        payload.reactionId,
        payload.revision,
      ),
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: "reaction.asset.replace",
          category: "DISCUSSIONS_MODERATION",
          sourceArea: "REACTION_LIBRARY",
          targetType: "REACTION",
          targetId: payload.reactionId,
          targetLabel: current.name,
          metadata: {
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
        mediaKind: "REACTION_ASSET",
        targetType: "REACTION",
        targetId: payload.reactionId,
        reason: "Uncommitted reaction media upload",
      });
      uploadedKey = "";
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this reaction. Reload it before replacing media.",
      );
    }
    uploadedKey = "";
    if (current.assetKey) {
      await deleteMediaObject(env.DB, env.BUCKET, current.assetKey, {
        mediaKind: "REACTION_ASSET",
        targetType: "REACTION",
        targetId: payload.reactionId,
        reason: "Replaced reaction media",
      });
    }
    return json(requestId, {
      data: {
        revision: payload.revision + 1,
        assetUrl: `/api/v1/reaction-asset?id=${encodeURIComponent(payload.reactionId)}&v=${payload.revision + 1}`,
      },
    });
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "REACTION_ASSET",
        targetType: "REACTION",
        targetId: "uncommitted",
        reason: "Failed reaction media upload",
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
    requireAdminCapability(actor, "comments.moderate.global");
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Reaction media storage is temporarily unavailable.",
      );
    }
    await retryPendingMediaCleanup(env.DB, env.BUCKET);
    const url = new URL(request.url);
    const payload = inputSchema.parse({
      reactionId: url.searchParams.get("reactionId"),
      revision: url.searchParams.get("revision"),
    });
    const current = await env.DB.prepare(
      `SELECT cr.name,
              cr.asset_key AS assetKey,
              cr.emoji_fallback AS emojiFallback,
              cr.is_active AS isActive,
              cr.usage_kind AS usageKind,
              (SELECT COUNT(*)
                 FROM discussion_reactions dr
                WHERE dr.reaction = cr.slug) AS reactionUsageCount,
              (SELECT COUNT(*)
                 FROM discussion_comment_gifs dcg
                WHERE dcg.gif_id = cr.id) AS gifUsageCount
       FROM custom_reactions cr
       WHERE cr.id = ? AND cr.is_archived = 0
       LIMIT 1`,
    )
      .bind(payload.reactionId)
      .first<{
        name: string;
        assetKey: string | null;
        emojiFallback: string;
        isActive: number;
        usageKind: "REACTION" | "COMMENT_GIF";
        reactionUsageCount: number;
        gifUsageCount: number;
      }>();
    if (!current) {
      throw new ApiError(
        404,
        "REACTION_NOT_FOUND",
        "This reaction is no longer editable.",
      );
    }
    if (Number(current.gifUsageCount) > 0) {
      throw new ApiError(
        409,
        "COMMENT_GIF_IN_USE",
        "This GIF is used by existing comments and its media must be preserved.",
      );
    }
    if (
      (Boolean(current.isActive) ||
        Number(current.reactionUsageCount) > 0) &&
      !current.emojiFallback.trim()
    ) {
      throw new ApiError(
        409,
        "REACTION_VISUAL_REQUIRED",
        "Deactivate unused reactions or add an emoji fallback before removing this asset.",
      );
    }
    const updateResults = await env.DB.batch([
      env.DB.prepare(
        `UPDATE custom_reactions
       SET asset_key = NULL, content_type = NULL, width = NULL,
           height = NULL, byte_size = NULL, is_animated = 0,
           revision = revision + 1, updated_by_user_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revision = ?
         AND NOT EXISTS (
           SELECT 1
             FROM discussion_comment_gifs historical_gif
            WHERE historical_gif.gif_id = custom_reactions.id
         )
         AND (
           TRIM(COALESCE(emoji_fallback, '')) <> ''
           OR (
             is_active = 0
             AND NOT EXISTS (
               SELECT 1
                 FROM discussion_reactions historical
                WHERE historical.reaction = custom_reactions.slug
             )
           )
         )`,
      ).bind(actor.id, payload.reactionId, payload.revision),
      auditStatement(
        env.DB,
        actor,
        requestId,
        {
          action: "reaction.asset.remove",
          category: "DISCUSSIONS_MODERATION",
          sourceArea: "REACTION_LIBRARY",
          targetType: "REACTION",
          targetId: payload.reactionId,
          targetLabel: current.name,
        },
        "changes() = 1",
      ),
    ]);
    if (!updateResults[0]?.meta.changes) {
      const safety = await env.DB.prepare(
        `SELECT cr.emoji_fallback AS emojiFallback,
                cr.is_active AS isActive,
                cr.usage_kind AS usageKind,
                (SELECT COUNT(*)
                   FROM discussion_reactions dr
                  WHERE dr.reaction = cr.slug) AS reactionUsageCount,
                (SELECT COUNT(*)
                   FROM discussion_comment_gifs dcg
                  WHERE dcg.gif_id = cr.id) AS gifUsageCount
           FROM custom_reactions cr
          WHERE cr.id = ?
          LIMIT 1`,
      )
        .bind(payload.reactionId)
        .first<{
          emojiFallback: string;
          isActive: number;
          usageKind: "REACTION" | "COMMENT_GIF";
          reactionUsageCount: number;
          gifUsageCount: number;
        }>();
      if (Number(safety?.gifUsageCount ?? 0) > 0) {
        throw new ApiError(
          409,
          "COMMENT_GIF_IN_USE",
          "This GIF is used by existing comments and its media must be preserved.",
        );
      }
      if (
        (Boolean(safety?.isActive) ||
          Number(safety?.reactionUsageCount ?? 0) > 0) &&
        !safety?.emojiFallback.trim()
      ) {
        throw new ApiError(
          409,
          "REACTION_VISUAL_REQUIRED",
          "Deactivate unused reactions or add an emoji fallback before removing this asset.",
        );
      }
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this reaction. Reload it before removing media.",
      );
    }
    if (current.assetKey) {
      await deleteMediaObject(env.DB, env.BUCKET, current.assetKey, {
        mediaKind: "REACTION_ASSET",
        targetType: "REACTION",
        targetId: payload.reactionId,
        reason: "Removed reaction media",
      });
    }
    return json(requestId, {
      data: { revision: payload.revision + 1, assetUrl: null },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
