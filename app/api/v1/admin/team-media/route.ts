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
  teamId: z.string().trim().min(3).max(160),
  slot: z.enum(["logo", "banner", "badge"]),
  revision: z.coerce.number().int().min(1),
});

function dependencies() {
  if (!env.DB || !env.BUCKET) {
    throw new ApiError(
      503,
      "MEDIA_UNAVAILABLE",
      "Team media storage is temporarily unavailable.",
    );
  }
  return { db: env.DB, bucket: env.BUCKET };
}

function extension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

function columnFor(slot: z.infer<typeof inputSchema>["slot"]) {
  if (slot === "logo") return "logo_key";
  if (slot === "banner") return "banner_key";
  return "staff_badge_key";
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
    const payload = inputSchema.parse({
      teamId: form.get("teamId"),
      slot: form.get("slot"),
      revision: form.get("revision"),
    });
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "IMAGE_REQUIRED", "Choose an image to upload.");
    }
    const image = await validateImageFile(file, {
      label: `team ${payload.slot}`,
      maxBytes: payload.slot === "banner" ? 12_000_000 : 5_000_000,
      minWidth: payload.slot === "banner" ? 800 : payload.slot === "badge" ? 24 : 128,
      minHeight: payload.slot === "banner" ? 260 : payload.slot === "badge" ? 24 : 128,
      maxWidth: payload.slot === "badge" ? 512 : 8_000,
      maxHeight: payload.slot === "badge" ? 512 : 8_000,
      allowAnimation: false,
      allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
    });
    const ratio = image.dimensions.width / image.dimensions.height;
    if (
      (payload.slot === "banner" && (ratio < 1.8 || ratio > 4)) ||
      (payload.slot !== "banner" && (ratio < 0.75 || ratio > 1.34))
    ) {
      throw new ApiError(
        422,
        "IMAGE_ASPECT_INVALID",
        payload.slot === "banner"
          ? "Team banners should use a wide landscape aspect ratio."
          : "Team logos and badges should be approximately square.",
      );
    }
    const column = columnFor(payload.slot);
    const current = await db
      .prepare(
        `SELECT name, revision, created_by_user_id AS createdByUserId,
                verification_status AS verificationStatus, is_archived AS isArchived,
                EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = teams.id AND tm.user_id = ? AND tm.membership_role = 'OWNER' AND tm.status = 'PENDING') AS pendingOwner,
                ${column} AS oldKey
         FROM teams WHERE id = ? LIMIT 1`,
      )
      .bind(actor.id, payload.teamId)
      .first<{ name: string; revision: number; createdByUserId: string | null; verificationStatus: string; isArchived: number; pendingOwner: number; oldKey: string | null }>();
    if (!current) {
      throw new ApiError(404, "TEAM_NOT_FOUND", "This team no longer exists.");
    }
    const communityEditor = !current.isArchived && (
      (current.verificationStatus === "VERIFIED" && actor.managedTeamIds.includes(payload.teamId)) ||
      (current.verificationStatus === "PENDING" && current.createdByUserId === actor.id && Boolean(current.pendingOwner))
    );
    if (!communityEditor) requireAdminCapability(actor, "content.teams.manage");
    const adminOverride = !communityEditor;
    if (Number(current.revision) !== payload.revision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this team. Reload it before replacing media.",
      );
    }
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `teams/${payload.teamId}/${payload.slot}/${randomId()}-${digest.slice(0, 12)}.${extension(image.contentType)}`;
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
    const updateResults = await db.batch([
      db.prepare(
        `UPDATE teams SET ${column} = ?, revision = revision + 1,
                          updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revision = ?
           AND (
             ? = 1
             OR (is_archived = 0 AND (
               (verification_status = 'PENDING' AND created_by_user_id = ?
                 AND EXISTS (SELECT 1 FROM team_memberships caller
                   WHERE caller.team_id = teams.id AND caller.user_id = ?
                     AND caller.membership_role = 'OWNER' AND caller.status = 'PENDING'))
               OR
               (verification_status = 'VERIFIED'
                 AND EXISTS (SELECT 1 FROM team_memberships caller
                   WHERE caller.team_id = teams.id AND caller.user_id = ?
                     AND caller.membership_role IN ('OWNER', 'LEADER') AND caller.status = 'ACTIVE'))
             ))
           )`,
      ).bind(uploadedKey, payload.teamId, payload.revision, adminOverride ? 1 : 0, actor.id, actor.id, actor.id),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `team.${payload.slot}.replace`,
          category: "TEAMS_PERMISSIONS",
          sourceArea: "TEAM_MEDIA",
          targetType: "TEAM",
          targetId: payload.teamId,
          targetLabel: current.name,
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
    if (!updateResults[0]?.meta.changes) {
      await deleteMediaObject(db, bucket, uploadedKey, {
        mediaKind: `TEAM_${payload.slot.toUpperCase()}`,
        targetType: "TEAM",
        targetId: payload.teamId,
        reason: "Uncommitted team media upload",
      });
      uploadedKey = "";
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this team. Reload it before replacing media.",
      );
    }
    uploadedKey = "";
    if (current.oldKey) {
      await deleteMediaObject(db, bucket, current.oldKey, {
        mediaKind: `TEAM_${payload.slot.toUpperCase()}`,
        targetType: "TEAM",
        targetId: payload.teamId,
        reason: "Replaced team media",
      });
    }
    return json(requestId, {
      data: {
        slot: payload.slot,
        revision: payload.revision + 1,
        url: `/api/v1/team-media?id=${encodeURIComponent(payload.teamId)}&slot=${payload.slot}&v=${payload.revision + 1}`,
      },
    });
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "TEAM_MEDIA",
        targetType: "TEAM",
        targetId: "uncommitted",
        reason: "Failed team media upload",
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
    await retryPendingMediaCleanup(db, bucket);
    const url = new URL(request.url);
    const payload = inputSchema.parse({
      teamId: url.searchParams.get("teamId"),
      slot: url.searchParams.get("slot"),
      revision: url.searchParams.get("revision"),
    });
    const column = columnFor(payload.slot);
    const current = await db
      .prepare(
        `SELECT name, created_by_user_id AS createdByUserId,
                verification_status AS verificationStatus, is_archived AS isArchived,
                EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = teams.id AND tm.user_id = ? AND tm.membership_role = 'OWNER' AND tm.status = 'PENDING') AS pendingOwner,
                ${column} AS oldKey
         FROM teams WHERE id = ? LIMIT 1`,
      )
      .bind(actor.id, payload.teamId)
      .first<{ name: string; createdByUserId: string | null; verificationStatus: string; isArchived: number; pendingOwner: number; oldKey: string | null }>();
    if (!current) {
      throw new ApiError(404, "TEAM_NOT_FOUND", "This team no longer exists.");
    }
    const communityEditor = !current.isArchived && (
      (current.verificationStatus === "VERIFIED" && actor.managedTeamIds.includes(payload.teamId)) ||
      (current.verificationStatus === "PENDING" && current.createdByUserId === actor.id && Boolean(current.pendingOwner))
    );
    if (!communityEditor) requireAdminCapability(actor, "content.teams.manage");
    const adminOverride = !communityEditor;
    const updateResults = await db.batch([
      db.prepare(
        `UPDATE teams SET ${column} = NULL, revision = revision + 1,
                          updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revision = ?
           AND (
             ? = 1
             OR (is_archived = 0 AND (
               (verification_status = 'PENDING' AND created_by_user_id = ?
                 AND EXISTS (SELECT 1 FROM team_memberships caller
                   WHERE caller.team_id = teams.id AND caller.user_id = ?
                     AND caller.membership_role = 'OWNER' AND caller.status = 'PENDING'))
               OR
               (verification_status = 'VERIFIED'
                 AND EXISTS (SELECT 1 FROM team_memberships caller
                   WHERE caller.team_id = teams.id AND caller.user_id = ?
                     AND caller.membership_role IN ('OWNER', 'LEADER') AND caller.status = 'ACTIVE'))
             ))
           )`,
      ).bind(payload.teamId, payload.revision, adminOverride ? 1 : 0, actor.id, actor.id, actor.id),
      auditStatement(
        db,
        actor,
        requestId,
        {
          action: `team.${payload.slot}.remove`,
          category: "TEAMS_PERMISSIONS",
          sourceArea: "TEAM_MEDIA",
          targetType: "TEAM",
          targetId: payload.teamId,
          targetLabel: current.name,
          metadata: { slot: payload.slot },
        },
        "changes() = 1",
      ),
    ]);
    if (!updateResults[0]?.meta.changes) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "Another administrator changed this team. Reload it before removing media.",
      );
    }
    if (current.oldKey) {
      await deleteMediaObject(db, bucket, current.oldKey, {
        mediaKind: `TEAM_${payload.slot.toUpperCase()}`,
        targetType: "TEAM",
        targetId: payload.teamId,
        reason: "Removed team media",
      });
    }
    return json(requestId, {
      data: { slot: payload.slot, revision: payload.revision + 1, url: null },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
