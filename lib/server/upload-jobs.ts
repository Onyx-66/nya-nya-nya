import { z } from "zod";
import { normalizeChapterNumber } from "@/lib/chapter-number";
import { canAny } from "@/lib/permissions.mjs";
import {
  normalizeUploadPath,
  UPLOAD_LIMITS,
  type SupportedUploadMethod,
} from "@/lib/uploads";
import {
  auditStatement,
  deleteMediaObject,
  safeFilename,
  sha256Hex,
  validateImageFile,
} from "@/lib/server/admin-utils";
import { ApiError } from "@/lib/server/api";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const uploadCreditsSchema = z.object({
  translator: z.string().trim().max(120).default(""),
  cleaner: z.string().trim().max(120).default(""),
  redrawer: z.string().trim().max(120).default(""),
  typesetter: z.string().trim().max(120).default(""),
  proofreader: z.string().trim().max(120).default(""),
  qualityControl: z.string().trim().max(120).default(""),
});

export const uploadItemInputSchema = z
  .object({
    clientKey: z.string().trim().min(1).max(120),
    sourceLabel: z.string().trim().min(1).max(240),
    volume: z.string().trim().max(40).default(""),
    chapterNumber: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .transform(normalizeChapterNumber),
    title: z.string().trim().max(240).default(""),
    language: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/)
      .default("en"),
    version: z.number().int().min(1).max(99).default(1),
    releaseNotes: z.string().trim().max(2_000).default(""),
    credits: uploadCreditsSchema.default({
      translator: "",
      cleaner: "",
      redrawer: "",
      typesetter: "",
      proofreader: "",
      qualityControl: "",
    }),
    // Missing means an older client/draft explicitly chose its access values.
    // The current Upload Center sends true for newly composed chapters.
    useVisibilityDefault: z.boolean().default(false),
    accessType: z.enum(["FREE", "PAID"]).default("FREE"),
    priceOnyx: z.number().int().min(0).max(100_000).default(0),
    visibility: z.enum(["PUBLIC", "UNLISTED", "HIDDEN"]).default("PUBLIC"),
    scheduledAt: z.string().datetime().nullable().default(null),
    commentsEnabled: z
      .boolean()
      .default(true)
      .transform(() => true),
    includeFixedFirstPage: z.boolean().default(true),
    includeFixedLastPage: z.boolean().default(true),
    replacementChapterId: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .nullable()
      .default(null),
  })
  .superRefine((value, context) => {
    if (
      !value.useVisibilityDefault &&
      value.accessType === "PAID" &&
      value.priceOnyx < 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["priceOnyx"],
        message: "Paid chapters need a premium coin price of at least 1.",
      });
    }
    if (
      !value.useVisibilityDefault &&
      value.accessType === "FREE" &&
      value.priceOnyx !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["priceOnyx"],
        message: "Free chapters cannot have a premium coin price.",
      });
    }
  });

export const createUploadJobSchema = z
  .object({
    kind: z.enum(["SINGLE", "BATCH"]),
    sourceType: z.enum(["DIRECT_IMAGES", "DIRECT_FOLDER"]),
    sourceUrl: z
      .string()
      .url()
      .max(1_000)
      .refine((value) => ["drive.google.com", "docs.google.com"].includes(new URL(value).hostname), "Use a Google Drive folder or ZIP link.")
      .nullable()
      .default(null),
    seriesId: z.string().trim().min(3).max(120),
    teamId: z.string().trim().min(3).max(120),
    idempotencyKey: z.string().trim().min(12).max(160),
    items: z
      .array(uploadItemInputSchema)
      .min(1)
      .max(UPLOAD_LIMITS.maxChaptersPerJob),
  })
  .superRefine((value, context) => {
    if (value.kind === "SINGLE" && value.items.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "A single upload must contain exactly one chapter.",
      });
    }
    const paidPrices = new Set(
      value.items
        .filter(
          (item) =>
            !item.useVisibilityDefault && item.accessType === "PAID",
        )
        .map((item) => item.priceOnyx),
    );
    if (value.kind === "BATCH" && paidPrices.size > 1) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "All paid chapters in a batch must use the same price.",
      });
    }
    const clientKeys = new Set<string>();
    const identities = new Set<string>();
    value.items.forEach((item, index) => {
      const clientKey = item.clientKey.normalize("NFKC").toLowerCase();
      if (clientKeys.has(clientKey)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "clientKey"],
          message: "Chapter row keys must be unique.",
        });
      }
      clientKeys.add(clientKey);
      const identity = [
        item.chapterNumber.toLowerCase(),
        item.language,
        item.version,
      ].join(":");
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "chapterNumber"],
          message:
            "A batch cannot contain the same chapter, language, and version twice.",
        });
      }
      identities.add(identity);
    });
  });

