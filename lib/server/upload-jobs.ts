import { z } from "zod";
import { can } from "@/lib/permissions.mjs";
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
    chapterNumber: z.string().trim().min(1).max(40),
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
    accessType: z.enum(["FREE", "PAID"]).default("FREE"),
    priceOnyx: z.number().int().min(0).max(100_000).default(0),
    visibility: z.enum(["PUBLIC", "UNLISTED", "HIDDEN"]).default("PUBLIC"),
    scheduledAt: z.string().datetime().nullable().default(null),
    commentsEnabled: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.accessType === "PAID" && value.priceOnyx < 1) {
      context.addIssue({
        code: "custom",
        path: ["priceOnyx"],
        message: "Paid chapters need an Onyx price of at least 1.",
      });
    }
    if (value.accessType === "FREE" && value.priceOnyx !== 0) {
      context.addIssue({
        code: "custom",
        path: ["priceOnyx"],
        message: "Free chapters cannot have an Onyx price.",
      });
    }
  });

export const createUploadJobSchema = z
  .object({
    kind: z.enum(["SINGLE", "BATCH"]),
    sourceType: z.enum(["DIRECT_IMAGES", "DIRECT_FOLDER"]),
    seriesId: z.string().trim().min(3).max(120),
    teamId: z.string().trim().min(3).max(120).nullable(),
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
  return ["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole);
}

export async function assertUploadRateLimit(
  db: D1Database,
  actor: Actor,
  kind: "JOB" | "FILE",
) {
  const row =
    kind === "JOB"
      ? await db
          .prepare(
            `SELECT COUNT(*) AS count
               FROM upload_jobs
              WHERE user_id = ?
                AND created_at >= datetime('now', '-1 hour')`,
          )
          .bind(actor.id)
          .first<{ count: number }>()
      : await db
          .prepare(
            `SELECT COUNT(*) AS count
               FROM upload_sessions
              WHERE user_id = ?
                AND created_at >= datetime('now', '-1 minute')`,
          )
          .bind(actor.id)
          .first<{ count: number }>();
  const limit = kind === "JOB" ? 30 : 120;
  if (Number(row?.count ?? 0) >= limit) {
    throw new ApiError(
      429,
      "UPLOAD_RATE_LIMITED",
      kind === "JOB"
        ? "Too many upload drafts were created. Wait before starting another."
        : "Too many pages were sent at once. Wait a minute, then retry.",
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
           AND cleanup_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
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
                  ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER')
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

function parseAllowedLanguages(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.toLowerCase())
      : [];
  } catch {
    return [];
  }
}

export async function requireUploadScope(
  db: D1Database,
  actor: Actor,
  seriesId: string,
  teamId: string | null,
  languages: string[] = [],
): Promise<UploadScope> {
  const seriesRecord = await db
    .prepare(
      `SELECT id, slug, title
         FROM series
        WHERE id = ?
          AND is_published = 1
          AND archived_at IS NULL
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
      "Choose an approved, public series before uploading a chapter.",
    );
  }

  if (isUploadAdmin(actor)) {
    if (!teamId) {
      return {
        seriesId: seriesRecord.id,
        seriesSlug: seriesRecord.slug,
        seriesTitle: seriesRecord.title,
        teamId: null,
        teamName: null,
        canPublish: true,
        uploadRequiresReview: false,
        allowedLanguages: [],
      };
    }
    const team = await db
      .prepare(
        `SELECT id, name
           FROM teams
          WHERE id = ?
            AND is_archived = 0
            AND verification_status <> 'SUSPENDED'
          LIMIT 1`,
      )
      .bind(teamId)
      .first<{ id: string; name: string }>();
    if (!team) {
      throw new ApiError(
        422,
        "TEAM_NOT_AVAILABLE",
        "Choose an active publishing team.",
      );
    }
    return {
      seriesId: seriesRecord.id,
      seriesSlug: seriesRecord.slug,
      seriesTitle: seriesRecord.title,
      teamId: team.id,
      teamName: team.name,
      canPublish: true,
      uploadRequiresReview: false,
      allowedLanguages: [],
    };
  }

  if (!teamId) {
    throw new ApiError(
      403,
      "TEAM_SCOPE_REQUIRED",
      "Choose one of your active publishing teams.",
    );
  }
  const assignment = await db
    .prepare(
      `SELECT t.id AS teamId,
              t.name AS teamName,
              sta.can_publish AS canPublish,
              sta.upload_requires_review AS uploadRequiresReview,
              sta.allowed_languages_json AS allowedLanguagesJson
         FROM series_team_assignments sta
         JOIN team_memberships tm
           ON tm.team_id = sta.team_id
         JOIN teams t
           ON t.id = sta.team_id
        WHERE sta.series_id = ?
          AND sta.team_id = ?
          AND sta.can_upload = 1
          AND sta.revoked_at IS NULL
          AND tm.user_id = ?
          AND tm.status = 'ACTIVE'
          AND UPPER(tm.membership_role) IN
            ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
          AND t.is_archived = 0
          AND t.verification_status <> 'SUSPENDED'
        LIMIT 1`,
    )
    .bind(seriesId, teamId, actor.id)
    .first<{
      teamId: string;
      teamName: string;
      canPublish: number;
      uploadRequiresReview: number;
      allowedLanguagesJson: string | null;
    }>();
  if (!assignment) {
    throw new ApiError(
      403,
      "SERIES_ASSIGNMENT_REQUIRED",
      "Your active team is not allowed to upload releases for this series.",
    );
  }
  const allowedLanguages = parseAllowedLanguages(
    assignment.allowedLanguagesJson,
  );
  const blockedLanguage = languages.find(
    (language) =>
      allowedLanguages.length > 0 &&
      !allowedLanguages.includes("*") &&
      !allowedLanguages.includes(language.toLowerCase()),
  );
  if (blockedLanguage) {
    throw new ApiError(
      403,
      "RELEASE_LANGUAGE_NOT_ALLOWED",
      `Your team is not authorized to publish ${blockedLanguage} releases for this series.`,
    );
  }
  return {
    seriesId: seriesRecord.id,
    seriesSlug: seriesRecord.slug,
    seriesTitle: seriesRecord.title,
    teamId: assignment.teamId,
    teamName: assignment.teamName,
    canPublish: Boolean(assignment.canPublish),
    uploadRequiresReview: Boolean(assignment.uploadRequiresReview),
    allowedLanguages,
  };
}

export function requireUploadCapability(actor: Actor) {
  if (!can(actor.primaryRole, "upload.create")) {
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
