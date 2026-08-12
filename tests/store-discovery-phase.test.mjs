import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function migratedDatabase() {
  const migrationNames = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migrationName of migrationNames) {
    const migration = await read(`drizzle/${migrationName}`);
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

function values(database, query, property) {
  return database
    .prepare(query)
    .all()
    .map((row) => row[property]);
}

test("testing catalogue and Store seeds are complete and guarded", async () => {
  const database = await migratedDatabase();
  try {
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM series").get().count,
      25,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM store_items").get().count,
      18,
    );
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS count FROM store_collections")
        .get().count,
      4,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM editor_picks").get()
        .count,
      5,
    );

    assert.deepEqual(
      values(
        database,
        "SELECT DISTINCT type FROM series ORDER BY type",
        "type",
      ),
      ["MANGA", "MANHUA", "MANHWA"],
    );
    assert.deepEqual(
      values(
        database,
        "SELECT DISTINCT access_type FROM series ORDER BY access_type",
        "access_type",
      ),
      ["FREE", "PAID"],
    );
    assert.deepEqual(
      values(
        database,
        "SELECT DISTINCT access_type FROM chapters ORDER BY access_type",
        "access_type",
      ),
      ["FREE", "PAID"],
    );
    assert.deepEqual(
      values(
        database,
        "SELECT DISTINCT reading_direction FROM series ORDER BY reading_direction",
        "reading_direction",
      ),
      ["LEFT_TO_RIGHT", "RIGHT_TO_LEFT", "VERTICAL"],
    );
    assert.deepEqual(
      values(
        database,
        "SELECT DISTINCT format FROM chapters ORDER BY format",
        "format",
      ),
      ["PAGED", "VERTICAL"],
    );
    assert.deepEqual(
      database.prepare("PRAGMA foreign_key_check").all(),
      [],
    );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO series
           (id, slug, title, synopsis, type, status, origin_country,
            original_language, reading_direction, access_type)
           VALUES
           ('invalid_type', 'invalid-type', 'Invalid type', 'Guard fixture',
            'WEBTOON', 'ONGOING', 'US', 'en', 'VERTICAL', 'FREE')`,
        )
        .run(),
    );
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO chapters
           (id, series_id, slug, chapter_number, access_type)
           VALUES
           ('invalid_access', 'ser_neon_ronin', 'invalid-access', '999',
            'PREMIUM')`,
        )
        .run(),
    );
    assert.throws(() =>
      database
        .prepare(
          `UPDATE store_items
              SET price_onyx = -1
            WHERE id = 'item_summer_tide_banner'`,
        )
        .run(),
    );
  } finally {
    database.close();
  }
});

