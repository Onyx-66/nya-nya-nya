import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { assertSameOrigin, requestIdFor } from "@/lib/server/admin-utils";
import { requireReadableChapter } from "@/lib/server/chapter-access";
import { getActor, requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const durableId = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/, "Use a valid durable identifier.");
const querySchema = z.object({ chapterId: durableId });
const mutationSchema = querySchema.extend({ reactionId: durableId });

async function assertReactionChapterReadable(
  chapterId: string,
  viewer: Awaited<ReturnType<typeof getActor>>,
) {
  if (viewer) {
    await requireReadableChapter(viewer, chapterId);
    return;
  }
  const publicChapter = await env.DB!.prepare(
    `SELECT 1
       FROM chapters c
       JOIN series s ON s.id = c.series_id
      WHERE c.id = ?
        AND c.state = 'PUBLISHED'
        AND c.visibility = 'PUBLIC'
        AND c.access_type = 'FREE'
        AND c.published_at IS NOT NULL
        AND datetime(c.published_at) <= CURRENT_TIMESTAMP
        AND s.is_published = 1
        AND s.archived_at IS NULL
        AND s.rights_status IN ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
      LIMIT 1`,
  ).bind(chapterId).first();
  if (!publicChapter) {
    throw new ApiError(404, "CHAPTER_NOT_FOUND", "This chapter is not available for reactions.");
  }
}

async function snapshot(chapterId: string, viewerId: string | null) {
  const viewer = viewerId ?? "";
  const reactions = await env.DB!.prepare(
    `SELECT cr.id, cr.name, cr.accessible_label AS accessibleLabel,
            cr.emoji_fallback AS emojiFallback, cr.asset_key AS assetKey,
            COUNT(chr.user_id) AS count,
            MAX(CASE WHEN chr.user_id = ? THEN 1 ELSE 0 END) AS selected
       FROM custom_reactions cr
       LEFT JOIN chapter_reactions chr
         ON chr.reaction_id = cr.id AND chr.chapter_id = ?
      WHERE cr.usage_kind = 'REACTION'
        AND cr.slug IN ('upvote', 'laugh', 'heart', 'surprised', 'angry', 'sad')
        AND cr.is_active = 1
        AND cr.is_archived = 0
        AND (
          COALESCE(json_extract(cr.availability_json, '$.scope'), 'GLOBAL') = 'GLOBAL'
          OR (? <> '' AND json_extract(cr.availability_json, '$.scope') = 'SIGNED_IN')
          OR (
            ? <> ''
            AND json_extract(cr.availability_json, '$.scope') = 'TEAM'
            AND EXISTS (
              SELECT 1
                FROM json_each(cr.availability_json, '$.teamIds') allowed_team
                JOIN team_memberships tm ON tm.team_id = allowed_team.value
               WHERE tm.user_id = ? AND tm.status = 'ACTIVE'
            )
          )
        )
      GROUP BY cr.id
      ORDER BY CASE cr.slug
        WHEN 'upvote' THEN 0 WHEN 'laugh' THEN 1 WHEN 'heart' THEN 2
        WHEN 'surprised' THEN 3 WHEN 'angry' THEN 4 WHEN 'sad' THEN 5
        ELSE 6 END`,
  ).bind(viewer, chapterId, viewer, viewer, viewer).all<{
    id: string; name: string; accessibleLabel: string; emojiFallback: string;
    assetKey: string | null; count: number; selected: number;
  }>();
  const data = reactions.results.map((reaction) => ({
    ...reaction,
    count: Number(reaction.count),
    selected: Boolean(reaction.selected),
    imageUrl: reaction.assetKey
      ? `/api/v1/reaction-asset?id=${encodeURIComponent(reaction.id)}`
      : null,
  }));
  return {
    data,
    total: data.reduce((sum, reaction) => sum + reaction.count, 0),
  };
}

