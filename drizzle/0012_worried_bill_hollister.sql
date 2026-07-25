CREATE TABLE `custom_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`accessible_label` text NOT NULL,
	`emoji_fallback` text DEFAULT '' NOT NULL,
	`asset_key` text,
	`content_type` text,
	`width` integer,
	`height` integer,
	`byte_size` integer,
	`is_animated` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`category` text,
	`availability_json` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`updated_by_user_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_reactions_slug_uidx` ON `custom_reactions` (`slug`);--> statement-breakpoint
CREATE INDEX `custom_reactions_public_idx` ON `custom_reactions` (`is_active`,`is_archived`,`display_order`);--> statement-breakpoint
ALTER TABLE `chapters` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE `discussion_reaction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`action` text NOT NULL,
	`reaction` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `discussion_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discussion_reaction_events_user_time_idx`
ON `discussion_reaction_events` (`user_id`,`created_at`);--> statement-breakpoint
WITH `safe_reactions` AS (
  SELECT
    reaction.`key` AS `legacy_index`,
    reaction.`type` AS `source_type`,
    CASE WHEN reaction.`type` = 'object'
         THEN reaction.`value` ELSE '{}' END AS `payload_json`
  FROM `discussion_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.reactions'
       ) reaction
  WHERE settings.`id` = 'global'
)
INSERT OR IGNORE INTO `custom_reactions`
  (`id`, `slug`, `name`, `accessible_label`, `emoji_fallback`,
   `is_active`, `is_archived`, `display_order`, `category`)
SELECT
  'reaction_setting_' || json_extract(reaction.payload_json, '$.key'),
  json_extract(reaction.payload_json, '$.key'),
  COALESCE(NULLIF(json_extract(reaction.payload_json, '$.label'), ''),
           json_extract(reaction.payload_json, '$.key')),
  COALESCE(NULLIF(json_extract(reaction.payload_json, '$.label'), ''),
           json_extract(reaction.payload_json, '$.key')),
  CASE WHEN json_type(reaction.payload_json, '$.emoji') = 'text'
       THEN json_extract(reaction.payload_json, '$.emoji') ELSE '' END,
  CASE
    WHEN json_type(reaction.payload_json, '$.enabled') IN ('true', 'integer')
      AND CAST(json_extract(reaction.payload_json, '$.enabled') AS INTEGER) = 1
      AND json_type(reaction.payload_json, '$.emoji') = 'text'
      AND TRIM(json_extract(reaction.payload_json, '$.emoji')) <> ''
    THEN 1
    ELSE 0
  END,
  0,
  CAST(reaction.legacy_index AS INTEGER) * 10,
  'Legacy'
FROM `safe_reactions` reaction
WHERE reaction.`source_type` = 'object'
  AND json_type(reaction.payload_json, '$.key') = 'text'
  AND LENGTH(TRIM(json_extract(reaction.payload_json, '$.key'))) BETWEEN 1 AND 32;--> statement-breakpoint
WITH `safe_reactions` AS (
  SELECT
    reaction.`key` AS `legacy_index`,
    reaction.`type` AS `source_type`,
    CASE WHEN reaction.`type` = 'object'
         THEN reaction.`value` ELSE '{}' END AS `payload_json`
  FROM `discussion_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.reactions'
       ) reaction
  WHERE settings.`id` = 'global'
)
INSERT INTO `audit_logs`
  (`id`, `action`, `target_type`, `target_id`, `reason`, `request_id`,
   `new_value_json`)
SELECT
  'audit_reaction_skip_' || lower(hex(randomblob(8))),
  'migration.discussion_reaction.skipped',
  'CUSTOM_REACTION',
  'legacy-index-' || reaction.`legacy_index`,
  'A legacy reaction was skipped because it was not an object with a valid key.',
  'migration-0012',
  json_object(
    'legacyIndex', reaction.`legacy_index`,
    'sourceType', reaction.`source_type`
  )
