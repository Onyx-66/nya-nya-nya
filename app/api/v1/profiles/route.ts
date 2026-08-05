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
  showFavorites: z.boolean().default(false),
  showAchievements: z.boolean().default(false),
  showBookmarks: z.boolean().default(false),
  showComments: z.boolean().default(false),
  favoriteSeriesIds: z
    .array(z.string().trim().min(1).max(100))
    .max(10)
    .default([])
    .transform((ids) => [...new Set(ids)]),
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

function seriesCoverUrl(series: {
  seriesId: string;
  revision: number;
  coverKey: string | null;
}) {
  if (!series.coverKey) return null;
  if (
    series.coverKey.startsWith("/") ||
    /^https?:\/\//i.test(series.coverKey)
  ) {
    return series.coverKey;
  }
  return `/api/v1/series-media?id=${encodeURIComponent(series.seriesId)}&slot=cover&v=${series.revision}`;
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
              up.show_favorites AS showFavorites,
              up.show_achievements AS showAchievements,
              up.show_bookmarks AS showBookmarks,
              up.show_comments AS showComments,
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
        showFavorites: number;
        showAchievements: number;
        showBookmarks: number;
        showComments: number;
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
      const favoriteCandidates = await env.DB.prepare(
        `SELECT s.id AS seriesId, s.slug AS seriesSlug,
                s.title AS seriesTitle, s.revision,
                s.cover_key AS coverKey
           FROM library_entries le
           JOIN series s ON s.id = le.series_id
          WHERE le.user_id = ?
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          ORDER BY datetime(le.updated_at) DESC, s.title COLLATE NOCASE
          LIMIT 200`,
      )
        .bind(actor.id)
        .all<{
          seriesId: string;
          seriesSlug: string;
          seriesTitle: string;
          revision: number;
          coverKey: string | null;
        }>();
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
            activity: [],
            favorites: [],
            favoriteCandidates: favoriteCandidates.results.map(
              (candidate) => ({
                seriesId: candidate.seriesId,
                seriesSlug: candidate.seriesSlug,
                seriesTitle: candidate.seriesTitle,
                coverUrl: seriesCoverUrl(candidate),
              }),
            ),
            achievements: [],
            bookmarks: [],
            comments: [],
            uploads: [],
            avatarUrl: null,
            bannerUrl: null,
            privacy: {
              profileVisibility: "PUBLIC",
              followersVisibility: "PUBLIC",
              showReadingHistory: false,
              showChapterNumbers: false,
              showFavorites: false,
              showAchievements: false,
              showBookmarks: false,
              showComments: false,
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
    type SeriesRow = {
      seriesId: string;
      seriesSlug: string;
      seriesTitle: string;
      revision: number;
      coverKey: string | null;
      position?: number;
      listType?: string;
      savedAt?: string;
    };
    const [
      favorites,
      achievements,
      bookmarks,
      comments,
      favoriteCandidates,
      uploads,
    ] = await Promise.all([
      isSelf || Boolean(profile.showFavorites)
        ? env.DB.prepare(
            `SELECT s.id AS seriesId, s.slug AS seriesSlug,
                    s.title AS seriesTitle, s.revision,
                    s.cover_key AS coverKey, pfs.position
               FROM profile_favorite_series pfs
               JOIN series s ON s.id = pfs.series_id
              WHERE pfs.user_id = ?
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
              ORDER BY pfs.position
              LIMIT 10`,
          )
            .bind(profile.userId)
            .all<SeriesRow>()
            .then((result) => result.results)
        : Promise.resolve([] as SeriesRow[]),
      isSelf || Boolean(profile.showAchievements)
        ? env.DB.prepare(
            `SELECT ad.slug, ad.name, ad.description, ad.rarity,
                    ad.icon_key AS iconKey, ua.earned_at AS earnedAt,
                    ua.metadata_json AS metadataJson
               FROM user_achievements ua
               JOIN achievement_definitions ad ON ad.id = ua.achievement_id
              WHERE ua.user_id = ? AND ad.is_active = 1
              ORDER BY datetime(ua.earned_at) DESC, ad.sort_order, ad.name
              LIMIT 50`,
          )
            .bind(profile.userId)
            .all<{
              slug: string;
              name: string;
              description: string;
              rarity: string;
              iconKey: string | null;
              earnedAt: string;
              metadataJson: string;
            }>()
            .then((result) => result.results)
        : Promise.resolve([]),
      isSelf || Boolean(profile.showBookmarks)
        ? env.DB.prepare(
            `SELECT s.id AS seriesId, s.slug AS seriesSlug,
                    s.title AS seriesTitle, s.revision,
                    s.cover_key AS coverKey, 'FOLLOWING' AS listType,
                    f.created_at AS savedAt
               FROM follows f
               JOIN series s ON s.id = f.series_id
              WHERE f.user_id = ?
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
              ORDER BY datetime(f.created_at) DESC, s.title COLLATE NOCASE
              LIMIT 30`,
          )
            .bind(profile.userId)
            .all<SeriesRow>()
            .then((result) => result.results)
        : Promise.resolve([] as SeriesRow[]),
      isSelf || Boolean(profile.showComments)
        ? env.DB.prepare(
            `SELECT dc.id, dc.body, dc.series_slug AS seriesSlug,
                    s.id AS seriesId, s.title AS seriesTitle, s.revision,
                    s.cover_key AS coverKey,
                    dc.spoiler, dc.chapter_slug AS chapterSlug,
                    c.chapter_number AS chapterNumber,
                    dc.created_at AS createdAt,
                    (SELECT COUNT(*) FROM discussion_votes dv
                      WHERE dv.comment_id = dc.id AND dv.value = 1) AS upvotes,
                    (SELECT COUNT(*) FROM discussion_votes dv
                      WHERE dv.comment_id = dc.id AND dv.value = -1) AS downvotes,
                    (SELECT COUNT(*) FROM discussion_reactions dr
                      WHERE dr.comment_id = dc.id) AS reactionCount
               FROM discussion_comments dc
               JOIN series s ON s.slug = dc.series_slug
               LEFT JOIN chapters c
                 ON c.series_id = s.id
                AND c.slug = dc.chapter_slug
                AND c.state = 'PUBLISHED'
                AND c.visibility = 'PUBLIC'
                AND c.published_at IS NOT NULL
                AND datetime(c.published_at) <= datetime('now')
              WHERE dc.user_id = ?
                AND dc.moderation_status = 'VISIBLE'
                AND dc.deleted_at IS NULL
                AND (dc.chapter_slug IS NULL OR c.id IS NOT NULL)
                AND s.is_published = 1
                AND s.archived_at IS NULL
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
              ORDER BY datetime(dc.created_at) DESC, dc.id DESC
              LIMIT 30`,
          )
            .bind(profile.userId)
            .all<{
              id: string;
              body: string;
              seriesId: string;
              seriesSlug: string;
              seriesTitle: string;
              revision: number;
              coverKey: string | null;
              spoiler: number;
              chapterSlug: string | null;
              chapterNumber: string | null;
              createdAt: string;
              upvotes: number;
              downvotes: number;
              reactionCount: number;
            }>()
            .then((result) => result.results)
        : Promise.resolve([]),
      isSelf
        ? env.DB.prepare(
            `SELECT s.id AS seriesId, s.slug AS seriesSlug,
                    s.title AS seriesTitle, s.revision,
                    s.cover_key AS coverKey,
                    COALESCE(pfs.position, 0) AS position
               FROM series s
               LEFT JOIN library_entries le
                 ON le.series_id = s.id AND le.user_id = ?
               LEFT JOIN profile_favorite_series pfs
                 ON pfs.series_id = s.id AND pfs.user_id = ?
              WHERE s.is_published = 1
                AND s.archived_at IS NULL
                AND s.rights_status IN
                  ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
                AND (le.user_id IS NOT NULL OR pfs.user_id IS NOT NULL)
              ORDER BY CASE WHEN pfs.position IS NULL THEN 1 ELSE 0 END,
                       pfs.position, datetime(le.updated_at) DESC,
                       s.title COLLATE NOCASE
              LIMIT 200`,
          )
            .bind(profile.userId, profile.userId)
            .all<SeriesRow>()
            .then((result) => result.results)
        : Promise.resolve([] as SeriesRow[]),
      env.DB.prepare(
        `SELECT c.id, c.slug AS chapterSlug,
                c.chapter_number AS chapterNumber, c.language,
                c.version, c.access_type AS accessType,
                c.published_at AS publishedAt,
                s.id AS seriesId, s.slug AS seriesSlug,
                s.title AS seriesTitle, s.revision,
                s.cover_key AS coverKey,
                t.slug AS teamSlug, t.name AS teamName
           FROM chapters c
           JOIN series s ON s.id = c.series_id
           LEFT JOIN teams t ON t.id = c.team_id
          WHERE c.uploader_user_id = ?
            AND c.state = 'PUBLISHED'
            AND c.visibility = 'PUBLIC'
            AND c.published_at IS NOT NULL
            AND datetime(c.published_at) <= datetime('now')
            AND s.is_published = 1
            AND s.archived_at IS NULL
            AND s.rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
          ORDER BY datetime(c.published_at) DESC, c.id DESC
          LIMIT 24`,
      )
        .bind(profile.userId)
        .all<{
          id: string;
          chapterSlug: string;
          chapterNumber: string;
          language: string;
          version: number;
          accessType: string;
          publishedAt: string;
          seriesId: string;
          seriesSlug: string;
          seriesTitle: string;
          revision: number;
          coverKey: string | null;
          teamSlug: string | null;
          teamName: string | null;
        }>()
        .then((result) => result.results),
    ]);
    const visibleCommentIdList = comments.map((comment) => comment.id);
    const visibleCommentIds = new Set(visibleCommentIdList);
    const commentIdPlaceholders = visibleCommentIdList.map(() => "?").join(", ");
    const [commentMediaResult, commentGifsResult] = comments.length
      ? await Promise.all([
          env.DB.prepare(
            `SELECT dm.id, dm.comment_id AS commentId, dm.filename,
                    dm.content_type AS contentType, dm.byte_size AS byteSize,
                    dm.kind, dm.alt_text AS altText
               FROM discussion_media dm
               JOIN discussion_comments dc ON dc.id = dm.comment_id
              WHERE dm.comment_id IN (${commentIdPlaceholders})
                AND dc.user_id = ?
                AND dc.moderation_status = 'VISIBLE'
                AND dc.deleted_at IS NULL
                AND dm.moderation_status = 'READY'
              ORDER BY datetime(dm.created_at), dm.id`,
          )
            .bind(...visibleCommentIdList, profile.userId)
            .all<{
              id: string;
              commentId: string;
              filename: string;
              contentType: string;
              byteSize: number;
              kind: string;
              altText: string;
            }>(),
          env.DB.prepare(
            `SELECT dcg.comment_id AS commentId, cr.id,
                    cr.name, cr.accessible_label AS altText, cr.revision
               FROM discussion_comment_gifs dcg
               JOIN discussion_comments dc ON dc.id = dcg.comment_id
               JOIN custom_reactions cr ON cr.id = dcg.gif_id
              WHERE dcg.comment_id IN (${commentIdPlaceholders})
                AND dc.user_id = ?
                AND dc.moderation_status = 'VISIBLE'
                AND dc.deleted_at IS NULL
              ORDER BY dcg.display_order, datetime(dcg.created_at)`,
          )
            .bind(...visibleCommentIdList, profile.userId)
            .all<{
              commentId: string;
              id: string;
              name: string;
              altText: string;
              revision: number;
            }>(),
        ])
      : [{ results: [] }, { results: [] }];
    const mediaByComment = new Map<string, Array<Record<string, unknown>>>();
    for (const media of commentMediaResult.results) {
      if (!visibleCommentIds.has(media.commentId)) continue;
      const entry = {
        id: media.id,
        filename: media.filename,
        contentType: media.contentType,
        byteSize: media.byteSize,
        kind: media.kind,
        altText: media.altText,
        url: `/api/v1/discussion-media?id=${encodeURIComponent(media.id)}`,
      };
      mediaByComment.set(media.commentId, [
        ...(mediaByComment.get(media.commentId) ?? []),
        entry,
      ]);
    }
    const gifsByComment = new Map<string, Array<Record<string, unknown>>>();
    for (const gif of commentGifsResult.results) {
      if (!visibleCommentIds.has(gif.commentId)) continue;
      const entry = {
        id: gif.id,
        name: gif.name,
        altText: gif.altText,
        url: `/api/v1/reaction-asset?id=${encodeURIComponent(gif.id)}&v=${gif.revision}`,
      };
      gifsByComment.set(gif.commentId, [
        ...(gifsByComment.get(gif.commentId) ?? []),
        entry,
      ]);
    }
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
          followerCount:
            isSelf || profile.followersVisibility === "PUBLIC"
              ? followerCount
              : null,
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
                showFavorites: Boolean(profile.showFavorites),
                showAchievements: Boolean(profile.showAchievements),
                showBookmarks: Boolean(profile.showBookmarks),
                showComments: Boolean(profile.showComments),
              }
            : undefined,
          readingActivity: readingActivity.results.map((activity) => ({
            seriesSlug: activity.seriesSlug,
            seriesTitle: activity.seriesTitle,
            chapterSlug:
              isSelf || profile.showChapterNumbers
                ? activity.chapterSlug
                : null,
            chapterNumber:
              isSelf || profile.showChapterNumbers
                ? activity.chapterNumber
                : null,
            readAt: activity.readAt,
            coverUrl: seriesCoverUrl(activity),
          })),
          activity: readingActivity.results.map((activity) => ({
            seriesSlug: activity.seriesSlug,
            seriesTitle: activity.seriesTitle,
            chapterSlug:
              isSelf || profile.showChapterNumbers
                ? activity.chapterSlug
                : null,
            chapterNumber:
              isSelf || profile.showChapterNumbers
                ? activity.chapterNumber
                : null,
            readAt: activity.readAt,
            coverUrl: seriesCoverUrl(activity),
          })),
          favorites: favorites.map((favorite) => ({
            seriesId: favorite.seriesId,
            seriesSlug: favorite.seriesSlug,
            seriesTitle: favorite.seriesTitle,
            position: favorite.position,
            coverUrl: seriesCoverUrl(favorite),
          })),
          favoriteCandidates: favoriteCandidates.map((candidate) => ({
            seriesId: candidate.seriesId,
            seriesSlug: candidate.seriesSlug,
            seriesTitle: candidate.seriesTitle,
            position: candidate.position,
            coverUrl: seriesCoverUrl(candidate),
          })),
          achievements: achievements.map((achievement) => ({
            ...achievement,
            metadata: (() => {
              try {
                return JSON.parse(achievement.metadataJson) as unknown;
              } catch {
                return {};
              }
            })(),
            metadataJson: undefined,
          })),
          bookmarks: bookmarks.map((bookmark) => ({
            seriesId: bookmark.seriesId,
            seriesSlug: bookmark.seriesSlug,
            seriesTitle: bookmark.seriesTitle,
            listType: bookmark.listType,
            savedAt: bookmark.savedAt,
            coverUrl: seriesCoverUrl(bookmark),
          })),
          comments: comments.map((comment) => ({
            id: comment.id,
            body: comment.body,
            seriesSlug: comment.seriesSlug,
            seriesTitle: comment.seriesTitle,
            spoiler: Boolean(comment.spoiler),
            chapterSlug:
              isSelf || profile.showChapterNumbers
                ? comment.chapterSlug
                : null,
            chapterNumber:
              isSelf || profile.showChapterNumbers
                ? comment.chapterNumber
                : null,
            createdAt: comment.createdAt,
            upvotes: Number(comment.upvotes),
            downvotes: Number(comment.downvotes),
            reactionCount: Number(comment.reactionCount),
            coverUrl: seriesCoverUrl(comment),
            media: mediaByComment.get(comment.id) ?? [],
            gifs: gifsByComment.get(comment.id) ?? [],
          })),
          uploads: uploads.map((upload) => ({
            ...upload,
            coverUrl: seriesCoverUrl(upload),
          })),
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
    if (payload.favoriteSeriesIds.length) {
      const placeholders = payload.favoriteSeriesIds.map(() => "?").join(", ");
      const eligible = await env.DB.prepare(
        `SELECT id
           FROM series
          WHERE id IN (${placeholders})
            AND is_published = 1
            AND archived_at IS NULL
            AND rights_status IN
              ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')`,
      )
        .bind(...payload.favoriteSeriesIds)
        .all<{ id: string }>();
      if (eligible.results.length !== payload.favoriteSeriesIds.length) {
        throw new ApiError(
          400,
          "INVALID_FAVORITE_SERIES",
          "One or more favorite series are unavailable.",
        );
      }
    }
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
            show_chapter_numbers, show_library_summary, show_favorites,
            show_achievements, show_bookmarks, show_comments, social_links_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          0,
          payload.showFavorites ? 1 : 0,
          payload.showAchievements ? 1 : 0,
          payload.showBookmarks ? 1 : 0,
          payload.showComments ? 1 : 0,
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
        ...payload.favoriteSeriesIds.map((seriesId, index) =>
          env.DB.prepare(
            `INSERT INTO profile_favorite_series
             (user_id, series_id, position)
             VALUES (?, ?, ?)`,
          ).bind(actor.id, seriesId, index + 1),
        ),
      ]);
    } else {
      const result = await env.DB.prepare(
        `UPDATE user_profiles
            SET username = ?, normalized_username = ?, bio = ?,
                preferred_language = ?, profile_visibility = ?,
                followers_visibility = ?, show_reading_history = ?,
                show_chapter_numbers = ?, show_library_summary = ?,
                show_favorites = ?, show_achievements = ?,
                show_bookmarks = ?, show_comments = ?,
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
          0,
          payload.showFavorites ? 1 : 0,
          payload.showAchievements ? 1 : 0,
          payload.showBookmarks ? 1 : 0,
          payload.showComments ? 1 : 0,
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
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM profile_favorite_series WHERE user_id = ?",
        ).bind(actor.id),
        ...payload.favoriteSeriesIds.map((seriesId, index) =>
          env.DB.prepare(
            `INSERT INTO profile_favorite_series
             (user_id, series_id, position)
             VALUES (?, ?, ?)`,
          ).bind(actor.id, seriesId, index + 1),
        ),
      ]);
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
