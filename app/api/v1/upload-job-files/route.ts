import { env } from "cloudflare:workers";
import { z } from "zod";
import { normalizeUploadPath, UPLOAD_LIMITS } from "@/lib/uploads";
import {
  assertSameOrigin,
  deleteMediaObject,
  requestIdFor,
  safeFilename,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertUploadRateLimit,
  isUploadAdmin,
  privatePageObjectKey,
  requireUploadCapability,
  requireUploadScope,
  uploadFileMutationSchema,
  validateChapterPage,
} from "@/lib/server/upload-jobs";
import { requireActor, type Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

type MutableJob = {
  id: string;
  userId: string;
  teamId: string | null;
  seriesId: string;
  status: string;
  revision: number;
  expiresAt: string;
};

function visibility(actor: Actor, alias = "uj") {
  if (isUploadAdmin(actor)) return { sql: "1 = 1", bindings: [] as unknown[] };
  if (actor.managedTeamIds.length) {
    return {
      sql: `(${alias}.user_id = ? OR ${alias}.team_id IN (${actor.managedTeamIds
        .map(() => "?")
        .join(", ")}))`,
      bindings: [actor.id, ...actor.managedTeamIds],
    };
  }
  return { sql: `${alias}.user_id = ?`, bindings: [actor.id] };
}

function liveMutationAuthorization(actor: Actor, alias = "upload_jobs") {
  const seriesIsEligible = `EXISTS (
    SELECT 1
      FROM series live_series
     WHERE live_series.id = ${alias}.series_id
       AND live_series.is_published = 1
       AND live_series.archived_at IS NULL
       AND live_series.rights_status IN
         ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
  )`;
  if (isUploadAdmin(actor)) {
    return {
      sql: `EXISTS (
        SELECT 1
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
      )
      AND ${seriesIsEligible}
      AND (
        ${alias}.team_id IS NULL
        OR EXISTS (
          SELECT 1
            FROM teams live_team
           WHERE live_team.id = ${alias}.team_id
             AND live_team.is_archived = 0
             AND live_team.verification_status <> 'SUSPENDED'
        )
      )`,
      bindings: [actor.id] as unknown[],
    };
  }
  return {
    sql: `EXISTS (
      SELECT 1
        FROM users live_actor
        JOIN series_team_assignments live_assignment
          ON live_assignment.series_id = ${alias}.series_id
         AND live_assignment.team_id = ${alias}.team_id
        JOIN team_memberships live_membership
          ON live_membership.team_id = live_assignment.team_id
         AND live_membership.user_id = live_actor.id
        JOIN teams live_team ON live_team.id = live_assignment.team_id
       WHERE live_actor.id = ?
         AND live_actor.status = 'ACTIVE'
         AND (
           live_actor.primary_role IN ('TEAM_LEADER', 'UPLOADER')
           OR EXISTS (
             SELECT 1 FROM user_roles live_role
              WHERE live_role.user_id = live_actor.id
                AND live_role.role IN ('TEAM_LEADER', 'UPLOADER')
           )
         )
         AND live_membership.status = 'ACTIVE'
         AND UPPER(live_membership.membership_role) IN
           ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
         AND live_assignment.can_upload = 1
         AND live_assignment.revoked_at IS NULL
         AND live_team.is_archived = 0
         AND live_team.verification_status <> 'SUSPENDED'
         AND json_valid(live_assignment.allowed_languages_json) = 1
         AND (
           json_array_length(live_assignment.allowed_languages_json) = 0
           OR NOT EXISTS (
             SELECT 1
               FROM upload_job_items live_item
              WHERE live_item.job_id = ${alias}.id
                AND NOT EXISTS (
                  SELECT 1
                    FROM json_each(live_assignment.allowed_languages_json)
                   WHERE LOWER(CAST(value AS TEXT)) IN
                     ('*', LOWER(live_item.language))
                )
           )
         )
    )
    AND ${seriesIsEligible}`,
    bindings: [actor.id] as unknown[],
  };
}

async function mutableJob(
  db: D1Database,
  actor: Actor,
  jobId: string,
  itemId: string,
) {
  const jobVisibility = visibility(actor);
  const job = await db
    .prepare(
      `SELECT uj.id,
              uj.user_id AS userId,
              uj.team_id AS teamId,
              uj.series_id AS seriesId,
              uj.status,
              uj.revision,
              uj.expires_at AS expiresAt
         FROM upload_jobs uj
         JOIN upload_job_items uji ON uji.job_id = uj.id
        WHERE uj.id = ?
          AND uji.id = ?
          AND ${jobVisibility.sql}
        LIMIT 1`,
    )
    .bind(jobId, itemId, ...jobVisibility.bindings)
    .first<MutableJob>();
  if (!job) {
    throw new ApiError(
      404,
      "UPLOAD_JOB_NOT_FOUND",
      "This upload draft is unavailable.",
    );
  }
  if (!["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status)) {
    throw new ApiError(
      409,
      "UPLOAD_JOB_LOCKED",
      "This upload can no longer accept page changes.",
    );
  }
  return job;
}

async function jobFiles(
  db: D1Database,
  jobId: string,
  itemId: string,
) {
  return db
    .prepare(
      `SELECT id,
              object_key AS objectKey,
              filename,
              source_path AS sourcePath,
              content_type AS contentType,
              byte_size AS byteSize,
              page_index AS pageIndex,
              sha256,
              width,
              height,
              status,
              validation_json AS validationJson,
              retry_count AS retryCount,
              created_at AS createdAt,
              updated_at AS updatedAt
         FROM upload_sessions
        WHERE upload_job_id = ?
          AND upload_job_item_id = ?
        ORDER BY page_index, created_at, id`,
    )
    .bind(jobId, itemId)
    .all<Record<string, unknown>>();
}

async function recordValidationFailure(input: {
  db: D1Database;
  actor: Actor;
  job: MutableJob;
  itemId: string;
  file: File;
  sourcePath: string;
  error: unknown;
}) {
  const error =
    input.error instanceof ApiError
      ? input.error
      : new ApiError(
          422,
          "PAGE_VALIDATION_FAILED",
          "This page could not be validated.",
        );
  const failedId = `ups_${randomId()}`;
  const next = await input.db
    .prepare(
      `SELECT COALESCE(MAX(page_index), -1) + 1 AS pageIndex
         FROM upload_sessions
        WHERE upload_job_id = ?
          AND upload_job_item_id = ?`,
    )
    .bind(input.job.id, input.itemId)
    .first<{ pageIndex: number }>();
  const path =
    normalizeUploadPath(input.sourcePath) ?? safeFilename(input.file.name);
  const authorization = liveMutationAuthorization(input.actor, "upload_jobs");
  try {
    await input.db.batch([
      input.db
        .prepare(
          `UPDATE upload_jobs
              SET status = 'FAILED',
                  last_error_code = ?,
                  last_error_message = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
              AND ${authorization.sql}`,
        )
        .bind(
          error.code,
          error.message,
          input.job.id,
          input.job.revision,
          ...authorization.bindings,
        ),
      input.db
        .prepare(
          `INSERT INTO upload_publish_guards (job_id, verified)
           VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
        )
        .bind(input.job.id),
      input.db
        .prepare(
          `INSERT INTO upload_sessions
           (id, user_id, team_id, upload_job_id, upload_job_item_id, object_key,
            filename, source_path, content_type, byte_size, page_index, status,
            validation_json, retry_count, expires_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FAILED', ?, 0, ?
            WHERE EXISTS (
              SELECT 1 FROM upload_publish_guards
               WHERE job_id = ? AND verified = 1
            )
              AND NOT EXISTS (
                SELECT 1
                  FROM upload_sessions
                 WHERE upload_job_item_id = ?
                   AND source_path = ?
              )`,
        )
        .bind(
          failedId,
          input.actor.id,
          input.job.teamId,
          input.job.id,
          input.itemId,
          `rejected:${failedId}`,
          safeFilename(input.file.name),
          path,
          input.file.type || "application/octet-stream",
          input.file.size,
          Number(next?.pageIndex ?? 0),
          JSON.stringify({
            valid: false,
            code: error.code,
            message: error.message,
            storageCreated: false,
          }),
          input.job.expiresAt,
          input.job.id,
          input.itemId,
          path,
        ),
      input.db
        .prepare(
          `UPDATE upload_job_items
              SET status = 'FAILED',
                  error_code = ?,
                  error_message = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND job_id = ?
              AND EXISTS (
                SELECT 1 FROM upload_publish_guards
                 WHERE job_id = ? AND verified = 1
              )`,
        )
        .bind(
          error.code,
          error.message,
          input.itemId,
          input.job.id,
          input.job.id,
        ),
      input.db
        .prepare("DELETE FROM upload_publish_guards WHERE job_id = ?")
        .bind(input.job.id),
    ]);
  } catch (mutationError) {
    if (
      mutationError instanceof Error &&
      /upload_publish_guards|constraint failed/i.test(mutationError.message)
    ) {
      return new ApiError(
        409,
        "UPLOAD_JOB_CHANGED",
        "This upload or its team authorization changed during validation.",
      );
    }
    throw mutationError;
  }
  return error;
}

export async function GET(request: Request) {
  const id = requestIdFor(request);
  try {
    const actor = await requireActor("upload.create");
    requireUploadCapability(actor);
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Upload pages are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const jobId = z.string().min(3).max(120).parse(url.searchParams.get("jobId"));
    const itemId = z
      .string()
      .min(3)
      .max(120)
      .parse(url.searchParams.get("itemId"));
    await mutableJob(env.DB, actor, jobId, itemId);
    const files = await jobFiles(env.DB, jobId, itemId);
    return json(
      id,
      { data: files.results },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(id, error);
  }
}

export async function POST(request: Request) {
  const id = requestIdFor(request);
  let storedObjectKey: string | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireActor("upload.create");
    requireUploadCapability(actor);
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "UPLOAD_STORAGE_UNAVAILABLE",
        "Private upload storage is temporarily unavailable.",
      );
    }
    await assertUploadRateLimit(env.DB, actor, "FILE");
    const form = await request.formData();
    const jobId = z.string().min(3).max(120).parse(form.get("jobId"));
    const itemId = z.string().min(3).max(120).parse(form.get("itemId"));
    const expectedRevision = z.coerce
      .number()
      .int()
      .min(1)
      .parse(form.get("expectedRevision"));
    const sourcePath = z
      .string()
      .trim()
      .min(1)
      .max(500)
      .parse(form.get("sourcePath"));
    const requestedIndex = z.coerce
      .number()
      .int()
      .min(0)
      .max(UPLOAD_LIMITS.maxPagesPerChapter - 1)
      .nullable()
      .catch(null)
      .parse(form.get("pageIndex"));
    const replaceFileId = z
      .string()
      .trim()
      .max(120)
      .nullable()
      .catch(null)
      .parse(form.get("replaceFileId"));
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      throw new ApiError(
        422,
        "PAGE_FILE_REQUIRED",
        "Choose a chapter page image.",
      );
    }
    const job = await mutableJob(env.DB, actor, jobId, itemId);
    if (job.revision !== expectedRevision) {
      throw new ApiError(
        409,
        "UPLOAD_JOB_CHANGED",
        "This upload changed. Reload it before adding another page.",
      );
    }
    await requireUploadScope(env.DB, actor, job.seriesId, job.teamId);
    let validated: Awaited<ReturnType<typeof validateChapterPage>>;
    try {
      validated = await validateChapterPage(file, sourcePath);
    } catch (error) {
      const recorded = await recordValidationFailure({
        db: env.DB,
        actor,
        job,
        itemId,
        file,
        sourcePath,
        error,
      });
      throw recorded;
    }
    const existing = replaceFileId
      ? await env.DB.prepare(
          `SELECT id,
                  object_key AS objectKey,
                  page_index AS pageIndex,
                  retry_count AS retryCount
             FROM upload_sessions
            WHERE id = ?
              AND upload_job_id = ?
              AND upload_job_item_id = ?
              AND status IN ('READY', 'FAILED', 'RETRY_REQUIRED')
            LIMIT 1`,
        )
          .bind(replaceFileId, jobId, itemId)
          .first<{
            id: string;
            objectKey: string;
            pageIndex: number;
            retryCount: number;
          }>()
      : null;
    if (replaceFileId && !existing) {
      throw new ApiError(
        404,
        "UPLOAD_PAGE_NOT_FOUND",
        "The page selected for replacement no longer exists.",
      );
    }
    const counts = await env.DB.prepare(
      `SELECT COUNT(*) AS pageCount,
              COALESCE(SUM(byte_size), 0) AS itemBytes
         FROM upload_sessions
        WHERE upload_job_item_id = ?
          AND status = 'READY'
          AND (? IS NULL OR id <> ?)`,
    )
      .bind(itemId, replaceFileId, replaceFileId)
      .first<{ pageCount: number; itemBytes: number }>();
    if (
      Number(counts?.pageCount ?? 0) >= UPLOAD_LIMITS.maxPagesPerChapter &&
      !existing
    ) {
      throw new ApiError(
        413,
        "TOO_MANY_PAGES",
        `A chapter can contain at most ${UPLOAD_LIMITS.maxPagesPerChapter} pages.`,
      );
    }
    if (
      Number(counts?.itemBytes ?? 0) + file.size >
      UPLOAD_LIMITS.maxChapterBytes
    ) {
      throw new ApiError(
        413,
        "UPLOAD_CHAPTER_TOO_LARGE",
        "This chapter exceeds the 250 MB upload limit.",
      );
    }
    const jobBytes = await env.DB.prepare(
      `SELECT COALESCE(SUM(byte_size), 0) AS totalBytes
         FROM upload_sessions
        WHERE upload_job_id = ?
          AND status = 'READY'
          AND (? IS NULL OR id <> ?)`,
    )
      .bind(jobId, replaceFileId, replaceFileId)
      .first<{ totalBytes: number }>();
    if (
      Number(jobBytes?.totalBytes ?? 0) + file.size >
      UPLOAD_LIMITS.maxJobBytes
    ) {
      throw new ApiError(
        413,
        "UPLOAD_JOB_TOO_LARGE",
        "This upload exceeds the 7 GB private-draft limit.",
      );
    }
    const duplicate = await env.DB.prepare(
      `SELECT id,
              CASE WHEN source_path = ? THEN 'PATH' ELSE 'CONTENT' END AS kind
         FROM upload_sessions
        WHERE upload_job_item_id = ?
          AND status = 'READY'
          AND (source_path = ? OR sha256 = ?)
          AND (? IS NULL OR id <> ?)
        LIMIT 1`,
    )
      .bind(
        validated.normalizedPath,
        itemId,
        validated.normalizedPath,
        validated.sha256,
        replaceFileId,
        replaceFileId,
      )
      .first<{ id: string; kind: "PATH" | "CONTENT" }>();
    if (duplicate) {
      throw new ApiError(
        409,
        duplicate.kind === "PATH"
          ? "DUPLICATE_PAGE_FILENAME"
          : "DUPLICATE_PAGE_CONTENT",
        duplicate.kind === "PATH"
          ? "Two pages cannot use the same normalized path."
          : "This image is already present in the chapter.",
      );
    }
    const nextIndex = existing
      ? existing.pageIndex
      : requestedIndex ??
        Number(
          (
            await env.DB.prepare(
              `SELECT COALESCE(MAX(page_index), -1) + 1 AS pageIndex
                 FROM upload_sessions
                WHERE upload_job_item_id = ?
                  AND status = 'READY'`,
            )
              .bind(itemId)
              .first<{ pageIndex: number }>()
          )?.pageIndex ?? 0,
        );
    const fileId = existing?.id ?? `ups_${randomId()}`;
    storedObjectKey = privatePageObjectKey(
      actor.id,
      jobId,
      itemId,
      randomId(),
    );
    await env.BUCKET.put(storedObjectKey, validated.bytes, {
      httpMetadata: {
        contentType: validated.contentType,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        actorId: actor.id,
        jobId,
        itemId,
        sha256: validated.sha256,
      },
    });
    const nextRevision = job.revision + 1;
    const oldObjectKey = existing?.objectKey ?? null;
    const authorization = liveMutationAuthorization(actor, "upload_jobs");
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE upload_jobs
            SET status = 'UPLOADING',
                revision = revision + 1,
                last_error_code = NULL,
                last_error_message = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
            AND ${authorization.sql}`,
      ).bind(jobId, expectedRevision, ...authorization.bindings),
      env.DB.prepare(
        `INSERT INTO upload_publish_guards (job_id, verified)
         VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
      ).bind(jobId),
    ];
    if (existing) {
      statements.push(
        env.DB.prepare(
          `UPDATE upload_sessions
              SET object_key = ?,
                  filename = ?,
                  source_path = ?,
                  content_type = ?,
                  byte_size = ?,
                  page_index = ?,
                  sha256 = ?,
                  width = ?,
                  height = ?,
                  status = 'READY',
                  validation_json = ?,
                  retry_count = retry_count + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND upload_job_id = ?
              AND upload_job_item_id = ?
              AND EXISTS (
                SELECT 1 FROM upload_jobs
                 WHERE id = ? AND revision = ?
              )`,
        ).bind(
          storedObjectKey,
          validated.filename,
          validated.normalizedPath,
          validated.contentType,
          file.size,
          nextIndex,
          validated.sha256,
          validated.dimensions.width,
          validated.dimensions.height,
          JSON.stringify({
            valid: true,
            signatureChecked: true,
            dimensionsChecked: true,
            animated: false,
            sha256: validated.sha256,
          }),
          existing.id,
          jobId,
          itemId,
          jobId,
          nextRevision,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO upload_sessions
           (id, user_id, team_id, upload_job_id, upload_job_item_id,
            object_key, filename, source_path, content_type, byte_size,
            page_index, sha256, width, height, status, validation_json,
            retry_count, expires_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?, 0, ?
            WHERE EXISTS (
              SELECT 1 FROM upload_jobs
               WHERE id = ? AND revision = ?
            )`,
        ).bind(
          fileId,
          actor.id,
          job.teamId,
          jobId,
          itemId,
          storedObjectKey,
          validated.filename,
          validated.normalizedPath,
          validated.contentType,
          file.size,
          nextIndex,
          validated.sha256,
          validated.dimensions.width,
          validated.dimensions.height,
          JSON.stringify({
            valid: true,
            signatureChecked: true,
            dimensionsChecked: true,
            animated: false,
            sha256: validated.sha256,
          }),
          job.expiresAt,
          jobId,
          nextRevision,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        `UPDATE upload_job_items
            SET page_count = (
                  SELECT COUNT(*)
                    FROM upload_sessions
                   WHERE upload_job_item_id = ?
                     AND status = 'READY'
                ),
                status = CASE
                  WHEN EXISTS (
                    SELECT 1
                      FROM upload_sessions
                     WHERE upload_job_item_id = ?
                       AND status = 'READY'
                  )
                    THEN 'READY'
                  ELSE 'DRAFT'
                END,
                error_code = NULL,
                error_message = NULL,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND job_id = ?
            AND EXISTS (
              SELECT 1 FROM upload_jobs
               WHERE id = ? AND revision = ?
            )`,
      ).bind(itemId, itemId, itemId, jobId, jobId, nextRevision),
      env.DB.prepare(
        `UPDATE upload_jobs
            SET total_bytes = (
                  SELECT COALESCE(SUM(byte_size), 0)
                    FROM upload_sessions
                   WHERE upload_job_id = ?
                     AND status = 'READY'
                ),
                page_count = (
                  SELECT COUNT(*)
                    FROM upload_sessions
                   WHERE upload_job_id = ?
                     AND status = 'READY'
                ),
                status = CASE
                  WHEN NOT EXISTS (
                    SELECT 1
                      FROM upload_job_items
                     WHERE job_id = ?
                       AND page_count = 0
                  )
                   AND NOT EXISTS (
                    SELECT 1
                      FROM upload_sessions
                     WHERE upload_job_id = ?
                       AND status IN ('FAILED', 'RETRY_REQUIRED')
                  )
                    THEN 'READY'
                  ELSE 'UPLOADING'
                END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?`,
      ).bind(jobId, jobId, jobId, jobId, jobId, nextRevision),
      env.DB.prepare(
        "DELETE FROM upload_publish_guards WHERE job_id = ?",
      ).bind(jobId),
    );
    let result;
    try {
      result = await env.DB.batch(statements);
    } catch (mutationError) {
      if (
        mutationError instanceof Error &&
        /upload_publish_guards|constraint failed/i.test(mutationError.message)
      ) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This upload or its team authorization changed while the page was being saved.",
        );
      }
      throw mutationError;
    }
    if (!result[0]?.meta.changes) {
      throw new ApiError(
        409,
        "UPLOAD_JOB_CHANGED",
        "This upload changed while the page was being saved.",
      );
    }
    storedObjectKey = null;
    if (
      oldObjectKey &&
      !oldObjectKey.startsWith("rejected:")
    ) {
      await deleteMediaObject(env.DB, env.BUCKET, oldObjectKey, {
        mediaKind: "CHAPTER_UPLOAD",
        targetType: "UPLOAD_JOB",
        targetId: jobId,
        reason: "Replaced upload page",
      });
    }
    const files = await jobFiles(env.DB, jobId, itemId);
    const refreshed = await env.DB.prepare(
      "SELECT status, revision, total_bytes AS totalBytes, page_count AS pageCount FROM upload_jobs WHERE id = ?",
    )
      .bind(jobId)
      .first();
    return json(
      id,
      { data: files.results, job: refreshed },
      {
        status: existing ? 200 : 201,
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (error) {
    if (storedObjectKey && env.DB && env.BUCKET) {
      await deleteMediaObject(env.DB, env.BUCKET, storedObjectKey, {
        mediaKind: "CHAPTER_UPLOAD",
        targetType: "UPLOAD_JOB",
        targetId: "uncommitted",
        reason: "Upload page database write failed",
      }).catch(() => undefined);
    }
    return errorResponse(id, error);
  }
}

export async function PATCH(request: Request) {
  const id = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("upload.create");
    requireUploadCapability(actor);
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Upload pages are temporarily unavailable.",
      );
    }
    const payload = uploadFileMutationSchema.parse(await request.json());
    const job = await mutableJob(env.DB, actor, payload.jobId, payload.itemId);
    if (job.revision !== payload.expectedRevision) {
      throw new ApiError(
        409,
        "UPLOAD_JOB_CHANGED",
        "This upload changed. Reload before editing pages.",
      );
    }
    await requireUploadScope(env.DB, actor, job.seriesId, job.teamId);
    const file = await env.DB.prepare(
      `SELECT id,
              object_key AS objectKey,
              status,
              retry_count AS retryCount
         FROM upload_sessions
        WHERE id = ?
          AND upload_job_id = ?
          AND upload_job_item_id = ?
        LIMIT 1`,
    )
      .bind(payload.fileId, payload.jobId, payload.itemId)
      .first<{
        id: string;
        objectKey: string;
        status: string;
        retryCount: number;
    }>();
    if (!file) {
      throw new ApiError(
        404,
        "UPLOAD_PAGE_NOT_FOUND",
        "This upload page no longer exists.",
      );
    }
    if (payload.action === "RETRY") {
      if (file.status !== "FAILED") {
        throw new ApiError(
          409,
          "UPLOAD_PAGE_NOT_FAILED",
          "Only a failed page can be retried.",
        );
      }
      const authorization = liveMutationAuthorization(actor, "upload_jobs");
      const result = await env.DB.batch([
        env.DB.prepare(
          `UPDATE upload_jobs
              SET status = 'UPLOADING',
                  revision = revision + 1,
                  last_error_code = NULL,
                  last_error_message = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
              AND ${authorization.sql}`,
        ).bind(
          payload.jobId,
          payload.expectedRevision,
          ...authorization.bindings,
        ),
        env.DB.prepare(
          `INSERT INTO upload_publish_guards (job_id, verified)
           VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
        ).bind(payload.jobId),
        env.DB.prepare(
          `UPDATE upload_sessions
              SET status = 'RETRY_REQUIRED',
                  retry_count = retry_count + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND status = 'FAILED'
              AND EXISTS (
                SELECT 1 FROM upload_jobs
                 WHERE id = ? AND revision = ?
              )`,
        ).bind(
          payload.fileId,
          payload.jobId,
          payload.expectedRevision + 1,
        ),
        env.DB.prepare(
          "DELETE FROM upload_publish_guards WHERE job_id = ?",
        ).bind(payload.jobId),
      ]);
      if (!result[0]?.meta.changes) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This upload changed while retry was requested.",
        );
      }
      return json(
        id,
        {
          data: (await jobFiles(env.DB, payload.jobId, payload.itemId)).results,
          retryRequiresFile: true,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const remaining = await env.DB.prepare(
      `SELECT id
         FROM upload_sessions
        WHERE upload_job_id = ?
          AND upload_job_item_id = ?
          AND id <> ?
          AND status = 'READY'
        ORDER BY page_index, id`,
    )
      .bind(payload.jobId, payload.itemId, payload.fileId)
      .all<{ id: string }>();
    const nextRevision = job.revision + 1;
    const authorization = liveMutationAuthorization(actor, "upload_jobs");
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE upload_jobs
            SET revision = revision + 1,
                status = 'UPLOADING',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
            AND ${authorization.sql}`,
      ).bind(
        payload.jobId,
        payload.expectedRevision,
        ...authorization.bindings,
      ),
      env.DB.prepare(
        `INSERT INTO upload_publish_guards (job_id, verified)
         VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
      ).bind(payload.jobId),
      env.DB.prepare(
        `DELETE FROM upload_sessions
          WHERE id = ?
            AND upload_job_id = ?
            AND upload_job_item_id = ?
            AND EXISTS (
              SELECT 1 FROM upload_jobs
               WHERE id = ? AND revision = ?
            )`,
      ).bind(
        payload.fileId,
        payload.jobId,
        payload.itemId,
        payload.jobId,
        nextRevision,
      ),
      env.DB.prepare(
        `UPDATE upload_sessions
            SET page_index = -page_index - 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE upload_job_id = ?
            AND upload_job_item_id = ?
            AND status = 'READY'`,
      ).bind(payload.jobId, payload.itemId),
      ...remaining.results.map((entry, pageIndex) =>
        env.DB!.prepare(
          `UPDATE upload_sessions
              SET page_index = ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND upload_job_id = ?
              AND upload_job_item_id = ?`,
        ).bind(pageIndex, entry.id, payload.jobId, payload.itemId),
      ),
      env.DB.prepare(
        `UPDATE upload_job_items
            SET page_count = (
                  SELECT COUNT(*)
                    FROM upload_sessions
                   WHERE upload_job_item_id = ?
                     AND status = 'READY'
                ),
                status = CASE
                  WHEN EXISTS (
                    SELECT 1 FROM upload_sessions
                     WHERE upload_job_item_id = ?
                       AND status = 'READY'
                  )
                    THEN 'READY'
                  ELSE 'DRAFT'
                END,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      ).bind(payload.itemId, payload.itemId, payload.itemId),
      env.DB.prepare(
        `UPDATE upload_jobs
            SET total_bytes = (
                  SELECT COALESCE(SUM(byte_size), 0)
                    FROM upload_sessions
                   WHERE upload_job_id = ?
                     AND status = 'READY'
                ),
                page_count = (
                  SELECT COUNT(*)
                    FROM upload_sessions
                   WHERE upload_job_id = ?
                     AND status = 'READY'
                ),
                status = CASE
                  WHEN NOT EXISTS (
                    SELECT 1 FROM upload_job_items
                     WHERE job_id = ?
                       AND page_count = 0
                  )
                    THEN 'READY'
                  ELSE 'UPLOADING'
                END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?`,
      ).bind(
        payload.jobId,
        payload.jobId,
        payload.jobId,
        payload.jobId,
        nextRevision,
      ),
      env.DB.prepare(
        "DELETE FROM upload_publish_guards WHERE job_id = ?",
      ).bind(payload.jobId),
    ];
    const result = await env.DB.batch(statements);
    if (!result[0]?.meta.changes) {
      throw new ApiError(
        409,
        "UPLOAD_JOB_CHANGED",
        "This upload changed while the page was being removed.",
      );
    }
    if (
      env.BUCKET &&
      file.objectKey &&
      !file.objectKey.startsWith("rejected:")
    ) {
      await deleteMediaObject(env.DB, env.BUCKET, file.objectKey, {
        mediaKind: "CHAPTER_UPLOAD",
        targetType: "UPLOAD_JOB",
        targetId: payload.jobId,
        reason: "Removed upload page",
      });
    }
    return json(
      id,
      { data: (await jobFiles(env.DB, payload.jobId, payload.itemId)).results },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /upload_publish_guards|constraint failed/i.test(error.message)
    ) {
      return errorResponse(
        id,
        new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This upload or its team authorization changed during the page operation.",
        ),
      );
    }
    return errorResponse(id, error);
  }
}
