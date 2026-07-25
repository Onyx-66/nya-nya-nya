CREATE TABLE `discussion_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`series_slug` text NOT NULL,
	`chapter_slug` text,
	`parent_id` text,
	`body` text NOT NULL,
	`spoiler` integer DEFAULT false NOT NULL,
	`moderation_status` text DEFAULT 'VISIBLE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discussion_comments_scope_idx` ON `discussion_comments` (`series_slug`,`chapter_slug`,`created_at`);--> statement-breakpoint
CREATE INDEX `discussion_comments_parent_idx` ON `discussion_comments` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `discussion_comments_user_idx` ON `discussion_comments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `discussion_reactions` (
	`user_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`reaction` text DEFAULT 'LIKE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `comment_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `discussion_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discussion_reactions_comment_idx` ON `discussion_reactions` (`comment_id`,`reaction`);