import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
  writeAudit,
} from "@/lib/server/admin-utils";
import { assertSeriesRequestTeamPermission } from "@/lib/server/series-request-common";
import {
  metadataPreviewSchema,
  previewExternalMetadata,
} from "@/lib/server/metadata-import";
import { requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const inputSchema = metadataPreviewSchema
  .omit({ refresh: true })
  .extend({
    teamId: z.string().trim().min(3).max(160),
    seriesRequestId: z.string().trim().min(3).max(160).optional(),
  });

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Metadata import storage is temporarily unavailable.",
    );
  }
  return env.DB;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const db = database();
    const payload = inputSchema.parse(await request.json());
    await assertSeriesRequestTeamPermission(db, actor, payload.teamId);
    if (payload.seriesRequestId) {
      const editableRequest = await db
        .prepare(
          `SELECT id
             FROM series_requests
            WHERE id = ?
              AND submitting_team_id = ?
              AND status IN ('DRAFT', 'CHANGES_REQUESTED')
            LIMIT 1`,
        )
        .bind(payload.seriesRequestId, payload.teamId)
        .first();
      if (!editableRequest) {
        throw new ApiError(
          409,
          "SERIES_REQUEST_LOCKED",
          "Metadata can only be previewed for an editable request in this team.",
        );
      }
    }
    const preview = await previewExternalMetadata(db, {
      actorUserId: actor.id,
      requestId,
      source: payload.source,
      input: payload.input,
      refresh: false,
      seriesRequestId: payload.seriesRequestId,
      action: "REQUEST_PREVIEW",
    });
    await writeAudit(actor, requestId, {
      action: "series.request.import.preview",
      category: "UPLOADS_IMPORTS",
      sourceArea: "UPLOAD_CENTER",
      targetType: "EXTERNAL_SERIES",
      targetId: preview.attemptedId,
      targetLabel: preview.data.fields.title ?? preview.attemptedId,
      metadata: {
        source: payload.source,
        teamId: payload.teamId,
        seriesRequestId: payload.seriesRequestId,
        cached: preview.data.cached,
        duplicateSeriesId:
          (preview.duplicate as { seriesId?: string } | null)?.seriesId ??
          null,
        duplicateRequestId:
          (
            preview.duplicateRequest as {
              requestId?: string;
            } | null
          )?.requestId ?? null,
      },
    });
    return json(
      requestId,
      {
        data: preview.data,
        duplicate: preview.duplicate,
        duplicateRequest: preview.duplicateRequest,
        applyMode: "SELECT_FIELDS",
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
