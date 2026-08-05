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
import { requireActor, type Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(3).max(160);

type ThumbnailRow = {
  jobId: string;
  itemId: string;
  ownerUserId: string;
  status: string;
  revision: number;
  itemRevision: number;
  thumbnailKey: string | null;
};

function database() {
  if (!env.DB || !env.BUCKET) {
    throw new ApiError(
      503,
      "UPLOAD_MEDIA_UNAVAILABLE",
      "Chapter thumbnail storage is temporarily unavailable.",
    );
  }
  return { db: env.DB, bucket: env.BUCKET };
}

function extension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  return "webp";
}

function liveThumbnailAuthorization(alias: string) {
  return `EXISTS (
    SELECT 1
      FROM users live_actor
     WHERE live_actor.id = ?
       AND live_actor.status = 'ACTIVE'
       AND (
         live_actor.primary_role = 'OWNER'
         OR EXISTS (
           SELECT 1 FROM user_roles live_owner_role
            WHERE live_owner_role.user_id = live_actor.id
              AND live_owner_role.role = 'OWNER'
         )
         OR EXISTS (
             SELECT 1
               FROM team_memberships live_membership
               JOIN teams live_team
                 ON live_team.id = live_membership.team_id
                AND live_membership.user_id = live_actor.id
              WHERE live_membership.team_id = ${alias}.team_id
                AND live_membership.status = 'ACTIVE'
                AND UPPER(live_membership.membership_role) IN
                  ('OWNER', 'LEADER', 'UPLOADER')
                AND (
                  ${alias}.user_id = live_actor.id
                  OR UPPER(live_membership.membership_role) IN
                    ('OWNER', 'LEADER')
                )
                AND live_team.is_archived = 0
                AND live_team.verification_status = 'VERIFIED'
         )
       )
  )
  AND EXISTS (
    SELECT 1
      FROM series live_series
     WHERE live_series.id = ${alias}.series_id
       AND live_series.is_published = 1
       AND live_series.archived_at IS NULL
       AND live_series.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
       AND live_series.rights_status IN
         ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
  )
  AND (
    ${alias}.team_id IS NULL
    OR EXISTS (
      SELECT 1
        FROM teams live_job_team
       WHERE live_job_team.id = ${alias}.team_id
         AND live_job_team.is_archived = 0
         AND live_job_team.verification_status = 'VERIFIED'
    )
  )`;
}

