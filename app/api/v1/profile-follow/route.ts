import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { randomId } from "@/lib/server/random-id";
import { requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
});

async function resolveTarget(username: string) {
  if (!env.DB) {
    throw new ApiError(
      503,
      "DATABASE_UNAVAILABLE",
      "Following is temporarily unavailable.",
    );
  }
  const target = await env.DB.prepare(
    `SELECT up.user_id AS userId, up.username, u.display_name AS displayName
       FROM user_profiles up
       JOIN users u ON u.id = up.user_id
      WHERE up.normalized_username = ?
        AND up.profile_visibility = 'PUBLIC'
        AND u.status = 'ACTIVE'
      LIMIT 1`,
  )
    .bind(username.toLowerCase())
    .first<{ userId: string; username: string; displayName: string }>();
  if (!target) {
    throw new ApiError(404, "PROFILE_NOT_FOUND", "This profile is unavailable.");
  }
  return target;
}

export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = payloadSchema.parse(await request.json());
    const target = await resolveTarget(payload.username);
    if (target.userId === actor.id) {
      throw new ApiError(422, "SELF_FOLLOW", "You cannot follow yourself.");
    }
    const block = await env.DB!.prepare(
      `SELECT 1
         FROM user_blocks
        WHERE (blocker_user_id = ? AND blocked_user_id = ?)
           OR (blocker_user_id = ? AND blocked_user_id = ?)
        LIMIT 1`,
    )
      .bind(actor.id, target.userId, target.userId, actor.id)
      .first();
    if (block) {
      throw new ApiError(403, "FOLLOW_BLOCKED", "This profile cannot be followed.");
    }
    const recent = await env.DB!.prepare(
      `SELECT COUNT(*) AS count
         FROM audit_logs
        WHERE actor_user_id = ?
          AND action IN ('profile.follow', 'profile.unfollow')
          AND datetime(created_at) > datetime('now', '-1 hour')`,
    )
      .bind(actor.id)
      .first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 60) {
      throw new ApiError(
        429,
        "FOLLOW_RATE_LIMITED",
        "Too many follow changes. Try again later.",
      );
    }
    const results = await env.DB!.batch([
      env.DB!.prepare(
        `INSERT OR IGNORE INTO user_follows
         (follower_user_id, followed_user_id)
         VALUES (?, ?)`,
      ).bind(actor.id, target.userId),
      env.DB!.prepare(
        `INSERT INTO audit_logs
         (id, actor_user_id, action, category, source_area, result,
          target_type, target_id, target_label, reason, request_id)
         SELECT ?, ?, 'profile.follow', 'USERS_ROLES', 'PROFILE', 'SUCCESS',
                'USER_PROFILE', ?, ?, 'Reader followed a public profile.', ?
          WHERE changes() = 1`,
      ).bind(
        randomId(),
        actor.id,
        target.userId,
        target.username,
        requestId,
      ),
      env.DB!.prepare(
        `INSERT INTO notifications
         (id, user_id, kind, title, body, dedupe_key)
         SELECT ?, u.id, 'PROFILE_FOLLOW', 'New follower',
                ?, ?
           FROM users u
           LEFT JOIN user_preferences up ON up.user_id = u.id
          WHERE u.id = ?
            AND CASE
                  WHEN json_valid(up.settings_json)
                    THEN COALESCE(
                      json_extract(
                        up.settings_json,
                        '$.notifications.newFollowers'
                      ),
                      1
                    )
                  ELSE 1
                END <> 0
            AND changes() = 1`,
      ).bind(
        randomId(),
        `${actor.displayName} followed your profile.`,
        `profile-follow:${actor.id}:${target.userId}`,
        target.userId,
      ),
    ]);
    return json(requestId, {
      following: true,
      changed: Boolean(results[0]?.meta.changes),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function DELETE(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = payloadSchema.parse(await request.json());
    const target = await resolveTarget(payload.username);
    const result = await env.DB!.prepare(
      `DELETE FROM user_follows
        WHERE follower_user_id = ? AND followed_user_id = ?`,
    )
      .bind(actor.id, target.userId)
      .run();
    if (result.meta.changes) {
      await env.DB!.batch([
        env.DB!.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, category, source_area, result,
            target_type, target_id, target_label, reason, request_id)
           VALUES (?, ?, 'profile.unfollow', 'USERS_ROLES', 'PROFILE',
                   'SUCCESS', 'USER_PROFILE', ?, ?,
                   'Reader unfollowed a public profile.', ?)`,
        ).bind(
          randomId(),
          actor.id,
          target.userId,
          target.username,
          requestId,
        ),
        env.DB!.prepare(
          `DELETE FROM notifications
            WHERE user_id = ? AND dedupe_key = ?`,
        ).bind(
          target.userId,
          `profile-follow:${actor.id}:${target.userId}`,
        ),
      ]);
    }
    return json(requestId, {
      following: false,
      changed: Boolean(result.meta.changes),
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
