CREATE TABLE `content_visibility_overrides` (
	`chapter_id` text PRIMARY KEY NOT NULL,
	`access_type` text NOT NULL,
	`price_onyx` integer DEFAULT 0 NOT NULL,
	`auto_free_exempt` integer DEFAULT false NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "content_visibility_overrides_access_check" CHECK("content_visibility_overrides"."access_type" IN ('FREE', 'PAID', 'PREMIUM')),
	CONSTRAINT "content_visibility_overrides_price_check" CHECK(("content_visibility_overrides"."access_type" = 'FREE' AND "content_visibility_overrides"."price_onyx" = 0) OR ("content_visibility_overrides"."access_type" = 'PAID' AND "content_visibility_overrides"."price_onyx" > 0) OR ("content_visibility_overrides"."access_type" = 'PREMIUM' AND "content_visibility_overrides"."price_onyx" = 0))
);
--> statement-breakpoint
CREATE INDEX `content_visibility_overrides_access_idx` ON `content_visibility_overrides` (`access_type`,`updated_at`);--> statement-breakpoint
CREATE TABLE `content_visibility_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`default_access_type` text DEFAULT 'FREE' NOT NULL,
	`default_price_onyx` integer DEFAULT 0 NOT NULL,
	`auto_free_after_days` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_visibility_settings_id_check" CHECK("content_visibility_settings"."id" = 'active'),
	CONSTRAINT "content_visibility_settings_access_check" CHECK("content_visibility_settings"."default_access_type" IN ('FREE', 'PAID')),
	CONSTRAINT "content_visibility_settings_price_check" CHECK(("content_visibility_settings"."default_access_type" = 'FREE' AND "content_visibility_settings"."default_price_onyx" = 0) OR ("content_visibility_settings"."default_access_type" = 'PAID' AND "content_visibility_settings"."default_price_onyx" > 0)),
	CONSTRAINT "content_visibility_settings_auto_free_check" CHECK("content_visibility_settings"."auto_free_after_days" IS NULL OR "content_visibility_settings"."auto_free_after_days" BETWEEN 1 AND 3650)
);
--> statement-breakpoint
CREATE TABLE `membership_coin_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`ledger_transaction_id` text NOT NULL,
	`amount_onyx` integer NOT NULL,
	`period_start` text,
	`period_end` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `user_memberships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_coin_grants_amount_check" CHECK("membership_coin_grants"."amount_onyx" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_coin_grants_event_uidx` ON `membership_coin_grants` (`provider_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_coin_grants_ledger_uidx` ON `membership_coin_grants` (`ledger_transaction_id`);--> statement-breakpoint
CREATE INDEX `membership_coin_grants_membership_idx` ON `membership_coin_grants` (`membership_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_fulfillments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`ledger_transaction_id` text,
	`membership_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `user_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "order_fulfillments_kind_check" CHECK("order_fulfillments"."kind" IN ('ONYX', 'MEMBERSHIP'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_fulfillments_order_item_uidx` ON `order_fulfillments` (`order_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `order_fulfillments_event_uidx` ON `order_fulfillments` (`provider_event_id`);--> statement-breakpoint
CREATE TABLE `payment_checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider` text DEFAULT 'STRIPE' NOT NULL,
	`provider_session_id` text,
	`checkout_url` text,
	`mode` text NOT NULL,
	`product_id_snapshot` text NOT NULL,
	`product_revision_snapshot` integer NOT NULL,
	`product_kind_snapshot` text NOT NULL,
	`fulfillment_onyx_snapshot` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'CREATING' NOT NULL,
	`amount_minor` integer NOT NULL,
	`billing_currency` text NOT NULL,
	`expires_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_checkout_sessions_mode_check" CHECK("payment_checkout_sessions"."mode" IN ('PAYMENT', 'SUBSCRIPTION')),
	CONSTRAINT "payment_checkout_sessions_product_kind_check" CHECK(("payment_checkout_sessions"."mode" = 'PAYMENT' AND "payment_checkout_sessions"."product_kind_snapshot" = 'CURRENCY_PACKAGE') OR ("payment_checkout_sessions"."mode" = 'SUBSCRIPTION' AND "payment_checkout_sessions"."product_kind_snapshot" = 'MEMBERSHIP')),
	CONSTRAINT "payment_checkout_sessions_fulfillment_check" CHECK("payment_checkout_sessions"."fulfillment_onyx_snapshot" >= 0),
	CONSTRAINT "payment_checkout_sessions_status_check" CHECK("payment_checkout_sessions"."status" IN ('CREATING', 'OPEN', 'COMPLETED', 'EXPIRED', 'FAILED')),
	CONSTRAINT "payment_checkout_sessions_amount_check" CHECK("payment_checkout_sessions"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_checkout_sessions_order_uidx` ON `payment_checkout_sessions` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_checkout_sessions_provider_uidx` ON `payment_checkout_sessions` (`provider`,`provider_session_id`) WHERE "payment_checkout_sessions"."provider_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `payment_checkout_sessions_status_idx` ON `payment_checkout_sessions` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `payment_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'STRIPE' NOT NULL,
	`event_type` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`status` text DEFAULT 'RECEIVED' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`processed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "payment_webhook_events_status_check" CHECK("payment_webhook_events"."status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED')),
	CONSTRAINT "payment_webhook_events_attempt_check" CHECK("payment_webhook_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `payment_webhook_events_status_idx` ON `payment_webhook_events` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `user_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text,
	`provider` text DEFAULT 'STRIPE' NOT NULL,
	`provider_customer_id` text,
	`provider_subscription_id` text NOT NULL,
	`onyx_allowance` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`current_period_start` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_memberships_status_check" CHECK("user_memberships"."status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
	CONSTRAINT "user_memberships_onyx_allowance_check" CHECK("user_memberships"."onyx_allowance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_memberships_provider_subscription_uidx` ON `user_memberships` (`provider`,`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `user_memberships_user_status_idx` ON `user_memberships` (`user_id`,`status`,`current_period_end`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_provider_reference_uidx` ON `orders` (`provider`,`provider_reference`) WHERE "orders"."provider_reference" IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `content_visibility_settings`
  (`id`, `default_access_type`, `default_price_onyx`, `auto_free_after_days`, `revision`)
VALUES ('active', 'FREE', 0, NULL, 1);--> statement-breakpoint
CREATE TRIGGER `content_visibility_schedule_chapter_insert`
AFTER INSERT ON `chapters`
WHEN NEW.`access_type` = 'PAID'
  AND NEW.`state` = 'PUBLISHED'
  AND NEW.`published_at` IS NOT NULL
  AND NEW.`free_at` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `content_visibility_overrides` override
     WHERE override.`chapter_id` = NEW.`id`
       AND override.`auto_free_exempt` = 1
  )
  AND EXISTS (
    SELECT 1 FROM `content_visibility_settings` settings
     WHERE settings.`id` = 'active'
       AND settings.`auto_free_after_days` IS NOT NULL
  )
BEGIN
  UPDATE `chapters`
     SET `free_at` = datetime(
       NEW.`published_at`,
       '+' || (SELECT `auto_free_after_days`
                 FROM `content_visibility_settings`
                WHERE `id` = 'active') || ' days'
     )
   WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `content_visibility_schedule_chapter_update`
AFTER UPDATE OF `access_type`, `state`, `published_at`, `free_at` ON `chapters`
WHEN NEW.`access_type` = 'PAID'
  AND NEW.`state` = 'PUBLISHED'
  AND NEW.`published_at` IS NOT NULL
  AND NEW.`free_at` IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `content_visibility_overrides` override
     WHERE override.`chapter_id` = NEW.`id`
       AND override.`auto_free_exempt` = 1
  )
  AND EXISTS (
    SELECT 1 FROM `content_visibility_settings` settings
     WHERE settings.`id` = 'active'
       AND settings.`auto_free_after_days` IS NOT NULL
  )
BEGIN
  UPDATE `chapters`
     SET `free_at` = datetime(
       NEW.`published_at`,
       '+' || (SELECT `auto_free_after_days`
                 FROM `content_visibility_settings`
                WHERE `id` = 'active') || ' days'
     )
   WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `content_visibility_clear_free_schedule`
AFTER UPDATE OF `access_type` ON `chapters`
WHEN NEW.`access_type` = 'FREE' AND NEW.`free_at` IS NOT NULL
BEGIN
  UPDATE `chapters` SET `free_at` = NULL WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `payment_webhook_events_no_delete`
BEFORE DELETE ON `payment_webhook_events`
BEGIN
  SELECT RAISE(ABORT, 'payment_webhook_events_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `order_fulfillments_no_update`
BEFORE UPDATE ON `order_fulfillments`
BEGIN
  SELECT RAISE(ABORT, 'order_fulfillments_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `order_fulfillments_no_delete`
BEFORE DELETE ON `order_fulfillments`
BEGIN
  SELECT RAISE(ABORT, 'order_fulfillments_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `membership_coin_grants_no_update`
BEFORE UPDATE ON `membership_coin_grants`
BEGIN
  SELECT RAISE(ABORT, 'membership_coin_grants_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `membership_coin_grants_no_delete`
BEFORE DELETE ON `membership_coin_grants`
BEGIN
  SELECT RAISE(ABORT, 'membership_coin_grants_immutable');
END;
