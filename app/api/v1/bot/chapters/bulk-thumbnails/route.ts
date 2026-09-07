import { env } from "cloudflare:workers";
import { z } from "zod";
import { errorResponse, ApiError } from "@/lib/server/api";
import { deleteMediaObject, validateImageFile } from "@/lib/server/admin-utils";
import { resolvePublicReferenceOrNull } from "@/lib/server/public-identifiers";
import { randomId } from "@/lib/server/random-id";
import { botAudit, botContext, botDatabase, botJson, botRequestId, botTeam } from "@/lib/server/bot-api";

export const dynamic = "force-dynamic";

const metadataSchema = z.object({ teamId: z.string().trim().min(3).max(160), chapterIds: z.array(z.string().trim().min(3).max(160)).min(1).max(25), replace: z.boolean().default(false) });

export async function POST(request: Request) {
  const uploaded: Array<{ key: string; chapterId: string; publicRef: string; previousKey: string | null; revision: number }> = [];
  let updateCommitted = false;
  let requestId = botRequestId(request);
  try {
    const auth = await botContext(request, "bot:chapter:thumbnail");
    requestId = auth.requestId;
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
    for (const chapter of chapters) {
      const file = form.get(`thumbnail:${chapter.publicRef}`);
      if (!(file instanceof File)) throw new ApiError(422, "THUMBNAIL_REQUIRED", `Upload thumbnail:${chapter.publicRef} for every requested chapter.`);
      const image = await validateImageFile(file, { label: "chapter thumbnail", maxBytes: 8_000_000, minWidth: 240, minHeight: 240, maxWidth: 8_000, maxHeight: 8_000, allowAnimation: false, allowedTypes: new Set(["image/jpeg", "image/png", "image/webp"]) });
      const key = `private/chapter-thumbnails/${chapter.id}/${randomId()}.webp`;
      await env.BUCKET.put(key, image.bytes, { httpMetadata: { contentType: image.contentType }, customMetadata: { actorId: auth.actor.id, chapterId: chapter.id, source: "BOT_API" } });
      uploaded.push({ key, chapterId: chapter.id, publicRef: chapter.publicRef, previousKey: chapter.thumbnailKey, revision: chapter.revision });
      updates.push({ chapterId: chapter.publicRef, thumbnailUpdated: true });
    }
    const cases = uploaded.map(() => "WHEN ? THEN ?").join(" ");
    const predicate = uploaded.map(() => "(id = ? AND revision = ?)").join(" OR ");
    const caseBindings = uploaded.flatMap((entry) => [entry.chapterId, entry.key]);
    const predicateBindings = uploaded.flatMap((entry) => [entry.chapterId, entry.revision]);
    const updated = await botDatabase().prepare(
      `UPDATE chapters
          SET thumbnail_key = CASE id ${cases} ELSE thumbnail_key END,
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE (${predicate})
          AND (SELECT COUNT(*) FROM chapters WHERE ${predicate}) = ?`,
    ).bind(...caseBindings, ...predicateBindings, ...predicateBindings, uploaded.length).run();
    if (Number(updated.meta.changes ?? 0) !== uploaded.length) {
      throw new ApiError(409, "CHAPTER_THUMBNAIL_STALE", "At least one chapter changed while thumbnails were uploading. No thumbnail references were changed.");
    }
    updateCommitted = true;
    await botAudit(auth, { action: "bot.chapter.bulk_thumbnail", targetType: "TEAM", targetId: team.publicRef, targetLabel: team.name, metadata: { chapterIds: updates.map((item) => item.chapterId), replace: metadata.replace } }).run();
    await Promise.allSettled(uploaded.filter((entry) => entry.previousKey && entry.previousKey !== entry.key).map((entry) =>
      deleteMediaObject(botDatabase(), env.BUCKET!, entry.previousKey!, {
        mediaKind: "CHAPTER_THUMBNAIL",
        targetType: "CHAPTER",
        targetId: entry.publicRef,
        reason: "Removed a superseded Bot chapter thumbnail",
      }),
    ));
    return botJson(auth, { data: { teamId: team.publicRef, updated: updates, count: updates.length } });
  } catch (error) {
    if (!updateCommitted && env.DB && env.BUCKET) {
      await Promise.allSettled(uploaded.map((entry) =>
        deleteMediaObject(env.DB!, env.BUCKET!, entry.key, {
          mediaKind: "CHAPTER_THUMBNAIL",
          targetType: "CHAPTER",
          targetId: entry.publicRef || requestId,
          reason: "Rolled back an incomplete Bot bulk thumbnail update",
        }),
      ));
    }
    return errorResponse(requestId, error);
  }
}