FROM `safe_reactions` reaction
WHERE NOT COALESCE((
  reaction.`source_type` = 'object'
  AND json_type(reaction.payload_json, '$.key') = 'text'
  AND LENGTH(TRIM(json_extract(reaction.payload_json, '$.key'))) BETWEEN 1 AND 32
), 0);--> statement-breakpoint
WITH `safe_reactions` AS (
  SELECT
    reaction.`key` AS `legacy_index`,
    reaction.`type` AS `source_type`,
    CASE WHEN reaction.`type` = 'object'
         THEN reaction.`value` ELSE '{}' END AS `payload_json`
  FROM `discussion_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.reactions'
       ) reaction
  WHERE settings.`id` = 'global'
)
INSERT INTO `audit_logs`
  (`id`, `action`, `target_type`, `target_id`, `reason`, `request_id`,
   `new_value_json`)
SELECT
  'audit_reaction_deactivate_' || lower(hex(randomblob(8))),
  'migration.discussion_reaction.deactivated',
  'CUSTOM_REACTION',
  json_extract(reaction.payload_json, '$.key'),
  'An enabled legacy reaction without a visual fallback was migrated inactive.',
  'migration-0012',
  json_object('legacyIndex', reaction.`legacy_index`)
FROM `safe_reactions` reaction
WHERE reaction.`source_type` = 'object'
  AND json_type(reaction.payload_json, '$.key') = 'text'
  AND LENGTH(TRIM(json_extract(reaction.payload_json, '$.key'))) BETWEEN 1 AND 32
  AND json_type(reaction.payload_json, '$.enabled') IN ('true', 'integer')
  AND CAST(json_extract(reaction.payload_json, '$.enabled') AS INTEGER) = 1
  AND (
    json_type(reaction.payload_json, '$.emoji') <> 'text'
    OR TRIM(COALESCE(json_extract(reaction.payload_json, '$.emoji'), '')) = ''
  );--> statement-breakpoint
INSERT OR IGNORE INTO `custom_reactions`
  (`id`, `slug`, `name`, `accessible_label`, `emoji_fallback`,
   `is_active`, `is_archived`, `display_order`, `category`)
VALUES
  ('reaction_heart', 'heart', 'Love', 'Love', '❤️', 1, 0, 10, 'Core'),
  ('reaction_laugh', 'laugh', 'Funny', 'Funny', '😂', 1, 0, 20, 'Core'),
  ('reaction_fire', 'fire', 'Fire', 'Fire', '🔥', 1, 0, 30, 'Core'),
  ('reaction_wow', 'wow', 'Wow', 'Wow', '😮', 1, 0, 40, 'Core'),
  ('reaction_sad', 'sad', 'Sad', 'Sad', '😢', 1, 0, 50, 'Core'),
  ('reaction_theory', 'theory', 'Good theory', 'Good theory', '🧠', 1, 0, 60, 'Core');--> statement-breakpoint
INSERT OR IGNORE INTO `custom_reactions`
  (`id`, `slug`, `name`, `accessible_label`, `emoji_fallback`,
   `is_active`, `is_archived`, `display_order`, `category`)
SELECT
  'reaction_usage_' || reaction,
  reaction,
  reaction,
  reaction,
  '',
  0,
  1,
  1000,
  'Historical'
FROM `discussion_reactions`
GROUP BY reaction;--> statement-breakpoint
CREATE TABLE `metadata_import_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`response_json` text NOT NULL,
	`response_hash` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metadata_import_cache_expiry_idx` ON `metadata_import_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `metadata_import_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`series_id` text,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`safe_message` text DEFAULT '' NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `metadata_import_actor_time_idx` ON `metadata_import_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `metadata_import_source_idx` ON `metadata_import_logs` (`source`,`external_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text,
	`product_version` integer DEFAULT 1 NOT NULL,
	`title_snapshot` text NOT NULL,
	`description_snapshot` text DEFAULT '' NOT NULL,
	`benefits_snapshot_json` text DEFAULT '[]' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`billing_currency` text NOT NULL,
	`bonus_snapshot` integer DEFAULT 0 NOT NULL,
	`discount_snapshot` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_product_idx` ON `order_items` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`archived_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_normalized_name_uidx` ON `publishers` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `publishers_active_idx` ON `publishers` (`archived_at`,`name`);--> statement-breakpoint
CREATE TABLE `series_external_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`response_hash` text,
	`last_imported_at` text,
	`last_imported_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_imported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_external_source_uidx` ON `series_external_sources` (`source`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_external_series_uidx` ON `series_external_sources` (`series_id`,`source`);--> statement-breakpoint
CREATE INDEX `series_external_series_idx` ON `series_external_sources` (`series_id`,`source`);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `category` text DEFAULT 'SYSTEM_MAINTENANCE' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `source_area` text DEFAULT 'SYSTEM' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `result` text DEFAULT 'SUCCESS' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `actor_role` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `target_label` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `metadata_json` text;--> statement-breakpoint
UPDATE `audit_logs`
SET
  `actor_role` = (
    SELECT u.`primary_role`
    FROM `users` u
    WHERE u.`id` = `audit_logs`.`actor_user_id`
  ),
  `category` = CASE
    WHEN `action` LIKE 'auth.%' OR `action` LIKE 'security.%'
      THEN 'AUTHENTICATION_SECURITY'
    WHEN `action` LIKE 'user.%' OR `action` LIKE 'role.%'
      THEN 'USERS_ROLES'
    WHEN `action` LIKE 'series.%' OR `action` LIKE 'chapter.%'
      OR `action` LIKE 'workspace.series.%'
      THEN 'SERIES_CHAPTERS'
    WHEN `action` LIKE 'team.%'
      THEN 'TEAMS_PERMISSIONS'
    WHEN `action` LIKE 'discussion.%' OR `action` LIKE 'comment.%'
      OR `action` LIKE 'review.%' OR `action` LIKE 'workspace.comment.%'
      THEN 'DISCUSSIONS_MODERATION'
    WHEN `action` LIKE 'store.%' OR `action` LIKE 'commerce.%'
      OR `action` LIKE 'wallet.%'
      THEN 'COMMERCE_STORE'
    WHEN `action` LIKE 'appearance.%' OR `action` LIKE 'site.%'
      THEN 'APPEARANCE_SETTINGS'
    WHEN `action` LIKE 'upload.%' OR `action` LIKE 'import.%'
      OR `action` LIKE 'workspace.review.%'
      THEN 'UPLOADS_IMPORTS'
    ELSE 'SYSTEM_MAINTENANCE'
  END,
  `source_area` = CASE
    WHEN `action` LIKE 'series.%' OR `action` LIKE 'chapter.%'
      OR `action` LIKE 'workspace.series.%' THEN 'CATALOGUE'
    WHEN `action` LIKE 'team.%' THEN 'TEAMS'
    WHEN `action` LIKE 'discussion.%' OR `action` LIKE 'comment.%'
      OR `action` LIKE 'workspace.comment.%' THEN 'DISCUSSIONS'
    WHEN `action` LIKE 'store.%' OR `action` LIKE 'commerce.%' THEN 'STORE'
    WHEN `action` LIKE 'appearance.%' OR `action` LIKE 'site.%' THEN 'APPEARANCE'
    WHEN `action` LIKE 'upload.%' OR `action` LIKE 'import.%'
      OR `action` LIKE 'workspace.review.%' THEN 'UPLOADS'
    ELSE 'SYSTEM'
  END;--> statement-breakpoint
CREATE INDEX `audit_filter_idx` ON `audit_logs` (`category`,`result`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `media_cleanup_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`media_kind` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`last_error` text,
	`failed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT `media_cleanup_status_check`
	  CHECK (`status` IN ('PENDING', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_cleanup_object_uidx`
ON `media_cleanup_queue` (`object_key`);--> statement-breakpoint
CREATE INDEX `media_cleanup_retry_idx`
ON `media_cleanup_queue` (`status`,`attempts`,`created_at`);--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_invalid_discussion_json_' || lower(hex(randomblob(8))),
  'migration.settings.invalid_json',
  'SYSTEM_MAINTENANCE',
  'MIGRATION',
  'FAILURE',
  'DISCUSSION_SETTINGS',
  `id`,
  'Discussion settings',
  'Invalid legacy JSON was ignored; administrator review is required.',
  'migration-0012',
  json_object('table', 'discussion_settings', 'rowId', `id`)
FROM `discussion_settings`
WHERE NOT json_valid(`settings_json`);--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_invalid_commercial_json_' || lower(hex(randomblob(8))),
  'migration.settings.invalid_json',
  'SYSTEM_MAINTENANCE',
  'MIGRATION',
  'FAILURE',
  'COMMERCIAL_SETTINGS',
  `id`,
  'Commercial settings',
  'Invalid legacy JSON was ignored; administrator review is required.',
  'migration-0012',
  json_object('table', 'commercial_settings', 'rowId', `id`)
FROM `commercial_settings`
WHERE NOT json_valid(`settings_json`);--> statement-breakpoint
CREATE TRIGGER `audit_legacy_classification_v12`
AFTER INSERT ON `audit_logs`
WHEN NEW.`category` = 'SYSTEM_MAINTENANCE'
  AND NEW.`source_area` = 'SYSTEM'
BEGIN
  UPDATE `audit_logs`
  SET
    `actor_role` = COALESCE(
      NEW.`actor_role`,
      (SELECT u.`primary_role` FROM `users` u
       WHERE u.`id` = NEW.`actor_user_id`)
    ),
    `category` = CASE
      WHEN NEW.`action` LIKE 'auth.%' OR NEW.`action` LIKE 'security.%'
        THEN 'AUTHENTICATION_SECURITY'
      WHEN NEW.`action` LIKE 'user.%' OR NEW.`action` LIKE 'role.%'
        THEN 'USERS_ROLES'
      WHEN NEW.`action` LIKE 'series.%' OR NEW.`action` LIKE 'chapter.%'
        OR NEW.`action` LIKE 'workspace.series.%'
        THEN 'SERIES_CHAPTERS'
      WHEN NEW.`action` LIKE 'team.%'
        THEN 'TEAMS_PERMISSIONS'
      WHEN NEW.`action` LIKE 'discussion.%' OR NEW.`action` LIKE 'comment.%'
        OR NEW.`action` LIKE 'review.%'
        OR NEW.`action` LIKE 'workspace.comment.%'
        THEN 'DISCUSSIONS_MODERATION'
      WHEN NEW.`action` LIKE 'store.%' OR NEW.`action` LIKE 'commerce.%'
        OR NEW.`action` LIKE 'wallet.%'
        THEN 'COMMERCE_STORE'
      WHEN NEW.`action` LIKE 'appearance.%' OR NEW.`action` LIKE 'site.%'
        THEN 'APPEARANCE_SETTINGS'
      WHEN NEW.`action` LIKE 'upload.%' OR NEW.`action` LIKE 'import.%'
        OR NEW.`action` LIKE 'workspace.review.%'
        THEN 'UPLOADS_IMPORTS'
      ELSE NEW.`category`
    END,
    `source_area` = CASE
      WHEN NEW.`action` LIKE 'series.%' OR NEW.`action` LIKE 'chapter.%'
        OR NEW.`action` LIKE 'workspace.series.%' THEN 'CATALOGUE'
      WHEN NEW.`action` LIKE 'team.%' THEN 'TEAMS'
      WHEN NEW.`action` LIKE 'discussion.%' OR NEW.`action` LIKE 'comment.%'
        OR NEW.`action` LIKE 'review.%'
        OR NEW.`action` LIKE 'workspace.comment.%' THEN 'DISCUSSIONS'
      WHEN NEW.`action` LIKE 'store.%' OR NEW.`action` LIKE 'commerce.%'
        OR NEW.`action` LIKE 'wallet.%' THEN 'STORE'
      WHEN NEW.`action` LIKE 'appearance.%' OR NEW.`action` LIKE 'site.%'
        THEN 'APPEARANCE'
      WHEN NEW.`action` LIKE 'upload.%' OR NEW.`action` LIKE 'import.%'
        OR NEW.`action` LIKE 'workspace.review.%' THEN 'UPLOADS'
      ELSE NEW.`source_area`
    END
  WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
ALTER TABLE `creators` ADD `normalized_name` text;--> statement-breakpoint
ALTER TABLE `creators` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `creators` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `creators`
SET
  `normalized_name` = CASE
    WHEN TRIM(`name`,
      ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
      char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
      char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
      char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279)
    ) = ''
      THEN '#review:' || `id`
    WHEN `id` = (
      SELECT MIN(canonical.`id`)
      FROM `creators` canonical
      WHERE LOWER(TRIM(REPLACE(REPLACE(REPLACE(canonical.`name`, '  ', ' '), '  ', ' '), '  ', ' '))) =
            LOWER(TRIM(REPLACE(REPLACE(REPLACE(`creators`.`name`, '  ', ' '), '  ', ' '), '  ', ' ')))
    )
      THEN LOWER(TRIM(REPLACE(REPLACE(REPLACE(`name`, '  ', ' '), '  ', ' '), '  ', ' ')))
    ELSE LOWER(TRIM(REPLACE(REPLACE(REPLACE(`name`, '  ', ' '), '  ', ' '), '  ', ' '))) || '#review:' || `id`
  END,
  `archived_at` = CASE
    WHEN TRIM(`name`,
      ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
      char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
      char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
      char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279)
    ) = ''
      THEN CURRENT_TIMESTAMP
    ELSE `archived_at`
  END;--> statement-breakpoint
CREATE UNIQUE INDEX `creators_normalized_name_uidx` ON `creators` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `creators_active_idx` ON `creators` (`archived_at`,`name`);--> statement-breakpoint
ALTER TABLE `discussion_comments` ADD `affiliation_team_id` text REFERENCES teams(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `discussion_comments` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `discussion_comments_affiliation_team_idx` ON `discussion_comments` (`affiliation_team_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `genres` ADD `normalized_key` text;--> statement-breakpoint
ALTER TABLE `genres` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `genres` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `genres` ADD `updated_at` text;--> statement-breakpoint
UPDATE `genres` SET `updated_at` = COALESCE(`created_at`, CURRENT_TIMESTAMP);--> statement-breakpoint
INSERT OR IGNORE INTO `series_genres` (`series_id`, `genre_id`)
SELECT
  sg.`series_id`,
  (
    SELECT MIN(canonical.`id`)
    FROM `genres` canonical
    WHERE LOWER(TRIM(REPLACE(REPLACE(REPLACE(canonical.`name`, '  ', ' '), '  ', ' '), '  ', ' '))) =
          LOWER(TRIM(REPLACE(REPLACE(REPLACE(source.`name`, '  ', ' '), '  ', ' '), '  ', ' ')))
  )
FROM `series_genres` sg
JOIN `genres` source ON source.`id` = sg.`genre_id`;--> statement-breakpoint
DELETE FROM `series_genres`
WHERE `genre_id` NOT IN (
  SELECT MIN(`id`) FROM `genres`
  GROUP BY LOWER(TRIM(REPLACE(REPLACE(REPLACE(`name`, '  ', ' '), '  ', ' '), '  ', ' ')))
);--> statement-breakpoint
UPDATE `genres`
SET
  `normalized_key` = CASE
    WHEN TRIM(`name`,
      ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
      char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
      char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
      char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279)
    ) = ''
      THEN '#archived:' || `id`
    WHEN `id` = (
      SELECT MIN(canonical.`id`)
      FROM `genres` canonical
      WHERE LOWER(TRIM(REPLACE(REPLACE(REPLACE(canonical.`name`, '  ', ' '), '  ', ' '), '  ', ' '))) =
            LOWER(TRIM(REPLACE(REPLACE(REPLACE(`genres`.`name`, '  ', ' '), '  ', ' '), '  ', ' ')))
    )
      THEN LOWER(TRIM(REPLACE(REPLACE(REPLACE(`name`, '  ', ' '), '  ', ' '), '  ', ' ')))
    ELSE LOWER(TRIM(REPLACE(REPLACE(REPLACE(`name`, '  ', ' '), '  ', ' '), '  ', ' '))) || '#archived:' || `id`
  END,
  `archived_at` = CASE
    WHEN TRIM(`name`,
      ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
      char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
      char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
      char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279)
    ) = ''
      THEN CURRENT_TIMESTAMP
    WHEN `id` = (
      SELECT MIN(canonical.`id`)
      FROM `genres` canonical
      WHERE LOWER(TRIM(REPLACE(REPLACE(REPLACE(canonical.`name`, '  ', ' '), '  ', ' '), '  ', ' '))) =
            LOWER(TRIM(REPLACE(REPLACE(REPLACE(`genres`.`name`, '  ', ' '), '  ', ' '), '  ', ' ')))
    )
      THEN `archived_at`
    ELSE CURRENT_TIMESTAMP
  END;--> statement-breakpoint
CREATE UNIQUE INDEX `genres_normalized_key_uidx` ON `genres` (`normalized_key`);--> statement-breakpoint
CREATE INDEX `genres_active_idx` ON `genres` (`archived_at`,`name`);--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_creator_normalize_' || lower(hex(randomblob(8))),
  'taxonomy.normalization.review',
  'SERIES_CHAPTERS',
  'MIGRATION',
  'SUCCESS',
  'CREATOR',
  `id`,
  `name`,
  CASE
    WHEN TRIM(`name`,
      ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
      char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
      char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
      char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279)
    ) = ''
      THEN 'Blank legacy creator name was archived for administrator review.'
    ELSE 'Unicode or complex whitespace requires NFKC-aware administrator review.'
  END,
  'migration-0012',
  json_object('legacyNormalizedKey', `normalized_name`)
FROM `creators`
WHERE `normalized_name` LIKE '%#review:%'
   OR `name` GLOB '*[^ -~]*'
   OR `name` <> TRIM(`name`)
   OR INSTR(`name`, '  ') > 0;--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_genre_normalize_' || lower(hex(randomblob(8))),
  'taxonomy.normalization.review',
  'SERIES_CHAPTERS',
  'MIGRATION',
  'SUCCESS',
  'GENRE',
  `id`,
  `name`,
  CASE
    WHEN TRIM(`name`,
      ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
      char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
      char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
      char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279)
    ) = ''
      THEN 'Blank legacy genre name was archived for administrator review.'
    ELSE 'Unicode or complex whitespace requires NFKC-aware administrator review.'
  END,
  'migration-0012',
  json_object('legacyNormalizedKey', `normalized_key`)
FROM `genres`
WHERE TRIM(`name`,
        ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
        char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
        char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
        char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
        char(8239) || char(8287) || char(12288) || char(65279)
      ) = ''
   OR `name` GLOB '*[^ -~]*'
   OR `name` <> TRIM(`name`)
   OR INSTR(`name`, '  ') > 0;--> statement-breakpoint
ALTER TABLE `products` ADD `short_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `detailed_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `benefits_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `discount_percent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `promotional_badge` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `starts_at` text;--> statement-breakpoint
ALTER TABLE `products` ADD `ends_at` text;--> statement-breakpoint
ALTER TABLE `products` ADD `lifecycle_status` text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `is_featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `cta_text` text DEFAULT 'View offer' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `alt_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `theme_key` text DEFAULT 'OCEAN' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `primary_image_key` text;--> statement-breakpoint
ALTER TABLE `products` ADD `banner_image_key` text;--> statement-breakpoint
ALTER TABLE `products` ADD `icon_image_key` text;--> statement-breakpoint
ALTER TABLE `products` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `products` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `products`
SET
  `short_description` = `description`,
  `detailed_description` = `description`,
  `alt_text` = `name`,
  `lifecycle_status` = CASE WHEN `active` = 1 THEN 'ACTIVE' ELSE 'HIDDEN' END,
  `cta_text` = CASE
    WHEN `kind` = 'CURRENCY_PACKAGE' THEN 'Buy coins'
    WHEN `kind` = 'MEMBERSHIP' THEN 'Choose membership'
    ELSE 'View offer'
  END;--> statement-breakpoint
INSERT INTO `products`
  (`id`, `slug`, `kind`, `name`, `description`, `price_minor`,
   `billing_currency`, `onyx_base`, `onyx_bonus`, `active`,
   `short_description`, `detailed_description`, `benefits_json`,
   `discount_percent`, `promotional_badge`, `lifecycle_status`,
   `is_featured`, `sort_order`, `cta_text`, `alt_text`, `theme_key`,
   `metadata_json`, `revision`)
SELECT
  COALESCE(
    (
      SELECT existing.`id`
      FROM `products` existing
      WHERE existing.`kind` = 'CURRENCY_PACKAGE'
        AND existing.`slug` = json_extract(package.value, '$.id')
      LIMIT 1
    ),
    'product_coin_v12_' || lower(hex(randomblob(16)))
  ),
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM `products` existing
      WHERE existing.`kind` = 'CURRENCY_PACKAGE'
        AND existing.`slug` = json_extract(package.value, '$.id')
    ) THEN json_extract(package.value, '$.id')
    WHEN NOT EXISTS (
      SELECT 1
      FROM `products` existing
      WHERE existing.`slug` = json_extract(package.value, '$.id')
    ) THEN json_extract(package.value, '$.id')
    WHEN NOT EXISTS (
      SELECT 1
      FROM `products` existing
      WHERE existing.`slug` = 'coin-' || json_extract(package.value, '$.id')
    ) THEN 'coin-' || json_extract(package.value, '$.id')
    ELSE 'coin-' || json_extract(package.value, '$.id') || '-' ||
         lower(hex(randomblob(8)))
  END,
  'CURRENCY_PACKAGE',
  json_extract(package.value, '$.name'),
  COALESCE(json_extract(package.value, '$.description'), ''),
  CAST(json_extract(package.value, '$.priceMinor') AS INTEGER),
  COALESCE(json_extract(package.value, '$.billingCurrency'), 'USD'),
  CAST(json_extract(package.value, '$.baseCoins') AS INTEGER),
  CAST(COALESCE(json_extract(package.value, '$.bonusCoins'), 0) AS INTEGER),
  COALESCE(json_extract(package.value, '$.active'), 0),
  COALESCE(json_extract(package.value, '$.description'), ''),
  COALESCE(json_extract(package.value, '$.description'), ''),
  '[]',
  CAST(COALESCE(json_extract(package.value, '$.discountPercent'), 0) AS INTEGER),
  COALESCE(json_extract(package.value, '$.promotionLabel'), ''),
  CASE WHEN COALESCE(json_extract(package.value, '$.active'), 0) = 1
       THEN 'ACTIVE' ELSE 'HIDDEN' END,
  COALESCE(json_extract(package.value, '$.featured'), 0),
  CAST(package.key AS INTEGER) * 10,
  'Buy coins',
  json_extract(package.value, '$.name'),
  'ONYX',
  json_object('migratedFrom', 'commercial_settings'),
  1