export const uploadJobMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("UPDATE_ITEM"),
    jobId: z.string().min(3).max(120),
    itemId: z.string().min(3).max(120),
    expectedRevision: z.number().int().min(1),
    item: uploadItemInputSchema,
  }),
  z.object({
    action: z.literal("UPDATE_BATCH_COMMERCE"),
    jobId: z.string().min(3).max(120),
    expectedRevision: z.number().int().min(1),
    priceOnyx: z.number().int().min(1).max(100_000),
    paidItemIds: z
      .array(z.string().min(3).max(120))
      .max(UPLOAD_LIMITS.maxChaptersPerJob),
    visibilityDefaultItemIds: z
      .array(z.string().min(3).max(120))
      .max(UPLOAD_LIMITS.maxChaptersPerJob)
      .default([]),
  }),
  z.object({
    action: z.literal("REORDER"),
    jobId: z.string().min(3).max(120),
    itemId: z.string().min(3).max(120),
    expectedRevision: z.number().int().min(1),
    fileIds: z.array(z.string().min(3).max(120)).min(1).max(500),
  }),
  z.object({
    action: z.literal("PUBLISH"),
    jobId: z.string().min(3).max(120),
    expectedRevision: z.number().int().min(1),
    idempotencyKey: z.string().trim().min(12).max(160),
  }),
  z.object({
    action: z.literal("DISCARD"),
    jobId: z.string().min(3).max(120),
    expectedRevision: z.number().int().min(1),
  }),
]);

export const uploadFileMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("DELETE"),
    jobId: z.string().min(3).max(120),
    itemId: z.string().min(3).max(120),
    fileId: z.string().min(3).max(120),
    expectedRevision: z.number().int().min(1),
  }),
  z.object({
    action: z.literal("RETRY"),
    jobId: z.string().min(3).max(120),
    itemId: z.string().min(3).max(120),
    fileId: z.string().min(3).max(120),
    expectedRevision: z.number().int().min(1),
  }),
]);

export function isUploadAdmin(actor: Actor) {
  const roles = new Set([actor.primaryRole, ...(actor.roles ?? [])]);
  return roles.has("OWNER") || roles.has("ADMINISTRATOR");
}

export type UploadRateLimitDetails = Readonly<{
  retryAfterSeconds: number;
}>;

const JOB_RATE_LIMIT = Object.freeze({
  count: 30,
  windowSeconds: 60 * 60,
});

const FILE_BURST_RATE_LIMIT = Object.freeze({
  count: UPLOAD_LIMITS.maxPagesPerChapter + 100,
  bytes: UPLOAD_LIMITS.maxChapterBytes * 4,
  windowSeconds: 60,
});

const FILE_SUSTAINED_RATE_LIMIT = Object.freeze({
  count:
    UPLOAD_LIMITS.maxChaptersPerJob * UPLOAD_LIMITS.maxPagesPerChapter +
    UPLOAD_LIMITS.maxPagesPerChapter * 5,
  bytes:
    UPLOAD_LIMITS.maxJobBytes + UPLOAD_LIMITS.maxChapterBytes * 12,
  windowSeconds: 60 * 60,
});

function boundedRetryAfter(value: unknown, windowSeconds: number) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return windowSeconds;
  }
  return Math.max(1, Math.min(windowSeconds, Math.ceil(seconds)));
}

