import {
  normalizedLookupKey,
  preferredGenreLabel,
} from "@/lib/admin-metadata";
import {
  requestSnapshot,
  type ApprovedTeamRight,
  type SeriesRequestMetadata,
} from "@/lib/series-requests";
import { ApiError } from "@/lib/server/api";
import {
  auditStatement,
  safeJson,
} from "@/lib/server/admin-utils";
import {
  findRequestDuplicates,
  mapRequestRow,
  requestNotificationStatements,
  requestSelect,
  type Database,
  type Statement,
} from "@/lib/server/series-request-common";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

type AdminRequestRow = {
  id: string;
  revision: number;
  status: string;
  submittingTeamId: string;
  submitterUserId: string;
  primaryTitle: string;
  alternativeTitlesJson: string;
  description: string;
  seriesType: SeriesRequestMetadata["seriesType"];
  publicationStatus: SeriesRequestMetadata["publicationStatus"];
  publicationYear: number | null;
  authorsJson: string;
  artistsJson: string;
  publisherName: string;
  originCountry: SeriesRequestMetadata["countryCode"];
  originalLanguage: SeriesRequestMetadata["languageCode"];
  readingDirection: SeriesRequestMetadata["readingDirection"];
  genresJson: string;
  coverKey: string | null;
  bannerKey: string | null;
  mangaDexId: string | null;
  mangaDexUrl: string | null;
  mangaUpdatesId: string | null;
  mangaUpdatesUrl: string | null;
  canonicalSourceUrl: string | null;
  submitterNotes: string;
  duplicateConfirmation: number;
  duplicateExplanation: string;
  assignedReviewerUserId: string | null;
};

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function metadataFromRow(row: AdminRequestRow): SeriesRequestMetadata {
  return {
    primaryTitle: row.primaryTitle,
    alternativeTitles: parseArray<string>(row.alternativeTitlesJson),
    description: row.description,
    seriesType: row.seriesType,
    publicationStatus: row.publicationStatus,
    publicationYear: row.publicationYear,
    authors: parseArray<{ id?: string; name: string }>(row.authorsJson),
    artists: parseArray<{ id?: string; name: string }>(row.artistsJson),
    publisherName: row.publisherName,
    countryCode: row.originCountry,
    languageCode: row.originalLanguage,
    readingDirection: row.readingDirection,
    genres: parseArray<{ id?: string; name: string }>(row.genresJson),
    requestingTeamIds: [],
    externalSources: [
      row.mangaDexId
        ? {
            source: "MANGADEX" as const,
            externalId: row.mangaDexId,
            sourceUrl: row.mangaDexUrl ?? "",
            responseHash: null,
          }
        : null,
      row.mangaUpdatesId
        ? {
            source: "MANGAUPDATES" as const,
            externalId: row.mangaUpdatesId,
            sourceUrl: row.mangaUpdatesUrl ?? "",
            responseHash: null,
          }
        : null,
    ].filter(Boolean) as SeriesRequestMetadata["externalSources"],
    submitterNotes: row.submitterNotes,
    duplicateConfirmation: Boolean(row.duplicateConfirmation),
    duplicateExplanation: row.duplicateExplanation,
  };
}

async function loadAdminRequest(db: Database, requestId: string) {
  const row = await db
    .prepare(
      `SELECT id,
              revision,
              status,
              submitting_team_id AS submittingTeamId,
              submitter_user_id AS submitterUserId,
              primary_title AS primaryTitle,
              alternative_titles_json AS alternativeTitlesJson,
              description,
              series_type AS seriesType,
              publication_status AS publicationStatus,
              publication_year AS publicationYear,
              authors_json AS authorsJson,
              artists_json AS artistsJson,
              publisher_name AS publisherName,
              origin_country AS originCountry,
              original_language AS originalLanguage,
              reading_direction AS readingDirection,
              genres_json AS genresJson,
              cover_key AS coverKey,
              banner_key AS bannerKey,
              mangadex_id AS mangaDexId,
              mangadex_url AS mangaDexUrl,
              mangaupdates_id AS mangaUpdatesId,
              mangaupdates_url AS mangaUpdatesUrl,
              canonical_source_url AS canonicalSourceUrl,
              submitter_notes AS submitterNotes,
              duplicate_confirmation AS duplicateConfirmation,
              duplicate_explanation AS duplicateExplanation,
              assigned_reviewer_user_id AS assignedReviewerUserId
         FROM series_requests
        WHERE id = ?
        LIMIT 1`,
    )
    .bind(requestId)
    .first<AdminRequestRow>();
  if (!row) {
    throw new ApiError(
      404,
      "SERIES_REQUEST_NOT_FOUND",
      "That series request does not exist.",
    );
  }
  return row;
}

