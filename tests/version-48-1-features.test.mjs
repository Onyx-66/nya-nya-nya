import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

async function version481Database() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE series (id TEXT PRIMARY KEY);
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL REFERENCES series(id),
      price_onyx INTEGER NOT NULL DEFAULT 0
    );
  `);
  const migration = await read("drizzle/0037_kind_stephen_strange.sql");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
  return database;
}

async function pinnedSeriesCasDatabase() {
  const database = await version481Database();
  const migration = await read("drizzle/0038_nasty_black_crow.sql");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
  return database;
}

test("Version 48.1 migration creates every auth, pin, and discount table and enforces three Featured pins", async () => {
  const migration = await read("drizzle/0037_kind_stephen_strange.sql");
  const expectedTables = [
    "content_discounts",
    "email_verification_tokens",
    "home_pinned_series",
    "user_password_credentials",
    "user_sessions",
  ];
  for (const table of expectedTables) {
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`", "u"));
  }
  assert.match(migration, /content_discounts_target_check/u);
  assert.match(migration, /content_discounts_price_check/u);
  assert.match(migration, /email_verification_tokens_hash_uidx/u);
  assert.match(migration, /user_sessions_token_hash_uidx/u);
  assert.match(migration, /user_password_credentials_iterations_check/u);
  assert.match(migration, /home_pinned_series_max_three_featured_insert/u);
  assert.match(migration, /home_pinned_series_max_three_featured_update/u);

  const database = await version481Database();
  const created = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  for (const table of expectedTables) assert.ok(created.includes(table));

  const addSeries = database.prepare("INSERT INTO series (id) VALUES (?)");
  const addPin = database.prepare(`
    INSERT INTO home_pinned_series
      (id, series_id, display_order, is_featured)
    VALUES (?, ?, ?, ?)
  `);
  for (let index = 1; index <= 5; index += 1) addSeries.run(`series_${index}`);
  for (let index = 1; index <= 3; index += 1) {
    addPin.run(`pin_${index}`, `series_${index}`, index - 1, 1);
  }
  assert.throws(
    () => addPin.run("pin_4", "series_4", 3, 1),
    /at most three Featured items/u,
    "the database, not only the admin UI, must reject a fourth Featured pin",
  );
  addPin.run("pin_4", "series_4", 3, 0);
  assert.throws(
    () =>
      database
        .prepare("UPDATE home_pinned_series SET is_featured = 1 WHERE id = ?")
        .run("pin_4"),
    /at most three Featured items/u,
    "the update trigger must enforce the same invariant",
  );
  database.prepare("DELETE FROM home_pinned_series WHERE id = 'pin_1'").run();
  database
    .prepare("UPDATE home_pinned_series SET is_featured = 1 WHERE id = 'pin_4'")
    .run();
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM home_pinned_series WHERE is_featured = 1")
      .get().count,
    3,
  );
});

test("Pinned Series public and admin APIs enforce schedules, RBAC, ordering, and replacement invariants", async () => {
  const [publicRoute, adminRoute, service] = await Promise.all([
    read("app/api/v1/pinned-series/route.ts"),
    read("app/api/v1/admin/pinned-series/route.ts"),
    read("lib/server/pinned-series.ts"),
  ]);

  assert.match(publicRoute, /listPublicPinnedSeries/u);
  assert.match(publicRoute, /public, max-age=30, stale-while-revalidate=120/u);
  assert.match(adminRoute, /export async function GET/u);
  assert.match(adminRoute, /export async function PUT/u);
  assert.ok(
    (adminRoute.match(/requireAdmin\(actor\)/gu) ?? []).length >= 2,
    "both admin methods must be protected by RBAC",
  );
  assert.match(adminRoute, /assertSameOrigin\(request\)/u);
  assert.match(adminRoute, /\.array\([\s\S]*?\)\s*\.max\(12\)/u);
  assert.match(adminRoute, /The end date must be after the start date/u);

  assert.match(service, /LIMIT 12/u);
  assert.match(service, /ORDER BY pin\.display_order/u);
  assert.match(service, /pin\.starts_at IS NULL OR datetime\(pin\.starts_at\) <= datetime\('now'\)/u);
  assert.match(service, /pin\.ends_at IS NULL OR datetime\(pin\.ends_at\) > datetime\('now'\)/u);
  assert.match(service, /DUPLICATE_PIN/u);
  assert.match(service, /FEATURED_PIN_LIMIT/u);
  assert.match(service, /PINNED_SERIES_CHANGED/u);
  assert.match(service, /DELETE FROM home_pinned_series/u);
  assert.match(service, /await db\.batch\(statements\)/u);
  assert.match(service, /homepage\.pinned-series\.replace/u);
});

