import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

const createdAt = text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);
const updatedAt = text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    primaryRole: text("primary_role").notNull().default("USER"),
    status: text("status").notNull().default("ACTIVE"),
    accessRevision: integer("access_revision").notNull().default(1),
    accessUpdateToken: text("access_update_token"),
    emailVerifiedAt: text("email_verified_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("users_email_uidx").on(table.email),
    index("users_role_idx").on(table.primaryRole),
    index("users_created_idx").on(table.createdAt),
  ],
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    assignedByUserId: text("assigned_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    index("user_roles_role_idx").on(table.role, table.userId),
    check(
      "user_roles_role_check",
      sql`${table.role} IN (
        'OWNER',
        'ADMINISTRATOR',
        'MANAGER',
        'MODERATOR',
        'TEAM_LEADER',
        'UPLOADER',
        'USER'
      )`,
    ),
  ],
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("SYSTEM"),
  contentLanguage: text("content_language").notNull().default("en"),
  readerMode: text("reader_mode").notNull().default("VERTICAL"),
  matureContent: integer("mature_content", { mode: "boolean" })
    .notNull()
    .default(false),
  settingsJson: text("settings_json").notNull().default("{}"),
  updatedAt,
});

export const userProfiles = sqliteTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    normalizedUsername: text("normalized_username").notNull(),
    bio: text("bio").notNull().default(""),
    avatarKey: text("avatar_key"),
    bannerKey: text("banner_key"),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    profileVisibility: text("profile_visibility")
      .notNull()
      .default("PUBLIC"),
    followersVisibility: text("followers_visibility")
      .notNull()
      .default("PUBLIC"),
    showReadingHistory: integer("show_reading_history", { mode: "boolean" })
      .notNull()
      .default(false),
    showChapterNumbers: integer("show_chapter_numbers", { mode: "boolean" })
      .notNull()
      .default(false),
    showLibrarySummary: integer("show_library_summary", { mode: "boolean" })
      .notNull()
      .default(false),
    showFavorites: integer("show_favorites", { mode: "boolean" })
      .notNull()
      .default(false),
    showAchievements: integer("show_achievements", { mode: "boolean" })
      .notNull()
      .default(false),
    showBookmarks: integer("show_bookmarks", { mode: "boolean" })
      .notNull()
      .default(false),
    showComments: integer("show_comments", { mode: "boolean" })
      .notNull()
      .default(false),
    socialLinksJson: text("social_links_json").notNull().default("[]"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("user_profiles_username_uidx").on(table.username),
    uniqueIndex("user_profiles_normalized_username_uidx").on(
      table.normalizedUsername,
    ),
    index("user_profiles_visibility_idx").on(
      table.profileVisibility,
      table.updatedAt,
    ),
  ],
);

export const userFollows = sqliteTable(
  "user_follows",
  {
    followerUserId: text("follower_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followedUserId: text("followed_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.followerUserId, table.followedUserId] }),
    check(
      "user_follows_not_self_check",
      sql`${table.followerUserId} <> ${table.followedUserId}`,
    ),
    index("user_follows_followed_idx").on(
      table.followedUserId,
      table.createdAt,
    ),
  ],
);

export const userBlocks = sqliteTable(
  "user_blocks",
  {
    blockerUserId: text("blocker_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: text("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.blockerUserId, table.blockedUserId] }),
    check(
      "user_blocks_not_self_check",
      sql`${table.blockerUserId} <> ${table.blockedUserId}`,
    ),
    index("user_blocks_blocked_idx").on(table.blockedUserId, table.createdAt),
  ],
);

export const siteThemeSettings = sqliteTable("site_theme_settings", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  settingsJson: text("settings_json").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  createdAt,
  updatedAt,
});

export const siteConfigurationSettings = sqliteTable(
  "site_configuration_settings",
  {
    id: text("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull().default(1),
    settingsJson: text("settings_json").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
    createdAt,
    updatedAt,
  },
);

export const commercialSettings = sqliteTable("commercial_settings", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  settingsJson: text("settings_json").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  createdAt,
  updatedAt,
});

export const rewardSettings = sqliteTable("reward_settings", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  settingsJson: text("settings_json").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  createdAt,
  updatedAt,
});

export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    logoKey: text("logo_key"),
    bannerKey: text("banner_key"),
    staffBadgeKey: text("staff_badge_key"),
    commentEffectType: text("comment_effect_type")
      .notNull()
      .default("NONE"),
    commentEffectConfigJson: text("comment_effect_config_json")
      .notNull()
      .default("{}"),
    commentEffectEnabled: integer("comment_effect_enabled", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    verificationStatus: text("verification_status")
      .notNull()
      .default("PENDING"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    canControlFixedReaderPages: integer("can_control_fixed_reader_pages", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("teams_slug_uidx").on(table.slug),
    index("teams_status_idx").on(
      table.isArchived,
      table.verificationStatus,
      table.updatedAt,
    ),
  ],
);

export const teamMemberships = sqliteTable(
  "team_memberships",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    membershipRole: text("membership_role").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    joinedAt: createdAt,
    updatedAt,
    revision: integer("revision").notNull().default(1),
    canRequestSeries: integer("can_request_series", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_memberships_user_idx").on(table.userId),
    uniqueIndex("team_membership_primary_uidx")
      .on(table.userId)
      .where(
        sql`${table.isPrimary} = 1 AND ${table.status} = 'ACTIVE'`,
      ),
  ],
);

export const teamDiscussionPosts = sqliteTable(
  "team_discussion_posts",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => teamDiscussionPosts.id,
      { onDelete: "cascade" },
    ),
    depth: integer("depth").notNull().default(0),
    body: text("body").notNull(),
    idempotencyKey: text("idempotency_key"),
    moderationStatus: text("moderation_status")
      .notNull()
      .default("VISIBLE"),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "team_discussion_posts_depth_check",
      sql`${table.depth} IN (0, 1)`,
    ),
    check(
      "team_discussion_posts_status_check",
      sql`${table.moderationStatus} IN ('VISIBLE', 'DELETED', 'HIDDEN')`,
    ),
    check(
      "team_discussion_posts_parent_check",
      sql`(${table.depth} = 0 AND ${table.parentId} IS NULL)
        OR (${table.depth} = 1 AND ${table.parentId} IS NOT NULL)`,
    ),
    index("team_discussion_posts_team_recent_idx").on(
      table.teamId,
      table.moderationStatus,
      table.createdAt,
      table.id,
    ),
    index("team_discussion_posts_parent_idx").on(
      table.parentId,
      table.createdAt,
    ),
    index("team_discussion_posts_user_recent_idx").on(
      table.userId,
      table.createdAt,
    ),
    uniqueIndex("team_discussion_posts_idempotency_uidx")
      .on(table.teamId, table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);

export const teamDiscussionVotes = sqliteTable(
  "team_discussion_votes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => teamDiscussionPosts.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.postId] }),
    check(
      "team_discussion_votes_value_check",
      sql`${table.value} IN (-1, 1)`,
    ),
    index("team_discussion_votes_post_idx").on(table.postId, table.value),
    index("team_discussion_votes_user_recent_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const teamDiscussionMentions = sqliteTable(
  "team_discussion_mentions",
  {
    postId: text("post_id")
      .notNull()
      .references(() => teamDiscussionPosts.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    targetType: text("target_type").notNull(),
    targetUserId: text("target_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    targetSeriesId: text("target_series_id").references(
      (): AnySQLiteColumn => series.id,
      { onDelete: "cascade" },
    ),
    token: text("token").notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.ordinal] }),
    check(
      "team_discussion_mentions_target_check",
      sql`(
        ${table.targetType} = 'USER'
        AND ${table.targetUserId} IS NOT NULL
        AND ${table.targetSeriesId} IS NULL
      ) OR (
        ${table.targetType} = 'SERIES'
        AND ${table.targetUserId} IS NULL
        AND ${table.targetSeriesId} IS NOT NULL
      )`,
    ),
    index("team_discussion_mentions_user_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
    index("team_discussion_mentions_series_idx").on(
      table.targetSeriesId,
      table.createdAt,
    ),
  ],
);

