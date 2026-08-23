import { z } from "zod";
import { errorResponse, ApiError } from "@/lib/server/api";
import { newPublicReference } from "@/lib/server/public-identifiers";
import { randomId } from "@/lib/server/random-id";
import { assertSafeExternalUrl, botAudit, botContext, botDatabase, botFailureAudit, botIdempotencyFail, botIdempotencyFinish, botIdempotencyStart, botJson, botRequestId, botTeam } from "@/lib/server/bot-api";

export const dynamic = "force-dynamic";

const rangeSchema = z.object({ start: z.coerce.number().int().min(0).max(100_000), end: z.coerce.number().int().min(0).max(100_000) }).refine((value) => value.end >= value.start && value.end - value.start < 25, "The chapter range must contain between 1 and 25 chapters.");
const bulkSchema = z.object({
  teamId: z.string().trim().min(3).max(160),
  seriesId: z.string().trim().min(3).max(160),
  sourceUrl: z.string().url().max(600),
  chapterRange: rangeSchema,
  paidRange: rangeSchema.extend({ priceOnyx: z.coerce.number().int().positive().max(1_000_000) }).nullable().default(null),
  language: z.string().trim().min(2).max(12).default("en"),
  version: z.coerce.number().int().min(1).max(99).default(1),
  titlePrefix: z.string().trim().max(120).default(""),
}).superRefine((value, context) => {
  if (value.paidRange && (value.paidRange.start < value.chapterRange.start || value.paidRange.end > value.chapterRange.end)) context.addIssue({ code: "custom", path: ["paidRange"], message: "The paid range must be inside chapterRange." });
});

export async function POST(request: Request) {
  let context: Awaited<ReturnType<typeof botContext>> | null = null;
  const endpoint = "POST /api/v1/bot/chapters/bulk";
  let key = "";
  try {
    context = await botContext(request, "bot:chapter:create");
    const payload = bulkSchema.parse(await request.json());
    assertSafeExternalUrl(payload.sourceUrl);
    const idem = await botIdempotencyStart(context, endpoint, request.headers.get("Idempotency-Key") ?? "", payload);
    key = idem.key;
    if (idem.replay) return botJson(context, idem.replay);
    const team = await botTeam(context, payload.teamId);
    const series = await botDatabase().prepare("SELECT id, public_ref AS publicRef, title FROM series WHERE public_ref = ? AND archived_at IS NULL LIMIT 1").bind(payload.seriesId).first<{ id: string; publicRef: string; title: string }>();
    if (!series) throw new ApiError(404, "SERIES_NOT_FOUND", "The requested SR series reference does not exist.");
    const assigned = await botDatabase().prepare("SELECT 1 FROM series_team_assignments WHERE series_id = ? AND team_id = ? AND can_upload = 1 LIMIT 1").bind(series.id, team.id).first();
    if (!assigned) throw new ApiError(403, "SERIES_TEAM_SCOPE_REQUIRED", "This team is not assigned upload rights for the requested series.");
    const operations = Array.from({ length: payload.chapterRange.end - payload.chapterRange.start + 1 }, (_, index) => {
      const chapterNumber = String(payload.chapterRange.start + index);
      const paid = payload.paidRange && Number(chapterNumber) >= payload.paidRange.start && Number(chapterNumber) <= payload.paidRange.end;
      return { operationId: `bot_op_${randomId()}`, uploadJobId: `bot_job_${randomId()}`, chapterId: newPublicReference("CHAPTER"), chapterNumber, accessType: paid ? "PAID" : "FREE", priceOnyx: paid ? payload.paidRange!.priceOnyx : 0 };
    });
    const db = botDatabase();
    const statements: D1PreparedStatement[] = [];
    for (const [index, chapter] of operations.entries()) {
      const itemId = `bot_item_${randomId()}`;
      statements.push(
        db.prepare(`INSERT INTO upload_jobs (id, user_id, team_id, series_id, kind, source_type, source_url, status, idempotency_key, revision, expires_at) VALUES (?, ?, ?, ?, 'SINGLE', 'DIRECT_FOLDER', ?, 'DRAFT', ?, 1, datetime('now', '+14 days'))`).bind(chapter.uploadJobId, context.actor.id, team.id, series.id, payload.sourceUrl, `bot:${context.actor.id}:${key}:${index}`),
        db.prepare(`INSERT INTO upload_job_items (id, job_id, client_key, source_label, series_id, team_id, chapter_number, title, language, version, access_type, price_onyx, status, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1)`).bind(itemId, chapter.uploadJobId, `${key}:${index}`, `${payload.sourceUrl}#chapter-${chapter.chapterNumber}`, series.id, team.id, chapter.chapterNumber, payload.titlePrefix ? `${payload.titlePrefix} ${chapter.chapterNumber}` : "", payload.language.toLowerCase(), payload.version, chapter.accessType, chapter.priceOnyx),
        db.prepare("INSERT INTO public_identifier_reservations (public_ref, entity_type, entity_id) VALUES (?, 'CHAPTER', ?)").bind(chapter.chapterId, itemId),
        db.prepare(`INSERT INTO bot_operations (id, actor_user_id, team_id, kind, status, job_id, idempotency_key, request_json) VALUES (?, ?, ?, 'CHAPTER_BULK_CREATE', 'PROCESSING', ?, ?, ?)`).bind(chapter.operationId, context.actor.id, team.id, chapter.uploadJobId, key, JSON.stringify({ chapterId: chapter.chapterId, chapterNumber: chapter.chapterNumber, accessType: chapter.accessType, priceOnyx: chapter.priceOnyx, sourceUrl: payload.sourceUrl, seriesId: series.publicRef, teamId: team.publicRef })),
      );
    }
    statements.push(botAudit(context, { action: "bot.chapter.bulk.create", targetType: "SERIES", targetId: series.publicRef, targetLabel: series.title, metadata: { teamId: team.publicRef, sourceUrl: payload.sourceUrl, chapterRange: payload.chapterRange, paidRange: payload.paidRange, operationIds: operations.map((item) => item.operationId) } }));
    await db.batch(statements);
    const response = { data: { state: "PROCESSING", seriesId: series.publicRef, teamId: team.publicRef, sourceUrl: payload.sourceUrl, chapterRange: payload.chapterRange, paidRange: payload.paidRange, operations } };
    await botIdempotencyFinish(context, endpoint, key, response, operations.flatMap((operation) => [operation.chapterId, operation.operationId, operation.uploadJobId]));
    return botJson(context, response, { status: 202 });
  } catch (error) {
    if (context && key) await botIdempotencyFail(context, endpoint, key, error);
    if (context) await botFailureAudit(context, endpoint, error);
    return errorResponse(botRequestId(request), error);
  }
}
