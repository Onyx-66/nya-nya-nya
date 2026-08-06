CREATE TABLE `content_discounts` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`series_id` text NOT NULL,
	`chapter_id` text,
	`discount_type` text NOT NULL,
	`discount_value` integer NOT NULL,
	`original_price` integer NOT NULL,
	`reduced_price` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_discounts_target_type_check" CHECK("content_discounts"."target_type" IN ('SERIES', 'CHAPTER')),
	CONSTRAINT "content_discounts_target_check" CHECK(("content_discounts"."target_type" = 'SERIES' AND "content_discounts"."chapter_id" IS NULL) OR ("content_discounts"."target_type" = 'CHAPTER' AND "content_discounts"."chapter_id" IS NOT NULL)),
	CONSTRAINT "content_discounts_type_check" CHECK("content_discounts"."discount_type" IN ('PERCENT', 'FIXED')),
	CONSTRAINT "content_discounts_price_check" CHECK("content_discounts"."original_price" > 0 AND "content_discounts"."reduced_price" >= 0 AND "content_discounts"."reduced_price" < "content_discounts"."original_price" AND "content_discounts"."discount_value" > 0),
	CONSTRAINT "content_discounts_percent_check" CHECK("content_discounts"."discount_type" <> 'PERCENT' OR "content_discounts"."discount_value" BETWEEN 1 AND 99),
	CONSTRAINT "content_discounts_fixed_check" CHECK("content_discounts"."discount_type" <> 'FIXED' OR "content_discounts"."discount_value" = "content_discounts"."reduced_price"),
	CONSTRAINT "content_discounts_dates_check" CHECK(datetime("content_discounts"."ends_at") > datetime("content_discounts"."starts_at"))
);
--> statement-breakpoint
CREATE INDEX `content_discounts_public_idx` ON `content_discounts` (`is_active`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE INDEX `content_discounts_target_idx` ON `content_discounts` (`target_type`,`series_id`,`chapter_id`);--> statement-breakpoint
CREATE TABLE `email_verification_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`return_to` text DEFAULT '/account' NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verification_tokens_hash_uidx` ON `email_verification_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_verification_tokens_user_idx` ON `email_verification_tokens` (`user_id`,`used_at`,`expires_at`);--> statement-breakpoint
CREATE TABLE `home_pinned_series` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "home_pinned_series_order_check" CHECK("home_pinned_series"."display_order" >= 0),
	CONSTRAINT "home_pinned_series_dates_check" CHECK("home_pinned_series"."ends_at" IS NULL OR "home_pinned_series"."starts_at" IS NULL OR datetime("home_pinned_series"."ends_at") > datetime("home_pinned_series"."starts_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `home_pinned_series_series_uidx` ON `home_pinned_series` (`series_id`);--> statement-breakpoint
CREATE INDEX `home_pinned_series_schedule_idx` ON `home_pinned_series` (`display_order`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `user_password_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`algorithm` text DEFAULT 'PBKDF2-SHA256' NOT NULL,
	`iterations` integer NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`password_updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_password_credentials_algorithm_check" CHECK("user_password_credentials"."algorithm" = 'PBKDF2-SHA256'),
	CONSTRAINT "user_password_credentials_iterations_check" CHECK("user_password_credentials"."iterations" >= 100000),
	CONSTRAINT "user_password_credentials_attempts_check" CHECK("user_password_credentials"."failed_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`auth_method` text DEFAULT 'PASSWORD' NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_sessions_auth_method_check" CHECK("user_sessions"."auth_method" IN ('PASSWORD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_token_hash_uidx` ON `user_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `user_sessions_user_idx` ON `user_sessions` (`user_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `user_sessions_expiry_idx` ON `user_sessions` (`expires_at`,`revoked_at`);
--> statement-breakpoint
CREATE TRIGGER `home_pinned_series_max_three_featured_insert`
BEFORE INSERT ON `home_pinned_series`
WHEN NEW.`is_featured` = 1
 AND (SELECT COUNT(*) FROM `home_pinned_series` WHERE `is_featured` = 1) >= 3
BEGIN
  SELECT RAISE(ABORT, 'Pinned Series supports at most three Featured items');
END;
--> statement-breakpoint
CREATE TRIGGER `home_pinned_series_max_three_featured_update`
BEFORE UPDATE OF `is_featured` ON `home_pinned_series`
WHEN NEW.`is_featured` = 1
 AND OLD.`is_featured` <> 1
 AND (SELECT COUNT(*) FROM `home_pinned_series` WHERE `is_featured` = 1) >= 3
BEGIN
  SELECT RAISE(ABORT, 'Pinned Series supports at most three Featured items');
END;