FROM (
  SELECT
    package.`key`,
    package.`type`,
    CASE WHEN package.`type` = 'object'
         THEN package.`value` ELSE '{}' END AS `value`,
    ROW_NUMBER() OVER (
      PARTITION BY CASE
        WHEN package.`type` = 'object'
          THEN json_extract(package.`value`, '$.id')
        ELSE '__invalid__' || package.`key`
      END
      ORDER BY CAST(package.`key` AS INTEGER)
    ) AS `source_rank`
  FROM `commercial_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.economy.packages'
       ) package
  WHERE settings.`id` = 'active'
) package
WHERE package.`type` = 'object'
  AND package.`source_rank` = 1
  AND json_type(package.value, '$.id') = 'text'
  AND LENGTH(TRIM(json_extract(package.value, '$.id'))) BETWEEN 1 AND 120
  AND json_type(package.value, '$.name') = 'text'
  AND LENGTH(TRIM(json_extract(package.value, '$.name'))) BETWEEN 1 AND 180
  AND json_type(package.value, '$.priceMinor') IN ('integer', 'real')
  AND CAST(json_extract(package.value, '$.priceMinor') AS INTEGER) >= 0
  AND json_type(package.value, '$.baseCoins') IN ('integer', 'real')
  AND CAST(json_extract(package.value, '$.baseCoins') AS INTEGER) >= 0
ON CONFLICT(`id`) DO UPDATE SET
  `name` = excluded.`name`,
  `description` = excluded.`description`,
  `price_minor` = excluded.`price_minor`,
  `billing_currency` = excluded.`billing_currency`,
  `onyx_base` = excluded.`onyx_base`,
  `onyx_bonus` = excluded.`onyx_bonus`,
  `active` = excluded.`active`,
  `short_description` = excluded.`short_description`,
  `detailed_description` = excluded.`detailed_description`,
  `discount_percent` = excluded.`discount_percent`,
  `promotional_badge` = excluded.`promotional_badge`,
  `lifecycle_status` = excluded.`lifecycle_status`,
  `is_featured` = excluded.`is_featured`,
  `sort_order` = excluded.`sort_order`,
  `cta_text` = excluded.`cta_text`,
  `alt_text` = excluded.`alt_text`,
  `theme_key` = excluded.`theme_key`,
  `metadata_json` = excluded.`metadata_json`,
  `revision` = `products`.`revision` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `products`.`kind` = excluded.`kind`
  AND `products`.`slug` = excluded.`slug`;--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_commercial_coin_skip_' || lower(hex(randomblob(8))),
  'migration.commercial_product.skipped',
  'COMMERCE_STORE',
  'MIGRATION',
  'FAILURE',
  'PRODUCT',
  COALESCE(CAST(json_extract(package.value, '$.id') AS TEXT),
           'package-index-' || package.key),
  COALESCE(CAST(json_extract(package.value, '$.name') AS TEXT),
           'Invalid coin package'),
  'A legacy coin package was skipped because it was duplicate or required identity/price fields were invalid.',
  'migration-0012',
  json_object('kind', 'CURRENCY_PACKAGE', 'legacyIndex', package.key)
FROM (
  SELECT
    package.`key`,
    package.`type`,
    CASE WHEN package.`type` = 'object'
         THEN package.`value` ELSE '{}' END AS `value`,
    ROW_NUMBER() OVER (
      PARTITION BY CASE
        WHEN package.`type` = 'object'
          THEN json_extract(package.`value`, '$.id')
        ELSE '__invalid__' || package.`key`
      END
      ORDER BY CAST(package.`key` AS INTEGER)
    ) AS `source_rank`
  FROM `commercial_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.economy.packages'
       ) package
  WHERE settings.`id` = 'active'
) package
WHERE package.`source_rank` > 1
   OR NOT COALESCE((
    package.`type` = 'object'
    AND json_type(package.value, '$.id') = 'text'
    AND LENGTH(TRIM(json_extract(package.value, '$.id'))) BETWEEN 1 AND 120
    AND json_type(package.value, '$.name') = 'text'
    AND LENGTH(TRIM(json_extract(package.value, '$.name'))) BETWEEN 1 AND 180
    AND json_type(package.value, '$.priceMinor') IN ('integer', 'real')
    AND CAST(json_extract(package.value, '$.priceMinor') AS INTEGER) >= 0
    AND json_type(package.value, '$.baseCoins') IN ('integer', 'real')
    AND CAST(json_extract(package.value, '$.baseCoins') AS INTEGER) >= 0
  ), 0);--> statement-breakpoint
