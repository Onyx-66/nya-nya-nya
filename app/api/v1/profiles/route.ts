import { env } from "cloudflare:workers";
import { z } from "zod";
import { ApiError, errorResponse, json } from "@/lib/server/api";
import {
  assertSameOrigin,
  requestIdFor,
} from "@/lib/server/admin-utils";
import { randomId } from "@/lib/server/random-id";
import { getActor, requireActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Use letters, numbers, and underscores only.",
  );

const socialLinkSchema = z.object({
  label: z.string().trim().min(1).max(30),
  url: z
    .string()
    .url()
    .max(300)
    .refine((value) => value.startsWith("https://"), {
      message: "Social links must use HTTPS.",
    }),
});

const patchSchema = z.object({
  username: usernameSchema,
  bio: z.string().trim().max(500).default(""),
  preferredLanguage: z.string().trim().min(2).max(20).default("en"),
  profileVisibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  followersVisibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
  showReadingHistory: z.boolean().default(false),
  showChapterNumbers: z.boolean().default(false),
  showLibrarySummary: z.boolean().default(false),
  socialLinks: z.array(socialLinkSchema).max(5).default([]),
  revision: z.number().int().min(0),
});

function safeArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Profiles are temporarily unavailable.",
      );
    }
    const actor = await getActor().catch(() => null);
    const url = new URL(request.url);
    const requestedUsername = url.searchParams.get("username");
    const username = requestedUsername
      ? usernameSchema.parse(requestedUsername)
      : null;
    if (!username && !actor) {
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in to continue.");
    }
    const profile = await env.DB.prepare(
      `SELECT up.user_id AS userId, up.username, up.bio,
              up.preferred_language AS preferredLanguage,
              up.profile_visibility AS profileVisibility,
              up.followers_visibility AS followersVisibility,
              up.show_reading_history AS showReadingHistory,
              up.show_chapter_numbers AS showChapterNumbers,
              up.show_library_summary AS showLibrarySummary,
              up.social_links_json AS socialLinksJson,
              up.avatar_key AS avatarKey, up.banner_key AS bannerKey,
              up.revision, up.created_at AS createdAt,
              u.display_name AS displayName
         FROM user_profiles up
         JOIN users u ON u.id = up.user_id
        WHERE ${
          username ? "up.normalized_username = ?" : "up.user_id = ?"
        }
          AND u.status = 'ACTIVE'
        LIMIT 1`,
    )
      .bind(username ? username.toLowerCase() : actor!.id)
      .first<{
        userId: string;
        username: string;
        bio: string;
        preferredLanguage: string;
        profileVisibility: string;
        followersVisibility: string;
        showReadingHistory: number;
        showChapterNumbers: number;
        showLibrarySummary: number;
        socialLinksJson: string;
        avatarKey: string | null;
        bannerKey: string | null;
        revision: number;
        createdAt: string;
        displayName: string;
      }>();
    if (!profile && !username && actor) {
      const suggestedUsername = actor.email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 30);
      return json(
        requestId,
        {
          data: {
            username:
              suggestedUsername.length >= 3
                ? suggestedUsername
                : `reader_${actor.id.slice(-8)}`,
            displayName: actor.displayName,
            bio: "",
            preferredLanguage: "en",
            socialLinks: [],
            revision: 0,
            isSelf: true,
            isFollowing: false,
            followerCount: 0,
            followingCount: 0,
            teams: [],
            readingActivity: [],
            librarySummary: [],
            avatarUrl: null,
            bannerUrl: null,
            privacy: {
              profileVisibility: "PUBLIC",
              followersVisibility: "PUBLIC",
              showReadingHistory: false,
              showChapterNumbers: false,
              showLibrarySummary: false,
            },
          },
        },
        {
          headers: {
            "cache-control": "private, no-store",
            vary: "cookie",
          },
        },
      );
    }
    if (!profile) {
      throw new ApiError(404, "PROFILE_NOT_FOUND", "This profile is unavailable.");
    }
    const isSelf = actor?.id === profile.userId;
    if (actor && !isSelf) {
      const block = await env.DB.prepare(
        `SELECT 1
           FROM user_blocks
          WHERE (blocker_user_id = ? AND blocked_user_id = ?)
             OR (blocker_user_id = ? AND blocked_user_id = ?)
          LIMIT 1`,
      )
        .bind(actor.id, profile.userId, profile.userId, actor.id)
        .first();
      if (block) {
        throw new ApiError(404, "PROFILE_NOT_FOUND", "This profile is unavailable.");
      }
    }
    if (!isSelf && profile.profileVisibility !== "PUBLIC") {
      throw new ApiError(404, "PROFILE_PRIVATE", "This profile is private.");
    }
    const [followers, following, membership, relation] = await env.DB.batch([
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM user_follows WHERE followed_user_id = ?",
      ).bind(profile.userId),
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM user_follows WHERE follower_user_id = ?",
      ).bind(profile.userId),
      env.DB.prepare(
        `SELECT t.slug, t.name
           FROM team_memberships tm
           JOIN teams t ON t.id = tm.team_id
          WHERE tm.user_id = ?
            AND tm.status = 'ACTIVE'
            AND t.is_archived = 0
            AND t.verification_status = 'VERIFIED'
          ORDER BY tm.is_primary DESC, t.name COLLATE NOCASE
          LIMIT 3`,
      ).bind(profile.userId),
      actor
        ? env.DB.prepare(
            `SELECT 1 AS following
               FROM user_follows
              WHERE follower_user_id = ? AND followed_user_id = ?
              LIMIT 1`,
          ).bind(actor.id, profile.userId)
        : env.DB.prepare("SELECT 0 AS following"),
    ]);
    const readingActivity =
      isSelf || Boolean(profile.showReadingHistory)
        ? await env.DB.prepare(
            `SELECT s.slug AS seriesSlug, s.title AS seriesTitle,
                    s.id AS seriesId, s.revision, s.cover_key AS coverKey,
                    c.slug AS chapterSlug, c.chapter_number AS chapterNumber,
                    rp.updated_at AS readAt
               FROM reading_progress rp
               JOIN chapters c ON c.id = rp.chapter_id
               JOIN series s ON s.id = c.series_id
              WHERE rp.user_id = ?
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                AND c.state = 'PUBLISHED'
                AND c.visibility = 'PUBLIC'
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
              ORDER BY datetime(rp.updated_at) DESC, c.id DESC
              LIMIT 12`,
          )
            .bind(profile.userId)
            .all<{
              seriesSlug: string;
              seriesTitle: string;
              seriesId: string;
              revision: number;
              coverKey: string | null;
              chapterSlug: string;
              chapterNumber: string;
              readAt: string;
            }>()
        : { results: [] };
    const librarySummary =
      isSelf || Boolean(profile.showLibrarySummary)
        ? await env.DB.prepare(
            `SELECT list_type AS status, COUNT(*) AS count
               FROM library_entries
              WHERE user_id = ?
              GROUP BY list_type
              ORDER BY list_type`,
          )
            .bind(profile.userId)
            .all()
        : { results: [] };
    const followerCount = Number(
      (followers.results[0] as { count?: number } | undefined)?.count ?? 0,
    );
    const followingCount = Number(
      (following.results[0] as { count?: number } | undefined)?.count ?? 0,
    );
    return json(
      requestId,
      {
        data: {
          username: profile.username,
          displayName: profile.displayName,
          bio: profile.bio,
          preferredLanguage: profile.preferredLanguage,
          socialLinks: safeArray(profile.socialLinksJson),
          createdAt: profile.createdAt,
          revision: profile.revision,
          isSelf,
          isFollowing: Boolean(
            (relation.results[0] as { following?: number } | undefined)
              ?.following,
          ),
          followerCount,
          followingCount:
            isSelf || profile.followersVisibility === "PUBLIC"
              ? followingCount
              : null,
          teams: membership.results,
          avatarUrl: profile.avatarKey
            ? `/api/v1/profile-media?username=${encodeURIComponent(profile.username)}&slot=avatar&v=${profile.revision}`
            : null,
          bannerUrl: profile.bannerKey
            ? `/api/v1/profile-media?username=${encodeURIComponent(profile.username)}&slot=banner&v=${profile.revision}`
            : null,
          privacy: isSelf
            ? {
                profileVisibility: profile.profileVisibility,
                followersVisibility: profile.followersVisibility,
                showReadingHistory: Boolean(profile.showReadingHistory),
                showChapterNumbers: Boolean(profile.showChapterNumbers),
                showLibrarySummary: Boolean(profile.showLibrarySummary),
              }
            : undefined,
          readingActivity: readingActivity.results.map((activity) => ({
            ...activity,
            chapterNumber:
              isSelf || profile.showChapterNumbers
                ? activity.chapterNumber
                : null,
            coverUrl: activity.coverKey
              ? activity.coverKey.startsWith("/") ||
                /^https?:\/\//i.test(activity.coverKey)
                ? activity.coverKey
                : `/api/v1/series-media?id=${encodeURIComponent(activity.seriesId)}&slot=cover&v=${activity.revision}`
              : null,
          })),
          librarySummary: librarySummary.results,
        },
      },
      {
        headers: {
          "cache-control": isSelf
            ? "private, no-store"
            : "public, max-age=30, stale-while-revalidate=120",
          vary: "cookie",
        },
      },
    );
  } catch (error) {
    return errorResponse(requestId, error);
  }
}

