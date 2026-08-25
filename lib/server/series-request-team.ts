import { env } from "cloudflare:workers";
import { normalizedLookupKey } from "@/lib/admin-metadata";
import {
  externalSourceColumns,
  requestSnapshot,
  type SeriesRequestMetadata,
} from "@/lib/series-requests";
import { ApiError } from "@/lib/server/api";
import {
  assertAllRequestedTeams,
  assertSeriesRequestTeamPermission,
  findRequestDuplicates,
  mapRequestRow,
  requestNotificationStatements,
  requestSelect,
  type Database,
  type DuplicateMatch,
  type Statement,
} from "@/lib/server/series-request-common";
import {
  auditStatement,
  deleteMediaObject,
  safeJson,
} from "@/lib/server/admin-utils";
import type { Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

type RequestMutationRow = {
  id: string;
  submittingTeamId: string;
  submitterUserId: string;
  status: string;
  revision: number;
  primaryTitle: string;
  normalizedTitle: string;
  alternativeTitlesJson: string;
  description: string;
  seriesType: string;
  publicationStatus: string;
  publicationYear: number | null;
  authorsJson: string;
  artistsJson: string;
  publisherName: string;
  originCountry: string;
  originalLanguage: string;
  readingDirection: string;
  genresJson: string;
  coverKey: string | null;
  bannerKey: string | null;
  submitterNotes: string;
  duplicateConfirmation: number;
  duplicateExplanation: string;
  mangaDexId: string | null;
  mangaDexUrl: string | null;
  mangaUpdatesId: string | null;
  mangaUpdatesUrl: string | null;
};

function mutationSelect() {
  return `
    SELECT id,
           submitting_team_id AS submittingTeamId,
           submitter_user_id AS submitterUserId,
           status,
           revision,
           primary_title AS primaryTitle,
           normalized_title AS normalizedTitle,
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
           submitter_notes AS submitterNotes,
           duplicate_confirmation AS duplicateConfirmation,
           duplicate_explanation AS duplicateExplanation,
           mangadex_id AS mangaDexId,
           mangadex_url AS mangaDexUrl,
           mangaupdates_id AS mangaUpdatesId,
           mangaupdates_url AS mangaUpdatesUrl
      FROM series_requests
     WHERE id = ?
     LIMIT 1
  `;
}

async function requestForMutation(
  db: Database,
  actor: Actor,
  requestId: string,
) {
  const row = await db
    .prepare(mutationSelect())
    .bind(requestId)
    .first<RequestMutationRow>();
  if (!row) {
    throw new ApiError(
      404,
      "SERIES_REQUEST_NOT_FOUND",
      "That series request does not exist.",
    );
  }
  if (
    actor.primaryRole !== "OWNER" &&
    actor.primaryRole !== "ADMINISTRATOR" &&
    row.submitterUserId !== actor.id
  ) {
    await assertSeriesRequestTeamPermission(db, actor, row.submittingTeamId);
  }
  return row;
}

function requestWriteValues(metadata: SeriesRequestMetadata) {
  const sources = externalSourceColumns(metadata);
  return [
    metadata.primaryTitle,
    normalizedLookupKey(metadata.primaryTitle),
    JSON.stringify(metadata.alternativeTitles),
    metadata.description,
    metadata.seriesType,
    metadata.publicationStatus,
    metadata.publicationYear,
    JSON.stringify(metadata.authors),
    JSON.stringify(metadata.artists),
    metadata.publisherName,
    metadata.countryCode,
    metadata.languageCode,
    metadata.readingDirection,
    JSON.stringify(metadata.genres),
    sources.mangaDexId,
    sources.mangaDexUrl,
    sources.mangaUpdatesId,
    sources.mangaUpdatesUrl,
    sources.canonicalSourceUrl,
    metadata.submitterNotes,
    metadata.duplicateConfirmation ? 1 : 0,
    "",
  ] as const;
}

function authorizationClause(teamIds: string[]) {
  const placeholders = teamIds.map(() => "?").join(", ");
  return {
    sql: `
      EXISTS (
        SELECT 1
          FROM users actor_user
         WHERE actor_user.id = ?
           AND actor_user.status = 'ACTIVE'
           AND (
             actor_user.primary_role IN ('OWNER', 'ADMINISTRATOR')
             OR (
               SELECT COUNT(DISTINCT tm.team_id)
                 FROM team_memberships tm
                 JOIN teams active_team ON active_team.id = tm.team_id
                WHERE tm.user_id = actor_user.id
                  AND tm.team_id IN (${placeholders})
                  AND tm.status = 'ACTIVE'
                  AND active_team.is_archived = 0
                  AND active_team.verification_status <> 'SUSPENDED'
                  AND (
                    upper(tm.membership_role) IN (
                      'OWNER',
                      'LEADER',
                      'TEAM_LEADER',
                      'MANAGER'
                    )
                    OR tm.can_request_series = 1
                  )
             ) = ?
           )
      )
    `,
    values: [teamIds.length] as const,
  };
}

function changedFields(
  current: RequestMutationRow,
  metadata: SeriesRequestMetadata,
) {
  const comparisons: Array<[string, unknown, unknown]> = [
    ["primaryTitle", current.primaryTitle, metadata.primaryTitle],
    [
      "alternativeTitles",
      current.alternativeTitlesJson,
      JSON.stringify(metadata.alternativeTitles),
    ],
    ["description", current.description, metadata.description],
    ["seriesType", current.seriesType, metadata.seriesType],
    [
      "publicationStatus",
      current.publicationStatus,
      metadata.publicationStatus,
    ],
    ["publicationYear", current.publicationYear, metadata.publicationYear],
    ["authors", current.authorsJson, JSON.stringify(metadata.authors)],
    ["artists", current.artistsJson, JSON.stringify(metadata.artists)],
    ["publisherName", current.publisherName, metadata.publisherName],
    ["countryCode", current.originCountry, metadata.countryCode],
    ["languageCode", current.originalLanguage, metadata.languageCode],
    ["readingDirection", current.readingDirection, metadata.readingDirection],
    ["genres", current.genresJson, JSON.stringify(metadata.genres)],
    ["submitterNotes", current.submitterNotes, metadata.submitterNotes],
  ];
  return comparisons
    .filter(([, before, after]) => before !== after)
    .map(([field]) => field);
}

function serializeMatches(matches: DuplicateMatch[]) {
  return safeJson(
    matches.map((match) => ({
      ...match,
      reasons: match.reasons.slice(0, 5),
    })),
  );
}

export async function createSeriesRequestDraft(
  db: Database,
  actor: Actor,
  requestId: string,
  teamId: string,
  metadata: SeriesRequestMetadata,
) {
  await assertAllRequestedTeams(
    db,
    actor,
    teamId,
    metadata.requestingTeamIds,
  );
  const id = randomId();
  const auth = authorizationClause(metadata.requestingTeamIds);
  const statements: Statement[] = [
    db
      .prepare(
        `INSERT INTO series_requests
         (id, submitting_team_id, submitter_user_id, status,
          primary_title, normalized_title, alternative_titles_json,
          description, series_type, publication_status, publication_year, authors_json,
          artists_json, publisher_name, origin_country, original_language,
          reading_direction, genres_json, mangadex_id, mangadex_url,
          mangaupdates_id, mangaupdates_url, canonical_source_url,
          submitter_notes, duplicate_confirmation, duplicate_explanation)
         SELECT ?, ?, ?, 'DRAFT',
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE ${auth.sql}`,
      )
      .bind(
        id,
        teamId,
        actor.id,
        ...requestWriteValues(metadata),
        actor.id,
        ...metadata.requestingTeamIds,
        ...auth.values,
      ),
  ];
  metadata.requestingTeamIds.forEach((requestedTeamId) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_request_teams
           (request_id, team_id, is_primary, requested_can_upload,
            requested_can_publish)
           SELECT ?, ?, ?, 1, 0
            WHERE EXISTS (
              SELECT 1 FROM series_requests WHERE id = ?
            )`,
        )
        .bind(
          id,
          requestedTeamId,
          requestedTeamId === teamId ? 1 : 0,
          id,
        ),
    );
  });
  statements.push(
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.draft.create",
        category: "SERIES_CHAPTERS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "SERIES_REQUEST",
        targetId: id,
        targetLabel: metadata.primaryTitle,
        newValue: {
          status: "DRAFT",
          teamId,
          requestingTeamIds: metadata.requestingTeamIds,
        },
      },
      `EXISTS (SELECT 1 FROM series_requests WHERE id = '${id.replaceAll("'", "''")}')`,
    ),
  );
  const results = await db.batch(statements);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "TEAM_PERMISSION_CHANGED",
      "Your team permissions changed before the draft could be saved.",
    );
  }
  return getTeamSeriesRequest(db, actor, id);
}