INSERT INTO `products`
  (`id`, `slug`, `kind`, `name`, `description`, `price_minor`,
   `billing_currency`, `onyx_base`, `onyx_bonus`, `active`,
   `short_description`, `detailed_description`, `benefits_json`,
   `discount_percent`, `promotional_badge`, `lifecycle_status`,
   `is_featured`, `sort_order`, `cta_text`, `alt_text`, `theme_key`,
   `metadata_json`, `revision`)
SELECT
  COALESCE(
    (
      SELECT existing.`id`
      FROM `products` existing
      WHERE existing.`kind` = 'MEMBERSHIP'
        AND existing.`slug` = json_extract(membership.value, '$.id')
      LIMIT 1
    ),
    (
      SELECT existing.`id`
      FROM `products` existing
      WHERE existing.`kind` = 'MEMBERSHIP'
        AND existing.`slug` =
          json_extract(membership.value, '$.id') || '-monthly'
      LIMIT 1
    ),
    'product_membership_v12_' || lower(hex(randomblob(16)))
  ),
  COALESCE(
    (
      SELECT existing.`slug`
      FROM `products` existing
      WHERE existing.`kind` = 'MEMBERSHIP'
        AND existing.`slug` = json_extract(membership.value, '$.id')
      LIMIT 1
    ),
    (
      SELECT existing.`slug`
      FROM `products` existing
      WHERE existing.`kind` = 'MEMBERSHIP'
        AND existing.`slug` =
          json_extract(membership.value, '$.id') || '-monthly'
      LIMIT 1
    ),
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM `products` existing
        WHERE existing.`slug` = json_extract(membership.value, '$.id')
      ) THEN json_extract(membership.value, '$.id')
      WHEN NOT EXISTS (
        SELECT 1
        FROM `products` existing
        WHERE existing.`slug` =
          'membership-' || json_extract(membership.value, '$.id')
      ) THEN 'membership-' || json_extract(membership.value, '$.id')
      ELSE 'membership-' || json_extract(membership.value, '$.id') || '-' ||
           lower(hex(randomblob(8)))
    END
  ),
  'MEMBERSHIP',
  json_extract(membership.value, '$.name'),
  COALESCE(json_extract(membership.value, '$.description'), ''),
  CAST(json_extract(membership.value, '$.monthlyPriceMinor') AS INTEGER),
  COALESCE(json_extract(membership.value, '$.billingCurrency'), 'USD'),
  0,
  CAST(COALESCE(json_extract(membership.value, '$.monthlyCoins'), 0) AS INTEGER),
  COALESCE(json_extract(membership.value, '$.active'), 0),
  COALESCE(json_extract(membership.value, '$.description'), ''),
  COALESCE(json_extract(membership.value, '$.description'), ''),
  CASE WHEN json_type(membership.value, '$.benefits') = 'array'
       THEN json_extract(membership.value, '$.benefits') ELSE '[]' END,
  CAST(COALESCE(json_extract(membership.value, '$.chapterDiscountPercent'), 0) AS INTEGER),
  COALESCE(json_extract(membership.value, '$.promotionLabel'), ''),
  CASE WHEN COALESCE(json_extract(membership.value, '$.active'), 0) = 1
       THEN 'ACTIVE' ELSE 'HIDDEN' END,
  0,
  CAST(membership.key AS INTEGER) * 10,
  'Choose membership',
  json_extract(membership.value, '$.name'),
  'OCEAN',
  json_object(
    'migratedFrom', 'commercial_settings',
    'annualPriceMinor', json_extract(membership.value, '$.annualPriceMinor'),
    'monthlyCoins', json_extract(membership.value, '$.monthlyCoins')
  ),
  1
