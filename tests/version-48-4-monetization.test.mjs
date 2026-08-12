import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migrationNames() {
  return (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of await migrationNames()) {
    database.exec(
      (await read(`drizzle/${migration}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

function addUser(database, id = "monetization-admin") {
  database
    .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
    .run(id, `${id}@example.test`, "Monetization Admin");
}

function addSeries(database) {
  database.prepare(
    `INSERT INTO series
       (id, slug, title, synopsis, type, status, origin_country,
        original_language, reading_direction, age_rating, access_type,
        rights_status, is_published)
     VALUES
       ('series-money', 'series-money', 'Series Money',
        'A sufficiently detailed synopsis for monetization migration tests.',
        'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
        'FREE', 'TEST_ORIGINAL', 1)`,
  ).run();
}

test("v48.4 installs additive payment records without enabling monetization", async () => {
  const names = await migrationNames();
  assert.ok(names.includes("0045_v48_4_monetization.sql"));
  assert.ok(names.includes("0047_slow_tigra.sql"));
  const database = await migratedDatabase();
  try {
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const table of [
      "payment_checkout_sessions",
      "payment_webhook_events",
      "user_memberships",
      "membership_coin_grants",
      "order_fulfillments",
      "content_visibility_settings",
      "content_visibility_overrides",
    ]) {
      assert.ok(tables.has(table), `${table} should exist`);
    }

    const flags = database
      .prepare(
        `SELECT key, enabled FROM feature_flags
          WHERE key IN (
            'payments', 'onyx_purchases', 'memberships',
            'team_payouts', 'ad_supported_unlocks'
          )
          ORDER BY key`,
      )
      .all();
    assert.equal(flags.length, 5);
    assert.equal(flags.every((flag) => Number(flag.enabled) === 0), true);
    assert.deepEqual(
      { ...database.prepare(
        `SELECT default_access_type AS defaultAccessType,
                default_price_onyx AS defaultPriceOnyx,
                auto_free_after_days AS autoFreeAfterDays
           FROM content_visibility_settings WHERE id = 'active'`,
      ).get() },
      {
        defaultAccessType: "FREE",
        defaultPriceOnyx: 0,
        autoFreeAfterDays: null,
      },
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("membership billing snapshots prevent parallel plans and duplicate period grants", async () => {
  const database = await migratedDatabase();
  try {
    addUser(database, "member-buyer");
    database.prepare(
      `INSERT INTO products
       (id, slug, kind, name, description, price_minor, billing_currency,
        lifecycle_status, metadata_json)
       VALUES ('membership-safe', 'membership-safe', 'MEMBERSHIP',
               'Safe Membership', 'A membership snapshot fixture.', 500, 'USD',
               'ACTIVE', '{"annualPriceMinor":5000,"monthlyCoins":10}')`,
    ).run();
    for (const orderId of ["membership-order-one", "membership-order-two"]) {
      database.prepare(
        `INSERT INTO orders
         (id, user_id, status, total_minor, billing_currency, provider,
          idempotency_key)
         VALUES (?, 'member-buyer', 'PENDING', 500, 'USD', 'STRIPE', ?)`,
      ).run(orderId, `member-buyer:${orderId}`);
    }
    database.prepare(
      `INSERT INTO payment_checkout_sessions
       (id, order_id, mode, billing_cycle, user_id_snapshot,
        product_id_snapshot, product_revision_snapshot, product_kind_snapshot,
        status, amount_minor, billing_currency)
       VALUES ('membership-session-one', 'membership-order-one', 'SUBSCRIPTION',
               'MONTHLY', 'member-buyer', 'membership-safe', 1, 'MEMBERSHIP',
               'OPEN', 500, 'USD')`,
    ).run();
    assert.throws(
      () => database.prepare(
        `INSERT INTO payment_checkout_sessions
         (id, order_id, mode, billing_cycle, user_id_snapshot,
          product_id_snapshot, product_revision_snapshot, product_kind_snapshot,
          status, amount_minor, billing_currency)
         VALUES ('membership-session-two', 'membership-order-two', 'SUBSCRIPTION',
                 'MONTHLY', 'member-buyer', 'membership-safe', 1, 'MEMBERSHIP',
                 'CREATING', 500, 'USD')`,
      ).run(),
      /membership_checkout_already_pending/u,
    );

    database.prepare(
      `INSERT INTO user_memberships
       (id, user_id, product_id, provider_subscription_id,
        provider_last_event_created, provider_last_event_id, billing_cycle,
        renewal_amount_minor, billing_currency, onyx_allowance, status)
       VALUES ('membership-one', 'member-buyer', 'membership-safe', 'sub_one_safe',
               100, 'evt_membership_one', 'MONTHLY', 500, 'USD', 10, 'ACTIVE')`,
    ).run();
    assert.throws(
      () => database.prepare(
        `INSERT INTO user_memberships
         (id, user_id, product_id, provider_subscription_id,
          provider_last_event_created, provider_last_event_id, billing_cycle,
          renewal_amount_minor, billing_currency, onyx_allowance, status)
         VALUES ('membership-two', 'member-buyer', 'membership-safe', 'sub_two_safe',
                 101, 'evt_membership_two', 'MONTHLY', 500, 'USD', 10, 'ACTIVE')`,
      ).run(),
      /membership_plan_already_active/u,
    );

    for (const transactionId of ["grant-transaction-one", "grant-transaction-two"]) {
      database.prepare(
        `INSERT INTO ledger_transactions
         (id, kind, reference_type, reference_id, idempotency_key)
         VALUES (?, 'MEMBERSHIP_GRANT', 'MEMBERSHIP', 'membership-one', ?)`,
      ).run(transactionId, transactionId);
    }
    database.prepare(
      `INSERT INTO membership_coin_grants
       (id, membership_id, provider_event_id, provider_invoice_id,
        ledger_transaction_id, amount_onyx, amount_minor, billing_currency,
        period_key, period_start, period_end)
       VALUES ('grant-one', 'membership-one', 'evt_invoice_one', 'in_one_safe',
               'grant-transaction-one', 10, 500, 'USD', '100:200',
               '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
    ).run();
    assert.throws(
      () => database.prepare(
        `INSERT INTO membership_coin_grants
         (id, membership_id, provider_event_id, provider_invoice_id,
          ledger_transaction_id, amount_onyx, amount_minor, billing_currency,
          period_key, period_start, period_end)
         VALUES ('grant-two', 'membership-one', 'evt_invoice_two', 'in_two_safe',
                 'grant-transaction-two', 10, 500, 'USD', '100:200',
                 '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')`,
      ).run(),
      /membership_coin_grants\.membership_id, membership_coin_grants\.period_key/u,
    );
  } finally {
    database.close();
  }
});

test("content visibility supports real Premium and preserves manual free schedules", async () => {
  const database = await migratedDatabase();
  try {
    addUser(database);
    addSeries(database);
    database
      .prepare(
        `UPDATE content_visibility_settings
            SET auto_free_after_days = 7,
                default_access_type = 'PAID', default_price_onyx = 25
          WHERE id = 'active'`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO chapters
         (id, series_id, slug, chapter_number, state, access_type,
          price_onyx, published_at, free_at)
         VALUES (?, 'series-money', ?, ?, 'PUBLISHED', 'PAID', 25,
                 '2026-01-01 00:00:00', ?)`,
      )
      .run(
        "chapter-manual",
        "chapter-manual",
        "1",
        "2030-01-01 00:00:00",
      );
    database
      .prepare(
        `INSERT INTO chapters
         (id, series_id, slug, chapter_number, state, access_type,
          price_onyx, published_at)
         VALUES ('chapter-scheduled', 'series-money', 'chapter-scheduled', '2',
                 'PUBLISHED', 'PAID', 25, '2026-01-01 00:00:00')`,
      )
      .run();

    assert.equal(
      database
        .prepare("SELECT free_at AS freeAt FROM chapters WHERE id = 'chapter-manual'")
        .get().freeAt,
      "2030-01-01 00:00:00",
    );
    assert.equal(
      database
        .prepare("SELECT free_at AS freeAt FROM chapters WHERE id = 'chapter-scheduled'")
        .get().freeAt,
      "2026-01-08 00:00:00",
    );
    database
      .prepare(
        `INSERT INTO content_visibility_overrides
         (chapter_id, access_type, price_onyx, auto_free_exempt,
          reason, updated_by_user_id)
         VALUES ('chapter-manual', 'PREMIUM', 0, 1,
                 'Membership-only test exception', 'monetization-admin')`,
      )
      .run();
    assert.equal(
      database
        .prepare(
          "SELECT access_type AS accessType FROM content_visibility_overrides WHERE chapter_id = 'chapter-manual'",
        )
        .get().accessType,
      "PREMIUM",
    );
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO content_visibility_overrides
             (chapter_id, access_type, price_onyx, reason, updated_by_user_id)
             VALUES ('chapter-scheduled', 'PREMIUM', 1,
                     'Invalid premium price fixture', 'monetization-admin')`,
          )
          .run(),
      /CHECK constraint failed/u,
    );
  } finally {
    database.close();
  }
});

test("provider identifiers and fulfillment records are unique and immutable", async () => {
  const database = await migratedDatabase();
  try {
    addUser(database, "buyer");
    database.prepare(
      `INSERT INTO products
       (id, slug, kind, name, description, price_minor, billing_currency,
        onyx_base, lifecycle_status)
       VALUES ('coins-100', 'coins-100', 'CURRENCY_PACKAGE', '100 Onyx',
               'An immutable coin package fixture.', 199, 'USD', 100, 'ACTIVE')`,
    ).run();
    database.prepare(
      `INSERT INTO orders
       (id, user_id, status, total_minor, billing_currency, provider,
        provider_reference, idempotency_key)
       VALUES ('order-one', 'buyer', 'PAID', 199, 'USD', 'STRIPE',
               'cs_provider_one', 'buyer:checkout-one')`,
    ).run();
    assert.throws(
      () => database.prepare(
        `INSERT INTO orders
         (id, user_id, status, total_minor, billing_currency, provider,
          provider_reference, idempotency_key)
         VALUES ('order-two', 'buyer', 'PAID', 199, 'USD', 'STRIPE',
                 'cs_provider_one', 'buyer:checkout-two')`,
      ).run(),
      /UNIQUE constraint failed/u,
    );
    database.prepare(
      `INSERT INTO order_items
       (id, order_id, product_id, product_version, title_snapshot,
        unit_price_minor, billing_currency)
       VALUES ('item-one', 'order-one', 'coins-100', 1, '100 Onyx', 199, 'USD')`,
    ).run();
    database.prepare(
      `INSERT INTO order_fulfillments
       (id, order_id, order_item_id, kind, provider_event_id)
       VALUES ('fulfillment-one', 'order-one', 'item-one', 'ONYX', 'evt_one')`,
    ).run();
    assert.throws(
      () => database.prepare(
        "UPDATE order_fulfillments SET kind = 'MEMBERSHIP' WHERE id = 'fulfillment-one'",
      ).run(),
      /order_fulfillments_immutable/u,
    );
    database.prepare(
      `INSERT INTO payment_webhook_events
       (id, event_type, payload_sha256, status)
       VALUES ('evt_one', 'checkout.session.completed', 'abc123', 'PROCESSED')`,
    ).run();
    assert.throws(
      () => database.prepare(
        "DELETE FROM payment_webhook_events WHERE id = 'evt_one'",
      ).run(),
      /payment_webhook_events_immutable/u,
    );
  } finally {
    database.close();
  }
});

test("Stripe checkout and webhook are configured fail-closed and fulfill snapshots only", async () => {
  const [config, stripe, checkout, webhook, fulfillment, flags, adUnlocks, payouts, platform, portal, store] =
    await Promise.all([
      read("lib/server/payments/config.ts"),
      read("lib/server/payments/stripe.ts"),
      read("lib/server/payments/checkout.ts"),
      read("app/api/v1/payments/stripe/webhook/route.ts"),
      read("lib/server/payments/fulfillment.ts"),
      read("lib/server/feature-flags.ts"),
      read("lib/server/ad-unlocks.ts"),
      read("lib/server/payments/team-payouts.ts"),
      read("app/api/v1/admin/platform-governance/route.ts"),
      read("app/api/v1/payments/billing-portal/route.ts"),
      read("app/api/v1/store/products/route.ts"),
    ]);

  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_SITE_URL",
  ]) {
    assert.match(config, new RegExp(key, "u"));
  }
  assert.match(config, /parsed\.protocol !== "https:"/u);
  assert.match(stripe, /crypto\.subtle\.sign/u);
  assert.match(stripe, /constantTimeHexEqual/u);
  assert.match(stripe, /STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300/u);
  assert.ok(stripe.indexOf("JSON.parse(rawBody)") > stripe.indexOf("constantTimeHexEqual(expected"));
  assert.match(checkout, /requireFeature\([\s\S]+"memberships" : "onyx_purchases"/u);
  assert.match(checkout, /fulfillment_onyx_snapshot/u);
  assert.match(checkout, /annualPriceMinor/u);
  assert.match(checkout, /monthlyAllowance \* 12/u);
  assert.match(checkout, /await requireFeature\("payments", db\)/u);
  assert.match(checkout, /MEMBERSHIP_CHECKOUT_ALREADY_PENDING/u);
  assert.match(stripe, /input\.billingCycle === "ANNUAL" \? "year" : "month"/u);
  assert.match(stripe, /payment_intent_data\[metadata\]\[order_id\]/u);
  assert.match(webhook, /const rawBody = await request\.text\(\)/u);
  assert.match(webhook, /claimStripeWebhookEvent/u);
  assert.match(fulfillment, /payment_webhook_events[\s\S]+payload_sha256/u);
  assert.match(fulfillment, /order_fulfillments/u);
  assert.match(fulfillment, /membership_coin_grants/u);
  assert.match(fulfillment, /"subscription_create", "subscription_cycle"/u);
  assert.match(fulfillment, /retrieveStripeSubscription\(subscriptionId\)/u);
  assert.match(fulfillment, /provider_last_event_created = MAX\(provider_last_event_created, \?\)/u);
  assert.match(fulfillment, /AND revision = \?/u);
  assert.match(fulfillment, /stripe:membership:\$\{membership\.id\}:period:/u);
  assert.match(fulfillment, /provider_payment_intent_id/u);
  assert.match(fulfillment, /session\.fulfillment_onyx_snapshot AS fulfillmentOnyx/u);
  const checkoutLookup = fulfillment.slice(
    fulfillment.indexOf("async function checkoutOrder"),
    fulfillment.indexOf("function validateCheckoutCompletion"),
  );
  assert.doesNotMatch(checkoutLookup, /JOIN products/u);
  assert.match(flags, /getAdUnlockReadiness/u);
  assert.match(adUnlocks, /AD_REWARD_PROVIDER_URL_INVALID/u);
  assert.match(adUnlocks, /AD_REWARD_WEBHOOK_SECRET_INVALID/u);
  assert.match(flags, /getTeamPayoutReadiness/u);
  assert.match(payouts, /STRIPE_CONNECT_DISABLED/u);
  assert.match(payouts, /PAYMENT_PROVIDER_NOT_READY/u);
  assert.match(flags, /assertFeatureCanEnable/u);
  assert.match(flags, /case "memberships":[\s\S]+available: true/u);
  assert.match(platform, /assertFeatureCanEnable\(payload\.key, db\)/u);
  assert.match(
    store,
    /featureStates\.memberships\.effective &&\s+featureStates\.payments\.effective/u,
  );
  assert.match(portal, /assertSameOrigin\(request\)/u);
  assert.match(portal, /requireActor\(\)/u);
  assert.match(portal, /provider_customer_id AS providerCustomerId/u);
  assert.match(stripe, /"\/v1\/billing_portal\/sessions"/u);
});