export async function updateSeriesRequest(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    mode: "SAVE" | "SUBMIT" | "RESUBMIT";
    metadata: SeriesRequestMetadata;
  },
) {
  const current = await requestForMutation(db, actor, input.requestId);
  const expectedStatus =
    input.mode === "SUBMIT"
      ? "DRAFT"
      : input.mode === "RESUBMIT"
        ? "CHANGES_REQUESTED"
        : null;
  if (
    (expectedStatus && current.status !== expectedStatus) ||
    (!expectedStatus &&
      !["DRAFT", "CHANGES_REQUESTED"].includes(current.status))
  ) {
    throw new ApiError(
      409,
      "SERIES_REQUEST_LOCKED",
      "This request cannot be edited in its current status.",
    );
  }
  if (Number(current.revision) !== input.expectedRevision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another team member changed this request. Reload it before saving.",
    );
  }
  await assertAllRequestedTeams(
    db,
    actor,
    current.submittingTeamId,
    input.metadata.requestingTeamIds,
  );
  const duplicates = await findRequestDuplicates(
    db,
    input.metadata,
    input.requestId,
  );
  const submitting = input.mode !== "SAVE";
  if (submitting && duplicates.exactExternalDuplicate) {
    throw new ApiError(
      409,
      "EXTERNAL_SOURCE_DUPLICATE",
      "That external identifier already belongs to a series or active request.",
    );
  }
  if (
    submitting &&
    duplicates.riskScore > 0 &&
    !input.metadata.duplicateConfirmation
  ) {
    throw new ApiError(
      409,
      "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
      "Review the possible matches and confirm that this is a distinct series.",
    );
  }
  if (submitting) {
    const recent = await db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM series_request_revisions
          WHERE author_user_id = ?
            AND kind IN ('SUBMISSION', 'RESUBMISSION')
            AND created_at >= datetime('now', '-1 hour')`,
      )
      .bind(actor.id)
      .first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 10) {
      throw new ApiError(
        429,
        "SERIES_REQUEST_RATE_LIMITED",
        "Too many series submissions were made recently. Try again later.",
      );
    }
  }
  const operationTime = new Date().toISOString();
  const nextRevision = Number(current.revision) + 1;
  const nextStatus = submitting ? "SUBMITTED" : current.status;
  const auth = authorizationClause(input.metadata.requestingTeamIds);
  const update = db
    .prepare(
      `UPDATE series_requests
          SET primary_title = ?,
              normalized_title = ?,
              alternative_titles_json = ?,
              description = ?,
              series_type = ?,
              publication_status = ?,
              publication_year = ?,
              authors_json = ?,
              artists_json = ?,
              publisher_name = ?,
              origin_country = ?,
              original_language = ?,
              reading_direction = ?,
              genres_json = ?,
              mangadex_id = ?,
              mangadex_url = ?,
              mangaupdates_id = ?,
              mangaupdates_url = ?,
              canonical_source_url = ?,
              submitter_notes = ?,
              duplicate_confirmation = ?,
              duplicate_explanation = ?,
              duplicate_risk_score = ?,
              duplicate_matches_json = ?,
              status = ?,
              submitted_at = CASE
                WHEN ? = 1 THEN ?
                ELSE submitted_at
              END,
              review_started_at = CASE
                WHEN ? = 1 THEN NULL
                ELSE review_started_at
              END,
              assigned_reviewer_user_id = CASE
                WHEN ? = 1 THEN NULL
                ELSE assigned_reviewer_user_id
              END,
              reviewed_at = CASE
                WHEN ? = 1 THEN NULL
                ELSE reviewed_at
              END,
              revision = ?,
              updated_at = ?
        WHERE id = ?
          AND revision = ?
          AND status ${expectedStatus ? "= ?" : "IN ('DRAFT', 'CHANGES_REQUESTED')"}
          AND ${auth.sql}`,
    )
    .bind(
      ...requestWriteValues(input.metadata),
      duplicates.riskScore,
      serializeMatches(duplicates.matches),
      nextStatus,
      submitting ? 1 : 0,
      operationTime,
      input.mode === "RESUBMIT" ? 1 : 0,
      input.mode === "RESUBMIT" ? 1 : 0,
      input.mode === "RESUBMIT" ? 1 : 0,
      nextRevision,
      operationTime,
      input.requestId,
      input.expectedRevision,
      ...(expectedStatus ? [expectedStatus] : []),
      actor.id,
      ...input.metadata.requestingTeamIds,
      ...auth.values,
    );
  const statements: Statement[] = [update];
  const gate = `EXISTS (
    SELECT 1 FROM series_requests gate
     WHERE gate.id = ?
       AND gate.revision = ?
       AND gate.updated_at = ?
  )`;
  const literalGate = `EXISTS (
    SELECT 1 FROM series_requests gate
     WHERE gate.id = '${input.requestId.replaceAll("'", "''")}'
       AND gate.revision = ${nextRevision}
       AND gate.updated_at = '${operationTime.replaceAll("'", "''")}'
  )`;
  statements.push(
    db
      .prepare(
        `DELETE FROM series_request_teams
          WHERE request_id = ?
            AND ${gate}`,
      )
      .bind(
        input.requestId,
        input.requestId,
        nextRevision,
        operationTime,
      ),
  );
  input.metadata.requestingTeamIds.forEach((teamId) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_request_teams
           (request_id, team_id, is_primary, requested_can_upload,
            requested_can_publish)
           SELECT ?, ?, ?, 1, 0
            WHERE ${gate}`,
        )
        .bind(
          input.requestId,
          teamId,
          teamId === current.submittingTeamId ? 1 : 0,
          input.requestId,
          nextRevision,
          operationTime,
        ),
    );
  });
  if (submitting) {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_request_revisions
           (id, request_id, revision_number, author_user_id, kind,
            snapshot_json, changed_fields_json)
           SELECT ?, ?, ?, ?, ?, ?, ?
            WHERE ${gate}`,
        )
        .bind(
          randomId(),
          input.requestId,
          nextRevision,
          actor.id,
          input.mode === "RESUBMIT" ? "RESUBMISSION" : "SUBMISSION",
          requestSnapshot(input.metadata, input.requestId, nextRevision),
          JSON.stringify(changedFields(current, input.metadata)),
          input.requestId,
          nextRevision,
          operationTime,
        ),
    );
    statements.push(
      ...requestNotificationStatements(db, {
        requestId: input.requestId,
        revision: nextRevision,
        kind:
          input.mode === "RESUBMIT"
            ? "SERIES_REQUEST_RESUBMITTED"
            : "SERIES_REQUEST_SUBMITTED",
        title:
          input.mode === "RESUBMIT"
            ? "Series request resubmitted"
            : "New series request",
        body: `${input.metadata.primaryTitle} is ready for administrator review.`,
        includeAdministrators: true,
        conditionSql: literalGate,
      }),
    );
  }
  statements.push(
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: submitting
          ? input.mode === "RESUBMIT"
            ? "series.request.resubmit"
            : "series.request.submit"
          : "series.request.draft.update",
        category: "SERIES_CHAPTERS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: input.metadata.primaryTitle,
        oldValue: {
          revision: current.revision,
          status: current.status,
        },
        newValue: {
          revision: nextRevision,
          status: nextStatus,
          duplicateRiskScore: duplicates.riskScore,
        },
      },
      literalGate,
    ),
  );
  const results = await db.batch(statements);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "The request or your team permissions changed. Reload before trying again.",
    );
  }
  return getTeamSeriesRequest(db, actor, input.requestId);
}

export async function withdrawSeriesRequest(
  db: Database,
  actor: Actor,
  requestId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    reason: string;
  },
) {
  const current = await requestForMutation(db, actor, input.requestId);
  if (
    !["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED"].includes(
      current.status,
    )
  ) {
    throw new ApiError(
      409,
      "SERIES_REQUEST_LOCKED",
      "This request cannot be withdrawn in its current status.",
    );
  }
  const nextRevision = Number(current.revision) + 1;
  const operationTime = new Date().toISOString();
  const literalGate = `EXISTS (
    SELECT 1 FROM series_requests
     WHERE id = '${input.requestId.replaceAll("'", "''")}'
       AND revision = ${nextRevision}
       AND status = 'WITHDRAWN'
       AND updated_at = '${operationTime.replaceAll("'", "''")}'
  )`;
  const results = await db.batch([
    db
      .prepare(
        `UPDATE series_requests
            SET status = 'WITHDRAWN',
                withdrawn_at = ?,
                revision = ?,
                updated_at = ?
          WHERE id = ?
            AND revision = ?
            AND status IN (
              'SUBMITTED',
              'UNDER_REVIEW',
              'CHANGES_REQUESTED'
            )
            AND (
              submitter_user_id = ?
              OR EXISTS (
                SELECT 1
                  FROM team_memberships tm
                 WHERE tm.team_id = series_requests.submitting_team_id
                   AND tm.user_id = ?
                   AND tm.status = 'ACTIVE'
                   AND (
                     upper(tm.membership_role) IN (
                       'OWNER',
                       'LEADER',
                       'TEAM_LEADER',
                       'MANAGER'
                     )
                     OR tm.can_request_series = 1
                   )
              )
            )`,
      )
      .bind(
        operationTime,
        nextRevision,
        operationTime,
        input.requestId,
        input.expectedRevision,
        actor.id,
        actor.id,
      ),
    db
      .prepare(
        `INSERT INTO series_request_feedback
         (id, request_id, request_revision, author_user_id, visibility,
          kind, body)
         SELECT ?, ?, ?, ?, 'SUBMITTER', 'COMMENT', ?
          WHERE EXISTS (
            SELECT 1 FROM series_requests
             WHERE id = ?
               AND revision = ?
               AND status = 'WITHDRAWN'
               AND updated_at = ?
          )`,
      )
      .bind(
        randomId(),
        input.requestId,
        nextRevision,
        actor.id,
        input.reason,
        input.requestId,
        nextRevision,
        operationTime,
      ),
    ...requestNotificationStatements(db, {
      requestId: input.requestId,
      revision: nextRevision,
      kind: "SERIES_REQUEST_WITHDRAWN",
      title: "Series request withdrawn",
      body: `${current.primaryTitle} was withdrawn by its requesting team.`,
      includeAdministrators: true,
      conditionSql: literalGate,
    }),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.withdraw",
        category: "SERIES_CHAPTERS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        reason: input.reason,
        oldValue: { revision: current.revision, status: current.status },
        newValue: { revision: nextRevision, status: "WITHDRAWN" },
      },
      literalGate,
    ),
  ]);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "This request changed before it could be withdrawn.",
    );
  }
  return getTeamSeriesRequest(db, actor, input.requestId);
}

export async function deleteSeriesRequestDraft(
  db: Database,
  actor: Actor,
  requestId: string,
  input: { requestId: string; expectedRevision: number },
) {
  const current = await requestForMutation(db, actor, input.requestId);
  if (current.status !== "DRAFT") {
    throw new ApiError(
      409,
      "SERIES_REQUEST_LOCKED",
      "Only draft requests can be deleted.",
    );
  }
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM series_requests
          WHERE id = ?
            AND revision = ?
            AND status = 'DRAFT'
            AND (
              submitter_user_id = ?
              OR EXISTS (
                SELECT 1
                  FROM team_memberships tm
                 WHERE tm.team_id = series_requests.submitting_team_id
                   AND tm.user_id = ?
                   AND tm.status = 'ACTIVE'
                   AND (
                     upper(tm.membership_role) IN (
                       'OWNER',
                       'LEADER',
                       'TEAM_LEADER',
                       'MANAGER'
                     )
                     OR tm.can_request_series = 1
                   )
              )
            )`,
      )
      .bind(
        input.requestId,
        input.expectedRevision,
        actor.id,
        actor.id,
      ),
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: "series.request.draft.delete",
        category: "SERIES_CHAPTERS",
        sourceArea: "UPLOAD_CENTER",
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        targetLabel: current.primaryTitle,
        oldValue: { revision: current.revision, status: current.status },
      },
      "changes() = 1",
    ),
  ]);
  if (!Number(results[0]?.meta.changes ?? 0)) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "This draft changed before it could be deleted.",
    );
  }
  if (env.BUCKET) {
    for (const [key, kind] of [
      [current.coverKey, "SERIES_REQUEST_COVER"],
      [current.bannerKey, "SERIES_REQUEST_BANNER"],
    ] as const) {
      if (!key) continue;
      await deleteMediaObject(db, env.BUCKET, key, {
        mediaKind: kind,
        targetType: "SERIES_REQUEST",
        targetId: input.requestId,
        reason: "Deleted series request draft",
      });
    }
  }
  return { deleted: true };
}