test("Pinned Series collection revisions reject stale whole-collection replacements", async () => {
  const [migration, adminRoute, service, panel] = await Promise.all([
    read("drizzle/0038_nasty_black_crow.sql"),
    read("app/api/v1/admin/pinned-series/route.ts"),
    read("lib/server/pinned-series.ts"),
    read("components/nyascans/admin/PinnedSeriesPanel.tsx"),
  ]);

  assert.match(migration, /CREATE TABLE `home_pinned_series_state`/u);
  assert.match(migration, /home_pinned_series_state_key_check/u);
  assert.match(migration, /home_pinned_series_state_revision_check/u);
  assert.match(
    migration,
    /VALUES \('pinned-series', 1, 'initial'\)/u,
    "the migration must seed the singleton before the first admin GET",
  );
  assert.match(
    adminRoute,
    /revision: z\.coerce\.number\(\)\.int\(\)\.min\(1\)/u,
  );
  assert.match(
    adminRoute,
    /replacePinnedSeries\([\s\S]*payload\.items,[\s\S]*payload\.revision/u,
  );
  assert.match(
    service,
    /UPDATE home_pinned_series_state[\s\S]*revision = revision \+ 1[\s\S]*WHERE collection_key = \? AND revision = \?/u,
  );
  assert.match(service, /const mutationMarker = randomId\(\)/u);
  assert.match(
    service,
    /collection_key = \? AND revision = \? AND mutation_marker = \?/u,
  );
  assert.match(service, /"changes\(\) = 1"/u);
  assert.match(service, /if \(!results\[0\]\?\.meta\.changes\)/u);
  assert.match(service, /PINNED_SERIES_STALE/u);
  assert.match(panel, /revision: number/u);
  assert.match(panel, /revision: payload\.revision/u);

  const database = await pinnedSeriesCasDatabase();
  const initialState = database
    .prepare(
      `SELECT collection_key AS collectionKey, revision, mutation_marker AS mutationMarker
         FROM home_pinned_series_state`,
    )
    .get();
  assert.deepEqual(
    { ...initialState },
    { collectionKey: "pinned-series", revision: 1, mutationMarker: "initial" },
  );

  const acquire = database.prepare(
    `UPDATE home_pinned_series_state
        SET revision = revision + 1, mutation_marker = ?
      WHERE collection_key = 'pinned-series' AND revision = ?`,
  );
  assert.equal(acquire.run("writer-a", 1).changes, 1);
  assert.equal(
    acquire.run("writer-b", 1).changes,
    0,
    "a second admin holding revision 1 must lose the CAS",
  );

  database.prepare("INSERT INTO series (id) VALUES ('series_cas')").run();
  database
    .prepare(
      `INSERT INTO home_pinned_series
        (id, series_id, display_order, is_featured)
       VALUES ('pin_cas', 'series_cas', 0, 0)`,
    )
    .run();
  const staleDelete = database.prepare(
    `DELETE FROM home_pinned_series
      WHERE EXISTS (
        SELECT 1 FROM home_pinned_series_state
         WHERE collection_key = 'pinned-series'
           AND revision = ? AND mutation_marker = ?
      )`,
  );
  assert.equal(staleDelete.run(2, "writer-b").changes, 0);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM home_pinned_series").get().count,
    1,
    "the stale writer token must not delete the winning collection",
  );
  assert.equal(staleDelete.run(2, "writer-a").changes, 1);
});

