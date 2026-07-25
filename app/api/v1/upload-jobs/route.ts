import { env } from "cloudflare:workers";
import { z } from "zod";
import { UPLOAD_LIMITS, UPLOAD_METHODS } from "@/lib/uploads";
import {
  assertSameOrigin,
  auditStatement,
  deleteMediaObject,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertUploadRateLimit,
  chapterSlug,
  cleanupExpiredUploadDrafts,
  createUploadJobSchema,
  isUploadAdmin,
  requireUploadCapability,
  requireUploadScope,
  uploadJobMutationSchema,
} from "@/lib/server/upload-jobs";
import { requireActor, type Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum([
      "ALL",
      "DRAFT",
      "UPLOADING",
      "VALIDATING",
      "READY",
      "PUBLISHING",
      "PENDING_REVIEW",
      "PUBLISHED",
      "SCHEDULED",
      "REJECTED",
      "FAILED",
      "CANCELLED",
    ])
    .default("ALL"),
  teamId: z.string().trim().max(120).default(""),
});

type UploadItemRow = {
  id: string;
  jobId: string;
  clientKey: string;
  sourceLabel: string;
  seriesId: string;
  teamId: string | null;
  chapterId: string | null;
  volume: string | null;
  chapterNumber: string;
  title: string;
  language: string;
  version: number;
  releaseNotes: string;
  creditsJson: string;
  accessType: "FREE" | "PAID";
  priceOnyx: number;
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  scheduledAt: string | null;
  commentsEnabled: number;
  status: string;
  pageCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type UploadFileRow = {
  id: string;
  itemId: string;
  filename: string;
  sourcePath: string;
  contentType: string;
  byteSize: number;
  pageIndex: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  status: string;
  validationJson: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

function jobVisibility(actor: Actor, alias = "uj") {
  if (isUploadAdmin(actor)) return { sql: "1 = 1", bindings: [] as unknown[] };
  if (actor.managedTeamIds.length > 0) {
    return {
      sql: `(${alias}.user_id = ? OR ${alias}.team_id IN (${actor.managedTeamIds
        .map(() => "?")
        .join(", ")}))`,
      bindings: [actor.id, ...actor.managedTeamIds],
    };
  }
  return { sql: `${alias}.user_id = ?`, bindings: [actor.id] };
}

function liveJobAuthorization(
  actor: Actor,
  input: {
    alias?: string;
    language?: string;
    requirePublish?: boolean;
  } = {},
) {
  const alias = input.alias ?? "upload_jobs";
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
           AND live_actor.primary_role IN ('OWNER', 'ADMINISTRATOR')
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

  const languagePolicy = input.language
    ? `AND json_valid(live_assignment.allowed_languages_json) = 1
       AND (
         json_array_length(live_assignment.allowed_languages_json) = 0
         OR EXISTS (
           SELECT 1
             FROM json_each(live_assignment.allowed_languages_json)
            WHERE LOWER(CAST(value AS TEXT)) IN ('*', LOWER(?))
         )
       )`
    : `AND json_valid(live_assignment.allowed_languages_json) = 1
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
       )`;
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
         AND live_actor.primary_role IN ('TEAM_LEADER', 'UPLOADER')
         AND live_membership.status = 'ACTIVE'
         AND UPPER(live_membership.membership_role) IN
           ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
         AND live_assignment.can_upload = 1
         AND live_assignment.revoked_at IS NULL
         AND live_team.is_archived = 0
         AND live_team.verification_status <> 'SUSPENDED'
         ${languagePolicy}
         ${
           input.requirePublish
             ? `AND live_assignment.can_publish = 1
                AND live_assignment.upload_requires_review = 0`
             : ""
         }
    )
    AND ${seriesIsEligible}`,
    bindings: [
      actor.id,
      ...(input.language ? [input.language.toLowerCase()] : []),
    ] as unknown[],
  };
}

function statusPredicate(status: string, alias = "uj") {
  return status === "ALL" ? "1 = 1" : `${alias}.status = ?`;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function jobDetail(db: D1Database, actor: Actor, jobId: string) {
  const visibility = jobVisibility(actor);
  const job = await db
    .prepare(
      `SELECT uj.id,
              uj.user_id AS userId,
              uj.team_id AS teamId,
              uj.series_id AS seriesId,
              uj.kind,
              uj.source_type AS sourceType,
              uj.status,
              uj.idempotency_key AS idempotencyKey,
              uj.publish_idempotency_key AS publishIdempotencyKey,
              uj.total_bytes AS totalBytes,
              uj.page_count AS pageCount,
              uj.last_error_code AS lastErrorCode,
              uj.last_error_message AS lastErrorMessage,
              uj.revision,
              uj.expires_at AS expiresAt,
              uj.submitted_at AS submittedAt,
              uj.completed_at AS completedAt,
              uj.created_at AS createdAt,
              uj.updated_at AS updatedAt,
              s.slug AS seriesSlug,
              s.title AS seriesTitle,
              t.name AS teamName,
              u.display_name AS uploaderName
         FROM upload_jobs uj
         JOIN series s ON s.id = uj.series_id
         JOIN users u ON u.id = uj.user_id
         LEFT JOIN teams t ON t.id = uj.team_id
        WHERE uj.id = ?
          AND ${visibility.sql}
        LIMIT 1`,
    )
    .bind(jobId, ...visibility.bindings)
    .first<Record<string, unknown>>();
  if (!job) {
    throw new ApiError(
      404,
      "UPLOAD_JOB_NOT_FOUND",
      "This upload draft is unavailable.",
    );
  }
  const [itemsResult, filesResult] = await Promise.all([
    db
      .prepare(
        `SELECT id,
                job_id AS jobId,
                client_key AS clientKey,
                source_label AS sourceLabel,
                series_id AS seriesId,
                team_id AS teamId,
                chapter_id AS chapterId,
                volume,
                chapter_number AS chapterNumber,
                title,
                language,
                version,
                release_notes AS releaseNotes,
                credits_json AS creditsJson,
                access_type AS accessType,
                price_onyx AS priceOnyx,
                visibility,
                scheduled_at AS scheduledAt,
                comments_enabled AS commentsEnabled,
                status,
                page_count AS pageCount,
                error_code AS errorCode,
                error_message AS errorMessage,
                revision,
                created_at AS createdAt,
                updated_at AS updatedAt
           FROM upload_job_items
          WHERE job_id = ?
          ORDER BY created_at, id`,
      )
      .bind(jobId)
      .all<UploadItemRow>(),
    db
      .prepare(
        `SELECT id,
                upload_job_item_id AS itemId,
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
          ORDER BY upload_job_item_id, page_index, created_at`,
      )
      .bind(jobId)
      .all<UploadFileRow>(),
  ]);
  const filesByItem = new Map<string, UploadFileRow[]>();
  for (const file of filesResult.results) {
    filesByItem.set(file.itemId, [
      ...(filesByItem.get(file.itemId) ?? []),
      {
        ...file,
        validationJson: JSON.stringify(
          parseJson(file.validationJson, {}),
        ),
      },
    ]);
  }
  return {
    ...job,
    items: itemsResult.results.map((item) => ({
      ...item,
      credits: parseJson(item.creditsJson, {}),
      commentsEnabled: Boolean(item.commentsEnabled),
      files: filesByItem.get(item.id) ?? [],
    })),
  };
}

async function uploadOptions(db: D1Database, actor: Actor) {
  const admin = isUploadAdmin(actor);
  const [seriesResult, teamsResult] = admin
    ? await Promise.all([
        db
          .prepare(
            `SELECT id, slug, title
               FROM series
              WHERE is_published = 1
                AND archived_at IS NULL
                AND rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
              ORDER BY title COLLATE NOCASE, id`,
          )
          .all(),
        db
          .prepare(
            `SELECT id, slug, name
               FROM teams
              WHERE is_archived = 0
                AND verification_status <> 'SUSPENDED'
              ORDER BY name COLLATE NOCASE, id`,
          )
          .all(),
      ])
    : await Promise.all([
        db
          .prepare(
            `SELECT DISTINCT s.id,
                    s.slug,
                    s.title,
                    sta.team_id AS teamId,
                    t.name AS teamName,
                    sta.can_publish AS canPublish,
                    sta.upload_requires_review AS uploadRequiresReview,
                    sta.allowed_languages_json AS allowedLanguagesJson
               FROM series s
               JOIN series_team_assignments sta ON sta.series_id = s.id
               JOIN team_memberships tm ON tm.team_id = sta.team_id
               JOIN teams t ON t.id = sta.team_id
              WHERE tm.user_id = ?
                AND tm.status = 'ACTIVE'
                AND UPPER(tm.membership_role) IN
                  ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
                AND sta.can_upload = 1
                AND sta.revoked_at IS NULL
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                AND t.is_archived = 0
                AND t.verification_status <> 'SUSPENDED'
              ORDER BY s.title COLLATE NOCASE, t.name COLLATE NOCASE`,
          )
          .bind(actor.id)
          .all(),
        db
          .prepare(
            `SELECT DISTINCT t.id, t.slug, t.name
               FROM teams t
               JOIN team_memberships tm ON tm.team_id = t.id
              WHERE tm.user_id = ?
                AND tm.status = 'ACTIVE'
                AND UPPER(tm.membership_role) IN
                  ('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER')
                AND t.is_archived = 0
                AND t.verification_status <> 'SUSPENDED'
              ORDER BY t.name COLLATE NOCASE, t.id`,
          )
          .bind(actor.id)
          .all(),
      ]);
  return {
    series: seriesResult.results,
    teams: teamsResult.results,
    methods: UPLOAD_METHODS,
    limits: UPLOAD_LIMITS,
    admin,
  };
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
        "Upload drafts are temporarily unavailable.",
      );
    }
    if (env.BUCKET) {
      try {
        await cleanupExpiredUploadDrafts(env.DB, env.BUCKET, actor, id);
      } catch (cleanupError) {
        console.error("Upload draft cleanup deferred", cleanupError);
      }
    }
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "list";
    if (view === "options") {
      return json(
        id,
        await uploadOptions(env.DB, actor),
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const selectedJobId = url.searchParams.get("jobId");
    if (selectedJobId) {
      return json(
        id,
        { data: await jobDetail(env.DB, actor, selectedJobId) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const query = listQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      teamId: url.searchParams.get("teamId") ?? undefined,
    });
    const visibility = jobVisibility(actor);
    const statusBindings = query.status === "ALL" ? [] : [query.status];
    const teamPredicate = query.teamId ? "uj.team_id = ?" : "1 = 1";
    const teamBindings = query.teamId ? [query.teamId] : [];
    const offset = (query.page - 1) * query.pageSize;
    const where = `${visibility.sql}
      AND ${statusPredicate(query.status)}
      AND ${teamPredicate}`;
    const bindings = [
      ...visibility.bindings,
      ...statusBindings,
      ...teamBindings,
    ];
    const [rows, totalRow, summaryRows] = await Promise.all([
      env.DB.prepare(
        `SELECT uj.id,
                uj.kind,
                uj.source_type AS sourceType,
                uj.status,
                uj.total_bytes AS totalBytes,
                uj.page_count AS pageCount,
                uj.last_error_code AS lastErrorCode,
                uj.last_error_message AS lastErrorMessage,
                uj.revision,
                uj.expires_at AS expiresAt,
                uj.created_at AS createdAt,
                uj.updated_at AS updatedAt,
                uj.completed_at AS completedAt,
                s.id AS seriesId,
                s.slug AS seriesSlug,
                s.title AS seriesTitle,
                t.id AS teamId,
                t.name AS teamName,
                u.display_name AS uploaderName,
                COUNT(uji.id) AS chapterCount
           FROM upload_jobs uj
           JOIN series s ON s.id = uj.series_id
           JOIN users u ON u.id = uj.user_id
           LEFT JOIN teams t ON t.id = uj.team_id
           LEFT JOIN upload_job_items uji ON uji.job_id = uj.id
          WHERE ${where}
          GROUP BY uj.id
          ORDER BY uj.updated_at DESC, uj.id DESC
          LIMIT ? OFFSET ?`,
      )
        .bind(...bindings, query.pageSize, offset)
        .all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count
           FROM upload_jobs uj
          WHERE ${where}`,
      )
        .bind(...bindings)
        .first<{ count: number }>(),
      env.DB.prepare(
        `SELECT uj.status, COUNT(*) AS count
           FROM upload_jobs uj
          WHERE ${visibility.sql}
          GROUP BY uj.status`,
      )
        .bind(...visibility.bindings)
        .all<{ status: string; count: number }>(),
    ]);
    const total = Number(totalRow?.count ?? 0);
    return json(
      id,
      {
        data: rows.results,
        summary: Object.fromEntries(
          summaryRows.results.map((row) => [row.status, Number(row.count)]),
        ),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(id, error);
  }
}

