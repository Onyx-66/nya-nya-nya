ALTER TABLE `user_profiles` ADD `show_favorites` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `show_achievements` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `show_bookmarks` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `show_comments` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `profile_favorite_series` (
  `user_id` text NOT NULL,
  `series_id` text NOT NULL,
  `position` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY(`user_id`, `series_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "profile_favorite_series_position_check"
    CHECK("profile_favorite_series"."position" >= 1 AND "profile_favorite_series"."position" <= 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_favorite_series_position_uidx`
  ON `profile_favorite_series` (`user_id`, `position`);
--> statement-breakpoint
CREATE INDEX `profile_favorite_series_series_idx`
  ON `profile_favorite_series` (`series_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `achievement_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `rarity` text DEFAULT 'COMMON' NOT NULL,
  `icon_key` text,
  `is_active` integer DEFAULT true NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "achievement_definitions_rarity_check"
    CHECK("achievement_definitions"."rarity" IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'EXCLUSIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `achievement_definitions_slug_uidx`
  ON `achievement_definitions` (`slug`);
--> statement-breakpoint
CREATE INDEX `achievement_definitions_public_idx`
  ON `achievement_definitions` (`is_active`, `sort_order`);
--> statement-breakpoint
CREATE TABLE `user_achievements` (
  `user_id` text NOT NULL,
  `achievement_id` text NOT NULL,
  `earned_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  PRIMARY KEY(`user_id`, `achievement_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`achievement_id`) REFERENCES `achievement_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_achievements_recent_idx`
  ON `user_achievements` (`user_id`, `earned_at`);
--> statement-breakpoint
CREATE TABLE `team_support_receipt_series` (
  `receipt_id` text NOT NULL,
  `series_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY(`receipt_id`, `series_id`),
  FOREIGN KEY (`receipt_id`) REFERENCES `team_support_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_support_receipt_series_series_idx`
  ON `team_support_receipt_series` (`series_id`, `created_at`);
--> statement-breakpoint
ALTER TABLE `roulette_state`
  ADD `free_spin_balance` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_roulette_spins_v32` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `reward_key` text NOT NULL,
  `reward_type` text NOT NULL,
  `reward_amount` integer DEFAULT 0 NOT NULL,
  `store_item_id` text,
  `spin_mode` text DEFAULT 'DAILY' NOT NULL,
  `cost_shards` integer DEFAULT 0 NOT NULL,
  `cost_currency` text,
  `cost_amount` integer DEFAULT 0 NOT NULL,
  `charge_transaction_id` text,
  `transaction_id` text NOT NULL,
  `next_eligible_at` text NOT NULL,
  `spun_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`store_item_id`) REFERENCES `store_items`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`charge_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "roulette_spins_reward_type_check"
    CHECK("__new_roulette_spins_v32"."reward_type" IN ('SHARDS', 'ONYX', 'STORE_ITEM')),
  CONSTRAINT "roulette_spins_reward_amount_check"
    CHECK("__new_roulette_spins_v32"."reward_amount" >= 0),
  CONSTRAINT "roulette_spins_mode_check"
    CHECK("__new_roulette_spins_v32"."spin_mode" IN ('DAILY', 'TASK', 'PAID')),
  CONSTRAINT "roulette_spins_cost_check"
    CHECK("__new_roulette_spins_v32"."cost_shards" >= 0 AND "__new_roulette_spins_v32"."cost_amount" >= 0),
  CONSTRAINT "roulette_spins_cost_currency_check"
    CHECK("__new_roulette_spins_v32"."cost_currency" IS NULL OR "__new_roulette_spins_v32"."cost_currency" IN ('SHARDS', 'ONYX'))
);
--> statement-breakpoint
INSERT INTO `__new_roulette_spins_v32` (
  `id`, `user_id`, `idempotency_key`, `reward_key`, `reward_type`,
  `reward_amount`, `store_item_id`, `spin_mode`, `cost_shards`,
  `cost_currency`, `cost_amount`, `charge_transaction_id`, `transaction_id`,
  `next_eligible_at`, `spun_at`
)
SELECT
  `id`, `user_id`, `idempotency_key`, `reward_key`, `reward_type`,
  `reward_amount`, `store_item_id`, `spin_mode`, `cost_shards`,
  CASE WHEN `cost_shards` > 0 THEN 'SHARDS' ELSE NULL END,
  `cost_shards`, `charge_transaction_id`, `transaction_id`,
  `next_eligible_at`, `spun_at`
FROM `roulette_spins`;
--> statement-breakpoint
DROP TABLE `roulette_spins`;
--> statement-breakpoint
ALTER TABLE `__new_roulette_spins_v32` RENAME TO `roulette_spins`;
--> statement-breakpoint
CREATE UNIQUE INDEX `roulette_spins_idempotency_uidx`
  ON `roulette_spins` (`user_id`, `idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `roulette_spins_transaction_uidx`
  ON `roulette_spins` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `roulette_spins_user_recent_idx`
  ON `roulette_spins` (`user_id`, `spun_at`);
--> statement-breakpoint
CREATE TABLE `roulette_task_claims` (
  `user_id` text NOT NULL,
  `task_id` text NOT NULL,
  `week_start` text NOT NULL,
  `awarded_spins` integer NOT NULL,
  `idempotency_key` text NOT NULL,
  `claimed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY(`user_id`, `task_id`, `week_start`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "roulette_task_claims_spins_check"
    CHECK("roulette_task_claims"."awarded_spins" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roulette_task_claims_idempotency_uidx`
  ON `roulette_task_claims` (`user_id`, `idempotency_key`);
--> statement-breakpoint
CREATE INDEX `roulette_task_claims_user_week_idx`
  ON `roulette_task_claims` (`user_id`, `week_start`);