test("Discount APIs are paid-system gated and expose only authenticated admin mutations", async () => {
  const [publicRoute, adminRoute, service] = await Promise.all([
    read("app/api/v1/discounts/route.ts"),
    read("app/api/v1/admin/discounts/route.ts"),
    read("lib/server/content-discounts.ts"),
  ]);

  assert.match(publicRoute, /z\s*\.enum\(\["discount", "expiry"\]\)/u);
  assert.match(publicRoute, /listPublicDiscounts\(sort\)/u);
  assert.match(publicRoute, /error\.code === "PAID_ECONOMY_HIDDEN"/u);
  assert.match(publicRoute, /new ApiError\(\s*404,\s*"DISCOUNTS_UNAVAILABLE"/u);
  assert.match(publicRoute, /public, max-age=20, stale-while-revalidate=60/u);

  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    assert.match(adminRoute, new RegExp(`export async function ${method}`, "u"));
  }
  assert.ok(
    (adminRoute.match(/requireAdmin\(actor\)/gu) ?? []).length >= 4,
    "every discounts admin endpoint must enforce admin RBAC",
  );
  assert.ok(
    (adminRoute.match(/assertSameOrigin\(request\)/gu) ?? []).length >= 3,
    "every discounts mutation must reject cross-origin requests",
  );
  assert.match(adminRoute, /targetType: z\.enum\(\["SERIES", "CHAPTER"\]\)/u);
  assert.match(adminRoute, /discountType: z\.enum\(\["PERCENT", "FIXED"\]\)/u);
  assert.match(adminRoute, /Percentage discounts must be between 1 and 99/u);
  assert.match(adminRoute, /A series discount cannot reference a chapter/u);

  const publicList = service.slice(
    service.indexOf("export async function listPublicDiscounts"),
    service.indexOf("export async function listAdminDiscounts"),
  );
  assert.ok(
    publicList.indexOf("requirePaidEconomyPublicDocument()") <
      publicList.indexOf("database()"),
    "the public endpoint must fail closed before it reads discount records",
  );
  assert.match(publicList, /discount\.is_active = 1/u);
  assert.match(publicList, /datetime\(discount\.starts_at\) <= datetime\('now'\)/u);
  assert.match(publicList, /datetime\(discount\.ends_at\) > datetime\('now'\)/u);
  assert.match(publicList, /c\.price_onyx = discount\.original_price/u);
  assert.match(service, /DISCOUNT_SCHEDULE_CONFLICT/u);
  assert.match(service, /revision = revision \+ 1/u);
  assert.match(service, /STALE_VERSION/u);
  assert.match(service, /content\.discount\.(?:create|update|delete)/u);
});

test("Discount routes and discovery fail closed when paid content is disabled", async () => {
  const [page, sitemap, featureSections, app, resourceRoute, chapterAccess] = await Promise.all([
    read("app/[...slug]/page.tsx"),
    read("app/sitemap.ts"),
    read("components/nyascans/HomeFeatureSections.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/chapter-access.ts"),
  ]);

  assert.match(page, /root === "discounts"[\s\S]*view: "discounts"/u);
  assert.match(page, /requirePaidEconomyPublicDocument/u);
  assert.match(page, /resolved\.view === "discounts"[\s\S]*notFound\(\)/u);
  assert.match(featureSections, /if \(!enabled \|\| initialRecords !== undefined\) return/u);
  assert.match(featureSections, /records: enabled \? records : \[\]/u);
  assert.match(featureSections, /unavailable: !enabled \|\|/u);
  assert.match(featureSections, /if \(unavailable\) return null/u);
  assert.match(app, /view === "discounts"[\s\S]*?<DiscountsDirectory \/>/u);
  assert.match(resourceRoute, /paidChapterPredicate[\s\S]*?AND c\.access_type = 'FREE'/u);
  assert.match(resourceRoute, /\$\{paidChapterPredicate\}/u);
  assert.match(chapterAccess, /chapter\.accessType === "PAID"[\s\S]*?premiumEconomyPublic/u);
  assert.match(chapterAccess, /"CHAPTER_NOT_FOUND"/u);
  assert.match(sitemap, /getCommercialSettingsDocument\(\)\.catch\(\(\) => null\)/u);
  assert.match(sitemap, /!commercial\.recoveredFromInvalid/u);
  assert.match(sitemap, /\.\.\.\(discountsPublic \? \["\/discounts"\] : \[\]\)/u);
});

