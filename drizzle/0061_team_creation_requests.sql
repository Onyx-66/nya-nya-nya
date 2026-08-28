CREATE TABLE `team_creation_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `requested_by_user_id` text NOT NULL REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `website_url` text,
  `discord_url` text,
  `reason` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'PENDING' NOT NULL,
  `review_reason` text,
  `reviewed_by_user_id` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  `reviewed_at` text,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `team_creation_requests_status_check` CHECK (`status` IN ('PENDING', 'APPROVED', 'REJECTED'))
);
--> statement-breakpoint
CREATE INDEX `team_creation_requests_status_idx` ON `team_creation_requests` (`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `team_creation_requests_requester_idx` ON `team_creation_requests` (`requested_by_user_id`, `created_at`);
