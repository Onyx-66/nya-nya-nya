CREATE TABLE `discussion_comment_gifs` (
	`comment_id` text NOT NULL,
	`gif_id` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`comment_id`, `gif_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `discussion_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gif_id`) REFERENCES `custom_reactions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `discussion_comment_gifs_comment_idx` ON `discussion_comment_gifs` (`comment_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `discussion_comment_gifs_gif_idx` ON `discussion_comment_gifs` (`gif_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_ticket_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`body` text NOT NULL,
	`is_staff_reply` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_ticket_messages_ticket_idx` ON `support_ticket_messages` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_user_id` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`last_message_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "support_tickets_category_check" CHECK("support_tickets"."category" IN ('ACCOUNT', 'READING', 'PURCHASES', 'PUBLISHING', 'OTHER')),
	CONSTRAINT "support_tickets_status_check" CHECK("support_tickets"."status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED')),
	CONSTRAINT "support_tickets_priority_check" CHECK("support_tickets"."priority" IN ('LOW', 'NORMAL', 'HIGH'))
);
--> statement-breakpoint
CREATE INDEX `support_tickets_requester_idx` ON `support_tickets` (`requester_user_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_status_idx` ON `support_tickets` (`status`,`last_message_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_custom_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`accessible_label` text NOT NULL,
	`emoji_fallback` text DEFAULT '' NOT NULL,
	`asset_key` text,
	`content_type` text,
	`width` integer,
	`height` integer,
	`byte_size` integer,
	`is_animated` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`category` text,
	`usage_kind` text DEFAULT 'REACTION' NOT NULL,
	`availability_json` text DEFAULT '{}' NOT NULL,
	`created_by_user_id` text,
	`updated_by_user_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "custom_reactions_usage_kind_check" CHECK("__new_custom_reactions"."usage_kind" IN ('REACTION', 'COMMENT_GIF'))
);
--> statement-breakpoint
INSERT INTO `__new_custom_reactions`("id", "slug", "name", "accessible_label", "emoji_fallback", "asset_key", "content_type", "width", "height", "byte_size", "is_animated", "is_active", "is_archived", "display_order", "category", "usage_kind", "availability_json", "created_by_user_id", "updated_by_user_id", "revision", "created_at", "updated_at") SELECT "id", "slug", "name", "accessible_label", "emoji_fallback", "asset_key", "content_type", "width", "height", "byte_size", "is_animated", "is_active", "is_archived", "display_order", "category", 'REACTION', "availability_json", "created_by_user_id", "updated_by_user_id", "revision", "created_at", "updated_at" FROM `custom_reactions`;--> statement-breakpoint
DROP TABLE `custom_reactions`;--> statement-breakpoint
ALTER TABLE `__new_custom_reactions` RENAME TO `custom_reactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `custom_reactions_slug_uidx` ON `custom_reactions` (`slug`);--> statement-breakpoint
CREATE INDEX `custom_reactions_public_idx` ON `custom_reactions` (`is_active`,`is_archived`,`display_order`);--> statement-breakpoint
CREATE TABLE `__new_roulette_spins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`reward_key` text NOT NULL,
	`reward_type` text NOT NULL,
	`reward_amount` integer DEFAULT 0 NOT NULL,
	`store_item_id` text,
	`spin_mode` text DEFAULT 'DAILY' NOT NULL,
	`cost_shards` integer DEFAULT 0 NOT NULL,
	`charge_transaction_id` text,
	`transaction_id` text NOT NULL,
	`next_eligible_at` text NOT NULL,
	`spun_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_item_id`) REFERENCES `store_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`charge_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "roulette_spins_reward_type_check" CHECK("__new_roulette_spins"."reward_type" IN ('SHARDS', 'ONYX', 'STORE_ITEM')),
	CONSTRAINT "roulette_spins_reward_amount_check" CHECK("__new_roulette_spins"."reward_amount" >= 0),
	CONSTRAINT "roulette_spins_mode_check" CHECK("__new_roulette_spins"."spin_mode" IN ('DAILY', 'PAID')),
	CONSTRAINT "roulette_spins_cost_check" CHECK("__new_roulette_spins"."cost_shards" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_roulette_spins`("id", "user_id", "idempotency_key", "reward_key", "reward_type", "reward_amount", "store_item_id", "spin_mode", "cost_shards", "charge_transaction_id", "transaction_id", "next_eligible_at", "spun_at") SELECT "id", "user_id", "idempotency_key", "reward_key", "reward_type", "reward_amount", "store_item_id", 'DAILY', 0, NULL, "transaction_id", "next_eligible_at", "spun_at" FROM `roulette_spins`;--> statement-breakpoint
DROP TABLE `roulette_spins`;--> statement-breakpoint
ALTER TABLE `__new_roulette_spins` RENAME TO `roulette_spins`;--> statement-breakpoint
CREATE UNIQUE INDEX `roulette_spins_idempotency_uidx` ON `roulette_spins` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `roulette_spins_transaction_uidx` ON `roulette_spins` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `roulette_spins_user_recent_idx` ON `roulette_spins` (`user_id`,`spun_at`);--> statement-breakpoint
ALTER TABLE `series` ADD `slider_key` text;