test("the active discount guard pins revision, time window, chapter base price, and effective price", async () => {
  const source = await read("lib/server/content-discounts.ts");
  const guardMatch = source.match(
    /export function activeChapterDiscountGuardSql\(\) \{\s*return `([\s\S]*?)`;\s*\}/u,
  );
  const noDiscountGuardMatch = source.match(
    /export function noActiveChapterDiscountGuardSql\(\) \{\s*return `([\s\S]*?)`;\s*\}/u,
  );
  assert.ok(guardMatch, "the unlock discount guard must remain an explicit SQL predicate");
  assert.ok(
    noDiscountGuardMatch,
    "the full-price path must atomically reject a newly active discount",
  );
  const guardSql = guardMatch[1];
  const noDiscountGuardSql = noDiscountGuardMatch[1];
  for (const contract of [
    /live_discount\.id = \?/u,
    /live_discount\.revision = \?/u,
    /live_discount\.is_active = 1/u,
    /datetime\(live_discount\.starts_at\) <= datetime\('now'\)/u,
    /datetime\(live_discount\.ends_at\) > datetime\('now'\)/u,
    /live_discount\.series_id = current_chapter\.series_id/u,
    /live_discount\.original_price = current_chapter\.price_onyx/u,
    /current_chapter\.price_onyx[\s\S]*live_discount\.discount_value/u,
    /END = \?/u,
  ]) {
    assert.match(guardSql, contract);
  }

  const database = await version481Database();
  database.prepare("INSERT INTO users (id) VALUES ('admin')").run();
  database.prepare("INSERT INTO series (id) VALUES ('series_1')").run();
  database
    .prepare(
      "INSERT INTO chapters (id, series_id, price_onyx) VALUES ('chapter_1', 'series_1', 100)",
    )
    .run();
  const now = Date.now();
  database
    .prepare(`
      INSERT INTO content_discounts
        (id, target_type, series_id, chapter_id, discount_type,
         discount_value, original_price, reduced_price, starts_at, ends_at,
         is_active, revision, created_by_user_id)
      VALUES (?, 'CHAPTER', 'series_1', 'chapter_1', 'PERCENT',
              25, 100, 75, ?, ?, 1, 4, 'admin')
    `)
    .run(
      "discount_1",
      new Date(now - 60_000).toISOString(),
      new Date(now + 60_000).toISOString(),
    );
  assert.equal(
    database
      .prepare(
        `SELECT ${noDiscountGuardSql} AS allowed
           FROM chapters current_chapter
          WHERE current_chapter.id = ?`,
      )
      .get("chapter_1").allowed,
    0,
    "full-price checkout must stop when a valid discount is active",
  );
  const guarded = database.prepare(
    `SELECT ${guardSql} AS allowed
       FROM chapters current_chapter
      WHERE current_chapter.id = ?`,
  );
  const allowed = (revision, effectivePrice) =>
    guarded.get(
      "discount_1",
      revision,
      effectivePrice,
      effectivePrice,
      "chapter_1",
    ).allowed;

  assert.equal(allowed(4, 75), 1);
  assert.equal(allowed(3, 75), 0, "a stale discount revision must fail");
  assert.equal(allowed(4, 76), 0, "a stale displayed price must fail");
  database.prepare("UPDATE chapters SET price_onyx = 120").run();
  assert.equal(
    allowed(4, 90),
    0,
    "a chapter-scoped discount cannot follow a changed base price",
  );
  database.prepare("UPDATE chapters SET price_onyx = 100").run();
  database
    .prepare("UPDATE content_discounts SET ends_at = datetime('now', '-1 second')")
    .run();
  assert.equal(allowed(4, 75), 0, "an expired discount must fail atomically");
  assert.equal(
    database
      .prepare(
        `SELECT ${noDiscountGuardSql} AS allowed
           FROM chapters current_chapter
          WHERE current_chapter.id = ?`,
      )
      .get("chapter_1").allowed,
    1,
    "full-price checkout may proceed once no valid discount remains",
  );
});