export async function cloneSeriesRequestToDraft(
  db: Database,
  actor: Actor,
  requestId: string,
  input: { requestId: string; expectedRevision: number },
) {
  const current = await requestForMutation(db, actor, input.requestId);
  if (!["REJECTED", "WITHDRAWN"].includes(current.status)) {
    throw new ApiError(
      409,
      "SERIES_REQUEST_NOT_CLONABLE",
      "Only rejected or withdrawn requests can be cloned into a new draft.",
    );
  }
  if (Number(current.revision) !== input.expectedRevision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "This request changed. Reload it before cloning.",
    );
  }
  const requestedTeams = await db
    .prepare(
      `SELECT team_id AS teamId
         FROM series_request_teams
        WHERE request_id = ?
        ORDER BY is_primary DESC, team_id`,
    )
    .bind(input.requestId)
    .all<{ teamId: string }>();
  const metadata: SeriesRequestMetadata = {
    primaryTitle: current.primaryTitle,
    alternativeTitles: JSON.parse(current.alternativeTitlesJson),
    description: current.description,
    seriesType: current.seriesType as SeriesRequestMetadata["seriesType"],
    publicationStatus:
      current.publicationStatus as SeriesRequestMetadata["publicationStatus"],
    publicationYear: current.publicationYear,
    authors: JSON.parse(current.authorsJson),
    artists: JSON.parse(current.artistsJson),
    publisherName: current.publisherName,
    countryCode: current.originCountry as SeriesRequestMetadata["countryCode"],
    languageCode:
      current.originalLanguage as SeriesRequestMetadata["languageCode"],
    readingDirection:
      current.readingDirection as SeriesRequestMetadata["readingDirection"],
    genres: JSON.parse(current.genresJson),
    requestingTeamIds: requestedTeams.results.map((team) => team.teamId),
    externalSources: [
      current.mangaDexId
        ? {
            source: "MANGADEX" as const,
            externalId: current.mangaDexId,
            sourceUrl: current.mangaDexUrl ?? "",
            responseHash: null,
          }
        : null,
      current.mangaUpdatesId
        ? {
            source: "MANGAUPDATES" as const,
            externalId: current.mangaUpdatesId,
            sourceUrl: current.mangaUpdatesUrl ?? "",
            responseHash: null,
          }
        : null,
    ].filter(Boolean) as SeriesRequestMetadata["externalSources"],
    submitterNotes: current.submitterNotes,
    duplicateConfirmation: Boolean(current.duplicateConfirmation),
  };
  return createSeriesRequestDraft(
    db,
    actor,
    requestId,
    current.submittingTeamId,
    metadata,
  );
}