async function replyBadge(chapterId: string, viewerId: string | null) {
  if (!viewerId) return { replyCount: 0, showReplyBadge: true };
  const row = await env.DB!.prepare(
    `SELECT COUNT(DISTINCT reply.id) AS replyCount,
            COALESCE(json_extract(up.settings_json, '$.commentReplyBadge'), 1) AS showReplyBadge
       FROM chapters c
       JOIN series s ON s.id = c.series_id
       LEFT JOIN discussion_comments root
         ON root.series_slug = s.slug AND root.chapter_slug = c.slug
        AND root.user_id = ? AND root.deleted_at IS NULL
       LEFT JOIN discussion_comments reply
         ON reply.parent_id = root.id AND reply.user_id <> ?
        AND reply.moderation_status = 'VISIBLE' AND reply.deleted_at IS NULL
       LEFT JOIN user_preferences up ON up.user_id = ?
      WHERE c.id = ?`,
  ).bind(viewerId, viewerId, viewerId, chapterId).first<{ replyCount: number; showReplyBadge: number }>();
  return { replyCount: Number(row?.replyCount ?? 0), showReplyBadge: Boolean(row?.showReplyBadge ?? 1) };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Chapter reactions are unavailable.");
    const { chapterId } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const viewer = await getActor().catch(() => null);
    await assertReactionChapterReadable(chapterId, viewer);
    const reactionSnapshot = await snapshot(chapterId, viewer?.id ?? null);
    return json(
      requestId,
      {
        data: reactionSnapshot.data,
        total: reactionSnapshot.total,
        meta: await replyBadge(chapterId, viewer?.id ?? null),
      },
      { headers: { "cache-control": "private, no-store", vary: "cookie" } },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PUT(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (!env.DB) throw new ApiError(503, "DATABASE_UNAVAILABLE", "Chapter reactions are unavailable.");
    const payload = mutationSchema.parse(await request.json());
    await requireReadableChapter(actor, payload.chapterId);
    const available = await env.DB.prepare(
      `SELECT cr.id
         FROM custom_reactions cr
        WHERE cr.usage_kind = 'REACTION'
          AND cr.slug IN ('upvote', 'laugh', 'heart', 'surprised', 'angry', 'sad')
          AND cr.is_active = 1 AND cr.is_archived = 0
          AND cr.id = ?
          AND (
            COALESCE(json_extract(cr.availability_json, '$.scope'), 'GLOBAL') = 'GLOBAL'
            OR json_extract(cr.availability_json, '$.scope') = 'SIGNED_IN'
            OR (
              json_extract(cr.availability_json, '$.scope') = 'TEAM'
              AND EXISTS (
                SELECT 1
                  FROM json_each(cr.availability_json, '$.teamIds') allowed_team
                  JOIN team_memberships tm ON tm.team_id = allowed_team.value
                 WHERE tm.user_id = ? AND tm.status = 'ACTIVE'
              )
            )
          )
        LIMIT 1`,
    ).bind(payload.reactionId, actor.id).first();
    if (!available) throw new ApiError(404, "REACTION_NOT_FOUND", "This reaction is no longer available.");
    const current = await env.DB.prepare(
      "SELECT reaction_id AS reactionId FROM chapter_reactions WHERE user_id = ? AND chapter_id = ? LIMIT 1",
    ).bind(actor.id, payload.chapterId).first<{ reactionId: string }>();
    if (current?.reactionId === payload.reactionId) {
      await env.DB.prepare("DELETE FROM chapter_reactions WHERE user_id = ? AND chapter_id = ? AND reaction_id = ?")
        .bind(actor.id, payload.chapterId, payload.reactionId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO chapter_reactions (user_id, chapter_id, reaction_id)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, chapter_id) DO UPDATE SET
           reaction_id = excluded.reaction_id,
           created_at = CURRENT_TIMESTAMP`,
      ).bind(actor.id, payload.chapterId, payload.reactionId).run();
    }
    const reactionSnapshot = await snapshot(payload.chapterId, actor.id);
    return json(requestId, {
      data: reactionSnapshot.data,
      total: reactionSnapshot.total,
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
