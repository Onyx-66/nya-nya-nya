CREATE TABLE `chapter_reward_claims` (
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`active_seconds` integer NOT NULL,
	`claimed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chapter_reward_claims_seconds_check" CHECK("chapter_reward_claims"."active_seconds" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_reward_claims_transaction_uidx` ON `chapter_reward_claims` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `chapter_reward_claims_recent_idx` ON `chapter_reward_claims` (`user_id`,`claimed_at`);--> statement-breakpoint
CREATE TABLE `chapter_reward_sessions` (
	`user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`active_seconds` integer DEFAULT 0 NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_heartbeat_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `chapter_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chapter_reward_sessions_seconds_check" CHECK("chapter_reward_sessions"."active_seconds" >= 0)
);
--> statement-breakpoint
CREATE INDEX `chapter_reward_sessions_active_idx` ON `chapter_reward_sessions` (`user_id`,`active_seconds`,`updated_at`);--> statement-breakpoint
CREATE TABLE `community_reward_claims` (
	`beneficiary_user_id` text NOT NULL,
	`reward_type` text NOT NULL,
	`source_id` text NOT NULL,
	`amount` integer NOT NULL,
	`transaction_id` text NOT NULL,
	`claimed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`beneficiary_user_id`, `reward_type`, `source_id`),
	FOREIGN KEY (`beneficiary_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "community_reward_claims_type_check" CHECK("community_reward_claims"."reward_type" IN ('COMMENT_CREATED', 'COMMENT_UPVOTE')),
	CONSTRAINT "community_reward_claims_amount_check" CHECK("community_reward_claims"."amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_reward_claims_transaction_uidx` ON `community_reward_claims` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `community_reward_claims_recent_idx` ON `community_reward_claims` (`beneficiary_user_id`,`claimed_at`);--> statement-breakpoint
CREATE TABLE `gift_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`code_ciphertext` text NOT NULL,
	`code_nonce` text NOT NULL,
	`code_suffix` text NOT NULL,
	`purchaser_user_id` text NOT NULL,
	`purchase_idempotency_key` text NOT NULL,
	`coin_amount` integer NOT NULL,
	`recipient_label` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`expires_at` text,
	`purchase_transaction_id` text NOT NULL,
	`redeemed_by_user_id` text,
	`redeemed_transaction_id` text,
	`redeemed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`purchase_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redeemed_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gift_cards_amount_check" CHECK("gift_cards"."coin_amount" > 0),
	CONSTRAINT "gift_cards_status_check" CHECK("gift_cards"."status" IN ('ACTIVE', 'REDEEMED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_cards_code_hash_uidx` ON `gift_cards` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `gift_cards_purchase_idempotency_uidx` ON `gift_cards` (`purchaser_user_id`,`purchase_idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `gift_cards_redeem_transaction_uidx` ON `gift_cards` (`redeemed_transaction_id`);--> statement-breakpoint
CREATE INDEX `gift_cards_owner_recent_idx` ON `gift_cards` (`purchaser_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `gift_cards_status_idx` ON `gift_cards` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `reward_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`settings_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roulette_spins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`reward_key` text NOT NULL,
	`reward_type` text NOT NULL,
	`reward_amount` integer DEFAULT 0 NOT NULL,
	`store_item_id` text,
	`transaction_id` text NOT NULL,
	`next_eligible_at` text NOT NULL,
	`spun_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_item_id`) REFERENCES `store_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "roulette_spins_reward_type_check" CHECK("roulette_spins"."reward_type" IN ('SHARDS', 'ONYX', 'STORE_ITEM')),
	CONSTRAINT "roulette_spins_reward_amount_check" CHECK("roulette_spins"."reward_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roulette_spins_idempotency_uidx` ON `roulette_spins` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `roulette_spins_transaction_uidx` ON `roulette_spins` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `roulette_spins_user_recent_idx` ON `roulette_spins` (`user_id`,`spun_at`);--> statement-breakpoint
CREATE TABLE `roulette_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`next_eligible_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	`last_spin_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `team_support_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`supporter_user_id` text NOT NULL,
	`team_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`coin_amount` integer NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`transaction_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`supporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "team_support_amount_check" CHECK("team_support_receipts"."coin_amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_support_idempotency_uidx` ON `team_support_receipts` (`supporter_user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_support_transaction_uidx` ON `team_support_receipts` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `team_support_team_recent_idx` ON `team_support_receipts` (`team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `team_support_user_recent_idx` ON `team_support_receipts` (`supporter_user_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_store_items` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`price_onyx` integer NOT NULL,
	`price_currency` text DEFAULT 'ONYX' NOT NULL,
	`preview_key` text,
	`preview_config_json` text DEFAULT '{}' NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `store_collections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "store_items_price_check" CHECK("__new_store_items"."price_onyx" >= 0),
	CONSTRAINT "store_items_currency_check" CHECK("__new_store_items"."price_currency" IN ('ONYX', 'SHARDS')),
	CONSTRAINT "store_items_category_check" CHECK("__new_store_items"."category" IN (
        'PROFILE_BANNER',
        'PROFILE_FRAME',
        'USERNAME_DECORATION',
        'COMMENT_EFFECT',
        'COMMENT_GRADIENT',
        'SEASONAL_PROFILE',
        'LOGO_EFFECT'
      ))
);
--> statement-breakpoint
INSERT INTO `__new_store_items`("id", "slug", "collection_id", "name", "description", "category", "price_onyx", "price_currency", "preview_key", "preview_config_json", "is_published", "is_hidden", "sort_order", "revision", "archived_at", "created_at", "updated_at") SELECT "id", "slug", "collection_id", "name", "description", "category", "price_onyx", 'ONYX', "preview_key", "preview_config_json", "is_published", "is_hidden", "sort_order", "revision", "archived_at", "created_at", "updated_at" FROM `store_items`;--> statement-breakpoint
DROP TABLE `store_items`;--> statement-breakpoint
ALTER TABLE `__new_store_items` RENAME TO `store_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `store_items_slug_uidx` ON `store_items` (`slug`);--> statement-breakpoint
CREATE INDEX `store_items_public_idx` ON `store_items` (`collection_id`,`is_published`,`is_hidden`,`sort_order`);--> statement-breakpoint
DROP TRIGGER IF EXISTS `ledger_no_negative_user_balance`;--> statement-breakpoint
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
  SELECT RAISE(ABORT, 'insufficient_balance');
END;--> statement-breakpoint
CREATE TRIGGER `ledger_no_negative_gift_escrow`
BEFORE INSERT ON `ledger_entries`
WHEN
  NEW.amount < 0
  AND NEW.account_id = 'la_platform_gift_escrow_onyx'
  AND (
    COALESCE(
      (SELECT SUM(`amount`) FROM `ledger_entries` WHERE `account_id` = NEW.account_id),
      0
    ) + NEW.amount
  ) < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_gift_escrow');
END;--> statement-breakpoint
CREATE TRIGGER `ledger_single_currency_transaction`
BEFORE INSERT ON `ledger_entries`
WHEN EXISTS (
  SELECT 1
    FROM `ledger_entries` existing_entry
    JOIN `ledger_accounts` existing_account
      ON existing_account.id = existing_entry.account_id
    JOIN `ledger_accounts` new_account
      ON new_account.id = NEW.account_id
   WHERE existing_entry.transaction_id = NEW.transaction_id
     AND existing_account.currency <> new_account.currency
)
BEGIN
  SELECT RAISE(ABORT, 'ledger_currency_mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `ledger_entries_no_update`
BEFORE UPDATE ON `ledger_entries`
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `ledger_entries_no_delete`
BEFORE DELETE ON `ledger_entries`
BEGIN
  SELECT RAISE(ABORT, 'ledger_entries_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `ledger_transactions_no_update`
BEFORE UPDATE ON `ledger_transactions`
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `ledger_transactions_no_delete`
BEFORE DELETE ON `ledger_transactions`
BEGIN
  SELECT RAISE(ABORT, 'ledger_transactions_immutable');
END;--> statement-breakpoint
PRAGMA foreign_key_check;