test("Latest Updates is deterministically newest-first and refreshes visibly", async () => {
  const [api, app] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const database = await migratedDatabase();
  try {
    database.exec(
      `UPDATE chapters
          SET published_at = datetime('now', '-30 days')
        WHERE state = 'PUBLISHED';
       INSERT INTO chapters
       (id, series_id, slug, chapter_number, title, state, access_type,
        published_at)
       VALUES
       ('latest_blue_old', 'ser_blue_hour_alchemist', 'latest-old', '901',
        'Older release', 'PUBLISHED', 'FREE', datetime('now', '-1 hour')),
       ('latest_blue_new', 'ser_blue_hour_alchemist', 'latest-new', '902',
        'Newest release', 'PUBLISHED', 'FREE', datetime('now', '-1 minute')),
       ('latest_blue_future', 'ser_blue_hour_alchemist', 'latest-future', '903',
        'Future release', 'PUBLISHED', 'FREE', datetime('now', '+1 day')),
       ('latest_jade_new', 'ser_jade_circuit', 'jade-new', '901',
        'Second newest', 'PUBLISHED', 'FREE', datetime('now', '-2 minutes'));`,
    );

    const seriesOrder = database
      .prepare(
        `SELECT s.slug,
                MAX(datetime(c.published_at)) AS latestPublishedAt
           FROM series s
           JOIN chapters c ON c.series_id = s.id
          WHERE s.is_published = 1
            AND c.state = 'PUBLISHED'
            AND datetime(c.published_at) <= datetime('now')
          GROUP BY s.id
          ORDER BY datetime(latestPublishedAt) DESC, s.id ASC
          LIMIT 2`,
      )
      .all()
      .map((row) => row.slug);
    assert.deepEqual(seriesOrder, [
      "blue-hour-alchemist",
      "jade-circuit",
    ]);

    const chapterOrder = database
      .prepare(
        `SELECT slug
           FROM chapters
          WHERE series_id = 'ser_blue_hour_alchemist'
            AND state = 'PUBLISHED'
            AND datetime(published_at) <= datetime('now')
          ORDER BY datetime(published_at) DESC,
                   datetime(created_at) DESC,
                   id DESC
          LIMIT 2`,
      )
      .all()
      .map((row) => row.slug);
    assert.deepEqual(chapterOrder, ["latest-new", "latest-old"]);
    assert.equal(chapterOrder.includes("latest-future"), false);
  } finally {
    database.close();
  }

  assert.match(api, /SELECT newest\.id[\s\S]*newest\.series_id = s\.id/);
  assert.match(api, /c\.published_at AS latestPublishedAt/);
  assert.match(api, /datetime\(c\.published_at\) <= datetime\('now'\)/);
  assert.match(
    api,
    /ORDER BY datetime\(c\.published_at\) DESC,\s*datetime\(c\.created_at\) DESC,\s*c\.id DESC/,
  );
  assert.match(api, /headers: \{ "cache-control": "no-store" \}/);
  assert.match(app, /requestInFlight/);
  assert.match(app, /window\.setInterval[\s\S]*60_000/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /window\.addEventListener\("focus"/);
});

test("smart search resolves aliases and returns preview metadata", async () => {
  const [api, app] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const database = await migratedDatabase();
  try {
    const aliasMatch = database
      .prepare(
        `SELECT s.slug
           FROM series s
          WHERE EXISTS (
            SELECT 1
              FROM series_aliases sa
             WHERE sa.series_id = s.id
               AND LOWER(sa.alias) LIKE ? ESCAPE '\\'
          )`,
      )
      .get("%alchemy at dawn%");
    assert.equal(aliasMatch.slug, "blue-hour-alchemist");
  } finally {
    database.close();
  }

  assert.match(api, /FROM series_aliases sa/);
  assert.match(api, /LOWER\(sa\.alias\) LIKE \? ESCAPE '\\\\'/);
  assert.match(api, /GROUP_CONCAT\(sa\.alias, '\|\|'\)/);
  assert.match(api, /AS latestChapterNumber/);
  assert.match(api, /alternativeTitle:/);
  assert.match(api, /cover: publicSeriesCover/);
  assert.match(app, /function highlightMatch/);
  assert.match(app, /nyascans:recent-searches/);
  assert.match(app, /Trending series/);
  assert.match(app, /Popular titles/);
  assert.match(app, /latestChapter/);
});

test("Store ownership uses a balanced idempotent ledger and category-safe equip", async () => {
  const api = await read("app/api/v1/[...resource]/route.ts");
  const database = await migratedDatabase();
  try {
    database.exec(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr_store_test', 'store-test@example.com', 'Store Test');
       INSERT INTO ledger_accounts
       (id, owner_type, owner_id, currency, account_type)
       VALUES
       ('la_store_test', 'USER', 'usr_store_test', 'ONYX', 'AVAILABLE'),
       ('la_store_platform', 'PLATFORM', 'NYASCANS_STORE', 'ONYX', 'EARNED');
       INSERT INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key, memo)
       VALUES
       ('tx_store_grant', 'PROMOTIONAL_GRANT', 'USER', 'usr_store_test',
        'grant-store-test', 'Store regression balance');
       INSERT INTO ledger_entries
       (id, transaction_id, account_id, amount)
       VALUES
       ('entry_grant_platform', 'tx_store_grant', 'la_store_platform', -1000),
       ('entry_grant_user', 'tx_store_grant', 'la_store_test', 1000);
       INSERT INTO ledger_transactions
       (id, kind, reference_type, reference_id, idempotency_key, memo)
       VALUES
       ('tx_store_purchase', 'STORE_PURCHASE', 'STORE_ITEM',
        'item_summer_tide_banner', 'usr_store_test:store:request-one',
        'Store purchase: Summer Tide');
       INSERT INTO ledger_entries
       (id, transaction_id, account_id, amount)
       VALUES
       ('entry_purchase_user', 'tx_store_purchase', 'la_store_test', -220),
       ('entry_purchase_platform', 'tx_store_purchase', 'la_store_platform', 220);
       INSERT INTO user_store_items
       (user_id, item_id, transaction_id)
       VALUES
       ('usr_store_test', 'item_summer_tide_banner', 'tx_store_purchase');
       INSERT INTO user_cosmetic_loadouts
       (user_id, category, item_id)
       VALUES
       ('usr_store_test', 'PROFILE_BANNER', 'item_summer_tide_banner');`,
    );

    assert.equal(
      database
        .prepare(
          "SELECT SUM(amount) AS balance FROM ledger_entries WHERE account_id = 'la_store_test'",
        )
        .get().balance,
      780,
    );
    assert.equal(
      database
        .prepare(
          "SELECT SUM(amount) AS total FROM ledger_entries WHERE transaction_id = 'tx_store_purchase'",
        )
        .get().total,
      0,
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM user_store_items WHERE user_id = 'usr_store_test'",
        )
        .get().count,
      1,
    );
    assert.equal(
      database
        .prepare(
          "SELECT item_id AS itemId FROM user_cosmetic_loadouts WHERE user_id = 'usr_store_test' AND category = 'PROFILE_BANNER'",
        )
        .get().itemId,
      "item_summer_tide_banner",
    );

    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO ledger_transactions
           (id, kind, reference_type, reference_id, idempotency_key)
           VALUES
           ('tx_store_duplicate', 'STORE_PURCHASE', 'STORE_ITEM',
            'item_samurai_ink_banner', 'usr_store_test:store:request-one')`,
        )
        .run(),
    );
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO user_store_items
           (user_id, item_id, transaction_id)
           VALUES
           ('usr_store_test', 'item_summer_tide_banner', 'tx_store_purchase')`,
        )
        .run(),
    );
    assert.throws(() =>
      database
        .prepare(
          `INSERT INTO ledger_entries
           (id, transaction_id, account_id, amount)
           VALUES
           ('entry_overspend', 'tx_store_purchase', 'la_store_test', -10000)`,
        )
        .run(),
    );

    database.exec(
      `INSERT INTO store_collections
       (id, slug, name, description, theme_key, enabled, sort_order)
       VALUES
       ('collection_crud_test', 'crud-test', 'CRUD Test',
        'Administrative CRUD test collection.', 'CRUD_TEST', 1, 999);
       INSERT INTO store_items
       (id, slug, collection_id, name, description, category, price_onyx,
        preview_config_json, is_published, is_hidden, sort_order)
       VALUES
       ('item_crud_test', 'crud-test-item', 'collection_crud_test',
        'CRUD Test Item', 'Administrative Store item fixture.',
        'COMMENT_EFFECT', 50,
        '{"from":"#000000","to":"#111111","accent":"#ffffff","symbol":"STAR"}',
        0, 1, 10);
       UPDATE store_items
          SET price_onyx = 75, is_published = 1, is_hidden = 0, sort_order = 20
        WHERE id = 'item_crud_test';`,
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT price_onyx AS priceOnyx,
                    is_published AS isPublished,
                    is_hidden AS isHidden,
                    sort_order AS sortOrder
               FROM store_items
              WHERE id = 'item_crud_test'`,
          )
          .get(),
      },
      { priceOnyx: 75, isPublished: 1, isHidden: 0, sortOrder: 20 },
    );
    database.exec(
      `DELETE FROM store_items WHERE id = 'item_crud_test';
       DELETE FROM store_collections WHERE id = 'collection_crud_test';`,
    );
  } finally {
    database.close();
  }

  for (const route of [
    "store/products",
    "store/inventory",
    "store/purchases",
    "store/equip",
    "admin/store",
    "admin/store-items",
    "admin/store-collections",
    "admin/store-media",
  ]) {
    assert.match(api, new RegExp(route.replace("/", "\\/")));
  }
  assert.match(api, /sumBalancedEntries\(entries\)/);
  assert.match(api, /'STORE_PURCHASE', 'STORE_ITEM'/);
  assert.match(api, /idempotency_key = \?/);
  assert.match(api, /NOT EXISTS \(\s*SELECT 1\s*FROM user_store_items/);
  assert.doesNotMatch(api, /purchased_at/);
  assert.match(api, /created_at AS purchasedAt/);
  assert.match(api, /si\.category = \?/);
  assert.match(api, /store\.item\.create/);
  assert.match(api, /store\.item\.update/);
  assert.match(api, /store\.item\.(?:archive|delete)/);
  assert.match(api, /store\.item\.preview\.replace/);
  assert.match(api, /requireAdminCapability\(actor, capabilityForAdminPath\(path\)\)/u);
});

