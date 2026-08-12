CREATE TABLE `payment_adverse_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`state_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`provider_object_type` text NOT NULL,
	`provider_object_id` text NOT NULL,
	`kind` text NOT NULL,
	`at_risk_minor_after` integer NOT NULL,
	`onyx_delta` integer NOT NULL,
	`ledger_transaction_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`state_id`) REFERENCES `payment_financial_states`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_event_id`) REFERENCES `payment_webhook_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ledger_transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_adverse_adjustments_object_type_check" CHECK("payment_adverse_adjustments"."provider_object_type" IN ('CHARGE', 'DISPUTE')),
	CONSTRAINT "payment_adverse_adjustments_kind_check" CHECK("payment_adverse_adjustments"."kind" IN ('REFUND', 'DISPUTE_OPEN', 'DISPUTE_WON', 'DISPUTE_LOST', 'DISPUTE_UPDATE')),
	CONSTRAINT "payment_adverse_adjustments_risk_check" CHECK("payment_adverse_adjustments"."at_risk_minor_after" >= 0),
	CONSTRAINT "payment_adverse_adjustments_ledger_check" CHECK(("payment_adverse_adjustments"."onyx_delta" = 0 AND "payment_adverse_adjustments"."ledger_transaction_id" IS NULL) OR ("payment_adverse_adjustments"."onyx_delta" <> 0 AND "payment_adverse_adjustments"."ledger_transaction_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_adverse_adjustments_event_uidx` ON `payment_adverse_adjustments` (`provider_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_adverse_adjustments_ledger_uidx` ON `payment_adverse_adjustments` (`ledger_transaction_id`) WHERE "payment_adverse_adjustments"."ledger_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `payment_adverse_adjustments_state_idx` ON `payment_adverse_adjustments` (`state_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_adverse_adjustments_kind_idx` ON `payment_adverse_adjustments` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`state_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`provider_event_created` integer NOT NULL,
	`provider_event_id` text NOT NULL,
	`reason` text DEFAULT 'unknown' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`state_id`) REFERENCES `payment_financial_states`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_event_id`) REFERENCES `payment_webhook_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_disputes_amount_check" CHECK("payment_disputes"."amount_minor" > 0),
	CONSTRAINT "payment_disputes_currency_check" CHECK("payment_disputes"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "payment_disputes_status_check" CHECK("payment_disputes"."status" IN ('OPEN', 'WON', 'LOST')),
	CONSTRAINT "payment_disputes_event_order_check" CHECK("payment_disputes"."provider_event_created" >= 0),
	CONSTRAINT "payment_disputes_revision_check" CHECK("payment_disputes"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `payment_disputes_state_status_idx` ON `payment_disputes` (`state_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_disputes_status_updated_idx` ON `payment_disputes` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `payment_financial_states` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_id` text,
	`provider` text DEFAULT 'STRIPE' NOT NULL,
	`provider_charge_id` text NOT NULL,
	`provider_payment_intent_id` text,
	`provider_invoice_id` text,
	`total_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`fulfillment_onyx` integer NOT NULL,
	`refunded_minor` integer DEFAULT 0 NOT NULL,
	`reversed_onyx` integer DEFAULT 0 NOT NULL,
	`membership_status_before_risk` text,
	`membership_provider_event_created_at_risk` integer,
	`membership_risk_active` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`last_provider_event_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`membership_id`) REFERENCES `user_memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`last_provider_event_id`) REFERENCES `payment_webhook_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_financial_states_subject_check" CHECK("payment_financial_states"."subject_type" IN ('ORDER', 'INVOICE')),
	CONSTRAINT "payment_financial_states_provider_check" CHECK("payment_financial_states"."provider" = 'STRIPE'),
	CONSTRAINT "payment_financial_states_reference_check" CHECK("payment_financial_states"."provider_payment_intent_id" IS NOT NULL OR "payment_financial_states"."provider_invoice_id" IS NOT NULL),
	CONSTRAINT "payment_financial_states_amount_check" CHECK("payment_financial_states"."total_minor" > 0 AND "payment_financial_states"."refunded_minor" BETWEEN 0 AND "payment_financial_states"."total_minor"),
	CONSTRAINT "payment_financial_states_onyx_check" CHECK("payment_financial_states"."fulfillment_onyx" >= 0 AND "payment_financial_states"."reversed_onyx" BETWEEN 0 AND "payment_financial_states"."fulfillment_onyx"),
	CONSTRAINT "payment_financial_states_membership_risk_check" CHECK(("payment_financial_states"."membership_id" IS NULL AND "payment_financial_states"."membership_status_before_risk" IS NULL AND "payment_financial_states"."membership_provider_event_created_at_risk" IS NULL AND "payment_financial_states"."membership_risk_active" = 0)
        OR ("payment_financial_states"."membership_id" IS NOT NULL AND ("payment_financial_states"."membership_status_before_risk" IS NULL OR "payment_financial_states"."membership_status_before_risk" IN ('ACTIVE', 'TRIALING')) AND ("payment_financial_states"."membership_provider_event_created_at_risk" IS NULL OR "payment_financial_states"."membership_provider_event_created_at_risk" >= 0))),
	CONSTRAINT "payment_financial_states_currency_check" CHECK("payment_financial_states"."currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "payment_financial_states_revision_check" CHECK("payment_financial_states"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_financial_states_subject_uidx` ON `payment_financial_states` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_financial_states_charge_uidx` ON `payment_financial_states` (`provider`,`provider_charge_id`);--> statement-breakpoint
CREATE INDEX `payment_financial_states_user_idx` ON `payment_financial_states` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `payment_financial_states_order_idx` ON `payment_financial_states` (`order_id`);--> statement-breakpoint
CREATE INDEX `payment_financial_states_risk_idx` ON `payment_financial_states` (`refunded_minor`,`reversed_onyx`,`updated_at`);--> statement-breakpoint
CREATE TABLE `payment_invoice_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`order_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`provider_invoice_id` text NOT NULL,
	`provider_payment_intent_id` text,
	`amount_minor` integer NOT NULL,
	`billing_currency` text NOT NULL,
	`fulfillment_onyx` integer DEFAULT 0 NOT NULL,
	`period_key` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `user_memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_event_id`) REFERENCES `payment_webhook_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payment_invoice_snapshots_amount_check" CHECK("payment_invoice_snapshots"."amount_minor" > 0 AND "payment_invoice_snapshots"."fulfillment_onyx" >= 0),
	CONSTRAINT "payment_invoice_snapshots_currency_check" CHECK("payment_invoice_snapshots"."billing_currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "payment_invoice_snapshots_period_check" CHECK(length("payment_invoice_snapshots"."period_key") > 0 AND datetime("payment_invoice_snapshots"."period_end") > datetime("payment_invoice_snapshots"."period_start"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_invoice_snapshots_invoice_uidx` ON `payment_invoice_snapshots` (`provider_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_invoice_snapshots_payment_intent_uidx` ON `payment_invoice_snapshots` (`provider_payment_intent_id`) WHERE "payment_invoice_snapshots"."provider_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_invoice_snapshots_period_uidx` ON `payment_invoice_snapshots` (`membership_id`,`period_key`);--> statement-breakpoint
CREATE INDEX `payment_invoice_snapshots_membership_idx` ON `payment_invoice_snapshots` (`membership_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_invoice_snapshots_order_idx` ON `payment_invoice_snapshots` (`order_id`,`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `payment_invoice_snapshots`
(`id`, `membership_id`, `order_id`, `user_id`, `provider_event_id`,
 `provider_invoice_id`, `provider_payment_intent_id`, `amount_minor`,
 `billing_currency`, `fulfillment_onyx`, `period_key`, `period_start`,
 `period_end`)
SELECT 'pis_' || grant.provider_invoice_id,
       grant.membership_id,
       fulfillment.order_id,
       membership.user_id,
       grant.provider_event_id,
       grant.provider_invoice_id,
       grant.provider_payment_intent_id,
       grant.amount_minor,
       grant.billing_currency,
       grant.amount_onyx,
       grant.period_key,
       grant.period_start,
       grant.period_end
  FROM `membership_coin_grants` grant
  JOIN `user_memberships` membership ON membership.id = grant.membership_id
  JOIN `order_fulfillments` fulfillment
    ON fulfillment.membership_id = grant.membership_id
   AND fulfillment.kind = 'MEMBERSHIP'
  JOIN `payment_webhook_events` event ON event.id = grant.provider_event_id
 WHERE grant.provider_invoice_id IS NOT NULL
   AND grant.amount_minor > 0
   AND grant.amount_onyx > 0
   AND grant.billing_currency GLOB '[A-Z][A-Z][A-Z]'
   AND length(grant.period_key) > 0
   AND grant.period_start IS NOT NULL
   AND grant.period_end IS NOT NULL
   AND datetime(grant.period_end) > datetime(grant.period_start);--> statement-breakpoint
CREATE TRIGGER `payment_invoice_snapshots_no_update`
BEFORE UPDATE ON `payment_invoice_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'payment_invoice_snapshot_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `payment_invoice_snapshots_no_delete`
BEFORE DELETE ON `payment_invoice_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'payment_invoice_snapshot_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `payment_financial_states_guard_update`
BEFORE UPDATE ON `payment_financial_states`
WHEN
  NEW.revision <> OLD.revision + 1
  OR NEW.id <> OLD.id
  OR NEW.subject_type <> OLD.subject_type
  OR NEW.subject_id <> OLD.subject_id
  OR NEW.order_id <> OLD.order_id
  OR NEW.user_id <> OLD.user_id
  OR NEW.membership_id IS NOT OLD.membership_id
  OR NEW.provider <> OLD.provider
  OR NEW.provider_charge_id <> OLD.provider_charge_id
  OR NEW.provider_payment_intent_id IS NOT OLD.provider_payment_intent_id
  OR NEW.provider_invoice_id IS NOT OLD.provider_invoice_id
  OR NEW.total_minor <> OLD.total_minor
  OR NEW.currency <> OLD.currency
  OR NEW.fulfillment_onyx <> OLD.fulfillment_onyx
  OR NEW.refunded_minor < OLD.refunded_minor
  OR (NEW.membership_status_before_risk IS NOT OLD.membership_status_before_risk
      AND NOT (OLD.membership_risk_active = 0 AND NEW.membership_risk_active = 1))
  OR (NEW.membership_provider_event_created_at_risk IS NOT OLD.membership_provider_event_created_at_risk
      AND NOT (OLD.membership_risk_active = 0 AND NEW.membership_risk_active = 1))
  OR NEW.membership_risk_active NOT IN (0, 1)
  OR NEW.last_provider_event_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `payment_webhook_events` event
     WHERE event.id = NEW.last_provider_event_id
       AND event.provider = 'STRIPE'
       AND event.status = 'PROCESSING'
       AND event.event_type IN (
         'charge.refunded',
         'charge.dispute.created',
         'charge.dispute.closed'
       )
  )
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'payment_financial_state_transition_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_financial_states_guard_insert`
BEFORE INSERT ON `payment_financial_states`
WHEN
  NEW.membership_risk_active NOT IN (0, 1)
  OR NEW.membership_risk_active <> 0
BEGIN
  SELECT RAISE(ABORT, 'payment_financial_state_membership_risk_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_financial_states_no_delete`
BEFORE DELETE ON `payment_financial_states`
BEGIN
  SELECT RAISE(ABORT, 'payment_financial_state_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `payment_disputes_guard_update`
BEFORE UPDATE ON `payment_disputes`
WHEN
  NEW.revision <> OLD.revision + 1
  OR NEW.id <> OLD.id
  OR NEW.state_id <> OLD.state_id
  OR NEW.amount_minor <> OLD.amount_minor
  OR NEW.currency <> OLD.currency
  OR NEW.provider_event_created < OLD.provider_event_created
  OR (OLD.status IN ('WON', 'LOST') AND NEW.status <> OLD.status)
  OR NOT EXISTS (
    SELECT 1 FROM `payment_webhook_events` event
     WHERE event.id = NEW.provider_event_id
       AND event.provider = 'STRIPE'
       AND event.status = 'PROCESSING'
       AND event.event_type IN ('charge.dispute.created', 'charge.dispute.closed')
  )
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'payment_dispute_transition_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_disputes_guard_insert`
BEFORE INSERT ON `payment_disputes`
WHEN NOT EXISTS (
  SELECT 1
    FROM `payment_financial_states` financial_state
    JOIN `payment_webhook_events` event ON event.id = NEW.provider_event_id
   WHERE financial_state.id = NEW.state_id
     AND NEW.amount_minor <= financial_state.total_minor
     AND NEW.currency = financial_state.currency
     AND event.provider = 'STRIPE'
     AND event.status = 'PROCESSING'
     AND event.event_type IN ('charge.dispute.created', 'charge.dispute.closed')
)
BEGIN
  SELECT RAISE(ABORT, 'payment_dispute_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_disputes_no_delete`
BEFORE DELETE ON `payment_disputes`
BEGIN
  SELECT RAISE(ABORT, 'payment_dispute_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `payment_adverse_adjustments_no_update`
BEFORE UPDATE ON `payment_adverse_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'payment_adverse_adjustment_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `payment_adverse_adjustments_no_delete`
BEFORE DELETE ON `payment_adverse_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'payment_adverse_adjustment_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `payment_adverse_adjustments_guard_insert`
BEFORE INSERT ON `payment_adverse_adjustments`
WHEN NOT EXISTS (
  SELECT 1
    FROM `payment_financial_states` financial_state
    JOIN `payment_webhook_events` event
      ON event.id = NEW.provider_event_id
   WHERE financial_state.id = NEW.state_id
     AND financial_state.last_provider_event_id = NEW.provider_event_id
     AND NEW.at_risk_minor_after <= financial_state.total_minor
     AND event.provider = 'STRIPE'
     AND event.status = 'PROCESSING'
     AND event.event_type IN (
       'charge.refunded',
       'charge.dispute.created',
       'charge.dispute.closed'
     )
     AND (
       (NEW.provider_object_type = 'CHARGE' AND NEW.kind = 'REFUND')
       OR (
         NEW.provider_object_type = 'DISPUTE'
         AND NEW.kind IN (
           'DISPUTE_OPEN',
           'DISPUTE_WON',
           'DISPUTE_LOST',
           'DISPUTE_UPDATE'
         )
       )
     )
     AND (
       COALESCE((
         SELECT SUM(existing.onyx_delta)
           FROM `payment_adverse_adjustments` existing
          WHERE existing.state_id = financial_state.id
       ), 0) + NEW.onyx_delta
     ) = financial_state.reversed_onyx
)
BEGIN
  SELECT RAISE(ABORT, 'payment_adverse_adjustment_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_adverse_event_requires_adjustment`
BEFORE UPDATE OF `status` ON `payment_webhook_events`
WHEN
  NEW.status = 'PROCESSED'
  AND NEW.event_type IN (
    'charge.refunded',
    'charge.dispute.created',
    'charge.dispute.closed'
  )
  AND NOT EXISTS (
    SELECT 1 FROM `payment_adverse_adjustments` adjustment
     WHERE adjustment.provider_event_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'payment_adverse_adjustment_required');
END;--> statement-breakpoint
CREATE TRIGGER `payment_adverse_event_cannot_ignore`
BEFORE UPDATE OF `status` ON `payment_webhook_events`
WHEN
  NEW.status = 'IGNORED'
  AND NEW.event_type IN (
    'charge.refunded',
    'charge.dispute.created',
    'charge.dispute.closed'
  )
BEGIN
  SELECT RAISE(ABORT, 'payment_adverse_event_cannot_ignore');
END;--> statement-breakpoint
CREATE TRIGGER `payment_debt_account_shape`
BEFORE INSERT ON `ledger_accounts`
WHEN NEW.account_type LIKE 'PAYMENT_DEBT:%'
 AND NOT (
   NEW.owner_type = 'USER'
   AND NEW.currency = 'ONYX'
   AND EXISTS (
     SELECT 1 FROM `payment_financial_states` financial_state
      WHERE financial_state.id = substr(
        NEW.account_type,
        length('PAYMENT_DEBT:') + 1
      )
        AND financial_state.user_id = NEW.owner_id
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'payment_debt_account_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `payment_debt_entries_authorized`
BEFORE INSERT ON `ledger_entries`
WHEN EXISTS (
  SELECT 1 FROM `ledger_accounts` account
   WHERE account.id = NEW.account_id
     AND account.owner_type = 'USER'
     AND account.currency = 'ONYX'
     AND account.account_type LIKE 'PAYMENT_DEBT:%'
)
AND NOT EXISTS (
  SELECT 1
    FROM `ledger_transactions` transaction_row
    JOIN `ledger_accounts` account ON account.id = NEW.account_id
    JOIN `payment_financial_states` financial_state
      ON financial_state.id = transaction_row.reference_id
   WHERE transaction_row.id = NEW.transaction_id
     AND transaction_row.reference_type = 'PAYMENT_FINANCIAL_STATE'
     AND account.account_type = 'PAYMENT_DEBT:' || transaction_row.reference_id
     AND account.owner_type = 'USER'
     AND account.owner_id = financial_state.user_id
     AND account.currency = 'ONYX'
     AND (
       (transaction_row.kind = 'PAYMENT_REVERSAL' AND NEW.amount < 0)
       OR (transaction_row.kind = 'PAYMENT_REVERSAL_RELEASE' AND NEW.amount > 0)
     )
)
BEGIN
  SELECT RAISE(ABORT, 'payment_debt_entry_unauthorized');
END;--> statement-breakpoint
CREATE TRIGGER `payment_debt_never_positive`
BEFORE INSERT ON `ledger_entries`
WHEN EXISTS (
  SELECT 1 FROM `ledger_accounts` account
   WHERE account.id = NEW.account_id
     AND account.owner_type = 'USER'
     AND account.currency = 'ONYX'
     AND account.account_type LIKE 'PAYMENT_DEBT:%'
)
AND (
  COALESCE(
    (SELECT SUM(entry.amount) FROM `ledger_entries` entry
      WHERE entry.account_id = NEW.account_id),
    0
  ) + NEW.amount
) > 0
BEGIN
  SELECT RAISE(ABORT, 'payment_debt_credit_exceeds_balance');
END;--> statement-breakpoint
DROP TRIGGER IF EXISTS `ledger_no_negative_user_balance`;--> statement-breakpoint
CREATE TRIGGER `ledger_no_negative_user_balance`
BEFORE INSERT ON `ledger_entries`
WHEN
  NEW.amount < 0
  AND EXISTS (
    SELECT 1
      FROM `ledger_accounts` target
     WHERE target.id = NEW.account_id
       AND target.owner_type = 'USER'
       AND target.account_type = 'AVAILABLE'
  )
  AND (
    COALESCE((
      SELECT SUM(entry.amount)
        FROM `ledger_accounts` target
        JOIN `ledger_accounts` account
          ON account.owner_type = target.owner_type
         AND account.owner_id = target.owner_id
         AND account.currency = target.currency
        LEFT JOIN `ledger_entries` entry ON entry.account_id = account.id
       WHERE target.id = NEW.account_id
         AND (
           account.account_type = 'AVAILABLE'
           OR account.account_type LIKE 'PAYMENT_DEBT:%'
         )
    ), 0) + NEW.amount
  ) < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_balance');
END;
