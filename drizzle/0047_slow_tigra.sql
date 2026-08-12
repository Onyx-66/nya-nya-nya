ALTER TABLE `payment_checkout_sessions` ADD `provider_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `payment_checkout_sessions` ADD `provider_invoice_id` text;--> statement-breakpoint
ALTER TABLE `payment_checkout_sessions` ADD `provider_subscription_id` text;--> statement-breakpoint
ALTER TABLE `payment_checkout_sessions` ADD `provider_customer_id` text;--> statement-breakpoint
ALTER TABLE `payment_checkout_sessions` ADD `billing_cycle` text DEFAULT 'ONE_TIME' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_checkout_sessions` ADD `user_id_snapshot` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `payment_checkout_sessions`
   SET `billing_cycle` = CASE WHEN `mode` = 'SUBSCRIPTION' THEN 'MONTHLY' ELSE 'ONE_TIME' END,
       `user_id_snapshot` = COALESCE(
         (SELECT `orders`.`user_id` FROM `orders`
           WHERE `orders`.`id` = `payment_checkout_sessions`.`order_id`),
         ''
       );--> statement-breakpoint
CREATE UNIQUE INDEX `payment_checkout_sessions_payment_intent_uidx`
  ON `payment_checkout_sessions` (`provider`,`provider_payment_intent_id`)
  WHERE `provider_payment_intent_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_checkout_sessions_invoice_uidx`
  ON `payment_checkout_sessions` (`provider`,`provider_invoice_id`)
  WHERE `provider_invoice_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_checkout_sessions_subscription_uidx`
  ON `payment_checkout_sessions` (`provider`,`provider_subscription_id`)
  WHERE `provider_subscription_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `payment_checkout_sessions_user_product_idx`
  ON `payment_checkout_sessions` (`user_id_snapshot`,`product_id_snapshot`,`status`);--> statement-breakpoint
CREATE TRIGGER `payment_checkout_sessions_snapshot_insert_guard`
BEFORE INSERT ON `payment_checkout_sessions`
WHEN length(NEW.`user_id_snapshot`) = 0
  OR NOT (
    (NEW.`mode` = 'PAYMENT' AND NEW.`billing_cycle` = 'ONE_TIME')
    OR (NEW.`mode` = 'SUBSCRIPTION' AND NEW.`billing_cycle` IN ('MONTHLY', 'ANNUAL'))
  )
BEGIN
  SELECT RAISE(ABORT, 'payment_checkout_sessions_snapshot_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_checkout_sessions_snapshot_update_guard`
BEFORE UPDATE OF `mode`, `billing_cycle`, `user_id_snapshot` ON `payment_checkout_sessions`
WHEN length(NEW.`user_id_snapshot`) = 0
  OR NOT (
    (NEW.`mode` = 'PAYMENT' AND NEW.`billing_cycle` = 'ONE_TIME')
    OR (NEW.`mode` = 'SUBSCRIPTION' AND NEW.`billing_cycle` IN ('MONTHLY', 'ANNUAL'))
  )
