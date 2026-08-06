CREATE TABLE `home_pinned_series_state` (
	`collection_key` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`mutation_marker` text DEFAULT 'initial' NOT NULL,
	`updated_by_user_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "home_pinned_series_state_key_check" CHECK("home_pinned_series_state"."collection_key" = 'pinned-series'),
	CONSTRAINT "home_pinned_series_state_revision_check" CHECK("home_pinned_series_state"."revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `home_pinned_series_state`
  (`collection_key`, `revision`, `mutation_marker`)
VALUES ('pinned-series', 1, 'initial');
