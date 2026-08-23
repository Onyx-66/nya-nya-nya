import { env } from "cloudflare:workers";
import { z } from "zod";
import { unzipSync } from "fflate";
import { errorResponse, ApiError } from "@/lib/server/api";
import { validateChapterPage, privatePageObjectKey } from "@/lib/server/upload-jobs";
import { newPublicReference } from "@/lib/server/public-identifiers";
import { randomId } from "@/lib/server/random-id";
import { botAudit, botContext, botDatabase, botFailureAudit, botIdempotencyFail, botIdempotencyFinish, botIdempotencyStart, botJson, botRequestId, botTeam, fetchExternalSource } from "@/lib/server/bot-api";

export const dynamic = "force-dynamic";

const metadataSchema = z.object({
  teamId: z.string().trim().min(3).max(160),
  seriesId: z.string().trim().min(3).max(160),
  chapterNumber: z.string().trim().min(1).max(40),
  title: z.string().trim().max(240).default(""),
  language: z.string().trim().min(2).max(12).default("en"),
  version: z.coerce.number().int().min(1).max(99).default(1),
  volume: z.string().trim().max(40).nullable().default(null),
  accessType: z.enum(["FREE", "PAID"]).default("FREE"),
  priceOnyx: z.coerce.number().int().min(0).max(1_000_000).default(0),
  commentsEnabled: z.boolean().default(true),
  sourceUrl: z.string().url().max(600).nullable().default(null),
}).superRefine((value, context) => {
  if (value.accessType === "FREE" && value.priceOnyx !== 0) context.addIssue({ code: "custom", path: ["priceOnyx"], message: "Free chapters must have a zero price." });
  if (value.accessType === "PAID" && value.priceOnyx <= 0) context.addIssue({ code: "custom", path: ["priceOnyx"], message: "Paid chapters must have a positive price." });
});

type PageInput = { file: File; sourcePath: string };

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    const body = await request.json() as Record<string, unknown>;
    return { metadata: metadataSchema.parse(body), pages: [] as PageInput[], archive: null as File | null };
  }
  const form = await request.formData();
  const raw = form.get("metadata");
  if (typeof raw !== "string") throw new ApiError(422, "METADATA_REQUIRED", "Multipart chapter creation requires a metadata JSON field.");
  const metadata = metadataSchema.parse(JSON.parse(raw));
  const pages = form.getAll("pages").flatMap((value, index) => value instanceof File && value.size > 0 ? [{ file: value, sourcePath: value.name || `page-${index + 1}` }] : []);
  const archive = form.get("archive");
  const attachedArchive = archive instanceof File && archive.size > 0 ? archive : null;
  if (pages.length && (metadata.sourceUrl || attachedArchive)) throw new ApiError(422, "SOURCE_EXACTLY_ONE", "Provide exactly one source: pages, archive, or sourceUrl.");
  if (metadata.sourceUrl && attachedArchive) throw new ApiError(422, "SOURCE_EXACTLY_ONE", "Provide exactly one source: archive or sourceUrl.");
  return { metadata, pages, archive: attachedArchive };
}

async function archivePages(archive: File) {
  const bytes = new Uint8Array(await archive.arrayBuffer());
  if (bytes.byteLength > 250 * 1024 * 1024) throw new ApiError(413, "SOURCE_TOO_LARGE", "The attached archive exceeds the upload size limit.");
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes); } catch { throw new ApiError(422, "SOURCE_ARCHIVE_INVALID", "The attached ZIP/CBZ source could not be safely extracted."); }
  const pageEntries = Object.entries(entries).filter(([name, value]) => value.byteLength > 0 && /\.(?:jpe?g|png|webp)$/iu.test(name)).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  if (!pageEntries.length) throw new ApiError(422, "SOURCE_ARCHIVE_EMPTY", "The attached ZIP/CBZ source contains no supported image pages.");
  if (pageEntries.length > 500) throw new ApiError(422, "SOURCE_ARCHIVE_FILE_LIMIT", "The attached ZIP/CBZ source contains more than 500 image pages.");
  const totalBytes = pageEntries.reduce((sum, [, value]) => sum + value.byteLength, 0);
  if (totalBytes > 250 * 1024 * 1024 || totalBytes > Math.max(bytes.byteLength * 30, 10 * 1024 * 1024)) throw new ApiError(413, "SOURCE_ARCHIVE_RATIO_LIMIT", "The attached ZIP/CBZ compression ratio or extracted size exceeds the safe limit.");
  return pageEntries.map(([name, value], index) => {
    const normalized = name.replaceAll("\\\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..") || normalized.split("/").some((part) => part.startsWith("."))) throw new ApiError(422, "SOURCE_ARCHIVE_PATH_INVALID", "The attached ZIP/CBZ source contains an unsafe page path.");
    const type = /\.png$/iu.test(normalized) ? "image/png" : /\.webp$/iu.test(normalized) ? "image/webp" : "image/jpeg";
    return { file: new File([value.slice().buffer as ArrayBuffer], normalized.split("/").at(-1) || `page-${index + 1}`, { type }), sourcePath: `${archive.name}#${normalized}` };
  });
}

