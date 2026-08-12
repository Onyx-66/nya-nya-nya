import { z } from "zod";
import {
  canonicalLanguageCode,
  normalizedLookupKey,
  type CountryCode,
  type ImportedSeriesMetadata,
  type LanguageCode,
} from "@/lib/admin-metadata";
import {
  mangaUpdatesExternalIdAliases,
  mangaUpdatesIdentifierFromProviderId,
  mangaUpdatesIdentifierFromUrl,
} from "@/lib/mangaupdates-identifiers";
import { ApiError } from "@/lib/server/api";
import { sha256Hex } from "@/lib/server/admin-utils";
import { randomId } from "@/lib/server/random-id";

export const metadataPreviewSchema = z.object({
  source: z.enum(["MANGADEX", "MANGAUPDATES"]),
  input: z.string().trim().min(1).max(1_000),
  refresh: z.boolean().default(false),
});

export const metadataSearchSchema = z.object({
  source: z.enum(["MANGADEX", "MANGAUPDATES"]),
  query: z.string().trim().min(2).max(200),
});

const mangaDexIdSchema = z
  .string()
  .uuid("Enter a valid MangaDex title URL or UUID.");

type MangaDexRelationship = {
  id?: string;
  type?: string;
  attributes?: { name?: string; fileName?: string };
};

type MangaDexPayload = {
  data?: {
    id?: string;
    attributes?: {
      title?: Record<string, string>;
      altTitles?: Array<Record<string, string>>;
      description?: Record<string, string>;
      originalLanguage?: string;
      status?: string;
      year?: number | null;
      tags?: Array<{ attributes?: { name?: Record<string, string> } }>;
    };
    relationships?: MangaDexRelationship[];
  };
};

type MangaDexSearchPayload = {
  data?: Array<NonNullable<MangaDexPayload["data"]>>;
};

type MangaUpdatesPayload = {
  series_id?: number | string;
  title?: string;
  url?: string;
  description?: string;
  associated?: Array<{ title?: string } | string>;
  authors?: Array<{
    name?: string;
    type?: string;
    author_name?: string;
  }>;
  publishers?: Array<{
    publisher_name?: string;
    name?: string;
    type?: string;
  }>;
  genres?: Array<{ genre?: string; name?: string } | string>;
  type?: string;
  year?: number | string | null;
  status?: string;
  image?: {
    url?: {
      original?: string;
      thumb?: string;
    };
    original?: string;
    thumb?: string;
  };
};


type MangaUpdatesSearchPayload = {
  results?: Array<
    | MangaUpdatesPayload
    | { record?: MangaUpdatesPayload; hit_title?: string }
  >;
};

export type MetadataSearchResult = {
  source: "MANGADEX" | "MANGAUPDATES";
  externalId: string;
  sourceUrl: string;
  title: string;
  status: string | null;
  coverReferenceUrl: string | null;
};

type NormalizedProviderInput = {
  /** Canonical identifier stored with the series and used for duplicate checks. */
  id: string;
  /** Canonical public source URL stored with the series. */
  url: string;
  /** Identifier accepted by the provider's detail API. */
  providerId: string;
};

type ProviderFetchContext = {
  db: D1Database;
  actorUserId: string;
  requestId: string;
  seriesId?: string;
  source: "MANGADEX" | "MANGAUPDATES";
  externalId: string;
  operation: "SEARCH" | "DETAIL";
};

type ProviderActorContext = Pick<
  ProviderFetchContext,
  "actorUserId" | "requestId" | "seriesId"
>;

