import { z } from "zod";
import { errorResponse } from "@/lib/server/api";
import { botContext, botDatabase, botJson, botRequestId } from "@/lib/server/bot-api";
import { resolvePublicReferenceOrNull } from "@/lib/server/public-identifiers";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ chapterId: z.string().trim().min(3).max(160) });

export async function GET(request: Request, context: { params: Promise<{ chapterId: string }> }) {
  try {
    const auth = await botContext(request, "bot:chapter:read");
    const params = paramsSchema.parse(await context.params);
    const resolved = await resolvePublicReferenceOrNull(botDatabase(), "CHAPTER", params.chapterId);
    if (!resolved) return botJson(auth, { error: { code: "CHAPTER_NOT_FOUND", message: "The requested CH reference does not exist." } }, { status: 404 });
    const chapter = await botDatabase().prepare(
      `SELECT c.public_ref AS publicRef, c.chapter_number AS chapterNumber, c.title,
              c.language, c.version, c.state, c.access_type AS accessType,
              c.page_count AS pageCount, c.created_at AS createdAt, c.published_at AS publishedAt,
              s.public_ref AS seriesId, s.title AS seriesTitle,
              t.public_ref AS teamId, t.name AS teamName
         FROM chapters c JOIN series s ON s.id = c.series_id
         LEFT JOIN teams t ON t.id = c.team_id
        WHERE c.id = ? LIMIT 1`,
    ).bind(resolved.entityId).first<Record<string, unknown>>();
    if (chapter) return botJson(auth, { data: { ...chapter, reserved: false } });
    const pending = await botDatabase().prepare(
      `SELECT bi.id AS itemId, uj.id AS uploadJobId, uj.status AS jobStatus,
              bi.chapter_number AS chapterNumber, bi.title, bi.language, bi.version,
              bi.status, bi.page_count AS pageCount, s.public_ref AS seriesId,
              s.title AS seriesTitle, t.public_ref AS teamId, t.name AS teamName,
              uj.created_at AS createdAt
         FROM upload_job_items bi JOIN upload_jobs uj ON uj.id = bi.job_id
         JOIN series s ON s.id = bi.series_id LEFT JOIN teams t ON t.id = bi.team_id
        WHERE bi.id = ? LIMIT 1`,
    ).bind(resolved.entityId).first<Record<string, unknown>>();
    if (!pending) return botJson(auth, { error: { code: "CHAPTER_NOT_FOUND", message: "The requested CH reference does not exist." } }, { status: 404 });
    return botJson(auth, { data: { publicRef: params.chapterId, ...pending, state: "PROCESSING", reserved: true } }, { status: 202 });
  } catch (error) { return errorResponse(botRequestId(request), error); }
}
