import { errorResponse, ApiError } from "@/lib/server/api";
import { botAudit, botContext, botDatabase, botFailureAudit, botIdempotencyFail, botIdempotencyFinish, botIdempotencyStart, botJson, botRequestId } from "@/lib/server/bot-api";
import { resolvePublicReferenceOrNull } from "@/lib/server/public-identifiers";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ chapterId: string }> }) {
  let auth: Awaited<ReturnType<typeof botContext>> | null = null;
  const endpoint = "POST /api/v1/bot/chapters/{chapterId}/publish";
  let key = "";
  try {
    auth = await botContext(request, "bot:chapter:publish");
    const { chapterId } = await context.params;
    const idem = await botIdempotencyStart(auth, endpoint, request.headers.get("Idempotency-Key") ?? "", { chapterId });
    key = idem.key;
    if (idem.replay) return botJson(auth, idem.replay);
    const resolved = await resolvePublicReferenceOrNull(botDatabase(), "CHAPTER", chapterId);
    if (!resolved) throw new ApiError(404, "CHAPTER_NOT_FOUND", "The requested CH reference does not exist.");
    const chapter = await botDatabase().prepare(
      `SELECT c.id, c.team_id AS teamId, c.series_id AS seriesId, c.chapter_number AS chapterNumber,
              c.title, c.state, s.public_ref AS seriesRef, t.public_ref AS teamRef
         FROM chapters c JOIN series s ON s.id = c.series_id
         LEFT JOIN teams t ON t.id = c.team_id
        WHERE c.id = ? LIMIT 1`,
    ).bind(resolved.entityId).first<{ id: string; teamId: string | null; seriesId: string; chapterNumber: string; title: string; state: string; seriesRef: string; teamRef: string | null }>();
    if (!chapter) throw new ApiError(409, "CHAPTER_NOT_MATERIALIZED", "This reserved CH reference is still processing and cannot be published yet.");
    if (chapter.teamId && auth.principal.allowedTeamId !== chapter.teamId && !auth.actor.roles.some((role) => role === "OWNER" || role === "ADMINISTRATOR")) throw new ApiError(403, "BOT_TEAM_SCOPE_REQUIRED", "This Bot token cannot publish the chapter’s team.");
    const allowed = await botDatabase().prepare("SELECT 1 FROM series_team_assignments WHERE series_id = ? AND team_id = ? AND can_publish = 1 LIMIT 1").bind(chapter.seriesId, chapter.teamId).first();
    if (!allowed) throw new ApiError(403, "BOT_PUBLISH_SCOPE_REQUIRED", "This team does not have publish rights for the series.");
    const response = { data: { chapterId, seriesId: chapter.seriesRef, teamId: chapter.teamRef, state: "PUBLISHED", published: true } };
    await botDatabase().batch([
      botDatabase().prepare("UPDATE chapters SET state = 'PUBLISHED', published_at = COALESCE(published_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ? AND state <> 'PUBLISHED'").bind(chapter.id),
      botAudit(auth, { action: "bot.chapter.publish", targetType: "CHAPTER", targetId: chapterId, targetLabel: `${chapter.seriesRef} · ${chapter.chapterNumber}`, metadata: { seriesId: chapter.seriesRef, teamId: chapter.teamRef, previousState: chapter.state } }),
    ]);
    await botIdempotencyFinish(auth, endpoint, key, response, [chapterId]);
    return botJson(auth, response);
  } catch (error) {
    if (auth && key) await botIdempotencyFail(auth, endpoint, key, error);
    if (auth) await botFailureAudit(auth, endpoint, error);
    return errorResponse(botRequestId(request), error);
  }
}