export async function POST(request: Request) {
  const id = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("upload.create");
    requireUploadCapability(actor);
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Upload drafts are temporarily unavailable.",
      );
    }
    const payload = createUploadJobSchema.parse(await request.json());
    await assertUploadRateLimit(env.DB, actor, "JOB");
    const existing = await env.DB.prepare(
      `SELECT id
         FROM upload_jobs
        WHERE user_id = ?
          AND idempotency_key = ?
        LIMIT 1`,
    )
      .bind(actor.id, payload.idempotencyKey)
      .first<{ id: string }>();
    if (existing) {
      return json(
        id,
        {
          data: await jobDetail(env.DB, actor, existing.id),
          reused: true,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const scope = await requireUploadScope(
      env.DB,
      actor,
      payload.seriesId,
      payload.teamId,
      payload.items.map((item) => item.language),
    );
    for (const item of payload.items) {
      const duplicate = await env.DB.prepare(
        `SELECT c.id, c.state
           FROM chapters c
          WHERE c.series_id = ?
            AND c.chapter_number = ?
            AND c.language = ?
            AND COALESCE(c.team_id, '') = COALESCE(?, '')
            AND c.version = ?
            AND c.state IN ('READY_FOR_REVIEW', 'PUBLISHED')
          LIMIT 1`,
      )
        .bind(
          payload.seriesId,
          item.chapterNumber,
          item.language,
          scope.teamId,
          item.version,
        )
        .first();
      if (duplicate) {
        throw new ApiError(
          409,
          "DUPLICATE_RELEASE",
          `Chapter ${item.chapterNumber} already has this team, language, and version.`,
        );
      }
    }
    const jobId = `upj_${randomId()}`;
    const itemRecords = payload.items.map((item) => ({
      ...item,
      id: `upi_${randomId()}`,
    }));
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO upload_jobs
         (id, user_id, team_id, series_id, kind, source_type, status,
          idempotency_key, total_bytes, page_count, revision, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, 0, 0, 1,
                 datetime('now', ?))`,
      ).bind(
        jobId,
        actor.id,
        scope.teamId,
        payload.seriesId,
        payload.kind,
        payload.sourceType,
        payload.idempotencyKey,
        `+${UPLOAD_LIMITS.draftLifetimeDays} days`,
      ),
      ...itemRecords.map((item) =>
        env.DB!.prepare(
          `INSERT INTO upload_job_items
           (id, job_id, client_key, source_label, series_id, team_id,
            volume, chapter_number, title, language, version, release_notes,
            credits_json, access_type, price_onyx, visibility, scheduled_at,
            comments_enabled, status, page_count, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'DRAFT', 0, 1)`,
        ).bind(
          item.id,
          jobId,
          item.clientKey,
          item.sourceLabel,
          payload.seriesId,
          scope.teamId,
          item.volume || null,
          item.chapterNumber,
          item.title,
          item.language,
          item.version,
          item.releaseNotes,
          JSON.stringify(item.credits),
          item.accessType,
          item.priceOnyx,
          item.visibility,
          item.scheduledAt,
          item.commentsEnabled ? 1 : 0,
        ),
      ),
      auditStatement(env.DB, actor, id, {
        action: "upload.job.create",
        category: "UPLOADS_IMPORTS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "UPLOAD_JOB",
        targetId: jobId,
        targetLabel: scope.seriesTitle,
        newValue: {
          kind: payload.kind,
          sourceType: payload.sourceType,
          seriesId: payload.seriesId,
          teamId: scope.teamId,
          chapterCount: itemRecords.length,
        },
      }),
    ]);
    return json(
      id,
      { data: await jobDetail(env.DB, actor, jobId), reused: false },
      {
        status: 201,
        headers: { "cache-control": "private, no-store" },
      },
    );
  } catch (error) {
    return errorResponse(id, error);
  }
}

async function assertJobMutable(
  db: D1Database,
  actor: Actor,
  jobId: string,
) {
  const visibility = jobVisibility(actor);
  const job = await db
    .prepare(
      `SELECT id,
              user_id AS userId,
              team_id AS teamId,
              series_id AS seriesId,
              status,
              revision,
              publish_idempotency_key AS publishIdempotencyKey
         FROM upload_jobs uj
        WHERE id = ?
          AND ${visibility.sql}
        LIMIT 1`,
    )
    .bind(jobId, ...visibility.bindings)
    .first<{
      id: string;
      userId: string;
      teamId: string | null;
      seriesId: string;
      status: string;
      revision: number;
      publishIdempotencyKey: string | null;
    }>();
  if (!job) {
    throw new ApiError(
      404,
      "UPLOAD_JOB_NOT_FOUND",
      "This upload draft is unavailable.",
    );
  }
  return job;
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
        "Upload drafts are temporarily unavailable.",
      );
    }
    const payload = uploadJobMutationSchema.parse(await request.json());
    const job = await assertJobMutable(env.DB, actor, payload.jobId);
    if (payload.action === "UPDATE_ITEM") {
      if (!["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status)) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_LOCKED",
          "This upload can no longer be edited.",
        );
      }
      await requireUploadScope(
        env.DB,
        actor,
        job.seriesId,
        job.teamId,
        [payload.item.language],
      );
      const duplicate = await env.DB.prepare(
        `SELECT id
           FROM chapters
          WHERE series_id = ?
            AND chapter_number = ?
            AND language = ?
            AND COALESCE(team_id, '') = COALESCE(?, '')
            AND version = ?
            AND state IN ('READY_FOR_REVIEW', 'PUBLISHED')
          LIMIT 1`,
      )
        .bind(
          job.seriesId,
          payload.item.chapterNumber,
          payload.item.language,
          job.teamId,
          payload.item.version,
        )
        .first();
      if (duplicate) {
        throw new ApiError(
          409,
          "DUPLICATE_RELEASE",
          "This exact release already exists.",
        );
      }
      const authorization = liveJobAuthorization(actor, {
        alias: "upload_jobs",
        language: payload.item.language,
      });
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE upload_jobs
              SET revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
              AND ${authorization.sql}`,
        ).bind(payload.jobId, job.revision, ...authorization.bindings),
        env.DB.prepare(
          `INSERT INTO upload_publish_guards (job_id, verified)
           VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
        ).bind(payload.jobId),
        env.DB.prepare(
          `UPDATE upload_job_items
              SET source_label = ?,
                  volume = ?,
                  chapter_number = ?,
                  title = ?,
                  language = ?,
                  version = ?,
                  release_notes = ?,
                  credits_json = ?,
                  access_type = ?,
                  price_onyx = ?,
                  visibility = ?,
                  scheduled_at = ?,
                  comments_enabled = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND job_id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'READY', 'FAILED')
              AND EXISTS (
                SELECT 1 FROM upload_publish_guards
                 WHERE job_id = ? AND verified = 1
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM upload_job_items duplicate_item
                 WHERE duplicate_item.job_id = upload_job_items.job_id
                   AND duplicate_item.id <> upload_job_items.id
                   AND duplicate_item.chapter_number = ?
                   AND duplicate_item.language = ?
                   AND duplicate_item.version = ?
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM chapters duplicate_chapter
                 WHERE duplicate_chapter.series_id = upload_job_items.series_id
                   AND duplicate_chapter.chapter_number = ?
                   AND duplicate_chapter.language = ?
                   AND COALESCE(duplicate_chapter.team_id, '') =
                       COALESCE(upload_job_items.team_id, '')
                   AND duplicate_chapter.version = ?
                   AND duplicate_chapter.state IN
                     ('READY_FOR_REVIEW', 'PUBLISHED')
              )`,
        ).bind(
          payload.item.sourceLabel,
          payload.item.volume || null,
          payload.item.chapterNumber,
          payload.item.title,
          payload.item.language,
          payload.item.version,
          payload.item.releaseNotes,
          JSON.stringify(payload.item.credits),
          payload.item.accessType,
          payload.item.priceOnyx,
          payload.item.visibility,
          payload.item.scheduledAt,
          payload.item.commentsEnabled ? 1 : 0,
          payload.itemId,
          payload.jobId,
          payload.expectedRevision,
          payload.jobId,
          payload.item.chapterNumber,
          payload.item.language,
          payload.item.version,
          payload.item.chapterNumber,
          payload.item.language,
          payload.item.version,
        ),
        env.DB.prepare(
          `UPDATE upload_publish_guards
              SET verified = CASE WHEN changes() = 1 THEN 1 ELSE NULL END
            WHERE job_id = ?`,
        ).bind(payload.jobId),
        env.DB.prepare(
          "DELETE FROM upload_publish_guards WHERE job_id = ?",
        ).bind(payload.jobId),
      ]);
      return json(
        id,
        { data: await jobDetail(env.DB, actor, payload.jobId) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (payload.action === "REORDER") {
      if (!["UPLOADING", "READY", "FAILED"].includes(job.status)) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_LOCKED",
          "Pages can be reordered only before submission.",
        );
      }
      if (job.revision !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This upload changed. Reload before reordering pages.",
        );
      }
      await requireUploadScope(
        env.DB,
        actor,
        job.seriesId,
        job.teamId,
      );
      const stored = await env.DB.prepare(
        `SELECT id
           FROM upload_sessions
          WHERE upload_job_id = ?
            AND upload_job_item_id = ?
            AND status = 'READY'
          ORDER BY page_index, id`,
      )
        .bind(payload.jobId, payload.itemId)
        .all<{ id: string }>();
      const expected = new Set(stored.results.map((file) => file.id));
      if (
        expected.size !== payload.fileIds.length ||
        payload.fileIds.some((fileId) => !expected.has(fileId))
      ) {
        throw new ApiError(
          422,
          "PAGE_ORDER_INCOMPLETE",
          "The page order must include every validated page exactly once.",
        );
      }
      const nextRevision = job.revision + 1;
      const authorization = liveJobAuthorization(actor, {
        alias: "upload_jobs",
      });
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE upload_jobs
              SET revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('UPLOADING', 'READY', 'FAILED')
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
              SET page_index = -page_index - 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE upload_job_id = ?
              AND upload_job_item_id = ?
              AND status = 'READY'
              AND EXISTS (
                SELECT 1 FROM upload_publish_guards
                 WHERE job_id = ? AND verified = 1
              )`,
        ).bind(
          payload.jobId,
          payload.itemId,
          payload.jobId,
        ),
        ...payload.fileIds.map((fileId, pageIndex) =>
          env.DB!.prepare(
            `UPDATE upload_sessions
                SET page_index = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND upload_job_id = ?
                AND upload_job_item_id = ?
                AND status = 'READY'
                AND EXISTS (
                  SELECT 1 FROM upload_publish_guards
                   WHERE job_id = ?
                     AND verified = 1
                )`,
          ).bind(
            pageIndex,
            fileId,
            payload.jobId,
            payload.itemId,
            payload.jobId,
          ),
        ),
        env.DB.prepare(
          "DELETE FROM upload_publish_guards WHERE job_id = ?",
        ).bind(payload.jobId),
      ]);
      const changed = await env.DB.prepare(
        "SELECT revision FROM upload_jobs WHERE id = ?",
      )
        .bind(payload.jobId)
        .first<{ revision: number }>();
      if (changed?.revision !== nextRevision) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This upload changed while pages were being reordered.",
        );
      }
      return json(
        id,
        { data: await jobDetail(env.DB, actor, payload.jobId) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (payload.action === "DISCARD") {
      if (
        !["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status) ||
        job.revision !== payload.expectedRevision
      ) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This draft changed or can no longer be discarded.",
        );
      }
      const objects = await env.DB.prepare(
        `SELECT id, object_key AS objectKey
           FROM upload_sessions
          WHERE upload_job_id = ?
            AND status <> 'CLEANED'`,
      )
        .bind(payload.jobId)
        .all<{ id: string; objectKey: string }>();
      const discarded = await env.DB.batch([
        env.DB.prepare(
          `UPDATE upload_jobs
              SET status = 'CANCELLED',
                  revision = revision + 1,
                  completed_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')`,
        ).bind(payload.jobId, payload.expectedRevision),
        env.DB.prepare(
          `INSERT INTO upload_publish_guards (job_id, verified)
           VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
        ).bind(payload.jobId),
        env.DB.prepare(
          `UPDATE upload_job_items
              SET status = 'CANCELLED',
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE job_id = ?
              AND EXISTS (
                SELECT 1 FROM upload_publish_guards
                 WHERE job_id = ? AND verified = 1
              )`,
        ).bind(payload.jobId, payload.jobId),
        auditStatement(
          env.DB,
          actor,
          id,
          {
            action: "upload.job.discard",
            category: "UPLOADS_IMPORTS",
            sourceArea: "UPLOAD_CENTER",
            targetType: "UPLOAD_JOB",
            targetId: payload.jobId,
            reason: "Uploader discarded draft",
          },
          `EXISTS (
            SELECT 1 FROM upload_publish_guards
             WHERE job_id = '${payload.jobId.replaceAll("'", "''")}'
               AND verified = 1
          )`,
        ),
        env.DB.prepare(
          "DELETE FROM upload_publish_guards WHERE job_id = ?",
        ).bind(payload.jobId),
      ]);
      if (!discarded[0]?.meta.changes) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This draft changed while it was being discarded.",
        );
      }
      if (env.BUCKET) {
        for (const object of objects.results) {
          const deleted = await deleteMediaObject(
            env.DB,
            env.BUCKET,
            object.objectKey,
            {
              mediaKind: "CHAPTER_UPLOAD",
              targetType: "UPLOAD_JOB",
              targetId: payload.jobId,
              reason: "Discarded upload draft",
            },
          );
          if (deleted) {
            await env.DB.prepare(
              `UPDATE upload_sessions
                  SET status = 'CLEANED',
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
            )
              .bind(object.id)
              .run();
          }
        }
      }
      return json(
        id,
        { data: await jobDetail(env.DB, actor, payload.jobId) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (job.status === "PUBLISHED" || job.status === "SCHEDULED") {
      if (job.publishIdempotencyKey === payload.idempotencyKey) {
        return json(
          id,
          {
            data: await jobDetail(env.DB, actor, payload.jobId),
            reused: true,
          },
          { headers: { "cache-control": "private, no-store" } },
        );
      }
      throw new ApiError(
        409,
        "UPLOAD_ALREADY_PUBLISHED",
        "This upload was already published.",
      );
    }
    if (job.status === "PENDING_REVIEW") {
      if (job.publishIdempotencyKey === payload.idempotencyKey) {
        return json(
          id,
          {
            data: await jobDetail(env.DB, actor, payload.jobId),
            reused: true,
          },
          { headers: { "cache-control": "private, no-store" } },
        );
      }
      throw new ApiError(
        409,
        "UPLOAD_ALREADY_SUBMITTED",
        "This upload is already waiting for review.",
      );
    }
    if (job.status !== "READY" || job.revision !== payload.expectedRevision) {
      throw new ApiError(
        409,
        "UPLOAD_NOT_READY",
        "Resolve page and metadata errors before publishing.",
      );
    }
    const detail = await jobDetail(env.DB, actor, payload.jobId);
    const items = detail.items as unknown as Array<
      Omit<UploadItemRow, "commentsEnabled"> & {
        commentsEnabled: boolean;
        files: UploadFileRow[];
      }
    >;
    const detailSummary = detail as Record<string, unknown>;
    if (
      items.length === 0 ||
      items.some(
        (item) =>
          item.status !== "READY" ||
          item.files.length === 0 ||
          item.files.length > UPLOAD_LIMITS.maxPagesPerChapter ||
          item.files.some((file) => file.status !== "READY"),
      )
    ) {
      throw new ApiError(
        422,
        "UPLOAD_VALIDATION_INCOMPLETE",
        "Every chapter needs validated pages before it can be published.",
      );
    }
    const scope = await requireUploadScope(
      env.DB,
      actor,
      job.seriesId,
      job.teamId,
      items.map((item) => item.language),
    );
    for (const item of items) {
      const duplicate = await env.DB.prepare(
        `SELECT id
           FROM chapters
          WHERE series_id = ?
            AND chapter_number = ?
            AND language = ?
            AND COALESCE(team_id, '') = COALESCE(?, '')
            AND version = ?
            AND state IN ('READY_FOR_REVIEW', 'PUBLISHED')
          LIMIT 1`,
      )
        .bind(
          job.seriesId,
          item.chapterNumber,
          item.language,
          job.teamId,
          item.version,
        )
        .first();
      if (duplicate) {
        throw new ApiError(
          409,
          "DUPLICATE_RELEASE",
          `Chapter ${item.chapterNumber} already has this team, language, and version.`,
        );
      }
    }
    const needsReview = scope.uploadRequiresReview || !scope.canPublish;
    const now = Date.now();
    const allScheduled =
      !needsReview &&
      items.every(
        (item) =>
          item.scheduledAt &&
          Number.isFinite(Date.parse(item.scheduledAt)) &&
          Date.parse(item.scheduledAt) > now,
      );
    const finalJobStatus = needsReview
      ? "PENDING_REVIEW"
      : allScheduled
        ? "SCHEDULED"
        : "PUBLISHED";
    const nextRevision = job.revision + 1;
    const authorization = liveJobAuthorization(actor, {
      alias: "upload_jobs",
      requirePublish: !needsReview,
    });
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE upload_jobs
            SET status = 'PUBLISHING',
                publish_idempotency_key = ?,
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND revision = ?
            AND status = 'READY'
            AND ${authorization.sql}`,
      ).bind(
        payload.idempotencyKey,
        payload.jobId,
        payload.expectedRevision,
        ...authorization.bindings,
      ),
    ];
    for (const item of items) {
      const newChapterId = `ch_${randomId()}`;
      const chapterState = needsReview ? "READY_FOR_REVIEW" : "PUBLISHED";
      const publishedAt = needsReview
        ? null
        : item.scheduledAt ?? new Date().toISOString();
      statements.push(
        env.DB.prepare(
          `INSERT INTO chapters
           (id, series_id, team_id, uploader_user_id, slug, volume,
            chapter_number, title, language, format, state, access_type,
            price_onyx, page_count, published_at, free_at, version,
            release_notes, credits_json, visibility, comments_enabled,
            revision)
           SELECT ?, uji.series_id, uji.team_id, ?, ?, uji.volume,
                  uji.chapter_number, uji.title, uji.language, 'VERTICAL',
                  ?, uji.access_type, uji.price_onyx, uji.page_count, ?,
                  NULL, uji.version, uji.release_notes, uji.credits_json,
                  uji.visibility, uji.comments_enabled, 1
             FROM upload_job_items uji
             JOIN upload_jobs uj ON uj.id = uji.job_id
            WHERE uji.id = ?
              AND uji.job_id = ?
              AND uji.status = 'READY'
              AND uji.page_count > 0
              AND uj.status = 'PUBLISHING'
              AND uj.revision = ?
              AND NOT EXISTS (
                SELECT 1
                  FROM chapters duplicate
                 WHERE duplicate.series_id = uji.series_id
                   AND duplicate.chapter_number = uji.chapter_number
                   AND duplicate.language = uji.language
                   AND COALESCE(duplicate.team_id, '') =
                       COALESCE(uji.team_id, '')
                   AND duplicate.version = uji.version
                   AND duplicate.state IN ('READY_FOR_REVIEW', 'PUBLISHED')
              )`,
        ).bind(
          newChapterId,
          actor.id,
          chapterSlug(
            item.chapterNumber,
            item.language,
            item.version,
            job.teamId,
            item.id,
          ),
          chapterState,
          publishedAt,
          item.id,
          payload.jobId,
          nextRevision,
        ),
        env.DB.prepare(
          `INSERT INTO chapter_pages
           (id, chapter_id, page_index, object_key, width, height, sha256,
            processing_status)
           SELECT 'pg_' || us.id, ?, us.page_index, us.object_key,
                  us.width, us.height, us.sha256, 'READY'
             FROM upload_sessions us
            WHERE us.upload_job_id = ?
              AND us.upload_job_item_id = ?
              AND us.status = 'READY'
              AND EXISTS (
                SELECT 1 FROM chapters c WHERE c.id = ?
              )
            ORDER BY us.page_index`,
        ).bind(newChapterId, payload.jobId, item.id, newChapterId),
        env.DB.prepare(
          `UPDATE upload_job_items
              SET chapter_id = ?,
                  status = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND job_id = ?
              AND status = 'READY'
              AND EXISTS (SELECT 1 FROM chapters c WHERE c.id = ?)`,
        ).bind(
          newChapterId,
          needsReview ? "PENDING_REVIEW" : finalJobStatus,
          item.id,
          payload.jobId,
          newChapterId,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO upload_publish_guards (job_id, verified)
         SELECT ?, CASE
           WHEN (
             SELECT COUNT(*)
               FROM upload_job_items
              WHERE job_id = ?
                AND chapter_id IS NOT NULL
                AND status = ?
           ) = (
             SELECT COUNT(*) FROM upload_job_items WHERE job_id = ?
           )
           AND EXISTS (
             SELECT 1 FROM upload_jobs
              WHERE id = ?
                AND status = 'PUBLISHING'
                AND revision = ?
           )
           THEN 1
           ELSE NULL
         END`,
      ).bind(
        payload.jobId,
        payload.jobId,
        needsReview ? "PENDING_REVIEW" : finalJobStatus,
        payload.jobId,
        payload.jobId,
        nextRevision,
      ),
      env.DB.prepare(
        `UPDATE upload_jobs
            SET status = ?,
                submitted_at = CURRENT_TIMESTAMP,
                completed_at = CASE
                  WHEN ? IN ('PUBLISHED', 'SCHEDULED')
                    THEN CURRENT_TIMESTAMP
                  ELSE NULL
                END,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'PUBLISHING'
            AND revision = ?
            AND EXISTS (
              SELECT 1 FROM upload_publish_guards
               WHERE job_id = ? AND verified = 1
            )`,
      ).bind(
        finalJobStatus,
        finalJobStatus,
        payload.jobId,
        nextRevision,
        payload.jobId,
      ),
      auditStatement(env.DB, actor, id, {
        action: needsReview ? "upload.job.submit" : "upload.job.publish",
        category: "UPLOADS_IMPORTS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "UPLOAD_JOB",
        targetId: payload.jobId,
        targetLabel: String(detailSummary.seriesTitle ?? ""),
        newValue: {
          status: finalJobStatus,
          seriesId: job.seriesId,
          teamId: job.teamId,
          chapterCount: items.length,
          pageCount: Number(detailSummary.pageCount ?? 0),
        },
      }),
      env.DB.prepare(
        "DELETE FROM upload_publish_guards WHERE job_id = ?",
      ).bind(payload.jobId),
    );
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (
        error instanceof Error &&
        /not null constraint failed.*upload_publish_guards\.verified/i.test(
          error.message,
        )
      ) {
        throw new ApiError(
          409,
          "UPLOAD_PUBLISH_CONFLICT",
          "The upload, duplicate state, or team permission changed before publishing. Reload and review it.",
        );
      }
      throw error;
    }
    return json(
      id,
      {
        data: await jobDetail(env.DB, actor, payload.jobId),
        reused: false,
      },
      {
        status: needsReview ? 202 : 201,
        headers: { "cache-control": "private, no-store" },
      },
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
          "This upload changed while the operation was being committed.",
        ),
      );
    }
    return errorResponse(id, error);
  }
}