export const discussionVoteEvents = sqliteTable(
  "discussion_vote_events",
  {
    id: text("id").primaryKey(),
    voterUserId: text("voter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    oldValue: integer("old_value").notNull(),
    newValue: integer("new_value").notNull(),
    delta: integer("delta").notNull(),
    createdAt,
  },
  (table) => [
    check(
      "discussion_vote_events_target_check",
      sql`${table.targetType} IN ('SERIES', 'TEAM')`,
    ),
    check(
      "discussion_vote_events_old_value_check",
      sql`${table.oldValue} IN (-1, 0, 1)`,
    ),
    check(
      "discussion_vote_events_new_value_check",
      sql`${table.newValue} IN (-1, 0, 1)`,
    ),
    check(
      "discussion_vote_events_delta_check",
      sql`${table.delta} = ${table.newValue} - ${table.oldValue}
        AND ${table.delta} <> 0`,
    ),
    index("discussion_vote_events_author_time_idx").on(
      table.authorUserId,
      table.createdAt,
    ),
    index("discussion_vote_events_voter_time_idx").on(
      table.voterUserId,
      table.createdAt,
    ),
    index("discussion_vote_events_target_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
  ],
);

export const publishers = sqliteTable(
  "publishers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull().default(""),
    archivedAt: text("archived_at"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("publishers_normalized_name_uidx").on(table.normalizedName),
    index("publishers_active_idx").on(table.archivedAt, table.name),
  ],
);

export const series = sqliteTable(
  "series",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    nativeTitle: text("native_title"),
    synopsis: text("synopsis").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    originCountry: text("origin_country").notNull(),
    originalLanguage: text("original_language").notNull(),
    readingDirection: text("reading_direction").notNull(),
    publicationYear: integer("publication_year"),
    publisherId: text("publisher_id").references(() => publishers.id, {
      onDelete: "set null",
    }),
    ageRating: text("age_rating").notNull().default("TEEN"),
    accessType: text("access_type").notNull().default("FREE"),
    coverKey: text("cover_key"),
    bannerKey: text("banner_key"),
    sliderKey: text("slider_key"),
    ratingTenths: integer("rating_tenths").notNull().default(0),
    followerCount: integer("follower_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    rightsStatus: text("rights_status").notNull().default("DEMO_ORIGINAL"),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    archivedAt: text("archived_at"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("series_slug_uidx").on(table.slug),
    index("series_discovery_idx").on(
      table.isPublished,
      table.status,
      table.accessType,
    ),
    index("series_title_lookup_idx").on(table.title, table.updatedAt),
    index("series_publisher_idx").on(table.publisherId),
  ],
);

export const seriesGalleryAssets = sqliteTable(
  "series_gallery_assets",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteSize: integer("byte_size").notNull(),
    orientation: text("orientation").notNull(),
    caption: text("caption").notNull().default(""),
    altText: text("alt_text").notNull().default(""),
    language: text("language"),
    volume: text("volume"),
    coverType: text("cover_type"),
    submittedByUserId: text("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submitterTeamId: text("submitter_team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    moderationStatus: text("moderation_status")
      .notNull()
      .default("PENDING"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: text("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    displayOrder: integer("display_order").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("series_gallery_public_idx").on(
      table.seriesId,
      table.kind,
      table.moderationStatus,
      table.displayOrder,
      table.createdAt,
    ),
    index("series_gallery_moderation_idx").on(
      table.moderationStatus,
      table.createdAt,
      table.id,
    ),
    index("series_gallery_submitter_idx").on(
      table.submittedByUserId,
      table.createdAt,
    ),
    check(
      "series_gallery_kind_check",
      sql`${table.kind} IN ('ART', 'COVER')`,
    ),
    check(
      "series_gallery_orientation_check",
      sql`${table.orientation} IN ('LANDSCAPE', 'PORTRAIT')`,
    ),
    check(
      "series_gallery_moderation_check",
      sql`${table.moderationStatus} IN ('PENDING', 'APPROVED', 'REJECTED')`,
    ),
    check(
      "series_gallery_dimensions_check",
      sql`${table.width} > 0 AND ${table.height} > 0 AND ${table.byteSize} > 0`,
    ),
    check(
      "series_gallery_ratio_check",
      sql`(
        (${table.orientation} = 'LANDSCAPE' AND ${table.width} * 9 = ${table.height} * 16)
        OR
        (${table.orientation} = 'PORTRAIT' AND ${table.width} * 3 = ${table.height} * 2)
      )`,
    ),
  ],
);

export const seriesTeamAssignments = sqliteTable(
  "series_team_assignments",
  {
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    canUpload: integer("can_upload", { mode: "boolean" })
      .notNull()
      .default(true),
    canPublish: integer("can_publish", { mode: "boolean" })
      .notNull()
      .default(false),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    assignedByUserId: text("assigned_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: createdAt,
    allowedLanguagesJson: text("allowed_languages_json")
      .notNull()
      .default("[]"),
    uploadRequiresReview: integer("upload_requires_review", { mode: "boolean" })
      .notNull()
      .default(true),
    revokedAt: text("revoked_at"),
    revokedByUserId: text("revoked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    restrictionReason: text("restriction_reason").notNull().default(""),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.seriesId, table.teamId] }),
    index("series_team_assignments_team_idx").on(table.teamId),
    index("series_team_assignments_rights_idx").on(
      table.teamId,
      table.revokedAt,
      table.canUpload,
    ),
    check(
      "series_team_publish_requires_upload_check",
      sql`${table.canPublish} = 0 OR ${table.canUpload} = 1`,
    ),
    uniqueIndex("series_team_primary_uidx")
      .on(table.seriesId)
      .where(sql`${table.isPrimary} = 1`),
  ],
);

export const profileFavoriteSeries = sqliteTable(
  "profile_favorite_series",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.seriesId] }),
    uniqueIndex("profile_favorite_series_position_uidx").on(
      table.userId,
      table.position,
    ),
    index("profile_favorite_series_series_idx").on(
      table.seriesId,
      table.createdAt,
    ),
    check(
      "profile_favorite_series_position_check",
      sql`${table.position} >= 1 AND ${table.position} <= 10`,
    ),
  ],
);

export const achievementDefinitions = sqliteTable(
  "achievement_definitions",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    rarity: text("rarity").notNull().default("COMMON"),
    iconKey: text("icon_key"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("achievement_definitions_slug_uidx").on(table.slug),
    index("achievement_definitions_public_idx").on(
      table.isActive,
      table.sortOrder,
    ),
    check(
      "achievement_definitions_rarity_check",
      sql`${table.rarity} IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'EXCLUSIVE')`,
    ),
  ],
);

export const userAchievements = sqliteTable(
  "user_achievements",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id")
      .notNull()
      .references(() => achievementDefinitions.id, { onDelete: "cascade" }),
    earnedAt: text("earned_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    metadataJson: text("metadata_json").notNull().default("{}"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.achievementId] }),
    index("user_achievements_recent_idx").on(table.userId, table.earnedAt),
  ],
);

export const seriesAliases = sqliteTable(
  "series_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias"),
    language: text("language").notNull().default("en"),
  },
  (table) => [
    uniqueIndex("series_alias_uidx").on(table.seriesId, table.alias),
    uniqueIndex("series_alias_normalized_uidx").on(
      table.seriesId,
      table.normalizedAlias,
    ),
    index("series_alias_search_idx").on(table.alias),
    index("series_alias_normalized_search_idx").on(table.normalizedAlias),
  ],
);

export const creators = sqliteTable(
  "creators",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name"),
    biography: text("biography").notNull().default(""),
    archivedAt: text("archived_at"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("creators_name_uidx").on(table.name),
    uniqueIndex("creators_normalized_name_uidx").on(table.normalizedName),
    index("creators_active_idx").on(table.archivedAt, table.name),
  ],
);

export const seriesCreators = sqliteTable(
  "series_creators",
  {
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.seriesId, table.creatorId, table.role] }),
    check(
      "series_creators_role_check",
      sql`${table.role} IN ('AUTHOR', 'ARTIST')`,
    ),
    index("series_creators_creator_idx").on(table.creatorId, table.role),
  ],
);

export const genres = sqliteTable(
  "genres",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    normalizedKey: text("normalized_key"),
    archivedAt: text("archived_at"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt: text("updated_at"),
  },
  (table) => [
    uniqueIndex("genres_slug_uidx").on(table.slug),
    uniqueIndex("genres_name_uidx").on(table.name),
    uniqueIndex("genres_normalized_key_uidx").on(table.normalizedKey),
    index("genres_active_idx").on(table.archivedAt, table.name),
  ],
);

