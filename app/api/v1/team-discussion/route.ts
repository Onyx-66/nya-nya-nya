import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { getActor, requireActor, type Actor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";

export const dynamic = "force-dynamic";

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const createSchema = z.object({
  teamSlug: slugSchema,
  body: z.string().trim().min(2).max(2_000),
  parentId: z.string().trim().min(3).max(120).nullable().optional(),
  idempotencyKey: z.string().trim().min(12).max(160),
});

const voteSchema = z.object({
  postId: z.string().trim().min(3).max(120),
  value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

const deleteSchema = z.object({
  postId: z.string().trim().min(3).max(120),
});

type TeamRow = {
  id: string;
  slug: string;
  name: string;
};

type PostRow = {
  id: string;
  parentId: string | null;
  depth: number;
  body: string;
  moderationStatus: "VISIBLE" | "DELETED" | "HIDDEN";
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  displayName: string;
  username: string | null;
  avatarKey: string | null;
  profileRevision: number | null;
  membershipRole: string | null;
  upvotes: number;
  downvotes: number;
  score: number;
  viewerVote: number;
  ownedByViewer: number;
};

type MentionTarget = {
  token: string;
  targetType: "USER" | "SERIES";
  targetUserId: string | null;
  targetSeriesId: string | null;
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Team discussion is temporarily unavailable.",
    );
  }
  return env.DB;
}

async function publicTeam(slug: string) {
  const team = await database()
    .prepare(
      `SELECT id, slug, name
         FROM teams
        WHERE slug = ?
          AND is_archived = 0
          AND verification_status = 'VERIFIED'
        LIMIT 1`,
    )
    .bind(slug)
    .first<TeamRow>();
  if (!team) {
    throw new ApiError(
      404,
      "TEAM_NOT_FOUND",
      "This publishing team is not available.",
    );
  }
  return team;
}

function canModerate(actor: Actor | null, teamId: string) {
  if (!actor) return false;
  return (
    actor.roles.some((role) =>
      ["OWNER", "ADMINISTRATOR", "MODERATOR"].includes(role),
    ) || actor.managedTeamIds.includes(teamId)
  );
}

function storageError(error: unknown) {
  if (!(error instanceof Error)) return error;
  if (error.message.includes("team_discussion_rate_limited")) {
    return new ApiError(
      429,
      "DISCUSSION_RATE_LIMITED",
      "Please wait a moment before posting again.",
    );
  }
  if (error.message.includes("team_discussion_duplicate")) {
    return new ApiError(
      409,
      "DUPLICATE_POST",
      "That message was already posted.",
    );
  }
  if (error.message.includes("team_discussion_parent_invalid")) {
    return new ApiError(
      409,
      "REPLY_TARGET_CHANGED",
      "That discussion reply target is no longer available.",
    );
  }
  if (error.message.includes("team_discussion_team_unavailable")) {
    return new ApiError(
      409,
      "TEAM_STATE_CHANGED",
      "This publishing team is no longer available for discussion.",
    );
  }
  if (error.message.includes("discussion_self_vote_forbidden")) {
    return new ApiError(
      409,
      "SELF_VOTE_NOT_ALLOWED",
      "You cannot vote on your own post.",
    );
  }
  if (error.message.includes("discussion_vote_target_unavailable")) {
    return new ApiError(
      409,
      "VOTE_TARGET_CHANGED",
      "That discussion post is no longer available.",
    );
  }
  return error;
}

function privateHeaders() {
  return {
    "cache-control": "private, no-store",
    vary: "Cookie",
  };
}

function mentionTokens(body: string) {
  const matches = body.matchAll(
    /(^|\s)(@series\/[a-z0-9]+(?:-[a-z0-9]+)*|@[a-z0-9_.-]+)/gi,
  );
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of matches) {
    const token = match[2].toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length === 12) break;
  }
  return tokens;
}

