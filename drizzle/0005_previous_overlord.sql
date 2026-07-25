CREATE TABLE `series_team_assignments` (
	`series_id` text NOT NULL,
	`team_id` text NOT NULL,
	`can_upload` integer DEFAULT true NOT NULL,
	`can_publish` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`series_id`, `team_id`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_team_assignments_team_idx` ON `series_team_assignments` (`team_id`);--> statement-breakpoint
ALTER TABLE `chapters` ADD `team_id` text REFERENCES teams(id);--> statement-breakpoint
ALTER TABLE `chapters` ADD `uploader_user_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `chapters` ADD `volume` text;--> statement-breakpoint
ALTER TABLE `chapters` ADD `release_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `credits_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `chapters_release_identity_idx` ON `chapters` (`series_id`,`chapter_number`,`language`,`team_id`,`version`);