async function externalPages(sourceUrl: string) {
  const source = await fetchExternalSource(sourceUrl);
  if (["image/jpeg", "image/png", "image/webp"].includes(source.contentType)) {
    return [{ file: new File([source.bytes], "external-page", { type: source.contentType }), sourcePath: source.url }];
  }
  const lowerUrl = source.url.toLowerCase();
  const isZip = source.contentType === "application/zip" || source.contentType === "application/x-cbz" || lowerUrl.endsWith(".zip") || lowerUrl.endsWith(".cbz");
  if (isZip) {
    let entries: Record<string, Uint8Array>;
    try { entries = unzipSync(source.bytes); } catch { throw new ApiError(422, "SOURCE_ARCHIVE_INVALID", "The ZIP/CBZ source could not be safely extracted."); }
    const pageEntries = Object.entries(entries)
      .filter(([name, bytes]) => bytes.byteLength > 0 && /\.(?:jpe?g|png|webp)$/iu.test(name))
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
    if (!pageEntries.length) throw new ApiError(422, "SOURCE_ARCHIVE_EMPTY", "The ZIP/CBZ source contains no supported image pages.");
    if (pageEntries.length > 500) throw new ApiError(422, "SOURCE_ARCHIVE_FILE_LIMIT", "The ZIP/CBZ source contains more than 500 image pages.");
    const totalBytes = pageEntries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
    if (totalBytes > 250 * 1024 * 1024 || totalBytes > Math.max(source.bytes.byteLength * 30, 10 * 1024 * 1024)) throw new ApiError(413, "SOURCE_ARCHIVE_RATIO_LIMIT", "The ZIP/CBZ compression ratio or extracted size exceeds the safe limit.");
    return pageEntries.map(([name, bytes], index) => {
      const normalized = name.replaceAll("\\\\", "/");
      if (normalized.startsWith("/") || normalized.split("/").includes("..") || normalized.split("/").some((part) => part.startsWith("."))) throw new ApiError(422, "SOURCE_ARCHIVE_PATH_INVALID", "The ZIP/CBZ source contains an unsafe page path.");
      const type = /\.png$/iu.test(normalized) ? "image/png" : /\.webp$/iu.test(normalized) ? "image/webp" : "image/jpeg";
      return { file: new File([bytes.slice().buffer as ArrayBuffer], normalized.split("/").at(-1) || `page-${index + 1}`, { type }), sourcePath: `${source.url}#${normalized}` };
    });
  }
  if (source.contentType.includes("rar") || lowerUrl.endsWith(".rar")) throw new ApiError(422, "SOURCE_RAR_UNSUPPORTED", "RAR sources are rejected because this deployment has no audited RAR extraction worker.");
  if (source.contentType !== "application/json") throw new ApiError(422, "SOURCE_FORMAT_UNSUPPORTED", "This bounded resolver accepts direct images, JSON page manifests, or safe ZIP/CBZ archives.");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(source.bytes)); } catch { throw new ApiError(422, "SOURCE_MANIFEST_INVALID", "The external JSON page manifest is invalid."); }
  const urls = z.array(z.string().url().max(600)).min(1).max(500).parse((parsed && typeof parsed === "object" && "pages" in parsed) ? (parsed as { pages?: unknown }).pages : parsed);
  const pages: PageInput[] = [];
  for (const [index, url] of urls.entries()) {
    const page = await fetchExternalSource(url);
    if (!["image/jpeg", "image/png", "image/webp"].includes(page.contentType)) throw new ApiError(422, "SOURCE_PAGE_INVALID", `External page ${index + 1} is not a JPEG, PNG, or WebP image.`);
    pages.push({ file: new File([page.bytes], `page-${String(index + 1).padStart(4, "0")}`, { type: page.contentType }), sourcePath: page.url });
  }
  return pages;
}

