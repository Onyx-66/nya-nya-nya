import { errorResponse, ApiError } from "@/lib/server/api";
import { botContext, botDatabase, botJson, botRequestId } from "@/lib/server/bot-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ operationId: string }> }) {
  try {
    const auth = await botContext(request, "bot:operation:read");
    const { operationId } = await context.params;
    const operation = await botDatabase().prepare(
      `SELECT bo.id AS operationId, bo.kind, bo.status, bo.job_id AS uploadJobId,
              bo.request_json AS requestJson, bo.result_json AS resultJson,
              bo.error_code AS errorCode, bo.error_message AS errorMessage,
              bo.created_at AS createdAt, bo.updated_at AS updatedAt, bo.completed_at AS completedAt,
              t.public_ref AS teamId, s.public_ref AS seriesId
         FROM bot_operations bo
         LEFT JOIN teams t ON t.id = bo.team_id
         LEFT JOIN upload_jobs uj ON uj.id = bo.job_id
         LEFT JOIN series s ON s.id = uj.series_id
        WHERE bo.id = ? AND bo.actor_user_id = ? LIMIT 1`,
    ).bind(operationId, auth.actor.id).first<Record<string, unknown>>();
    if (!operation) throw new ApiError(404, "OPERATION_NOT_FOUND", "This Bot operation does not exist for the authenticated actor.");
    return botJson(auth, { data: { ...operation, request: (() => { try { return JSON.parse(String(operation.requestJson ?? "{}")); } catch { return {}; } })(), result: (() => { try { return operation.resultJson ? JSON.parse(String(operation.resultJson)) : null; } catch { return null; } })(), requestJson: undefined, resultJson: undefined } }, { status: operation.status === "PROCESSING" ? 202 : 200 });
  } catch (error) { return errorResponse(botRequestId(request), error); }
}
