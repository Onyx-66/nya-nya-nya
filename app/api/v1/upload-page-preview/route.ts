import { env } from "cloudflare:workers";
import { z } from "zod";
import { requestIdFor } from "@/lib/server/admin-utils";
import { ApiError, errorResponse } from "@/lib/server/api";
import {
  isUploadAdmin,
  requireUploadCapability,
} from "@/lib/server/upload-jobs";
import { requireActor } from "@/lib/server/policy";

const querySchema = z.object({
  jobId: z.string().min(3).max(120),
  fileId: z.string().min(3).max(120),
});

export async function GET(request: Request) {
  const id = requestIdFor(request);
  try {
    const actor = await requireActor("upload.create");
    requireUploadCapability(actor);
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "UPLOAD_STORAGE_UNAVAILABLE",
        "Private upload previews are temporarily unavailable.",
      );
    }
    const url = new URL(request.url);
    const query = querySchema.parse({
      jobId: url.searchParams.get("jobId"),
      fileId: url.searchParams.get("fileId"),
    });
    const managedTeamSql =
      !isUploadAdmin(actor) && actor.managedTeamIds.length
        ? `OR uj.team_id IN (${actor.managedTeamIds
            .map(() => "?")
            .join(", ")})`
        : "";
    const bindings = isUploadAdmin(actor)
      ? [query.fileId, query.jobId]
      : [
          query.fileId,
          query.jobId,
          actor.id,
          ...(actor.managedTeamIds.length ? actor.managedTeamIds : []),
        ];
    const file = await env.DB.prepare(
      `SELECT us.object_key AS objectKey,
              us.content_type AS contentType,
              us.filename,
              us.status
         FROM upload_sessions us
         JOIN upload_jobs uj ON uj.id = us.upload_job_id
        WHERE us.id = ?
          AND uj.id = ?
          AND us.status = 'READY'
          ${
            isUploadAdmin(actor)
              ? ""
              : `AND (uj.user_id = ? ${managedTeamSql})`
          }
        LIMIT 1`,
    )
      .bind(...bindings)
      .first<{
        objectKey: string;
        contentType: string;
        filename: string;
        status: string;
      }>();
    if (!file) {
      throw new ApiError(
        404,
        "UPLOAD_PREVIEW_NOT_FOUND",
        "This private page preview is unavailable.",
      );
    }
    const object = await env.BUCKET.get(file.objectKey);
    if (!object) {
      throw new ApiError(
        404,
        "UPLOAD_OBJECT_NOT_FOUND",
        "This page is missing from private storage.",
      );
    }
    const headers = new Headers({
      "content-type": file.contentType,
      "cache-control": "private, no-store, max-age=0",
      "content-disposition": `inline; filename="${file.filename.replaceAll('"', "")}"`,
      "x-content-type-options": "nosniff",
      "x-request-id": id,
      vary: "Cookie",
    });
    headers.set("etag", object.httpEtag);
    if (request.headers.get("if-none-match") === object.httpEtag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return errorResponse(id, error);
  }
}