export function normalizeMangaDexInput(value: string): NormalizedProviderInput {
  const trimmed = value.trim();
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) {
    const id = mangaDexIdSchema.parse(trimmed.toLowerCase());
    return {
      id,
      url: `https://mangadex.org/title/${id}`,
      providerId: id,
    };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ApiError(
      422,
      "MANGADEX_INPUT_INVALID",
      "Enter a MangaDex title URL or UUID.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !["mangadex.org", "www.mangadex.org"].includes(url.hostname)
  ) {
    throw new ApiError(
      422,
      "MANGADEX_INPUT_INVALID",
      "Use an official MangaDex title URL.",
    );
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const titleIndex = parts.indexOf("title");
  const id = mangaDexIdSchema.parse(parts[titleIndex + 1]?.toLowerCase());
  return {
    id,
    url: `https://mangadex.org/title/${id}`,
    providerId: id,
  };
}

export function normalizeMangaUpdatesInput(
  value: string,
): NormalizedProviderInput {
  const trimmed = value.trim();
  const normalized = /^\d{1,12}$/u.test(trimmed)
    ? mangaUpdatesIdentifierFromProviderId(trimmed)
    : mangaUpdatesIdentifierFromUrl(trimmed);
  if (!normalized) {
    throw new ApiError(
      422,
      "MANGAUPDATES_INPUT_INVALID",
      /^https?:\/\//iu.test(trimmed)
        ? "Use an official MangaUpdates series URL."
        : "Enter a MangaUpdates series URL or numeric ID.",
    );
  }
  return {
    id: normalized.externalId,
    url: normalized.sourceUrl,
    providerId: normalized.providerId,
  };
}

function firstText(record: Record<string, string> | undefined) {
  if (!record) return undefined;
  return (
    record.en?.trim() ||
    Object.values(record).find((value) => value?.trim())?.trim()
  );
}

function countryForLanguage(
  languageCode: LanguageCode | null,
): CountryCode | undefined {
  if (languageCode === "ja") return "JP";
  if (languageCode === "ko") return "KR";
  if (languageCode === "zh") return "CN";
  return undefined;
}

function seriesTypeForLanguage(languageCode: LanguageCode | null) {
  if (languageCode === "ja") return "MANGA" as const;
  if (languageCode === "ko") return "MANHWA" as const;
  if (languageCode === "zh") return "MANHUA" as const;
  return undefined;
}

function mapMangaDex(
  payload: MangaDexPayload,
  id: string,
  sourceUrl: string,
  responseHash: string,
  cached: boolean,
): ImportedSeriesMetadata {
  const data = payload.data;
  const attributes = data?.attributes;
  if (!data?.id || !attributes) {
    throw new ApiError(
      502,
      "MANGADEX_RESPONSE_INVALID",
      "MangaDex returned an incomplete metadata response.",
    );
  }
  const languageCode =
    canonicalLanguageCode(attributes.originalLanguage ?? "") ?? null;
  const relationships = data.relationships ?? [];
  const relationshipNames = (type: "author" | "artist") =>
    relationships
      .filter((relationship) => relationship.type === type)
      .map((relationship) => relationship.attributes?.name?.trim())
      .filter((name): name is string => Boolean(name))
      .filter(
        (name, index, names) =>
          names.findIndex(
            (candidate) =>
              normalizedLookupKey(candidate) === normalizedLookupKey(name),
          ) === index,
      )
      .map((name) => ({ name }));
  const alternativeTitles = (attributes.altTitles ?? [])
    .flatMap((entry) => Object.values(entry))
    .map((title) => title.trim())
    .filter(Boolean)
    .filter(
      (title, index, titles) =>
        titles.findIndex(
          (candidate) =>
            normalizedLookupKey(candidate) === normalizedLookupKey(title),
        ) === index,
    );
  const genres = (attributes.tags ?? [])
    .map((tag) => firstText(tag.attributes?.name))
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ name }));
  const statusMap: Record<
    string,
    | "ONGOING"
    | "COMPLETED"
    | "HIATUS"
    | "PAUSED"
    | "CANCELLED"
    | "UPCOMING"
  > = {
    ongoing: "ONGOING",
    completed: "COMPLETED",
    hiatus: "HIATUS",
    cancelled: "CANCELLED",
  };
  const cover = relationships.find(
    (relationship) =>
      relationship.type === "cover_art" &&
      relationship.attributes?.fileName,
  );
  return {
    source: "MANGADEX",
    externalId: id,
    sourceUrl,
    responseHash,
    fetchedAt: new Date().toISOString(),
    cached,
    fields: {
      title: firstText(attributes.title),
      alternativeTitles,
      synopsis: firstText(attributes.description),
      authors: relationshipNames("author"),
      artists: relationshipNames("artist"),
      countryCode: countryForLanguage(languageCode),
      languageCode: languageCode ?? undefined,
      type: seriesTypeForLanguage(languageCode),
      status: statusMap[attributes.status ?? ""],
      publicationYear: attributes.year ?? null,
      genres,
      coverReferenceUrl:
        cover?.attributes?.fileName
          ? `https://uploads.mangadex.org/covers/${data.id}/${cover.attributes.fileName}.512.jpg`
          : null,
    },
  };
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mapMangaUpdates(
  payload: MangaUpdatesPayload,
  id: string,
  sourceUrl: string,
  responseHash: string,
  cached: boolean,
): ImportedSeriesMetadata {
  const title = normalizeString(payload.title);
  if (!title) {
    throw new ApiError(
      502,
      "MANGAUPDATES_RESPONSE_INVALID",
      "MangaUpdates returned an incomplete metadata response.",
    );
  }
  const typeText = normalizeString(payload.type)?.toLowerCase() ?? "";
  const type =
    typeText.includes("manhwa")
      ? ("MANHWA" as const)
      : typeText.includes("manhua")
        ? ("MANHUA" as const)
        : ("MANGA" as const);
  const languageCode =
    type === "MANHWA" ? "ko" : type === "MANHUA" ? "zh" : "ja";
  const statusText = normalizeString(payload.status)?.toLowerCase() ?? "";
  const status =
    statusText.includes("complete")
      ? ("COMPLETED" as const)
      : statusText.includes("hiatus")
        ? ("HIATUS" as const)
        : statusText.includes("discontinued") ||
            statusText.includes("cancel")
          ? ("CANCELLED" as const)
          : statusText.includes("not yet") || statusText.includes("upcoming")
            ? ("UPCOMING" as const)
            : ("ONGOING" as const);
  const contributors = (kind: "author" | "artist") =>
    (payload.authors ?? [])
      .filter((entry) => {
        const entryType = normalizeString(entry.type)?.toLowerCase() ?? "";
        return kind === "author"
          ? !entryType || entryType.includes("author")
          : entryType.includes("artist");
      })
      .map((entry) => normalizeString(entry.name ?? entry.author_name))
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ name }));
  const publisherName = (payload.publishers ?? [])
    .map((entry) => normalizeString(entry.publisher_name ?? entry.name))
    .find(Boolean);
  const coverReferenceUrl =
    normalizeString(payload.image?.url?.original) ??
    normalizeString(payload.image?.original) ??
    normalizeString(payload.image?.url?.thumb) ??
    normalizeString(payload.image?.thumb) ??
    null;
  const numericYear = Number(payload.year);
  return {
    source: "MANGAUPDATES",
    externalId: id,
    sourceUrl,
    responseHash,
    fetchedAt: new Date().toISOString(),
    cached,
    fields: {
      title,
      alternativeTitles: (payload.associated ?? [])
        .map((entry) =>
          normalizeString(
            typeof entry === "string" ? entry : entry.title,
          ),
        )
        .filter((value): value is string => Boolean(value)),
      synopsis: normalizeString(payload.description),
      authors: contributors("author"),
      artists: contributors("artist"),
      publisher: publisherName ? { name: publisherName } : undefined,
      countryCode:
        type === "MANHWA" ? "KR" : type === "MANHUA" ? "CN" : "JP",
      languageCode,
      type,
      status,
      publicationYear:
        Number.isInteger(numericYear) && numericYear >= 1800
          ? numericYear
          : null,
      genres: (payload.genres ?? [])
        .map((entry) =>
          normalizeString(typeof entry === "string" ? entry : entry.genre ?? entry.name),
        )
        .filter((name): name is string => Boolean(name))
        .map((name) => ({ name })),
      coverReferenceUrl,
    },
  };
}

