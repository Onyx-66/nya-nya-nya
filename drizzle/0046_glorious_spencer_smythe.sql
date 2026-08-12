CREATE TABLE `ad_unlock_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_reference` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`expires_at` text NOT NULL,
	`verified_at` text,
	`claimed_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ad_unlock_challenges_status_check" CHECK("ad_unlock_challenges"."status" IN ('PENDING', 'VERIFIED', 'CLAIMED', 'EXPIRED')),
	CONSTRAINT "ad_unlock_challenges_revision_check" CHECK("ad_unlock_challenges"."revision" >= 1),
	CONSTRAINT "ad_unlock_challenges_verification_check" CHECK(("ad_unlock_challenges"."provider_reference" IS NULL AND "ad_unlock_challenges"."verified_at" IS NULL)
        OR ("ad_unlock_challenges"."provider_reference" IS NOT NULL AND "ad_unlock_challenges"."verified_at" IS NOT NULL)),
	CONSTRAINT "ad_unlock_challenges_lifecycle_check" CHECK(("ad_unlock_challenges"."status" = 'PENDING' AND "ad_unlock_challenges"."provider_reference" IS NULL AND "ad_unlock_challenges"."verified_at" IS NULL AND "ad_unlock_challenges"."claimed_at" IS NULL)
        OR ("ad_unlock_challenges"."status" = 'VERIFIED' AND "ad_unlock_challenges"."provider_reference" IS NOT NULL AND "ad_unlock_challenges"."verified_at" IS NOT NULL AND "ad_unlock_challenges"."claimed_at" IS NULL)
        OR ("ad_unlock_challenges"."status" = 'CLAIMED' AND "ad_unlock_challenges"."provider_reference" IS NOT NULL AND "ad_unlock_challenges"."verified_at" IS NOT NULL AND "ad_unlock_challenges"."claimed_at" IS NOT NULL)
        OR ("ad_unlock_challenges"."status" = 'EXPIRED' AND "ad_unlock_challenges"."claimed_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_unlock_challenges_provider_reference_uidx` ON `ad_unlock_challenges` (`provider_reference`) WHERE "ad_unlock_challenges"."provider_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `ad_unlock_challenges_user_chapter_idx` ON `ad_unlock_challenges` (`user_id`,`chapter_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `ad_unlock_challenges_status_expiry_idx` ON `ad_unlock_challenges` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `team_payout_accounts` (
	`team_id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'STRIPE' NOT NULL,
	`provider_account_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "team_payout_accounts_provider_check" CHECK("team_payout_accounts"."provider" = 'STRIPE'),
	CONSTRAINT "team_payout_accounts_revision_check" CHECK("team_payout_accounts"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_payout_accounts_provider_uidx` ON `team_payout_accounts` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE INDEX `team_payout_accounts_updated_idx` ON `team_payout_accounts` (`updated_at`);--> statement-breakpoint
CREATE TABLE `team_payout_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`amount_onyx` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`provider_transfer_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` text,
	`paid_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "team_payout_requests_onyx_check" CHECK("team_payout_requests"."amount_onyx" > 0),
	CONSTRAINT "team_payout_requests_minor_check" CHECK("team_payout_requests"."amount_minor" > 0),
	CONSTRAINT "team_payout_requests_currency_check" CHECK("team_payout_requests"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "team_payout_requests_status_check" CHECK("team_payout_requests"."status" IN ('PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED')),
	CONSTRAINT "team_payout_requests_revision_check" CHECK("team_payout_requests"."revision" >= 1),
	CONSTRAINT "team_payout_requests_state_check" CHECK(("team_payout_requests"."status" = 'PENDING' AND "team_payout_requests"."reviewed_by_user_id" IS NULL AND "team_payout_requests"."reviewed_at" IS NULL AND "team_payout_requests"."provider_transfer_id" IS NULL AND "team_payout_requests"."paid_at" IS NULL)
        OR ("team_payout_requests"."status" = 'APPROVED' AND "team_payout_requests"."reviewed_by_user_id" IS NOT NULL AND "team_payout_requests"."reviewed_at" IS NOT NULL AND "team_payout_requests"."provider_transfer_id" IS NULL AND "team_payout_requests"."paid_at" IS NULL)
        OR ("team_payout_requests"."status" = 'PROCESSING' AND "team_payout_requests"."reviewed_by_user_id" IS NOT NULL AND "team_payout_requests"."reviewed_at" IS NOT NULL AND "team_payout_requests"."paid_at" IS NULL)
        OR ("team_payout_requests"."status" = 'PAID' AND "team_payout_requests"."reviewed_by_user_id" IS NOT NULL AND "team_payout_requests"."reviewed_at" IS NOT NULL AND "team_payout_requests"."provider_transfer_id" IS NOT NULL AND "team_payout_requests"."paid_at" IS NOT NULL)
        OR ("team_payout_requests"."status" = 'REJECTED' AND "team_payout_requests"."reviewed_by_user_id" IS NOT NULL AND "team_payout_requests"."reviewed_at" IS NOT NULL AND "team_payout_requests"."paid_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_payout_requests_transfer_uidx` ON `team_payout_requests` (`provider_transfer_id`) WHERE "team_payout_requests"."provider_transfer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `team_payout_requests_status_idx` ON `team_payout_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `team_payout_requests_team_status_idx` ON `team_payout_requests` (`team_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `team_payout_accounts_no_delete`
BEFORE DELETE ON `team_payout_accounts`
BEGIN
  SELECT RAISE(ABORT, 'team_payout_accounts_no_delete');
END;--> statement-breakpoint
CREATE TRIGGER `team_payout_accounts_update_guard`
BEFORE UPDATE ON `team_payout_accounts`
WHEN NOT (NEW.`team_id` IS OLD.`team_id`)
  OR NOT (NEW.`provider` IS OLD.`provider`)
  OR NOT (NEW.`created_at` IS OLD.`created_at`)
  OR NEW.`revision` <> OLD.`revision` + 1
BEGIN
  SELECT RAISE(ABORT, 'team_payout_accounts_invalid_update');
END;--> statement-breakpoint
CREATE TRIGGER `team_payout_requests_no_delete`
BEFORE DELETE ON `team_payout_requests`
BEGIN
  SELECT RAISE(ABORT, 'team_payout_requests_no_delete');
END;--> statement-breakpoint
CREATE TRIGGER `team_payout_requests_update_guard`
BEFORE UPDATE ON `team_payout_requests`
WHEN NOT (NEW.`id` IS OLD.`id`)
  OR NOT (NEW.`team_id` IS OLD.`team_id`)
  OR NOT (NEW.`requested_by_user_id` IS OLD.`requested_by_user_id`)
  OR NOT (NEW.`amount_onyx` IS OLD.`amount_onyx`)
  OR NOT (NEW.`amount_minor` IS OLD.`amount_minor`)
  OR NOT (NEW.`currency` IS OLD.`currency`)
  OR NOT (NEW.`created_at` IS OLD.`created_at`)
  OR (OLD.`provider_transfer_id` IS NOT NULL
      AND NOT (NEW.`provider_transfer_id` IS OLD.`provider_transfer_id`))
  OR NEW.`revision` <> OLD.`revision` + 1
  OR OLD.`status` IN ('PAID', 'REJECTED')
  OR NOT (
    (OLD.`status` = 'PENDING' AND NEW.`status` IN ('APPROVED', 'REJECTED'))
    OR (OLD.`status` = 'APPROVED' AND NEW.`status` IN ('PROCESSING', 'REJECTED'))
    OR (OLD.`status` = 'PROCESSING' AND NEW.`status` IN ('PROCESSING', 'PAID'))
  )
BEGIN
  SELECT RAISE(ABORT, 'team_payout_requests_invalid_transition');
END;
