import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { requireReadableChapter } from "@/lib/server/chapter-access";
import {
  economySnapshot,
  grantCurrencyReward,
} from "@/lib/server/economy";
import { requireActor } from "@/lib/server/policy";
import { getRewardSettingsDocument } from "@/lib/server/reward-settings";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("HEARTBEAT"),
    chapterId: z.string().trim().min(3).max(120),
  }),
  z.object({
    action: z.literal("CLAIM_CHAPTER"),
    chapterId: z.string().trim().min(3).max(120),
  }),
  z.object({
    action: z.literal("CLAIM_COMMENT"),
    commentId: z.string().trim().min(3).max(120),
  }),
  z.object({
    action: z.literal("CLAIM_UPVOTE"),
    commentId: z.string().trim().min(3).max(120),
  }),
]);

const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "Cookie",
};

function database() {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Reward storage is temporarily unavailable.",
    );
  }
  return env.DB;
}

async function sessionStatus(userId: string, chapterId: string) {
  const [session, claim] = await Promise.all([
    database()
      .prepare(
        `SELECT active_seconds AS activeSeconds,
                last_heartbeat_at AS lastHeartbeatAt
           FROM chapter_reward_sessions
          WHERE user_id = ? AND chapter_id = ?
          LIMIT 1`,
      )
      .bind(userId, chapterId)
      .first<{ activeSeconds: number; lastHeartbeatAt: string }>(),
    database()
      .prepare(
        `SELECT claimed_at AS claimedAt
           FROM chapter_reward_claims
          WHERE user_id = ? AND chapter_id = ?
          LIMIT 1`,
      )
      .bind(userId, chapterId)
      .first<{ claimedAt: string }>(),
  ]);
  const requiredSeconds = (
    await getRewardSettingsDocument()
  ).settings.chapterMinimumSeconds;
  const activeSeconds = Number(session?.activeSeconds ?? 0);
  return {
    activeSeconds,
    requiredSeconds,
    eligible: activeSeconds >= requiredSeconds,
    alreadyClaimed: Boolean(claim),
    claimedAt: claim?.claimedAt ?? null,
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const chapterId = url.searchParams.get("chapterId")?.trim();
    const [document, balances, chapter] = await Promise.all([
      getRewardSettingsDocument(),
      economySnapshot(database(), actor.id),
      chapterId ? sessionStatus(actor.id, chapterId) : null,
    ]);
    return json(
      requestId,
      {
        settings: document.settings,
        settingsRevision: document.revision,
        balances,
        chapter,
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

async function heartbeat(userId: string, chapterId: string) {
  const db = database();
  const now = new Date();
  await db
    .prepare(
      `INSERT OR IGNORE INTO chapter_reward_sessions
       (user_id, chapter_id, active_seconds, started_at, last_heartbeat_at)
       VALUES (?, ?, 0, ?, ?)`,
    )
    .bind(userId, chapterId, now.toISOString(), now.toISOString())
    .run();
  const current = await db
    .prepare(
      `SELECT active_seconds AS activeSeconds,
              last_heartbeat_at AS lastHeartbeatAt
         FROM chapter_reward_sessions
        WHERE user_id = ? AND chapter_id = ?
        LIMIT 1`,
    )
    .bind(userId, chapterId)
    .first<{ activeSeconds: number; lastHeartbeatAt: string }>();
  if (!current) {
    throw new ApiError(
      409,
      "REWARD_SESSION_UNAVAILABLE",
      "Reader activity could not be recorded.",
    );
  }
  const elapsedSeconds = Math.max(
    0,
    Math.min(
      30,
      Math.floor((now.getTime() - Date.parse(current.lastHeartbeatAt)) / 1_000),
    ),
  );
  if (elapsedSeconds > 0) {
    await db
      .prepare(
        `UPDATE chapter_reward_sessions
            SET active_seconds = active_seconds + ?,
                last_heartbeat_at = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
            AND chapter_id = ?
            AND last_heartbeat_at = ?`,
      )
      .bind(
        elapsedSeconds,
        now.toISOString(),
        userId,
        chapterId,
        current.lastHeartbeatAt,
      )
      .run();
  }
  return sessionStatus(userId, chapterId);
}

async function claimChapter(userId: string, chapterId: string) {
  const db = database();
  const settings = (await getRewardSettingsDocument()).settings;
  const [status, progress] = await Promise.all([
    sessionStatus(userId, chapterId),
    db
      .prepare(
        `SELECT progress_basis_points AS progressBasisPoints,
                completed_at AS completedAt
           FROM reading_progress
          WHERE user_id = ? AND chapter_id = ?
          LIMIT 1`,
      )
      .bind(userId, chapterId)
      .first<{ progressBasisPoints: number; completedAt: string | null }>(),
  ]);
  if (status.alreadyClaimed) {
    return { ...status, awarded: false, amount: 0 };
  }
  if (
    !status.eligible ||
    Number(progress?.progressBasisPoints ?? 0) < 9_200 ||
    !progress?.completedAt
  ) {
    throw new ApiError(
      409,
      "CHAPTER_REWARD_NOT_READY",
      `Finish the chapter and stay on the reader for at least ${settings.chapterMinimumSeconds} seconds.`,
    );
  }
  const reward = await grantCurrencyReward(db, {
    userId,
    currency: "SHARDS",
    amount: settings.chapterCompleteShards,
    kind: "CHAPTER_REWARD",
    referenceType: "CHAPTER",
    referenceId: chapterId,
    idempotencyKey: `reward:chapter:${userId}:${chapterId}`,
    memo: `Completed chapter reward · ${settings.chapterCompleteShards} ${settings.shardPlural}`,
  });
  if (reward.transactionId) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO chapter_reward_claims
         (user_id, chapter_id, transaction_id, active_seconds)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(userId, chapterId, reward.transactionId, status.activeSeconds)
      .run();
  }
  return {
    ...(await sessionStatus(userId, chapterId)),
    awarded: reward.created,
    amount: reward.created ? settings.chapterCompleteShards : 0,
    balance: reward.balance,
  };
}

async function claimComment(userId: string, commentId: string) {
  const db = database();
  const comment = await db
    .prepare(
      `SELECT id
         FROM discussion_comments
        WHERE id = ?
          AND user_id = ?
          AND moderation_status = 'VISIBLE'
          AND deleted_at IS NULL
        LIMIT 1`,
    )
    .bind(commentId, userId)
    .first<{ id: string }>();
  if (!comment) {
    throw new ApiError(
      404,
      "COMMENT_NOT_FOUND",
      "This comment is not eligible for a reward.",
    );
  }
  const settings = (await getRewardSettingsDocument()).settings;
  const reward = await grantCurrencyReward(db, {
    userId,
    currency: "SHARDS",
    amount: settings.commentCreatedShards,
    kind: "COMMENT_REWARD",
    referenceType: "COMMENT",
    referenceId: commentId,
    idempotencyKey: `reward:comment:${userId}:${commentId}`,
    memo: `Comment reward · ${settings.commentCreatedShards} ${settings.shardPlural}`,
  });
  if (reward.transactionId) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO community_reward_claims
         (beneficiary_user_id, reward_type, source_id, amount, transaction_id)
         VALUES (?, 'COMMENT_CREATED', ?, ?, ?)`,
      )
      .bind(
        userId,
        commentId,
        settings.commentCreatedShards,
        reward.transactionId,
      )
      .run();
  }
  return {
    awarded: reward.created,
    amount: reward.created ? settings.commentCreatedShards : 0,
    balance: reward.balance,
  };
}

async function claimUpvote(voterUserId: string, commentId: string) {
  const db = database();
  const comment = await db
    .prepare(
      `SELECT c.user_id AS authorUserId
         FROM discussion_comments c
         JOIN discussion_votes v
           ON v.comment_id = c.id
          AND v.user_id = ?
          AND v.value = 1
        WHERE c.id = ?
          AND c.moderation_status = 'VISIBLE'
          AND c.deleted_at IS NULL
        LIMIT 1`,
    )
    .bind(voterUserId, commentId)
    .first<{ authorUserId: string }>();
  if (!comment || comment.authorUserId === voterUserId) {
    return { awarded: false, amount: 0, balance: null };
  }
  const settings = (await getRewardSettingsDocument()).settings;
  const sourceId = `${commentId}:${voterUserId}`;
  const reward = await grantCurrencyReward(db, {
    userId: comment.authorUserId,
    currency: "SHARDS",
    amount: settings.upvoteReceivedShards,
    kind: "COMMENT_UPVOTE_REWARD",
    referenceType: "COMMENT_UPVOTE",
    referenceId: sourceId,
    idempotencyKey: `reward:upvote:${sourceId}`,
    memo: `Comment upvote reward · ${settings.upvoteReceivedShards} ${settings.shardPlural}`,
  });
  if (reward.transactionId) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO community_reward_claims
         (beneficiary_user_id, reward_type, source_id, amount, transaction_id)
         VALUES (?, 'COMMENT_UPVOTE', ?, ?, ?)`,
      )
      .bind(
        comment.authorUserId,
        sourceId,
        settings.upvoteReceivedShards,
        reward.transactionId,
      )
      .run();
  }
  return {
    awarded: reward.created,
    amount: reward.created ? settings.upvoteReceivedShards : 0,
    balance: reward.balance,
  };
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = actionSchema.parse(await request.json());
    let result: unknown;
    if (payload.action === "HEARTBEAT") {
      await requireReadableChapter(actor, payload.chapterId);
      result = await heartbeat(actor.id, payload.chapterId);
    } else if (payload.action === "CLAIM_CHAPTER") {
      await requireReadableChapter(actor, payload.chapterId);
      result = await claimChapter(actor.id, payload.chapterId);
    } else if (payload.action === "CLAIM_COMMENT") {
      result = await claimComment(actor.id, payload.commentId);
    } else {
      result = await claimUpvote(actor.id, payload.commentId);
    }
    return json(requestId, result, { headers: privateHeaders });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