test("Premium visibility, membership access, Onyx refusal, and admin MFA share one contract", async () => {
  const [visibilityRoute, visibility, chapterAccess, catchAll, management] =
    await Promise.all([
      read("app/api/v1/admin/content-visibility/route.ts"),
      read("lib/server/content-visibility.ts"),
      read("lib/server/chapter-access.ts"),
      read("app/api/v1/[...resource]/route.ts"),
      read("lib/server/chapter-management.ts"),
    ]);

  assert.match(
    visibilityRoute,
    /requireAdminCapability\(actor, "content\.chapters\.manage"\)/u,
  );
  assert.doesNotMatch(visibilityRoute, /commerce\.manage/u);
  assert.match(visibilityRoute, /z\.enum\(\["ALL", "FREE", "PAID", "PREMIUM"\]\)/u);
  assert.match(visibilityRoute, /await listContentVisibility\(db/u);
  assert.match(visibility, /effectiveChapterAccessSql/u);
  assert.match(visibility, /COALESCE\(visibility_override\.access_type, c\.access_type\) AS accessType/u);
  assert.match(visibility, /AND free_at IS NULL/u);
  assert.match(visibility, /SELECT 1 WHERE changes\(\) = 1/u);
  assert.match(visibility, /input\.accessType === "FREE" \? "FREE" : "PAID"/u);
  assert.match(chapterAccess, /status IN \('ACTIVE', 'TRIALING'\)/u);
  assert.match(chapterAccess, /paidFeatureStates\.premium_unlocks\.effective/u);
  assert.match(chapterAccess, /paidFeatureStates\.memberships\.effective/u);
  assert.match(chapterAccess, /reason: "MEMBERSHIP_REQUIRED"/u);
  assert.match(catchAll, /if \(access\.accessLevel === "PREMIUM"\)/u);
  assert.match(catchAll, /live_visibility\.access_type = 'PREMIUM'/u);
  assert.match(catchAll, /await requireFeature\("premium_unlocks", env\.DB\)/u);
  assert.match(
    management,
    /requireAdminCapability\(actor, "content\.chapters\.manage"\)/u,
  );
});