export function deriveCachedCoverUrl(
  source: "MANGADEX" | "MANGAUPDATES",
  externalId: string,
  raw: string,
) {
  let payload: MangaDexPayload | MangaUpdatesPayload;
  try {
    payload = JSON.parse(raw) as MangaDexPayload | MangaUpdatesPayload;
  } catch {
    throw new ApiError(
      502,
      "METADATA_RESPONSE_INVALID",
      "The cached metadata response is unreadable.",
    );
  }
  if (source === "MANGADEX") {
    const relationship = (
      (payload as MangaDexPayload).data?.relationships ?? []
    ).find(
      (entry) =>
        entry.type === "cover_art" && entry.attributes?.fileName,
    );
    return relationship?.attributes?.fileName
      ? `https://uploads.mangadex.org/covers/${externalId}/${relationship.attributes.fileName}.512.jpg`
      : null;
  }
  const mangaUpdates = payload as MangaUpdatesPayload;
  return (
    normalizeString(mangaUpdates.image?.url?.original) ??
    normalizeString(mangaUpdates.image?.original) ??
    normalizeString(mangaUpdates.image?.url?.thumb) ??
    normalizeString(mangaUpdates.image?.thumb) ??
    null
  );
}

async function reserveProviderFetch(context: ProviderFetchContext) {
  const logId = randomId();
  const reservation = await context.db
    .prepare(
      `INSERT INTO metadata_import_logs
       (id, actor_user_id, series_id, source, external_id, action, result,
        safe_message, request_id)
       SELECT ?, ?, ?, ?, ?, 'PROVIDER_FETCH', 'PENDING', ?, ?
        WHERE (
          SELECT COUNT(*)
            FROM metadata_import_logs
           WHERE source = ?
             AND action = 'PROVIDER_FETCH'
             AND created_at >= datetime('now', '-1 minute')
        ) < 120`,
    )
    .bind(
      logId,
      context.actorUserId,
      context.seriesId ?? null,
      context.source,
      context.externalId,
      `${context.operation === "SEARCH" ? "Search" : "Detail"} provider call reserved.`,
      context.requestId,
      context.source,
    )
    .run();
  if (!reservation.meta.changes) {
    throw new ApiError(
      429,
      "IMPORT_RATE_LIMITED",
      "The metadata provider request budget is temporarily exhausted. Try again shortly.",
    );
  }
  return logId;
}

