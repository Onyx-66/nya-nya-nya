CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text,
	`request_id` text NOT NULL,
	`old_value_json` text,
	`new_value_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_target_idx` ON `audit_logs` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chapter_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`page_index` integer NOT NULL,
	`object_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sha256` text NOT NULL,
	`processing_status` text DEFAULT 'READY' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_pages_order_uidx` ON `chapter_pages` (`chapter_id`,`page_index`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`slug` text NOT NULL,
	`chapter_number` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`format` text DEFAULT 'VERTICAL' NOT NULL,
	`state` text DEFAULT 'DRAFT' NOT NULL,
	`access_type` text DEFAULT 'FREE' NOT NULL,
	`price_onyx` integer DEFAULT 0 NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`published_at` text,
	`free_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_series_slug_uidx` ON `chapters` (`series_id`,`slug`);--> statement-breakpoint
CREATE INDEX `chapters_feed_idx` ON `chapters` (`state`,`published_at`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`parent_id` text,
	`body` text NOT NULL,
	`spoiler` integer DEFAULT false NOT NULL,
	`moderation_status` text DEFAULT 'VISIBLE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_chapter_idx` ON `comments` (`chapter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`starts_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_user_chapter_uidx` ON `entitlements` (`user_id`,`chapter_id`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`user_id` text NOT NULL,
	`series_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `series_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ledger_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`currency` text DEFAULT 'ONYX' NOT NULL,
	`account_type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_accounts_owner_uidx` ON `ledger_accounts` (`owner_type`,`owner_id`,`currency`,`account_type`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `ledger_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_account_idx` ON `ledger_entries` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_entries_tx_idx` ON `ledger_entries` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `ledger_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_tx_idempotency_uidx` ON `ledger_transactions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ledger_tx_reference_idx` ON `ledger_transactions` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `library_entries` (
	`user_id` text NOT NULL,
	`series_id` text NOT NULL,
	`list_type` text DEFAULT 'READING' NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`notifications_enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `series_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_entries_user_list_idx` ON `library_entries` (`user_id`,`list_type`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`read_at` text,
	`dedupe_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`total_minor` integer NOT NULL,
	`billing_currency` text NOT NULL,
	`provider` text DEFAULT 'TEST' NOT NULL,
	`provider_reference` text,
	`idempotency_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_idempotency_uidx` ON `orders` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`price_minor` integer NOT NULL,
	`billing_currency` text DEFAULT 'USD' NOT NULL,
	`onyx_base` integer DEFAULT 0 NOT NULL,
	`onyx_bonus` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_uidx` ON `products` (`slug`);--> statement-breakpoint
CREATE TABLE `reading_progress` (
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`page_index` integer DEFAULT 0 NOT NULL,
	`scroll_offset` integer DEFAULT 0 NOT NULL,
	`progress_basis_points` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reading_progress_recent_idx` ON `reading_progress` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`category` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_queue_idx` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`series_id` text NOT NULL,
	`rating` integer NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`spoiler` integer DEFAULT false NOT NULL,
	`moderation_status` text DEFAULT 'VISIBLE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_user_series_uidx` ON `reviews` (`user_id`,`series_id`);--> statement-breakpoint
CREATE INDEX `reviews_series_idx` ON `reviews` (`series_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`native_title` text,
	`synopsis` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`origin_country` text NOT NULL,
	`original_language` text NOT NULL,
	`reading_direction` text NOT NULL,
	`age_rating` text DEFAULT 'TEEN' NOT NULL,
	`access_type` text DEFAULT 'FREE' NOT NULL,
	`cover_key` text,
	`banner_key` text,
	`rating_tenths` integer DEFAULT 0 NOT NULL,
	`follower_count` integer DEFAULT 0 NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`rights_status` text DEFAULT 'DEMO_ORIGINAL' NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_slug_uidx` ON `series` (`slug`);--> statement-breakpoint
CREATE INDEX `series_discovery_idx` ON `series` (`is_published`,`status`,`access_type`);--> statement-breakpoint
CREATE TABLE `series_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` text NOT NULL,
	`alias` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_alias_uidx` ON `series_aliases` (`series_id`,`alias`);--> statement-breakpoint
CREATE INDEX `series_alias_search_idx` ON `series_aliases` (`alias`);--> statement-breakpoint
CREATE TABLE `team_memberships` (
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_role` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_memberships_user_idx` ON `team_memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`verification_status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_slug_uidx` ON `teams` (`slug`);--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text,
	`chapter_id` text,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'UPLOADED' NOT NULL,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uploads_user_idx` ON `upload_sessions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `uploads_status_idx` ON `upload_sessions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'SYSTEM' NOT NULL,
	`content_language` text DEFAULT 'en' NOT NULL,
	`reader_mode` text DEFAULT 'VERTICAL' NOT NULL,
	`mature_content` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`primary_role` text DEFAULT 'USER' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`email_verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uidx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`primary_role`);
--> statement-breakpoint
CREATE TRIGGER `ledger_no_negative_user_balance`
BEFORE INSERT ON `ledger_entries`
WHEN
  NEW.amount < 0
  AND EXISTS (
    SELECT 1
    FROM `ledger_accounts`
    WHERE `id` = NEW.account_id
      AND `owner_type` = 'USER'
      AND `account_type` = 'AVAILABLE'
  )
  AND (
    COALESCE(
      (SELECT SUM(`amount`) FROM `ledger_entries` WHERE `account_id` = NEW.account_id),
      0
    ) + NEW.amount
  ) < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_onyx');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `teams`
  (`id`, `slug`, `name`, `description`, `verification_status`)
VALUES
  ('team_black_kite', 'black-kite', 'Black Kite', 'Original demo localization team.', 'VERIFIED'),
  ('team_lumen_house', 'lumen-house', 'Lumen House', 'Original demo publishing team.', 'VERIFIED');
--> statement-breakpoint
INSERT OR IGNORE INTO `series`
  (`id`, `slug`, `title`, `synopsis`, `type`, `status`, `origin_country`, `original_language`, `reading_direction`, `age_rating`, `access_type`, `cover_key`, `rating_tenths`, `follower_count`, `view_count`, `rights_status`, `is_published`)
VALUES
  ('ser_neon_ronin', 'neon-ronin', 'Neon Ronin', 'A security runner inherits a sword that remembers every broken oath.', 'MANGA', 'ONGOING', 'JP', 'ja', 'RTL', 'TEEN', 'EARLY_ACCESS', 'public/art/cover-neon-ronin.png', 48, 41200, 2600000, 'DEMO_ORIGINAL', 1),
  ('ser_glass_orchard', 'the-glass-orchard', 'The Glass Orchard', 'A botanist discovers that crystal fruit preserves memories meant to disappear.', 'WEBTOON', 'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'FREE', 'public/art/cover-glass-orchard.png', 49, 29700, 1800000, 'DEMO_ORIGINAL', 1),
  ('ser_signal_zero', 'signal-zero', 'Signal Zero', 'A radio engineer hears a warning from tomorrow.', 'MANHWA', 'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'PREMIUM', 'public/art/cover-signal-zero.png', 47, 18300, 940000, 'DEMO_ORIGINAL', 1),
  ('ser_crown_tides', 'crown-of-tides', 'Crown of Tides', 'An exiled mapmaker is claimed by a drowned kingdom.', 'MANHUA', 'COMPLETED', 'CN', 'zh', 'LTR', 'TEEN', 'WAIT_TO_UNLOCK', 'public/art/cover-crown-of-tides.png', 46, 33900, 2200000, 'DEMO_ORIGINAL', 1),
  ('ser_moon_parcel', 'moon-parcel', 'Moon Parcel', 'A night courier and a black cat deliver impossible packages.', 'COMIC', 'ONGOING', 'GB', 'en', 'LTR', 'EVERYONE', 'FREE', 'public/art/cover-moon-parcel.png', 45, 12600, 610000, 'DEMO_ORIGINAL', 1),
  ('ser_ash_aster', 'ash-and-aster', 'Ash & Aster', 'Two apprentices protect the final living seeds during an ash winter.', 'MANGA', 'UPCOMING', 'JP', 'ja', 'RTL', 'TEEN', 'FREE', 'public/art/cover-ash-aster.png', 44, 8100, 150000, 'DEMO_ORIGINAL', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `chapters`
  (`id`, `series_id`, `slug`, `chapter_number`, `title`, `language`, `format`, `state`, `access_type`, `price_onyx`, `page_count`, `published_at`)
VALUES
  ('demo_ser_neon_ronin_chapter', 'ser_neon_ronin', 'chapter-48', '48', 'The unremembered gate', 'en', 'RTL', 'PUBLISHED', 'EARLY_ACCESS', 18, 54, CURRENT_TIMESTAMP),
  ('demo_ser_glass_orchard_chapter', 'ser_glass_orchard', 'episode-31', '31', 'Glass pollen', 'en', 'VERTICAL', 'PUBLISHED', 'FREE', 0, 68, CURRENT_TIMESTAMP),
  ('demo_ser_signal_zero_chapter', 'ser_signal_zero', 'episode-22', '22', 'Carrier wave', 'fr', 'VERTICAL', 'PUBLISHED', 'PREMIUM', 12, 62, CURRENT_TIMESTAMP),
  ('demo_ser_crown_tides_chapter', 'ser_crown_tides', 'chapter-86', '86', 'The reef throne', 'ar', 'LTR', 'PUBLISHED', 'WAIT_TO_UNLOCK', 0, 49, CURRENT_TIMESTAMP),
  ('demo_ser_moon_parcel_chapter', 'ser_moon_parcel', 'issue-17', '17', 'Address unknown', 'en', 'LTR', 'PUBLISHED', 'FREE', 0, 38, CURRENT_TIMESTAMP),
  ('demo_ser_ash_aster_chapter', 'ser_ash_aster', 'preview', '0', 'Winter seed', 'en', 'RTL', 'SCHEDULED', 'FREE', 0, 16, NULL);
--> statement-breakpoint
INSERT OR IGNORE INTO `products`
  (`id`, `slug`, `kind`, `name`, `description`, `price_minor`, `billing_currency`, `onyx_base`, `onyx_bonus`, `active`, `metadata_json`)
VALUES
  ('onyx_240', 'onyx-240', 'CURRENCY_PACKAGE', 'Onyx 240', '220 base Onyx plus 20 bonus Onyx.', 399, 'USD', 220, 20, 1, '{"developmentOnly":true}'),
  ('onyx_720', 'onyx-720', 'CURRENCY_PACKAGE', 'Onyx 720', '620 base Onyx plus 100 bonus Onyx.', 999, 'USD', 620, 100, 1, '{"developmentOnly":true}'),
  ('onyx_1600', 'onyx-1600', 'CURRENCY_PACKAGE', 'Onyx 1,600', '1,300 base Onyx plus 300 bonus Onyx.', 1999, 'USD', 1300, 300, 1, '{"developmentOnly":true}'),
  ('nya_plus_monthly', 'nya-plus-monthly', 'MEMBERSHIP', 'Nya+ Monthly', 'Monthly membership with data-driven benefits.', 499, 'USD', 0, 0, 1, '{"developmentOnly":true,"period":"month"}');
--> statement-breakpoint
INSERT OR IGNORE INTO `feature_flags` (`key`, `enabled`, `description`)
VALUES
  ('payments', 0, 'Enable configured payment-provider checkout.'),
  ('onyx_purchases', 0, 'Enable paid Onyx packages.'),
  ('premium_unlocks', 1, 'Enable Onyx episode unlocks.'),
  ('memberships', 0, 'Enable recurring Nya+ billing.'),
  ('ad_supported_unlocks', 0, 'Enable configured ad-reward unlocks.'),
  ('team_payouts', 0, 'Enable verified team payout requests.'),
  ('mature_content', 0, 'Enable mature content after age and region checks.'),
  ('public_comments', 1, 'Enable moderated public comments.');