async function resolveMentions(
  teamId: string,
  body: string,
): Promise<MentionTarget[]> {
  const targets = await Promise.all(
    mentionTokens(body).map(async (token): Promise<MentionTarget> => {
      if (token.startsWith("@series/")) {
        const slug = token.slice("@series/".length);
        const series = await database()
          .prepare(
            `SELECT s.id
               FROM series s
              WHERE s.slug = ?
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                AND EXISTS (
                  SELECT 1
                    FROM chapters c
                   WHERE c.series_id = s.id
                     AND c.team_id = ?
                     AND c.state = 'PUBLISHED'
                     AND c.visibility = 'PUBLIC'
                     AND c.published_at IS NOT NULL
                     AND datetime(c.published_at) <= datetime('now')
                )
              LIMIT 1`,
          )
          .bind(slug, teamId)
          .first<{ id: string }>();
        if (!series) {
          throw new ApiError(
            422,
            "MENTION_NOT_FOUND",
            `${token} is not a public series from this team.`,
          );
        }
        return {
          token,
          targetType: "SERIES",
          targetUserId: null,
          targetSeriesId: series.id,
        };
      }
      const username = token.slice(1);
      const user = await database()
        .prepare(
          `SELECT up.user_id AS id
             FROM user_profiles up
             JOIN users u ON u.id = up.user_id
            WHERE up.normalized_username = ?
              AND up.profile_visibility = 'PUBLIC'
              AND u.status = 'ACTIVE'
            LIMIT 1`,
        )
        .bind(username)
        .first<{ id: string }>();
      if (!user) {
        throw new ApiError(
          422,
          "MENTION_NOT_FOUND",
          `${token} is not an available public user.`,
        );
      }
      return {
        token,
        targetType: "USER",
        targetUserId: user.id,
        targetSeriesId: null,
      };
    }),
  );
  return targets;
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const url = new URL(request.url);
    const team = await publicTeam(slugSchema.parse(url.searchParams.get("slug")));
    const actor = await getActor().catch(() => null);
    const suggest = url.searchParams.get("suggest")?.trim().slice(0, 50) ?? "";

    if (suggest) {
      const pattern = `%${suggest.toLowerCase()}%`;
      const [seriesRows, userRows] = await Promise.all([
        database()
          .prepare(
            `SELECT DISTINCT s.slug, s.title
               FROM chapters c
               JOIN series s ON s.id = c.series_id
              WHERE c.team_id = ?
                AND c.state = 'PUBLISHED'
                AND c.visibility = 'PUBLIC'
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                AND (
                  lower(s.title) LIKE ?
                  OR lower(s.slug) LIKE ?
                )
              ORDER BY s.title COLLATE NOCASE
              LIMIT 8`,
          )
          .bind(team.id, pattern, pattern)
          .all<{ slug: string; title: string }>(),
        database()
          .prepare(
            `SELECT up.username, u.display_name AS displayName
               FROM user_profiles up
               JOIN users u ON u.id = up.user_id
              WHERE u.status = 'ACTIVE'
                AND up.profile_visibility = 'PUBLIC'
                AND (
                  lower(up.username) LIKE ?
                  OR lower(u.display_name) LIKE ?
                )
              ORDER BY
                CASE WHEN lower(up.username) = ? THEN 0 ELSE 1 END,
                up.username COLLATE NOCASE
              LIMIT 8`,
          )
          .bind(pattern, pattern, suggest.toLowerCase())
          .all<{ username: string; displayName: string }>(),
      ]);
      return json(
        requestId,
        {
          data: {
            series: seriesRows.results,
            users: userRows.results,
          },
        },
        { headers: privateHeaders() },
      );
    }

    const sort = z
      .enum(["top", "recent"])
      .catch("top")
      .parse(url.searchParams.get("sort"));
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .catch(1)
      .parse(url.searchParams.get("page"));
    const pageSize = 20;
    const [posts, rootCount] = await Promise.all([
      database()
        .prepare(
        `WITH vote_totals AS (
           SELECT post_id AS postId,
                  SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS upvotes,
                  SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS downvotes,
                  SUM(value) AS score
             FROM team_discussion_votes
            GROUP BY post_id
         ),
         viewer_votes AS (
           SELECT post_id AS postId, value
             FROM team_discussion_votes
            WHERE user_id = ?
         ),
         root_page AS (
           SELECT root.id
             FROM team_discussion_posts root
             LEFT JOIN vote_totals root_votes ON root_votes.postId = root.id
            WHERE root.team_id = ?
              AND root.parent_id IS NULL
              AND root.moderation_status IN ('VISIBLE', 'DELETED')
            ORDER BY
              ${
                sort === "top"
                  ? "COALESCE(root_votes.score, 0) DESC,"
                  : ""
              }
              datetime(root.created_at) DESC,
              root.id DESC
            LIMIT ? OFFSET ?
         )
         SELECT p.id,
                p.parent_id AS parentId,
                p.depth,
                p.body,
                p.moderation_status AS moderationStatus,
                p.edited_at AS editedAt,
                p.created_at AS createdAt,
                p.updated_at AS updatedAt,
                p.user_id AS userId,
                u.display_name AS displayName,
                CASE WHEN up.profile_visibility = 'PUBLIC'
                     THEN up.username ELSE NULL END AS username,
                CASE WHEN up.profile_visibility = 'PUBLIC'
                     THEN up.avatar_key ELSE NULL END AS avatarKey,
                CASE WHEN up.profile_visibility = 'PUBLIC'
                     THEN up.revision ELSE NULL END AS profileRevision,
                tm.membership_role AS membershipRole,
                COALESCE(vt.upvotes, 0) AS upvotes,
                COALESCE(vt.downvotes, 0) AS downvotes,
                COALESCE(vt.score, 0) AS score,
                COALESCE(vv.value, 0) AS viewerVote,
                CASE WHEN p.user_id = ? THEN 1 ELSE 0 END AS ownedByViewer
           FROM team_discussion_posts p
           JOIN users u ON u.id = p.user_id
           LEFT JOIN user_profiles up ON up.user_id = p.user_id
           LEFT JOIN team_memberships tm
             ON tm.team_id = p.team_id
            AND tm.user_id = p.user_id
            AND tm.status = 'ACTIVE'
           LEFT JOIN vote_totals vt ON vt.postId = p.id
           LEFT JOIN viewer_votes vv ON vv.postId = p.id
          WHERE p.team_id = ?
            AND p.moderation_status IN ('VISIBLE', 'DELETED')
            AND (
              p.id IN (SELECT id FROM root_page)
              OR p.parent_id IN (SELECT id FROM root_page)
            )
          ORDER BY
            CASE WHEN p.parent_id IS NULL THEN 0 ELSE 1 END,
            ${
              sort === "top"
                ? "CASE WHEN p.parent_id IS NULL THEN COALESCE(vt.score, 0) END DESC,"
                : ""
            }
            datetime(p.created_at) DESC,
            p.id DESC
        `,
        )
        .bind(
          actor?.id ?? "",
          team.id,
          pageSize,
          (page - 1) * pageSize,
          actor?.id ?? "",
          team.id,
        )
        .all<PostRow>(),
      database()
        .prepare(
          `SELECT COUNT(*) AS count
             FROM team_discussion_posts
            WHERE team_id = ?
              AND parent_id IS NULL
              AND moderation_status IN ('VISIBLE', 'DELETED')`,
        )
        .bind(team.id)
        .first<{ count: number }>(),
    ]);
    const pageCount = Math.max(
      1,
      Math.ceil(Number(rootCount?.count ?? 0) / pageSize),
    );

    return json(
      requestId,
      {
        data: posts.results.map((post) => ({
          id: post.id,
          parentId: post.parentId,
          depth: Number(post.depth),
          body:
            post.moderationStatus === "DELETED"
              ? ""
              : post.body,
          moderationStatus: post.moderationStatus,
          editedAt: post.editedAt,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
          author: {
            userId: post.userId,
            displayName: post.displayName,
            username: post.username,
            avatarUrl:
              post.username && post.avatarKey
                ? `/api/v1/profile-media?username=${encodeURIComponent(post.username)}&slot=avatar&v=${Number(post.profileRevision ?? 1)}`
                : null,
            teamRole: post.membershipRole,
          },
          upvotes: Number(post.upvotes),
          downvotes: Number(post.downvotes),
          score: Number(post.score),
          viewerVote: Number(post.viewerVote),
          ownedByViewer: Boolean(post.ownedByViewer),
        })),
        viewer: {
          signedIn: Boolean(actor),
          canModerate: canModerate(actor, team.id),
        },
        sort,
        pagination: {
          page,
          pageCount,
          hasNext: page < pageCount,
        },
      },
      { headers: privateHeaders() },
    );
  } catch (error) {
    return errorResponse(requestId, storageError(error));
  }
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("comment.create");
    const payload = createSchema.parse(await request.json());
    const team = await publicTeam(payload.teamSlug);
    const existing = await database()
      .prepare(
        `SELECT id, body, parent_id AS parentId
           FROM team_discussion_posts
          WHERE team_id = ?
            AND user_id = ?
            AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(team.id, actor.id, payload.idempotencyKey)
      .first<{ id: string; body: string; parentId: string | null }>();
    if (existing) {
      if (
        existing.body !== payload.body ||
        existing.parentId !== (payload.parentId ?? null)
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "That request key was already used for a different message.",
        );
      }
      return json(
        requestId,
        { data: { id: existing.id, replayed: true } },
        { status: 200 },
      );
    }
    let depth = 0;
    if (payload.parentId) {
      const parent = await database()
        .prepare(
          `SELECT id, parent_id AS parentId, moderation_status AS status
             FROM team_discussion_posts
            WHERE id = ? AND team_id = ?
            LIMIT 1`,
        )
        .bind(payload.parentId, team.id)
        .first<{ id: string; parentId: string | null; status: string }>();
      if (!parent || parent.parentId || parent.status !== "VISIBLE") {
        throw new ApiError(
          409,
          "REPLY_TARGET_CHANGED",
          "That discussion reply target is no longer available.",
        );
      }
      depth = 1;
    }

    const mentions = await resolveMentions(team.id, payload.body);
    const postId = `tdp_${randomId()}`;
    await database().batch([
      database()
        .prepare(
          `INSERT OR IGNORE INTO team_discussion_posts
           (id, team_id, user_id, parent_id, depth, body, idempotency_key,
            moderation_status, revision)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'VISIBLE', 1)`,
        )
        .bind(
          postId,
          team.id,
          actor.id,
          payload.parentId ?? null,
          depth,
          payload.body,
          payload.idempotencyKey,
        ),
      ...mentions.map((mention, ordinal) =>
        database()
          .prepare(
            `INSERT OR IGNORE INTO team_discussion_mentions
             (post_id, ordinal, target_type, target_user_id,
              target_series_id, token)
             SELECT ?, ?, ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1 FROM team_discussion_posts WHERE id = ?
              )`,
          )
          .bind(
            postId,
            ordinal,
            mention.targetType,
            mention.targetUserId,
            mention.targetSeriesId,
            mention.token,
            postId,
          ),
      ),
    ]);
    const saved = await database()
      .prepare(
        `SELECT id, body, parent_id AS parentId
           FROM team_discussion_posts
          WHERE team_id = ?
            AND user_id = ?
            AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(team.id, actor.id, payload.idempotencyKey)
      .first<{ id: string; body: string; parentId: string | null }>();
    if (!saved) {
      throw new ApiError(
        409,
        "POST_NOT_SAVED",
        "The message was not saved. Please try again.",
      );
    }
    if (
      saved.body !== payload.body ||
      saved.parentId !== (payload.parentId ?? null)
    ) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "That request key was already used for a different message.",
      );
    }
    return json(
      requestId,
      { data: { id: saved.id, replayed: saved.id !== postId } },
      { status: saved.id === postId ? 201 : 200 },
    );
  } catch (error) {
    return errorResponse(requestId, storageError(error));
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("comment.create");
    const payload = voteSchema.parse(await request.json());
    const post = await database()
      .prepare(
        `SELECT p.user_id AS userId, p.moderation_status AS status
           FROM team_discussion_posts p
           JOIN teams t ON t.id = p.team_id
          WHERE p.id = ?
            AND t.is_archived = 0
            AND t.verification_status = 'VERIFIED'
          LIMIT 1`,
      )
      .bind(payload.postId)
      .first<{ userId: string; status: string }>();
    if (!post || post.status !== "VISIBLE") {
      throw new ApiError(
        404,
        "POST_NOT_FOUND",
        "This discussion post is no longer available.",
      );
    }
    if (post.userId === actor.id) {
      throw new ApiError(
        409,
        "SELF_VOTE_NOT_ALLOWED",
        "You cannot vote on your own post.",
      );
    }
    if (payload.value === 0) {
      await database()
        .prepare(
          `DELETE FROM team_discussion_votes
            WHERE user_id = ? AND post_id = ?`,
        )
        .bind(actor.id, payload.postId)
        .run();
    } else {
      await database()
        .prepare(
          `INSERT INTO team_discussion_votes
           (user_id, post_id, value)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, post_id) DO UPDATE SET
             value = excluded.value,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(actor.id, payload.postId, payload.value)
        .run();
    }
    return json(requestId, { data: { saved: true } });
  } catch (error) {
    return errorResponse(requestId, storageError(error));
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor("comment.create");
    const payload = deleteSchema.parse(await request.json());
    const post = await database()
      .prepare(
        `SELECT p.user_id AS userId, p.team_id AS teamId,
                p.moderation_status AS status
           FROM team_discussion_posts p
           JOIN teams t ON t.id = p.team_id
          WHERE p.id = ?
            AND t.is_archived = 0
            AND t.verification_status = 'VERIFIED'
          LIMIT 1`,
      )
      .bind(payload.postId)
      .first<{ userId: string; teamId: string; status: string }>();
    if (!post || post.status !== "VISIBLE") {
      throw new ApiError(
        404,
        "POST_NOT_FOUND",
        "This discussion post is no longer available.",
      );
    }
    if (post.userId !== actor.id && !canModerate(actor, post.teamId)) {
      throw new ApiError(
        403,
        "POST_DELETE_FORBIDDEN",
        "You cannot remove this discussion post.",
      );
    }
    await database().batch([
      database()
        .prepare(
          `UPDATE team_discussion_posts
              SET body = '',
                  moderation_status = 'DELETED',
                  deleted_at = CURRENT_TIMESTAMP,
                  revision = revision + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND moderation_status = 'VISIBLE'`,
        )
        .bind(payload.postId),
      database()
        .prepare(
          `DELETE FROM team_discussion_votes
            WHERE post_id = ?`,
        )
        .bind(payload.postId),
    ]);
    return json(requestId, { data: { deleted: true } });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
