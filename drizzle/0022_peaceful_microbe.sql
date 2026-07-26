CREATE TABLE `roulette_pool_counters` (
	`pool_key` text PRIMARY KEY NOT NULL,
	`total_spins` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `upload_job_media_guards` (
	`job_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `upload_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`assigned_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_roles_role_check" CHECK("user_roles"."role" IN (
        'OWNER',
        'ADMINISTRATOR',
        'MANAGER',
        'MODERATOR',
        'TEAM_LEADER',
        'UPLOADER',
        'USER'
      ))
);
--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role`,`user_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `user_roles` (`user_id`, `role`, `assigned_by_user_id`)
SELECT `id`, `primary_role`, NULL
FROM `users`;--> statement-breakpoint
ALTER TABLE `chapters` ADD `thumbnail_key` text;--> statement-breakpoint
ALTER TABLE `roulette_spins` ADD `global_spin_number` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_job_items` ADD `thumbnail_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `access_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `access_update_token` text;