function literalGate(
  requestId: string,
  revision: number,
  operationTime: string,
  status?: string,
) {
  return `EXISTS (
    SELECT 1 FROM series_requests request_gate
     WHERE request_gate.id = '${requestId.replaceAll("'", "''")}'
       AND request_gate.revision = ${revision}
       AND request_gate.updated_at = '${operationTime.replaceAll("'", "''")}'
       ${status ? `AND request_gate.status = '${status.replaceAll("'", "''")}'` : ""}
  )`;
}

function assertRevisionAndStatus(
  row: AdminRequestRow,
  expectedRevision: number,
  statuses: string[],
) {
  if (Number(row.revision) !== expectedRevision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer changed this request. Reload it before continuing.",
    );
  }
  if (!statuses.includes(row.status)) {
    throw new ApiError(
      409,
      "SERIES_REQUEST_STATE_CHANGED",
      "This request cannot use that review action in its current status.",
    );
  }
}

export async function listAdminSeriesRequests(
  db: Database,
  input: {
    query: string;
    status: string;
    teamId?: string;
    reviewerId?: string;
    type: string;
    duplicateRisk: string;
    source: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  },
) {
  const conditions: string[] = ["1 = 1"];
  const bindings: unknown[] = [];
  if (input.query) {
    conditions.push(
      `(r.primary_title LIKE '%' || ? || '%'
        OR submitter.display_name LIKE '%' || ? || '%'
        OR t.name LIKE '%' || ? || '%'
        OR r.mangadex_id LIKE '%' || ? || '%'
        OR r.mangaupdates_id LIKE '%' || ? || '%'
        OR r.mangadex_url LIKE '%' || ? || '%'
        OR r.mangaupdates_url LIKE '%' || ? || '%')`,
    );
    bindings.push(
      input.query,
      input.query,
      input.query,
      input.query,
      input.query,
      input.query,
      input.query,
    );
  }
  if (input.status !== "ALL") {
    conditions.push("r.status = ?");
    bindings.push(input.status);
  }
  if (input.teamId) {
    conditions.push("r.submitting_team_id = ?");
    bindings.push(input.teamId);
  }
  if (input.reviewerId === "UNASSIGNED") {
    conditions.push("r.assigned_reviewer_user_id IS NULL");
  } else if (input.reviewerId) {
    conditions.push("r.assigned_reviewer_user_id = ?");
    bindings.push(input.reviewerId);
  }
  if (input.type !== "ALL") {
    conditions.push("r.series_type = ?");
    bindings.push(input.type);
  }
  if (input.duplicateRisk === "NONE") {
    conditions.push("r.duplicate_risk_score = 0");
  } else if (input.duplicateRisk === "POSSIBLE") {
    conditions.push("r.duplicate_risk_score > 0");
  }
  if (input.source === "ANY") {
    conditions.push(
      "(r.mangadex_id IS NOT NULL OR r.mangaupdates_id IS NOT NULL)",
    );
  } else if (input.source === "NONE") {
    conditions.push(
      "r.mangadex_id IS NULL AND r.mangaupdates_id IS NULL",
    );
  } else if (input.source === "MANGADEX") {
    conditions.push("r.mangadex_id IS NOT NULL");
  } else if (input.source === "MANGAUPDATES") {
    conditions.push("r.mangaupdates_id IS NOT NULL");
  }
  if (input.from) {
    conditions.push("r.submitted_at >= ?");
    bindings.push(input.from);
  }
  if (input.to) {
    conditions.push("r.submitted_at <= ?");
    bindings.push(input.to);
  }
  const where = conditions.join(" AND ");
  const offset = (input.page - 1) * input.limit;
  const [rows, count] = await db.batch([
    db
      .prepare(
        `${requestSelect}
         WHERE ${where}
         ORDER BY
           CASE r.status
             WHEN 'SUBMITTED' THEN 0
             WHEN 'UNDER_REVIEW' THEN 1
             WHEN 'CHANGES_REQUESTED' THEN 2
             ELSE 3
           END,
           COALESCE(r.submitted_at, r.updated_at) ASC,
           r.id ASC
         LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, input.limit, offset),
    db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM series_requests r
           JOIN teams t ON t.id = r.submitting_team_id
           JOIN users submitter ON submitter.id = r.submitter_user_id
          WHERE ${where}`,
      )
      .bind(...bindings),
  ]);
  const total = Number(
    (count.results[0] as { count?: number } | undefined)?.count ?? 0,
  );
  return {
    data: (rows.results as Array<Record<string, unknown>>).map(mapRequestRow),
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.max(1, Math.ceil(total / input.limit)),
    },
  };
}

export async function getAdminSeriesRequest(
  db: Database,
  requestId: string,
) {
  const row = await db
    .prepare(`${requestSelect} WHERE r.id = ? LIMIT 1`)
    .bind(requestId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new ApiError(
      404,
      "SERIES_REQUEST_NOT_FOUND",
      "That series request does not exist.",
    );
  }
  const [feedback, revisions] = await db.batch([
    db
      .prepare(
        `SELECT f.id,
                f.request_revision AS requestRevision,
                f.visibility,
                f.kind,
                f.field_path AS fieldPath,
                f.body,
                f.author_user_id AS authorUserId,
                author.display_name AS authorDisplayName,
                f.created_at AS createdAt
           FROM series_request_feedback f
           LEFT JOIN users author ON author.id = f.author_user_id
          WHERE f.request_id = ?
          ORDER BY f.created_at, f.id`,
      )
      .bind(requestId),
    db
      .prepare(
        `SELECT rr.revision_number AS revisionNumber,
                rr.kind,
                rr.snapshot_json AS snapshotJson,
                rr.changed_fields_json AS changedFieldsJson,
                rr.author_user_id AS authorUserId,
                author.display_name AS authorDisplayName,
                rr.created_at AS createdAt
           FROM series_request_revisions rr
           LEFT JOIN users author ON author.id = rr.author_user_id
          WHERE rr.request_id = ?
          ORDER BY rr.revision_number DESC`,
      )
      .bind(requestId),
  ]);
  return {
    ...mapRequestRow(row),
    feedback: feedback.results,
    revisions: (
      revisions.results as Array<{
        revisionNumber: number;
        kind: string;
        snapshotJson: string;
        changedFieldsJson: string;
        authorUserId: string | null;
        authorDisplayName: string | null;
        createdAt: string;
      }>
    ).map((revision) => ({
      revisionNumber: Number(revision.revisionNumber),
      kind: revision.kind,
      snapshot: JSON.parse(String(revision.snapshotJson)),
      changedFields: JSON.parse(String(revision.changedFieldsJson)),
      authorUserId: revision.authorUserId,
      authorDisplayName: revision.authorDisplayName,
      createdAt: revision.createdAt,
    })),
  };
}

export async function startSeriesRequestReview(
  db: Database,
  actor: Actor,
  requestId: string,
  input: { requestId: string; expectedRevision: number },
) {
  const current = await loadAdminRequest(db, input.requestId);
  assertRevisionAndStatus(current, input.expectedRevision, ["SUBMITTED"]);
  if (
    current.assignedReviewerUserId &&
    current.assignedReviewerUserId !== actor.id
  ) {
    throw new ApiError(
      409,
      "REVIEWER_ALREADY_ASSIGNED",
      "This request is assigned to another reviewer. Reassign it explicitly first.",
    );
  }
  const nextRevision = current.revision + 1;
  const operationTime = new Date().toISOString();
  const gate = literalGate(
    input.requestId,
    nextRevision,
    operationTime,
    "UNDER_REVIEW",
  );
  const results = await db.batch([
    db
      .prepare(
        `UPDATE series_requests
            SET status = 'UNDER_REVIEW',
                assigned_reviewer_user_id = ?,
                review_started_at = COALESCE(review_started_at, ?),
                revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status = 'SUBMITTED'
            AND (
              assigned_reviewer_user_id IS NULL
              OR assigned_reviewer_user_id = ?
            )`,
      )
      .bind(
        actor.id,
        operationTime,
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
        actor.id,
      ),
    ...requestNotificationStatements(db, {
      requestId: input.requestId,
      revision: nextRevision,
      kind: "SERIES_REQUEST_REVIEW_STARTED",
      title: "Review started",
      body: `${current.primaryTitle} is now under administrator review.`,
      includeTeam: true,
      conditionSql: gate,
    }),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.review.start",
        category: "SERIES_CHAPTERS",
        sourceArea: "NEW_SERIES_QUEUE",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        oldValue: { revision: current.revision, status: current.status },
        newValue: {
          revision: nextRevision,
          status: "UNDER_REVIEW",
          reviewerUserId: actor.id,
        },
      },
      gate,
    ),
  ]);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer changed this request.",
    );
  }
  return getAdminSeriesRequest(db, input.requestId);
}

export async function assignSeriesRequestReviewer(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    reviewerUserId: string | null;
    reason: string;
  },
) {
  const current = await loadAdminRequest(db, input.requestId);
  assertRevisionAndStatus(current, input.expectedRevision, [
    "SUBMITTED",
    "UNDER_REVIEW",
    "CHANGES_REQUESTED",
  ]);
  if (input.reviewerUserId) {
    const reviewer = await db
      .prepare(
        `SELECT id FROM users
          WHERE id = ?
            AND status = 'ACTIVE'
            AND EXISTS (
              SELECT 1 FROM user_roles ur
               WHERE ur.user_id = users.id
                 AND ur.role IN ('OWNER', 'ADMINISTRATOR', 'MANAGER')
            )
          LIMIT 1`,
      )
      .bind(input.reviewerUserId)
      .first();
    if (!reviewer) {
      throw new ApiError(
        422,
        "REVIEWER_NOT_ELIGIBLE",
        "Choose an active administrator as reviewer.",
      );
    }
  }
  const nextRevision = current.revision + 1;
  const operationTime = new Date().toISOString();
  const gate = literalGate(input.requestId, nextRevision, operationTime);
  const statements: Statement[] = [
    db
      .prepare(
        `UPDATE series_requests
            SET assigned_reviewer_user_id = ?,
                revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status IN (
              'SUBMITTED',
              'UNDER_REVIEW',
              'CHANGES_REQUESTED'
            )`,
      )
      .bind(
        input.reviewerUserId,
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
      ),
    db
      .prepare(
        `INSERT INTO series_request_feedback
         (id, request_id, request_revision, author_user_id, visibility,
          kind, body)
         SELECT ?, ?, ?, ?, 'INTERNAL', 'ASSIGNMENT', ?
          WHERE ${gate}`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        input.reason,
      ),
  ];
  if (input.reviewerUserId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications
           (id, user_id, kind, title, body, dedupe_key, action_url,
            metadata_json)
           SELECT ?, ?, 'SERIES_REQUEST_ASSIGNED',
                  'Series request assigned',
                  ?, ?, ?, ?
            WHERE ${gate}
              AND NOT EXISTS (
                SELECT 1 FROM notifications
                 WHERE user_id = ?
                   AND dedupe_key = ?
              )`,
        )
        .bind(
          randomId(),
          input.reviewerUserId,
          `${current.primaryTitle} was assigned to you.`,
          `SERIES_REQUEST_ASSIGNED:${input.requestId}:${nextRevision}`,
          `/onyx/admin/access/series-submissions?id=${encodeURIComponent(input.requestId)}`,
          JSON.stringify({ requestId: input.requestId }),
          input.reviewerUserId,
          `SERIES_REQUEST_ASSIGNED:${input.requestId}:${nextRevision}`,
        ),
    );
  }
  statements.push(
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.reviewer.assign",
        category: "SERIES_CHAPTERS",
        sourceArea: "NEW_SERIES_QUEUE",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        reason: input.reason,
        oldValue: {
          revision: current.revision,
          reviewerUserId: current.assignedReviewerUserId,
        },
        newValue: {
          revision: nextRevision,
          reviewerUserId: input.reviewerUserId,
        },
      },
      gate,
    ),
  );
  const results = await db.batch(statements);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer changed this request.",
    );
  }
  return getAdminSeriesRequest(db, input.requestId);
}

