import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    database.exec(
      (await read(`drizzle/${migration}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

function addUserAndPaidOrder(database) {
  database
    .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
    .run("risk-user", "risk-user@example.test", "Risk User");
  database
    .prepare(
      `INSERT INTO orders
       (id, user_id, status, total_minor, billing_currency, provider,
        idempotency_key)
       VALUES ('risk-order', 'risk-user', 'PAID', 500, 'USD', 'STRIPE',
               'risk-order-fixture')`,
    )
    .run();
}

test("refund and dispute events dispatch fail-closed and remain retryable before fulfillment", async () => {
  const [adverse, fulfillment] = await Promise.all([
    read("lib/server/payments/adverse-events.ts"),
    read("lib/server/payments/fulfillment.ts"),
  ]);
  for (const eventType of [
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.closed",
  ]) {
    assert.match(adverse, new RegExp(`"${eventType.replaceAll(".", "\\.")}"`, "u"));
  }
  assert.match(fulfillment, /if \(isStripeAdverseEvent\(event\)\)/u);
  assert.match(fulfillment, /processStripeAdverseEvent\(db, event\)/u);
  assert.match(adverse, /PAYMENT_ADVERSE_SUBJECT_NOT_READY/u);
  assert.match(adverse, /session\.product_kind_snapshot = 'CURRENCY_PACKAGE'/u);
  assert.match(adverse, /fulfillment\.kind = 'ONYX'/u);
  assert.match(adverse, /fulfillment\.ledger_transaction_id IS NOT NULL/u);
  assert.match(adverse, /THEN 'DISPUTED'/u);
  assert.match(adverse, /THEN 'REFUNDED'/u);
  assert.match(adverse, /ELSE 'PAID'/u);
  assert.doesNotMatch(
    adverse,
    /if \(!state\)[\s\S]{0,240}(?:status = 'IGNORED'|return "IGNORED")/u,
  );
});

test("renewal disputes resolve their immutable invoice snapshot by PaymentIntent without an invoice field", async () => {
  const adverse = await read("lib/server/payments/adverse-events.ts");
  assert.match(
    adverse,
    /FROM payment_invoice_snapshots snapshot[\s\S]+snapshot\.provider_payment_intent_id = \?/u,
  );
  assert.match(
    adverse,
    /references\.paymentIntentId !== subject\.providerPaymentIntentId/u,
  );

  const database = await migratedDatabase();
  try {
    addUserAndPaidOrder(database);
    database.prepare(
      `INSERT INTO payment_webhook_events
       (id, event_type, payload_sha256, status, attempt_count)
       VALUES ('evt_invoice_snapshot', 'invoice.paid', 'hash-invoice',
               'PROCESSED', 1)`,
    ).run();
    database.prepare(
      `INSERT INTO user_memberships
       (id, user_id, provider_subscription_id, provider_last_event_created,
        provider_last_event_id, billing_cycle, renewal_amount_minor,
        billing_currency, onyx_allowance, status)
       VALUES ('risk-membership', 'risk-user', 'sub_risk', 100,
               'evt_subscription_risk', 'MONTHLY', 500, 'USD', 10, 'ACTIVE')`,
    ).run();
    database.prepare(
      `INSERT INTO payment_invoice_snapshots
       (id, membership_id, order_id, user_id, provider_event_id,
        provider_invoice_id, provider_payment_intent_id, amount_minor,
        billing_currency, fulfillment_onyx, period_key, period_start, period_end)
       VALUES ('pis_risk', 'risk-membership', 'risk-order', 'risk-user',
               'evt_invoice_snapshot', 'in_risk', 'pi_renewal_risk', 500,
               'USD', 10, '100:200', '2026-01-01T00:00:00.000Z',
               '2026-02-01T00:00:00.000Z')`,
    ).run();
    const snapshot = database.prepare(
      `SELECT provider_invoice_id AS invoiceId, amount_minor AS amountMinor
         FROM payment_invoice_snapshots
        WHERE provider_payment_intent_id = ?`,
    ).get("pi_renewal_risk");
    assert.deepEqual({ ...snapshot }, { invoiceId: "in_risk", amountMinor: 500 });

    database.prepare("UPDATE orders SET status = 'DISPUTED' WHERE id = 'risk-order'").run();
    database.prepare(
      `INSERT INTO payment_webhook_events
       (id, event_type, payload_sha256, status, attempt_count)
       VALUES ('evt_invoice_snapshot_two', 'invoice.paid', 'hash-invoice-two',
               'PROCESSED', 1)`,
    ).run();
    database.prepare(
      `INSERT INTO payment_invoice_snapshots
       (id, membership_id, order_id, user_id, provider_event_id,
        provider_invoice_id, provider_payment_intent_id, amount_minor,
        billing_currency, fulfillment_onyx, period_key, period_start, period_end)
       VALUES ('pis_risk_two', 'risk-membership', 'risk-order', 'risk-user',
               'evt_invoice_snapshot_two', 'in_risk_two', 'pi_renewal_risk_two',
               500, 'USD', 10, '200:300', '2026-02-01T00:00:00.000Z',
               '2026-03-01T00:00:00.000Z')`,
    ).run();
    const laterSnapshot = database.prepare(
      `SELECT snapshot.id
         FROM payment_invoice_snapshots snapshot
         JOIN orders ON orders.id = snapshot.order_id
        WHERE snapshot.provider_payment_intent_id = ?
          AND orders.provider = 'STRIPE'`,
    ).get("pi_renewal_risk_two");
    assert.deepEqual({ ...laterSnapshot }, { id: "pis_risk_two" });
  } finally {
    database.close();
  }
});

test("adverse webhook terminal guard rolls back missing adjustment and succeeds after retry", async () => {
  const database = await migratedDatabase();
  try {
    addUserAndPaidOrder(database);
    database.prepare(
      `INSERT INTO payment_webhook_events
       (id, event_type, payload_sha256, status, attempt_count)
       VALUES ('evt_refund_risk', 'charge.refunded', 'hash-refund',
               'PROCESSING', 1)`,
    ).run();
    database.prepare(
      `INSERT INTO payment_checkout_sessions
       (id, order_id, provider_session_id, provider_payment_intent_id, mode,
        billing_cycle, user_id_snapshot, product_id_snapshot,
        product_revision_snapshot, product_kind_snapshot,
        fulfillment_onyx_snapshot, status, amount_minor, billing_currency)
       VALUES ('pcs_risk', 'risk-order', 'cs_risk', 'pi_risk', 'PAYMENT',
               'ONE_TIME', 'risk-user', 'product-risk', 1,
               'CURRENCY_PACKAGE', 100, 'COMPLETED', 500, 'USD')`,
    ).run();
    database.prepare(
      `INSERT INTO payment_financial_states
       (id, subject_type, subject_id, order_id, user_id, provider_charge_id,
        provider_payment_intent_id, total_minor, currency, fulfillment_onyx)
       VALUES ('pfs_risk', 'ORDER', 'risk-order', 'risk-order', 'risk-user',
               'ch_risk', 'pi_risk', 500, 'USD', 100)`,
    ).run();

    assert.throws(() => {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(
          `UPDATE payment_financial_states
              SET refunded_minor = 5, reversed_onyx = 1,
                  last_provider_event_id = 'evt_refund_risk', revision = 2
            WHERE id = 'pfs_risk'`,
        ).run();
        database.prepare(
          `UPDATE payment_webhook_events SET status = 'PROCESSED'
            WHERE id = 'evt_refund_risk'`,
        ).run();
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }, /payment_adverse_adjustment_required/u);
    assert.deepEqual(
      { ...database.prepare(
        `SELECT revision, refunded_minor AS refundedMinor
           FROM payment_financial_states WHERE id = 'pfs_risk'`,
      ).get() },
      { revision: 1, refundedMinor: 0 },
    );
    assert.equal(
      database.prepare(
        "SELECT status FROM payment_webhook_events WHERE id = 'evt_refund_risk'",
      ).get().status,
      "PROCESSING",
    );

    database.prepare(
      `UPDATE payment_financial_states
          SET last_provider_event_id = 'evt_refund_risk', revision = 2
        WHERE id = 'pfs_risk'`,
    ).run();
    database.prepare(
      `INSERT INTO payment_adverse_adjustments
       (id, state_id, provider_event_id, provider_object_type,
        provider_object_id, kind, at_risk_minor_after, onyx_delta)
       VALUES ('pae_risk', 'pfs_risk', 'evt_refund_risk', 'CHARGE',
               'ch_risk', 'REFUND', 0, 0)`,
    ).run();
    database.prepare(
      `UPDATE payment_webhook_events SET status = 'PROCESSED'
        WHERE id = 'evt_refund_risk'`,
    ).run();
    assert.equal(
      database.prepare(
        "SELECT status FROM payment_webhook_events WHERE id = 'evt_refund_risk'",
      ).get().status,
      "PROCESSED",
    );
  } finally {
    database.close();
  }
});

test("partial reversals round indivisible Onyx upward and effective debt blocks spending", async () => {
  const adverse = await read("lib/server/payments/adverse-events.ts");
  assert.match(
    adverse,
    /refundedMinor \+ Number\(disputeRisk\?\.amount \?\? 0\)/u,
  );
  assert.match(
    adverse,
    /BigInt\(totalOnyx\) \* BigInt\(riskMinor\) \+ denominator - BigInt\(1\)/u,
  );
  const proportional = (totalOnyx, riskMinor, totalMinor) =>
    Number(
      (BigInt(totalOnyx) * BigInt(riskMinor) + BigInt(totalMinor) - BigInt(1)) /
        BigInt(totalMinor),
    );
  assert.equal(proportional(10, 1, 500), 1);
  assert.equal(proportional(10, 499, 500), 10);
  assert.equal(proportional(10, 500, 500), 10);
  const combinedRisk = (totalMinor, refundedMinor, disputedMinor) =>
    Math.min(totalMinor, refundedMinor + disputedMinor);
  assert.equal(combinedRisk(500, 150, 350), 500);
  assert.equal(combinedRisk(500, 150, 500), 500);

  const database = await migratedDatabase();
  try {
    addUserAndPaidOrder(database);
    database.prepare(
      `INSERT INTO payment_webhook_events
       (id, event_type, payload_sha256, status)
       VALUES ('evt_debt', 'charge.refunded', 'hash-debt', 'PROCESSING')`,
    ).run();
    database.prepare(
      `INSERT INTO payment_financial_states
       (id, subject_type, subject_id, order_id, user_id, provider_charge_id,
        provider_payment_intent_id, total_minor, currency, fulfillment_onyx)
       VALUES ('pfs_debt', 'ORDER', 'risk-order', 'risk-order', 'risk-user',
               'ch_debt', 'pi_debt', 500, 'USD', 100)`,
    ).run();
    for (const [id, ownerType, ownerId, accountType] of [
      ["la_risk_available", "USER", "risk-user", "AVAILABLE"],
      ["la_risk_debt", "USER", "risk-user", "PAYMENT_DEBT:pfs_debt"],
      ["la_risk_source", "PLATFORM", "TEST", "SOURCE"],
      ["la_risk_clearing", "PLATFORM", "STRIPE_REVERSALS", "CLEARING"],
    ]) {
      database.prepare(
        `INSERT INTO ledger_accounts
         (id, owner_type, owner_id, currency, account_type)
         VALUES (?, ?, ?, 'ONYX', ?)`,
      ).run(id, ownerType, ownerId, accountType);
    }
    database.prepare(
      `INSERT INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key)
       VALUES ('lt_fund', 'ADMIN_ADJUSTMENT', 'USER', 'risk-user', 'fund-risk')`,
    ).run();
    database.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       VALUES ('le_fund_source', 'lt_fund', 'la_risk_source', -10),
              ('le_fund_user', 'lt_fund', 'la_risk_available', 10)`,
    ).run();
    database.prepare(
      `INSERT INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key)
       VALUES ('lt_debt', 'PAYMENT_REVERSAL', 'PAYMENT_FINANCIAL_STATE',
               'pfs_debt', 'debt-risk')`,
    ).run();
    database.prepare(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
       VALUES ('le_debt_user', 'lt_debt', 'la_risk_debt', -8),
              ('le_debt_platform', 'lt_debt', 'la_risk_clearing', 8)`,
    ).run();
    database.prepare(
      `INSERT INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key)
       VALUES ('lt_spend', 'STORE_PURCHASE', 'USER', 'risk-user', 'spend-risk')`,
    ).run();
    assert.throws(
      () => database.prepare(
        `INSERT INTO ledger_entries (id, transaction_id, account_id, amount)
         VALUES ('le_spend', 'lt_spend', 'la_risk_available', -3)`,
      ).run(),
      /insufficient_balance/u,
    );
  } finally {
    database.close();
  }
});

test("membership access stays suspended until every payment-risk hold is released", async () => {
  const [adverse, chapterAccess, catchAll, migration] = await Promise.all([
    read("lib/server/payments/adverse-events.ts"),
    read("lib/server/chapter-access.ts"),
    read("app/api/v1/[...resource]/route.ts"),
    read("drizzle/0048_strong_leo.sql"),
  ]);
  assert.match(adverse, /membership_risk_active/u);
  assert.match(chapterAccess, /financial_state\.membership_risk_active = 1/u);
  assert.match(catchAll, /financial_state\.membership_risk_active = 1/u);
  assert.match(migration, /payment_adverse_event_requires_adjustment/u);
  assert.match(migration, /payment_adverse_adjustment_required/u);
  assert.doesNotMatch(`${adverse}\n${migration}`, /guard_\$\{event\.id\}|dummy/u);

  const database = await migratedDatabase();
  try {
    addUserAndPaidOrder(database);
    database.prepare(
      `INSERT INTO user_memberships
       (id, user_id, provider_subscription_id, provider_last_event_created,
        provider_last_event_id, billing_cycle, renewal_amount_minor,
        billing_currency, onyx_allowance, status)
       VALUES ('membership-held', 'risk-user', 'sub_held', 100,
               'evt_subscription_held', 'MONTHLY', 500, 'USD', 0, 'ACTIVE')`,
    ).run();
    for (const suffix of ["a", "b"]) {
      database.prepare(
        `INSERT INTO payment_webhook_events
         (id, event_type, payload_sha256, status)
         VALUES (?, 'charge.dispute.created', ?, 'PROCESSING')`,
      ).run(`evt_hold_open_${suffix}`, `hash-hold-open-${suffix}`);
      database.prepare(
        `INSERT INTO payment_webhook_events
         (id, event_type, payload_sha256, status)
         VALUES (?, 'charge.dispute.closed', ?, 'PROCESSING')`,
      ).run(`evt_hold_${suffix}`, `hash-hold-${suffix}`);
      database.prepare(
        `INSERT INTO payment_financial_states
         (id, subject_type, subject_id, order_id, user_id, membership_id,
          provider_charge_id, provider_invoice_id, total_minor, currency,
          fulfillment_onyx)
         VALUES (?, 'INVOICE', ?, 'risk-order', 'risk-user',
                 'membership-held', ?, ?, 500, 'USD', 0)`,
      ).run(
        `pfs_hold_${suffix}`,
        `pis_hold_${suffix}`,
        `ch_hold_${suffix}`,
        `in_hold_${suffix}`,
      );
      database.prepare(
        `UPDATE payment_financial_states
            SET membership_risk_active = 1,
                last_provider_event_id = ?, revision = 2
          WHERE id = ?`,
      ).run(`evt_hold_open_${suffix}`, `pfs_hold_${suffix}`);
    }
    const activeMembership = () => database.prepare(
      `SELECT membership.id FROM user_memberships membership
        WHERE membership.user_id = 'risk-user'
          AND membership.status IN ('ACTIVE', 'TRIALING')
          AND NOT EXISTS (
            SELECT 1 FROM payment_financial_states financial_state
             WHERE financial_state.membership_id = membership.id
               AND financial_state.membership_risk_active = 1
          )`,
    ).get();
    assert.equal(activeMembership(), undefined);
    database.prepare(
      `UPDATE payment_financial_states
          SET membership_risk_active = 0,
              last_provider_event_id = 'evt_hold_a', revision = 3
        WHERE id = 'pfs_hold_a'`,
    ).run();
    assert.equal(activeMembership(), undefined);
    database.prepare(
      `UPDATE payment_financial_states
          SET membership_risk_active = 0,
              last_provider_event_id = 'evt_hold_b', revision = 3
        WHERE id = 'pfs_hold_b'`,
    ).run();
    assert.deepEqual({ ...activeMembership() }, { id: "membership-held" });
  } finally {
    database.close();
  }
});