async function settleProviderFetch(
  context: ProviderFetchContext,
  logId: string,
  result: "SUCCESS" | "FAILURE",
) {
  await context.db
    .prepare(
      `UPDATE metadata_import_logs
          SET result = ?,
              safe_message = ?
        WHERE id = ?
          AND action = 'PROVIDER_FETCH'
          AND result = 'PENDING'`,
    )
    .bind(
      result,
      `${context.operation === "SEARCH" ? "Search" : "Detail"} provider call ${result === "SUCCESS" ? "completed" : "failed"}.`,
      logId,
    )
    .run()
    .catch(() => undefined);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  context: ProviderFetchContext,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const providerLogId = await reserveProviderFetch(context);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          "user-agent": "NyaScans-Metadata/1.2",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.status === 429) {
        throw new ApiError(
          503,
          "METADATA_RATE_LIMITED",
          "The metadata provider is busy. Try again in a few minutes.",
        );
      }
      if (response.status === 404) {
        throw new ApiError(
          404,
          "METADATA_NOT_FOUND",
          "No title was found for that external identifier.",
        );
      }
      if (!response.ok) throw new Error(`Provider response ${response.status}`);
      const raw = await response.text();
      await settleProviderFetch(context, providerLogId, "SUCCESS");
      return raw;
    } catch (error) {
      await settleProviderFetch(context, providerLogId, "FAILURE");
      lastError = error;
      if (error instanceof ApiError || attempt === 1) break;
    }
  }
  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError(
    503,
    "METADATA_PROVIDER_UNAVAILABLE",
    "The metadata provider did not respond in time. Try again.",
  );
}