function uploadRateLimitError(
  kind: "JOB" | "FILE",
  retryAfterSeconds: number,
) {
  const details = {
    retryAfterSeconds,
  } satisfies UploadRateLimitDetails;
  return new ApiError(
    429,
    "UPLOAD_RATE_LIMITED",
    kind === "JOB"
      ? "Too many upload drafts were created. Retry after the suggested delay."
      : "This upload is moving too quickly. Pause the queue and retry after the suggested delay.",
    undefined,
    details,
  );
}

function normalizedUploadAttemptBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ApiError(
      422,
      "UPLOAD_ATTEMPT_SIZE_INVALID",
      "The upload attempt size is invalid.",
    );
  }
  return Math.min(Math.ceil(value), UPLOAD_LIMITS.maxPageBytes);
}

function cleanupUploadRateLimitAttemptsStatement(
  db: D1Database,
  actorId: string,
) {
  return db
    .prepare(
      `DELETE FROM upload_rate_limit_attempts
        WHERE user_id = ?
          AND created_at < datetime('now', '-1 day')`,
    )
    .bind(actorId);
}

export async function reserveUploadRateLimitAttempt(
  db: D1Database,
  actor: Actor,
  input: {
    jobId: string;
    itemId: string;
    requestId: string;
    byteSize: number;
  },
) {
  const byteSize = normalizedUploadAttemptBytes(input.byteSize);
  const results = await db.batch<{ admitted: number }>([
    cleanupUploadRateLimitAttemptsStatement(db, actor.id),
    db
      .prepare(
        `WITH usage AS (
           SELECT
             COALESCE(SUM(
               CASE
                 WHEN created_at >= datetime('now', '-1 minute') THEN 1
                 ELSE 0
               END
             ), 0) AS burst_count,
             COALESCE(SUM(
               CASE
                 WHEN created_at >= datetime('now', '-1 minute')
                   THEN byte_size
                 ELSE 0
               END
             ), 0) AS burst_bytes,
             COUNT(*) AS sustained_count,
             COALESCE(SUM(byte_size), 0) AS sustained_bytes
            FROM upload_rate_limit_attempts
           WHERE user_id = ?
             AND created_at >= datetime('now', '-1 hour')
         )
         INSERT INTO upload_rate_limit_attempts
         (id, user_id, upload_job_id, upload_job_item_id, request_id, byte_size,
          admitted)
         SELECT ?, ?, ?, ?, ?, ?, CASE
                  WHEN burst_bytes + ? <= ?
                   AND sustained_bytes + ? <= ?
                    THEN 1
                  ELSE 0
                END
           FROM usage
          WHERE burst_count < ?
            AND sustained_count < ?
         RETURNING admitted`,
      )
      .bind(
        actor.id,
        `ura_${randomId()}`,
        actor.id,
        input.jobId,
        input.itemId,
        input.requestId,
        byteSize,
        byteSize,
        FILE_BURST_RATE_LIMIT.bytes,
        byteSize,
        FILE_SUSTAINED_RATE_LIMIT.bytes,
        FILE_BURST_RATE_LIMIT.count,
        FILE_SUSTAINED_RATE_LIMIT.count,
      ),
  ]);
  const reservation = results[1]?.results?.[0];
  if (Number(reservation?.admitted ?? 0) === 1) {
    return;
  }
  await assertUploadRateLimit(db, actor, "FILE");
  throw uploadRateLimitError("FILE", 1);
}

