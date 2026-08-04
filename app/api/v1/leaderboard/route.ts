import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const periodSchema = z.enum(["weekly", "monthly", "all"]).catch("weekly");

type LeaderboardRow = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarKey: string | null;
  revision: number;
  communityVisible: number;
  commentCount: number;
  shardsCollected: number;
  lifetimeShards: number;
  chaptersRead: number;
  upvotes: number;
  downvotes: number;
  reputation: number;
  score: number;
};

function publicEntry(row: LeaderboardRow) {
  return {
    rank: Number(row.rank),
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarKey
      ? `/api/v1/profile-media?username=${encodeURIComponent(row.username)}&slot=avatar&v=${row.revision}`
      : null,
    communityVisible: Boolean(row.communityVisible),
    commentCount: Number(row.commentCount),
    shardsCollected: Number(row.shardsCollected),
    lifetimeShards: Number(row.lifetimeShards),
    chaptersRead: Number(row.chaptersRead),
    upvotes: Number(row.upvotes),
    downvotes: Number(row.downvotes),
    reputation: Number(row.reputation),
    score: Number(row.score),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "The reader ranking is temporarily unavailable.",
      );
    }

    const period = periodSchema.parse(
      new URL(request.url).searchParams.get("period"),
    );
    const actor = await getActor().catch(() => null);
    const since =
      period === "weekly"
        ? "datetime('now', 'weekday 0', '-6 days', 'start of day')"
        : period === "monthly"
          ? "datetime('now', 'start of month')"
          : null;
    const after = (column: string) =>
      since ? `AND datetime(${column}) >= ${since}` : "";

    const rows = await env.DB.prepare(
      `WITH shard_totals AS (
         SELECT la.owner_id AS userId,
                COALESCE(SUM(CASE WHEN le.amount > 0 THEN le.amount ELSE 0 END), 0)
                  AS shardsCollected
           FROM ledger_accounts la
           JOIN ledger_entries le ON le.account_id = la.id
           JOIN ledger_transactions lt ON lt.id = le.transaction_id
          WHERE la.owner_type = 'USER'
            AND la.currency = 'SHARDS'
            AND la.account_type = 'AVAILABLE'
            AND lt.kind IN (
              'CHAPTER_REWARD',
              'COMMENT_REWARD',
              'COMMENT_UPVOTE_REWARD',
              'ROULETTE_REWARD'
            )
            ${after("lt.created_at")}
          GROUP BY la.owner_id
       ),
       community_comments AS (
         SELECT user_id AS userId, COUNT(*) AS commentCount
           FROM discussion_comments
          WHERE moderation_status = 'VISIBLE'
            AND deleted_at IS NULL
            ${after("created_at")}
          GROUP BY user_id
         UNION ALL
         SELECT user_id AS userId, COUNT(*) AS commentCount
           FROM team_discussion_posts
          WHERE moderation_status = 'VISIBLE'
            AND deleted_at IS NULL
            ${after("created_at")}
          GROUP BY user_id
       ),
       comment_totals AS (
         SELECT userId, SUM(commentCount) AS commentCount
           FROM community_comments
          GROUP BY userId
       ),
       lifetime_shards AS (
         SELECT la.owner_id AS userId,
                COALESCE(SUM(CASE WHEN le.amount > 0 THEN le.amount ELSE 0 END), 0)
                  AS lifetimeShards
           FROM ledger_accounts la
           JOIN ledger_entries le ON le.account_id = la.id
          WHERE la.owner_type = 'USER'
            AND la.currency = 'SHARDS'
            AND la.account_type = 'AVAILABLE'
          GROUP BY la.owner_id
       ),
       vote_changes AS (
         SELECT author_user_id AS userId,
                SUM(
                  CASE WHEN new_value = 1 THEN 1 ELSE 0 END
                  - CASE WHEN old_value = 1 THEN 1 ELSE 0 END
                ) AS upvoteDelta,
                SUM(
                  CASE WHEN new_value = -1 THEN 1 ELSE 0 END
                  - CASE WHEN old_value = -1 THEN 1 ELSE 0 END
                ) AS downvoteDelta,
                SUM(delta) AS reputation
           FROM discussion_vote_events
          WHERE 1 = 1
            ${after("created_at")}
          GROUP BY author_user_id
       ),
       vote_totals AS (
         SELECT userId,
                MAX(upvoteDelta, 0) AS upvotes,
                MAX(downvoteDelta, 0) AS downvotes,
                reputation
           FROM vote_changes
       ),
       chapter_totals AS (
         SELECT user_id AS userId, COUNT(*) AS chaptersRead
           FROM reading_progress
          WHERE completed_at IS NOT NULL
            ${after("completed_at")}
          GROUP BY user_id
       ),
       scored AS (
         SELECT u.id AS userId,
                up.username,
                u.display_name AS displayName,
                up.avatar_key AS avatarKey,
                up.revision,
                up.show_comments AS communityVisible,
                COALESCE(mt.commentCount, 0) AS commentCount,
                COALESCE(st.shardsCollected, 0) AS shardsCollected,
                COALESCE(ls.lifetimeShards, 0) AS lifetimeShards,
                COALESCE(ct.chaptersRead, 0) AS chaptersRead,
                COALESCE(vt.upvotes, 0) AS upvotes,
                COALESCE(vt.downvotes, 0) AS downvotes,
                COALESCE(vt.reputation, 0) AS reputation,
                COALESCE(st.shardsCollected, 0)
                  + COALESCE(raw_comments.commentCount, 0) * 5
                  + COALESCE(raw_votes.reputation, 0) * 3 AS score
           FROM users u
           JOIN user_profiles up ON up.user_id = u.id
           LEFT JOIN shard_totals st ON st.userId = u.id
           LEFT JOIN lifetime_shards ls ON ls.userId = u.id
           LEFT JOIN comment_totals raw_comments
             ON raw_comments.userId = u.id
           LEFT JOIN comment_totals mt
             ON mt.userId = u.id AND up.show_comments = 1
           LEFT JOIN vote_totals raw_votes
             ON raw_votes.userId = u.id
           LEFT JOIN vote_totals vt
             ON vt.userId = u.id AND up.show_comments = 1
           LEFT JOIN chapter_totals ct
             ON ct.userId = u.id AND up.show_reading_history = 1
          WHERE u.status = 'ACTIVE'
            AND up.profile_visibility = 'PUBLIC'
            AND (
              COALESCE(st.shardsCollected, 0) <> 0
              OR COALESCE(raw_comments.commentCount, 0) <> 0
              OR COALESCE(raw_votes.upvotes, 0) <> 0
              OR COALESCE(raw_votes.downvotes, 0) <> 0
              OR COALESCE(raw_votes.reputation, 0) <> 0
              OR COALESCE(ct.chaptersRead, 0) <> 0
            )
       ),
       ranked AS (
         SELECT ROW_NUMBER() OVER (
                  ORDER BY score DESC,
                           shardsCollected DESC,
                           reputation DESC,
                           commentCount DESC,
                           chaptersRead DESC,
                           userId
                ) AS rank,
                *
           FROM scored
       ),
       top_ranked AS (
         SELECT *
           FROM ranked
          ORDER BY rank
          LIMIT 100
       ),
       selected AS (
         SELECT * FROM top_ranked
         UNION ALL
         SELECT * FROM ranked WHERE userId = ? AND rank > 100
       )
       SELECT rank, userId, username, displayName, avatarKey, revision,
              communityVisible,
              commentCount, shardsCollected, lifetimeShards, chaptersRead,
              upvotes, downvotes, reputation, score
         FROM selected
        ORDER BY rank`,
    )
      .bind(actor?.id ?? "")
      .all<LeaderboardRow>();

    const allRows = rows.results.map(publicEntry);
    const viewer = actor
      ? allRows.find((entry) => entry.userId === actor.id) ?? null
      : null;

    return json(
      requestId,
      {
        data: allRows.filter((entry) => entry.rank <= 100),
        viewer,
        period,
        scoring: {
          shard: 1,
          comment: 5,
          netVote: 3,
        },
      },
      {
        headers: {
          "cache-control": "private, no-store",
          vary: "Cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