export async function addSeriesRequestFeedback(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    visibility: "SUBMITTER" | "INTERNAL";
    body: string;
    fieldPath: string | null;
  },
) {
  const current = await loadAdminRequest(db, input.requestId);
  assertRevisionAndStatus(current, input.expectedRevision, [
    "SUBMITTED",
    "UNDER_REVIEW",
    "CHANGES_REQUESTED",
  ]);
  const nextRevision = current.revision + 1;
  const operationTime = new Date().toISOString();
  const gate = literalGate(input.requestId, nextRevision, operationTime);
  const statements: Statement[] = [
    db
      .prepare(
        `UPDATE series_requests
            SET revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status IN (
              'SUBMITTED',
              'UNDER_REVIEW',
              'CHANGES_REQUESTED'
            )`,
      )
      .bind(
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
      ),
    db
      .prepare(
        `INSERT INTO series_request_feedback
         (id, request_id, request_revision, author_user_id, visibility,
          kind, field_path, body)
         SELECT ?, ?, ?, ?, ?, 'COMMENT', ?, ?
          WHERE ${gate}`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        input.visibility,
        input.fieldPath,
        input.body,
      ),
  ];
  if (input.visibility === "SUBMITTER") {
    statements.push(
      ...requestNotificationStatements(db, {
        requestId: input.requestId,
        revision: nextRevision,
        kind: "SERIES_REQUEST_FEEDBACK",
        title: "Reviewer feedback",
        body: `New feedback was added to ${current.primaryTitle}.`,
        includeTeam: true,
        conditionSql: gate,
      }),
    );
  }
  statements.push(
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.feedback.add",
        category: "SERIES_CHAPTERS",
        sourceArea: "NEW_SERIES_QUEUE",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        metadata: {
          revision: nextRevision,
          visibility: input.visibility,
          fieldPath: input.fieldPath,
        },
      },
      gate,
    ),
  );
  const results = await db.batch(statements);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer changed this request.",
    );
  }
  return getAdminSeriesRequest(db, input.requestId);
}