FROM (
  SELECT
    membership.`key`,
    membership.`type`,
    CASE WHEN membership.`type` = 'object'
         THEN membership.`value` ELSE '{}' END AS `value`,
    ROW_NUMBER() OVER (
      PARTITION BY CASE
        WHEN membership.`type` = 'object'
          THEN json_extract(membership.`value`, '$.id')
        ELSE '__invalid__' || membership.`key`
      END
      ORDER BY CAST(membership.`key` AS INTEGER)
    ) AS `source_rank`
  FROM `commercial_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.economy.memberships'
       ) membership
  WHERE settings.`id` = 'active'
) membership
WHERE membership.`type` = 'object'
  AND membership.`source_rank` = 1
  AND json_type(membership.value, '$.id') = 'text'
  AND LENGTH(TRIM(json_extract(membership.value, '$.id'))) BETWEEN 1 AND 120
  AND json_type(membership.value, '$.name') = 'text'
  AND LENGTH(TRIM(json_extract(membership.value, '$.name'))) BETWEEN 1 AND 180
  AND json_type(membership.value, '$.monthlyPriceMinor') IN ('integer', 'real')
  AND CAST(json_extract(membership.value, '$.monthlyPriceMinor') AS INTEGER) >= 0
ON CONFLICT(`id`) DO UPDATE SET
  `name` = excluded.`name`,
  `description` = excluded.`description`,
  `price_minor` = excluded.`price_minor`,
  `billing_currency` = excluded.`billing_currency`,
  `onyx_bonus` = excluded.`onyx_bonus`,
  `active` = excluded.`active`,
  `short_description` = excluded.`short_description`,
  `detailed_description` = excluded.`detailed_description`,
  `benefits_json` = excluded.`benefits_json`,
  `discount_percent` = excluded.`discount_percent`,
  `promotional_badge` = excluded.`promotional_badge`,
  `lifecycle_status` = excluded.`lifecycle_status`,
  `sort_order` = excluded.`sort_order`,
  `cta_text` = excluded.`cta_text`,
  `alt_text` = excluded.`alt_text`,
  `theme_key` = excluded.`theme_key`,
  `metadata_json` = excluded.`metadata_json`,
  `revision` = `products`.`revision` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `products`.`kind` = excluded.`kind`
  AND `products`.`slug` = excluded.`slug`;--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_commercial_membership_skip_' || lower(hex(randomblob(8))),
  'migration.commercial_product.skipped',
  'COMMERCE_STORE',
  'MIGRATION',
  'FAILURE',
  'PRODUCT',
  COALESCE(CAST(json_extract(membership.value, '$.id') AS TEXT),
           'membership-index-' || membership.key),
  COALESCE(CAST(json_extract(membership.value, '$.name') AS TEXT),
           'Invalid membership'),
  'A legacy membership was skipped because it was duplicate or required identity/price fields were invalid.',
  'migration-0012',
  json_object('kind', 'MEMBERSHIP', 'legacyIndex', membership.key)
FROM (
  SELECT
    membership.`key`,
    membership.`type`,
    CASE WHEN membership.`type` = 'object'
         THEN membership.`value` ELSE '{}' END AS `value`,
    ROW_NUMBER() OVER (
      PARTITION BY CASE
        WHEN membership.`type` = 'object'
          THEN json_extract(membership.`value`, '$.id')
        ELSE '__invalid__' || membership.`key`
      END
      ORDER BY CAST(membership.`key` AS INTEGER)
    ) AS `source_rank`
  FROM `commercial_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.economy.memberships'
       ) membership
  WHERE settings.`id` = 'active'
) membership
WHERE membership.`source_rank` > 1
   OR NOT COALESCE((
    membership.`type` = 'object'
    AND json_type(membership.value, '$.id') = 'text'
    AND LENGTH(TRIM(json_extract(membership.value, '$.id'))) BETWEEN 1 AND 120
    AND json_type(membership.value, '$.name') = 'text'
    AND LENGTH(TRIM(json_extract(membership.value, '$.name'))) BETWEEN 1 AND 180
    AND json_type(membership.value, '$.monthlyPriceMinor') IN ('integer', 'real')
    AND CAST(json_extract(membership.value, '$.monthlyPriceMinor') AS INTEGER) >= 0
  ), 0);--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_commercial_benefits_normalize_' || lower(hex(randomblob(8))),
  'migration.commercial_product.normalized',
  'COMMERCE_STORE',
  'MIGRATION',
  'SUCCESS',
  'PRODUCT',
  json_extract(membership.`value`, '$.id'),
  json_extract(membership.`value`, '$.name'),
  'Legacy membership benefits were not an array and were replaced with an empty list.',
  'migration-0012',
  json_object('kind', 'MEMBERSHIP', 'legacyIndex', membership.`key`)
