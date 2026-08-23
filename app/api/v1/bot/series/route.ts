import { env } from "cloudflare:workers";
import { z } from "zod";
import { normalizedLookupKey } from "@/lib/admin-metadata";
import { ApiError, errorResponse } from "@/lib/server/api";
import { validateImageFile, safeFilename, sha256Hex } from "@/lib/server/admin-utils";
import { newPublicReference, publicReferenceReservationStatement } from "@/lib/server/public-identifiers";
import { randomId } from "@/lib/server/random-id";
import { findNormalizedEquivalent } from "@/lib/server/taxonomy-equivalence";
import { botAudit, botContext, botDatabase, botFailureAudit, botIdempotencyFail, botIdempotencyFinish, botIdempotencyStart, botJson, botRequestId, botTeam, fetchExternalSource } from "@/lib/server/bot-api";

export const dynamic = "force-dynamic";

const seriesSchema = z.object({
  teamId: z.string().trim().min(3).max(160),
  title: z.string().trim().min(2).max(180),
  slug: z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  synopsis: z.string().trim().min(12).max(8_000),
  alternativeTitles: z.array(z.string().trim().min(1).max(180)).max(20).default([]),
  publicationYear: z.coerce.number().int().min(1800).max(2200).nullable().default(null),
  authorNames: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  artistNames: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  publisherName: z.string().trim().min(1).max(120).nullable().default(null),
  type: z.enum(["MANGA", "MANHWA", "MANHUA", "COMIC", "NOVEL"]),
  status: z.enum(["ONGOING", "COMPLETED", "HIATUS", "CANCELLED"]).default("ONGOING"),
  originCountry: z.string().trim().length(2).default("KR"),
  originalLanguage: z.string().trim().min(2).max(12).default("en"),
  readingDirection: z.enum(["LTR", "RTL", "VERTICAL"]).default("LTR"),
  creatorNames: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  genreNames: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  externalSources: z.array(z.object({ provider: z.enum(["MANGADEX", "MANGAUPDATES"]), url: z.string().url().max(600) })).max(2).default([]),
  coverUrl: z.string().url().max(600).nullable().default(null),
});

type SeriesPayload = z.infer<typeof seriesSchema>;

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) return { payload: seriesSchema.parse(await request.json()), cover: null as File | null };
  const form = await request.formData();
  const raw = form.get("metadata");
  if (typeof raw !== "string") throw new ApiError(422, "METADATA_REQUIRED", "Multipart series creation requires a metadata JSON field.");
  const payload = seriesSchema.parse(JSON.parse(raw));
  const cover = form.get("cover");
  return { payload, cover: cover instanceof File && cover.size > 0 ? cover : null };
}

async function coverBytes(cover: File | null, coverUrl: string | null) {
  let file = cover;
  if (!file && coverUrl) {
    const source = await fetchExternalSource(coverUrl);
    if (!["image/jpeg", "image/png", "image/webp"].includes(source.contentType)) throw new ApiError(422, "COVER_SOURCE_INVALID", "The cover source must return a JPEG, PNG, or WebP image.");
    file = new File([source.bytes], "external-cover", { type: source.contentType });
  }
  if (!file) return null;
  const validated = await validateImageFile(file, { label: "series cover", maxBytes: 8_000_000, minWidth: 300, minHeight: 450, maxWidth: 8_000, maxHeight: 10_000, allowAnimation: false, allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]) });
  return { ...validated, filename: safeFilename(file.name), sha256: await sha256Hex(validated.bytes) };
}