export async function requestSeriesChanges(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    reason: string;
    fields: Array<{ fieldPath: string; comment: string }>;
  },
) {
  const current = await loadAdminRequest(db, input.requestId);
  assertRevisionAndStatus(current, input.expectedRevision, [
    "SUBMITTED",
    "UNDER_REVIEW",
  ]);
  const nextRevision = current.revision + 1;
  const operationTime = new Date().toISOString();
  const gate = literalGate(
    input.requestId,
    nextRevision,
    operationTime,
    "CHANGES_REQUESTED",
  );
  const statements: Statement[] = [
    db
      .prepare(
        `UPDATE series_requests
            SET status = 'CHANGES_REQUESTED',
                reviewed_at = ?,
                revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status IN ('SUBMITTED', 'UNDER_REVIEW')`,
      )
      .bind(
        operationTime,
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
      ),
  ];
  input.fields.forEach((field) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_request_feedback
           (id, request_id, request_revision, author_user_id, visibility,
            kind, field_path, body)
           SELECT ?, ?, ?, ?, 'SUBMITTER', 'CHANGE_REQUEST', ?, ?
            WHERE ${gate}`,
        )
        .bind(
          randomId(),
          input.requestId,
          nextRevision,
          actor.id,
          field.fieldPath,
          field.comment,
        ),
    );
  });
  statements.push(
    ...requestNotificationStatements(db, {
      requestId: input.requestId,
      revision: nextRevision,
      kind: "SERIES_REQUEST_CHANGES_REQUESTED",
      title: "Changes requested",
      body: `${current.primaryTitle} needs corrections before it can be approved.`,
      includeTeam: true,
      conditionSql: gate,
    }),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.changes.request",
        category: "SERIES_CHAPTERS",
        sourceArea: "NEW_SERIES_QUEUE",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        reason: input.reason,
        oldValue: { revision: current.revision, status: current.status },
        newValue: {
          revision: nextRevision,
          status: "CHANGES_REQUESTED",
          fields: input.fields.map((field) => field.fieldPath),
        },
      },
      gate,
    ),
  );
  const results = await db.batch(statements);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer changed this request.",
    );
  }
  return getAdminSeriesRequest(db, input.requestId);
}

export async function rejectSeriesRequest(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    reason: string;
  },
) {
  const current = await loadAdminRequest(db, input.requestId);
  assertRevisionAndStatus(current, input.expectedRevision, [
    "SUBMITTED",
    "UNDER_REVIEW",
    "CHANGES_REQUESTED",
  ]);
  const nextRevision = current.revision + 1;
  const operationTime = new Date().toISOString();
  const gate = literalGate(
    input.requestId,
    nextRevision,
    operationTime,
    "REJECTED",
  );
  const results = await db.batch([
    db
      .prepare(
        `UPDATE series_requests
            SET status = 'REJECTED',
                reviewed_at = ?,
                revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status IN (
              'SUBMITTED',
              'UNDER_REVIEW',
              'CHANGES_REQUESTED'
            )`,
      )
      .bind(
        operationTime,
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
      ),
    db
      .prepare(
        `INSERT INTO series_request_feedback
         (id, request_id, request_revision, author_user_id, visibility,
          kind, body)
         SELECT ?, ?, ?, ?, 'SUBMITTER', 'REJECTION', ?
          WHERE ${gate}`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        input.reason,
      ),
    ...requestNotificationStatements(db, {
      requestId: input.requestId,
      revision: nextRevision,
      kind: "SERIES_REQUEST_REJECTED",
      title: "Series request rejected",
      body: `${current.primaryTitle} was not approved. Open the request to read the reason.`,
      includeTeam: true,
      conditionSql: gate,
    }),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.reject",
        category: "SERIES_CHAPTERS",
        sourceArea: "NEW_SERIES_QUEUE",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        reason: input.reason,
        oldValue: { revision: current.revision, status: current.status },
        newValue: { revision: nextRevision, status: "REJECTED" },
      },
      gate,
    ),
  ]);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer changed this request.",
    );
  }
  return getAdminSeriesRequest(db, input.requestId);
}

function validateTeamRights(rights: ApprovedTeamRight[], submittingTeamId: string) {
  if (new Set(rights.map((right) => right.teamId)).size !== rights.length) {
    throw new ApiError(
      422,
      "DUPLICATE_TEAM_RIGHT",
      "Each approved team may appear only once.",
    );
  }
  if (!rights.some((right) => right.teamId === submittingTeamId)) {
    throw new ApiError(
      422,
      "SUBMITTING_TEAM_REQUIRED",
      "Approval must retain the submitting team relationship.",
    );
  }
  if (rights.filter((right) => right.isPrimary).length !== 1) {
    throw new ApiError(
      422,
      "PRIMARY_TEAM_REQUIRED",
      "Choose exactly one primary publishing team.",
    );
  }
}

async function assertActiveTeamRights(
  db: Database,
  rights: ApprovedTeamRight[],
) {
  for (const right of rights) {
    const team = await db
      .prepare(
        `SELECT id FROM teams
          WHERE id = ?
            AND is_archived = 0
            AND verification_status <> 'SUSPENDED'
          LIMIT 1`,
      )
      .bind(right.teamId)
      .first();
    if (!team) {
      throw new ApiError(
        409,
        "TEAM_NOT_AVAILABLE",
        "One of the approved teams is no longer eligible.",
      );
    }
  }
}

function slugForApproval(title: string, requestId: string) {
  const base = normalizedLookupKey(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 92);
  return `${base || "series"}-${requestId.replace(/[^a-z0-9]/gi, "").slice(-10).toLowerCase()}`;
}

function relationshipStatements(
  db: Database,
  seriesId: string,
  metadata: SeriesRequestMetadata,
  guard: string,
) {
  const statements: Statement[] = [];
  const publisherNormalized = metadata.publisherName
    ? normalizedLookupKey(metadata.publisherName)
    : null;
  if (publisherNormalized) {
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO publishers
           (id, name, normalized_name, description)
           SELECT ?, ?, ?, ''
            WHERE ${guard}`,
        )
        .bind(randomId(), metadata.publisherName, publisherNormalized),
      db
        .prepare(
          `UPDATE series
              SET publisher_id = (
                    SELECT id FROM publishers
                     WHERE normalized_name = ?
                       AND archived_at IS NULL
                     LIMIT 1
                  )
            WHERE id = ?
              AND ${guard}`,
        )
        .bind(publisherNormalized, seriesId),
    );
  }
  metadata.alternativeTitles.forEach((title) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_aliases
           (series_id, alias, normalized_alias, language)
           SELECT ?, ?, ?, ?
            WHERE ${guard}`,
        )
        .bind(
          seriesId,
          title,
          normalizedLookupKey(title),
          metadata.languageCode,
        ),
    );
  });
  for (const [role, creators] of [
    ["AUTHOR", metadata.authors] as const,
    ["ARTIST", metadata.artists] as const,
  ]) {
    creators.forEach((creator, sortOrder) => {
      const normalized = normalizedLookupKey(creator.name);
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO creators
             (id, name, normalized_name, biography)
             SELECT ?, ?, ?, ''
              WHERE ${guard}`,
          )
          .bind(randomId(), creator.name, normalized),
        db
          .prepare(
            `INSERT INTO series_creators
             (series_id, creator_id, role, sort_order)
             SELECT ?, c.id, ?, ?
              FROM creators c
              WHERE (c.normalized_name = ? OR c.name = ?)
                AND c.archived_at IS NULL
                AND ${guard}
              ORDER BY c.normalized_name = ? DESC, c.id
              LIMIT 1`,
          )
          .bind(
            seriesId,
            role,
            sortOrder,
            normalized,
            creator.name,
            normalized,
          ),
      );
    });
  }
  metadata.genres.forEach((genre) => {
    const normalized = normalizedLookupKey(genre.name);
    const slug = normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO genres
           (id, slug, name, normalized_key, updated_at)
           SELECT ?, ?, ?, ?, CURRENT_TIMESTAMP
            WHERE ${guard}`,
        )
        .bind(
          randomId(),
          slug || `genre-${randomId().slice(-8)}`,
          preferredGenreLabel(genre.name),
          normalized,
        ),
      db
        .prepare(
          `INSERT INTO series_genres (series_id, genre_id)
           SELECT ?, g.id
             FROM genres g
            WHERE (g.normalized_key = ? OR g.name = ?)
              AND g.archived_at IS NULL
              AND ${guard}
            ORDER BY g.normalized_key = ? DESC, g.id
            LIMIT 1`,
        )
        .bind(
          seriesId,
          normalized,
          preferredGenreLabel(genre.name),
          normalized,
        ),
    );
  });
  return statements;
}

export async function approveSeriesRequest(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    reason: string;
    teamRights: ApprovedTeamRight[];
  },
) {
  const current = await loadAdminRequest(db, input.requestId);
  assertRevisionAndStatus(current, input.expectedRevision, [
    "SUBMITTED",
    "UNDER_REVIEW",
  ]);
  validateTeamRights(input.teamRights, current.submittingTeamId);
  await assertActiveTeamRights(db, input.teamRights);
  const metadata = metadataFromRow(current);
  metadata.requestingTeamIds = input.teamRights.map((right) => right.teamId);
  const duplicates = await findRequestDuplicates(db, metadata, input.requestId);
  if (duplicates.exactExternalDuplicate) {
    throw new ApiError(
      409,
      "EXTERNAL_SOURCE_DUPLICATE",
      "This external identifier is already attached to another series. Attach the request to that series instead.",
    );
  }
  const seriesId = randomId();
  const slug = slugForApproval(current.primaryTitle, input.requestId);
  const nextRevision = current.revision + 1;
  const operationTime = new Date().toISOString();
  const teamPlaceholders = input.teamRights.map(() => "?").join(", ");
  const seriesGuard = `EXISTS (
    SELECT 1 FROM series approval_gate
     WHERE approval_gate.id = '${seriesId.replaceAll("'", "''")}'
       AND approval_gate.created_at = '${operationTime.replaceAll("'", "''")}'
  )`;
  const requestGuard = literalGate(
    input.requestId,
    nextRevision,
    operationTime,
    "APPROVED",
  );
  const statements: Statement[] = [
    db
      .prepare(
        `INSERT INTO series
         (id, slug, title, native_title, synopsis, type, status, publication_year,
          origin_country, original_language, reading_direction,
          age_rating, access_type, cover_key, banner_key, rights_status,
          is_published, revision, created_at, updated_at)
         SELECT ?, ?, r.primary_title,
                json_extract(r.alternative_titles_json, '$[0]'),
                r.description, r.series_type, r.publication_status, r.publication_year,
                r.origin_country, r.original_language, r.reading_direction,
                'TEEN', 'FREE', r.cover_key, r.banner_key, 'AUTHORIZED',
                1, 1, ?, ?
           FROM series_requests r
          WHERE r.id = ?
            AND r.revision = ?
            AND r.status IN ('SUBMITTED', 'UNDER_REVIEW')
            AND r.approved_series_id IS NULL
            AND (
              SELECT COUNT(*) FROM teams active_team
               WHERE active_team.id IN (${teamPlaceholders})
                 AND active_team.is_archived = 0
                 AND active_team.verification_status <> 'SUSPENDED'
            ) = ?
            AND NOT EXISTS (
              SELECT 1 FROM series_external_sources ses
               WHERE (r.mangadex_id IS NOT NULL
                       AND ses.source = 'MANGADEX'
                       AND ses.external_id = r.mangadex_id)
                  OR (r.mangaupdates_id IS NOT NULL
                       AND ses.source = 'MANGAUPDATES'
                       AND ses.external_id = r.mangaupdates_id)
            )`,
      )
      .bind(
        seriesId,
        slug,
        operationTime,
        operationTime,
        input.requestId,
        input.expectedRevision,
        ...input.teamRights.map((right) => right.teamId),
        input.teamRights.length,
      ),
  ];
  statements.push(
    ...relationshipStatements(db, seriesId, metadata, seriesGuard),
  );
  input.teamRights.forEach((right) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_team_assignments
           (series_id, team_id, can_upload, can_publish, is_primary,
            assigned_by_user_id, allowed_languages_json,
            upload_requires_review, restriction_reason, revision)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, '', 1
            WHERE ${seriesGuard}`,
        )
        .bind(
          seriesId,
          right.teamId,
          right.canUpload ? 1 : 0,
          right.canPublish ? 1 : 0,
          right.isPrimary ? 1 : 0,
          actor.id,
          JSON.stringify(right.allowedLanguages),
          right.uploadRequiresReview ? 1 : 0,
        ),
    );
  });
  if (current.mangaDexId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_external_sources
           (id, series_id, source, external_id, source_url,
            last_imported_by_user_id)
           SELECT ?, ?, 'MANGADEX', ?, ?, ?
            WHERE ${seriesGuard}`,
        )
        .bind(
          randomId(),
          seriesId,
          current.mangaDexId,
          current.mangaDexUrl,
          actor.id,
        ),
    );
  }
  if (current.mangaUpdatesId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_external_sources
           (id, series_id, source, external_id, source_url,
            last_imported_by_user_id)
           SELECT ?, ?, 'MANGAUPDATES', ?, ?, ?
            WHERE ${seriesGuard}`,
        )
        .bind(
          randomId(),
          seriesId,
          current.mangaUpdatesId,
          current.mangaUpdatesUrl,
          actor.id,
        ),
    );
  }
  const requestUpdateIndex = statements.length;
  statements.push(
    db
      .prepare(
        `UPDATE series_requests
            SET status = 'APPROVED',
                approved_series_id = ?,
                assigned_reviewer_user_id = COALESCE(
                  assigned_reviewer_user_id,
                  ?
                ),
                reviewed_at = ?,
                revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status IN ('SUBMITTED', 'UNDER_REVIEW')
            AND approved_series_id IS NULL
            AND ${seriesGuard}`,
      )
      .bind(
        seriesId,
        actor.id,
        operationTime,
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
      ),
    db
      .prepare(
        `INSERT INTO series_request_revisions
         (id, request_id, revision_number, author_user_id, kind,
          snapshot_json, changed_fields_json)
         SELECT ?, ?, ?, ?, 'APPROVAL', ?, '[]'
          WHERE ${requestGuard}`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        JSON.stringify({
          request: JSON.parse(
            requestSnapshot(metadata, input.requestId, nextRevision),
          ),
          approvedSeriesId: seriesId,
          teamRights: input.teamRights,
        }),
      ),
    db
      .prepare(
        `INSERT INTO series_request_feedback
         (id, request_id, request_revision, author_user_id, visibility,
          kind, body)
         SELECT ?, ?, ?, ?, 'SUBMITTER', 'APPROVAL', ?
          WHERE ${requestGuard}`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        input.reason,
      ),
    ...requestNotificationStatements(db, {
      requestId: input.requestId,
      revision: nextRevision,
      kind: "SERIES_REQUEST_APPROVED",
      title: "Series request approved",
      body: `${current.primaryTitle} is approved and ready for publishing.`,
      includeTeam: true,
      conditionSql: requestGuard,
    }),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.approve",
        category: "SERIES_CHAPTERS",
        sourceArea: "NEW_SERIES_QUEUE",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        reason: input.reason,
        oldValue: { revision: current.revision, status: current.status },
        newValue: {
          revision: nextRevision,
          status: "APPROVED",
          approvedSeriesId: seriesId,
          teamRights: input.teamRights,
        },
      },
      requestGuard,
    ),
  );
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /unique constraint|external_source/i.test(error.message)
    ) {
      throw new ApiError(
        409,
        "APPROVAL_CONFLICT",
        "The request conflicts with a series approved by another reviewer. Reload the queue.",
      );
    }
    if (
      error instanceof Error &&
      error.message.includes("series_request_approval_metadata_incomplete")
    ) {
      throw new ApiError(
        409,
        "APPROVAL_METADATA_CONFLICT",
        "A creator, genre, publisher, source, or team changed during approval. Reload the request and resolve the conflict.",
      );
    }
    throw error;
  }
  if (
    !Number(results[0]?.meta.changes ?? 0) ||
    !Number(results[requestUpdateIndex]?.meta.changes ?? 0)
  ) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer decided this request first. No series was created.",
    );
  }
  return getAdminSeriesRequest(db, input.requestId);
}

