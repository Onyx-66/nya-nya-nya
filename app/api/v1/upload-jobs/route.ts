import { env } from "cloudflare:workers";
import { z } from "zod";
import { normalizeChapterNumber as normalizePolicyChapterNumber } from "@/lib/chapter-number";
import { UPLOAD_LIMITS, UPLOAD_METHODS } from "@/lib/uploads";
import { canAny } from "@/lib/permissions.mjs";
import {
  assertSameOrigin,
  auditStatement,
  deleteMediaObject,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  getCommercialSettingsDocument,
  requirePaidEconomyPublicDocument,
} from "@/lib/server/commercial-settings";
import {
  findPaidChapterReference,
  type PaidChapterReference,
} from "@/lib/server/chapter-access-policy";
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

function paidEconomyPublicSql(expectedRevision: number) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new ApiError(
      403,
      "PAID_ECONOMY_HIDDEN",
      "The premium coin economy is currently private.",
    );
  }
  return `EXISTS (
    SELECT 1
      FROM commercial_settings live_commercial
     WHERE live_commercial.id = 'active'
       AND live_commercial.revision = ${expectedRevision}
       AND json_valid(live_commercial.settings_json)
       AND json_type(
             live_commercial.settings_json,
             '$.economy.premiumEconomyPublic'
           ) = 'true'
  )`;
}

function isUploadGuardFailure(error: unknown) {
  return (
    error instanceof Error &&
    /not null constraint failed.*upload_publish_guards\.verified/i.test(
      error.message,
    )
  );
}

async function assertPaidEconomyGuardFresh(expectedRevision: number) {
  const current = await requirePaidEconomyPublicDocument();
  if (current.revision !== expectedRevision) {
    throw new ApiError(
      409,
      "COMMERCIAL_SETTINGS_CHANGED",
      "Commercial settings changed while this upload was being saved. Review the paid chapter selection and retry.",
    );
  }
}

type UploadItemRow = {
  id: string;
  jobId: string;
  clientKey: string;
  sourceLabel: string;
  seriesId: string;
  teamId: string | null;
  chapterId: string | null;
  replacementChapterId: string | null;
  thumbnailKey: string | null;
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
  includeFixedFirstPage: number;
  includeFixedLastPage: number;
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
       AND live_series.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
       AND live_series.rights_status IN
         ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
  )`;
  if (isUploadAdmin(actor)) {
    const owner = actor.roles.includes("OWNER");
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
        ? = 1
        OR EXISTS (
          SELECT 1
            FROM team_memberships live_membership
            JOIN teams live_team ON live_team.id = live_membership.team_id
           WHERE live_membership.user_id = ?
             AND live_membership.team_id = ${alias}.team_id
             AND live_membership.status = 'ACTIVE'
             AND UPPER(live_membership.membership_role) IN
               ('OWNER', 'LEADER', 'UPLOADER')
             AND live_team.is_archived = 0
             AND live_team.verification_status = 'VERIFIED'
        )
      )`,
      bindings: [actor.id, owner ? 1 : 0, actor.id] as unknown[],
    };
  }

  return {
    sql: `EXISTS (
      SELECT 1
        FROM users live_actor
        JOIN team_memberships live_membership
          ON live_membership.team_id = ${alias}.team_id
         AND live_membership.user_id = live_actor.id
        JOIN teams live_team ON live_team.id = live_membership.team_id
       WHERE live_actor.id = ?
         AND live_actor.status = 'ACTIVE'
         AND live_membership.status = 'ACTIVE'
         AND UPPER(live_membership.membership_role) IN
           ('OWNER', 'LEADER', 'UPLOADER')
         AND live_team.is_archived = 0
         AND live_team.verification_status = 'VERIFIED'
         ${
           input.requirePublish
             ? `AND UPPER(live_membership.membership_role) IN
                  ('OWNER', 'LEADER')`
             : ""
         }
    )
    AND ${seriesIsEligible}`,
    bindings: [actor.id] as unknown[],
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
                replacement_chapter_id AS replacementChapterId,
                thumbnail_key AS thumbnailKey,
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
                include_fixed_first_page AS includeFixedFirstPage,
                include_fixed_last_page AS includeFixedLastPage,
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
      includeFixedFirstPage: Boolean(item.includeFixedFirstPage),
      includeFixedLastPage: Boolean(item.includeFixedLastPage),
      thumbnailUrl: item.thumbnailKey
        ? `/api/v1/upload-job-thumbnail?jobId=${encodeURIComponent(jobId)}&itemId=${encodeURIComponent(item.id)}&v=${item.revision}`
        : null,
      files: filesByItem.get(item.id) ?? [],
    })),
  };
}