export const seriesExternalSources = sqliteTable(
  "series_external_sources",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull().default(""),
    responseHash: text("response_hash"),
    lastImportedAt: text("last_imported_at"),
    lastImportedByUserId: text("last_imported_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("series_external_source_uidx").on(
      table.source,
      table.externalId,
    ),
    uniqueIndex("series_external_series_uidx").on(
      table.seriesId,
      table.source,
    ),
    index("series_external_series_idx").on(table.seriesId, table.source),
  ],
);

export const seriesRequests = sqliteTable(
  "series_requests",
  {
    id: text("id").primaryKey(),
    submittingTeamId: text("submitting_team_id")
      .notNull()
      .references(() => teams.id),
    submitterUserId: text("submitter_user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("DRAFT"),
    primaryTitle: text("primary_title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    alternativeTitlesJson: text("alternative_titles_json")
      .notNull()
      .default("[]"),
    description: text("description").notNull(),
    seriesType: text("series_type").notNull(),
    publicationStatus: text("publication_status").notNull(),
    authorsJson: text("authors_json").notNull().default("[]"),
    artistsJson: text("artists_json").notNull().default("[]"),
    publisherName: text("publisher_name").notNull().default(""),
    originCountry: text("origin_country").notNull(),
    originalLanguage: text("original_language").notNull(),
    readingDirection: text("reading_direction")
      .notNull()
      .default("RIGHT_TO_LEFT"),
    genresJson: text("genres_json").notNull().default("[]"),
    coverKey: text("cover_key"),
    bannerKey: text("banner_key"),
    mangaDexId: text("mangadex_id"),
    mangaDexUrl: text("mangadex_url"),
    mangaUpdatesId: text("mangaupdates_id"),
    mangaUpdatesUrl: text("mangaupdates_url"),
    canonicalSourceUrl: text("canonical_source_url"),
    submitterNotes: text("submitter_notes").notNull().default(""),
    duplicateConfirmation: integer("duplicate_confirmation", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    duplicateExplanation: text("duplicate_explanation").notNull().default(""),
    duplicateRiskScore: integer("duplicate_risk_score").notNull().default(0),
    duplicateMatchesJson: text("duplicate_matches_json")
      .notNull()
      .default("[]"),
    assignedReviewerUserId: text("assigned_reviewer_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    approvedSeriesId: text("approved_series_id").references(() => series.id, {
      onDelete: "set null",
    }),
    revision: integer("revision").notNull().default(1),
    submittedAt: text("submitted_at"),
    reviewStartedAt: text("review_started_at"),
    reviewedAt: text("reviewed_at"),
    withdrawnAt: text("withdrawn_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "series_requests_status_check",
      sql`${table.status} IN (
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'CHANGES_REQUESTED',
        'APPROVED',
        'REJECTED',
        'WITHDRAWN'
      )`,
    ),
    check(
      "series_requests_type_check",
      sql`${table.seriesType} IN ('MANGA', 'MANHWA', 'MANHUA')`,
    ),
    check(
      "series_requests_publication_status_check",
      sql`${table.publicationStatus} IN (
        'ONGOING',
        'COMPLETED',
        'HIATUS',
        'UPCOMING'
      )`,
    ),
    index("series_requests_queue_idx").on(
      table.status,
      table.submittedAt,
      table.id,
    ),
    index("series_requests_team_idx").on(
      table.submittingTeamId,
      table.status,
      table.updatedAt,
    ),
    index("series_requests_submitter_idx").on(
      table.submitterUserId,
      table.updatedAt,
    ),
    index("series_requests_reviewer_idx").on(
      table.assignedReviewerUserId,
      table.status,
      table.submittedAt,
    ),
    index("series_requests_normalized_title_idx").on(table.normalizedTitle),
    uniqueIndex("series_requests_mangadex_active_uidx")
      .on(table.mangaDexId)
      .where(
        sql`${table.mangaDexId} IS NOT NULL
          AND ${table.status} IN (
            'SUBMITTED',
            'UNDER_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED'
          )`,
      ),
    uniqueIndex("series_requests_mangaupdates_active_uidx")
      .on(table.mangaUpdatesId)
      .where(
        sql`${table.mangaUpdatesId} IS NOT NULL
          AND ${table.status} IN (
            'SUBMITTED',
            'UNDER_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED'
          )`,
      ),
    uniqueIndex("series_requests_canonical_source_active_uidx")
      .on(table.canonicalSourceUrl)
      .where(
        sql`${table.canonicalSourceUrl} IS NOT NULL
          AND ${table.status} IN (
            'SUBMITTED',
            'UNDER_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED'
          )`,
      ),
  ],
);

export const seriesRequestTeams = sqliteTable(
  "series_request_teams",
  {
    requestId: text("request_id")
      .notNull()
      .references(() => seriesRequests.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    requestedCanUpload: integer("requested_can_upload", { mode: "boolean" })
      .notNull()
      .default(true),
    requestedCanPublish: integer("requested_can_publish", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.requestId, table.teamId] }),
    index("series_request_teams_team_idx").on(table.teamId, table.requestId),
    uniqueIndex("series_request_teams_primary_uidx")
      .on(table.requestId)
      .where(sql`${table.isPrimary} = 1`),
  ],
);

export const seriesRequestRevisions = sqliteTable(
  "series_request_revisions",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => seriesRequests.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    authorUserId: text("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    changedFieldsJson: text("changed_fields_json").notNull().default("[]"),
    createdAt,
  },
  (table) => [
    uniqueIndex("series_request_revisions_number_uidx").on(
      table.requestId,
      table.revisionNumber,
    ),
    index("series_request_revisions_request_idx").on(
      table.requestId,
      table.createdAt,
    ),
    check(
      "series_request_revisions_kind_check",
      sql`${table.kind} IN (
        'SUBMISSION',
        'RESUBMISSION',
        'APPROVAL',
        'ATTACHED_TO_EXISTING'
      )`,
    ),
  ],
);

export const seriesRequestFeedback = sqliteTable(
  "series_request_feedback",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id")
      .notNull()
      .references(() => seriesRequests.id, { onDelete: "cascade" }),
    requestRevision: integer("request_revision").notNull(),
    authorUserId: text("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility").notNull().default("SUBMITTER"),
    kind: text("kind").notNull().default("COMMENT"),
    fieldPath: text("field_path"),
    body: text("body").notNull(),
    createdAt,
  },
  (table) => [
    check(
      "series_request_feedback_visibility_check",
      sql`${table.visibility} IN ('SUBMITTER', 'INTERNAL')`,
    ),
    check(
      "series_request_feedback_kind_check",
      sql`${table.kind} IN (
        'COMMENT',
        'CHANGE_REQUEST',
        'REJECTION',
        'APPROVAL',
        'ASSIGNMENT'
      )`,
    ),
    index("series_request_feedback_request_idx").on(
      table.requestId,
      table.createdAt,
    ),
  ],
);

export const metadataImportCache = sqliteTable(
  "metadata_import_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    responseJson: text("response_json").notNull(),
    responseHash: text("response_hash").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("metadata_import_cache_expiry_idx").on(table.expiresAt),
  ],
);

export const metadataImportLogs = sqliteTable(
  "metadata_import_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    seriesId: text("series_id").references(() => series.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    action: text("action").notNull(),
    result: text("result").notNull(),
    safeMessage: text("safe_message").notNull().default(""),
    requestId: text("request_id").notNull(),
    createdAt,
  },
  (table) => [
    index("metadata_import_actor_time_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    index("metadata_import_source_idx").on(
      table.source,
      table.externalId,
      table.createdAt,
    ),
  ],
);