export async function assertUploadRateLimit(
  db: D1Database,
  actor: Actor,
  kind: "JOB" | "FILE",
) {
  if (kind === "JOB") {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS count,
                CAST(
                  strftime('%s', MIN(datetime(created_at, '+1 hour')))
                  AS INTEGER
                ) - CAST(strftime('%s', 'now') AS INTEGER)
                  AS retryAfterSeconds
           FROM upload_jobs
          WHERE user_id = ?
            AND created_at >= datetime('now', '-1 hour')`,
      )
      .bind(actor.id)
      .first<{
        count: number;
        retryAfterSeconds: number | null;
      }>();
    if (Number(row?.count ?? 0) >= JOB_RATE_LIMIT.count) {
      throw uploadRateLimitError(
        kind,
        boundedRetryAfter(
          row?.retryAfterSeconds,
          JOB_RATE_LIMIT.windowSeconds,
        ),
      );
    }
    return;
  }

  const row = await db
    .prepare(
      `SELECT
          COALESCE(SUM(
            CASE
              WHEN created_at >= datetime('now', '-1 minute') THEN 1
              ELSE 0
            END
          ), 0) AS burstCount,
          COALESCE(SUM(
            CASE
              WHEN created_at >= datetime('now', '-1 minute') THEN byte_size
              ELSE 0
            END
          ), 0) AS burstBytes,
          CAST(strftime('%s', MIN(
            CASE
              WHEN created_at >= datetime('now', '-1 minute')
                THEN datetime(created_at, '+1 minute')
              ELSE NULL
            END
          )) AS INTEGER) - CAST(strftime('%s', 'now') AS INTEGER)
            AS burstRetryAfterSeconds,
          COUNT(*) AS sustainedCount,
          COALESCE(SUM(byte_size), 0) AS sustainedBytes,
          CAST(
            strftime('%s', MIN(datetime(created_at, '+1 hour')))
            AS INTEGER
          ) - CAST(strftime('%s', 'now') AS INTEGER)
            AS sustainedRetryAfterSeconds
       FROM upload_rate_limit_attempts
      WHERE user_id = ?
        AND created_at >= datetime('now', '-1 hour')`,
    )
    .bind(actor.id)
    .first<{
      burstCount: number;
      burstBytes: number;
      burstRetryAfterSeconds: number | null;
      sustainedCount: number;
      sustainedBytes: number;
      sustainedRetryAfterSeconds: number | null;
    }>();

  const burstExceeded =
    Number(row?.burstCount ?? 0) >= FILE_BURST_RATE_LIMIT.count ||
    Number(row?.burstBytes ?? 0) >= FILE_BURST_RATE_LIMIT.bytes;
  const sustainedExceeded =
    Number(row?.sustainedCount ?? 0) >= FILE_SUSTAINED_RATE_LIMIT.count ||
    Number(row?.sustainedBytes ?? 0) >= FILE_SUSTAINED_RATE_LIMIT.bytes;

  if (burstExceeded || sustainedExceeded) {
    throw uploadRateLimitError(
      kind,
      Math.max(
        burstExceeded
          ? boundedRetryAfter(
              row?.burstRetryAfterSeconds,
              FILE_BURST_RATE_LIMIT.windowSeconds,
            )
          : 0,
        sustainedExceeded
          ? boundedRetryAfter(
              row?.sustainedRetryAfterSeconds,
              FILE_SUSTAINED_RATE_LIMIT.windowSeconds,
            )
          : 0,
      ),
    );
  }
}

function expiredDraftAuthorization(actor: Actor, alias = "expired_job") {
  if (isUploadAdmin(actor)) {
    return {
      sql: `EXISTS (
        SELECT 1 FROM users cleanup_actor
         WHERE cleanup_actor.id = ?
           AND cleanup_actor.status = 'ACTIVE'
           AND (
             cleanup_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
             OR EXISTS (
               SELECT 1 FROM user_roles cleanup_role
                WHERE cleanup_role.user_id = cleanup_actor.id
                  AND cleanup_role.role IN ('OWNER', 'ADMINISTRATOR')
             )
           )
      )`,
      bindings: [actor.id] as unknown[],
    };
  }
  return {
    sql: `EXISTS (
      SELECT 1 FROM users cleanup_actor
       WHERE cleanup_actor.id = ?
         AND cleanup_actor.status = 'ACTIVE'
         AND (
           ${alias}.user_id = cleanup_actor.id
           OR EXISTS (
             SELECT 1
               FROM team_memberships cleanup_membership
               JOIN teams cleanup_team
                 ON cleanup_team.id = cleanup_membership.team_id
              WHERE cleanup_membership.user_id = cleanup_actor.id
                AND cleanup_membership.team_id = ${alias}.team_id
                AND cleanup_membership.status = 'ACTIVE'
                AND UPPER(cleanup_membership.membership_role) IN
                  ('OWNER', 'LEADER')
                AND cleanup_team.is_archived = 0
                AND cleanup_team.verification_status <> 'SUSPENDED'
           )
         )
    )`,
    bindings: [actor.id] as unknown[],
  };
}

/**
 * Opportunistic, bounded lifecycle executor for abandoned upload drafts.
 *
 * The database transition is revision- and permission-gated before storage is
 * touched. Published/review/scheduled jobs and any job already linked to a
 * chapter are excluded, so the cleanup path cannot delete reader assets.
 */
export async function cleanupExpiredUploadDrafts(
  db: D1Database,
  bucket: R2Bucket,
  actor: Actor,
  requestId: string,
  options: { jobLimit?: number; objectLimit?: number } = {},
) {
  const jobLimit = Math.max(1, Math.min(options.jobLimit ?? 1, 3));
  const objectLimit = Math.max(1, Math.min(options.objectLimit ?? 8, 20));
  const authorization = expiredDraftAuthorization(actor);
  const candidates = await db
    .prepare(
      `SELECT expired_job.id,
              expired_job.revision,
              expired_job.status
         FROM upload_jobs expired_job
        WHERE (
                (
                  expired_job.status IN
                    ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
                  AND datetime(expired_job.expires_at) <= datetime('now')
                )
                OR (
                  expired_job.status = 'CANCELLED'
                  AND EXISTS (
                    SELECT 1
                      FROM upload_sessions pending_session
                     WHERE pending_session.upload_job_id = expired_job.id
                       AND pending_session.chapter_id IS NULL
                       AND pending_session.status <> 'CLEANED'
                       AND NOT EXISTS (
                         SELECT 1
                           FROM media_cleanup_queue failed_cleanup
                          WHERE failed_cleanup.object_key =
                                  pending_session.object_key
                            AND failed_cleanup.status = 'FAILED'
                       )
                  )
                )
              )
          AND NOT EXISTS (
                SELECT 1
                  FROM upload_job_items public_item
                 WHERE public_item.job_id = expired_job.id
                   AND public_item.chapter_id IS NOT NULL
              )
          AND ${authorization.sql}
        ORDER BY
          CASE WHEN expired_job.status = 'CANCELLED' THEN 0 ELSE 1 END,
          datetime(expired_job.expires_at),
          expired_job.id
        LIMIT ?`,
    )
    .bind(...authorization.bindings, jobLimit)
    .all<{ id: string; revision: number; status: string }>();
  let cancelled = 0;
  let cleaned = 0;
  let queued = 0;
  for (const candidate of candidates.results) {
    const thumbnails = await db
      .prepare(
        `SELECT id, thumbnail_key AS objectKey
           FROM upload_job_items
          WHERE job_id = ?
            AND chapter_id IS NULL
            AND thumbnail_key IS NOT NULL`,
      )
      .bind(candidate.id)
      .all<{ id: string; objectKey: string }>();
    const commitAuthorization = expiredDraftAuthorization(
      actor,
      "upload_jobs",
    );
    let results;
    try {
      if (candidate.status === "CANCELLED") {
        results = await db.batch([
        db
          .prepare(
            `INSERT INTO upload_publish_guards (job_id, verified)
             SELECT upload_jobs.id, 1
               FROM upload_jobs
              WHERE upload_jobs.id = ?
                AND upload_jobs.revision = ?
                AND upload_jobs.status = 'CANCELLED'
                AND NOT EXISTS (
                  SELECT 1 FROM upload_job_items public_item
                   WHERE public_item.job_id = upload_jobs.id
                     AND public_item.chapter_id IS NOT NULL
                )
                AND ${commitAuthorization.sql}`,
          )
          .bind(
            candidate.id,
            candidate.revision,
            ...commitAuthorization.bindings,
          ),
        db
          .prepare(
            `UPDATE upload_job_items
                SET thumbnail_key = NULL,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE job_id = ?
                AND chapter_id IS NULL
                AND thumbnail_key IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM upload_publish_guards
                   WHERE job_id = ? AND verified = 1
                )`,
          )
          .bind(candidate.id, candidate.id),
        db
          .prepare(
            `UPDATE upload_sessions
                SET status = CASE
                      WHEN object_key LIKE 'rejected:%' THEN 'CLEANED'
                      ELSE 'CLEANUP_PENDING'
                    END,
                    updated_at = CURRENT_TIMESTAMP
              WHERE upload_job_id = ?
                AND chapter_id IS NULL
                AND status <> 'CLEANED'
                AND EXISTS (
                  SELECT 1 FROM upload_publish_guards
                   WHERE job_id = ? AND verified = 1
                )`,
          )
          .bind(candidate.id, candidate.id),
        db
          .prepare("DELETE FROM upload_publish_guards WHERE job_id = ?")
          .bind(candidate.id),
        ]);
      } else {
        const nextRevision = Number(candidate.revision) + 1;
        const guard = `EXISTS (
          SELECT 1 FROM upload_publish_guards
           WHERE job_id = '${candidate.id.replaceAll("'", "''")}'
             AND verified = 1
        )`;
        results = await db.batch([
        db
          .prepare(
            `UPDATE upload_jobs
                SET status = 'CANCELLED',
                    revision = ?,
                    completed_at = CURRENT_TIMESTAMP,
                    last_error_code = 'DRAFT_EXPIRED',
                    last_error_message =
                      'This draft expired before it was published.',
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND revision = ?
                AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
                AND datetime(expires_at) <= datetime('now')
                AND NOT EXISTS (
                  SELECT 1 FROM upload_job_items public_item
                   WHERE public_item.job_id = upload_jobs.id
                     AND public_item.chapter_id IS NOT NULL
                )
                AND ${commitAuthorization.sql}`,
          )
          .bind(
            nextRevision,
            candidate.id,
            candidate.revision,
            ...commitAuthorization.bindings,
          ),
        db
          .prepare(
            `INSERT INTO upload_publish_guards (job_id, verified)
             VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
          )
          .bind(candidate.id),
        db
          .prepare(
            `UPDATE upload_job_items
                SET status = 'CANCELLED',
                    thumbnail_key = NULL,
                    error_code = 'DRAFT_EXPIRED',
                    error_message =
                      'This draft expired before it was published.',
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE job_id = ?
                AND ${guard}`,
          )
          .bind(candidate.id),
        db
          .prepare(
            `UPDATE upload_sessions
                SET status = CASE
                      WHEN object_key LIKE 'rejected:%' THEN 'CLEANED'
                      ELSE 'CLEANUP_PENDING'
                    END,
                    updated_at = CURRENT_TIMESTAMP
              WHERE upload_job_id = ?
                AND chapter_id IS NULL
                AND status <> 'CLEANED'
                AND ${guard}`,
          )
          .bind(candidate.id),
        auditStatement(
          db,
          actor,
          requestId,
          {
            action: "upload.job.expire",
            category: "UPLOADS_IMPORTS",
            sourceArea: "UPLOAD_LIFECYCLE",
            targetType: "UPLOAD_JOB",
            targetId: candidate.id,
            reason: "Abandoned upload draft reached its expiry time.",
            oldValue: {
              status: candidate.status,
              revision: candidate.revision,
            },
            newValue: { status: "CANCELLED", revision: nextRevision },
          },
          guard,
        ),
        db
          .prepare("DELETE FROM upload_publish_guards WHERE job_id = ?")
          .bind(candidate.id),
        ]);
        if (Number(results[0]?.meta.changes ?? 0)) cancelled += 1;
      }
    } catch {
      // A concurrent upload mutation won the revision/state race.
      continue;
    }
    if (!Number(results[0]?.meta.changes ?? 0)) continue;
    for (const thumbnail of thumbnails.results) {
      const removed = await deleteMediaObject(db, bucket, thumbnail.objectKey, {
        mediaKind: "CHAPTER_THUMBNAIL",
        targetType: "UPLOAD_JOB_ITEM",
        targetId: thumbnail.id,
        reason: "Expired upload draft",
      });
      if (!removed) queued += 1;
    }
    const objects = await db
      .prepare(
        `SELECT pending_session.id,
                pending_session.object_key AS objectKey
           FROM upload_sessions pending_session
          WHERE pending_session.upload_job_id = ?
            AND pending_session.chapter_id IS NULL
            AND pending_session.status = 'CLEANUP_PENDING'
            AND NOT EXISTS (
              SELECT 1 FROM media_cleanup_queue failed_cleanup
               WHERE failed_cleanup.object_key = pending_session.object_key
                 AND failed_cleanup.status = 'FAILED'
            )
          ORDER BY pending_session.page_index, pending_session.id
          LIMIT ?`,
      )
      .bind(candidate.id, objectLimit)
      .all<{ id: string; objectKey: string }>();
    for (const object of objects.results) {
      const removed = await deleteMediaObject(db, bucket, object.objectKey, {
        mediaKind: "CHAPTER_UPLOAD",
        targetType: "UPLOAD_JOB",
        targetId: candidate.id,
        reason: "Expired upload draft",
      });
      if (!removed) {
        queued += 1;
        continue;
      }
      const result = await db
        .prepare(
          `UPDATE upload_sessions
              SET status = 'CLEANED',
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND upload_job_id = ?
              AND chapter_id IS NULL
              AND status = 'CLEANUP_PENDING'
              AND EXISTS (
                SELECT 1 FROM upload_jobs
                 WHERE id = ?
                   AND status = 'CANCELLED'
              )`,
        )
        .bind(object.id, candidate.id, candidate.id)
        .run()
        .catch(() => null);
      cleaned += Number(result?.meta.changes ?? 0);
    }
  }
  return {
    selected: candidates.results.length,
    cancelled,
    cleaned,
    queued,
  };
}