async function uploadOptions(db: D1Database, actor: Actor) {
  const admin = isUploadAdmin(actor);
  const owner = actor.roles.includes("OWNER");
  const [seriesResult, teamsResult] = await Promise.all([
    db
      .prepare(
        `SELECT s.id,
                s.slug,
                s.title,
                CASE WHEN s.cover_key IS NULL THEN NULL
                  ELSE '/api/v1/series-media?id=' || s.id ||
                       '&slot=cover&v=' || s.revision
                END AS coverUrl
           FROM series s
          WHERE s.is_published = 1
            AND s.archived_at IS NULL
            AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          ORDER BY s.title COLLATE NOCASE, s.id`,
      )
      .all(),
    db
      .prepare(
        `SELECT DISTINCT t.id, t.slug, t.name, t.revision,
                t.can_control_fixed_reader_pages AS canControlFixedReaderPages,
                CASE WHEN ? = 1 THEN 'OWNER'
                     ELSE UPPER(tm.membership_role)
                END AS membershipRole,
                CASE WHEN t.logo_key IS NULL THEN NULL
                  ELSE '/api/v1/team-media?id=' || t.id ||
                       '&slot=logo&v=' || t.revision
                END AS logoUrl,
                CASE WHEN t.banner_key IS NULL THEN NULL
                  ELSE '/api/v1/team-media?id=' || t.id ||
                       '&slot=banner&v=' || t.revision
                END AS bannerUrl
           FROM teams t
           LEFT JOIN team_memberships tm
             ON tm.team_id = t.id AND tm.user_id = ? AND tm.status = 'ACTIVE'
          WHERE (? = 1 OR (
              tm.user_id IS NOT NULL
              AND UPPER(tm.membership_role) IN ('OWNER', 'LEADER', 'UPLOADER')
            ))
            AND t.is_archived = 0
            AND t.verification_status = 'VERIFIED'
          ORDER BY t.name COLLATE NOCASE, t.id`,
      )
      .bind(owner ? 1 : 0, actor.id, owner ? 1 : 0)
      .all<{
        id: string;
        slug: string;
        name: string;
        revision: number;
        membershipRole: string;
        canControlFixedReaderPages: number;
        logoUrl: string | null;
        bannerUrl: string | null;
      }>(),
  ]);
  const canPublishByRole =
    admin ||
    canAny(
      [actor.primaryRole, ...(actor.roles ?? [])],
      "chapter.publish.assigned",
    );
  return {
    series: seriesResult.results,
    teams: teamsResult.results.map((team) => {
      const canPublish =
        admin ||
        (canPublishByRole &&
          ["OWNER", "LEADER"].includes(
            team.membershipRole,
          ));
      return {
        ...team,
        canControlFixedReaderPages: Boolean(team.canControlFixedReaderPages),
        canPublish,
        requiresReview: !canPublish,
      };
    }),
    uploaderReview: await (async () => {
      const [approval, history] = await Promise.all([
        db.prepare("SELECT status FROM uploader_approvals WHERE user_id = ? LIMIT 1").bind(actor.id).first<{ status: string }>(),
        db.prepare("SELECT COUNT(*) AS count FROM upload_jobs WHERE user_id = ? AND submitted_at IS NOT NULL").bind(actor.id).first<{ count: number }>(),
      ]);
      const exempt = actor.roles.some((role) => ["OWNER", "ADMINISTRATOR"].includes(role));
      return {
        status: approval?.status ?? "UNAPPROVED",
        hasSubmittedUpload: Number(history?.count ?? 0) > 0,
        requiresReview: !exempt && approval?.status !== "APPROVED",
      };
    })(),
    methods: UPLOAD_METHODS,
    limits: UPLOAD_LIMITS,
    admin,
  };
}