test("chapter access keeps the base price while unlock ledger entries use only the effective discounted price", async () => {
  const [accessSource, routeSource, discountSource] = await Promise.all([
    read("lib/server/chapter-access.ts"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/content-discounts.ts"),
  ]);

  assert.match(accessSource, /resolveActiveChapterDiscount\([\s\S]*chapter\.priceOnyx/u);
  assert.match(accessSource, /const pricedChapter = \{ \.\.\.chapter, \.\.\.price \}/u);
  assert.match(discountSource, /basePriceOnyx: basePrice,[\s\S]*priceOnyx: selected\.price/u);
  assert.match(discountSource, /discount\.targetType === "CHAPTER"[\s\S]*Number\(discount\.originalPrice\) !== basePrice/u);
  assert.match(discountSource, /discount\.targetType === "SERIES" \|\|[\s\S]*discount\.chapterId === chapterId/u);

  const unlockStart = routeSource.indexOf('if (path === "unlocks")');
  const unlock = routeSource.slice(
    unlockStart,
    routeSource.indexOf('if (path === "uploads")', unlockStart),
  );
  assert.match(unlock, /requirePaidEconomyPublicDocument/u);
  assert.match(unlock, /current_chapter\.price_onyx = \?/u);
  assert.match(unlock, /access\.chapterId,\s*access\.basePriceOnyx/u);
  assert.match(unlock, /activeChapterDiscountGuardSql\(\)/u);
  assert.match(unlock, /noActiveChapterDiscountGuardSql\(\)/u);
  assert.match(
    unlock,
    /access\.discountId,[\s\S]*access\.discountRevision,[\s\S]*access\.priceOnyx,[\s\S]*access\.priceOnyx/u,
  );
  assert.match(unlock, /amount: -access\.priceOnyx/u);
  assert.match(unlock, /amount: access\.priceOnyx/u);
  assert.match(unlock, /wallet\.accountId,\s*-access\.priceOnyx/u);
  assert.match(unlock, /creditAccountId,\s*access\.priceOnyx/u);
  assert.match(unlock, /chapter_unlock_receipts[\s\S]*access\.priceOnyx/u);
  assert.match(unlock, /basePriceOnyx: access\.basePriceOnyx/u);
  assert.match(unlock, /discountId: access\.discountId/u);
  assert.match(unlock, /paidEconomyRevisionGuardSql\(paidEconomyRevision\)/u);
});

test("home and directory contracts place Pinned Series then Discounts before Latest Updates", async () => {
  const [app, page, featureSections] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/[...slug]/page.tsx"),
    read("components/nyascans/HomeFeatureSections.tsx"),
  ]);
  const home = app.slice(app.indexOf("function HomeView"), app.indexOf("function FloatingHomeAd"));
  const continueAt = home.indexOf("<ContinueReadingSection");
  const pinnedAt = home.indexOf("<PinnedSeriesSection");
  const discountsAt = home.indexOf("<DiscountsSection");
  const latestAt = home.indexOf("<LatestUpdatesGrid");
  assert.ok(continueAt >= 0, "Continue Reading must remain on the homepage");
  assert.ok(
    continueAt < pinnedAt && pinnedAt < discountsAt && discountsAt < latestAt,
    "homepage order must be Continue Reading → Pinned Series → Discounts → Latest Updates",
  );
  assert.match(home, /<DiscountsSection[\s\S]*enabled=\{[\s\S]*premiumEconomyPublic/u);
  assert.match(featureSections, /filter\(\(record\) => record\.featured\)\.slice\(0, 3\)/u);
  assert.match(featureSections, /\}, 6_000\)/u);
  assert.match(featureSections, /className="v481-pinned-bento"/u);
  assert.match(featureSections, /className="v481-discount-rail"/u);
  assert.match(featureSections, /v481-ticket-perforation/u);
  assert.match(featureSections, /v481-ticket-ribbon/u);
  assert.match(featureSections, /All <ArrowRight/u);
  assert.match(page, /root === "pinned-series"[\s\S]*view: "pinned"/u);
  assert.match(page, /root === "discounts"[\s\S]*view: "discounts"/u);
});