export type UploadScope = {
  seriesId: string;
  seriesSlug: string;
  seriesTitle: string;
  teamId: string | null;
  teamName: string | null;
  canPublish: boolean;
  uploadRequiresReview: boolean;
  allowedLanguages: string[];
};

export async function requireUploadScope(
  db: D1Database,
  actor: Actor,
  seriesId: string,
  teamId: string | null,
  _languages: string[] = [],
): Promise<UploadScope> {
  void _languages;
  requireUploadCapability(actor);
  const seriesRecord = await db
    .prepare(
      `SELECT id, slug, title
         FROM series
        WHERE id = ?
          AND is_published = 1
          AND archived_at IS NULL
          AND status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
          AND rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
        LIMIT 1`,
    )
    .bind(seriesId)
    .first<{ id: string; slug: string; title: string }>();
  if (!seriesRecord) {
    throw new ApiError(
      404,
      "APPROVED_SERIES_REQUIRED",
      "Choose a public, rights-safe series before uploading a chapter.",
    );
  }

  const administrator = isUploadAdmin(actor);
  const owner = actor.roles.includes("OWNER");
  if (administrator) {
    const liveAdministrator = await db
      .prepare(
        `SELECT id
           FROM users live_actor
          WHERE live_actor.id = ?
            AND live_actor.status = 'ACTIVE'
            AND (
              live_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
              OR EXISTS (
                SELECT 1 FROM user_roles live_role
                 WHERE live_role.user_id = live_actor.id
                   AND live_role.role IN ('OWNER', 'ADMINISTRATOR')
              )
            )
          LIMIT 1`,
      )
      .bind(actor.id)
      .first();
    if (!liveAdministrator) {
      throw new ApiError(
        403,
        "UPLOAD_PERMISSION_REQUIRED",
        "This account no longer has administrator upload access.",
      );
    }
  }

  if (!teamId) {
    throw new ApiError(
      403,
      "TEAM_SCOPE_REQUIRED",
      "Choose one of your active publishing teams.",
    );
  }
  if (owner) {
    const selectedTeam = await db.prepare(
      `SELECT id AS teamId, name AS teamName
         FROM teams
        WHERE id = ? AND is_archived = 0 AND verification_status = 'VERIFIED'
        LIMIT 1`,
    ).bind(teamId).first<{ teamId: string; teamName: string }>();
    if (!selectedTeam) throw new ApiError(403, "VERIFIED_TEAM_REQUIRED", "Choose an active verified publishing team.");
    return {
      seriesId: seriesRecord.id,
      seriesSlug: seriesRecord.slug,
      seriesTitle: seriesRecord.title,
      teamId: selectedTeam.teamId,
      teamName: selectedTeam.teamName,
      canPublish: true,
      uploadRequiresReview: false,
      allowedLanguages: [],
    };
  }
  const membership = await db
    .prepare(
      `SELECT t.id AS teamId,
              t.name AS teamName,
              UPPER(tm.membership_role) AS membershipRole
         FROM team_memberships tm
         JOIN users live_actor
           ON live_actor.id = tm.user_id
         JOIN teams t
           ON t.id = tm.team_id
        WHERE tm.team_id = ?
         AND tm.user_id = ?
          AND tm.status = 'ACTIVE'
          AND live_actor.status = 'ACTIVE'
          AND UPPER(tm.membership_role) IN
            ('OWNER', 'LEADER', 'UPLOADER')
          AND t.is_archived = 0
          AND t.verification_status = 'VERIFIED'
        LIMIT 1`,
    )
    .bind(teamId, actor.id)
    .first<{
      teamId: string;
      teamName: string;
      membershipRole: string;
    }>();
  if (!membership) {
    throw new ApiError(
      403,
      "VERIFIED_TEAM_MEMBERSHIP_REQUIRED",
      "Choose a verified team where you are an active publishing member.",
    );
  }
  const canPublish =
    administrator ||
    (canAny(
      [actor.primaryRole, ...(actor.roles ?? [])],
      "chapter.publish.assigned",
    ) &&
      ["OWNER", "LEADER"].includes(
        membership.membershipRole,
      ));
  return {
    seriesId: seriesRecord.id,
    seriesSlug: seriesRecord.slug,
    seriesTitle: seriesRecord.title,
    teamId: membership.teamId,
    teamName: membership.teamName,
    canPublish,
    uploadRequiresReview: !canPublish,
    allowedLanguages: [],
  };
}

