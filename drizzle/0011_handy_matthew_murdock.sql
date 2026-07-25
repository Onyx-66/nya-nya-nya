CREATE TABLE `discussion_user_restrictions` (
	`series_slug` text NOT NULL,
	`user_id` text NOT NULL,
	`banned_by_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`series_slug`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`banned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `discussion_user_restrictions_user_idx` ON `discussion_user_restrictions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_configuration_settings` (
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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_store_items` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`price_onyx` integer NOT NULL,
	`preview_key` text,
	`preview_config_json` text DEFAULT '{}' NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `store_collections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "store_items_price_check" CHECK("__new_store_items"."price_onyx" >= 0),
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
INSERT INTO `__new_store_items`("id", "slug", "collection_id", "name", "description", "category", "price_onyx", "preview_key", "preview_config_json", "is_published", "is_hidden", "sort_order", "created_at", "updated_at") SELECT "id", "slug", "collection_id", "name", "description", "category", "price_onyx", "preview_key", "preview_config_json", "is_published", "is_hidden", "sort_order", "created_at", "updated_at" FROM `store_items`;--> statement-breakpoint
DROP TABLE `store_items`;--> statement-breakpoint
ALTER TABLE `__new_store_items` RENAME TO `store_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `store_items_slug_uidx` ON `store_items` (`slug`);--> statement-breakpoint
CREATE INDEX `store_items_public_idx` ON `store_items` (`collection_id`,`is_published`,`is_hidden`,`sort_order`);--> statement-breakpoint
ALTER TABLE `analytics_events` ADD `region_code` text;--> statement-breakpoint
CREATE INDEX `analytics_events_region_time_idx` ON `analytics_events` (`region_code`,`created_at`);--> statement-breakpoint
CREATE INDEX `chapters_series_latest_idx` ON `chapters` (`series_id`,`state`,`published_at`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `discussion_comments_series_recent_idx` ON `discussion_comments` (`series_slug`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `discussion_reactions_created_idx` ON `discussion_reactions` (`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_tx_kind_time_idx` ON `ledger_transactions` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `users_created_idx` ON `users` (`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `store_items`
  (`id`, `slug`, `collection_id`, `name`, `description`, `category`,
   `price_onyx`, `preview_config_json`, `is_published`, `is_hidden`,
   `sort_order`)
VALUES
  ('item_summer_sun_logo', 'summer-sun-logo', 'collection_summer',
   'Solar Signature', 'A warm ocean-sun shimmer for your profile identity mark.',
   'LOGO_EFFECT', 180,
   '{"from":"#0ea5e9","to":"#f59e0b","accent":"#fef3c7","symbol":"SUN"}',
   1, 0, 50),
  ('item_carthage_coin_logo', 'carthage-coin-logo', 'collection_carthage',
   'Carthage Coinlight', 'Antique-gold geometry orbiting an ocean-blue identity mark.',
   'LOGO_EFFECT', 260,
   '{"from":"#082f49","to":"#0369a1","accent":"#d4af37","symbol":"COIN"}',
   1, 0, 50),
  ('item_odyssey_star_logo', 'odyssey-star-logo', 'collection_odyssey',
   'Odyssey Starwake', 'A restrained celestial wake that follows your profile mark.',
   'LOGO_EFFECT', 300,
   '{"from":"#0f172a","to":"#1d4ed8","accent":"#bfdbfe","symbol":"STAR"}',
   1, 0, 50);
