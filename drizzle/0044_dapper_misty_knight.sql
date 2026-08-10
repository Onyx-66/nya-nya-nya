ALTER TABLE `reading_progress` ADD `onsite_activity_at` text;--> statement-breakpoint
CREATE INDEX `reading_progress_onsite_activity_idx` ON `reading_progress` (`onsite_activity_at`,`chapter_id`);--> statement-breakpoint
CREATE INDEX `chapter_reactions_created_idx` ON `chapter_reactions` (`created_at`,`chapter_id`);