export async function GET(request: Request) {
  try {
    const context = await botContext(request, "bot:series:read");
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
    const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
    const requestedTeam = url.searchParams.get("teamId");
    const teamId = requestedTeam ? (await botTeam(context, requestedTeam)).id : context.principal.allowedTeamId;
    const term = `%${query}%`;
    const rows = await botDatabase().prepare(
      `SELECT s.public_ref AS publicRef, s.slug, s.title, s.synopsis, s.type, s.status,
              s.origin_country AS originCountry, s.original_language AS originalLanguage,
              s.reading_direction AS readingDirection, s.is_published AS isPublished,
              t.public_ref AS teamId, t.name AS teamName, s.created_at AS createdAt, s.updated_at AS updatedAt
         FROM series s JOIN series_team_assignments sta ON sta.series_id = s.id
         JOIN teams t ON t.id = sta.team_id
        WHERE (? IS NULL OR sta.team_id = ?)
          AND (? = '' OR LOWER(s.title) LIKE ? OR LOWER(s.public_ref) LIKE ?)
          AND s.archived_at IS NULL
        ORDER BY datetime(s.updated_at) DESC, s.public_ref DESC
        LIMIT ? OFFSET ?`,
    ).bind(teamId, teamId, query, term, term, limit, (page - 1) * limit).all<Record<string, unknown>>();
    return botJson(context, { data: rows.results.map((row) => ({ ...row, isPublished: Boolean(row.isPublished) })), pagination: { page, limit, returned: rows.results.length } });
  } catch (error) { return errorResponse(botRequestId(request), error); }
}

