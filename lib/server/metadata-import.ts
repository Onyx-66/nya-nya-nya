import { z } from "zod";
import {
  canonicalLanguageCode,
  normalizedLookupKey,
  type CountryCode,
  type ImportedSeriesMetadata,
  type LanguageCode,
} from "@/lib/admin-metadata";
import { ApiError } from "@/lib/server/api";
import { sha256Hex } from "@/lib/server/admin-utils";
import { randomId } from "@/lib/server/random-id";

export const metadataPreviewSchema = z.object({
  source: z.enum(["MANGADEX", "MANGAUPDATES"]),
  input: z.string().trim().min(1).max(1_000),
  refresh: z.boolean().default(false),
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

export function normalizeMangaDexInput(value: string) {
  const trimmed = value.trim();
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) {
    const id = mangaDexIdSchema.parse(trimmed.toLowerCase());
    return { id, url: `https://mangadex.org/title/${id}` };
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
  return { id, url: `https://mangadex.org/title/${id}` };
}

export function normalizeMangaUpdatesInput(value: string) {
  const trimmed = value.trim();
  if (/^\d{1,12}$/.test(trimmed)) {
    return {
      id: trimmed,
      url: `https://www.mangaupdates.com/series/${trimmed}`,
    };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ApiError(
      422,
      "MANGAUPDATES_INPUT_INVALID",
      "Enter a MangaUpdates series URL or numeric ID.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !["mangaupdates.com", "www.mangaupdates.com"].includes(url.hostname)
  ) {
    throw new ApiError(
      422,
      "MANGAUPDATES_INPUT_INVALID",
      "Use an official MangaUpdates series URL.",
    );
  }
  const token =
    url.searchParams.get("id") ??
    url.pathname.split("/").filter(Boolean).at(-1) ??
    "";
  let id = token;
  if (!/^\d{1,12}$/.test(id) && /^[a-z0-9]+$/i.test(id)) {
    const numeric = Number.parseInt(id, 36);
    id = Number.isSafeInteger(numeric) ? String(numeric) : "";
  }
  if (!/^\d{1,12}$/.test(id)) {
    throw new ApiError(
      422,
      "MANGAUPDATES_INPUT_INVALID",
      "Enter a MangaUpdates series URL or numeric ID.",
    );
  }
  return { id, url: `https://www.mangaupdates.com/series/${token || id}` };
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
    "ONGOING" | "COMPLETED" | "HIATUS" | "PAUSED" | "UPCOMING"
  > = {
    ongoing: "ONGOING",
    completed: "COMPLETED",
    hiatus: "HIATUS",
    cancelled: "PAUSED",
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
          ? ("PAUSED" as const)
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
    sourceUrl: normalizeString(payload.url) ?? sourceUrl,
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

async function fetchWithRetry(url: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "NyaScans-Metadata/1.2",
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
      return await response.text();
    } catch (error) {
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
  const normalized =
    context.source === "MANGADEX"
      ? normalizeMangaDexInput(context.input)
      : normalizeMangaUpdatesInput(context.input);
  const attemptedId = normalized.id;
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
          ? `https://api.mangadex.org/manga/${normalized.id}?includes%5B%5D=author&includes%5B%5D=artist&includes%5B%5D=cover_art`
          : `https://api.mangaupdates.com/v1/series/${normalized.id}`,
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
    const [duplicateSeries, duplicateRequest] = await db.batch([
      db
        .prepare(
          `SELECT ses.series_id AS seriesId, s.title, s.slug
             FROM series_external_sources ses
             JOIN series s ON s.id = ses.series_id
            WHERE ses.source = ?
              AND ses.external_id = ?
              AND (? IS NULL OR ses.series_id <> ?)
            LIMIT 1`,
        )
        .bind(
          context.source,
          normalized.id,
          context.seriesId ?? null,
          context.seriesId ?? null,
        ),
      db
        .prepare(
          `SELECT id AS requestId, primary_title AS title, status
             FROM series_requests
            WHERE mangadex_id = ?
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
          context.source === "MANGADEX"
            ? normalized.id
            : `unsupported:${normalized.id}`,
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