export const seriesGenres = sqliteTable(
  "series_genres",
  {
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    genreId: text("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.seriesId, table.genreId] }),
    index("series_genres_genre_idx").on(table.genreId, table.seriesId),
  ],
);

export const editorPicks = sqliteTable(
  "editor_picks",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    categoryLabel: text("category_label").notNull().default("Featured"),
    shortDescription: text("short_description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("editor_picks_series_uidx").on(table.seriesId),
    index("editor_picks_public_idx").on(table.isPublished, table.sortOrder),
  ],
);

export const homepageSliders = sqliteTable(
  "homepage_sliders",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id").references(() => series.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    categoryLabel: text("category_label").notNull().default("Featured"),
    shortDescription: text("short_description").notNull().default(""),
    destinationUrl: text("destination_url").notNull().default(""),
    imageKey: text("image_key"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("homepage_sliders_active_idx").on(
      table.isActive,
      table.sortOrder,
      table.createdAt,
    ),
    index("homepage_sliders_series_idx").on(table.seriesId),
  ],
);

export const siteAnnouncements = sqliteTable(
  "site_announcements",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull().default("NOTICE"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    linkLabel: text("link_label").notNull().default(""),
    linkUrl: text("link_url").notNull().default(""),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("site_announcements_public_idx").on(
      table.isActive,
      table.startsAt,
      table.endsAt,
      table.sortOrder,
    ),
    check(
      "site_announcements_type_check",
      sql`${table.type} IN ('UPDATE', 'ISSUE', 'SUPPORT', 'NOTICE')`,
    ),
    check(
      "site_announcements_date_check",
      sql`${table.endsAt} IS NULL OR ${table.startsAt} IS NULL OR datetime(${table.endsAt}) > datetime(${table.startsAt})`,
    ),
  ],
);

export const floatingAds = sqliteTable(
  "floating_ads",
  {
    id: text("id").primaryKey(),
    eyebrow: text("eyebrow").notNull().default("Support NyaScans"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    destinationUrl: text("destination_url").notNull().default(""),
    imageKey: text("image_key"),
    fallbackImageUrl: text("fallback_image_url").notNull().default(""),
    effect: text("effect").notNull().default("WAVE"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    resetKey: text("reset_key").notNull(),
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("floating_ads_active_idx").on(table.isActive, table.updatedAt),
    uniqueIndex("floating_ads_single_active_uidx")
      .on(table.isActive)
      .where(sql`${table.isActive} = 1`),
    check(
      "floating_ads_effect_check",
      sql`${table.effect} IN ('WAVE', 'PULSE', 'GLOW')`,
    ),
  ],
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => teams.id),
    uploaderUserId: text("uploader_user_id").references(() => users.id),
    slug: text("slug").notNull(),
    volume: text("volume"),
    chapterNumber: text("chapter_number").notNull(),
    title: text("title").notNull().default(""),
    language: text("language").notNull().default("en"),
    format: text("format").notNull().default("VERTICAL"),
    state: text("state").notNull().default("DRAFT"),
    accessType: text("access_type").notNull().default("FREE"),
    priceOnyx: integer("price_onyx").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
    publishedAt: text("published_at"),
    freeAt: text("free_at"),
    version: integer("version").notNull().default(1),
    releaseNotes: text("release_notes").notNull().default(""),
    creditsJson: text("credits_json").notNull().default("{}"),
    thumbnailKey: text("thumbnail_key"),
    visibility: text("visibility").notNull().default("PUBLIC"),
    commentsEnabled: integer("comments_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    includeFixedFirstPage: integer("include_fixed_first_page", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    includeFixedLastPage: integer("include_fixed_last_page", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("chapters_series_slug_uidx").on(table.seriesId, table.slug),
    index("chapters_feed_idx").on(table.state, table.publishedAt),
    index("chapters_latest_release_idx").on(
      table.state,
      table.publishedAt,
      table.createdAt,
      table.id,
    ),
    index("chapters_series_latest_idx").on(
      table.seriesId,
      table.state,
      table.publishedAt,
      table.createdAt,
      table.id,
    ),
    index("chapters_release_identity_idx").on(
      table.seriesId,
      table.chapterNumber,
      table.language,
      table.teamId,
      table.version,
    ),
    index("chapters_visibility_idx").on(
      table.visibility,
      table.state,
      table.publishedAt,
    ),
    check(
      "chapters_visibility_check",
      sql`${table.visibility} IN ('PUBLIC', 'UNLISTED', 'HIDDEN')`,
    ),
  ],
);

export const chapterAccessDecisions = sqliteTable(
  "chapter_access_decisions",
  {
    id: text("id").primaryKey(),
    uploadJobId: text("upload_job_id"),
    uploadJobItemId: text("upload_job_item_id"),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    referenceChapterId: text("reference_chapter_id").references(
      () => chapters.id,
      { onDelete: "set null" },
    ),
    referenceChapterNumber: text("reference_chapter_number").notNull(),
    reason: text("reason").notNull(),
    requestedAccessType: text("requested_access_type").notNull().default("FREE"),
    forcedPriceOnyx: integer("forced_price_onyx").notNull(),
    status: text("status").notNull().default("PENDING"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note").notNull().default(""),
    revision: integer("revision").notNull().default(1),
    resolvedAt: text("resolved_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("chapter_access_decisions_chapter_uidx").on(table.chapterId),
    index("chapter_access_decisions_status_idx").on(
      table.status,
      table.createdAt,
    ),
    index("chapter_access_decisions_reference_idx").on(
      table.referenceChapterId,
      table.createdAt,
    ),
    check(
      "chapter_access_decisions_reason_check",
      sql`${table.reason} IN ('SAME_CHAPTER_VERSION', 'PREVIOUS_CHAPTER')`,
    ),
    check(
      "chapter_access_decisions_status_check",
      sql`${table.status} IN ('PENDING', 'KEPT_PAID', 'MADE_FREE')`,
    ),
    check(
      "chapter_access_decisions_price_check",
      sql`${table.forcedPriceOnyx} > 0`,
    ),
  ],
);

export const chapterPages = sqliteTable(
  "chapter_pages",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    pageIndex: integer("page_index").notNull(),
    objectKey: text("object_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sha256: text("sha256").notNull(),
    processingStatus: text("processing_status").notNull().default("READY"),
    createdAt,
  },
  (table) => [
    uniqueIndex("chapter_pages_order_uidx").on(
      table.chapterId,
      table.pageIndex,
    ),
  ],
);

export const libraryEntries = sqliteTable(
  "library_entries",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    listType: text("list_type").notNull().default("READING"),
    isFavorite: integer("is_favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    notificationsEnabled: integer("notifications_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.seriesId] }),
    index("library_entries_user_list_idx").on(table.userId, table.listType),
  ],
);

export const readingProgress = sqliteTable(
  "reading_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    pageIndex: integer("page_index").notNull().default(0),
    scrollOffset: integer("scroll_offset").notNull().default(0),
    progressBasisPoints: integer("progress_basis_points").notNull().default(0),
    completedAt: text("completed_at"),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapterId] }),
    index("reading_progress_recent_idx").on(table.userId, table.updatedAt),
  ],
);

export const chapterRewardSessions = sqliteTable(
  "chapter_reward_sessions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    activeSeconds: integer("active_seconds").notNull().default(0),
    startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastHeartbeatAt: text("last_heartbeat_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapterId] }),
    index("chapter_reward_sessions_active_idx").on(
      table.userId,
      table.activeSeconds,
      table.updatedAt,
    ),
    check(
      "chapter_reward_sessions_seconds_check",
      sql`${table.activeSeconds} >= 0`,
    ),
  ],
);

export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    visitorId: text("visitor_id"),
    eventType: text("event_type").notNull(),
    seriesSlug: text("series_slug"),
    chapterSlug: text("chapter_slug"),
    regionCode: text("region_code"),
    createdAt,
  },
  (table) => [
    check(
      "analytics_events_type_check",
      sql`${table.eventType} IN (
        'HOME_VIEW',
        'LATEST_VIEW',
        'BROWSE_VIEW',
        'SERIES_VIEW',
        'CHAPTER_START',
        'CHAPTER_COMPLETE'
      )`,
    ),
    index("analytics_events_time_idx").on(table.createdAt, table.eventType),
    index("analytics_events_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("analytics_events_visitor_idx").on(
      table.visitorId,
      table.createdAt,
    ),
    index("analytics_events_series_idx").on(
      table.seriesSlug,
      table.createdAt,
    ),
    index("analytics_events_region_time_idx").on(
      table.regionCode,
      table.createdAt,
    ),
  ],
);

export const follows = sqliteTable(
  "follows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.seriesId] }),
    index("follows_series_user_idx").on(table.seriesId, table.userId),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    body: text("body").notNull().default(""),
    spoiler: integer("spoiler", { mode: "boolean" }).notNull().default(false),
    moderationStatus: text("moderation_status").notNull().default("VISIBLE"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("reviews_user_series_uidx").on(table.userId, table.seriesId),
    index("reviews_series_idx").on(table.seriesId, table.createdAt),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    body: text("body").notNull(),
    spoiler: integer("spoiler", { mode: "boolean" }).notNull().default(false),
    moderationStatus: text("moderation_status").notNull().default("VISIBLE"),
    createdAt,
    updatedAt,
  },
  (table) => [index("comments_chapter_idx").on(table.chapterId, table.createdAt)],
);

