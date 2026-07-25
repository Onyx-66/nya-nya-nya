import {
  normalizedLookupKey,
  type SeriesManagementInput,
} from "@/lib/admin-metadata";
import {
  externalSourceColumns,
  type SeriesRequestMetadata,
} from "@/lib/series-requests";
import { ApiError } from "@/lib/server/api";
import type { Actor } from "@/lib/server/policy";

export type Database = D1Database;
export type Statement = ReturnType<Database["prepare"]>;

export type DuplicateMatch = {
  kind: "SERIES" | "REQUEST";
  id: string;
  title: string;
  slug: string | null;
  status: string;
  reasons: string[];
  score: number;
  exactExternalId: boolean;
};

type CandidateSeriesRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  aliasesJson: string;
  authorsJson: string;
  externalSourcesJson: string;
};

function parseArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function titleTokens(value: string) {
  return new Set(
    normalizedLookupKey(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1),
  );
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

export async function findRequestDuplicates(
  db: Database,
  metadata: SeriesRequestMetadata,
  excludeRequestId?: string,
) {
  const normalizedTitles = [
    normalizedLookupKey(metadata.primaryTitle),
    ...metadata.alternativeTitles.map(normalizedLookupKey),
  ];
  const uniqueTitles = [...new Set(normalizedTitles)];
  const primaryNeedle =
    titleTokens(metadata.primaryTitle).values().next().value ?? "";
  const placeholders = uniqueTitles.map(() => "?").join(", ");
  const candidates = await db
    .prepare(
      `SELECT s.id,
              s.title,
              s.slug,
              s.status,
              COALESCE((
                SELECT json_group_array(sa.normalized_alias)
                  FROM series_aliases sa
                 WHERE sa.series_id = s.id
              ), '[]') AS aliasesJson,
              COALESCE((
                SELECT json_group_array(c.normalized_name)
                  FROM series_creators sc
                  JOIN creators c ON c.id = sc.creator_id
                 WHERE sc.series_id = s.id
                   AND sc.role = 'AUTHOR'
              ), '[]') AS authorsJson,
              COALESCE((
                SELECT json_group_array(
                  json_object(
                    'source', ses.source,
                    'externalId', ses.external_id
                  )
                )
                  FROM series_external_sources ses
                 WHERE ses.series_id = s.id
              ), '[]') AS externalSourcesJson
         FROM series s
        WHERE s.archived_at IS NULL
          AND (
            lower(trim(s.title)) IN (${placeholders})
            OR EXISTS (
              SELECT 1 FROM series_aliases sa
               WHERE sa.series_id = s.id
                 AND sa.normalized_alias IN (${placeholders})
            )
            OR (? <> '' AND lower(s.title) LIKE '%' || lower(?) || '%')
            OR EXISTS (
              SELECT 1 FROM series_external_sources ses
               WHERE (ses.source = 'MANGADEX' AND ses.external_id = ?)
                  OR (ses.source = 'MANGAUPDATES' AND ses.external_id = ?)
            )
          )
        ORDER BY s.is_published DESC, s.updated_at DESC, s.id
        LIMIT 100`,
    )
    .bind(
      ...uniqueTitles,
      ...uniqueTitles,
      primaryNeedle,
      primaryNeedle,
      externalSourceColumns(metadata).mangaDexId,
      externalSourceColumns(metadata).mangaUpdatesId,
    )
    .all<CandidateSeriesRow>();

  const requestedAuthorNames = new Set(
    metadata.authors.map((author) => normalizedLookupKey(author.name)),
  );
  const requestSources = externalSourceColumns(metadata);
  const matches: DuplicateMatch[] = candidates.results
    .map((candidate) => {
      const reasons: string[] = [];
      let score = 0;
      let exactExternalId = false;
      const candidateTitles = [
        normalizedLookupKey(candidate.title),
        ...parseArray<string>(candidate.aliasesJson),
      ];
      if (candidateTitles.some((title) => uniqueTitles.includes(title))) {
        score = Math.max(score, 80);
        reasons.push("Exact normalized title or alternative-title match");
      } else {
        const similarity = Math.max(
          ...candidateTitles.map((title) =>
            tokenSimilarity(metadata.primaryTitle, title),
          ),
        );
        if (similarity >= 0.6) {
          score = Math.max(score, Math.round(similarity * 70));
          reasons.push("Similar title wording");
        }
      }
      const candidateSources = parseArray<{
        source: string;
        externalId: string;
      }>(candidate.externalSourcesJson);
      if (
        candidateSources.some(
          (source) =>
            (source.source === "MANGADEX" &&
              source.externalId === requestSources.mangaDexId) ||
            (source.source === "MANGAUPDATES" &&
              source.externalId === requestSources.mangaUpdatesId),
        )
      ) {
        score = 100;
        exactExternalId = true;
        reasons.push("Exact external source identifier");
      }
      if (
        requestedAuthorNames.size &&
        parseArray<string>(candidate.authorsJson).some((author) =>
          requestedAuthorNames.has(author),
        )
      ) {
        score = Math.min(100, score + 10);
        reasons.push("Matching author");
      }
      return {
        kind: "SERIES" as const,
        id: candidate.id,
        title: candidate.title,
        slug: candidate.slug,
        status: candidate.status,
        reasons,
        score,
        exactExternalId,
      };
    })
    .filter((match) => match.score >= 45);

  const activeRequestRows = await db
    .prepare(
      `SELECT id,
              primary_title AS title,
              status,
              normalized_title AS normalizedTitle,
              alternative_titles_json AS alternativeTitlesJson,
              mangadex_id AS mangaDexId,
              mangaupdates_id AS mangaUpdatesId,
              canonical_source_url AS canonicalSourceUrl
         FROM series_requests
        WHERE status IN (
          'SUBMITTED',
          'UNDER_REVIEW',
          'CHANGES_REQUESTED',
          'APPROVED'
        )
          AND (? IS NULL OR id <> ?)
          AND (
            normalized_title IN (${placeholders})
            OR (mangadex_id IS NOT NULL AND mangadex_id = ?)
            OR (mangaupdates_id IS NOT NULL AND mangaupdates_id = ?)
            OR (canonical_source_url IS NOT NULL AND canonical_source_url = ?)
          )
        ORDER BY submitted_at DESC, id
        LIMIT 50`,
    )
    .bind(
      excludeRequestId ?? null,
      excludeRequestId ?? null,
      ...uniqueTitles,
      requestSources.mangaDexId,
      requestSources.mangaUpdatesId,
      requestSources.canonicalSourceUrl,
    )
    .all<{
      id: string;
      title: string;
      status: string;
      normalizedTitle: string;
      alternativeTitlesJson: string;
      mangaDexId: string | null;
      mangaUpdatesId: string | null;
      canonicalSourceUrl: string | null;
    }>();
  for (const candidate of activeRequestRows.results) {
    const exactExternalId = Boolean(
      (requestSources.mangaDexId &&
        candidate.mangaDexId === requestSources.mangaDexId) ||
        (requestSources.mangaUpdatesId &&
          candidate.mangaUpdatesId === requestSources.mangaUpdatesId) ||
        (requestSources.canonicalSourceUrl &&
          candidate.canonicalSourceUrl === requestSources.canonicalSourceUrl),
    );
    matches.push({
      kind: "REQUEST",
      id: candidate.id,
      title: candidate.title,
      slug: null,
      status: candidate.status,
      reasons: exactExternalId
        ? ["Exact external source identifier"]
        : ["Exact normalized title match in another active request"],
      score: exactExternalId ? 100 : 80,
      exactExternalId,
    });
  }

  const deduplicated = new Map<string, DuplicateMatch>();
  for (const match of matches) {
    const key = `${match.kind}:${match.id}`;
    const current = deduplicated.get(key);
    if (!current || current.score < match.score) {
      deduplicated.set(key, match);
    }
  }
  const ordered = [...deduplicated.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
  return {
    exactExternalDuplicate: ordered.some((match) => match.exactExternalId),
    riskScore: ordered[0]?.score ?? 0,
    matches: ordered.slice(0, 20),
  };
}

export async function assertSeriesRequestTeamPermission(
  db: Database,
  actor: Actor,
  teamId: string,
) {
  if (
    actor.primaryRole === "OWNER" ||
    actor.primaryRole === "ADMINISTRATOR"
  ) {
    const team = await db
      .prepare(
        `SELECT id FROM teams
          WHERE id = ?
            AND is_archived = 0
            AND verification_status <> 'SUSPENDED'
          LIMIT 1`,
      )
      .bind(teamId)
      .first();
    if (!team) {
      throw new ApiError(
        422,
        "TEAM_NOT_AVAILABLE",
        "That team is not eligible to request a series.",
      );
    }
    return;
  }
  const membership = await db
    .prepare(
      `SELECT tm.membership_role AS membershipRole,
              tm.can_request_series AS canRequestSeries
         FROM team_memberships tm
         JOIN teams t ON t.id = tm.team_id
        WHERE tm.team_id = ?
          AND tm.user_id = ?
          AND tm.status = 'ACTIVE'
          AND t.is_archived = 0
          AND t.verification_status <> 'SUSPENDED'
          AND (
            upper(tm.membership_role) IN (
              'OWNER',
              'LEADER',
              'TEAM_LEADER',
              'MANAGER'
            )
            OR tm.can_request_series = 1
          )
        LIMIT 1`,
    )
    .bind(teamId, actor.id)
    .first<{ membershipRole: string; canRequestSeries: number }>();
  if (!membership) {
    throw new ApiError(
      403,
      "SERIES_REQUEST_PERMISSION_REQUIRED",
      "Your active team role does not allow series requests.",
    );
  }
}

export async function assertAllRequestedTeams(
  db: Database,
  actor: Actor,
  submittingTeamId: string,
  requestedTeamIds: string[],
) {
  if (!requestedTeamIds.includes(submittingTeamId)) {
    throw new ApiError(
      422,
      "SUBMITTING_TEAM_REQUIRED",
      "The submitting team must be included as the primary requesting team.",
    );
  }
  for (const teamId of requestedTeamIds) {
    await assertSeriesRequestTeamPermission(db, actor, teamId);
  }
}

export function mapRequestRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    revision: Number(row.revision),
    status: String(row.status),
    primaryTitle: String(row.primaryTitle),
    alternativeTitles: parseArray<string>(
      row.alternativeTitlesJson as string,
    ),
    description: String(row.description),
    seriesType: String(row.seriesType),
    publicationStatus: String(row.publicationStatus),
    authors: parseArray<{ id?: string; name: string }>(
      row.authorsJson as string,
    ),
    artists: parseArray<{ id?: string; name: string }>(
      row.artistsJson as string,
    ),
    publisherName: String(row.publisherName ?? ""),
    countryCode: String(row.originCountry),
    languageCode: String(row.originalLanguage),
    readingDirection: String(row.readingDirection),
    genres: parseArray<{ id?: string; name: string }>(
      row.genresJson as string,
    ),
    coverUrl: row.coverKey
      ? `/api/v1/series-request-media?id=${encodeURIComponent(String(row.id))}&slot=cover&v=${Number(row.revision)}`
      : null,
    bannerUrl: row.bannerKey
      ? `/api/v1/series-request-media?id=${encodeURIComponent(String(row.id))}&slot=banner&v=${Number(row.revision)}`
      : null,
    externalSources: [
      row.mangaDexId
        ? {
            source: "MANGADEX",
            externalId: String(row.mangaDexId),
            sourceUrl: String(row.mangaDexUrl),
          }
        : null,
      row.mangaUpdatesId
        ? {
            source: "MANGAUPDATES",
            externalId: String(row.mangaUpdatesId),
            sourceUrl: String(row.mangaUpdatesUrl),
          }
        : null,
    ].filter(Boolean),
    submitterNotes: String(row.submitterNotes ?? ""),
    duplicateConfirmation: Boolean(row.duplicateConfirmation),
    duplicateExplanation: String(row.duplicateExplanation ?? ""),
    duplicateRiskScore: Number(row.duplicateRiskScore ?? 0),
    duplicateMatches: parseArray<DuplicateMatch>(
      row.duplicateMatchesJson as string,
    ),
    team: {
      id: String(row.submittingTeamId),
      name: String(row.submittingTeamName ?? ""),
    },
    submitter: {
      id: String(row.submitterUserId),
      displayName: String(row.submitterDisplayName ?? ""),
    },
    assignedReviewer: row.assignedReviewerUserId
      ? {
          id: String(row.assignedReviewerUserId),
          displayName: String(row.assignedReviewerDisplayName ?? ""),
        }
      : null,
    requestedTeams: parseArray<{
      id: string;
      name: string;
      isPrimary: number;
      requestedCanUpload: number;
      requestedCanPublish: number;
    }>(row.requestedTeamsJson as string).map((team) => ({
      ...team,
      isPrimary: Boolean(team.isPrimary),
      requestedCanUpload: Boolean(team.requestedCanUpload),
      requestedCanPublish: Boolean(team.requestedCanPublish),
    })),
    approvedSeries: row.approvedSeriesId
      ? {
          id: String(row.approvedSeriesId),
          title: String(row.approvedSeriesTitle ?? row.primaryTitle),
          slug: String(row.approvedSeriesSlug ?? ""),
        }
      : null,
    submittedAt: row.submittedAt ?? null,
    reviewStartedAt: row.reviewStartedAt ?? null,
    reviewedAt: row.reviewedAt ?? null,
    withdrawnAt: row.withdrawnAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const requestSelect = `
  SELECT r.id,
         r.revision,
         r.status,
         r.primary_title AS primaryTitle,
         r.alternative_titles_json AS alternativeTitlesJson,
         r.description,
         r.series_type AS seriesType,
         r.publication_status AS publicationStatus,
         r.authors_json AS authorsJson,
         r.artists_json AS artistsJson,
         r.publisher_name AS publisherName,
         r.origin_country AS originCountry,
         r.original_language AS originalLanguage,
         r.reading_direction AS readingDirection,
         r.genres_json AS genresJson,
         r.cover_key AS coverKey,
         r.banner_key AS bannerKey,
         r.mangadex_id AS mangaDexId,
         r.mangadex_url AS mangaDexUrl,
         r.mangaupdates_id AS mangaUpdatesId,
         r.mangaupdates_url AS mangaUpdatesUrl,
         r.submitter_notes AS submitterNotes,
         r.duplicate_confirmation AS duplicateConfirmation,
         r.duplicate_explanation AS duplicateExplanation,
         r.duplicate_risk_score AS duplicateRiskScore,
         r.duplicate_matches_json AS duplicateMatchesJson,
         r.submitting_team_id AS submittingTeamId,
         t.name AS submittingTeamName,
         r.submitter_user_id AS submitterUserId,
         submitter.display_name AS submitterDisplayName,
         r.assigned_reviewer_user_id AS assignedReviewerUserId,
         reviewer.display_name AS assignedReviewerDisplayName,
         r.approved_series_id AS approvedSeriesId,
         approved.title AS approvedSeriesTitle,
         approved.slug AS approvedSeriesSlug,
         r.submitted_at AS submittedAt,
         r.review_started_at AS reviewStartedAt,
         r.reviewed_at AS reviewedAt,
         r.withdrawn_at AS withdrawnAt,
         r.created_at AS createdAt,
         r.updated_at AS updatedAt,
         COALESCE((
           SELECT json_group_array(
             json_object(
               'id', requested_team.id,
               'name', requested_team.name,
               'isPrimary', rt.is_primary,
               'requestedCanUpload', rt.requested_can_upload,
               'requestedCanPublish', rt.requested_can_publish
             )
           )
             FROM series_request_teams rt
             JOIN teams requested_team ON requested_team.id = rt.team_id
            WHERE rt.request_id = r.id
            ORDER BY rt.is_primary DESC, requested_team.name COLLATE NOCASE
         ), '[]') AS requestedTeamsJson
    FROM series_requests r
    JOIN teams t ON t.id = r.submitting_team_id
    JOIN users submitter ON submitter.id = r.submitter_user_id
    LEFT JOIN users reviewer ON reviewer.id = r.assigned_reviewer_user_id
    LEFT JOIN series approved ON approved.id = r.approved_series_id
`;

export function requestNotificationStatements(
  db: Database,
  input: {
    requestId: string;
    revision: number;
    kind: string;
    title: string;
    body: string;
    includeAdministrators?: boolean;
    includeTeam?: boolean;
    conditionSql?: string;
  },
) {
  const statements: Statement[] = [];
  const dedupe = `${input.kind}:${input.requestId}:${input.revision}`;
  const condition = input.conditionSql ?? "1 = 1";
  if (input.includeAdministrators) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications
           (id, user_id, kind, title, body, dedupe_key, action_url,
            metadata_json)
           SELECT 'ntf_' || lower(hex(randomblob(16))),
                  u.id, ?, ?, ?, ?, ?, ?
             FROM users u
            WHERE u.status = 'ACTIVE'
              AND u.primary_role IN ('OWNER', 'ADMINISTRATOR')
              AND (${condition})
              AND NOT EXISTS (
                SELECT 1 FROM notifications existing
                 WHERE existing.user_id = u.id
                   AND existing.dedupe_key = ?
              )`,
        )
        .bind(
          input.kind,
          input.title,
          input.body,
          dedupe,
          `/onyx/admin/access/new-series-queue?id=${encodeURIComponent(input.requestId)}`,
          JSON.stringify({ requestId: input.requestId }),
          dedupe,
        ),
    );
  }
  if (input.includeTeam) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications
           (id, user_id, kind, title, body, dedupe_key, action_url,
            metadata_json)
           SELECT 'ntf_' || lower(hex(randomblob(16))),
                  recipients.user_id, ?, ?, ?, ?, ?, ?
             FROM (
               SELECT r.submitter_user_id AS user_id
                 FROM series_requests r
                WHERE r.id = ?
               UNION
               SELECT tm.user_id
                 FROM series_requests r
                 JOIN team_memberships tm
                   ON tm.team_id = r.submitting_team_id
                WHERE r.id = ?
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
             ) recipients
            WHERE (${condition})
              AND NOT EXISTS (
              SELECT 1 FROM notifications existing
               WHERE existing.user_id = recipients.user_id
                 AND existing.dedupe_key = ?
            )`,
        )
        .bind(
          input.kind,
          input.title,
          input.body,
          dedupe,
          `/upload-chapter/series-requests?id=${encodeURIComponent(input.requestId)}`,
          JSON.stringify({ requestId: input.requestId }),
          input.requestId,
          input.requestId,
          dedupe,
        ),
    );
  }
  return statements;
}

export function metadataToSeriesInput(
  metadata: SeriesRequestMetadata,
): Pick<
  SeriesManagementInput,
  | "title"
  | "alternativeTitles"
  | "synopsis"
  | "type"
  | "status"
  | "authors"
  | "artists"
  | "publisher"
  | "countryCode"
  | "languageCode"
  | "genres"
  | "readingDirection"
> {
  return {
    title: metadata.primaryTitle,
    alternativeTitles: metadata.alternativeTitles,
    synopsis: metadata.description,
    type: metadata.seriesType,
    status: metadata.publicationStatus,
    authors: metadata.authors,
    artists: metadata.artists,
    publisher: metadata.publisherName
      ? { name: metadata.publisherName }
      : null,
    countryCode: metadata.countryCode,
    languageCode: metadata.languageCode,
    genres: metadata.genres,
    readingDirection: metadata.readingDirection,
  };
}
