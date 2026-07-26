import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse } from "@/lib/server/api";
import {
  assertSameOrigin,
  deleteMediaObject,
  requestIdFor,
  sha256Hex,
  validateImageFile,
} from "@/lib/server/admin-utils";
import { getActor, requireActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_]+$/);
const slotSchema = z.enum(["avatar", "banner"]);
const revisionSchema = z.coerce.number().int().min(1);

const mediaRules = {
  avatar: {
    label: "profile avatar",
    maxBytes: 10 * 1024 * 1024,
    minWidth: 64,
    minHeight: 64,
    maxWidth: 4096,
    maxHeight: 4096,
    maxPixels: 16_000_000,
    allowAnimation: false,
  },
  banner: {
    label: "profile banner",
    maxBytes: 12 * 1024 * 1024,
    minWidth: 320,
    minHeight: 120,
    maxWidth: 8192,
    maxHeight: 4096,
    maxPixels: 32_000_000,
    allowAnimation: false,
  },
} as const;

function extensionFor(contentType: string) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  }[contentType] ?? "bin";
}

async function cleanupIfUnreferenced(
  objectKey: string,
  actorId: string,
  slot: "avatar" | "banner",
  reason: string,
) {
  const column = slot === "avatar" ? "avatar_key" : "banner_key";
  const reference = await env.DB!.prepare(
    `SELECT 1 FROM user_profiles WHERE user_id = ? AND ${column} = ? LIMIT 1`,
  )
    .bind(actorId, objectKey)
    .first();
  if (!reference) {
    await deleteMediaObject(env.DB!, env.BUCKET!, objectKey, {
      mediaKind: `PROFILE_${slot.toUpperCase()}`,
      targetType: "USER_PROFILE",
      targetId: actorId,
      reason,
    });
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Profile media is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const username = usernameSchema.parse(url.searchParams.get("username"));
    const slot = slotSchema.parse(url.searchParams.get("slot"));
    const actor = await getActor().catch(() => null);
    const adminAccess =
      url.searchParams.get("admin") === "1" &&
      Boolean(
        actor &&
          ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(
            actor.primaryRole,
          ),
      );
    const profile = await env.DB.prepare(
      `SELECT up.user_id AS userId, up.profile_visibility AS visibility,
              CASE WHEN ? = 'avatar' THEN up.avatar_key ELSE up.banner_key END
                AS objectKey,
              u.status
         FROM user_profiles up
         JOIN users u ON u.id = up.user_id
        WHERE up.normalized_username = ?
        LIMIT 1`,
    )
      .bind(slot, username.toLowerCase())
      .first<{
        userId: string;
        visibility: string;
        objectKey: string | null;
        status: string;
      }>();
    const isSelf = actor?.id === profile?.userId;
    if (
      !profile ||
      !profile.objectKey ||
      profile.status !== "ACTIVE" ||
      (!isSelf && !adminAccess && profile.visibility !== "PUBLIC")
    ) {
      throw new ApiError(404, "MEDIA_NOT_FOUND", "Profile media was not found.");
    }
    const object = await env.BUCKET.get(profile.objectKey);
    if (!object) {
      throw new ApiError(404, "MEDIA_NOT_FOUND", "Profile media was not found.");
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set(
      "cache-control",
      isSelf || adminAccess
        ? "private, no-store"
        : "public, max-age=3600, stale-while-revalidate=86400",
    );
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-request-id", requestId);
    if (isSelf || adminAccess) headers.set("vary", "cookie");
    return new Response(object.body, { headers });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Profile media is temporarily unavailable.",
      );
    }
    const form = await request.formData();
    const slot = slotSchema.parse(form.get("slot"));
    const expectedRevision = revisionSchema.parse(form.get("revision"));
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "IMAGE_REQUIRED", "Choose an image to upload.");
    }
    const profile = await env.DB.prepare(
      `SELECT revision, username, avatar_key AS avatarKey,
              banner_key AS bannerKey
         FROM user_profiles
        WHERE user_id = ?
        LIMIT 1`,
    )
      .bind(actor.id)
      .first<{
        revision: number;
        username: string;
        avatarKey: string | null;
        bannerKey: string | null;
      }>();
    if (!profile || Number(profile.revision) !== expectedRevision) {
      throw new ApiError(
        409,
        "PROFILE_CHANGED",
        "Save or reload the profile before changing its media.",
      );
    }
    const verified = await validateImageFile(file, mediaRules[slot]);
    if (
      slot === "avatar" &&
      verified.dimensions.width !== verified.dimensions.height
    ) {
      throw new ApiError(
        422,
        "AVATAR_CROP_REQUIRED",
        "Crop the avatar to a square before saving it.",
      );
    }
    const digest = await sha256Hex(verified.bytes);
    const objectKey =
      `private/profiles/${actor.id}/${slot}/` +
      `${digest.slice(0, 32)}.${extensionFor(verified.contentType)}`;
    const previousKey = slot === "avatar" ? profile.avatarKey : profile.bannerKey;
    if (previousKey === objectKey) {
      return Response.json(
        {
          saved: true,
          unchanged: true,
          revision: expectedRevision,
          url: `/api/v1/profile-media?username=${encodeURIComponent(profile.username)}&slot=${slot}&v=${expectedRevision}`,
        },
        {
          headers: {
            "cache-control": "private, no-store",
            "x-request-id": requestId,
          },
        },
      );
    }
    await env.BUCKET.put(objectKey, verified.bytes, {
      httpMetadata: { contentType: verified.contentType },
      customMetadata: {
        actorId: actor.id,
        slot,
        sha256: digest,
        width: String(verified.dimensions.width),
        height: String(verified.dimensions.height),
      },
    });
    const column = slot === "avatar" ? "avatar_key" : "banner_key";
    const nextRevision = expectedRevision + 1;
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE user_profiles
            SET ${column} = ?, revision = ?, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND revision = ?`,
      ).bind(objectKey, nextRevision, actor.id, expectedRevision),
      env.DB.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, result,
          target_type, target_id, reason, request_id, metadata_json)
         SELECT ?, ?, 'profile.media.update', 'USERS_ROLES', 'PROFILE',
                'SUCCESS', 'USER_PROFILE', ?, ?, ?, ?
          WHERE changes() = 1`,
      ).bind(
        randomId(),
        actor.id,
        actor.id,
        `${slot} replaced`,
        requestId,
        JSON.stringify({
          slot,
          contentType: verified.contentType,
          byteSize: verified.bytes.byteLength,
          width: verified.dimensions.width,
          height: verified.dimensions.height,
        }),
      ),
    ]);
    if (!results[0]?.meta.changes) {
      await cleanupIfUnreferenced(
        objectKey,
        actor.id,
        slot,
        "Uncommitted profile media after a revision conflict",
      );
      throw new ApiError(
        409,
        "PROFILE_CHANGED",
        "This profile changed in another session. Reload before saving media.",
      );
    }
    if (previousKey) {
      await cleanupIfUnreferenced(
        previousKey,
        actor.id,
        slot,
        "Replaced profile media",
      );
    }
    return Response.json(
      {
        saved: true,
        revision: nextRevision,
        url: `/api/v1/profile-media?username=${encodeURIComponent(profile.username)}&slot=${slot}&v=${nextRevision}`,
      },
      {
        headers: {
          "cache-control": "private, no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "MEDIA_UNAVAILABLE",
        "Profile media is temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const slot = slotSchema.parse(url.searchParams.get("slot"));
    const expectedRevision = revisionSchema.parse(
      url.searchParams.get("revision"),
    );
    const column = slot === "avatar" ? "avatar_key" : "banner_key";
    const profile = await env.DB.prepare(
      `SELECT ${column} AS objectKey, revision
         FROM user_profiles WHERE user_id = ? LIMIT 1`,
    )
      .bind(actor.id)
      .first<{ objectKey: string | null; revision: number }>();
    if (!profile || Number(profile.revision) !== expectedRevision) {
      throw new ApiError(
        409,
        "PROFILE_CHANGED",
        "Reload the profile before removing media.",
      );
    }
    if (!profile.objectKey) {
      return Response.json(
        { removed: false, revision: expectedRevision },
        {
          headers: {
            "cache-control": "private, no-store",
            "x-request-id": requestId,
          },
        },
      );
    }
    const nextRevision = expectedRevision + 1;
    const result = await env.DB.prepare(
      `UPDATE user_profiles
          SET ${column} = NULL, revision = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND revision = ?`,
    )
      .bind(nextRevision, actor.id, expectedRevision)
      .run();
    if (!result.meta.changes) {
      throw new ApiError(
        409,
        "PROFILE_CHANGED",
        "This profile changed in another session. Reload before removing media.",
      );
    }
    await cleanupIfUnreferenced(
      profile.objectKey,
      actor.id,
      slot,
      "Removed profile media",
    );
    return Response.json(
      { removed: true, revision: nextRevision },
      {
        headers: {
          "cache-control": "private, no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
