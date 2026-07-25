CREATE TABLE `discussion_comment_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`editor_user_id` text NOT NULL,
	`prior_body` text NOT NULL,
	`prior_spoiler` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `discussion_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`editor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discussion_comment_edits_comment_idx` ON `discussion_comment_edits` (`comment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `discussion_media` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comment_id` text,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`kind` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`moderation_status` text DEFAULT 'READY' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `discussion_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discussion_media_size_check" CHECK("discussion_media"."byte_size" > 0),
	CONSTRAINT "discussion_media_kind_check" CHECK("discussion_media"."kind" IN ('IMAGE', 'GIF')),
	CONSTRAINT "discussion_media_status_check" CHECK("discussion_media"."moderation_status" IN ('READY', 'DELETED', 'QUARANTINED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discussion_media_object_uidx` ON `discussion_media` (`object_key`);--> statement-breakpoint
CREATE INDEX `discussion_media_comment_idx` ON `discussion_media` (`comment_id`,`moderation_status`);--> statement-breakpoint
CREATE INDEX `discussion_media_user_idx` ON `discussion_media` (`user_id`,`moderation_status`,`created_at`);--> statement-breakpoint
CREATE TABLE `discussion_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`settings_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `discussion_votes` (
	`user_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`value` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `comment_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `discussion_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discussion_votes_value_check" CHECK("discussion_votes"."value" IN (-1, 1))
);
--> statement-breakpoint
CREATE INDEX `discussion_votes_comment_idx` ON `discussion_votes` (`comment_id`,`value`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_discussion_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`series_slug` text NOT NULL,
	`chapter_slug` text,
	`parent_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL,
	`spoiler` integer DEFAULT false NOT NULL,
	`moderation_status` text DEFAULT 'VISIBLE' NOT NULL,
	`edited_at` text,
	`deleted_at` text,
	`deleted_by_user_id` text,
	`deletion_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discussion_comments_depth_check" CHECK("__new_discussion_comments"."depth" >= 0 AND "__new_discussion_comments"."depth" <= 4),
	CONSTRAINT "discussion_comments_self_parent_check" CHECK("__new_discussion_comments"."parent_id" IS NULL OR "__new_discussion_comments"."parent_id" <> "__new_discussion_comments"."id")
);
--> statement-breakpoint
INSERT INTO `__new_discussion_comments`("id", "user_id", "series_slug", "chapter_slug", "parent_id", "depth", "body", "spoiler", "moderation_status", "edited_at", "deleted_at", "deleted_by_user_id", "deletion_reason", "created_at", "updated_at")
SELECT "id",
       "user_id",
       "series_slug",
       "chapter_slug",
       "parent_id",
       CASE WHEN "parent_id" IS NULL THEN 0 ELSE 1 END,
       "body",
       "spoiler",
       "moderation_status",
       NULL,
       NULL,
       NULL,
       NULL,
       "created_at",
       "updated_at"
FROM `discussion_comments`;--> statement-breakpoint
DROP TABLE `discussion_comments`;--> statement-breakpoint
ALTER TABLE `__new_discussion_comments` RENAME TO `discussion_comments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `discussion_comments_scope_idx` ON `discussion_comments` (`series_slug`,`chapter_slug`,`created_at`);--> statement-breakpoint
CREATE INDEX `discussion_comments_parent_idx` ON `discussion_comments` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `discussion_comments_user_idx` ON `discussion_comments` (`user_id`,`created_at`);--> statement-breakpoint
UPDATE `discussion_reactions`
SET `reaction` = 'heart'
WHERE UPPER(`reaction`) = 'LIKE';--> statement-breakpoint
INSERT OR IGNORE INTO `discussion_settings`
(`id`, `schema_version`, `settings_json`, `revision`)
VALUES (
  'global',
  1,
  '{"schemaVersion":1,"reactions":[{"key":"heart","emoji":"❤️","label":"Love","enabled":true},{"key":"laugh","emoji":"😂","label":"Funny","enabled":true},{"key":"fire","emoji":"🔥","label":"Fire","enabled":true},{"key":"wow","emoji":"😮","label":"Wow","enabled":true},{"key":"sad","emoji":"😢","label":"Sad","enabled":true},{"key":"theory","emoji":"🧠","label":"Good theory","enabled":true}],"allowImages":true,"allowGifs":true,"maxAttachments":4,"maxReplyDepth":3}',
  1
);
