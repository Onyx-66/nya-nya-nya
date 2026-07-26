import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const names = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const name of names) {
    const migration = await read(`drizzle/${name}`);
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

test("Version 28 migration adds durable rewards, encrypted Gifts, and Roulette state", async () => {
  const database = await migratedDatabase();
  const tables = new Set(
    database
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all()
      .map((row) => row.name),
  );
  for (const name of [
    "reward_settings",
    "chapter_reward_sessions",
    "chapter_reward_claims",
    "community_reward_claims",
    "gift_cards",
    "team_support_receipts",
    "roulette_state",
    "roulette_spins",
  ]) {
    assert.ok(tables.has(name), `${name} must exist`);
  }

  const giftColumns = new Set(
    database.prepare("PRAGMA table_info(gift_cards)").all().map((row) => row.name),
  );
  assert.ok(giftColumns.has("code_hash"));
  assert.ok(giftColumns.has("code_ciphertext"));
  assert.ok(giftColumns.has("code_nonce"));
  assert.equal(giftColumns.has("code"), false, "Gift codes must not be stored in plaintext");

  const invalidForeignKeys = database.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(invalidForeignKeys, []);
  database.close();
});

test("legacy Store prices backfill to Onyx and currency checks reject invalid data", async () => {
  const database = await migratedDatabase();
  const currencies = database
    .prepare("SELECT DISTINCT price_currency AS currency FROM store_items")
    .all()
    .map((row) => row.currency);
  assert.ok(currencies.every((currency) => currency === "ONYX"));
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE store_items SET price_currency = 'GEMS'
            WHERE id = (SELECT id FROM store_items LIMIT 1)`,
        )
        .run(),
    /store_items_currency_check/u,
  );
  database.close();
});

test("ledger guards are currency-neutral, immutable, and reject mixed-currency transactions", async () => {
  const database = await migratedDatabase();
  database.exec(`
    INSERT INTO users (id, email, display_name)
    VALUES ('usr_v28', 'v28@example.com', 'V28 Reader');
    INSERT INTO ledger_accounts
      (id, owner_type, owner_id, currency, account_type)
    VALUES
      ('la_v28_onyx', 'USER', 'usr_v28', 'ONYX', 'AVAILABLE'),
      ('la_v28_shards', 'USER', 'usr_v28', 'SHARDS', 'AVAILABLE'),
      ('la_v28_source', 'PLATFORM', 'SOURCE', 'ONYX', 'SOURCE');
    INSERT INTO ledger_transactions
      (id, kind, reference_type, reference_id, idempotency_key)
    VALUES ('tx_v28', 'TEST', 'TEST', 'v28', 'v28-ledger-test');
    INSERT INTO ledger_entries
      (id, transaction_id, account_id, amount)
    VALUES ('entry_v28_source', 'tx_v28', 'la_v28_source', -10);
  `);
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           VALUES ('entry_v28_mixed', 'tx_v28', 'la_v28_shards', 10)`,
        )
        .run(),
    /ledger_currency_mismatch/u,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           VALUES ('entry_v28_negative', 'tx_v28', 'la_v28_onyx', -1)`,
        )
        .run(),
    /insufficient_balance/u,
  );
  assert.throws(
    () =>
      database
        .prepare(
          "UPDATE ledger_entries SET amount = -9 WHERE id = 'entry_v28_source'",
        )
        .run(),
    /ledger_entries_immutable/u,
  );
  database.close();
});

test("Gift issue and redemption contracts use escrow, encryption, idempotency, and one-time redemption", async () => {
  const [route, codes, schema] = await Promise.all([
    read("app/api/v1/gifts/route.ts"),
    read("lib/gift-codes.ts"),
    read("db/schema.ts"),
  ]);
  assert.match(codes, /const GIFT_CODE_LENGTH = 18/u);
  assert.match(codes, /crypto\.getRandomValues/u);
  assert.match(codes, /AES-GCM/u);
  assert.match(codes, /HMAC/u);
  assert.match(route, /NYASCANS_GIFT_ESCROW/u);
  assert.match(route, /gift:issue:/u);
  assert.match(route, /gift:redeem:/u);
  assert.match(
    route,
    /WHERE id = \?\s+AND status = 'ACTIVE'[\s\S]+redeemed_transaction_id IS NULL/u,
  );
  assert.match(schema, /gift_cards_purchase_idempotency_uidx/u);
  assert.match(schema, /gift_cards_code_hash_uidx/u);
  assert.doesNotMatch(schema, /\bcode: text\("code"\)/u);
});

test("Shards rewards and Roulette are server-authoritative and replay-safe", async () => {
  const [rewards, roulette, settings, migration] = await Promise.all([
    read("app/api/v1/rewards/route.ts"),
    read("app/api/v1/roulette/route.ts"),
    read("lib/reward-settings.ts"),
    read("drizzle/0016_parched_zombie.sql"),
  ]);
  assert.match(settings, /chapterMinimumSeconds: 210/u);
  assert.match(rewards, /Math\.min\(\s*30,/u);
  assert.match(rewards, /progress_basis_points AS progressBasisPoints/u);
  assert.match(rewards, /progress\?\.progressBasisPoints \?\? 0\) < 9_200/u);
  assert.match(rewards, /reward:chapter:\$\{userId\}:\$\{chapterId\}/u);
  assert.match(rewards, /reward:comment:\$\{userId\}:\$\{commentId\}/u);
  assert.match(rewards, /reward:upvote:\$\{sourceId\}/u);
  assert.match(roulette, /crypto\.getRandomValues/u);
  assert.match(
    roulette,
    /datetime\(roulette_state\.next_eligible_at\) <= datetime\('now'\)/u,
  );
  assert.match(roulette, /roulette_spins[\s\S]+idempotency_key/u);
  assert.match(migration, /roulette_spins_idempotency_uidx/u);
});

test("Roulette counter reservation cannot advance for a replayed request key", async () => {
  const [database, roulette] = await Promise.all([
    migratedDatabase(),
    read("app/api/v1/roulette/route.ts"),
  ]);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    INSERT INTO users (id, email, display_name)
    VALUES ('usr_v34_retry', 'v34-retry@example.com', 'Retry Reader');
    INSERT INTO ledger_transactions
      (id, kind, reference_type, reference_id, idempotency_key)
    VALUES (
      'tx_v34_retry_reward',
      'ROULETTE_REWARD',
      'ROULETTE_SPIN',
      'spin_v34_first',
      'roulette:usr_v34_retry:request-key-v34'
    );
    INSERT INTO roulette_spins
      (id, user_id, idempotency_key, reward_key, reward_type, reward_amount,
       spin_mode, transaction_id, next_eligible_at, global_spin_number)
    VALUES (
      'spin_v34_first',
      'usr_v34_retry',
      'request-key-v34',
      'reward_v34',
      'SHARDS',
      10,
      'PAID',
      'tx_v34_retry_reward',
      '1970-01-01T00:00:00.000Z',
      1
    );
    INSERT INTO roulette_pool_counters
      (pool_key, total_spins, last_spin_id)
    VALUES ('PAID', 1, 'spin_v34_first');
  `);

  const reserve = database.prepare(
    `UPDATE roulette_pool_counters
        SET total_spins = total_spins + 1,
            last_spin_id = ?
      WHERE pool_key = 'PAID'
        AND total_spins = 1
        AND NOT EXISTS (
          SELECT 1 FROM roulette_spins prior_spin
           WHERE prior_spin.user_id = ?
             AND prior_spin.idempotency_key = ?
        )`,
  );
  assert.equal(
    reserve.run(
      "spin_v34_replay",
      "usr_v34_retry",
      "request-key-v34",
    ).changes,
    0,
  );
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT total_spins AS totalSpins, last_spin_id AS lastSpinId
             FROM roulette_pool_counters
            WHERE pool_key = 'PAID'`,
        )
        .get(),
    },
    { totalSpins: 1, lastSpinId: "spin_v34_first" },
  );
  assert.equal(
    reserve.run(
      "spin_v34_second",
      "usr_v34_retry",
      "different-request-key-v34",
    ).changes,
    1,
  );

  assert.equal(
    (
      roulette.match(
        /SELECT 1 FROM roulette_spins prior_spin[\s\S]*?prior_spin\.idempotency_key = \?/gu,
      ) ?? []
    ).length,
    3,
  );
  assert.match(
    roulette,
    /if \(replayedSpin\) \{[\s\S]*?replayedSpin\.spinMode !== payload\.mode[\s\S]*?IDEMPOTENCY_KEY_REUSED/u,
  );
  database.close();
});

test("Version 28 UI keeps mobile editorial intact while adding the requested desktop and economy surfaces", async () => {
  const [app, api, discovery, giftStore, roulette, rewardAdmin, styles] =
    await Promise.all([
      read("components/nyascans/NyaScansApp.tsx"),
      read("app/api/v1/[...resource]/route.ts"),
      read("components/nyascans/PublicDiscoverySections.tsx"),
      read("components/nyascans/GiftStorePanel.tsx"),
      read("components/nyascans/RouletteView.tsx"),
      read("components/nyascans/admin/RewardSettingsPanel.tsx"),
      read("app/globals.css"),
    ]);
  assert.match(app, /alternativeTitles: string\[\]/u);
  assert.match(api, /GROUP_CONCAT\(sa\.alias, '\|\|'\)/u);
  assert.match(app, /editors-pick-desktop-detail/u);
  assert.doesNotMatch(app, /className="notification-cta"/u);
  assert.match(app, /href="\/roulette"[\s\S]+Roulette/u);
  assert.match(app, /<GiftStorePanel/u);
  assert.match(app, /> Gift Cards/u);
  assert.doesNotMatch(app, /Support the team behind a story\./u);
  assert.doesNotMatch(discovery, /className="teams-carousel-controls"/u);
  assert.match(
    discovery,
    /<span className="new-series-cover">[\s\S]+<span className="new-series-badges">/u,
  );
  assert.match(giftStore, /Gift to user/u);
  assert.match(giftStore, /Support a Translation Team/u);
  assert.match(
    roulette,
    /The server chooses the reward before the\s+wheel animates/u,
  );
  assert.match(rewardAdmin, /Chapter dwell time \(seconds\)/u);
  assert.match(styles, /@media \(min-width: 981px\)[\s\S]+\.editors-pick-desktop-detail/u);
  assert.match(styles, /\.search-preview-card \.series-type-badge/u);
});