BEGIN
  SELECT RAISE(ABORT, 'payment_checkout_sessions_snapshot_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_checkout_sessions_membership_pending_insert_guard`
BEFORE INSERT ON `payment_checkout_sessions`
WHEN NEW.`mode` = 'SUBSCRIPTION'
  AND NEW.`status` IN ('CREATING', 'OPEN')
  AND EXISTS (
    SELECT 1 FROM `payment_checkout_sessions` existing
     WHERE existing.`user_id_snapshot` = NEW.`user_id_snapshot`
       AND existing.`product_id_snapshot` = NEW.`product_id_snapshot`
       AND existing.`mode` = 'SUBSCRIPTION'
       AND existing.`status` IN ('CREATING', 'OPEN')
  )
BEGIN
  SELECT RAISE(ABORT, 'membership_checkout_already_pending');
END;--> statement-breakpoint
CREATE TRIGGER `payment_checkout_sessions_membership_pending_update_guard`
BEFORE UPDATE OF `status`, `user_id_snapshot`, `product_id_snapshot`, `mode`
ON `payment_checkout_sessions`
WHEN NEW.`mode` = 'SUBSCRIPTION'
  AND NEW.`status` IN ('CREATING', 'OPEN')
  AND EXISTS (
    SELECT 1 FROM `payment_checkout_sessions` existing
     WHERE existing.`id` <> NEW.`id`
       AND existing.`user_id_snapshot` = NEW.`user_id_snapshot`
       AND existing.`product_id_snapshot` = NEW.`product_id_snapshot`
       AND existing.`mode` = 'SUBSCRIPTION'
       AND existing.`status` IN ('CREATING', 'OPEN')
  )
BEGIN
  SELECT RAISE(ABORT, 'membership_checkout_already_pending');
END;--> statement-breakpoint

ALTER TABLE `user_memberships` ADD `provider_latest_invoice_id` text;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `provider_last_event_created` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `provider_last_event_id` text;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `billing_cycle` text DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `renewal_amount_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_memberships` ADD `billing_currency` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `user_memberships`
   SET `renewal_amount_minor` = COALESCE(
         (SELECT session.`amount_minor`
            FROM `order_fulfillments` fulfillment
            JOIN `payment_checkout_sessions` session
              ON session.`order_id` = fulfillment.`order_id`
           WHERE fulfillment.`membership_id` = `user_memberships`.`id`
           LIMIT 1),
         (SELECT product.`price_minor` FROM `products` product
           WHERE product.`id` = `user_memberships`.`product_id`),
         1
       ),
       `billing_currency` = COALESCE(
         (SELECT session.`billing_currency`
            FROM `order_fulfillments` fulfillment
            JOIN `payment_checkout_sessions` session
              ON session.`order_id` = fulfillment.`order_id`
           WHERE fulfillment.`membership_id` = `user_memberships`.`id`
           LIMIT 1),
         (SELECT product.`billing_currency` FROM `products` product
           WHERE product.`id` = `user_memberships`.`product_id`),
         'USD'
       ),
       `billing_cycle` = COALESCE(
         (SELECT session.`billing_cycle`
            FROM `order_fulfillments` fulfillment
            JOIN `payment_checkout_sessions` session
              ON session.`order_id` = fulfillment.`order_id`
           WHERE fulfillment.`membership_id` = `user_memberships`.`id`
           LIMIT 1),
         'MONTHLY'
       );--> statement-breakpoint
CREATE INDEX `user_memberships_user_product_status_idx`
  ON `user_memberships` (`user_id`,`product_id`,`status`);--> statement-breakpoint
CREATE TRIGGER `user_memberships_terms_insert_guard`
BEFORE INSERT ON `user_memberships`
WHEN NEW.`billing_cycle` NOT IN ('MONTHLY', 'ANNUAL')
  OR NEW.`renewal_amount_minor` <= 0
  OR NEW.`billing_currency` NOT GLOB '[A-Z][A-Z][A-Z]'
  OR NEW.`provider_last_event_created` < 0
  OR NOT (
    (NEW.`provider_last_event_created` = 0 AND NEW.`provider_last_event_id` IS NULL)
    OR (NEW.`provider_last_event_created` > 0 AND NEW.`provider_last_event_id` IS NOT NULL)
  )
BEGIN
  SELECT RAISE(ABORT, 'user_memberships_terms_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `user_memberships_terms_update_guard`
BEFORE UPDATE OF `billing_cycle`, `renewal_amount_minor`, `billing_currency`,
  `provider_last_event_created`, `provider_last_event_id`
ON `user_memberships`
WHEN NEW.`billing_cycle` NOT IN ('MONTHLY', 'ANNUAL')
  OR NEW.`renewal_amount_minor` <= 0
  OR NEW.`billing_currency` NOT GLOB '[A-Z][A-Z][A-Z]'
  OR NEW.`provider_last_event_created` < 0
  OR NOT (
    (NEW.`provider_last_event_created` = 0 AND NEW.`provider_last_event_id` IS NULL)
    OR (NEW.`provider_last_event_created` > 0 AND NEW.`provider_last_event_id` IS NOT NULL)
  )
BEGIN
  SELECT RAISE(ABORT, 'user_memberships_terms_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `user_memberships_active_plan_insert_guard`
BEFORE INSERT ON `user_memberships`
WHEN NEW.`product_id` IS NOT NULL
  AND NEW.`status` IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
  AND EXISTS (
    SELECT 1 FROM `user_memberships` existing
     WHERE existing.`user_id` = NEW.`user_id`
       AND existing.`product_id` = NEW.`product_id`
       AND existing.`status` IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
       AND NOT (
         existing.`provider` = NEW.`provider`
         AND existing.`provider_subscription_id` = NEW.`provider_subscription_id`
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'membership_plan_already_active');
END;--> statement-breakpoint
CREATE TRIGGER `user_memberships_active_plan_update_guard`
BEFORE UPDATE OF `user_id`, `product_id`, `status`, `provider`, `provider_subscription_id`
ON `user_memberships`
WHEN NEW.`product_id` IS NOT NULL
  AND NEW.`status` IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
  AND EXISTS (
    SELECT 1 FROM `user_memberships` existing
     WHERE existing.`id` <> NEW.`id`
       AND existing.`user_id` = NEW.`user_id`
       AND existing.`product_id` = NEW.`product_id`
       AND existing.`status` IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
  )
BEGIN
  SELECT RAISE(ABORT, 'membership_plan_already_active');
END;--> statement-breakpoint

DROP TRIGGER `membership_coin_grants_no_update`;--> statement-breakpoint
ALTER TABLE `membership_coin_grants` ADD `provider_invoice_id` text;--> statement-breakpoint
ALTER TABLE `membership_coin_grants` ADD `provider_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `membership_coin_grants` ADD `amount_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `membership_coin_grants` ADD `billing_currency` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `membership_coin_grants` ADD `period_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `membership_coin_grants`
   SET `amount_minor` = COALESCE(
         (SELECT membership.`renewal_amount_minor`
            FROM `user_memberships` membership
           WHERE membership.`id` = `membership_coin_grants`.`membership_id`),
         1
       ),
       `billing_currency` = COALESCE(
         (SELECT membership.`billing_currency`
            FROM `user_memberships` membership
           WHERE membership.`id` = `membership_coin_grants`.`membership_id`),
         'USD'
       ),
       `period_key` = 'legacy:' || `id`;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_coin_grants_period_uidx`
  ON `membership_coin_grants` (`membership_id`,`period_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_coin_grants_invoice_uidx`
  ON `membership_coin_grants` (`provider_invoice_id`)
  WHERE `provider_invoice_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_coin_grants_payment_intent_uidx`
  ON `membership_coin_grants` (`provider_payment_intent_id`)
  WHERE `provider_payment_intent_id` IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `membership_coin_grants_insert_guard`
BEFORE INSERT ON `membership_coin_grants`
WHEN NEW.`amount_minor` <= 0
  OR NEW.`billing_currency` NOT GLOB '[A-Z][A-Z][A-Z]'
  OR length(NEW.`period_key`) = 0
  OR NOT (
    (NEW.`period_start` IS NULL AND NEW.`period_end` IS NULL)
    OR (
      NEW.`period_start` IS NOT NULL AND NEW.`period_end` IS NOT NULL
      AND datetime(NEW.`period_end`) > datetime(NEW.`period_start`)
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'membership_coin_grants_snapshot_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `membership_coin_grants_no_update`
BEFORE UPDATE ON `membership_coin_grants`
BEGIN
  SELECT RAISE(ABORT, 'membership_coin_grants_immutable');
END;--> statement-breakpoint

CREATE TRIGGER `team_payout_requests_reviewer_separation_insert_guard`
BEFORE INSERT ON `team_payout_requests`
WHEN NEW.`reviewed_by_user_id` IS NOT NULL
  AND NEW.`reviewed_by_user_id` = NEW.`requested_by_user_id`
BEGIN
  SELECT RAISE(ABORT, 'team_payout_requests_reviewer_separation_check');
END;--> statement-breakpoint
CREATE TRIGGER `team_payout_requests_reviewer_separation_update_guard`
BEFORE UPDATE OF `reviewed_by_user_id`, `requested_by_user_id`
ON `team_payout_requests`
WHEN NEW.`reviewed_by_user_id` IS NOT NULL
  AND NEW.`reviewed_by_user_id` = NEW.`requested_by_user_id`
BEGIN
  SELECT RAISE(ABORT, 'team_payout_requests_reviewer_separation_check');
END;