export const discussionComments = sqliteTable(
  "discussion_comments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seriesSlug: text("series_slug").notNull(),
    chapterSlug: text("chapter_slug"),
    parentId: text("parent_id"),
    depth: integer("depth").notNull().default(0),
    body: text("body").notNull(),
    spoiler: integer("spoiler", { mode: "boolean" }).notNull().default(false),
    affiliationTeamId: text("affiliation_team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    cosmeticItemId: text("cosmetic_item_id").references(() => storeItems.id, {
      onDelete: "set null",
    }),
    moderationStatus: text("moderation_status").notNull().default("VISIBLE"),
    pinnedAt: text("pinned_at"),
    pinnedByUserId: text("pinned_by_user_id").references(() => users.id),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    deletionReason: text("deletion_reason"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "discussion_comments_depth_check",
      sql`${table.depth} >= 0 AND ${table.depth} <= 4`,
    ),
    check(
      "discussion_comments_self_parent_check",
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
    index("discussion_comments_scope_idx").on(
      table.seriesSlug,
      table.chapterSlug,
      table.createdAt,
    ),
    index("discussion_comments_series_recent_idx").on(
      table.seriesSlug,
      table.createdAt,
      table.id,
    ),
    index("discussion_comments_parent_idx").on(table.parentId, table.createdAt),
    index("discussion_comments_user_idx").on(table.userId, table.createdAt),
    index("discussion_comments_feed_idx").on(
      table.moderationStatus,
      table.createdAt,
    ),
    index("discussion_comments_pinned_idx").on(
      table.seriesSlug,
      table.pinnedAt,
    ),
    index("discussion_comments_affiliation_team_idx").on(
      table.affiliationTeamId,
      table.createdAt,
    ),
  ],
);

export const customReactions = sqliteTable(
  "custom_reactions",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    accessibleLabel: text("accessible_label").notNull(),
    emojiFallback: text("emoji_fallback").notNull().default(""),
    assetKey: text("asset_key"),
    contentType: text("content_type"),
    width: integer("width"),
    height: integer("height"),
    byteSize: integer("byte_size"),
    isAnimated: integer("is_animated", { mode: "boolean" })
      .notNull()
      .default(false),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    displayOrder: integer("display_order").notNull().default(0),
    category: text("category"),
    usageKind: text("usage_kind").notNull().default("REACTION"),
    availabilityJson: text("availability_json").notNull().default("{}"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "custom_reactions_usage_kind_check",
      sql`${table.usageKind} IN ('REACTION', 'COMMENT_GIF')`,
    ),
    uniqueIndex("custom_reactions_slug_uidx").on(table.slug),
    index("custom_reactions_public_idx").on(
      table.isActive,
      table.isArchived,
      table.displayOrder,
    ),
  ],
);

export const discussionCommentGifs = sqliteTable(
  "discussion_comment_gifs",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => discussionComments.id, { onDelete: "cascade" }),
    gifId: text("gif_id")
      .notNull()
      .references(() => customReactions.id, { onDelete: "restrict" }),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.gifId] }),
    index("discussion_comment_gifs_comment_idx").on(
      table.commentId,
      table.displayOrder,
    ),
    index("discussion_comment_gifs_gif_idx").on(table.gifId, table.createdAt),
  ],
);

export const discussionReactions = sqliteTable(
  "discussion_reactions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => discussionComments.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull().default("LIKE"),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.commentId] }),
    index("discussion_reactions_comment_idx").on(
      table.commentId,
      table.reaction,
    ),
    index("discussion_reactions_created_idx").on(table.createdAt),
  ],
);

export const discussionReactionEvents = sqliteTable(
  "discussion_reaction_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => discussionComments.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    reaction: text("reaction").notNull(),
    createdAt,
  },
  (table) => [
    index("discussion_reaction_events_user_time_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const chapterReactions = sqliteTable(
  "chapter_reactions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    reactionId: text("reaction_id")
      .notNull()
      .references(() => customReactions.id, { onDelete: "restrict" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapterId] }),
    index("chapter_reactions_chapter_idx").on(
      table.chapterId,
      table.reactionId,
    ),
  ],
);

export const discussionVotes = sqliteTable(
  "discussion_votes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => discussionComments.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.commentId] }),
    check(
      "discussion_votes_value_check",
      sql`${table.value} IN (-1, 1)`,
    ),
    index("discussion_votes_comment_idx").on(table.commentId, table.value),
  ],
);

export const discussionMedia = sqliteTable(
  "discussion_media",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => discussionComments.id, {
      onDelete: "cascade",
    }),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    kind: text("kind").notNull(),
    altText: text("alt_text").notNull().default(""),
    moderationStatus: text("moderation_status").notNull().default("READY"),
    createdAt,
    updatedAt,
  },
  (table) => [
    check("discussion_media_size_check", sql`${table.byteSize} > 0`),
    check(
      "discussion_media_kind_check",
      sql`${table.kind} IN ('IMAGE', 'GIF')`,
    ),
    check(
      "discussion_media_status_check",
      sql`${table.moderationStatus} IN ('READY', 'DELETED', 'QUARANTINED')`,
    ),
    uniqueIndex("discussion_media_object_uidx").on(table.objectKey),
    index("discussion_media_comment_idx").on(
      table.commentId,
      table.moderationStatus,
    ),
    index("discussion_media_user_idx").on(
      table.userId,
      table.moderationStatus,
      table.createdAt,
    ),
  ],
);

export const mediaCleanupQueue = sqliteTable(
  "media_cleanup_queue",
  {
    id: text("id").primaryKey(),
    objectKey: text("object_key").notNull(),
    mediaKind: text("media_kind").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    attempts: integer("attempts").notNull().default(0),
    status: text("status").notNull().default("PENDING"),
    lastError: text("last_error"),
    failedAt: text("failed_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "media_cleanup_status_check",
      sql`${table.status} IN ('PENDING', 'FAILED')`,
    ),
    uniqueIndex("media_cleanup_object_uidx").on(table.objectKey),
    index("media_cleanup_retry_idx").on(
      table.status,
      table.attempts,
      table.createdAt,
    ),
  ],
);

