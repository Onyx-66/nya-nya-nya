import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  metadataPreviewSchema,
  previewExternalMetadata,
} from "@/lib/server/metadata-import";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
  writeAudit,
} from "@/lib/server/admin-utils";
import { requireActor, requireAdmin } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const inputSchema = metadataPreviewSchema.extend({
  seriesId: z.string().trim().min(3).max(160).optional(),
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
    requireAdmin(actor);
    const payload = inputSchema.parse(await request.json());
    const preview = await previewExternalMetadata(database(), {
      actorUserId: actor.id,
      requestId,
      source: payload.source,
      input: payload.input,
      refresh: payload.refresh,
      seriesId: payload.seriesId,
      action: "PREVIEW",
    });
    await writeAudit(actor, requestId, {
      action: "series.import.preview",
      category: "UPLOADS_IMPORTS",
      sourceArea: "METADATA_IMPORT",
      targetType: "EXTERNAL_SERIES",
      targetId: preview.attemptedId,
      targetLabel: preview.data.fields.title ?? preview.attemptedId,
      metadata: {
        source: payload.source,
        seriesId: payload.seriesId,
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
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
