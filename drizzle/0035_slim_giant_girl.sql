CREATE TABLE `api_key_rate_limits` (
	`api_key_id` text NOT NULL,
	`window_start` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`api_key_id`, `window_start`),
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_key_rate_limits_window_idx` ON `api_key_rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`app_name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`secret_hash` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`allowed_team_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`replaced_by_key_id` text,
	`expires_at` text,
	`last_used_at` text,
	`last_used_ip_hash` text,
	`request_count` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`allowed_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "api_keys_status_check" CHECK("api_keys"."status" IN ('ACTIVE', 'REVOKED', 'ROTATED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_prefix_uidx` ON `api_keys` (`key_prefix`);--> statement-breakpoint
CREATE INDEX `api_keys_status_idx` ON `api_keys` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_keys_team_idx` ON `api_keys` (`allowed_team_id`);--> statement-breakpoint
CREATE TABLE `floating_ads` (
	`id` text PRIMARY KEY NOT NULL,
	`eyebrow` text DEFAULT 'Support NyaScans' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`destination_url` text DEFAULT '' NOT NULL,
	`image_key` text,
	`fallback_image_url` text DEFAULT '' NOT NULL,
	`effect` text DEFAULT 'WAVE' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`reset_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "floating_ads_effect_check" CHECK("floating_ads"."effect" IN ('WAVE', 'PULSE', 'GLOW'))
);
--> statement-breakpoint
CREATE INDEX `floating_ads_active_idx` ON `floating_ads` (`is_active`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `floating_ads_single_active_uidx` ON `floating_ads` (`is_active`) WHERE `is_active` = 1;--> statement-breakpoint
CREATE TABLE `homepage_sliders` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text,
	`title` text NOT NULL,
	`category_label` text DEFAULT 'Featured' NOT NULL,
	`short_description` text DEFAULT '' NOT NULL,
	`destination_url` text DEFAULT '' NOT NULL,
	`image_key` text,
	`is_active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `homepage_sliders_active_idx` ON `homepage_sliders` (`is_active`,`sort_order`,`created_at`);--> statement-breakpoint
CREATE INDEX `homepage_sliders_series_idx` ON `homepage_sliders` (`series_id`);--> statement-breakpoint
CREATE TRIGGER `homepage_sliders_max_nine_insert`
BEFORE INSERT ON `homepage_sliders`
WHEN NEW.`is_active` = 1 AND (SELECT COUNT(*) FROM `homepage_sliders` WHERE `is_active` = 1) >= 9
BEGIN
  SELECT RAISE(ABORT, 'HOMEPAGE_SLIDER_ACTIVE_LIMIT');
END;--> statement-breakpoint
CREATE TRIGGER `homepage_sliders_max_nine_update`
BEFORE UPDATE OF `is_active` ON `homepage_sliders`
WHEN NEW.`is_active` = 1 AND OLD.`is_active` = 0 AND (SELECT COUNT(*) FROM `homepage_sliders` WHERE `is_active` = 1) >= 9
BEGIN
  SELECT RAISE(ABORT, 'HOMEPAGE_SLIDER_ACTIVE_LIMIT');
END;--> statement-breakpoint
INSERT INTO `homepage_sliders`
(`id`, `series_id`, `title`, `category_label`, `short_description`,
 `destination_url`, `is_active`, `sort_order`, `created_at`, `updated_at`)
SELECT 'slider_migrated_' || ep.`id`, ep.`series_id`, s.`title`,
       ep.`category_label`, ep.`short_description`, '/title/' || s.`slug`,
       ep.`is_published`, 1000 - ep.`sort_order`, ep.`created_at`, ep.`updated_at`
  FROM `editor_picks` ep
  JOIN `series` s ON s.`id` = ep.`series_id`
 ORDER BY ep.`sort_order` ASC, ep.`created_at` ASC
 LIMIT 9;--> statement-breakpoint
CREATE TABLE `site_announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'NOTICE' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link_label` text DEFAULT '' NOT NULL,
	`link_url` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "site_announcements_type_check" CHECK("site_announcements"."type" IN ('UPDATE', 'ISSUE', 'SUPPORT', 'NOTICE')),
	CONSTRAINT "site_announcements_date_check" CHECK("site_announcements"."ends_at" IS NULL OR "site_announcements"."starts_at" IS NULL OR datetime("site_announcements"."ends_at") > datetime("site_announcements"."starts_at"))
);
--> statement-breakpoint
CREATE INDEX `site_announcements_public_idx` ON `site_announcements` (`is_active`,`starts_at`,`ends_at`,`sort_order`);--> statement-breakpoint
CREATE TABLE `upload_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`uploader_user_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`decision` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `upload_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "upload_review_events_decision_check" CHECK("upload_review_events"."decision" IN ('APPROVE', 'UNDER_SCOPE', 'REJECT'))
);
--> statement-breakpoint
CREATE INDEX `upload_review_events_job_idx` ON `upload_review_events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `upload_review_events_uploader_idx` ON `upload_review_events` (`uploader_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `uploader_approvals` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'UNAPPROVED' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` text,
	`note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "uploader_approvals_status_check" CHECK("uploader_approvals"."status" IN ('UNAPPROVED', 'APPROVED', 'UNDER_SCOPE', 'REJECTED'))
);
--> statement-breakpoint
CREATE INDEX `uploader_approvals_status_idx` ON `uploader_approvals` (`status`,`updated_at`);--> statement-breakpoint
UPDATE `team_memberships`
SET `membership_role` = CASE
  WHEN `membership_role` = 'OWNER' THEN 'OWNER'
  WHEN `membership_role` IN ('LEADER', 'TEAM_LEADER', 'MANAGER') THEN 'LEADER'
  ELSE 'UPLOADER'
