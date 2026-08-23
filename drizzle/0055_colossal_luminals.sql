CREATE TABLE `bot_idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text DEFAULT 'PROCESSING' NOT NULL,
	`response_json` text,
	`resource_refs_json` text DEFAULT '[]' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "bot_idempotency_status_check" CHECK("bot_idempotency_keys"."status" IN ('PROCESSING', 'SUCCEEDED', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_idempotency_actor_endpoint_key_uidx` ON `bot_idempotency_keys` (`actor_user_id`,`endpoint`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `bot_idempotency_expiry_idx` ON `bot_idempotency_keys` (`expires_at`,`status`);--> statement-breakpoint
CREATE TABLE `bot_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`team_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'PROCESSING' NOT NULL,
	`job_id` text,
	`idempotency_key` text,
	`request_json` text DEFAULT '{}' NOT NULL,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `upload_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "bot_operations_status_check" CHECK("bot_operations"."status" IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `bot_operations_actor_idx` ON `bot_operations` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bot_operations_status_idx` ON `bot_operations` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `bot_operations_job_idx` ON `bot_operations` (`job_id`);--> statement-breakpoint
CREATE TABLE `public_identifier_reservations` (
	`public_ref` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`released_at` text,
	CONSTRAINT "public_identifier_type_check" CHECK("public_identifier_reservations"."entity_type" IN ('SERIES', 'TEAM', 'CHAPTER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_identifier_entity_uidx` ON `public_identifier_reservations` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `public_identifier_type_idx` ON `public_identifier_reservations` (`entity_type`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`client_type` text DEFAULT 'EXTERNAL_API' NOT NULL,
	`app_name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`secret_hash` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`allowed_team_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`replaced_by_key_id` text,
	`expires_at` text,
	`last_used_at` text,
	`last_used_ip_hash` text,
	`request_count` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`allowed_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "api_keys_client_type_check" CHECK("__new_api_keys"."client_type" IN ('EXTERNAL_API', 'DISCORD_BOT')),
	CONSTRAINT "api_keys_status_check" CHECK("__new_api_keys"."status" IN ('ACTIVE', 'REVOKED', 'ROTATED'))
);
--> statement-breakpoint
INSERT INTO `__new_api_keys`("id", "client_type", "app_name", "key_prefix", "secret_hash", "scopes_json", "allowed_team_id", "status", "created_by_user_id", "replaced_by_key_id", "expires_at", "last_used_at", "last_used_ip_hash", "request_count", "revision", "created_at", "updated_at") SELECT "id", 'EXTERNAL_API', "app_name", "key_prefix", "secret_hash", "scopes_json", "allowed_team_id", "status", "created_by_user_id", "replaced_by_key_id", "expires_at", "last_used_at", "last_used_ip_hash", "request_count", "revision", "created_at", "updated_at" FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_prefix_uidx` ON `api_keys` (`key_prefix`);--> statement-breakpoint
CREATE INDEX `api_keys_status_idx` ON `api_keys` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_keys_team_idx` ON `api_keys` (`allowed_team_id`);--> statement-breakpoint
ALTER TABLE `chapters` ADD `public_ref` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `series` ADD `public_ref` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `teams` ADD `public_ref` text NOT NULL DEFAULT '';--> statement-breakpoint
WITH ordered AS (
  SELECT id, printf('%010X', row_number() OVER (ORDER BY id)) AS ref
    FROM chapters
)
UPDATE chapters
   SET public_ref = 'CH-' || (SELECT ref FROM ordered WHERE ordered.id = chapters.id)
 WHERE public_ref = '';--> statement-breakpoint
WITH ordered AS (
  SELECT id, printf('%010X', row_number() OVER (ORDER BY id)) AS ref
    FROM series
)
UPDATE series
   SET public_ref = 'SR-' || (SELECT ref FROM ordered WHERE ordered.id = series.id)
 WHERE public_ref = '';--> statement-breakpoint
WITH ordered AS (
  SELECT id, printf('%010X', row_number() OVER (ORDER BY id)) AS ref
    FROM teams
)
UPDATE teams
   SET public_ref = 'TM-' || (SELECT ref FROM ordered WHERE ordered.id = teams.id)
 WHERE public_ref = '';--> statement-breakpoint
INSERT INTO public_identifier_reservations (public_ref, entity_type, entity_id)
SELECT public_ref, 'CHAPTER', id FROM chapters;--> statement-breakpoint
INSERT INTO public_identifier_reservations (public_ref, entity_type, entity_id)
SELECT public_ref, 'SERIES', id FROM series;--> statement-breakpoint
INSERT INTO public_identifier_reservations (public_ref, entity_type, entity_id)
SELECT public_ref, 'TEAM', id FROM teams;--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_public_ref_uidx` ON `chapters` (`public_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_public_ref_uidx` ON `series` (`public_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `teams_public_ref_uidx` ON `teams` (`public_ref`);