export const discussionCommentEdits = sqliteTable(
  "discussion_comment_edits",
  {
    id: text("id").primaryKey(),
    commentId: text("comment_id")
      .notNull()
      .references(() => discussionComments.id, { onDelete: "cascade" }),
    editorUserId: text("editor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    priorBody: text("prior_body").notNull(),
    priorSpoiler: integer("prior_spoiler", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt,
  },
  (table) => [
    index("discussion_comment_edits_comment_idx").on(
      table.commentId,
      table.createdAt,
    ),
  ],
);

export const discussionUserRestrictions = sqliteTable(
  "discussion_user_restrictions",
  {
    seriesSlug: text("series_slug").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bannedByUserId: text("banned_by_user_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.seriesSlug, table.userId] }),
    index("discussion_user_restrictions_user_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const discussionSettings = sqliteTable("discussion_settings", {
  id: text("id").primaryKey(),
  schemaVersion: integer("schema_version").notNull().default(1),
  settingsJson: text("settings_json").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  createdAt,
  updatedAt,
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    priceMinor: integer("price_minor").notNull(),
    billingCurrency: text("billing_currency").notNull().default("USD"),
    onyxBase: integer("onyx_base").notNull().default(0),
    onyxBonus: integer("onyx_bonus").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    shortDescription: text("short_description").notNull().default(""),
    detailedDescription: text("detailed_description").notNull().default(""),
    benefitsJson: text("benefits_json").notNull().default("[]"),
    discountPercent: integer("discount_percent").notNull().default(0),
    promotionalBadge: text("promotional_badge").notNull().default(""),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    lifecycleStatus: text("lifecycle_status").notNull().default("DRAFT"),
    isFeatured: integer("is_featured", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ctaText: text("cta_text").notNull().default("View offer"),
    altText: text("alt_text").notNull().default(""),
    themeKey: text("theme_key").notNull().default("OCEAN"),
    primaryImageKey: text("primary_image_key"),
    bannerImageKey: text("banner_image_key"),
    iconImageKey: text("icon_image_key"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    archivedAt: text("archived_at"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("products_slug_uidx").on(table.slug),
    index("products_public_idx").on(
      table.lifecycleStatus,
      table.active,
      table.startsAt,
      table.endsAt,
      table.sortOrder,
    ),
  ],
);

export const storeCollections = sqliteTable(
  "store_collections",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    themeKey: text("theme_key").notNull(),
    isSeasonal: integer("is_seasonal", { mode: "boolean" })
      .notNull()
      .default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("store_collections_slug_uidx").on(table.slug),
    index("store_collections_public_idx").on(
      table.enabled,
      table.sortOrder,
    ),
  ],
);

export const storeItems = sqliteTable(
  "store_items",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => storeCollections.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    priceOnyx: integer("price_onyx").notNull(),
    priceCurrency: text("price_currency").notNull().default("ONYX"),
    previewKey: text("preview_key"),
    previewConfigJson: text("preview_config_json").notNull().default("{}"),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    isHidden: integer("is_hidden", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    archivedAt: text("archived_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("store_items_slug_uidx").on(table.slug),
    check("store_items_price_check", sql`${table.priceOnyx} >= 0`),
    check(
      "store_items_currency_check",
      sql`${table.priceCurrency} IN ('ONYX', 'SHARDS')`,
    ),
    check(
      "store_items_category_check",
      sql`${table.category} IN (
        'PROFILE_BANNER',
        'PROFILE_FRAME',
        'USERNAME_DECORATION',
        'COMMENT_EFFECT',
        'COMMENT_GRADIENT',
        'SEASONAL_PROFILE',
        'LOGO_EFFECT'
      )`,
    ),
    index("store_items_public_idx").on(
      table.collectionId,
      table.isPublished,
      table.isHidden,
      table.sortOrder,
    ),
  ],
);

export const userStoreItems = sqliteTable(
  "user_store_items",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => storeItems.id),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    purchasedAt: createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.itemId] }),
    index("user_store_items_recent_idx").on(table.userId, table.purchasedAt),
  ],
);

export const userCosmeticLoadouts = sqliteTable(
  "user_cosmetic_loadouts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => storeItems.id),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.category] }),
    index("user_cosmetic_loadouts_item_idx").on(table.itemId),
  ],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("PENDING"),
    totalMinor: integer("total_minor").notNull(),
    billingCurrency: text("billing_currency").notNull(),
    provider: text("provider").notNull().default("TEST"),
    providerReference: text("provider_reference"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("orders_idempotency_uidx").on(table.userId, table.idempotencyKey),
    index("orders_user_idx").on(table.userId, table.createdAt),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    productVersion: integer("product_version").notNull().default(1),
    titleSnapshot: text("title_snapshot").notNull(),
    descriptionSnapshot: text("description_snapshot").notNull().default(""),
    benefitsSnapshotJson: text("benefits_snapshot_json")
      .notNull()
      .default("[]"),
    quantity: integer("quantity").notNull().default(1),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    billingCurrency: text("billing_currency").notNull(),
    bonusSnapshot: integer("bonus_snapshot").notNull().default(0),
    discountSnapshot: integer("discount_snapshot").notNull().default(0),
    createdAt,
  },
  (table) => [
    index("order_items_order_idx").on(table.orderId),
    index("order_items_product_idx").on(table.productId, table.createdAt),
  ],
);

export const ledgerAccounts = sqliteTable(
  "ledger_accounts",
  {
    id: text("id").primaryKey(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    currency: text("currency").notNull().default("ONYX"),
    accountType: text("account_type").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("ledger_accounts_owner_uidx").on(
      table.ownerType,
      table.ownerId,
      table.currency,
      table.accountType,
    ),
  ],
);

export const ledgerTransactions = sqliteTable(
  "ledger_transactions",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    referenceType: text("reference_type").notNull(),
    referenceId: text("reference_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    memo: text("memo").notNull().default(""),
    createdAt,
  },
  (table) => [
    uniqueIndex("ledger_tx_idempotency_uidx").on(table.idempotencyKey),
    index("ledger_tx_reference_idx").on(table.referenceType, table.referenceId),
    index("ledger_tx_kind_time_idx").on(table.kind, table.createdAt),
  ],
);

export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    amount: integer("amount").notNull(),
    createdAt,
  },
  (table) => [
    index("ledger_entries_account_idx").on(table.accountId, table.createdAt),
    index("ledger_entries_tx_idx").on(table.transactionId),
  ],
);

export const chapterUnlockReceipts = sqliteTable(
  "chapter_unlock_receipts",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    entitlementId: text("entitlement_id")
      .notNull()
      .references(() => entitlements.id),
    buyerUserId: text("buyer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "restrict" }),
    teamId: text("team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("ONYX"),
    createdAt,
  },
  (table) => [
    uniqueIndex("chapter_unlock_receipts_transaction_uidx").on(
      table.transactionId,
    ),
    index("chapter_unlock_receipts_entitlement_idx").on(table.entitlementId),
    index("chapter_unlock_receipts_team_recent_idx").on(
      table.teamId,
      table.createdAt,
    ),
    index("chapter_unlock_receipts_buyer_recent_idx").on(
      table.buyerUserId,
      table.createdAt,
    ),
    check(
      "chapter_unlock_receipts_amount_check",
      sql`${table.amount} > 0`,
    ),
  ],
);

export const chapterRewardClaims = sqliteTable(
  "chapter_reward_claims",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    activeSeconds: integer("active_seconds").notNull(),
    claimedAt: text("claimed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chapterId] }),
    uniqueIndex("chapter_reward_claims_transaction_uidx").on(
      table.transactionId,
    ),
    index("chapter_reward_claims_recent_idx").on(table.userId, table.claimedAt),
    check(
      "chapter_reward_claims_seconds_check",
      sql`${table.activeSeconds} >= 0`,
    ),
  ],
);

export const communityRewardClaims = sqliteTable(
  "community_reward_claims",
  {
    beneficiaryUserId: text("beneficiary_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rewardType: text("reward_type").notNull(),
    sourceId: text("source_id").notNull(),
    amount: integer("amount").notNull(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    claimedAt: text("claimed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({
      columns: [table.beneficiaryUserId, table.rewardType, table.sourceId],
    }),
    uniqueIndex("community_reward_claims_transaction_uidx").on(
      table.transactionId,
    ),
    index("community_reward_claims_recent_idx").on(
      table.beneficiaryUserId,
      table.claimedAt,
    ),
    check(
      "community_reward_claims_type_check",
      sql`${table.rewardType} IN ('COMMENT_CREATED', 'COMMENT_UPVOTE')`,
    ),
    check("community_reward_claims_amount_check", sql`${table.amount} >= 0`),
  ],
);

export const giftCards = sqliteTable(
  "gift_cards",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    codeCiphertext: text("code_ciphertext").notNull(),
    codeNonce: text("code_nonce").notNull(),
    codeSuffix: text("code_suffix").notNull(),
    purchaserUserId: text("purchaser_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purchaseIdempotencyKey: text("purchase_idempotency_key").notNull(),
    coinAmount: integer("coin_amount").notNull(),
    recipientUserId: text("recipient_user_id").references(() => users.id),
    recipientLabel: text("recipient_label").notNull().default(""),
    message: text("message").notNull().default(""),
    status: text("status").notNull().default("ACTIVE"),
    expiresAt: text("expires_at"),
    purchaseTransactionId: text("purchase_transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    redeemedByUserId: text("redeemed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    redeemedTransactionId: text("redeemed_transaction_id").references(
      () => ledgerTransactions.id,
    ),
    redeemedAt: text("redeemed_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("gift_cards_code_hash_uidx").on(table.codeHash),
    uniqueIndex("gift_cards_purchase_idempotency_uidx").on(
      table.purchaserUserId,
      table.purchaseIdempotencyKey,
    ),
    uniqueIndex("gift_cards_redeem_transaction_uidx").on(
      table.redeemedTransactionId,
    ),
    index("gift_cards_owner_recent_idx").on(
      table.purchaserUserId,
      table.createdAt,
    ),
    index("gift_cards_status_idx").on(table.status, table.expiresAt),
    index("gift_cards_recipient_status_idx").on(
      table.recipientUserId,
      table.status,
    ),
    check("gift_cards_amount_check", sql`${table.coinAmount} > 0`),
    check(
      "gift_cards_status_check",
      sql`${table.status} IN ('ACTIVE', 'REDEEMED', 'EXPIRED')`,
    ),
  ],
);

export const teamSupportReceipts = sqliteTable(
  "team_support_receipts",
  {
    id: text("id").primaryKey(),
    supporterUserId: text("supporter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    coinAmount: integer("coin_amount").notNull(),
    message: text("message").notNull().default(""),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    createdAt,
  },
  (table) => [
    uniqueIndex("team_support_idempotency_uidx").on(
      table.supporterUserId,
      table.idempotencyKey,
    ),
    uniqueIndex("team_support_transaction_uidx").on(table.transactionId),
    index("team_support_team_recent_idx").on(table.teamId, table.createdAt),
    index("team_support_user_recent_idx").on(
      table.supporterUserId,
      table.createdAt,
    ),
    check("team_support_amount_check", sql`${table.coinAmount} > 0`),
  ],
);

export const teamSupportReceiptSeries = sqliteTable(
  "team_support_receipt_series",
  {
    receiptId: text("receipt_id")
      .notNull()
      .references(() => teamSupportReceipts.id, { onDelete: "cascade" }),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.receiptId, table.seriesId] }),
    index("team_support_receipt_series_series_idx").on(
      table.seriesId,
      table.createdAt,
    ),
  ],
);

export const rouletteState = sqliteTable("roulette_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  nextEligibleAt: text("next_eligible_at")
    .notNull()
    .default("1970-01-01T00:00:00.000Z"),
  lastSpinId: text("last_spin_id"),
  freeSpinBalance: integer("free_spin_balance").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  updatedAt,
});

export const roulettePoolCounters = sqliteTable("roulette_pool_counters", {
  poolKey: text("pool_key").primaryKey(),
  totalSpins: integer("total_spins").notNull().default(0),
  lastSpinId: text("last_spin_id"),
  revision: integer("revision").notNull().default(1),
  updatedAt,
});

export const rouletteRewardCadence = sqliteTable(
  "roulette_reward_cadence",
  {
    poolKey: text("pool_key").notNull(),
    rewardKey: text("reward_key").notNull(),
    intervalSpins: integer("interval_spins").notNull(),
    nextDueSpin: integer("next_due_spin").notNull(),
    lastAwardedSpin: integer("last_awarded_spin"),
    lastSpinId: text("last_spin_id"),
    revision: integer("revision").notNull().default(1),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.poolKey, table.rewardKey] }),
    index("roulette_reward_cadence_due_idx").on(
      table.poolKey,
      table.nextDueSpin,
    ),
    check(
      "roulette_reward_cadence_interval_check",
      sql`${table.intervalSpins} >= 2`,
    ),
  ],
);

