ALTER TABLE `discussion_comments` ADD `pinned_at` text;--> statement-breakpoint
ALTER TABLE `discussion_comments` ADD `pinned_by_user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `discussion_comments_pinned_idx` ON `discussion_comments` (`series_slug`,`pinned_at`);--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `settings_json` text DEFAULT '{}' NOT NULL;