FROM (
  SELECT
    membership.`key`,
    membership.`type`,
    CASE WHEN membership.`type` = 'object'
         THEN membership.`value` ELSE '{}' END AS `value`
  FROM `commercial_settings` settings,
       json_each(
         CASE
           WHEN json_valid(settings.`settings_json`) THEN settings.`settings_json`
           ELSE '{}'
         END,
         '$.economy.memberships'
       ) membership
  WHERE settings.`id` = 'active'
) membership
WHERE membership.`type` = 'object'
  AND json_type(membership.`value`, '$.id') = 'text'
  AND json_type(membership.`value`, '$.name') = 'text'
  AND json_type(membership.`value`, '$.monthlyPriceMinor') IN ('integer', 'real')
  AND json_type(membership.`value`, '$.benefits') IS NOT NULL
  AND json_type(membership.`value`, '$.benefits') <> 'array';--> statement-breakpoint
CREATE INDEX `products_public_idx` ON `products` (`lifecycle_status`,`active`,`starts_at`,`ends_at`,`sort_order`);--> statement-breakpoint
ALTER TABLE `series` ADD `publication_year` integer;--> statement-breakpoint
ALTER TABLE `series` ADD `publisher_id` text REFERENCES publishers(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `series` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `series` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `actor_user_id`, `actor_role`, `action`, `category`, `source_area`,
   `result`, `target_type`, `target_id`, `target_label`, `reason`,
   `request_id`, `metadata_json`)
SELECT
  'audit_normalize_' || lower(hex(randomblob(12))),
  NULL,
  NULL,
  'series.normalization.review',
  'SERIES_CHAPTERS',
  'MIGRATION',
  'SUCCESS',
  'SERIES',
  s.`id`,
  s.`title`,
  'Country or language needs manual normalization.',
  'migration-0012',
  json_object(
    'originCountry', s.`origin_country`,
    'originalLanguage', s.`original_language`
  )
FROM `series` s
WHERE LOWER(TRIM(s.`origin_country`)) NOT IN (
        'ar','au','br','ca','cl','cn','de','dz','eg','es','fr','gb','id','in',
        'it','jp','kr','ma','mx','my','ph','pl','pt','ru','sa','sg','th','tn',
        'tr','tw','ua','us','vn','argentina','australia','brazil','canada',
        'chile','china','germany','algeria','egypt','spain','france',
        'united kingdom','indonesia','india','italy','japan','south korea',
        'korea','morocco','mexico','malaysia','philippines','poland',
        'portugal','russia','saudi arabia','singapore','thailand','tunisia',
        'türkiye','turkey','taiwan','ukraine','united states','vietnam'
      )
   OR LOWER(TRIM(s.`original_language`)) NOT IN (
        'ar','de','en','es','fr','hi','id','it','ja','ko','ms','pl','pt','ru',
        'th','tr','uk','vi','zh','arabic','german','english','spanish',
        'french','hindi','indonesian','italian','japanese','korean','malay',
        'polish','portuguese','russian','thai','turkish','ukrainian',
        'vietnamese','chinese'
      );--> statement-breakpoint
UPDATE `series`
SET
  `origin_country` = CASE LOWER(TRIM(`origin_country`))
    WHEN 'argentina' THEN 'AR'
    WHEN 'australia' THEN 'AU'
    WHEN 'brazil' THEN 'BR'
    WHEN 'canada' THEN 'CA'
    WHEN 'chile' THEN 'CL'
    WHEN 'japan' THEN 'JP'
    WHEN 'south korea' THEN 'KR'
    WHEN 'korea' THEN 'KR'
    WHEN 'china' THEN 'CN'
    WHEN 'germany' THEN 'DE'
    WHEN 'algeria' THEN 'DZ'
    WHEN 'egypt' THEN 'EG'
    WHEN 'spain' THEN 'ES'
    WHEN 'france' THEN 'FR'
    WHEN 'taiwan' THEN 'TW'
    WHEN 'tunisia' THEN 'TN'
    WHEN 'united kingdom' THEN 'GB'
    WHEN 'indonesia' THEN 'ID'
    WHEN 'india' THEN 'IN'
    WHEN 'italy' THEN 'IT'
    WHEN 'morocco' THEN 'MA'
    WHEN 'mexico' THEN 'MX'
    WHEN 'malaysia' THEN 'MY'
    WHEN 'philippines' THEN 'PH'
    WHEN 'poland' THEN 'PL'
    WHEN 'portugal' THEN 'PT'
    WHEN 'russia' THEN 'RU'
    WHEN 'saudi arabia' THEN 'SA'
    WHEN 'singapore' THEN 'SG'
    WHEN 'thailand' THEN 'TH'
    WHEN 'türkiye' THEN 'TR'
    WHEN 'turkey' THEN 'TR'
    WHEN 'ukraine' THEN 'UA'
    WHEN 'united states' THEN 'US'
    WHEN 'vietnam' THEN 'VN'
    ELSE CASE
      WHEN LOWER(TRIM(`origin_country`)) IN (
        'ar','au','br','ca','cl','cn','de','dz','eg','es','fr','gb','id','in',
        'it','jp','kr','ma','mx','my','ph','pl','pt','ru','sa','sg','th','tn',
        'tr','tw','ua','us','vn'
      ) THEN UPPER(TRIM(`origin_country`))
      ELSE TRIM(`origin_country`)
    END
  END,
  `original_language` = CASE LOWER(TRIM(`original_language`))
    WHEN 'japanese' THEN 'ja'
    WHEN 'korean' THEN 'ko'
    WHEN 'chinese' THEN 'zh'
    WHEN 'arabic' THEN 'ar'
    WHEN 'english' THEN 'en'
    WHEN 'french' THEN 'fr'
    WHEN 'german' THEN 'de'
    WHEN 'hindi' THEN 'hi'
    WHEN 'indonesian' THEN 'id'
    WHEN 'italian' THEN 'it'
    WHEN 'malay' THEN 'ms'
    WHEN 'polish' THEN 'pl'
    WHEN 'portuguese' THEN 'pt'
    WHEN 'russian' THEN 'ru'
    WHEN 'spanish' THEN 'es'
    WHEN 'thai' THEN 'th'
    WHEN 'turkish' THEN 'tr'
    WHEN 'ukrainian' THEN 'uk'
    WHEN 'vietnamese' THEN 'vi'
    ELSE CASE
      WHEN LOWER(TRIM(`original_language`)) IN (
        'ar','de','en','es','fr','hi','id','it','ja','ko','ms','pl','pt','ru',
        'th','tr','uk','vi','zh'
      ) THEN LOWER(TRIM(`original_language`))
      ELSE TRIM(`original_language`)
    END
  END;--> statement-breakpoint