export async function getTeamSeriesRequest(
  db: Database,
  actor: Actor,
  requestId: string,
) {
  const isAdmin =
    actor.primaryRole === "OWNER" || actor.primaryRole === "ADMINISTRATOR";
  const row = await db
    .prepare(
      `${requestSelect}
       WHERE r.id = ?
         AND (
           ? = 1
           OR r.submitter_user_id = ?
           OR EXISTS (
             SELECT 1
               FROM team_memberships tm
              WHERE tm.team_id = r.submitting_team_id
                AND tm.user_id = ?
                AND tm.status = 'ACTIVE'
                AND (
                  upper(tm.membership_role) IN (
                    'OWNER',
                    'LEADER',
                    'TEAM_LEADER',
                    'MANAGER'
                  )
                  OR tm.can_request_series = 1
                )
           )
         )
       LIMIT 1`,
    )
    .bind(requestId, isAdmin ? 1 : 0, actor.id, actor.id)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new ApiError(
      404,
      "SERIES_REQUEST_NOT_FOUND",
      "That series request is unavailable.",
    );
  }
  const [feedback, revisions] = await db.batch([
    db
      .prepare(
        `SELECT f.id,
                f.request_revision AS requestRevision,
                f.kind,
                f.field_path AS fieldPath,
                f.body,
                author.display_name AS authorDisplayName,
                f.created_at AS createdAt
           FROM series_request_feedback f
           LEFT JOIN users author ON author.id = f.author_user_id
          WHERE f.request_id = ?
            AND f.visibility = 'SUBMITTER'
          ORDER BY f.created_at, f.id`,
      )
      .bind(requestId),
    db
      .prepare(
        `SELECT revision_number AS revisionNumber,
                kind,
                snapshot_json AS snapshotJson,
                changed_fields_json AS changedFieldsJson,
                created_at AS createdAt
           FROM series_request_revisions
          WHERE request_id = ?
          ORDER BY revision_number DESC`,
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
        createdAt: string;
      }>
    ).map((revision) => ({
      revisionNumber: Number(revision.revisionNumber),
      kind: revision.kind,
      snapshot: JSON.parse(revision.snapshotJson),
      changedFields: JSON.parse(revision.changedFieldsJson),
      createdAt: revision.createdAt,
    })),
  };
}