function mangaDexSearchResults(raw: string): MetadataSearchResult[] {
  let payload: MangaDexSearchPayload;
  try {
    payload = JSON.parse(raw) as MangaDexSearchPayload;
  } catch {
    throw new ApiError(
      502,
      "METADATA_RESPONSE_INVALID",
      "MangaDex returned an unreadable search response.",
    );
  }
  return (payload.data ?? []).flatMap((entry) => {
    const id = normalizeString(entry.id);
    const title = firstText(entry.attributes?.title);
    if (!id || !title) return [];
    const cover = (entry.relationships ?? []).find(
      (relationship) =>
        relationship.type === "cover_art" &&
        relationship.attributes?.fileName,
    );
    return [{
      source: "MANGADEX" as const,
      externalId: id,
      sourceUrl: `https://mangadex.org/title/${id}`,
      title,
      status: normalizeString(entry.attributes?.status) ?? null,
      coverReferenceUrl: cover?.attributes?.fileName
        ? `https://uploads.mangadex.org/covers/${id}/${cover.attributes.fileName}.256.jpg`
        : null,
    }];
  });
}

function mangaUpdatesSearchResults(raw: string): MetadataSearchResult[] {
  let payload: MangaUpdatesSearchPayload;
  try {
    payload = JSON.parse(raw) as MangaUpdatesSearchPayload;
  } catch {
    throw new ApiError(
      502,
      "METADATA_RESPONSE_INVALID",
      "MangaUpdates returned an unreadable search response.",
    );
  }
  return (payload.results ?? []).flatMap((result) => {
    const wrapped = result as { record?: MangaUpdatesPayload };
    const entry = wrapped.record ?? (result as MangaUpdatesPayload);
    const idValue = entry.series_id;
    const id =
      typeof idValue === "number" || typeof idValue === "string"
        ? String(idValue)
        : "";
    const title = normalizeString(entry.title);
    const numericIdentifier = mangaUpdatesIdentifierFromProviderId(id);
    const linkedIdentifier = entry.url
      ? mangaUpdatesIdentifierFromUrl(entry.url)
      : null;
    const identifier =
      linkedIdentifier?.providerId === numericIdentifier?.providerId
        ? linkedIdentifier
        : numericIdentifier;
    if (!identifier || !title) return [];
    return [{
      source: "MANGAUPDATES" as const,
      externalId: identifier.externalId,
      sourceUrl: identifier.sourceUrl,
      title,
      status: normalizeString(entry.status) ?? null,
      coverReferenceUrl:
        normalizeString(entry.image?.url?.thumb) ??
        normalizeString(entry.image?.thumb) ??
        normalizeString(entry.image?.url?.original) ??
        normalizeString(entry.image?.original) ??
        null,
    }];
  });
}

async function providerSearchRaw(
  source: "MANGADEX" | "MANGAUPDATES",
  query: string,
  context: ProviderFetchContext,
) {
  if (source === "MANGADEX") {
    const params = new URLSearchParams({
      title: query,
      limit: "5",
      "order[relevance]": "desc",
    });
    params.append("includes[]", "cover_art");
    return fetchWithRetry(
      `https://api.mangadex.org/manga?${params}`,
      {},
      context,
    );
  }
  return fetchWithRetry("https://api.mangaupdates.com/v1/series/search", {
    method: "POST",
    body: JSON.stringify({ search: query, page: 1, perpage: 5 }),
  }, context);
}

