import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

async function applyMigration(database, file) {
  const migration = await read(file);
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = (await readdir(new URL("../drizzle", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    await applyMigration(database, `drizzle/${migration}`);
  }
  return database;
}

test("Version 48.3 upgrades every legacy pin to Featured and enforces nine active pins", async () => {
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
  await applyMigration(database, "drizzle/0037_kind_stephen_strange.sql");
  await applyMigration(database, "drizzle/0038_nasty_black_crow.sql");

  const addSeries = database.prepare("INSERT INTO series (id) VALUES (?)");
  const addLegacyPin = database.prepare(`
    INSERT INTO home_pinned_series
      (id, series_id, display_order, is_featured)
    VALUES (?, ?, ?, 0)
  `);
  for (let index = 1; index <= 10; index += 1) {
    addSeries.run(`series_v483_${index}`);
    addLegacyPin.run(`pin_v483_${index}`, `series_v483_${index}`, index - 1);
  }

  await applyMigration(database, "drizzle/0043_pinned-home-discovery.sql");
  assert.equal(
    database.prepare(
      "SELECT COUNT(*) AS count FROM home_pinned_series WHERE is_featured = 1",
    ).get().count,
    10,
    "migration must preserve every pin while making it Featured",
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count
        FROM home_pinned_series
       WHERE (starts_at IS NULL OR datetime(starts_at) <= CURRENT_TIMESTAMP)
         AND (ends_at IS NULL OR datetime(ends_at) > CURRENT_TIMESTAMP)
    `).get().count,
    9,
    "only the first nine editorial pins remain active",
  );

  addSeries.run("series_v483_11");
  assert.throws(
    () => database.prepare(`
      INSERT INTO home_pinned_series
        (id, series_id, display_order, is_featured)
      VALUES ('pin_v483_11', 'series_v483_11', 10, 1)
    `).run(),
    /at most nine active items/u,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO home_pinned_series
        (id, series_id, display_order, is_featured, starts_at)
      VALUES ('pin_v483_unfeatured', 'series_v483_11', 10, 0, datetime('now', '+2 days'))
    `).run(),
    /must be Featured/u,
  );
  database.close();
});

test("Version 48.3 serves only Featured pins and validates overlapping schedules", async () => {
  const [service, publicSection, panel, adminRoute] = await Promise.all([
    read("lib/server/pinned-series.ts"),
    read("components/nyascans/HomeFeatureSections.tsx"),
    read("components/nyascans/admin/PinnedSeriesPanel.tsx"),
    read("app/api/v1/admin/pinned-series/route.ts"),
  ]);
  assert.match(service, /const MAX_ACTIVE_PINNED_SERIES = 9/u);
  assert.match(service, /pin\.is_featured = 1/u);
  assert.equal(
    (service.match(/status NOT IN \('DRAFT', 'REJECTED', 'ARCHIVED'\)/gu) ?? []).length,
    3,
    "public, admin-option, and replacement queries must reject non-public statuses",
  );
  assert.match(service, /concurrencyCheckpoints/u);
  assert.match(service, /ACTIVE_PIN_LIMIT_REACHED/u);
  assert.match(service, /LIMIT \$\{MAX_ACTIVE_PINNED_SERIES\}/u);
  assert.match(publicSection, /filter\(\(record\) => record\.featured\)\.slice\(0, 9\)/u);
  assert.doesNotMatch(publicSection, /records\.slice\(0, 3\)/u);
  assert.match(panel, /featured: true/u);
  assert.match(panel, /activeCount >= 9/u);
  assert.match(adminRoute, /featured: z\.boolean\(\)\.default\(true\)/u);
});

test("Version 48.3 home discovery uses trusted onsite activity and a globally newest table mode", async () => {
  const [app, hotRoute, hotSection, latestRoute, teams, activityMigration] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/hot-this-week/route.ts"),
    read("components/nyascans/HotThisWeek.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("drizzle/0044_dapper_misty_knight.sql"),
  ]);
  const home = app.slice(app.indexOf("function HomeView"), app.indexOf("function FloatingHomeAd"));
  assert.ok(home.indexOf("<CommunityHighlights") < home.indexOf("<HotThisWeek"));
  assert.match(hotRoute, /datetime\('now', '-7 days'\)/u);
  assert.match(hotRoute, /COUNT\(DISTINCT CASE/u);
  assert.match(hotRoute, /rp\.onsite_activity_at >= datetime/u);
  assert.doesNotMatch(hotRoute, /analytics_events/u);
  assert.match(hotRoute, /comment_chapter\.visibility = 'PUBLIC'/u);
  assert.match(hotRoute, /LIMIT 9/u);
  assert.doesNotMatch(hotRoute, /Math\.random/u);
  assert.match(hotSection, /\/browse\?sort=viewed/u);
  assert.match(app, /<th scope="col">Series<\/th>[\s\S]*<th scope="col">Chapter<\/th>[\s\S]*<th scope="col">Releaser<\/th>[\s\S]*<th scope="col">Status<\/th>[\s\S]*<th scope="col">Date<\/th>/u);
  assert.match(app, /mode=\$\{useHomeTable \? "table" : "cards"\}/u);
  assert.match(latestRoute, /if \(presentation === "table"\)[\s\S]*const resultPageSize = 15/u);
  assert.match(latestRoute, /SELECT COUNT\(\*\) AS count[\s\S]*FROM chapters c/u);
  assert.match(latestRoute, /ORDER BY datetime\(c\.published_at\) DESC,[\s\S]*LIMIT \? OFFSET \?/u);
  assert.match(latestRoute, /const chapterPresentationLimit = 4/u);
  assert.match(teams, />Top Publishing Teams<\/h2>/u);
  assert.match(teams, /Previous publishing team/u);
  assert.match(teams, /No teams publish in this language yet/u);
  assert.match(activityMigration, /ADD `onsite_activity_at` text/u);
  assert.match(activityMigration, /reading_progress_onsite_activity_idx/u);
  assert.match(activityMigration, /chapter_reactions_created_idx/u);
});

test("Version 48.3 weekly ranking and notification reconciliation SQL execute on a fresh database", async () => {
  const [hotRoute, notificationRoute, paidVisibility] = await Promise.all([
    read("app/api/v1/hot-this-week/route.ts"),
    read("app/api/v1/notifications/route.ts"),
    import("../lib/server/public-content-visibility.ts"),
  ]);
  const hotSql = hotRoute.match(
    /const rows = await env\.DB\.prepare\(\s*`([\s\S]*?)`,\s*\)\.all<HotSeriesRow>/u,
  )?.[1];
  const notificationSql = notificationRoute.match(
    /await env\.DB\.prepare\(\s*`(INSERT INTO notifications[\s\S]*?LIMIT 40)`,\s*\)/u,
  )?.[1];
  assert.ok(hotSql, "weekly ranking query must remain directly testable");
  assert.ok(notificationSql, "notification reconciliation query must remain directly testable");
  const executableHotSql = hotSql
    .replace(
      /\$\{publicPaidSeriesPredicate\("([^"]+)"\)\}/gu,
      (_match, seriesAlias) => paidVisibility.publicPaidSeriesPredicate(seriesAlias),
    )
    .replace(
      /\$\{publicPaidChapterPredicate\("([^"]+)", "([^"]+)"\)\}/gu,
      (_match, chapterAlias, overrideAlias) =>
        paidVisibility.publicPaidChapterPredicate(chapterAlias, overrideAlias),
    );

  const database = await migratedDatabase();
  try {
    assert.deepEqual(database.prepare(executableHotSql).all(), []);

    database.exec(`
      INSERT INTO users (id, email, display_name) VALUES
        ('usr_onsite', 'onsite@example.test', 'Onsite Reader'),
        ('usr_import', 'import@example.test', 'Imported Reader');
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, is_published)
      VALUES
        ('series_onsite', 'onsite-hit', 'Onsite Hit', '', 'MANGA', 'ONGOING',
         'JP', 'ja', 'RTL', 1),
        ('series_import', 'import-only', 'Import Only', '', 'MANGA', 'ONGOING',
         'JP', 'ja', 'RTL', 1);
      INSERT INTO chapters
        (id, series_id, slug, chapter_number, state, visibility, published_at)
      VALUES
        ('chapter_onsite', 'series_onsite', 'chapter-1', '1', 'PUBLISHED',
         'PUBLIC', datetime('now', '-2 days')),
        ('chapter_import', 'series_import', 'chapter-1', '1', 'PUBLISHED',
         'PUBLIC', datetime('now', '-2 days'));
      INSERT INTO reading_progress
        (user_id, chapter_id, progress_basis_points, updated_at,
         onsite_activity_at)
      VALUES
        ('usr_onsite', 'chapter_onsite', 5000,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'),
         datetime('now', '-1 hour')),
        ('usr_import', 'chapter_import', 10000,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'), NULL);
    `);
    const hotRows = database.prepare(executableHotSql).all();
    assert.deepEqual(
      hotRows.map((row) => row.slug),
      ["onsite-hit"],
      "import timestamps must not influence the public weekly ranking",
    );
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${executableHotSql}`).all();
    assert.ok(
      plan.some((step) => String(step.detail).includes("reading_progress_onsite_activity_idx")),
      "weekly ranking should use its time-leading onsite activity index",
    );

    database.prepare(notificationSql).run("usr_missing", 0, "usr_missing", "usr_missing", "usr_missing");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("Version 48.3 announcement and paid-release treatments are accessible and responsive", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(app, /featured-slider-dots announcement-slider-dots/u);
  assert.match(app, /aria-roledescription="carousel"/u);
  assert.match(app, /prefers-reduced-motion: reduce/u);
  assert.match(app, /className=\{paid \? "is-paid" : undefined\}/u);
  assert.match(app, /<ChapterAccessBadge/u);
  assert.match(css, /\.latest-release-table tbody tr\.is-paid/u);
  assert.match(css, /#d6a721/u);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.latest-release-table tbody tr/u);
  assert.match(css, /\.home-announcement-slider > \.announcement-slider-dots/u);
});

test("Version 48.3 notifications resolve safe series covers and expose explicit read controls", async () => {
  const [route, app, page, artwork] = await Promise.all([
    read("app/api/v1/notifications/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/NotificationsView.tsx"),
    read("components/nyascans/NotificationArtwork.tsx"),
  ]);
  assert.match(route, /seriesSlugForNotification/u);
  assert.match(route, /AND s\.is_published = 1/u);
  assert.match(route, /'CHAPTER_UPDATE'/u);
  assert.match(route, /notifications_enabled = 1/u);
  assert.match(route, /'chapter-update:' \|\| c\.id/u);
  assert.match(route, /seriesMediaUrl/u);
  assert.match(route, /series: slug \? seriesBySlug\.get\(slug\) \?\? null : null/u);
  assert.match(app, /Mark all as read/u);
  assert.match(app, /Mark as read/u);
  assert.match(app, /setNotificationRecords\(previousRecords\)/u);
  assert.match(app, /<NotificationArtwork/u);
  assert.match(page, /className=\{`notification-card-artwork/u);
  assert.match(page, /if \(await updateNotification\("READ", record\.id\)\)[\s\S]*window\.location\.assign\(href\)/u);
  assert.match(artwork, /onError=\{\(\) => setFailedUrl/u);
  assert.match(artwork, /alt=""/u);
});