export function requireUploadCapability(actor: Actor) {
  if (
    actor.uploadTeamIds.length === 0 &&
    !canAny(
      [actor.primaryRole, ...(actor.roles ?? [])],
      "upload.create",
    )
  ) {
    throw new ApiError(
      403,
      "UPLOAD_PERMISSION_REQUIRED",
      "This account cannot access publishing uploads.",
    );
  }
}

export async function validateChapterPage(file: File, sourcePath: string) {
  const normalizedPath = normalizeUploadPath(sourcePath);
  if (!normalizedPath) {
    throw new ApiError(
      422,
      "UPLOAD_PATH_INVALID",
      "A selected file has an unsafe, hidden, or system path.",
    );
  }
  const validated = await validateImageFile(file, {
    label: "chapter page",
    maxBytes: UPLOAD_LIMITS.maxPageBytes,
    minWidth: 1,
    minHeight: 1,
    maxWidth: UPLOAD_LIMITS.maxWidth,
    maxHeight: UPLOAD_LIMITS.maxHeight,
    maxPixels: UPLOAD_LIMITS.maxPixelsPerPage,
    allowAnimation: false,
    allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]),
  });
  return {
    ...validated,
    normalizedPath,
    filename: safeFilename(file.name),
    sha256: await sha256Hex(validated.bytes),
  };
}

export function chapterSlug(
  chapterNumber: string,
  language: string,
  version: number,
  teamId: string | null,
  itemId: string,
) {
  const normalizedChapter =
    chapterNumber
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "release";
  const scope = (teamId ?? "platform")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-18);
  return `chapter-${normalizedChapter}-${language}-v${version}-${scope}-${itemId.slice(-8)}`;
}

export function privatePageObjectKey(
  actorId: string,
  jobId: string,
  itemId: string,
  fileId = randomId(),
) {
  const safeActor = encodeURIComponent(actorId);
  const safeJob = encodeURIComponent(jobId);
  const safeItem = encodeURIComponent(itemId);
  return `private/chapter-pages/${safeActor}/${safeJob}/${safeItem}/${fileId}`;
}

export function assertSupportedMethod(value: string): SupportedUploadMethod {
  if (value !== "DIRECT_IMAGES" && value !== "DIRECT_FOLDER") {
    throw new ApiError(
      422,
      "UPLOAD_METHOD_UNAVAILABLE",
      "This upload method is not supported by the current deployment.",
    );
  }
  return value;
}
