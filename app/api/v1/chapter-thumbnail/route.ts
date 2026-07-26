import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

const idSchema = z.string().trim().min(3).max(160);

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB || !env.BUCKET) {
      throw new ApiError(
        503,
        "CHAPTER_THUMBNAIL_UNAVAILABLE",
        "Chapter thumbnails are temporarily unavailable.",
      );
    }
    const chapterId = idSchema.parse(new URL(request.url).searchParams.get("id"));
    const row = await env.DB.prepare(
      `SELECT c.thumbnail_key AS thumbnailKey
         FROM chapters c
         JOIN series s ON s.id = c.series_id
        WHERE c.id = ?
          AND c.thumbnail_key IS NOT NULL
          AND c.state = 'PUBLISHED'
          AND c.visibility = 'PUBLIC'
          AND c.published_at IS NOT NULL
          AND datetime(c.published_at) <= datetime('now')
          AND s.is_published = 1
          AND s.archived_at IS NULL
          AND s.rights_status IN
            ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
        LIMIT 1`,
    )
      .bind(chapterId)
      .first<{ thumbnailKey: string }>();
    if (!row?.thumbnailKey) {
      throw new ApiError(
        404,
        "CHAPTER_THUMBNAIL_NOT_FOUND",
        "This chapter does not have a public thumbnail.",
      );
    }
    const object = await env.BUCKET.get(row.thumbnailKey);
    if (!object) {
      throw new ApiError(
        404,
        "CHAPTER_THUMBNAIL_NOT_FOUND",
        "This chapter thumbnail is unavailable.",
      );
    }
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType ?? "image/webp",
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
