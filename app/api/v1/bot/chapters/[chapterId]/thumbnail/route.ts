import { env } from "cloudflare:workers";
import { errorResponse, ApiError } from "@/lib/server/api";
import { auditStatement, validateImageFile } from "@/lib/server/admin-utils";
import { botContext, botDatabase, botJson, botRequestId } from "@/lib/server/bot-api";
import { resolvePublicReferenceOrNull } from "@/lib/server/public-identifiers";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ chapterId: string }> }) {
  try {
    const auth = await botContext(request, "bot:chapter:thumbnail");
    if (!env.BUCKET) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Chapter thumbnail storage is unavailable.");
    const { chapterId } = await context.params;
    const resolved = await resolvePublicReferenceOrNull(botDatabase(), "CHAPTER", chapterId);
    if (!resolved) throw new ApiError(404, "CHAPTER_NOT_FOUND", "The requested CH reference does not exist.");
    const chapter = await botDatabase().prepare("SELECT c.id, c.team_id AS teamId, c.title, c.revision, c.thumbnail_key AS thumbnailKey FROM chapters c WHERE c.id = ? LIMIT 1").bind(resolved.entityId).first<{ id: string; teamId: string | null; title: string; revision: number; thumbnailKey: string | null }>();
    if (!chapter) throw new ApiError(409, "CHAPTER_NOT_MATERIALIZED", "This reserved CH reference is still processing and has no materialized chapter to update.");
    if (chapter.teamId && auth.principal.allowedTeamId !== chapter.teamId && !auth.actor.roles.some((role) => role === "OWNER" || role === "ADMINISTRATOR")) throw new ApiError(403, "BOT_TEAM_SCOPE_REQUIRED", "This Bot token cannot modify the chapter’s team.");
    const form = await request.formData();
    const replace = String(form.get("replace") ?? request.headers.get("x-nyascans-replace") ?? "false").toLowerCase() === "true";
    if (chapter.thumbnailKey && !replace) return botJson(auth, { error: { code: "THUMBNAIL_EXISTS", message: "This chapter already has a thumbnail. Confirm replacement with replace=true.", confirmationRequired: true, chapterId } }, { status: 409 });
    const file = form.get("thumbnail");
    if (!(file instanceof File)) throw new ApiError(422, "THUMBNAIL_REQUIRED", "Upload a thumbnail file.");
    const image = await validateImageFile(file, { label: "chapter thumbnail", maxBytes: 8_000_000, minWidth: 240, minHeight: 240, maxWidth: 8_000, maxHeight: 8_000, allowAnimation: false, allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]) });
    const key = `private/chapter-thumbnails/${chapter.id}/${randomId()}.webp`;
    await env.BUCKET.put(key, image.bytes, { httpMetadata: { contentType: image.contentType }, customMetadata: { actorId: auth.actor.id, chapterId: chapter.id, source: "BOT_API" } });
    await botDatabase().batch([
      botDatabase().prepare("UPDATE chapters SET thumbnail_key = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?").bind(key, chapter.id, chapter.revision),
      auditStatement(botDatabase(), auth.actor, auth.requestId, { action: "bot.chapter.thumbnail", category: "UPLOADS_IMPORTS", sourceArea: "BOT_API", targetType: "CHAPTER", targetId: chapterId, targetLabel: chapter.title, metadata: { contentType: image.contentType, width: image.dimensions.width, height: image.dimensions.height } }),
    ]);
    return botJson(auth, { data: { chapterId, thumbnailUpdated: true } });
  } catch (error) { return errorResponse(botRequestId(request), error); }
}