END,
`updated_at` = CURRENT_TIMESTAMP,
`revision` = `revision` + 1
WHERE `membership_role` NOT IN ('OWNER', 'LEADER', 'UPLOADER');--> statement-breakpoint
CREATE TRIGGER `team_memberships_role_insert`
BEFORE INSERT ON `team_memberships`
WHEN NEW.`membership_role` NOT IN ('OWNER', 'LEADER', 'UPLOADER')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_MEMBERSHIP_ROLE_INVALID');
END;--> statement-breakpoint
CREATE TRIGGER `team_memberships_role_update`
BEFORE UPDATE OF `membership_role` ON `team_memberships`
WHEN NEW.`membership_role` NOT IN ('OWNER', 'LEADER', 'UPLOADER')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_MEMBERSHIP_ROLE_INVALID');
END;--> statement-breakpoint
UPDATE `custom_reactions`
SET `display_order` = MAX(`display_order`, 100), `updated_at` = CURRENT_TIMESTAMP
WHERE `usage_kind` = 'REACTION'
  AND `slug` NOT IN ('upvote', 'laugh', 'heart', 'surprised', 'angry', 'sad');--> statement-breakpoint
INSERT OR IGNORE INTO `custom_reactions`
  (`id`, `slug`, `name`, `accessible_label`, `emoji_fallback`, `is_active`, `is_archived`, `display_order`, `category`, `usage_kind`)
VALUES
  ('reaction_v46_upvote', 'upvote', 'Upvote', 'Upvote', '👍', 1, 0, 0, 'Core', 'REACTION'),
  ('reaction_v46_surprised', 'surprised', 'Surprised', 'Surprised', '😮', 1, 0, 3, 'Core', 'REACTION'),
  ('reaction_v46_angry', 'angry', 'Angry', 'Angry', '😠', 1, 0, 4, 'Core', 'REACTION');--> statement-breakpoint
UPDATE `custom_reactions`
SET `name` = 'Upvote', `accessible_label` = 'Upvote', `emoji_fallback` = '👍', `display_order` = 0, `is_active` = 1, `is_archived` = 0, `updated_at` = CURRENT_TIMESTAMP
WHERE `slug` = 'upvote';--> statement-breakpoint
UPDATE `custom_reactions`
SET `name` = 'Funny', `accessible_label` = 'Funny', `emoji_fallback` = '😂', `display_order` = 1, `is_active` = 1, `is_archived` = 0, `updated_at` = CURRENT_TIMESTAMP
WHERE `slug` = 'laugh';--> statement-breakpoint
UPDATE `custom_reactions`
SET `name` = 'Love', `accessible_label` = 'Love', `emoji_fallback` = '❤️', `display_order` = 2, `is_active` = 1, `is_archived` = 0, `updated_at` = CURRENT_TIMESTAMP
WHERE `slug` = 'heart';--> statement-breakpoint
UPDATE `custom_reactions`
SET `name` = 'Surprised', `accessible_label` = 'Surprised', `emoji_fallback` = '😮', `display_order` = 3, `is_active` = 1, `is_archived` = 0, `updated_at` = CURRENT_TIMESTAMP
WHERE `slug` = 'surprised';--> statement-breakpoint
UPDATE `custom_reactions`
SET `name` = 'Angry', `accessible_label` = 'Angry', `emoji_fallback` = '😠', `display_order` = 4, `is_active` = 1, `is_archived` = 0, `updated_at` = CURRENT_TIMESTAMP
WHERE `slug` = 'angry';--> statement-breakpoint
UPDATE `custom_reactions`
SET `name` = 'Sad', `accessible_label` = 'Sad', `emoji_fallback` = '😢', `display_order` = 5, `is_active` = 1, `is_archived` = 0, `updated_at` = CURRENT_TIMESTAMP
WHERE `slug` = 'sad';--> statement-breakpoint
ALTER TABLE `upload_jobs` ADD `source_url` text;
