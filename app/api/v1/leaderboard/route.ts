import { env } from "cloudflare:workers";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import { requestIdFor } from "@/lib/server/admin-utils";

export const dynamic = "force-dynamic";

type LeaderboardRow = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarKey: string | null;
  revision: number;
  commentCount: number;
  lifetimeShards: number;
  chaptersRead: number;
};

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "The reader leaderboard is temporarily unavailable.",
      );
    }
    // Privacy policy: a public profile remains leaderboard-eligible, but a
    // private activity dimension is excluded from both its displayed total
    // and every ranking tie-breaker. Lifetime Shards are the public primary
    // leaderboard metric and do not have a profile privacy toggle.
    const rows = await env.DB.prepare(
      `WITH shard_totals AS (
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
       comment_totals AS (
         SELECT user_id AS userId, COUNT(*) AS commentCount
           FROM discussion_comments
          WHERE moderation_status = 'VISIBLE' AND deleted_at IS NULL
          GROUP BY user_id
       ),
       chapter_totals AS (
         SELECT user_id AS userId, COUNT(*) AS chaptersRead
           FROM reading_progress
          WHERE completed_at IS NOT NULL
          GROUP BY user_id
       ),
       ranked AS (
         SELECT ROW_NUMBER() OVER (
                  ORDER BY COALESCE(st.lifetimeShards, 0) DESC,
                           COALESCE(ct.chaptersRead, 0) DESC,
                           COALESCE(mt.commentCount, 0) DESC,
                           u.id
                ) AS rank,
                u.id AS userId, up.username, u.display_name AS displayName,
                up.avatar_key AS avatarKey, up.revision,
                COALESCE(mt.commentCount, 0) AS commentCount,
                COALESCE(st.lifetimeShards, 0) AS lifetimeShards,
                COALESCE(ct.chaptersRead, 0) AS chaptersRead
           FROM users u
           JOIN user_profiles up ON up.user_id = u.id
           LEFT JOIN shard_totals st ON st.userId = u.id
           LEFT JOIN comment_totals mt
             ON mt.userId = u.id AND up.show_comments = 1
           LEFT JOIN chapter_totals ct
             ON ct.userId = u.id AND up.show_reading_history = 1
          WHERE u.status = 'ACTIVE'
            AND up.profile_visibility = 'PUBLIC'
       )
       SELECT rank, userId, username, displayName, avatarKey, revision,
              commentCount, lifetimeShards, chaptersRead
         FROM ranked
        ORDER BY rank
        LIMIT 100`,
    ).all<LeaderboardRow>();
    return json(
      requestId,
      {
        data: rows.results.map((row) => ({
          rank: Number(row.rank),
          userId: row.userId,
          username: row.username,
          displayName: row.displayName,
          avatarUrl: row.avatarKey
            ? `/api/v1/profile-media?username=${encodeURIComponent(row.username)}&slot=avatar&v=${row.revision}`
            : null,
          commentCount: Number(row.commentCount),
          lifetimeShards: Number(row.lifetimeShards),
          chaptersRead: Number(row.chaptersRead),
        })),
      },
      {
        headers: {
          "cache-control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