export async function listTeamSeriesRequests(
  db: Database,
  actor: Actor,
  input: {
    status: string;
    teamId?: string;
    page: number;
    limit: number;
  },
) {
  const isAdmin =
    actor.primaryRole === "OWNER" || actor.primaryRole === "ADMINISTRATOR";
  if (input.teamId && !isAdmin) {
    await assertSeriesRequestTeamPermission(db, actor, input.teamId);
  }
  const conditions = [
    `(
      ? = 1
      OR r.submitter_user_id = ?
      OR EXISTS (
        SELECT 1
          FROM team_memberships tm
         WHERE tm.team_id = r.submitting_team_id
           AND tm.user_id = ?
           AND tm.status = 'ACTIVE'
           AND (
             upper(tm.membership_role) IN (
               'OWNER',
               'LEADER',
               'TEAM_LEADER',
               'MANAGER'
             )
             OR tm.can_request_series = 1
           )
      )
    )`,
  ];
  const bindings: unknown[] = [isAdmin ? 1 : 0, actor.id, actor.id];
  if (input.status !== "ALL") {
    conditions.push("r.status = ?");
    bindings.push(input.status);
  }
  if (input.teamId) {
    conditions.push("r.submitting_team_id = ?");
    bindings.push(input.teamId);
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
             WHEN 'CHANGES_REQUESTED' THEN 0
             WHEN 'UNDER_REVIEW' THEN 1
             WHEN 'SUBMITTED' THEN 2
             WHEN 'DRAFT' THEN 3
             ELSE 4
           END,
           COALESCE(r.submitted_at, r.updated_at) DESC,
           r.id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, input.limit, offset),
    db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM series_requests r
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
