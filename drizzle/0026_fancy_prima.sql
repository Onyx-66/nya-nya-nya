CREATE TABLE `chapter_unlock_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`entitlement_id` text NOT NULL,
	`buyer_user_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`team_id` text,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'ONYX' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entitlement_id`) REFERENCES `entitlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chapter_unlock_receipts_amount_check" CHECK("chapter_unlock_receipts"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_unlock_receipts_transaction_uidx` ON `chapter_unlock_receipts` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `chapter_unlock_receipts_entitlement_idx` ON `chapter_unlock_receipts` (`entitlement_id`);--> statement-breakpoint
CREATE INDEX `chapter_unlock_receipts_team_recent_idx` ON `chapter_unlock_receipts` (`team_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chapter_unlock_receipts_buyer_recent_idx` ON `chapter_unlock_receipts` (`buyer_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `series_gallery_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`orientation` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`language` text,
	`volume` text,
	`submitted_by_user_id` text NOT NULL,
	`submitter_team_id` text,
	`moderation_status` text DEFAULT 'PENDING' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` text,
	`rejection_reason` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`submitter_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "series_gallery_kind_check" CHECK("series_gallery_assets"."kind" IN ('ART', 'COVER')),
	CONSTRAINT "series_gallery_orientation_check" CHECK("series_gallery_assets"."orientation" IN ('LANDSCAPE', 'PORTRAIT')),
	CONSTRAINT "series_gallery_moderation_check" CHECK("series_gallery_assets"."moderation_status" IN ('PENDING', 'APPROVED', 'REJECTED')),
	CONSTRAINT "series_gallery_dimensions_check" CHECK("series_gallery_assets"."width" > 0 AND "series_gallery_assets"."height" > 0 AND "series_gallery_assets"."byte_size" > 0),
	CONSTRAINT "series_gallery_ratio_check" CHECK(
		("series_gallery_assets"."orientation" = 'LANDSCAPE' AND "series_gallery_assets"."width" * 9 = "series_gallery_assets"."height" * 16)
		OR
		("series_gallery_assets"."orientation" = 'PORTRAIT' AND "series_gallery_assets"."width" * 3 = "series_gallery_assets"."height" * 2)
	)
);
--> statement-breakpoint
CREATE INDEX `series_gallery_public_idx` ON `series_gallery_assets` (`series_id`,`kind`,`moderation_status`,`display_order`,`created_at`);--> statement-breakpoint
CREATE INDEX `series_gallery_moderation_idx` ON `series_gallery_assets` (`moderation_status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `series_gallery_submitter_idx` ON `series_gallery_assets` (`submitted_by_user_id`,`created_at`);