async function assertFixedReaderPageControl(
  db: D1Database,
  teamId: string | null,
  items: Array<{
    includeFixedFirstPage: boolean;
    includeFixedLastPage: boolean;
  }>,
) {
  if (
    items.every(
      (item) => item.includeFixedFirstPage && item.includeFixedLastPage,
    )
  ) {
    return;
  }
  if (!teamId) {
    throw new ApiError(
      403,
      "FIXED_READER_PAGE_CONTROL_FORBIDDEN",
      "Independent releases must include the configured first and last reader pages.",
    );
  }
  const team = await db
    .prepare(
      `SELECT can_control_fixed_reader_pages AS allowed
         FROM teams
        WHERE id = ? AND is_archived = 0
        LIMIT 1`,
    )
    .bind(teamId)
    .first<{ allowed: number }>();
  if (!team?.allowed) {
    throw new ApiError(
      403,
      "FIXED_READER_PAGE_CONTROL_FORBIDDEN",
      "This team is not allowed to remove the configured first or last reader page.",
    );
  }
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
    const hasPaidItems = payload.items.some(
      (item) => item.accessType === "PAID",
    );
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
    const paidEconomyRevision = hasPaidItems
      ? (await requirePaidEconomyPublicDocument()).revision
      : null;
    await assertUploadRateLimit(env.DB, actor, "JOB");
    const scope = await requireUploadScope(
      env.DB,
      actor,
      payload.seriesId,
      payload.teamId,
      payload.items.map((item) => item.language),
    );
    await assertFixedReaderPageControl(env.DB, scope.teamId, payload.items);
    for (const item of payload.items) {
      const duplicate = await env.DB.prepare(
        `SELECT c.id, c.state
           FROM chapters c
          WHERE c.series_id = ?
            AND LTRIM(c.chapter_number, '0') = LTRIM(?, '0')
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
        .first<{ id: string; state: string }>();
      if (
        duplicate &&
        item.replacementChapterId !== duplicate.id
      ) {
        throw new ApiError(
          409,
          "DUPLICATE_RELEASE",
          `Chapter ${item.chapterNumber} already has this team, language, and version.`,
          undefined,
          {
            clientKey: item.clientKey,
            existingChapterId: duplicate.id,
            chapterNumber: item.chapterNumber,
          },
        );
      }
      if (item.replacementChapterId && !duplicate) {
        throw new ApiError(
          409,
          "REPLACEMENT_TARGET_CHANGED",
          "The chapter selected for replacement no longer matches this release.",
        );
      }
    }
    const jobId = `upj_${randomId()}`;
    const itemRecords = payload.items.map((item) => ({
      ...item,
      id: `upi_${randomId()}`,
    }));
    const createAuthorization = liveJobAuthorization(actor, {
      alias: "draft",
    });
    const createStatements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO upload_jobs
         (id, user_id, team_id, series_id, kind, source_type, source_url, status,
          idempotency_key, total_bytes, page_count, revision, expires_at)
         SELECT draft.id, draft.user_id, draft.team_id, draft.series_id,
                draft.kind, draft.source_type, draft.source_url, 'DRAFT',
                draft.idempotency_key, 0, 0, 1,
                datetime('now', draft.expiry)
           FROM (
             SELECT ? AS id, ? AS user_id, ? AS team_id, ? AS series_id,
                    ? AS kind, ? AS source_type, ? AS source_url, ? AS idempotency_key,
                    ? AS expiry
           ) draft
          WHERE ${createAuthorization.sql}
            AND ${
            paidEconomyRevision === null
              ? "1 = 1"
              : paidEconomyPublicSql(paidEconomyRevision)
          }`,
      ).bind(
        jobId,
        actor.id,
        scope.teamId,
        payload.seriesId,
        payload.kind,
        payload.sourceType,
        payload.sourceUrl,
        payload.idempotencyKey,
        `+${UPLOAD_LIMITS.draftLifetimeDays} days`,
        ...createAuthorization.bindings,
      ),
      ...(paidEconomyRevision === null
        ? []
        : [
            env.DB.prepare(
              `INSERT INTO upload_publish_guards (job_id, verified)
               VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
            ).bind(jobId),
          ]),
      ...itemRecords.map((item) =>
        env.DB!.prepare(
          `INSERT INTO upload_job_items
           (id, job_id, client_key, source_label, series_id, team_id,
            replacement_chapter_id, volume, chapter_number, title, language,
            version, release_notes,
            credits_json, access_type, price_onyx, visibility, scheduled_at,
            include_fixed_first_page, include_fixed_last_page,
            comments_enabled, status, page_count, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   'DRAFT', 0, 1)`,
        ).bind(
          item.id,
          jobId,
          item.clientKey,
          item.sourceLabel,
          payload.seriesId,
          scope.teamId,
          item.replacementChapterId,
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
          item.includeFixedFirstPage ? 1 : 0,
          item.includeFixedLastPage ? 1 : 0,
          1,
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
      ...(paidEconomyRevision === null
        ? []
        : [
            env.DB.prepare(
              "DELETE FROM upload_publish_guards WHERE job_id = ?",
            ).bind(jobId),
          ]),
    ];
    try {
      await env.DB.batch(createStatements);
    } catch (error) {
      if (paidEconomyRevision !== null && isUploadGuardFailure(error)) {
        await assertPaidEconomyGuardFresh(paidEconomyRevision);
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This upload changed while the paid draft was being created.",
        );
      }
      if (
        error instanceof Error &&
        /FOREIGN KEY constraint failed/i.test(error.message)
      ) {
        throw new ApiError(
          409,
          "UPLOAD_SCOPE_CHANGED",
          "Your series or publishing-team access changed while this draft was being created.",
        );
      }
      throw error;
    }
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
              kind,
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
      kind: "SINGLE" | "BATCH";
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
      const singlePaidUpdate =
        job.kind === "SINGLE" && payload.item.accessType === "PAID";
      const singlePaidEconomyRevision = singlePaidUpdate
        ? (await requirePaidEconomyPublicDocument()).revision
        : null;
      await requireUploadScope(
        env.DB,
        actor,
        job.seriesId,
        job.teamId,
        [payload.item.language],
      );
      await assertFixedReaderPageControl(env.DB, job.teamId, [payload.item]);
      const duplicate = await env.DB.prepare(
        `SELECT id
           FROM chapters
          WHERE series_id = ?
            AND LTRIM(chapter_number, '0') = LTRIM(?, '0')
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
        .first<{ id: string }>();
      if (
        duplicate &&
        payload.item.replacementChapterId !== duplicate.id
      ) {
        throw new ApiError(
          409,
          "DUPLICATE_RELEASE",
          "This exact release already exists.",
          undefined,
          {
            clientKey: payload.item.clientKey,
            existingChapterId: duplicate.id,
            chapterNumber: payload.item.chapterNumber,
          },
        );
      }
      if (payload.item.replacementChapterId && !duplicate) {
        throw new ApiError(
          409,
          "REPLACEMENT_TARGET_CHANGED",
          "The chapter selected for replacement no longer matches this release.",
        );
      }
      const authorization = liveJobAuthorization(actor, {
        alias: "upload_jobs",
      });
      try {
        await env.DB.batch([
          env.DB.prepare(
          `UPDATE upload_jobs
              SET revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
              ${
                singlePaidEconomyRevision === null
                  ? ""
                  : `AND ${paidEconomyPublicSql(singlePaidEconomyRevision)}`
              }
              AND ${authorization.sql}`,
        ).bind(payload.jobId, job.revision, ...authorization.bindings),
        env.DB.prepare(
          `INSERT INTO upload_publish_guards (job_id, verified)
           VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
        ).bind(payload.jobId),
        env.DB.prepare(
          `UPDATE upload_job_items
              SET source_label = ?,
                  replacement_chapter_id = ?,
                  volume = ?,
                  chapter_number = ?,
                  title = ?,
                  language = ?,
                  version = ?,
                  release_notes = ?,
                  credits_json = ?,
                  access_type =
                    CASE WHEN ? = 'BATCH' THEN access_type ELSE ? END,
                  price_onyx =
                    CASE WHEN ? = 'BATCH' THEN price_onyx ELSE ? END,
                  visibility = ?,
                  scheduled_at = ?,
                  include_fixed_first_page = ?,
                  include_fixed_last_page = ?,
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
                   AND LTRIM(duplicate_item.chapter_number, '0') =
                       LTRIM(?, '0')
                   AND duplicate_item.language = ?
                   AND duplicate_item.version = ?
              )
              AND (
                ? IS NOT NULL
                OR NOT EXISTS (
                SELECT 1
                  FROM chapters duplicate_chapter
                 WHERE duplicate_chapter.series_id = upload_job_items.series_id
                   AND LTRIM(duplicate_chapter.chapter_number, '0') =
                       LTRIM(?, '0')
                   AND duplicate_chapter.language = ?
                   AND COALESCE(duplicate_chapter.team_id, '') =
                       COALESCE(upload_job_items.team_id, '')
                   AND duplicate_chapter.version = ?
                   AND duplicate_chapter.state IN
                     ('READY_FOR_REVIEW', 'PUBLISHED')
                )
              )`,
        ).bind(
          payload.item.sourceLabel,
          payload.item.replacementChapterId,
          payload.item.volume || null,
          payload.item.chapterNumber,
          payload.item.title,
          payload.item.language,
          payload.item.version,
          payload.item.releaseNotes,
          JSON.stringify(payload.item.credits),
          job.kind,
          payload.item.accessType,
          job.kind,
          payload.item.priceOnyx,
          payload.item.visibility,
          payload.item.scheduledAt,
          payload.item.includeFixedFirstPage ? 1 : 0,
          payload.item.includeFixedLastPage ? 1 : 0,
          1,
          payload.itemId,
          payload.jobId,
          payload.expectedRevision,
          payload.jobId,
          payload.item.chapterNumber,
          payload.item.language,
          payload.item.version,
          payload.item.replacementChapterId,
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
      } catch (error) {
        if (
          singlePaidEconomyRevision !== null &&
          isUploadGuardFailure(error)
        ) {
          await assertPaidEconomyGuardFresh(singlePaidEconomyRevision);
        }
        throw error;
      }
      return json(
        id,
        { data: await jobDetail(env.DB, actor, payload.jobId) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    if (payload.action === "UPDATE_BATCH_COMMERCE") {
      if (
        job.kind !== "BATCH" ||
        !["DRAFT", "UPLOADING", "READY", "FAILED"].includes(job.status)
      ) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_LOCKED",
          "Batch access settings can be changed only before submission.",
        );
      }
      if (job.revision !== payload.expectedRevision) {
        throw new ApiError(
          409,
          "UPLOAD_JOB_CHANGED",
          "This batch changed. Reload before updating paid chapters.",
        );
      }
      const paidItemIds = [...new Set(payload.paidItemIds)];
      if (paidItemIds.length !== payload.paidItemIds.length) {
        throw new ApiError(
          422,
          "BATCH_PAID_ITEMS_INVALID",
          "Paid chapter selections must be unique.",
        );
      }
      const storedItems = await env.DB.prepare(
        `SELECT id, language
           FROM upload_job_items
          WHERE job_id = ?
          ORDER BY created_at, id`,
      )
        .bind(payload.jobId)
        .all<{ id: string; language: string }>();
      const storedItemIds = new Set(storedItems.results.map((item) => item.id));
      if (
        storedItems.results.length === 0 ||
        paidItemIds.some((itemId) => !storedItemIds.has(itemId))
      ) {
        throw new ApiError(
          422,
          "BATCH_PAID_ITEMS_INVALID",
          "Every paid chapter must belong to this upload batch.",
        );
      }
      const paidEconomyRevision = paidItemIds.length
        ? (await requirePaidEconomyPublicDocument()).revision
        : null;
      await requireUploadScope(
        env.DB,
        actor,
        job.seriesId,
        job.teamId,
        storedItems.results.map((item) => item.language),
      );
      const paidCondition = paidItemIds.length
        ? `id IN (${paidItemIds.map(() => "?").join(", ")})`
        : "0";
      const authorization = liveJobAuthorization(actor, {
        alias: "upload_jobs",
      });
      try {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE upload_jobs
                SET revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND revision = ?
                AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
                ${
                  paidEconomyRevision === null
                    ? ""
                    : `AND ${paidEconomyPublicSql(paidEconomyRevision)}`
                }
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
            `UPDATE upload_job_items
                SET access_type =
                      CASE WHEN ${paidCondition} THEN 'PAID' ELSE 'FREE' END,
                    price_onyx =
                      CASE WHEN ${paidCondition} THEN ? ELSE 0 END,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE job_id = ?
                AND status IN ('DRAFT', 'READY', 'FAILED')
                AND EXISTS (
                  SELECT 1 FROM upload_publish_guards
                   WHERE job_id = ? AND verified = 1
                )`,
          ).bind(
            ...paidItemIds,
            ...paidItemIds,
            payload.priceOnyx,
            payload.jobId,
            payload.jobId,
          ),
          env.DB.prepare(
            `UPDATE upload_publish_guards
                SET verified =
                      CASE WHEN changes() = ? THEN 1 ELSE NULL END
              WHERE job_id = ?`,
          ).bind(storedItems.results.length, payload.jobId),
          auditStatement(
            env.DB,
            actor,
            id,
            {
              action: "upload.batch.commerce",
              category: "COMMERCE_STORE",
              sourceArea: "UPLOAD_CENTER",
              targetType: "UPLOAD_JOB",
              targetId: payload.jobId,
              reason: "Uploader updated batch paid chapter selection",
              newValue: {
                priceOnyx: payload.priceOnyx,
                paidItemIds,
              },
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
      } catch (error) {
        if (isUploadGuardFailure(error)) {
          if (paidEconomyRevision !== null) {
            await assertPaidEconomyGuardFresh(paidEconomyRevision);
          }
          throw new ApiError(
            409,
            "UPLOAD_JOB_CHANGED",
            "This batch changed while paid chapter settings were being saved.",
          );
        }
        throw error;
      }
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
      const thumbnails = await env.DB.prepare(
        `SELECT id, thumbnail_key AS objectKey
           FROM upload_job_items
          WHERE job_id = ?
            AND chapter_id IS NULL
            AND thumbnail_key IS NOT NULL`,
      )
        .bind(payload.jobId)
        .all<{ id: string; objectKey: string }>();
      const discardAuthorization = liveJobAuthorization(actor);
      const discarded = await env.DB.batch([
        env.DB.prepare(
          `UPDATE upload_jobs
              SET status = 'CANCELLED',
                  revision = revision + 1,
                  completed_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND revision = ?
              AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
              AND ${discardAuthorization.sql}`,
        ).bind(
          payload.jobId,
          payload.expectedRevision,
          ...discardAuthorization.bindings,
        ),
        env.DB.prepare(
          `INSERT INTO upload_publish_guards (job_id, verified)
           VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE NULL END)`,
        ).bind(payload.jobId),
        env.DB.prepare(
          `UPDATE upload_job_items
              SET status = 'CANCELLED',
                  thumbnail_key = NULL,
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
        for (const thumbnail of thumbnails.results) {
          await deleteMediaObject(
            env.DB,
            env.BUCKET,
            thumbnail.objectKey,
            {
              mediaKind: "CHAPTER_THUMBNAIL",
              targetType: "UPLOAD_JOB_ITEM",
              targetId: thumbnail.id,
              reason: "Discarded upload draft",
            },
          );
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
      Omit<UploadItemRow, "commentsEnabled" | "includeFixedFirstPage" | "includeFixedLastPage"> & {
        commentsEnabled: boolean;
        includeFixedFirstPage: boolean;
        includeFixedLastPage: boolean;
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
    const commercialDocument = await getCommercialSettingsDocument();
    const paidPolicyPublic =
      !commercialDocument.recoveredFromInvalid &&
      commercialDocument.revision > 0 &&
      commercialDocument.settings.economy.premiumEconomyPublic;
    const forcedAccess = new Map<
      string,
      { reference: PaidChapterReference; decisionId: string }
    >();
    if (paidPolicyPublic) {
      for (const item of items) {
        if (item.accessType !== "FREE") continue;
        const reference = await findPaidChapterReference(
          env.DB,
          job.seriesId,
          item.chapterNumber,
        );
        if (!reference) continue;
        item.accessType = "PAID";
        item.priceOnyx = Number(reference.priceOnyx);
        forcedAccess.set(item.id, {
          reference,
          decisionId: `cad_${randomId()}`,
        });
      }
    }
    const batchPaidPrices = new Set(
      items
        .filter((item) => item.accessType === "PAID")
        .map((item) => Number(item.priceOnyx)),
    );
    if (job.kind === "BATCH" && batchPaidPrices.size > 1) {
      throw new ApiError(
        422,
        "BATCH_PAID_PRICE_MISMATCH",
        "All paid chapters in this batch must use the same price.",
      );
    }
    const paidEconomyRevision = batchPaidPrices.size
      ? (await requirePaidEconomyPublicDocument()).revision
      : null;
    const scope = await requireUploadScope(
      env.DB,
      actor,
      job.seriesId,
      job.teamId,
      items.map((item) => item.language),
    );
    await assertFixedReaderPageControl(env.DB, scope.teamId, items);
    for (const item of items) {
      const duplicate = await env.DB.prepare(
        `SELECT id
           FROM chapters
          WHERE series_id = ?
            AND LTRIM(chapter_number, '0') = LTRIM(?, '0')
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
        .first<{ id: string }>();
      if (
        duplicate &&
        item.replacementChapterId !== duplicate.id
      ) {
        throw new ApiError(
          409,
          "DUPLICATE_RELEASE",
          `Chapter ${item.chapterNumber} already has this team, language, and version.`,
          undefined,
          {
            clientKey: item.clientKey,
            existingChapterId: duplicate.id,
            chapterNumber: item.chapterNumber,
          },
        );
      }
      if (item.replacementChapterId && !duplicate) {
        throw new ApiError(
          409,
          "REPLACEMENT_TARGET_CHANGED",
          "The chapter selected for replacement no longer matches this release.",
        );
      }
    }
    const uploaderApproval = isUploadAdmin(actor)
      ? { status: "APPROVED" }
      : await env.DB.prepare(
          "SELECT status FROM uploader_approvals WHERE user_id = ? LIMIT 1",
        ).bind(actor.id).first<{ status: string }>();
    const needsReview =
      uploaderApproval?.status !== "APPROVED" ||
      scope.uploadRequiresReview ||
      !scope.canPublish ||
      items.some((item) => Boolean(item.replacementChapterId));
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
            AND ${
              paidEconomyRevision === null
                ? "1 = 1"
                : paidEconomyPublicSql(paidEconomyRevision)
            }
            AND ${authorization.sql}`,
      ).bind(
        payload.idempotencyKey,
        payload.jobId,
        payload.expectedRevision,
        ...authorization.bindings,
      ),
    ];
    for (const [itemId, forced] of forcedAccess) {
      statements.push(
        env.DB.prepare(
          `UPDATE upload_job_items
              SET access_type = 'PAID',
                  price_onyx = ?,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
              AND job_id = ?
              AND status = 'READY'
              AND access_type = 'FREE'
              AND EXISTS (
                SELECT 1
                  FROM chapters policy_reference
                 WHERE policy_reference.id = ?
                   AND policy_reference.series_id = upload_job_items.series_id
                   AND policy_reference.state IN ('READY_FOR_REVIEW', 'PUBLISHED')
                   AND policy_reference.access_type = 'PAID'
                   AND policy_reference.price_onyx = ?
              )`,
        ).bind(
          forced.reference.priceOnyx,
          itemId,
          payload.jobId,
          forced.reference.id,
          forced.reference.priceOnyx,
        ),
      );
    }
    for (const item of items) {
      const newChapterId = `ch_${randomId()}`;
      const forced = forcedAccess.get(item.id);
      const isReplacement = Boolean(item.replacementChapterId);
      const chapterState = isReplacement
        ? "DRAFT"
        : needsReview
          ? "READY_FOR_REVIEW"
          : "PUBLISHED";
      const publishedAt = needsReview
        ? null
        : item.scheduledAt ?? new Date().toISOString();
      statements.push(
        env.DB.prepare(
          `INSERT INTO chapters
           (id, series_id, team_id, uploader_user_id, slug, volume,
            chapter_number, title, language, format, state, access_type,
            price_onyx, page_count, published_at, free_at, version,
            release_notes, credits_json, thumbnail_key, visibility,
            comments_enabled, revision, include_fixed_first_page,
            include_fixed_last_page)
           SELECT ?, uji.series_id, uji.team_id, ?, ?, uji.volume,
                  uji.chapter_number, uji.title, uji.language, 'VERTICAL',
                  ?, uji.access_type, uji.price_onyx, uji.page_count, ?,
                  NULL, uji.version, uji.release_notes, uji.credits_json,
                  uji.thumbnail_key, uji.visibility, 1, 1,
                  uji.include_fixed_first_page, uji.include_fixed_last_page
             FROM upload_job_items uji
             JOIN upload_jobs uj ON uj.id = uji.job_id
            WHERE uji.id = ?
              AND uji.job_id = ?
              AND uji.status = 'READY'
              AND uji.page_count > 0
              AND uj.status = 'PUBLISHING'
              AND uj.revision = ?
              AND ${
                forced
                  ? "uji.access_type = 'PAID' AND uji.price_onyx = ?"
                  : "1 = 1"
              }
              AND (
                (
                  uji.replacement_chapter_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                      FROM chapters replacement
                     WHERE replacement.id = uji.replacement_chapter_id
                       AND replacement.series_id = uji.series_id
                       AND LTRIM(replacement.chapter_number, '0') =
                           LTRIM(uji.chapter_number, '0')
                       AND replacement.language = uji.language
                       AND COALESCE(replacement.team_id, '') =
                           COALESCE(uji.team_id, '')
                       AND replacement.version = uji.version
                       AND replacement.state IN ('READY_FOR_REVIEW', 'PUBLISHED')
                  )
                )
                OR (
                  uji.replacement_chapter_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                      FROM chapters duplicate
                     WHERE duplicate.series_id = uji.series_id
                       AND LTRIM(duplicate.chapter_number, '0') =
                           LTRIM(uji.chapter_number, '0')
                       AND duplicate.language = uji.language
                       AND COALESCE(duplicate.team_id, '') =
                           COALESCE(uji.team_id, '')
                       AND duplicate.version = uji.version
                       AND duplicate.state IN ('READY_FOR_REVIEW', 'PUBLISHED')
                  )
                )
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
          ...(forced ? [forced.reference.priceOnyx] : []),
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
      if (forced) {
        const referenceNumber = normalizePolicyChapterNumber(
          forced.reference.chapterNumber,
        );
        statements.push(
          env.DB.prepare(
            `INSERT INTO chapter_access_decisions
             (id, upload_job_id, upload_job_item_id, chapter_id, series_id,
              reference_chapter_id, reference_chapter_number, reason,
              requested_access_type, forced_price_onyx, status)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'FREE', ?, 'PENDING'
              WHERE EXISTS (
                SELECT 1 FROM chapters forced_chapter
                 WHERE forced_chapter.id = ?
                   AND forced_chapter.access_type = 'PAID'
                   AND forced_chapter.price_onyx = ?
              )
                AND EXISTS (
                  SELECT 1 FROM chapters policy_reference
                   WHERE policy_reference.id = ?
                     AND policy_reference.state IN ('READY_FOR_REVIEW', 'PUBLISHED')
                     AND policy_reference.access_type = 'PAID'
                     AND policy_reference.price_onyx = ?
                )`,
          ).bind(
            forced.decisionId,
            payload.jobId,
            item.id,
            newChapterId,
            job.seriesId,
            forced.reference.id,
            referenceNumber,
            forced.reference.reason,
            forced.reference.priceOnyx,
            newChapterId,
            forced.reference.priceOnyx,
            forced.reference.id,
            forced.reference.priceOnyx,
          ),
          env.DB.prepare(
            `INSERT INTO notifications
             (id, user_id, kind, title, body, dedupe_key, action_url,
              metadata_json)
             SELECT 'ntf_' || lower(hex(randomblob(16))), u.id,
                    'CHAPTER_ACCESS_DECISION',
                    'Chapter access decision required', ?, ?, ?, ?
               FROM users u
              WHERE u.status = 'ACTIVE'
                AND (
                  u.primary_role IN ('OWNER', 'ADMINISTRATOR', 'MANAGER')
                  OR EXISTS (
                    SELECT 1 FROM user_roles ur
                     WHERE ur.user_id = u.id
                       AND ur.role IN ('OWNER', 'ADMINISTRATOR', 'MANAGER')
                  )
                )
                AND EXISTS (
                  SELECT 1 FROM chapter_access_decisions pending_decision
                   WHERE pending_decision.id = ?
                     AND pending_decision.status = 'PENDING'
                )
                AND NOT EXISTS (
                  SELECT 1 FROM notifications existing
                   WHERE existing.user_id = u.id
                     AND existing.dedupe_key = ?
                )`,
          ).bind(
            `${String(detailSummary.seriesTitle ?? "Series")} chapter ${item.chapterNumber} was requested Free and was forced Paid at ${forced.reference.priceOnyx} paws because ${forced.reference.reason === "SAME_CHAPTER_VERSION" ? `another version of chapter ${referenceNumber}` : `chapter ${referenceNumber}`} is Paid. Decide whether the reference chapter stays Paid or becomes Free.`,
            `CHAPTER_ACCESS_DECISION:${forced.decisionId}`,
            `/onyx/admin/access/access-decisions?decision=${encodeURIComponent(forced.decisionId)}`,
            JSON.stringify({
              decisionId: forced.decisionId,
              chapterNumber: item.chapterNumber,
              referenceChapterNumber: referenceNumber,
              reason: forced.reference.reason,
              forcedPriceOnyx: forced.reference.priceOnyx,
            }),
            forced.decisionId,
            `CHAPTER_ACCESS_DECISION:${forced.decisionId}`,
          ),
        );
      }
      if (isReplacement) {
        statements.push(
          env.DB.prepare(
            `UPDATE chapters
                SET state = 'READY_FOR_REVIEW',
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND state = 'DRAFT'
                AND EXISTS (
                  SELECT 1
                    FROM upload_job_items linked_item
                    JOIN upload_jobs linked_job
                      ON linked_job.id = linked_item.job_id
                   WHERE linked_item.id = ?
                     AND linked_item.job_id = ?
                     AND linked_item.chapter_id = chapters.id
                     AND linked_item.replacement_chapter_id IS NOT NULL
                     AND linked_item.status = 'PENDING_REVIEW'
                     AND linked_job.status = 'PUBLISHING'
                     AND linked_job.revision = ?
                )`,
          ).bind(
            newChapterId,
            item.id,
            payload.jobId,
            nextRevision,
          ),
        );
      }
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO upload_publish_guards (job_id, verified)
         SELECT ?, CASE
	           WHEN (
	             SELECT COUNT(*)
	               FROM upload_job_items committed_item
	               JOIN chapters committed_chapter
	                 ON committed_chapter.id = committed_item.chapter_id
	              WHERE committed_item.job_id = ?
	                AND committed_item.status = ?
	                AND committed_chapter.state = ?
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
        needsReview ? "READY_FOR_REVIEW" : "PUBLISHED",
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
          forcedAccessDecisions: forcedAccess.size,
        },
      }),
      env.DB.prepare(
        "DELETE FROM upload_publish_guards WHERE job_id = ?",
      ).bind(payload.jobId),
    );
    try {
      await env.DB.batch(statements);
    } catch (error) {
      if (isUploadGuardFailure(error)) {
        if (paidEconomyRevision !== null) {
          await assertPaidEconomyGuardFresh(paidEconomyRevision);
        }
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
        accessAdjustments: [...forcedAccess.entries()].map(
          ([itemId, forced]) => ({
            itemId,
            decisionId: forced.decisionId,
            requestedAccessType: "FREE",
            effectiveAccessType: "PAID",
            priceOnyx: forced.reference.priceOnyx,
            reason: forced.reference.reason,
            referenceChapterNumber: normalizePolicyChapterNumber(
              forced.reference.chapterNumber,
            ),
          }),
        ),
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
