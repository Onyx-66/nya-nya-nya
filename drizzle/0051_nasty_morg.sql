PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_floating_ads` (
	`id` text PRIMARY KEY NOT NULL,
	`eyebrow` text DEFAULT 'Support NyaScans' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`action_label` text DEFAULT 'Explore event' NOT NULL,
	`info_blocks_json` text DEFAULT '[]' NOT NULL,
	`destination_url` text DEFAULT '' NOT NULL,
	`image_key` text,
	`fallback_image_url` text DEFAULT '' NOT NULL,
	`effect` text DEFAULT 'WAVE' NOT NULL,
	`display_slot` integer DEFAULT 1 NOT NULL,
	`primary_color` text DEFAULT '#65B5FF' NOT NULL,
	`secondary_color` text DEFAULT '#8B5CF6' NOT NULL,
	`background_color` text DEFAULT '#07111C' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`reset_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "floating_ads_effect_check" CHECK("__new_floating_ads"."effect" IN ('WAVE', 'PULSE', 'GLOW')),
	CONSTRAINT "floating_ads_display_slot_check" CHECK("__new_floating_ads"."display_slot" IN (1, 2))
);
--> statement-breakpoint
INSERT INTO `__new_floating_ads`("id", "eyebrow", "title", "body", "action_label", "info_blocks_json", "destination_url", "image_key", "fallback_image_url", "effect", "display_slot", "primary_color", "secondary_color", "background_color", "is_active", "starts_at", "ends_at", "reset_key", "revision", "created_by_user_id", "created_at", "updated_at") SELECT "id", "eyebrow", "title", "body", "action_label", "info_blocks_json", "destination_url", "image_key", "fallback_image_url", "effect", 1, '#65B5FF', '#8B5CF6', '#07111C', "is_active", "starts_at", "ends_at", "reset_key", "revision", "created_by_user_id", "created_at", "updated_at" FROM `floating_ads`;--> statement-breakpoint
DROP TABLE `floating_ads`;--> statement-breakpoint
ALTER TABLE `__new_floating_ads` RENAME TO `floating_ads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `floating_ads_active_idx` ON `floating_ads` (`is_active`,`display_slot`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `floating_ads_active_slot_uidx` ON `floating_ads` (`display_slot`) WHERE "floating_ads"."is_active" = 1;
