import { env } from "cloudflare:workers";
import { z } from "zod";
import { errorResponse, ApiError } from "@/lib/server/api";
import { validateImageFile } from "@/lib/server/admin-utils";
import { resolvePublicReferenceOrNull } from "@/lib/server/public-identifiers";
import { randomId } from "@/lib/server/random-id";
import { botAudit, botContext, botDatabase, botJson, botRequestId, botTeam } from "@/lib/server/bot-api";

export const dynamic = "force-dynamic";

const metadataSchema = z.object({ teamId: z.string().trim().min(3).max(160), chapterIds: z.array(z.string().trim().min(3).max(160)).min(1).max(25), replace: z.boolean().default(false) });

export async function POST(request: Request) {
  try {
    const auth = await botContext(request, "bot:chapter:thumbnail");
    if (!env.BUCKET) throw new ApiError(503, "MEDIA_UNAVAILABLE", "Chapter thumbnail storage is unavailable.");
    const form = await request.formData();
    const raw = form.get("metadata");
    if (typeof raw !== "string") throw new ApiError(422, "METADATA_REQUIRED", "Multipart bulk thumbnail updates require a metadata JSON field.");
    const metadata = metadataSchema.parse(JSON.parse(raw));
    const team = await botTeam(auth, metadata.teamId);
    const chapters: Array<{ publicRef: string; id: string; title: string; thumbnailKey: string | null; revision: number }> = [];
    for (const publicRef of metadata.chapterIds) {
      const resolved = await resolvePublicReferenceOrNull(botDatabase(), "CHAPTER", publicRef);
      if (!resolved) throw new ApiError(404, "CHAPTER_NOT_FOUND", `The requested CH reference does not exist: ${publicRef}`);
      const chapter = await botDatabase().prepare("SELECT id, title, thumbnail_key AS thumbnailKey, revision FROM chapters WHERE id = ? AND team_id = ? LIMIT 1").bind(resolved.entityId, team.id).first<{ id: string; title: string; thumbnailKey: string | null; revision: number }>();
      if (!chapter) throw new ApiError(403, "BOT_TEAM_SCOPE_REQUIRED", `The chapter is not assigned to the selected team: ${publicRef}`);
      chapters.push({ publicRef, ...chapter });
    }
    const existing = chapters.filter((chapter) => chapter.thumbnailKey).map((chapter) => chapter.publicRef);
    if (existing.length && !metadata.replace) return botJson(auth, { error: { code: "THUMBNAILS_EXIST", message: "Some chapters already have thumbnails. Confirm replacement with replace=true.", confirmationRequired: true, existingChapterIds: existing, readyChapterIds: chapters.filter((chapter) => !chapter.thumbnailKey).map((chapter) => chapter.publicRef) } }, { status: 409 });
    const updates: Array<{ chapterId: string; thumbnailUpdated: boolean }> = [];
    const statements: D1PreparedStatement[] = [];
    for (const chapter of chapters) {
      const file = form.get(`thumbnail:${chapter.publicRef}`);
      if (!(file instanceof File)) throw new ApiError(422, "THUMBNAIL_REQUIRED", `Upload thumbnail:${chapter.publicRef} for every requested chapter.`);
      const image = await validateImageFile(file, { label: "chapter thumbnail", maxBytes: 8_000_000, minWidth: 240, minHeight: 240, maxWidth: 8_000, maxHeight: 8_000, allowAnimation: false, allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]) });
      const key = `private/chapter-thumbnails/${chapter.id}/${randomId()}.webp`;
      await env.BUCKET.put(key, image.bytes, { httpMetadata: { contentType: image.contentType }, customMetadata: { actorId: auth.actor.id, chapterId: chapter.id, source: "BOT_API" } });
      statements.push(botDatabase().prepare("UPDATE chapters SET thumbnail_key = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?").bind(key, chapter.id, chapter.revision));
      updates.push({ chapterId: chapter.publicRef, thumbnailUpdated: true });
    }
    statements.push(botAudit(auth, { action: "bot.chapter.bulk_thumbnail", targetType: "TEAM", targetId: team.publicRef, targetLabel: team.name, metadata: { chapterIds: updates.map((item) => item.chapterId), replace: metadata.replace } }));
    await botDatabase().batch(statements);
    return botJson(auth, { data: { teamId: team.publicRef, updated: updates, count: updates.length } });
  } catch (error) { return errorResponse(botRequestId(request), error); }
}
