CREATE TABLE `admin_login_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`fingerprint_hash` text NOT NULL,
	`result` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `admin_login_events_limit_idx` ON `admin_login_events` (`fingerprint_hash`,`result`,`created_at`);--> statement-breakpoint
CREATE TABLE `admin_mfa_factors` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_secret` text NOT NULL,
	`encryption_iv` text NOT NULL,
	`confirmed_at` text,
	`last_accepted_counter` integer DEFAULT -1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `admin_mfa_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`fingerprint_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_mfa_sessions_token_uidx` ON `admin_mfa_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `admin_mfa_sessions_user_expiry_idx` ON `admin_mfa_sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `role_permission_rules` (
	`role` text NOT NULL,
	`capability` text NOT NULL,
	`allowed` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`role`, `capability`),
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `team_links` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`link_type` text DEFAULT 'WEBSITE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_links_team_url_uidx` ON `team_links` (`team_id`,`url`);--> statement-breakpoint
CREATE INDEX `team_links_team_order_idx` ON `team_links` (`team_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `team_ownership_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`claimant_user_id` text NOT NULL,
	`proof_type` text NOT NULL,
	`proof_value` text NOT NULL,
	`statement` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`reviewed_by_user_id` text,
	`review_reason` text,
	`reviewed_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claimant_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `team_ownership_claims_queue_idx` ON `team_ownership_claims` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_ownership_claims_open_uidx` ON `team_ownership_claims` (`team_id`) WHERE "team_ownership_claims"."status" = 'PENDING';--> statement-breakpoint
CREATE TABLE `team_title_change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`requested_title` text NOT NULL,
	`requested_slug` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`reviewed_by_user_id` text,
	`review_reason` text,
	`reviewed_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `team_title_change_requests_queue_idx` ON `team_title_change_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_title_change_requests_open_uidx` ON `team_title_change_requests` (`team_id`) WHERE "team_title_change_requests"."status" = 'PENDING';--> statement-breakpoint
ALTER TABLE `floating_ads` ADD `action_label` text DEFAULT 'Explore event' NOT NULL;--> statement-breakpoint
ALTER TABLE `floating_ads` ADD `info_blocks_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `floating_ads` ADD `starts_at` text;--> statement-breakpoint
ALTER TABLE `floating_ads` ADD `ends_at` text;--> statement-breakpoint
ALTER TABLE `team_memberships` ADD `invited_by_user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `team_memberships` ADD `invited_at` text;--> statement-breakpoint
ALTER TABLE `team_memberships` ADD `responded_at` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `created_by_user_id` text REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TRIGGER `team_memberships_status_insert_v482`
BEFORE INSERT ON `team_memberships`
WHEN NEW.`status` NOT IN ('PENDING', 'INVITED', 'ACTIVE', 'DECLINED', 'INACTIVE')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_MEMBERSHIP_STATUS_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `team_memberships_status_update_v482`
BEFORE UPDATE OF `status` ON `team_memberships`
WHEN NEW.`status` NOT IN ('PENDING', 'INVITED', 'ACTIVE', 'DECLINED', 'INACTIVE')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_MEMBERSHIP_STATUS_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `team_memberships_final_owner_update_v482`
BEFORE UPDATE OF `team_id`, `user_id`, `membership_role`, `status` ON `team_memberships`
WHEN OLD.`membership_role` = 'OWNER'
  AND OLD.`status` = 'ACTIVE'
  AND (NEW.`team_id` <> OLD.`team_id` OR NEW.`user_id` <> OLD.`user_id` OR NEW.`membership_role` <> 'OWNER' OR NEW.`status` <> 'ACTIVE')
  AND EXISTS (SELECT 1 FROM `teams` parent_team WHERE parent_team.`id` = OLD.`team_id`)
  AND NOT EXISTS (
    SELECT 1 FROM `team_memberships` other
     WHERE other.`team_id` = OLD.`team_id`
       AND other.`user_id` <> OLD.`user_id`
       AND other.`membership_role` = 'OWNER'
       AND other.`status` = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'FINAL_TEAM_OWNER_PROTECTED');
END;
--> statement-breakpoint
CREATE TRIGGER `team_memberships_final_owner_delete_v482`
BEFORE DELETE ON `team_memberships`
WHEN OLD.`membership_role` = 'OWNER'
  AND OLD.`status` = 'ACTIVE'
  AND EXISTS (SELECT 1 FROM `teams` parent_team WHERE parent_team.`id` = OLD.`team_id`)
  AND NOT EXISTS (
    SELECT 1 FROM `team_memberships` other
     WHERE other.`team_id` = OLD.`team_id`
       AND other.`user_id` <> OLD.`user_id`
       AND other.`membership_role` = 'OWNER'
       AND other.`status` = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'FINAL_TEAM_OWNER_PROTECTED');
END;
--> statement-breakpoint
CREATE TRIGGER `team_claim_status_insert_v482`
BEFORE INSERT ON `team_ownership_claims`
WHEN NEW.`status` NOT IN ('PENDING', 'APPROVED', 'REJECTED')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_CLAIM_STATUS_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `team_claim_status_update_v482`
BEFORE UPDATE OF `status` ON `team_ownership_claims`
WHEN NEW.`status` NOT IN ('PENDING', 'APPROVED', 'REJECTED')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_CLAIM_STATUS_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `team_title_request_status_insert_v482`
BEFORE INSERT ON `team_title_change_requests`
WHEN NEW.`status` NOT IN ('PENDING', 'APPROVED', 'REJECTED')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_TITLE_REQUEST_STATUS_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `team_title_request_status_update_v482`
BEFORE UPDATE OF `status` ON `team_title_change_requests`
WHEN NEW.`status` NOT IN ('PENDING', 'APPROVED', 'REJECTED')
BEGIN
  SELECT RAISE(ABORT, 'TEAM_TITLE_REQUEST_STATUS_INVALID');
END;
--> statement-breakpoint
CREATE TRIGGER `teams_title_immutable_v482`
BEFORE UPDATE OF `name`, `slug` ON `teams`
WHEN (OLD.`name` <> NEW.`name` OR OLD.`slug` <> NEW.`slug`)
  AND NOT EXISTS (
    SELECT 1
      FROM `team_title_change_requests` request
     WHERE request.`team_id` = OLD.`id`
       AND request.`status` = 'APPROVED'
       AND request.`revision` % 2 = 0
       AND request.`requested_title` = NEW.`name`
       AND request.`requested_slug` = NEW.`slug`
  )
BEGIN
  SELECT RAISE(ABORT, 'TEAM_TITLE_CHANGE_REQUEST_REQUIRED');
END;
