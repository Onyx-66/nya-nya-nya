import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  collapseSpaces,
  normalizedLookupKey,
  preferredGenreLabel,
  seriesManagementSchema,
  type SeriesManagementInput,
} from "@/lib/admin-metadata";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  auditStatement,
  deleteMediaObject,
  requestIdFor,
  sha256Hex,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdmin } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { findNormalizedEquivalent } from "@/lib/server/taxonomy-equivalence";

export const dynamic = "force-dynamic";

type Database = NonNullable<typeof env.DB>;
type Statement = ReturnType<Database["prepare"]>;

type SeriesRow = {
  id: string;
  slug: string;
  title: string;
  nativeTitle: string | null;
  synopsis: string;
  type: SeriesManagementInput["type"];
  status: SeriesManagementInput["status"];
  originCountry: string;
  originalLanguage: string;
  readingDirection: SeriesManagementInput["readingDirection"];
  publicationYear: number | null;
  accessType: SeriesManagementInput["accessType"];
  rightsStatus: SeriesManagementInput["rightsStatus"];
  coverKey: string | null;
  bannerKey: string | null;
  sliderKey: string | null;
  isPublished: number;
  archivedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  publisherJson: string;
  aliasesJson: string;
  authorsJson: string;
  artistsJson: string;
  genresJson: string;
  teamsJson: string;
  externalSourcesJson: string;
  chapterCount: number;
};

const listQuerySchema = z.object({
  id: z.string().trim().min(3).max(160).optional(),
  query: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum(["ALL", "DRAFT", "PUBLISHED", "ARCHIVED"])
    .default("ALL"),
});

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Series management is temporarily unavailable.",
    );
  }
  return env.DB;
}

function parseJsonArray<T>(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as T)
      : null;
  } catch {
    return null;
  }
}

function publicMediaUrl(
  seriesId: string,
  slot: "cover" | "banner" | "slider",
  key: string | null,
  revision: number,
) {
  const normalized = key?.trim() ?? "";
  if (!normalized) return null;
  if (
    normalized.startsWith("/") ||
    /^https?:\/\//i.test(normalized)
  ) {
    return normalized;
  }
  return `/api/v1/series-media?id=${encodeURIComponent(seriesId)}&slot=${slot}&v=${revision}`;
}