export async function POST(request: Request) {
  let context: Awaited<ReturnType<typeof botContext>> | null = null;
  const endpoint = "POST /api/v1/bot/chapters";
  let idempotencyKey = "";
  try {
    context = await botContext(request, "bot:chapter:create");
    const parsed = await parseRequest(request);
    const idem = await botIdempotencyStart(context, endpoint, request.headers.get("Idempotency-Key") ?? "", { metadata: parsed.metadata, pages: parsed.pages.map(({ file, sourcePath }) => ({ name: file.name, size: file.size, sourcePath })), archive: parsed.archive ? { name: parsed.archive.name, size: parsed.archive.size } : null });
    idempotencyKey = idem.key;
    if (idem.replay) return botJson(context, idem.replay);
    const team = await botTeam(context, parsed.metadata.teamId);
    const series = await botDatabase().prepare("SELECT id, public_ref AS publicRef, title FROM series WHERE public_ref = ? AND archived_at IS NULL LIMIT 1").bind(parsed.metadata.seriesId).first<{ id: string; publicRef: string; title: string }>();
    if (!series) throw new ApiError(404, "SERIES_NOT_FOUND", "The requested SR series reference does not exist.");
    const assigned = await botDatabase().prepare("SELECT 1 FROM series_team_assignments WHERE series_id = ? AND team_id = ? AND can_upload = 1 LIMIT 1").bind(series.id, team.id).first();
    if (!assigned) throw new ApiError(403, "SERIES_TEAM_SCOPE_REQUIRED", "This team is not assigned upload rights for the requested series.");
    let pages = parsed.pages;
    if (!pages.length && parsed.archive) pages = await archivePages(parsed.archive);
    if (!pages.length && parsed.metadata.sourceUrl) pages = await externalPages(parsed.metadata.sourceUrl);
    if (!pages.length) throw new ApiError(422, "PAGES_REQUIRED", "Provide multipart pages, an attached ZIP/CBZ archive, or a supported HTTPS sourceUrl.");
    if (pages.length > 500) throw new ApiError(422, "PAGE_LIMIT_EXCEEDED", "A Bot chapter may contain at most 500 pages.");
    if (!env.BUCKET) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Chapter storage is unavailable.");
    const jobId = `bot_job_${randomId()}`;
    const itemId = `bot_item_${randomId()}`;
    const chapterRef = newPublicReference("CHAPTER");
    const normalizedSource = parsed.metadata.sourceUrl ?? (parsed.archive ? `ATTACHED:${parsed.archive.name}` : "BOT_ATTACHMENT");
    const validated: Array<{ objectKey: string; filename: string; sourcePath: string; contentType: string; byteSize: number; pageIndex: number; sha256: string; width: number; height: number; validationJson: string; bytes: Uint8Array }> = [];
    let totalBytes = 0;
    for (const [index, page] of pages.entries()) {
      const item = await validateChapterPage(page.file, page.sourcePath);
      totalBytes += item.bytes.byteLength;
      if (totalBytes > 250 * 1024 * 1024) throw new ApiError(413, "CHAPTER_TOO_LARGE", "A Bot chapter may contain at most 250 MB of page data.");
      const objectKey = privatePageObjectKey(context.actor.id, jobId, itemId, randomId());
      await env.BUCKET.put(objectKey, item.bytes, { httpMetadata: { contentType: item.contentType }, customMetadata: { actorId: context.actor.id, uploadJobId: jobId, uploadJobItemId: itemId, source: "BOT_API" } });
      validated.push({ objectKey, filename: item.filename, sourcePath: item.normalizedPath, contentType: item.contentType, byteSize: item.bytes.byteLength, pageIndex: index, sha256: item.sha256, width: item.dimensions.width, height: item.dimensions.height, validationJson: JSON.stringify({ dimensions: item.dimensions, source: "BOT_API" }), bytes: item.bytes });
    }
    const operationId = `bot_op_${randomId()}`;
    const response = { data: { operationId, uploadJobId: jobId, chapterId: chapterRef, publicRef: chapterRef, seriesId: series.publicRef, teamId: team.publicRef, chapterNumber: parsed.metadata.chapterNumber, state: "READY_FOR_REVIEW", pageCount: validated.length, totalBytes } };
    const db = botDatabase();
    const statements = [
      db.prepare(`INSERT INTO upload_jobs (id, user_id, team_id, series_id, kind, source_type, source_url, status, idempotency_key, total_bytes, page_count, revision, expires_at, completed_at) VALUES (?, ?, ?, ?, 'SINGLE', ?, ?, 'READY', ?, ?, ?, 1, datetime('now', '+14 days'), CURRENT_TIMESTAMP)`).bind(jobId, context.actor.id, team.id, series.id, parsed.metadata.sourceUrl ? "DIRECT_IMAGES" : "DIRECT_IMAGES", parsed.metadata.sourceUrl, `bot:${context.actor.id}:${idempotencyKey}`, totalBytes, validated.length),
      db.prepare(`INSERT INTO upload_job_items (id, job_id, client_key, source_label, series_id, team_id, volume, chapter_number, title, language, version, access_type, price_onyx, comments_enabled, status, page_count, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?, 1)`).bind(itemId, jobId, idempotencyKey, normalizedSource, series.id, team.id, parsed.metadata.volume, parsed.metadata.chapterNumber, parsed.metadata.title, parsed.metadata.language.toLowerCase(), parsed.metadata.version, parsed.metadata.accessType, parsed.metadata.priceOnyx, parsed.metadata.commentsEnabled ? 1 : 0, validated.length),
      db.prepare(`INSERT INTO public_identifier_reservations (public_ref, entity_type, entity_id) VALUES (?, 'CHAPTER', ?)`).bind(chapterRef, itemId),
      db.prepare(`INSERT INTO bot_operations (id, actor_user_id, team_id, kind, status, job_id, idempotency_key, request_json, result_json, completed_at) VALUES (?, ?, ?, 'CHAPTER_CREATE', 'SUCCEEDED', ?, ?, ?, ?, CURRENT_TIMESTAMP)`).bind(operationId, context.actor.id, team.id, jobId, idempotencyKey, JSON.stringify({ seriesId: series.publicRef, teamId: team.publicRef, chapterNumber: parsed.metadata.chapterNumber, sourceUrl: parsed.metadata.sourceUrl }), JSON.stringify(response)),
      botAudit(context, { action: "bot.chapter.create", targetType: "CHAPTER", targetId: chapterRef, targetLabel: `${series.title} · ${parsed.metadata.chapterNumber}`, metadata: { operationId, uploadJobId: jobId, teamId: team.publicRef, seriesId: series.publicRef, pageCount: validated.length, totalBytes, sourceType: parsed.metadata.sourceUrl ? "URL" : "ATTACHMENT" } }),
    ];
    for (const page of validated) statements.push(db.prepare(`INSERT INTO upload_sessions (id, user_id, team_id, upload_job_id, upload_job_item_id, object_key, filename, source_path, content_type, byte_size, page_index, sha256, width, height, expires_at, status, validation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+14 days'), 'READY', ?)`).bind(`bot_session_${randomId()}`, context.actor.id, team.id, jobId, itemId, page.objectKey, page.filename, page.sourcePath, page.contentType, page.byteSize, page.pageIndex, page.sha256, page.width, page.height, page.validationJson));
    await db.batch(statements);
    await botIdempotencyFinish(context, endpoint, idempotencyKey, response, [chapterRef, operationId, jobId]);
    return botJson(context, response, { status: 201 });
  } catch (error) {
    if (context && idempotencyKey) await botIdempotencyFail(context, endpoint, idempotencyKey, error);
    if (context) await botFailureAudit(context, endpoint, error);
    return errorResponse(botRequestId(request), error);
  }
}
