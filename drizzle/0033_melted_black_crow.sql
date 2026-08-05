CREATE TABLE `chapter_reactions` (
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`reaction_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reaction_id`) REFERENCES `custom_reactions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `chapter_reactions_chapter_idx` ON `chapter_reactions` (`chapter_id`,`reaction_id`);