function mapSeries(row: SeriesRow) {
  return {
    id: row.id,
    revision: Number(row.revision),
    title: row.title,
    slug: row.slug,
    alternativeTitles: parseJsonArray<{ id: number; name: string }>(
      row.aliasesJson,
    ).map((entry) => entry.name),
    synopsis: row.synopsis,
    type: row.type,
    status: row.status,
    publicationYear:
      row.publicationYear === null ? null : Number(row.publicationYear),
    authors: parseJsonArray<{ id: string; name: string }>(row.authorsJson),
    artists: parseJsonArray<{ id: string; name: string }>(row.artistsJson),
    publisher: parseJsonObject<{ id: string; name: string }>(
      row.publisherJson,
    ),
    countryCode: row.originCountry,
    languageCode: row.originalLanguage,
    genres: parseJsonArray<{ id: string; name: string }>(row.genresJson),
    teams: parseJsonArray<{
      id: string;
      name: string;
      isPrimary: number;
      canUpload: number;
      canPublish: number;
    }>(row.teamsJson).map((team) => ({
      ...team,
      isPrimary: Boolean(team.isPrimary),
      canUpload: Boolean(team.canUpload),
      canPublish: Boolean(team.canPublish),
    })),
    readingDirection: row.readingDirection,
    accessType: row.accessType,
    rightsStatus: row.rightsStatus,
    isPublished: Boolean(row.isPublished),
    archivedAt: row.archivedAt,
    coverUrl: publicMediaUrl(row.id, "cover", row.coverKey, row.revision),
    bannerUrl: publicMediaUrl(row.id, "banner", row.bannerKey, row.revision),
    sliderUrl: publicMediaUrl(row.id, "slider", row.sliderKey, row.revision),
    externalSources: parseJsonArray<{
      source: string;
      externalId: string;
      sourceUrl: string;
      responseHash: string | null;
      lastImportedAt: string | null;
    }>(row.externalSourcesJson),
    chapterCount: Number(row.chapterCount),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const seriesSelect = `
  SELECT
    s.id,
    s.slug,
    s.title,
    s.native_title AS nativeTitle,
    s.synopsis,
    s.type,
    s.status,
    s.origin_country AS originCountry,
    s.original_language AS originalLanguage,
    s.reading_direction AS readingDirection,
    s.publication_year AS publicationYear,
    s.access_type AS accessType,
    s.rights_status AS rightsStatus,
    s.cover_key AS coverKey,
    s.banner_key AS bannerKey,
    s.slider_key AS sliderKey,
    s.is_published AS isPublished,
    s.archived_at AS archivedAt,
    s.revision,
    s.created_at AS createdAt,
    s.updated_at AS updatedAt,
    CASE
      WHEN p.id IS NULL THEN 'null'
      ELSE json_object('id', p.id, 'name', p.name)
    END AS publisherJson,
    COALESCE((
      SELECT json_group_array(json_object('id', sa.id, 'name', sa.alias))
      FROM series_aliases sa
      WHERE sa.series_id = s.id
    ), '[]') AS aliasesJson,
    COALESCE((
      SELECT json_group_array(json_object('id', c.id, 'name', c.name))
      FROM series_creators sc
      JOIN creators c ON c.id = sc.creator_id
      WHERE sc.series_id = s.id AND sc.role = 'AUTHOR'
      ORDER BY sc.sort_order, c.name COLLATE NOCASE
    ), '[]') AS authorsJson,
    COALESCE((
      SELECT json_group_array(json_object('id', c.id, 'name', c.name))
      FROM series_creators sc
      JOIN creators c ON c.id = sc.creator_id
      WHERE sc.series_id = s.id AND sc.role = 'ARTIST'
      ORDER BY sc.sort_order, c.name COLLATE NOCASE
    ), '[]') AS artistsJson,
    COALESCE((
      SELECT json_group_array(json_object('id', g.id, 'name', g.name))
      FROM series_genres sg
      JOIN genres g ON g.id = sg.genre_id
      WHERE sg.series_id = s.id
      ORDER BY g.name COLLATE NOCASE
    ), '[]') AS genresJson,
    COALESCE((
      SELECT json_group_array(json_object(
        'id', t.id,
        'name', t.name,
        'isPrimary', sta.is_primary,
        'canUpload', sta.can_upload,
        'canPublish', sta.can_publish
      ))
      FROM series_team_assignments sta
      JOIN teams t ON t.id = sta.team_id
      WHERE sta.series_id = s.id
      ORDER BY sta.is_primary DESC, t.name COLLATE NOCASE
    ), '[]') AS teamsJson,
    COALESCE((
      SELECT json_group_array(json_object(
        'source', ses.source,
        'externalId', ses.external_id,
        'sourceUrl', ses.source_url,
        'responseHash', ses.response_hash,
        'lastImportedAt', ses.last_imported_at
      ))
      FROM series_external_sources ses
      WHERE ses.series_id = s.id
      ORDER BY ses.source
    ), '[]') AS externalSourcesJson,
    (
      SELECT COUNT(*)
      FROM chapters chapter
      WHERE chapter.series_id = s.id
    ) AS chapterCount
  FROM series s
  LEFT JOIN publishers p ON p.id = s.publisher_id
`;

async function getSeriesById(db: Database, id: string) {
  const row = await db
    .prepare(`${seriesSelect} WHERE s.id = ? LIMIT 1`)
    .bind(id)
    .first<SeriesRow>();
  if (!row) {
    throw new ApiError(
      404,
      "SERIES_NOT_FOUND",
      "This series record no longer exists.",
    );
  }
  return mapSeries(row);
}

async function deterministicId(prefix: string, key: string) {
  const digest = await sha256Hex(new TextEncoder().encode(key));
  return `${prefix}_${digest.slice(0, 24)}`;
}

async function resolveCreator(
  db: Database,
  entry: { id?: string; name: string },
  updateGuard: { seriesId: string; revision: number } | null,
) {
  if (entry.id) {
    const existing = await db
      .prepare(
        "SELECT id, name FROM creators WHERE id = ? AND archived_at IS NULL LIMIT 1",
      )
      .bind(entry.id)
      .first<{ id: string; name: string }>();
    if (!existing) {
      throw new ApiError(
        422,
        "CREATOR_NOT_AVAILABLE",
        `${entry.name} is no longer available.`,
      );
    }
    return { ...existing, statement: null as Statement | null };
  }
  const name = collapseSpaces(entry.name);
  const normalized = normalizedLookupKey(name);
  const exact = await db
    .prepare(
      "SELECT id, name FROM creators WHERE normalized_name = ? AND archived_at IS NULL LIMIT 1",
    )
    .bind(normalized)
    .first<{ id: string; name: string }>();
  const existing =
    exact ??
    (await findNormalizedEquivalent(
      db,
      "creators",
      normalized,
      normalizedLookupKey,
      "ACTIVE",
    ));
  if (existing) return { ...existing, statement: null as Statement | null };
  const id = await deterministicId("creator", normalized);
  const exactUnavailable = await db
    .prepare(
      `SELECT name FROM creators
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<{ name: string }>();
  const unavailable =
    exactUnavailable ??
    (await findNormalizedEquivalent(
      db,
      "creators",
      normalized,
      normalizedLookupKey,
      "ARCHIVED",
    ));
  if (unavailable) {
    throw new ApiError(
      409,
      "CREATOR_ARCHIVED",
      `${unavailable.name} is archived or merged. Restore it in Credits & Publishers or select its active replacement.`,
    );
  }
  return {
    id,
    name,
    statement: updateGuard
      ? db
          .prepare(
            `INSERT OR IGNORE INTO creators
             (id, name, normalized_name, biography, revision, created_at, updated_at)
             SELECT ?, ?, ?, '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             WHERE EXISTS (
               SELECT 1 FROM series WHERE id = ? AND revision = ?
             )`,
          )
          .bind(
            id,
            name,
            normalized,
            updateGuard.seriesId,
            updateGuard.revision,
          )
      : db
          .prepare(
            `INSERT OR IGNORE INTO creators
             (id, name, normalized_name, biography, revision, created_at, updated_at)
             VALUES (?, ?, ?, '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(id, name, normalized),
  };
}

async function resolvePublisher(
  db: Database,
  entry: { id?: string; name: string } | null,
  updateGuard: { seriesId: string; revision: number } | null,
) {
  if (!entry) return null;
  if (entry.id) {
    const existing = await db
      .prepare(
        "SELECT id, name FROM publishers WHERE id = ? AND archived_at IS NULL LIMIT 1",
      )
      .bind(entry.id)
      .first<{ id: string; name: string }>();
    if (!existing) {
      throw new ApiError(
        422,
        "PUBLISHER_NOT_AVAILABLE",
        `${entry.name} is no longer available.`,
      );
    }
    return { ...existing, statement: null as Statement | null };
  }
  const name = collapseSpaces(entry.name);
  const normalized = normalizedLookupKey(name);
  const exact = await db
    .prepare(
      "SELECT id, name FROM publishers WHERE normalized_name = ? AND archived_at IS NULL LIMIT 1",
    )
    .bind(normalized)
    .first<{ id: string; name: string }>();
  const existing =
    exact ??
    (await findNormalizedEquivalent(
      db,
      "publishers",
      normalized,
      normalizedLookupKey,
      "ACTIVE",
    ));
  if (existing) return { ...existing, statement: null as Statement | null };
  const id = await deterministicId("publisher", normalized);
  const exactUnavailable = await db
    .prepare(
      `SELECT name FROM publishers
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<{ name: string }>();
  const unavailable =
    exactUnavailable ??
    (await findNormalizedEquivalent(
      db,
      "publishers",
      normalized,
      normalizedLookupKey,
      "ARCHIVED",
    ));
  if (unavailable) {
    throw new ApiError(
      409,
      "PUBLISHER_ARCHIVED",
      `${unavailable.name} is archived or merged. Restore it in Credits & Publishers or select its active replacement.`,
    );
  }
  return {
    id,
    name,
    statement: updateGuard
      ? db
          .prepare(
            `INSERT OR IGNORE INTO publishers
             (id, name, normalized_name, description, revision)
             SELECT ?, ?, ?, '', 1
             WHERE EXISTS (
               SELECT 1 FROM series WHERE id = ? AND revision = ?
             )`,
          )
          .bind(
            id,
            name,
            normalized,
            updateGuard.seriesId,
            updateGuard.revision,
          )
      : db
          .prepare(
            `INSERT OR IGNORE INTO publishers
             (id, name, normalized_name, description, revision)
             VALUES (?, ?, ?, '', 1)`,
          )
          .bind(id, name, normalized),
  };
}

async function resolveGenre(
  db: Database,
  entry: { id?: string; name: string },
  updateGuard: { seriesId: string; revision: number } | null,
) {
  if (entry.id) {
    const existing = await db
      .prepare(
        "SELECT id, name FROM genres WHERE id = ? AND archived_at IS NULL LIMIT 1",
      )
      .bind(entry.id)
      .first<{ id: string; name: string }>();
    if (!existing) {
      throw new ApiError(
        422,
        "GENRE_NOT_AVAILABLE",
        `${entry.name} is no longer available.`,
      );
    }
    return { ...existing, statement: null as Statement | null };
  }
  const name = preferredGenreLabel(entry.name);
  const normalized = normalizedLookupKey(name);
  const exact = await db
    .prepare(
      "SELECT id, name FROM genres WHERE normalized_key = ? AND archived_at IS NULL LIMIT 1",
    )
    .bind(normalized)
    .first<{ id: string; name: string }>();
  const existing =
    exact ??
    (await findNormalizedEquivalent(
      db,
      "genres",
      normalized,
      normalizedLookupKey,
      "ACTIVE",
    ));
  if (existing) return { ...existing, statement: null as Statement | null };
  const id = await deterministicId("genre", normalized);
  const exactUnavailable = await db
    .prepare(
      `SELECT name FROM genres
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<{ name: string }>();
  const unavailable =
    exactUnavailable ??
    (await findNormalizedEquivalent(
      db,
      "genres",
      normalized,
      normalizedLookupKey,
      "ARCHIVED",
    ));
  if (unavailable) {
    throw new ApiError(
      409,
      "GENRE_ARCHIVED",
      `${unavailable.name} is archived or merged. Restore it in Genre Management or select its active replacement.`,
    );
  }
  const slugBase = normalized
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  const slug = `${slugBase || "genre"}-${id.slice(-7)}`;
  return {
    id,
    name,
    statement: updateGuard
      ? db
          .prepare(
            `INSERT OR IGNORE INTO genres
             (id, slug, name, normalized_key, revision, created_at, updated_at)
             SELECT ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             WHERE EXISTS (
               SELECT 1 FROM series WHERE id = ? AND revision = ?
             )`,
          )
          .bind(
            id,
            slug,
            name,
            normalized,
            updateGuard.seriesId,
            updateGuard.revision,
          )
      : db
          .prepare(
            `INSERT OR IGNORE INTO genres
             (id, slug, name, normalized_key, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(id, slug, name, normalized),
  };
}

async function resolveRelationships(
  db: Database,
  input: SeriesManagementInput,
  updateGuard: { seriesId: string; revision: number } | null,
) {
  const [authors, artists, publisher, genres] = await Promise.all([
    Promise.all(
      input.authors.map((entry) => resolveCreator(db, entry, updateGuard)),
    ),
    Promise.all(
      input.artists.map((entry) => resolveCreator(db, entry, updateGuard)),
    ),
    resolvePublisher(db, input.publisher, updateGuard),
    Promise.all(
      input.genres.map((entry) => resolveGenre(db, entry, updateGuard)),
    ),
  ]);
  return { authors, artists, publisher, genres };
}

async function validateTeamsAndSources(
  db: Database,
  input: SeriesManagementInput,
) {
  for (const teamId of input.teamIds) {
    const team = await db
      .prepare(
        `SELECT id FROM teams
         WHERE id = ? AND is_archived = 0 AND verification_status <> 'SUSPENDED'
         LIMIT 1`,
      )
      .bind(teamId)
      .first();
    if (!team) {
      throw new ApiError(
        422,
        "TEAM_NOT_AVAILABLE",
        "One of the selected teams is no longer eligible.",
      );
    }
  }
  for (const source of input.externalSources) {
    const duplicate = await db
      .prepare(
        `SELECT ses.series_id AS seriesId, s.title
         FROM series_external_sources ses
         JOIN series s ON s.id = ses.series_id
         WHERE ses.source = ? AND ses.external_id = ?
           AND (? IS NULL OR ses.series_id <> ?)
         LIMIT 1`,
      )
      .bind(
        source.source,
        source.externalId,
        input.id ?? null,
        input.id ?? null,
      )
      .first<{ seriesId: string; title: string }>();
    if (duplicate) {
      throw new ApiError(
        409,
        "EXTERNAL_SOURCE_DUPLICATE",
        `That external source is already linked to ${duplicate.title}.`,
      );
    }
  }
}

function gatedWhere(id: string, revision: number, operationTime: string) {
  return {
    clause:
      "EXISTS (SELECT 1 FROM series gate WHERE gate.id = ? AND gate.revision = ? AND gate.updated_at = ?)",
    values: [id, revision, operationTime] as const,
  };
}

async function saveSeries(
  db: Database,
  actor: Awaited<ReturnType<typeof requireActor>>,
  requestId: string,
  input: SeriesManagementInput,
) {
  await validateTeamsAndSources(db, input);
  const id = input.id ?? randomId();
  const operationTime = new Date().toISOString();
  const current = input.id
    ? await db
        .prepare(
          `SELECT id, title, native_title AS nativeTitle, revision,
                  cover_key AS coverKey,
                  banner_key AS bannerKey, slider_key AS sliderKey,
                  archived_at AS archivedAt
           FROM series WHERE id = ? LIMIT 1`,
        )
        .bind(input.id)
        .first<{
          id: string;
          title: string;
          nativeTitle: string | null;
          revision: number;
          coverKey: string | null;
          bannerKey: string | null;
          sliderKey: string | null;
          archivedAt: string | null;
        }>()
    : null;
  if (input.id && !current) {
    throw new ApiError(
      404,
      "SERIES_NOT_FOUND",
      "This series record no longer exists.",
    );
  }
  if (current && Number(current.revision) !== input.revision) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this series. Reload it before saving.",
    );
  }
  if (
    ((input.removeCover && current?.coverKey) ||
      (input.removeBanner && current?.bannerKey) ||
      (input.removeSlider && current?.sliderKey)) &&
    !env.BUCKET
  ) {
    throw new ApiError(
      503,
      "MEDIA_UNAVAILABLE",
      "Series media cannot be removed while object storage is unavailable.",
    );
  }
  const relationships = await resolveRelationships(
    db,
    input,
    current
      ? {
          seriesId: current.id,
          revision: input.revision ?? Number(current.revision),
        }
      : null,
  );
  const currentTeamAssignments = current
    ? await db
        .prepare(
          `SELECT team_id AS teamId, can_upload AS canUpload,
                  can_publish AS canPublish,
                  assigned_by_user_id AS assignedByUserId,
                  assigned_at AS assignedAt
           FROM series_team_assignments
           WHERE series_id = ?`,
        )
        .bind(id)
        .all<{
          teamId: string;
          canUpload: number;
          canPublish: number;
          assignedByUserId: string | null;
          assignedAt: string;
        }>()
    : { results: [] };
  const assignmentByTeam = new Map(
    currentTeamAssignments.results.map((assignment) => [
      assignment.teamId,
      assignment,
    ]),
  );

  const statements: Statement[] = [];
  for (const entry of [
    ...relationships.authors,
    ...relationships.artists,
    ...relationships.genres,
    ...(relationships.publisher ? [relationships.publisher] : []),
  ]) {
    if (entry.statement) statements.push(entry.statement);
  }

  const nativeTitle = input.alternativeTitles[0] ?? null;
  const nextRevision = current ? Number(current.revision) + 1 : 1;
  const coreStatement = current
    ? db
        .prepare(
          `UPDATE series
           SET slug = ?, title = ?, native_title = ?, synopsis = ?, type = ?,
               status = ?, origin_country = ?, original_language = ?,
               reading_direction = ?, publication_year = ?, publisher_id = ?,
               access_type = ?, rights_status = ?,
               is_published = ?,
               cover_key = CASE WHEN ? = 1 THEN NULL ELSE cover_key END,
               banner_key = CASE WHEN ? = 1 THEN NULL ELSE banner_key END,
               slider_key = CASE WHEN ? = 1 THEN NULL ELSE slider_key END,
               archived_at = ?, revision = ?,
               updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .bind(
          input.slug,
          input.title,
          nativeTitle,
          input.synopsis,
          input.type,
          input.status,
          input.countryCode,
          input.languageCode,
          input.readingDirection,
          input.publicationYear,
          relationships.publisher?.id ?? null,
          input.accessType,
          input.rightsStatus,
          input.isPublished ? 1 : 0,
          input.removeCover ? 1 : 0,
          input.removeBanner ? 1 : 0,
          input.removeSlider ? 1 : 0,
          current.archivedAt,
          nextRevision,
          operationTime,
          id,
          input.revision,
        )
    : db
        .prepare(
          `INSERT INTO series
           (id, slug, title, native_title, synopsis, type, status,
            origin_country, original_language, reading_direction,
            publication_year, publisher_id, age_rating, access_type,
            rights_status, is_published, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TEEN', ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          id,
          input.slug,
          input.title,
          nativeTitle,
          input.synopsis,
          input.type,
          input.status,
          input.countryCode,
          input.languageCode,
          input.readingDirection,
          input.publicationYear,
          relationships.publisher?.id ?? null,
          input.accessType,
          input.rightsStatus,
          input.isPublished ? 1 : 0,
          operationTime,
          operationTime,
        );
  const coreIndex = statements.length;
  statements.push(coreStatement);

  const gate = gatedWhere(id, nextRevision, operationTime);
  const gateValues = gate.values;
  for (const table of [
    "series_aliases",
    "series_creators",
    "series_genres",
    "series_team_assignments",
  ]) {
    statements.push(
      db
        .prepare(
          `DELETE FROM ${table}
           WHERE series_id = ? AND ${gate.clause}`,
        )
        .bind(id, ...gateValues),
    );
  }
  for (const title of input.alternativeTitles) {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_aliases
           (series_id, alias, normalized_alias, language)
           SELECT ?, ?, ?, ?
           WHERE ${gate.clause}`,
        )
        .bind(
          id,
          collapseSpaces(title),
          normalizedLookupKey(title),
          input.languageCode,
          ...gateValues,
        ),
    );
  }
  for (const [role, entries] of [
    ["AUTHOR", relationships.authors] as const,
    ["ARTIST", relationships.artists] as const,
  ]) {
    entries.forEach((entry, sortOrder) => {
      statements.push(
        db
          .prepare(
            `INSERT INTO series_creators
             (series_id, creator_id, role, sort_order)
             SELECT ?, ?, ?, ?
             WHERE ${gate.clause}`,
          )
          .bind(id, entry.id, role, sortOrder, ...gateValues),
      );
    });
  }
  for (const genre of relationships.genres) {
    statements.push(
      db
        .prepare(
          `INSERT INTO series_genres (series_id, genre_id)
           SELECT ?, ? WHERE ${gate.clause}`,
        )
        .bind(id, genre.id, ...gateValues),
    );
  }
  for (const teamId of input.teamIds) {
    const existingAssignment = assignmentByTeam.get(teamId);
    const isPrimary = input.primaryTeamId === teamId;
    statements.push(
      db
        .prepare(
          `INSERT INTO series_team_assignments
           (series_id, team_id, can_upload, can_publish, is_primary,
            assigned_by_user_id, assigned_at)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE ${gate.clause}`,
        )
        .bind(
          id,
          teamId,
          existingAssignment?.canUpload ?? 1,
          existingAssignment?.canPublish ?? (isPrimary ? 1 : 0),
          isPrimary ? 1 : 0,
          existingAssignment?.assignedByUserId ?? actor.id,
          existingAssignment?.assignedAt ?? operationTime,
          ...gateValues,
        ),
    );
  }
  for (const sourceType of ["MANGADEX", "MANGAUPDATES"] as const) {
    const selected = input.externalSources.find(
      (source) => source.source === sourceType,
    );
    statements.push(
      db
        .prepare(
          `DELETE FROM series_external_sources
           WHERE series_id = ? AND source = ?
             ${selected ? "AND external_id <> ?" : ""}
             AND ${gate.clause}`,
        )
        .bind(
          id,
          sourceType,
          ...(selected ? [selected.externalId] : []),
          ...gateValues,
        ),
    );
  }
  for (const source of input.externalSources) {
    statements.push(
      db
        .prepare(
          `UPDATE series_external_sources
           SET source_url = ?,
               last_imported_at = CASE
                 WHEN ? IS NOT NULL
                  AND COALESCE(response_hash, '') <> ?
                   THEN CURRENT_TIMESTAMP
                 ELSE last_imported_at
               END,
               last_imported_by_user_id = CASE
                 WHEN ? IS NOT NULL
                  AND COALESCE(response_hash, '') <> ?
                   THEN ?
                 ELSE last_imported_by_user_id
               END,
               response_hash = COALESCE(?, response_hash),
               updated_at = CURRENT_TIMESTAMP
           WHERE series_id = ? AND source = ? AND external_id = ?
             AND ${gate.clause}`,
        )
        .bind(
          source.sourceUrl,
          source.responseHash ?? null,
          source.responseHash ?? "",
          source.responseHash ?? null,
          source.responseHash ?? "",
          actor.id,
          source.responseHash ?? null,
          id,
          source.source,
          source.externalId,
          ...gateValues,
        ),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO series_external_sources
           (id, series_id, source, external_id, source_url, response_hash,
            last_imported_at, last_imported_by_user_id)
           SELECT ?, ?, ?, ?, ?, ?,
                  CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
                  CASE WHEN ? IS NULL THEN NULL ELSE ? END
           WHERE ${gate.clause}
             AND NOT EXISTS (
               SELECT 1
                 FROM series_external_sources existing
                WHERE existing.series_id = ?
                  AND existing.source = ?
                  AND existing.external_id = ?
             )`,
        )
        .bind(
          await deterministicId(
            "external",
            `${source.source}:${source.externalId}`,
          ),
          id,
          source.source,
          source.externalId,
          source.sourceUrl,
          source.responseHash ?? null,
          source.responseHash ?? null,
          source.responseHash ?? null,
          actor.id,
          ...gateValues,
          id,
          source.source,
          source.externalId,
        ),
    );
  }

  statements.splice(
    coreIndex + 1,
    0,
    auditStatement(
      db,
      actor,
      requestId,
      {
        action: current ? "series.update" : "series.create",
        category: "SERIES_CHAPTERS",
        sourceArea: "SERIES_MANAGEMENT",
        targetType: "SERIES",
        targetId: id,
        targetLabel: input.title,
        oldValue: current
          ? { title: current.title, revision: current.revision }
          : undefined,
        newValue: {
          title: input.title,
          revision: nextRevision,
          type: input.type,
          status: input.status,
          isPublished: input.isPublished,
          removeCover: input.removeCover,
          removeBanner: input.removeBanner,
          removeSlider: input.removeSlider,
          teamIds: input.teamIds,
          externalSources: input.externalSources.map((source) => ({
            source: source.source,
            externalId: source.externalId,
          })),
        },
      },
      "changes() = 1",
    ),
  );
  const importedSources = input.importApplied
    ? input.externalSources.filter((source) => source.responseHash)
    : [];
  for (const source of importedSources) {
    statements.push(
      db
        .prepare(
          `INSERT INTO metadata_import_logs
           (id, actor_user_id, series_id, source, external_id, action,
            result, safe_message, request_id)
           SELECT ?, ?, ?, ?, ?, 'APPLY', 'SUCCESS',
                  'Selected metadata fields were applied.', ?
            WHERE ${gate.clause}`,
        )
        .bind(
          randomId(),
          actor.id,
          id,
          source.source,
          source.externalId,
          requestId,
          ...gateValues,
        ),
    );
  }
  const results = await db.batch(statements);
  if (Number(results[coreIndex]?.meta?.changes ?? 0) === 0) {
    throw new ApiError(
      409,
      "STALE_VERSION",
      "Another administrator changed this series. Reload it before saving.",
    );
  }

  if (input.removeCover && current?.coverKey && env.BUCKET) {
    await deleteMediaObject(db, env.BUCKET, current.coverKey, {
      mediaKind: "SERIES_COVER",
      targetType: "SERIES",
      targetId: id,
      reason: "Removed series cover",
    });
  }
  if (input.removeBanner && current?.bannerKey && env.BUCKET) {
    await deleteMediaObject(db, env.BUCKET, current.bannerKey, {
      mediaKind: "SERIES_BANNER",
      targetType: "SERIES",
      targetId: id,
      reason: "Removed series banner",
    });
  }
  if (input.removeSlider && current?.sliderKey && env.BUCKET) {
    await deleteMediaObject(db, env.BUCKET, current.sliderKey, {
      mediaKind: "SERIES_SLIDER",
      targetType: "SERIES",
      targetId: id,
      reason: "Removed series slider artwork",
    });
  }
  return getSeriesById(db, id);
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    requireAdmin(actor);
    const db = database();
    const url = new URL(request.url);
    const query = listQuerySchema.parse({
      id: url.searchParams.get("id") || undefined,
      query: url.searchParams.get("query") ?? "",
      page: url.searchParams.get("page") ?? "1",
      limit: url.searchParams.get("limit") ?? "20",
      status: url.searchParams.get("status") ?? "ALL",
    });
    if (query.id) {
      return json(
        requestId,
        { data: await getSeriesById(db, query.id) },
        { headers: { "cache-control": "private, no-store" } },
      );
    }
    const normalizedQuery = `%${normalizedLookupKey(query.query)}%`;
    const statusClause =
      query.status === "DRAFT"
        ? "AND s.is_published = 0 AND s.archived_at IS NULL"
        : query.status === "PUBLISHED"
          ? "AND s.is_published = 1 AND s.archived_at IS NULL"
          : query.status === "ARCHIVED"
            ? "AND s.archived_at IS NOT NULL"
            : "";
    const searchClause = query.query
      ? `AND (
          LOWER(s.title) LIKE ? OR LOWER(s.slug) LIKE ?
          OR EXISTS (
            SELECT 1 FROM series_aliases search_alias
            WHERE search_alias.series_id = s.id
              AND search_alias.normalized_alias LIKE ?
          )
        )`
      : "";
    const bindings = query.query
      ? [normalizedQuery, normalizedQuery, normalizedQuery]
      : [];
    const count = await db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM series s
         WHERE 1 = 1 ${statusClause} ${searchClause}`,
      )
      .bind(...bindings)
      .first<{ count: number }>();
    const rows = await db
      .prepare(
        `${seriesSelect}
         WHERE 1 = 1 ${statusClause} ${searchClause}
         ORDER BY s.updated_at DESC, s.id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(
        ...bindings,
        query.limit,
        (query.page - 1) * query.limit,
      )
      .all<SeriesRow>();
    return json(
      requestId,
      {
        data: rows.results.map(mapSeries),
        pagination: {
          page: query.page,
          limit: query.limit,
          total: Number(count?.count ?? 0),
          pages: Math.max(
            1,
            Math.ceil(Number(count?.count ?? 0) / query.limit),
          ),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = seriesManagementSchema.parse(await request.json());
    if (payload.id) {
      throw new ApiError(
        422,
        "SERIES_ID_UNEXPECTED",
        "Use PUT to edit an existing series.",
      );
    }
    return json(
      requestId,
      { data: await saveSeries(database(), actor, requestId, payload) },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    requireAdmin(actor);
    const payload = seriesManagementSchema.parse(await request.json());
    if (!payload.id || !payload.revision) {
      throw new ApiError(
        422,
        "SERIES_VERSION_REQUIRED",
        "Reload this series before saving changes.",
      );
    }
    return json(
      requestId,
      { data: await saveSeries(database(), actor, requestId, payload) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