CREATE INDEX `series_title_lookup_idx` ON `series` (`title`,`updated_at`);--> statement-breakpoint
CREATE INDEX `series_publisher_idx` ON `series` (`publisher_id`);--> statement-breakpoint
ALTER TABLE `series_aliases` ADD `normalized_alias` text;--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_alias_blank_' || lower(hex(randomblob(8))),
  'series.alias.normalization.removed',
  'SERIES_CHAPTERS',
  'MIGRATION',
  'SUCCESS',
  'SERIES_ALIAS',
  CAST(`id` AS TEXT),
  `alias`,
  'Blank legacy alternative title was removed because it cannot be searched or displayed safely.',
  'migration-0012',
  json_object('seriesId', `series_id`)
FROM `series_aliases`
WHERE TRIM(`alias`,
        ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
        char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
        char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
        char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
        char(8239) || char(8287) || char(12288) || char(65279)
      ) = '';--> statement-breakpoint
DELETE FROM `series_aliases`
WHERE TRIM(`alias`,
        ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
        char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
        char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
        char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
        char(8239) || char(8287) || char(12288) || char(65279)
      ) = '';--> statement-breakpoint
DELETE FROM `series_aliases`
WHERE `id` NOT IN (
  SELECT MIN(`id`)
  FROM `series_aliases`
  GROUP BY `series_id`,
    LOWER(TRIM(REPLACE(REPLACE(REPLACE(`alias`, '  ', ' '), '  ', ' '), '  ', ' ')))
);--> statement-breakpoint
UPDATE `series_aliases`
SET `normalized_alias` =
  LOWER(TRIM(REPLACE(REPLACE(REPLACE(`alias`, '  ', ' '), '  ', ' '), '  ', ' ')));--> statement-breakpoint
INSERT OR IGNORE INTO `series_aliases`
  (`series_id`, `alias`, `normalized_alias`, `language`)
SELECT
  s.`id`,
  TRIM(s.`native_title`,
    ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
    char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
    char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
    char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
    char(8239) || char(8287) || char(12288) || char(65279)
  ),
  LOWER(TRIM(REPLACE(REPLACE(REPLACE(
    TRIM(s.`native_title`,
      ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
      char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
      char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
      char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
      char(8239) || char(8287) || char(12288) || char(65279)
    ),
    '  ', ' '), '  ', ' '), '  ', ' '))),
  s.`original_language`
FROM `series` s
WHERE s.`native_title` IS NOT NULL
  AND TRIM(s.`native_title`,
        ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
        char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
        char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
        char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
        char(8239) || char(8287) || char(12288) || char(65279)
      ) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM `series_aliases` sa
    WHERE sa.`series_id` = s.`id`
      AND sa.`normalized_alias` =
        LOWER(TRIM(REPLACE(REPLACE(REPLACE(
          TRIM(s.`native_title`,
            ' ' || char(9) || char(10) || char(11) || char(12) || char(13) ||
            char(160) || char(5760) || char(8192) || char(8193) || char(8194) ||
            char(8195) || char(8196) || char(8197) || char(8198) || char(8199) ||
            char(8200) || char(8201) || char(8202) || char(8232) || char(8233) ||
            char(8239) || char(8287) || char(12288) || char(65279)
          ),
          '  ', ' '), '  ', ' '), '  ', ' ')))
  );--> statement-breakpoint