test("Editor's Picks are ordered, publication-safe, and administrator selected", async () => {
  const [api, app, admin, panel] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/EditorialManagementPanel.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  const database = await migratedDatabase();
  try {
    const picks = database
      .prepare(
        `SELECT ep.id, ep.sort_order AS sortOrder
           FROM editor_picks ep
           JOIN series s ON s.id = ep.series_id
          WHERE ep.is_published = 1
            AND s.is_published = 1
          ORDER BY ep.sort_order ASC, ep.created_at ASC`,
      )
      .all()
      .map((row) => ({ ...row }));
    assert.equal(picks.length, 5);
    assert.deepEqual(
      picks.map((pick) => pick.sortOrder),
      [10, 20, 30, 40, 50],
    );
    database
      .prepare(
        "UPDATE editor_picks SET is_published = 0 WHERE id = 'pick_regent'",
      )
      .run();
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM editor_picks WHERE is_published = 1",
        )
        .get().count,
      4,
    );
  } finally {
    database.close();
  }

  assert.match(api, /path === "editor-picks"/);
  assert.match(api, /path === "admin\/editor-picks"/);
  assert.match(api, /ep\.is_published = 1/);
  assert.match(api, /function publicSeriesPredicate/);
  assert.match(api, /rights_status IN/);
  assert.match(api, /ORDER BY ep\.sort_order ASC, ep\.created_at ASC/);
  assert.match(api, /EDITOR_PICK_DUPLICATE/);
  assert.match(api, /DELETE FROM editor_picks/);
  assert.match(api, /editor-picks\.replace/);
  assert.match(app, /function EditorsPickSection/);
  assert.match(app, /\/api\/v1\/editor-picks/);
  assert.match(admin, /\/api\/v1\/admin\/editor-picks/);
  assert.match(panel, /EditorialManagementPanel/);
});