export const rouletteSpins = sqliteTable(
  "roulette_spins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    rewardKey: text("reward_key").notNull(),
    rewardType: text("reward_type").notNull(),
    rewardAmount: integer("reward_amount").notNull().default(0),
    storeItemId: text("store_item_id").references(() => storeItems.id, {
      onDelete: "set null",
    }),
    spinMode: text("spin_mode").notNull().default("DAILY"),
    costShards: integer("cost_shards").notNull().default(0),
    costCurrency: text("cost_currency"),
    costAmount: integer("cost_amount").notNull().default(0),
    chargeTransactionId: text("charge_transaction_id").references(
      () => ledgerTransactions.id,
    ),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    globalSpinNumber: integer("global_spin_number").notNull().default(0),
    nextEligibleAt: text("next_eligible_at").notNull(),
    spunAt: text("spun_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("roulette_spins_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("roulette_spins_transaction_uidx").on(table.transactionId),
    index("roulette_spins_user_recent_idx").on(table.userId, table.spunAt),
    check(
      "roulette_spins_reward_type_check",
      sql`${table.rewardType} IN ('SHARDS', 'ONYX', 'STORE_ITEM')`,
    ),
    check(
      "roulette_spins_reward_amount_check",
      sql`${table.rewardAmount} >= 0`,
    ),
    check(
      "roulette_spins_mode_check",
      sql`${table.spinMode} IN ('DAILY', 'TASK', 'PAID')`,
    ),
    check(
      "roulette_spins_cost_check",
      sql`${table.costShards} >= 0 AND ${table.costAmount} >= 0`,
    ),
    check(
      "roulette_spins_cost_currency_check",
      sql`${table.costCurrency} IS NULL OR ${table.costCurrency} IN ('SHARDS', 'ONYX')`,
    ),
  ],
);

export const rouletteTaskClaims = sqliteTable(
  "roulette_task_claims",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    weekStart: text("week_start").notNull(),
    awardedSpins: integer("awarded_spins").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    claimedAt: text("claimed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId, table.weekStart] }),
    uniqueIndex("roulette_task_claims_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("roulette_task_claims_user_week_idx").on(
      table.userId,
      table.weekStart,
    ),
    check(
      "roulette_task_claims_spins_check",
      sql`${table.awardedSpins} > 0`,
    ),
  ],
);

export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull().default("OPEN"),
    priority: text("priority").notNull().default("NORMAL"),
    lastMessageAt: text("last_message_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    closedAt: text("closed_at"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    check(
      "support_tickets_category_check",
      sql`${table.category} IN ('ACCOUNT', 'READING', 'PURCHASES', 'PUBLISHING', 'OTHER')`,
    ),
    check(
      "support_tickets_status_check",
      sql`${table.status} IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED')`,
    ),
    check(
      "support_tickets_priority_check",
      sql`${table.priority} IN ('LOW', 'NORMAL', 'HIGH')`,
    ),
    index("support_tickets_requester_idx").on(
      table.requesterUserId,
      table.lastMessageAt,
    ),
    index("support_tickets_status_idx").on(table.status, table.lastMessageAt),
  ],
);

export const supportTicketMessages = sqliteTable(
  "support_ticket_messages",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    isStaffReply: integer("is_staff_reply", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt,
  },
  (table) => [
    index("support_ticket_messages_ticket_idx").on(
      table.ticketId,
      table.createdAt,
    ),
  ],
);

export const entitlements = sqliteTable(
  "entitlements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    startsAt: text("starts_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdAt,
  },
  (table) => [
    uniqueIndex("entitlements_user_chapter_uidx").on(
      table.userId,
      table.chapterId,
    ),
  ],
);

export const uploadJobs = sqliteTable(
  "upload_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    teamId: text("team_id").references(() => teams.id),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id),
    kind: text("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    status: text("status").notNull().default("DRAFT"),
    idempotencyKey: text("idempotency_key").notNull(),
    publishIdempotencyKey: text("publish_idempotency_key"),
    totalBytes: integer("total_bytes").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    revision: integer("revision").notNull().default(1),
    expiresAt: text("expires_at").notNull(),
    submittedAt: text("submitted_at"),
    completedAt: text("completed_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("upload_jobs_user_idempotency_uidx").on(
      table.userId,
      table.idempotencyKey,
    ),
    uniqueIndex("upload_jobs_publish_idempotency_uidx")
      .on(table.userId, table.publishIdempotencyKey)
      .where(sql`${table.publishIdempotencyKey} IS NOT NULL`),
    index("upload_jobs_user_status_idx").on(
      table.userId,
      table.status,
      table.updatedAt,
    ),
    index("upload_jobs_team_status_idx").on(
      table.teamId,
      table.status,
      table.updatedAt,
    ),
    index("upload_jobs_series_idx").on(table.seriesId, table.updatedAt),
    index("upload_jobs_expiry_idx").on(table.status, table.expiresAt),
    check(
      "upload_jobs_kind_check",
      sql`${table.kind} IN ('SINGLE', 'BATCH')`,
    ),
    check(
      "upload_jobs_source_check",
      sql`${table.sourceType} IN ('DIRECT_IMAGES', 'DIRECT_FOLDER', 'GOOGLE_DRIVE')`,
    ),
    check(
      "upload_jobs_status_check",
      sql`${table.status} IN (
        'DRAFT',
        'UPLOADING',
        'VALIDATING',
        'READY',
        'PUBLISHING',
        'PENDING_REVIEW',
        'PUBLISHED',
        'SCHEDULED',
        'REJECTED',
        'FAILED',
        'CANCELLED'
      )`,
    ),
  ],
);

export const uploaderApprovals = sqliteTable(
  "uploader_approvals",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("UNAPPROVED"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: text("reviewed_at"),
    note: text("note").notNull().default(""),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("uploader_approvals_status_idx").on(table.status, table.updatedAt),
    check(
      "uploader_approvals_status_check",
      sql`${table.status} IN ('UNAPPROVED', 'APPROVED', 'UNDER_SCOPE', 'REJECTED')`,
    ),
  ],
);