CREATE UNIQUE INDEX `series_alias_normalized_uidx` ON `series_aliases` (`series_id`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `series_alias_normalized_search_idx` ON `series_aliases` (`normalized_alias`);--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `target_label`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_alias_normalize_' || lower(hex(randomblob(8))),
  'series.alias.normalization.review',
  'SERIES_CHAPTERS',
  'MIGRATION',
  'SUCCESS',
  'SERIES_ALIAS',
  CAST(`id` AS TEXT),
  `alias`,
  'Unicode or complex whitespace requires NFKC-aware administrator review.',
  'migration-0012',
  json_object(
    'seriesId', `series_id`,
    'legacyNormalizedKey', `normalized_alias`
  )
FROM `series_aliases`
WHERE `alias` GLOB '*[^ -~]*'
   OR `alias` <> TRIM(`alias`)
   OR INSTR(`alias`, '  ') > 0;--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `is_primary` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `assigned_by_user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `series_team_assignments`
SET `is_primary` = 1
WHERE `team_id` = (
  SELECT MIN(primary_assignment.`team_id`)
  FROM `series_team_assignments` primary_assignment
  WHERE primary_assignment.`series_id` = `series_team_assignments`.`series_id`
)
  AND (
    SELECT COUNT(*)
    FROM `series_team_assignments` assignment_count
    WHERE assignment_count.`series_id` = `series_team_assignments`.`series_id`
  ) = 1;--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_series_primary_review_' || lower(hex(randomblob(8))),
  'series.team.primary.review',
  'TEAMS_PERMISSIONS',
  'MIGRATION',
  'SUCCESS',
  'SERIES',
  `series_id`,
  'Multiple existing team assignments were preserved without guessing a primary team.',
  'migration-0012',
  json_object('assignmentCount', COUNT(*))
FROM `series_team_assignments`
GROUP BY `series_id`
HAVING COUNT(*) > 1;--> statement-breakpoint
CREATE UNIQUE INDEX `series_team_primary_uidx`
ON `series_team_assignments` (`series_id`)
WHERE `is_primary` = 1;--> statement-breakpoint
ALTER TABLE `store_collections` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `store_items` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `store_items` ADD `archived_at` text;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_team_memberships` (
  `team_id` text NOT NULL,
  `user_id` text NOT NULL,
  `membership_role` text NOT NULL,
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `is_primary` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  PRIMARY KEY(`team_id`, `user_id`),
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_team_memberships`
  (`team_id`, `user_id`, `membership_role`, `status`, `is_primary`,
   `created_at`, `updated_at`, `revision`)
SELECT
  `team_id`, `user_id`, `membership_role`, `status`, 0,
  `created_at`, COALESCE(`created_at`, CURRENT_TIMESTAMP), 1
FROM `team_memberships`;--> statement-breakpoint
DROP TABLE `team_memberships`;--> statement-breakpoint
ALTER TABLE `__new_team_memberships` RENAME TO `team_memberships`;--> statement-breakpoint
CREATE INDEX `team_memberships_user_idx` ON `team_memberships` (`user_id`);--> statement-breakpoint
UPDATE `team_memberships`
SET `is_primary` = 1
WHERE `team_id` = (
  SELECT MIN(primary_membership.`team_id`)
  FROM `team_memberships` primary_membership
  WHERE primary_membership.`user_id` = `team_memberships`.`user_id`
    AND primary_membership.`status` = 'ACTIVE'
)
  AND (
    SELECT COUNT(*)
    FROM `team_memberships` membership_count
    WHERE membership_count.`user_id` = `team_memberships`.`user_id`
      AND membership_count.`status` = 'ACTIVE'
  ) = 1;--> statement-breakpoint
INSERT INTO `audit_logs`
  (`id`, `action`, `category`, `source_area`, `result`, `target_type`,
   `target_id`, `reason`, `request_id`, `metadata_json`)
SELECT
  'audit_membership_primary_review_' || lower(hex(randomblob(8))),
  'team.membership.primary.review',
  'TEAMS_PERMISSIONS',
  'MIGRATION',
  'SUCCESS',
  'USER',
  `user_id`,
  'Multiple active team memberships were preserved without guessing a primary affiliation.',
  'migration-0012',
  json_object('activeMembershipCount', COUNT(*))
FROM `team_memberships`
WHERE `status` = 'ACTIVE'
GROUP BY `user_id`
HAVING COUNT(*) > 1;--> statement-breakpoint
CREATE UNIQUE INDEX `team_membership_primary_uidx`
ON `team_memberships` (`user_id`)
WHERE `is_primary` = 1 AND `status` = 'ACTIVE';--> statement-breakpoint
ALTER TABLE `teams` ADD `logo_key` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `banner_key` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `staff_badge_key` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `comment_effect_type` text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `comment_effect_config_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `comment_effect_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `is_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `teams_status_idx` ON `teams` (`is_archived`,`verification_status`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `series_team_active_insert_v12`
BEFORE INSERT ON `series_team_assignments`
WHEN NOT EXISTS (
  SELECT 1 FROM `teams`
  WHERE `id` = NEW.`team_id`
    AND `is_archived` = 0
    AND `verification_status` <> 'SUSPENDED'
)
BEGIN
  SELECT RAISE(ABORT, 'series_team_not_active');
END;--> statement-breakpoint
CREATE TRIGGER `series_team_active_update_v12`
BEFORE UPDATE OF `team_id` ON `series_team_assignments`
WHEN NOT EXISTS (
  SELECT 1 FROM `teams`
  WHERE `id` = NEW.`team_id`
    AND `is_archived` = 0
    AND `verification_status` <> 'SUSPENDED'
)
BEGIN
  SELECT RAISE(ABORT, 'series_team_not_active');
END;--> statement-breakpoint
CREATE TRIGGER `creators_normalized_insert_guard_v12`
BEFORE INSERT ON `creators`
WHEN NEW.`normalized_name` IS NULL OR TRIM(NEW.`normalized_name`) = ''
BEGIN
  SELECT RAISE(ABORT, 'creator_normalized_name_required');
END;--> statement-breakpoint
CREATE TRIGGER `creators_normalized_update_guard_v12`
BEFORE UPDATE OF `normalized_name` ON `creators`
WHEN NEW.`normalized_name` IS NULL OR TRIM(NEW.`normalized_name`) = ''
BEGIN
  SELECT RAISE(ABORT, 'creator_normalized_name_required');
END;--> statement-breakpoint
CREATE TRIGGER `genres_normalized_insert_guard_v12`
BEFORE INSERT ON `genres`
WHEN NEW.`normalized_key` IS NULL OR TRIM(NEW.`normalized_key`) = ''
BEGIN
  SELECT RAISE(ABORT, 'genre_normalized_key_required');
END;--> statement-breakpoint
CREATE TRIGGER `genres_normalized_update_guard_v12`
BEFORE UPDATE OF `normalized_key` ON `genres`
WHEN NEW.`normalized_key` IS NULL OR TRIM(NEW.`normalized_key`) = ''
BEGIN
  SELECT RAISE(ABORT, 'genre_normalized_key_required');
END;--> statement-breakpoint
CREATE TRIGGER `genres_updated_at_insert_v12`
AFTER INSERT ON `genres`
WHEN NEW.`updated_at` IS NULL
BEGIN
  UPDATE `genres`
  SET `updated_at` = CURRENT_TIMESTAMP
  WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `genres_updated_at_update_v12`
AFTER UPDATE ON `genres`
WHEN NEW.`updated_at` IS NULL
BEGIN
  UPDATE `genres`
  SET `updated_at` = CURRENT_TIMESTAMP
  WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `series_alias_normalized_insert_guard_v12`
BEFORE INSERT ON `series_aliases`
WHEN NEW.`normalized_alias` IS NULL OR TRIM(NEW.`normalized_alias`) = ''
BEGIN
  SELECT RAISE(ABORT, 'series_alias_normalized_required');
END;--> statement-breakpoint
CREATE TRIGGER `series_alias_normalized_update_guard_v12`
BEFORE UPDATE OF `normalized_alias` ON `series_aliases`
WHEN NEW.`normalized_alias` IS NULL OR TRIM(NEW.`normalized_alias`) = ''
BEGIN
  SELECT RAISE(ABORT, 'series_alias_normalized_required');
END;--> statement-breakpoint
CREATE TRIGGER `series_external_source_guard_v12`
BEFORE INSERT ON `series_external_sources`
WHEN NEW.`source` NOT IN ('MANGADEX', 'MANGAUPDATES')
BEGIN
  SELECT RAISE(ABORT, 'invalid_external_source');
END;--> statement-breakpoint
CREATE TRIGGER `series_creator_active_guard_v12`
BEFORE INSERT ON `series_creators`
WHEN NOT EXISTS (
  SELECT 1 FROM `creators`
  WHERE `id` = NEW.`creator_id` AND `archived_at` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'series_creator_not_active');
END;--> statement-breakpoint
CREATE TRIGGER `series_genre_active_guard_v12`
BEFORE INSERT ON `series_genres`
WHEN NOT EXISTS (
  SELECT 1 FROM `genres`
  WHERE `id` = NEW.`genre_id` AND `archived_at` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'series_genre_not_active');
END;--> statement-breakpoint
CREATE TRIGGER `series_publisher_active_insert_guard_v12`
BEFORE INSERT ON `series`
WHEN NEW.`publisher_id` IS NOT NULL
 AND NOT EXISTS (
  SELECT 1 FROM `publishers`
  WHERE `id` = NEW.`publisher_id` AND `archived_at` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'series_publisher_not_active');
END;--> statement-breakpoint
CREATE TRIGGER `series_publisher_active_update_guard_v12`
BEFORE UPDATE OF `publisher_id` ON `series`
WHEN NEW.`publisher_id` IS NOT NULL
 AND NOT EXISTS (
  SELECT 1 FROM `publishers`
  WHERE `id` = NEW.`publisher_id` AND `archived_at` IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'series_publisher_not_active');
END;--> statement-breakpoint
CREATE TRIGGER `users_role_insert_guard_v12`
BEFORE INSERT ON `users`
WHEN NEW.`primary_role` NOT IN
  ('OWNER', 'ADMINISTRATOR', 'MODERATOR', 'TEAM_LEADER', 'UPLOADER', 'USER')
BEGIN
  SELECT RAISE(ABORT, 'invalid_user_role');
END;--> statement-breakpoint
CREATE TRIGGER `users_role_update_guard_v12`
BEFORE UPDATE OF `primary_role` ON `users`
WHEN NEW.`primary_role` NOT IN
  ('OWNER', 'ADMINISTRATOR', 'MODERATOR', 'TEAM_LEADER', 'UPLOADER', 'USER')
BEGIN
  SELECT RAISE(ABORT, 'invalid_user_role');
END;--> statement-breakpoint
CREATE TRIGGER `users_final_active_owner_guard_v12`
BEFORE UPDATE OF `primary_role`, `status` ON `users`
WHEN OLD.`primary_role` = 'OWNER'
  AND OLD.`status` = 'ACTIVE'
  AND (NEW.`primary_role` <> 'OWNER' OR NEW.`status` <> 'ACTIVE')
  AND (
    SELECT COUNT(*)
    FROM `users`
    WHERE `primary_role` = 'OWNER' AND `status` = 'ACTIVE'
  ) <= 1
BEGIN
  SELECT RAISE(ABORT, 'final_active_owner_required');
END;--> statement-breakpoint
CREATE TRIGGER `products_lifecycle_insert_guard_v12`
BEFORE INSERT ON `products`
WHEN NEW.`lifecycle_status` NOT IN
  ('DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'HIDDEN', 'ARCHIVED')
BEGIN
  SELECT RAISE(ABORT, 'invalid_product_lifecycle');
END;--> statement-breakpoint
CREATE TRIGGER `products_lifecycle_update_guard_v12`
BEFORE UPDATE OF `lifecycle_status` ON `products`
WHEN NEW.`lifecycle_status` NOT IN
  ('DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'HIDDEN', 'ARCHIVED')
BEGIN
  SELECT RAISE(ABORT, 'invalid_product_lifecycle');
END;