export async function attachSeriesRequestToExisting(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    seriesId: string;
    reason: string;
    teamRights: ApprovedTeamRight[];
  },
) {
  const current = await loadAdminRequest(db, input.requestId);
  assertRevisionAndStatus(current, input.expectedRevision, [
    "SUBMITTED",
    "UNDER_REVIEW",
  ]);
  validateTeamRights(input.teamRights, current.submittingTeamId);
  await assertActiveTeamRights(db, input.teamRights);
  const existing = await db
    .prepare(
      `SELECT id, title FROM series
        WHERE id = ?
          AND archived_at IS NULL
        LIMIT 1`,
    )
    .bind(input.seriesId)
    .first<{ id: string; title: string }>();
  if (!existing) {
    throw new ApiError(
      404,
      "SERIES_NOT_FOUND",
      "The canonical series is no longer available.",
    );
  }
  const nextRevision = current.revision + 1;
  const operationTime = new Date().toISOString();
  const gate = literalGate(
    input.requestId,
    nextRevision,
    operationTime,
    "APPROVED",
  );
  const statements: Statement[] = [
    db
      .prepare(
        `UPDATE series_requests
            SET status = 'APPROVED',
                approved_series_id = ?,
                assigned_reviewer_user_id = COALESCE(
                  assigned_reviewer_user_id,
                  ?
                ),
                reviewed_at = ?,
                revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status IN ('SUBMITTED', 'UNDER_REVIEW')
            AND approved_series_id IS NULL
            AND EXISTS (
              SELECT 1 FROM series
               WHERE id = ?
                 AND archived_at IS NULL
            )`,
      )
      .bind(
        input.seriesId,
        actor.id,
        operationTime,
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
        input.seriesId,
      ),
  ];
  input.teamRights.forEach((right) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_team_assignments
           (series_id, team_id, can_upload, can_publish, is_primary,
            assigned_by_user_id, allowed_languages_json,
            upload_requires_review, revoked_at, revoked_by_user_id,
            restriction_reason, revision)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', 1
            WHERE ${gate}
           ON CONFLICT(series_id, team_id) DO UPDATE SET
             can_upload = excluded.can_upload,
             can_publish = excluded.can_publish,
             is_primary = excluded.is_primary,
             assigned_by_user_id = excluded.assigned_by_user_id,
             allowed_languages_json = excluded.allowed_languages_json,
             upload_requires_review = excluded.upload_requires_review,
             revoked_at = NULL,
             revoked_by_user_id = NULL,
             restriction_reason = '',
             revision = series_team_assignments.revision + 1`,
        )
        .bind(
          input.seriesId,
          right.teamId,
          right.canUpload ? 1 : 0,
          right.canPublish ? 1 : 0,
          right.isPrimary ? 1 : 0,
          actor.id,
          JSON.stringify(right.allowedLanguages),
          right.uploadRequiresReview ? 1 : 0,
        ),
    );
  });
  statements.push(
    db
      .prepare(
        `INSERT INTO series_request_revisions
         (id, request_id, revision_number, author_user_id, kind,
          snapshot_json, changed_fields_json)
         SELECT ?, ?, ?, ?, 'ATTACHED_TO_EXISTING', ?, '[]'
          WHERE ${gate}`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        JSON.stringify({
          approvedSeriesId: input.seriesId,
          teamRights: input.teamRights,
          reason: input.reason,
        }),
      ),
    db
      .prepare(
        `INSERT INTO series_request_feedback
         (id, request_id, request_revision, author_user_id, visibility,
          kind, body)
         SELECT ?, ?, ?, ?, 'SUBMITTER', 'APPROVAL', ?
          WHERE ${gate}`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        input.reason,
      ),
    ...requestNotificationStatements(db, {
      requestId: input.requestId,
      revision: nextRevision,
      kind: "SERIES_REQUEST_ATTACHED",
      title: "Series request resolved",
      body: `${current.primaryTitle} was linked to the existing series ${existing.title}.`,
      includeTeam: true,
      conditionSql: gate,
    }),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.attach.existing",
        category: "SERIES_CHAPTERS",
        sourceArea: "NEW_SERIES_QUEUE",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        reason: input.reason,
        oldValue: { revision: current.revision, status: current.status },
        newValue: {
          revision: nextRevision,
          status: "APPROVED",
          approvedSeriesId: input.seriesId,
          teamRights: input.teamRights,
        },
      },
      gate,
    ),
  );
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (
      error instanceof Error &&
      /series_team_primary_uidx|unique constraint/i.test(error.message)
    ) {
      throw new ApiError(
        409,
        "PRIMARY_TEAM_CONFLICT",
        "That series already has a different primary team. Review the team rights before attaching.",
      );
    }
    throw error;
  }
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another reviewer decided this request first.",
    );
  }
  return getAdminSeriesRequest(db, input.requestId);
}

export function adminRequestSafeSummary(input: unknown) {
  return safeJson(input);
}