export const uploadReviewEvents = sqliteTable(
  "upload_review_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => uploadJobs.id, { onDelete: "cascade" }),
    uploaderUserId: text("uploader_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => users.id),
    decision: text("decision").notNull(),
    note: text("note").notNull().default(""),
    createdAt,
  },
  (table) => [
    index("upload_review_events_job_idx").on(table.jobId, table.createdAt),
    index("upload_review_events_uploader_idx").on(
      table.uploaderUserId,
      table.createdAt,
    ),
    check(
      "upload_review_events_decision_check",
      sql`${table.decision} IN ('APPROVE', 'UNDER_SCOPE', 'REJECT')`,
    ),
  ],
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    appName: text("app_name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopesJson: text("scopes_json").notNull().default("[]"),
    allowedTeamId: text("allowed_team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("ACTIVE"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    replacedByKeyId: text("replaced_by_key_id"),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    lastUsedIpHash: text("last_used_ip_hash"),
    requestCount: integer("request_count").notNull().default(0),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("api_keys_prefix_uidx").on(table.keyPrefix),
    index("api_keys_status_idx").on(table.status, table.createdAt),
    index("api_keys_team_idx").on(table.allowedTeamId),
    check(
      "api_keys_status_check",
      sql`${table.status} IN ('ACTIVE', 'REVOKED', 'ROTATED')`,
    ),
  ],
);

export const apiKeyRateLimits = sqliteTable(
  "api_key_rate_limits",
  {
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    windowStart: text("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.apiKeyId, table.windowStart] }),
    index("api_key_rate_limits_window_idx").on(table.windowStart),
  ],
);

export const uploadJobItems = sqliteTable(
  "upload_job_items",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => uploadJobs.id, { onDelete: "cascade" }),
    clientKey: text("client_key").notNull(),
    sourceLabel: text("source_label").notNull(),
    seriesId: text("series_id")
      .notNull()
      .references(() => series.id),
    teamId: text("team_id").references(() => teams.id),
    chapterId: text("chapter_id").references(() => chapters.id),
    replacementChapterId: text("replacement_chapter_id").references(
      () => chapters.id,
      { onDelete: "restrict" },
    ),
    volume: text("volume"),
    chapterNumber: text("chapter_number").notNull(),
    title: text("title").notNull().default(""),
    language: text("language").notNull().default("en"),
    version: integer("version").notNull().default(1),
    releaseNotes: text("release_notes").notNull().default(""),
    creditsJson: text("credits_json").notNull().default("{}"),
    thumbnailKey: text("thumbnail_key"),
    accessType: text("access_type").notNull().default("FREE"),
    priceOnyx: integer("price_onyx").notNull().default(0),
    visibility: text("visibility").notNull().default("PUBLIC"),
    scheduledAt: text("scheduled_at"),
    commentsEnabled: integer("comments_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    includeFixedFirstPage: integer("include_fixed_first_page", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    includeFixedLastPage: integer("include_fixed_last_page", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    status: text("status").notNull().default("DRAFT"),
    pageCount: integer("page_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("upload_job_items_client_uidx").on(
      table.jobId,
      table.clientKey,
    ),
    uniqueIndex("upload_job_items_release_uidx").on(
      table.jobId,
      table.chapterNumber,
      table.language,
      table.version,
    ),
    index("upload_job_items_status_idx").on(
      table.jobId,
      table.status,
      table.updatedAt,
    ),
    index("upload_job_items_chapter_idx").on(table.chapterId),
    index("upload_job_items_replacement_idx").on(
      table.replacementChapterId,
      table.status,
    ),
    check(
      "upload_job_items_status_check",
      sql`${table.status} IN (
        'DRAFT',
        'UPLOADING',
        'READY',
        'PENDING_REVIEW',
        'PUBLISHED',
        'SCHEDULED',
        'REJECTED',
        'FAILED',
        'CANCELLED'
      )`,
    ),
    check(
      "upload_job_items_access_check",
      sql`(${table.accessType} = 'FREE' AND ${table.priceOnyx} = 0)
        OR (${table.accessType} = 'PAID' AND ${table.priceOnyx} > 0)`,
    ),
    check(
      "upload_job_items_visibility_check",
      sql`${table.visibility} IN ('PUBLIC', 'UNLISTED', 'HIDDEN')`,
    ),
  ],
);

export const uploadPublishGuards = sqliteTable(
  "upload_publish_guards",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => uploadJobs.id, { onDelete: "cascade" }),
    verified: integer("verified").notNull(),
  },
  (table) => [
    check("upload_publish_guards_verified_check", sql`${table.verified} = 1`),
  ],
);

export const uploadRateLimitAttempts = sqliteTable(
  "upload_rate_limit_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    uploadJobId: text("upload_job_id").notNull(),
    uploadJobItemId: text("upload_job_item_id").notNull(),
    requestId: text("request_id").notNull(),
    byteSize: integer("byte_size").notNull(),
    admitted: integer("admitted").notNull(),
    createdAt,
  },
  (table) => [
    index("upload_rate_attempts_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    check(
      "upload_rate_attempts_byte_size_check",
      sql`${table.byteSize} > 0`,
    ),
    check(
      "upload_rate_attempts_admitted_check",
      sql`${table.admitted} IN (0, 1)`,
    ),
  ],
);

export const uploadJobMediaGuards = sqliteTable("upload_job_media_guards", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => uploadJobs.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  createdAt,
});

export const uploadSessions = sqliteTable(
  "upload_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    teamId: text("team_id").references(() => teams.id),
    chapterId: text("chapter_id").references(() => chapters.id),
    uploadJobId: text("upload_job_id").references(() => uploadJobs.id, {
      onDelete: "cascade",
    }),
    uploadJobItemId: text("upload_job_item_id").references(
      () => uploadJobItems.id,
      { onDelete: "cascade" },
    ),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    sourcePath: text("source_path").notNull().default(""),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    pageIndex: integer("page_index").notNull().default(0),
    sha256: text("sha256"),
    width: integer("width"),
    height: integer("height"),
    retryCount: integer("retry_count").notNull().default(0),
    expiresAt: text("expires_at"),
    status: text("status").notNull().default("UPLOADED"),
    validationJson: text("validation_json").notNull().default("{}"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("uploads_user_idx").on(table.userId, table.createdAt),
    index("uploads_status_idx").on(table.status, table.createdAt),
    index("uploads_job_idx").on(
      table.uploadJobId,
      table.uploadJobItemId,
      table.pageIndex,
    ),
    uniqueIndex("uploads_item_path_uidx")
      .on(table.uploadJobItemId, table.sourcePath)
      .where(sql`${table.uploadJobItemId} IS NOT NULL`),
    uniqueIndex("uploads_item_page_uidx")
      .on(table.uploadJobItemId, table.pageIndex)
      .where(sql`${table.uploadJobItemId} IS NOT NULL`),
    uniqueIndex("uploads_item_sha_uidx")
      .on(table.uploadJobItemId, table.sha256)
      .where(
        sql`${table.uploadJobItemId} IS NOT NULL AND ${table.sha256} IS NOT NULL`,
      ),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: text("read_at"),
    dedupeKey: text("dedupe_key"),
    actionUrl: text("action_url"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt,
  },
  (table) => [
    index("notifications_user_idx").on(table.userId, table.readAt, table.createdAt),
    index("notifications_dedupe_idx").on(table.userId, table.dedupeKey),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterUserId: text("reporter_user_id").references(() => users.id),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    category: text("category").notNull(),
    detail: text("detail").notNull(),
    status: text("status").notNull().default("OPEN"),
    moderatedByUserId: text("moderated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    moderatedAt: text("moderated_at"),
    resolutionNote: text("resolution_note"),
    revision: integer("revision").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("reports_queue_idx").on(table.status, table.createdAt),
    index("reports_target_idx").on(
      table.targetType,
      table.targetId,
      table.status,
      table.createdAt,
    ),
    check(
      "reports_status_check",
      sql`${table.status} IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')`,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    category: text("category").notNull().default("SYSTEM_MAINTENANCE"),
    sourceArea: text("source_area").notNull().default("SYSTEM"),
    result: text("result").notNull().default("SUCCESS"),
    actorRole: text("actor_role"),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetLabel: text("target_label"),
    reason: text("reason"),
    requestId: text("request_id").notNull(),
    metadataJson: text("metadata_json"),
    oldValueJson: text("old_value_json"),
    newValueJson: text("new_value_json"),
    createdAt,
  },
  (table) => [
    index("audit_target_idx").on(table.targetType, table.targetId, table.createdAt),
    index("audit_actor_idx").on(table.actorUserId, table.createdAt),
    index("audit_filter_idx").on(
      table.category,
      table.result,
      table.createdAt,
    ),
    index("audit_action_idx").on(table.action, table.createdAt),
    index("audit_created_idx").on(table.createdAt, table.id),
  ],
);

export const featureFlags = sqliteTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  description: text("description").notNull().default(""),
  updatedAt,
});