async function cachedProviderSearch(
  db: D1Database,
  source: "MANGADEX" | "MANGAUPDATES",
  query: string,
  actorContext: ProviderActorContext,
  refresh = false,
) {
  const normalizedQuery = query.trim().replace(/\s+/gu, " ");
  if (/^https?:\/\//iu.test(normalizedQuery)) {
    throw new ApiError(
      422,
      "METADATA_SEARCH_INVALID",
      `Use an official ${source === "MANGADEX" ? "MangaDex" : "MangaUpdates"} URL, or search by title.`,
    );
  }
  const parsedQuery = metadataSearchSchema.shape.query.parse(normalizedQuery);
  const queryHash = await sha256Hex(
    new TextEncoder().encode(parsedQuery.toLocaleLowerCase("en")),
  );
  const externalId = `search:${queryHash.slice(0, 40)}`;
  const cacheKey = `${source}:${externalId}`;
  let raw = "";
  let cached = false;
  if (!refresh) {
    const cachedRow = await db
      .prepare(
        `SELECT response_json AS responseJson
           FROM metadata_import_cache
          WHERE cache_key = ?
            AND datetime(expires_at) > datetime('now')
          LIMIT 1`,
      )
      .bind(cacheKey)
      .first<{ responseJson: string }>();
    if (cachedRow) {
      raw = cachedRow.responseJson;
      cached = true;
    }
  }
  if (!raw) {
    raw = await providerSearchRaw(source, parsedQuery, {
      db,
      source,
      externalId,
      operation: "SEARCH",
      ...actorContext,
    });
  }
  const results = source === "MANGADEX"
    ? mangaDexSearchResults(raw)
    : mangaUpdatesSearchResults(raw);
  if (!results.length) {
    throw new ApiError(
      404,
      "METADATA_NOT_FOUND",
      `No ${source === "MANGADEX" ? "MangaDex" : "MangaUpdates"} title matched that search.`,
    );
  }
  if (!cached) {
    const responseHash = await sha256Hex(new TextEncoder().encode(raw));
    await db
      .prepare(
        `INSERT INTO metadata_import_cache
         (cache_key, source, external_id, response_json, response_hash,
          fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
                 datetime('now', '+1 hour'))
         ON CONFLICT(cache_key) DO UPDATE SET
           response_json = excluded.response_json,
           response_hash = excluded.response_hash,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
      )
      .bind(cacheKey, source, externalId, raw, responseHash)
      .run();
  }
  return { results, cached, externalId };
}

export async function searchExternalMetadata(
  db: D1Database,
  input: z.infer<typeof metadataSearchSchema>,
  actorContext: ProviderActorContext,
) {
  return cachedProviderSearch(
    db,
    input.source,
    input.query,
    actorContext,
  );
}

export type MetadataPreviewContext = {
  actorUserId: string;
  requestId: string;
  source: "MANGADEX" | "MANGAUPDATES";
  input: string;
  refresh?: boolean;
  seriesId?: string;
  seriesRequestId?: string;
  action: "PREVIEW" | "REQUEST_PREVIEW";
};

export async function previewExternalMetadata(
  db: D1Database,
  context: MetadataPreviewContext,
) {
  let normalized: NormalizedProviderInput | null = null;
  try {
    normalized =
      context.source === "MANGADEX"
        ? normalizeMangaDexInput(context.input)
        : normalizeMangaUpdatesInput(context.input);
  } catch (error) {
    if (/^https?:\/\//iu.test(context.input.trim())) throw error;
  }
  const searchHash = normalized
    ? ""
    : await sha256Hex(
        new TextEncoder().encode(
          context.input.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en"),
        ),
      );
  let attemptedId = normalized?.id ?? `search:${searchHash.slice(0, 40)}`;
  let searchMatches: MetadataSearchResult[] = [];
  const attemptLogId = randomId();
  const reservation = await db
    .prepare(
      `INSERT INTO metadata_import_logs
       (id, actor_user_id, series_id, source, external_id, action, result,
        safe_message, request_id)
       SELECT ?, ?, ?, ?, ?, ?, 'PENDING',
              'Metadata preview reserved.', ?
        WHERE (
          SELECT COUNT(*)
            FROM metadata_import_logs
           WHERE actor_user_id = ?
             AND action IN ('PREVIEW', 'REQUEST_PREVIEW')
             AND created_at >= datetime('now', '-1 hour')
        ) < 30`,
    )
    .bind(
      attemptLogId,
      context.actorUserId,
      context.seriesId ?? null,
      context.source,
      attemptedId,
      context.action,
      context.requestId,
      context.actorUserId,
    )
    .run();
  if (!reservation.meta.changes) {
    throw new ApiError(
      429,
      "IMPORT_RATE_LIMITED",
      "Too many metadata requests. Try again later.",
    );
  }
  try {
    if (!normalized) {
      const match = await cachedProviderSearch(
        db,
        context.source,
        context.input,
        {
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          seriesId: context.seriesId,
        },
        context.refresh,
      );
      searchMatches = match.results;
      const first = match.results[0];
      const mangaUpdatesIdentifier =
        context.source === "MANGAUPDATES"
          ? mangaUpdatesIdentifierFromProviderId(first.externalId)
          : null;
      if (context.source === "MANGAUPDATES" && !mangaUpdatesIdentifier) {
        throw new ApiError(
          502,
          "MANGAUPDATES_RESPONSE_INVALID",
          "MangaUpdates returned an invalid series identifier.",
        );
      }
      normalized = {
        id: first.externalId,
        url: first.sourceUrl,
        providerId:
          context.source === "MANGADEX"
            ? first.externalId
            : mangaUpdatesIdentifier!.providerId,
      };
      attemptedId = normalized.id;
      await db
        .prepare(
          `UPDATE metadata_import_logs
              SET external_id = ?,
                  safe_message = ?
            WHERE id = ?
              AND result = 'PENDING'`,
        )
        .bind(
          normalized.id,
          `Title search matched ${first.title}.`,
          attemptLogId,
        )
        .run();
    }
    const cacheKey = `${context.source}:${normalized.id}`;
    let raw = "";
    let cached = false;
    if (!context.refresh) {
      const cachedRow = await db
        .prepare(
          `SELECT response_json AS responseJson
             FROM metadata_import_cache
            WHERE cache_key = ?
              AND datetime(expires_at) > datetime('now')
            LIMIT 1`,
        )
        .bind(cacheKey)
        .first<{ responseJson: string }>();
      if (cachedRow) {
        raw = cachedRow.responseJson;
        cached = true;
      }
    }
    if (!raw) {
      raw = await fetchWithRetry(
        context.source === "MANGADEX"
          ? `https://api.mangadex.org/manga/${normalized.providerId}?includes%5B%5D=author&includes%5B%5D=artist&includes%5B%5D=cover_art`
          : `https://api.mangaupdates.com/v1/series/${normalized.providerId}`,
        {},
        {
          db,
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          seriesId: context.seriesId,
          source: context.source,
          externalId: normalized.id,
          operation: "DETAIL",
        },
      );
    }
    const responseHash = await sha256Hex(new TextEncoder().encode(raw));
    let providerPayload: MangaDexPayload | MangaUpdatesPayload;
    try {
      providerPayload = JSON.parse(raw) as
        | MangaDexPayload
        | MangaUpdatesPayload;
    } catch {
      throw new ApiError(
        502,
        "METADATA_RESPONSE_INVALID",
        `${context.source === "MANGADEX" ? "MangaDex" : "MangaUpdates"} returned an unreadable metadata response.`,
      );
    }
    const imported =
      context.source === "MANGADEX"
        ? mapMangaDex(
            providerPayload as MangaDexPayload,
            normalized.id,
            normalized.url,
            responseHash,
            cached,
          )
        : mapMangaUpdates(
            providerPayload as MangaUpdatesPayload,
            normalized.id,
            normalized.url,
            responseHash,
            cached,
          );
    if (!cached) {
      await db
        .prepare(
          `INSERT INTO metadata_import_cache
           (cache_key, source, external_id, response_json, response_hash,
            fetched_at, expires_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
                   datetime('now', '+12 hours'))
           ON CONFLICT(cache_key) DO UPDATE SET
             response_json = excluded.response_json,
             response_hash = excluded.response_hash,
             fetched_at = excluded.fetched_at,
             expires_at = excluded.expires_at`,
        )
        .bind(
          cacheKey,
          context.source,
          normalized.id,
          raw,
          responseHash,
        )
        .run();
    }
    await db
      .prepare(
        `DELETE FROM metadata_import_cache
          WHERE datetime(expires_at) <= datetime('now')
            AND datetime(fetched_at) < datetime('now', '-1 day')`,
      )
      .run()
      .catch(() => undefined);
    const externalIdAliases =
      context.source === "MANGAUPDATES"
        ? mangaUpdatesExternalIdAliases(normalized.id, normalized.url)
        : [normalized.id];
    const compatibleExternalId = externalIdAliases[1] ?? normalized.id;
    const [duplicateSeries, duplicateRequest] = await db.batch([
      db
        .prepare(
          `SELECT ses.series_id AS seriesId, s.title, s.slug
             FROM series_external_sources ses
             JOIN series s ON s.id = ses.series_id
            WHERE ses.source = ?
              AND (
                ses.external_id = ?
                OR (? = 'MANGAUPDATES' AND ses.external_id = ?)
              )
              AND (? IS NULL OR ses.series_id <> ?)
            LIMIT 1`,
        )
        .bind(
          context.source,
          normalized.id,
          context.source,
          compatibleExternalId,
          context.seriesId ?? null,
          context.seriesId ?? null,
        ),
      db
        .prepare(
          `SELECT id AS requestId, primary_title AS title, status
             FROM series_requests
            WHERE (
              (? = 'MANGADEX' AND mangadex_id = ?)
              OR
              (? = 'MANGAUPDATES' AND (
                mangaupdates_id = ? OR mangaupdates_id = ?
              ))
            )
              AND status IN (
                'SUBMITTED',
                'UNDER_REVIEW',
                'CHANGES_REQUESTED',
                'APPROVED'
              )
              AND (? IS NULL OR id <> ?)
            ORDER BY submitted_at DESC, id
            LIMIT 1`,
        )
        .bind(
          context.source,
          normalized.id,
          context.source,
          normalized.id,
          compatibleExternalId,
          context.seriesRequestId ?? null,
          context.seriesRequestId ?? null,
        ),
    ]);
    await db
      .prepare(
        `UPDATE metadata_import_logs
            SET result = 'SUCCESS',
                safe_message = ?
          WHERE id = ?
            AND result = 'PENDING'`,
      )
      .bind(
        cached
          ? "Metadata preview loaded from cache."
          : `Metadata preview loaded from ${context.source === "MANGADEX" ? "MangaDex" : "MangaUpdates"}.`,
        attemptLogId,
      )
      .run();
    return {
      data: imported,
      duplicate: duplicateSeries.results[0] ?? null,
      duplicateRequest: duplicateRequest.results[0] ?? null,
      matches: searchMatches,
      attemptedId,
    };
  } catch (error) {
    await db
      .prepare(
        `UPDATE metadata_import_logs
            SET result = 'FAILURE',
                safe_message = ?
          WHERE id = ?
            AND result = 'PENDING'`,
      )
      .bind(
        (
          error instanceof ApiError ? error.message : "Metadata preview failed."
        ).slice(0, 500),
        attemptLogId,
      )
      .run()
      .catch(() => undefined);
    throw error;
  }
}