export async function PATCH(request: Request) {
  const requestId = requestIdFor(request);
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const payload = patchSchema.parse(await request.json());
    if (!env.DB) {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "Profile settings are temporarily unavailable.",
      );
    }
    const normalizedUsername = payload.username.toLowerCase();
    const current = await env.DB.prepare(
      "SELECT revision FROM user_profiles WHERE user_id = ? LIMIT 1",
    )
      .bind(actor.id)
      .first<{ revision: number }>();
    if (!current) {
      if (payload.revision !== 0) {
        throw new ApiError(
          409,
          "PROFILE_CHANGED",
          "Reload the profile before saving.",
        );
      }
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO user_profiles
           (user_id, username, normalized_username, bio, preferred_language,
            profile_visibility, followers_visibility, show_reading_history,
            show_chapter_numbers, show_library_summary, social_links_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          actor.id,
          payload.username,
          normalizedUsername,
          payload.bio,
          payload.preferredLanguage,
          payload.profileVisibility,
          payload.followersVisibility,
          payload.showReadingHistory ? 1 : 0,
          payload.showChapterNumbers ? 1 : 0,
          payload.showLibrarySummary ? 1 : 0,
          JSON.stringify(payload.socialLinks),
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs
           (id, actor_user_id, action, category, source_area, result,
            target_type, target_id, reason, request_id, new_value_json)
           VALUES (?, ?, 'profile.create', 'USERS_ROLES', 'PROFILE', 'SUCCESS',
                   'USER_PROFILE', ?, 'Public profile created.', ?, ?)`,
        ).bind(
          randomId(),
          actor.id,
          actor.id,
          requestId,
          JSON.stringify({ username: payload.username }),
        ),
      ]);
    } else {
      const result = await env.DB.prepare(
        `UPDATE user_profiles
            SET username = ?, normalized_username = ?, bio = ?,
                preferred_language = ?, profile_visibility = ?,
                followers_visibility = ?, show_reading_history = ?,
                show_chapter_numbers = ?, show_library_summary = ?,
                social_links_json = ?, revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND revision = ?`,
      )
        .bind(
          payload.username,
          normalizedUsername,
          payload.bio,
          payload.preferredLanguage,
          payload.profileVisibility,
          payload.followersVisibility,
          payload.showReadingHistory ? 1 : 0,
          payload.showChapterNumbers ? 1 : 0,
          payload.showLibrarySummary ? 1 : 0,
          JSON.stringify(payload.socialLinks),
          actor.id,
          payload.revision,
        )
        .run();
      if (!result.meta.changes) {
        throw new ApiError(
          409,
          "PROFILE_CHANGED",
          "This profile changed in another session. Reload before saving.",
        );
      }
    }
    return json(requestId, {
      saved: true,
      username: payload.username,
      revision: (current?.revision ?? 0) + 1,
    });
  } catch (error) {
    return errorResponse(requestId, error);
  }
}