async function loadThumbnail(
  actor: Actor,
  jobId: string,
  itemId: string,
): Promise<ThumbnailRow> {
  const { db } = database();
  const row = await db
    .prepare(
      `SELECT uj.id AS jobId,
              uji.id AS itemId,
              uj.user_id AS ownerUserId,
              uj.status,
              uj.revision,
              uji.revision AS itemRevision,
              uji.thumbnail_key AS thumbnailKey
         FROM upload_jobs uj
         JOIN upload_job_items uji ON uji.job_id = uj.id
        WHERE uj.id = ?
          AND uji.id = ?
          AND ${liveThumbnailAuthorization("uj")}
        LIMIT 1`,
    )
    .bind(jobId, itemId, actor.id)
    .first<ThumbnailRow>();
  if (!row) {
    throw new ApiError(
      404,
      "UPLOAD_ITEM_NOT_FOUND",
      "This upload chapter is unavailable.",
    );
  }
  return row;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor("upload.create");
    const url = new URL(request.url);
    const row = await loadThumbnail(
      actor,
      idSchema.parse(url.searchParams.get("jobId")),
      idSchema.parse(url.searchParams.get("itemId")),
    );
    if (!row.thumbnailKey) {
      throw new ApiError(404, "THUMBNAIL_NOT_FOUND", "No thumbnail is attached.");
    }
    const { bucket } = database();
    const object = await bucket.get(row.thumbnailKey);
    if (!object) {
      throw new ApiError(404, "THUMBNAIL_NOT_FOUND", "The thumbnail is unavailable.");
    }
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "image/webp",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  let uploadedKey = "";
  try {
    assertSameOrigin(request);
    const actor = await requireActor("upload.create");
    const { db, bucket } = database();
    const form = await request.formData();
    const jobId = idSchema.parse(form.get("jobId"));
    const itemId = idSchema.parse(form.get("itemId"));
    const expectedRevision = z.coerce
      .number()
      .int()
      .min(1)
      .parse(form.get("expectedRevision"));
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(422, "THUMBNAIL_REQUIRED", "Choose a chapter thumbnail.");
    }
    const current = await loadThumbnail(actor, jobId, itemId);
    if (!["DRAFT", "UPLOADING", "READY", "FAILED"].includes(current.status)) {
      throw new ApiError(
        409,
        "UPLOAD_NOT_EDITABLE",
        "This upload can no longer accept thumbnail changes.",
      );
    }
    if (current.revision !== expectedRevision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "The upload changed. Reload it before replacing the thumbnail.",
      );
    }
    const image = await validateImageFile(file, {
      label: "chapter thumbnail",
      maxBytes: 1_000_000,
      minWidth: 160,
      minHeight: 160,
      maxWidth: 1_200,
      maxHeight: 1_200,
      maxPixels: 1_440_000,
      allowAnimation: false,
      allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
    });
    if (image.dimensions.width !== image.dimensions.height) {
      throw new ApiError(
        422,
        "THUMBNAIL_NOT_SQUARE",
        "Crop the chapter thumbnail to a 1:1 square.",
      );
    }
    const digest = await sha256Hex(image.bytes);
    uploadedKey = `upload/thumbnails/${jobId}/${itemId}/${randomId()}-${digest.slice(0, 12)}.${extension(image.contentType)}`;
    await bucket.put(uploadedKey, image.bytes, {
      httpMetadata: {
        contentType: image.contentType,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        jobId,
        itemId,
        width: String(image.dimensions.width),
        height: String(image.dimensions.height),
        sha256: digest,
      },
    });

    const token = `thumbnail-${randomId()}`;
    const results = await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO upload_job_media_guards
         (job_id, token)
         SELECT guarded_job.id, ?
           FROM upload_jobs guarded_job
          WHERE guarded_job.id = ?
            AND guarded_job.revision = ?
            AND guarded_job.status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
            AND ${liveThumbnailAuthorization("guarded_job")}`,
      ).bind(
        token,
        jobId,
        expectedRevision,
        actor.id,
      ),
      db.prepare(
        `UPDATE upload_jobs
            SET revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND EXISTS (
              SELECT 1 FROM upload_job_media_guards
               WHERE job_id = ? AND token = ?
            )`,
      ).bind(jobId, expectedRevision, jobId, token),
      db.prepare(
        `UPDATE upload_job_items
            SET thumbnail_key = ?,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND job_id = ?
            AND EXISTS (
              SELECT 1 FROM upload_job_media_guards
               WHERE job_id = ? AND token = ?
            )
            AND EXISTS (
              SELECT 1 FROM upload_jobs
               WHERE id = ? AND revision = ?
            )`,
      ).bind(
        uploadedKey,
        itemId,
        jobId,
        jobId,
        token,
        jobId,
        expectedRevision + 1,
      ),
      db.prepare(
        `DELETE FROM upload_job_media_guards
          WHERE job_id = ? AND token = ?`,
      ).bind(jobId, token),
    ]);
    if (
      Number(results[0]?.meta.changes ?? 0) !== 1 ||
      Number(results[2]?.meta.changes ?? 0) !== 1
    ) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "The upload changed. Reload it before replacing the thumbnail.",
      );
    }
    if (current.thumbnailKey && current.thumbnailKey !== uploadedKey) {
      await deleteMediaObject(db, bucket, current.thumbnailKey, {
        mediaKind: "CHAPTER_THUMBNAIL",
        targetType: "UPLOAD_JOB_ITEM",
        targetId: itemId,
        reason: "Replaced upload chapter thumbnail",
      });
    }
    const response = json(requestId, {
      job: { revision: expectedRevision + 1 },
      item: {
        id: itemId,
        revision: current.itemRevision + 1,
        thumbnailUrl: `/api/v1/upload-job-thumbnail?jobId=${encodeURIComponent(jobId)}&itemId=${encodeURIComponent(itemId)}&v=${current.itemRevision + 1}`,
      },
    });
    uploadedKey = "";
    return response;
  } catch (error) {
    if (uploadedKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, uploadedKey, {
        mediaKind: "CHAPTER_THUMBNAIL",
        targetType: "UPLOAD_JOB_ITEM",
        targetId: "uncommitted",
        reason: "Uncommitted upload chapter thumbnail",
      }).catch(() => undefined);
    }
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("upload.create");
    const payload = z
      .object({
        jobId: idSchema,
        itemId: idSchema,
        expectedRevision: z.coerce.number().int().min(1),
      })
      .parse(await request.json());
    const { db, bucket } = database();
    const current = await loadThumbnail(actor, payload.jobId, payload.itemId);
    if (!["DRAFT", "UPLOADING", "READY", "FAILED"].includes(current.status)) {
      throw new ApiError(
        409,
        "UPLOAD_NOT_EDITABLE",
        "This upload can no longer accept thumbnail changes.",
      );
    }
    if (current.revision !== payload.expectedRevision) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "The upload changed. Reload it before removing the thumbnail.",
      );
    }
    if (!current.thumbnailKey) {
      return json(requestId, {
        job: { revision: current.revision },
        item: {
          id: current.itemId,
          revision: current.itemRevision,
          thumbnailUrl: null,
        },
      });
    }
    const token = `thumbnail-remove-${randomId()}`;
    const results = await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO upload_job_media_guards
         (job_id, token)
         SELECT guarded_job.id, ?
           FROM upload_jobs guarded_job
          WHERE guarded_job.id = ?
            AND guarded_job.revision = ?
            AND guarded_job.status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
            AND ${liveThumbnailAuthorization("guarded_job")}`,
      ).bind(
        token,
        payload.jobId,
        payload.expectedRevision,
        actor.id,
      ),
      db.prepare(
        `UPDATE upload_jobs
            SET revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND EXISTS (
              SELECT 1 FROM upload_job_media_guards
               WHERE job_id = ? AND token = ?
            )`,
      ).bind(
        payload.jobId,
        payload.expectedRevision,
        payload.jobId,
        token,
      ),
      db.prepare(
        `UPDATE upload_job_items
            SET thumbnail_key = NULL,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND job_id = ?
            AND thumbnail_key = ?
            AND EXISTS (
              SELECT 1 FROM upload_job_media_guards
               WHERE job_id = ? AND token = ?
            )
            AND EXISTS (
              SELECT 1 FROM upload_jobs
               WHERE id = ? AND revision = ?
            )`,
      ).bind(
        payload.itemId,
        payload.jobId,
        current.thumbnailKey,
        payload.jobId,
        token,
        payload.jobId,
        payload.expectedRevision + 1,
      ),
      db.prepare(
        `DELETE FROM upload_job_media_guards
          WHERE job_id = ? AND token = ?`,
      ).bind(payload.jobId, token),
    ]);
    if (
      Number(results[0]?.meta.changes ?? 0) !== 1 ||
      Number(results[2]?.meta.changes ?? 0) !== 1
    ) {
      throw new ApiError(
        409,
        "STALE_VERSION",
        "The upload changed. Reload it before removing the thumbnail.",
      );
    }
    await deleteMediaObject(db, bucket, current.thumbnailKey, {
      mediaKind: "CHAPTER_THUMBNAIL",
      targetType: "UPLOAD_JOB_ITEM",
      targetId: payload.itemId,
      reason: "Removed upload chapter thumbnail",
    });
    return json(requestId, {
      job: { revision: payload.expectedRevision + 1 },
      item: {
        id: payload.itemId,
        revision: current.itemRevision + 1,
        thumbnailUrl: null,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