test("runtime chapter access never mutates the catalogue with demo helpers", async () => {
  const [access, api] = await Promise.all([
    read("lib/server/chapter-access.ts"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);
  for (const source of [access, api]) {
    assert.doesNotMatch(source, /ensureDemoCatalogueChapters/);
    assert.doesNotMatch(source, /ensureDemoChapter/);
    assert.doesNotMatch(source, /persistDemo/);
  }
  assert.doesNotMatch(access, /INSERT OR IGNORE INTO series/);
  assert.doesNotMatch(access, /INSERT OR IGNORE INTO chapters/);
  assert.match(access, /FROM chapters c\s+JOIN series s/);
  assert.match(access, /CHAPTER_NOT_FOUND/);
});

test("public and administrative UI expose only supported content states", async () => {
  const [api, app, panel, visibility] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/admin/ContentVisibilityPanel.tsx"),
  ]);
  assert.match(api, /chapterAccessTypeSchema = z\.enum\(\["FREE", "PAID"\]\)/);
  for (const legacy of [
    "EARLY_ACCESS",
    "WAIT_TO_UNLOCK",
    "WAIT_REQUIRED",
  ]) {
    assert.doesNotMatch(api, new RegExp(legacy));
    assert.doesNotMatch(app, new RegExp(legacy));
    assert.doesNotMatch(panel, new RegExp(legacy));
  }
  assert.doesNotMatch(panel, /value="WEBTOON"|value="COMIC"/);
  assert.match(app, /Paid/);
  assert.match(app, /Free/);
  assert.match(app, /TypeBadge/);
  assert.match(visibility, /type AccessType = "FREE" \| "PAID" \| "PREMIUM"/u);
  assert.match(api, /MEMBERSHIP_REQUIRED/u);
});

test("client and worker identifiers remain available without randomUUID", async () => {
  const [app, api, randomId, footer] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/random-id.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  assert.match(app, /function clientRandomId\(\)/);
  assert.match(app, /browserCrypto\?\.getRandomValues/);
  assert.doesNotMatch(app, /crypto\.randomUUID\(\)/);
  assert.match(api, /import \{ randomId \}/);
  assert.doesNotMatch(api, /crypto\.randomUUID\(\)/);
  assert.match(randomId, /runtimeCrypto\?\.getRandomValues/);
  assert.match(randomId, /Math\.random/);
  assert.match(footer, /className="footer-group-toggle"/);
  assert.match(footer, /window\.sessionStorage\.setItem/);
  assert.match(footer, /aria-expanded=\{expanded\}/);
  assert.match(footer, /disabled=\{desktop\}/);
});
