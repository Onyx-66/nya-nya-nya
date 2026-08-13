CREATE TABLE `review_reactions` (
	`user_id` text NOT NULL,
	`review_id` text NOT NULL,
	`reaction` text DEFAULT 'LIKE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `review_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_reactions_review_idx` ON `review_reactions` (`review_id`,`reaction`);