export async function POST(request: Request) {
  let context: Awaited<ReturnType<typeof botContext>> | null = null;
  const endpoint = "POST /api/v1/bot/series";
  let idempotencyKey = "";
  try {
    context = await botContext(request, "bot:series:create");
    const actorId = context.actor.id;
    const parsed = await parseRequest(request);
    const rawCoverUrl = parsed.payload.coverUrl ?? request.headers.get("x-nyascans-cover-url");
    const idem = await botIdempotencyStart(context, endpoint, request.headers.get("Idempotency-Key") ?? "", { ...parsed.payload, coverName: parsed.cover?.name ?? null, coverSize: parsed.cover?.size ?? 0, coverUrl: rawCoverUrl });
    idempotencyKey = idem.key;
    if (idem.replay) return botJson(context, idem.replay);
    const team = await botTeam(context, parsed.payload.teamId);
    const duplicate = await botDatabase().prepare("SELECT 1 FROM series WHERE slug = ? LIMIT 1").bind(parsed.payload.slug).first();
    if (duplicate) throw new ApiError(409, "SERIES_SLUG_EXISTS", "A series already uses this slug.");
    const creatorRefs: Array<{ id: string; role: "AUTHOR" | "ARTIST" }> = [];
    for (const [role, names] of [["AUTHOR", parsed.payload.authorNames], ["ARTIST", parsed.payload.artistNames], ["AUTHOR", parsed.payload.creatorNames]] as const) {
      for (const name of names) {
        const creator = await findNormalizedEquivalent(botDatabase(), "creators", normalizedLookupKey(name), normalizedLookupKey);
        if (!creator) throw new ApiError(422, "CREATOR_NOT_FOUND", `Creator is not in the active taxonomy: ${name}`);
        creatorRefs.push({ id: creator.id, role });
      }
    }
    let publisherId: string | null = null;
    if (parsed.payload.publisherName) {
      const publisher = await findNormalizedEquivalent(botDatabase(), "publishers", normalizedLookupKey(parsed.payload.publisherName), normalizedLookupKey);
      if (!publisher) throw new ApiError(422, "PUBLISHER_NOT_FOUND", `Publisher is not in the active taxonomy: ${parsed.payload.publisherName}`);
      publisherId = publisher.id;
    }
    const genreIds: string[] = [];
    for (const name of parsed.payload.genreNames) {
      const genre = await findNormalizedEquivalent(botDatabase(), "genres", normalizedLookupKey(name), normalizedLookupKey);
      if (!genre) throw new ApiError(422, "GENRE_NOT_FOUND", `Genre is not in the active taxonomy: ${name}`);
      genreIds.push(genre.id);
    }
    const cover = await coverBytes(parsed.cover, rawCoverUrl);
    const seriesId = `bot_series_${randomId()}`;
    const publicRef = newPublicReference("SERIES");
    let coverKey: string | null = null;
    if (cover) {
      if (!env.BUCKET) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Series cover storage is unavailable.");
      const extension = cover.contentType === "image/jpeg" ? "jpg" : cover.contentType === "image/png" ? "png" : "webp";
      coverKey = `private/series-covers/${seriesId}/${randomId()}.${extension}`;
      await env.BUCKET.put(coverKey, cover.bytes, { httpMetadata: { contentType: cover.contentType }, customMetadata: { actorId: context.actor.id, seriesId, source: "BOT_API" } });
    }
    const response = { data: { id: publicRef, publicRef, slug: parsed.payload.slug, title: parsed.payload.title, teamId: team.publicRef, state: "DRAFT", reviewRequired: true, coverAttached: Boolean(coverKey) } };
    await botDatabase().batch([
      botDatabase().prepare(`INSERT INTO series (id, public_ref, slug, title, native_title, synopsis, type, status, origin_country, original_language, reading_direction, publication_year, publisher_id, access_type, cover_key, rights_status, is_published, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FREE', ?, 'AUTHORIZED', 0, 1)`).bind(seriesId, publicRef, parsed.payload.slug, parsed.payload.title, parsed.payload.alternativeTitles[0] ?? null, parsed.payload.synopsis, parsed.payload.type, parsed.payload.status, parsed.payload.originCountry.toUpperCase(), parsed.payload.originalLanguage.toLowerCase(), parsed.payload.readingDirection, parsed.payload.publicationYear, publisherId, coverKey),
      publicReferenceReservationStatement(botDatabase(), "SERIES", publicRef, seriesId),
      botDatabase().prepare(`INSERT INTO series_team_assignments (series_id, team_id, can_upload, can_publish, is_primary, assigned_by_user_id) VALUES (?, ?, 1, 0, 1, ?)`).bind(seriesId, team.id, context.actor.id),
      ...creatorRefs.map((creator, sortOrder) => botDatabase().prepare("INSERT INTO series_creators (series_id, creator_id, role, sort_order) VALUES (?, ?, ?, ?)").bind(seriesId, creator.id, creator.role, sortOrder)),
      ...genreIds.map((genreId) => botDatabase().prepare("INSERT INTO series_genres (series_id, genre_id) VALUES (?, ?)").bind(seriesId, genreId)),
      ...parsed.payload.alternativeTitles.slice(1).map((title) => botDatabase().prepare("INSERT INTO series_aliases (series_id, alias, normalized_alias, language) VALUES (?, ?, ?, ?)").bind(seriesId, title, normalizedLookupKey(title), parsed.payload.originalLanguage.toLowerCase())),
      ...parsed.payload.externalSources.map((source) => botDatabase().prepare("INSERT INTO series_external_sources (id, series_id, source, external_id, source_url, last_imported_by_user_id) VALUES (?, ?, ?, ?, ?, ?)").bind(randomId(), seriesId, source.provider, source.url, source.url, actorId)),
      botAudit(context, { action: "bot.series.create", targetType: "SERIES", targetId: publicRef, targetLabel: parsed.payload.title, metadata: { teamId: team.publicRef, slug: parsed.payload.slug, coverSha256: cover?.sha256 ?? null, creatorCount: creatorRefs.length, genreCount: parsed.payload.genreNames.length, publisherId, alternativeTitleCount: parsed.payload.alternativeTitles.length } }),
    ]);
    await botIdempotencyFinish(context, endpoint, idempotencyKey, response, [publicRef]);
    return botJson(context, response, { status: 201 });
  } catch (error) {
    if (context && idempotencyKey) await botIdempotencyFail(context, endpoint, idempotencyKey, error);
    if (context) await botFailureAudit(context, endpoint, error);
    return errorResponse(botRequestId(request), error);
  }
}
