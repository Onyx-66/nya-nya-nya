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
  type?: string;
  attributes?: { name?: string };
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
    "ONGOING" | "COMPLETED" | "HIATUS" | "UPCOMING"
  > = {
    ongoing: "ONGOING",
    completed: "COMPLETED",
    hiatus: "HIATUS",
    cancelled: "COMPLETED",
  };
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
      coverReferenceUrl: null,
    },
  };
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
      : null;
  const attemptedId =
    normalized?.id ||
    context.input.replace(/\D+/g, "").slice(0, 160) ||
    "invalid";
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
    if (context.source === "MANGAUPDATES") {
      throw new ApiError(
        501,
        "MANGAUPDATES_PROVIDER_NOT_CONFIGURED",
        "MangaUpdates import is unavailable because no stable permitted provider interface is configured. Manual metadata entry remains available.",
      );
    }
    if (!normalized) {
      throw new ApiError(
        422,
        "METADATA_SOURCE_INVALID",
        "Choose a supported metadata source.",
      );
    }
    const cacheKey = `MANGADEX:${normalized.id}`;
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
        `https://api.mangadex.org/manga/${normalized.id}?includes%5B%5D=author&includes%5B%5D=artist&includes%5B%5D=cover_art`,
      );
    }
    const responseHash = await sha256Hex(new TextEncoder().encode(raw));
    let providerPayload: MangaDexPayload;
    try {
      providerPayload = JSON.parse(raw) as MangaDexPayload;
    } catch {
      throw new ApiError(
        502,
        "MANGADEX_RESPONSE_INVALID",
        "MangaDex returned an unreadable metadata response.",
      );
    }
    const imported = mapMangaDex(
      providerPayload,
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
           VALUES (?, 'MANGADEX', ?, ?, ?, CURRENT_TIMESTAMP,
                   datetime('now', '+12 hours'))
           ON CONFLICT(cache_key) DO UPDATE SET
             response_json = excluded.response_json,
             response_hash = excluded.response_hash,
             fetched_at = excluded.fetched_at,
             expires_at = excluded.expires_at`,
        )
        .bind(cacheKey, normalized.id, raw, responseHash)
        .run();
    }
    const [duplicateSeries, duplicateRequest] = await db.batch([
      db
        .prepare(
          `SELECT ses.series_id AS seriesId, s.title, s.slug
             FROM series_external_sources ses
             JOIN series s ON s.id = ses.series_id
            WHERE ses.source = 'MANGADEX'
              AND ses.external_id = ?
              AND (? IS NULL OR ses.series_id <> ?)
            LIMIT 1`,
        )
        .bind(
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
          normalized.id,
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
          : "Metadata preview loaded from MangaDex.",
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
