import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("five templates and five slider variants are wired end to end", async () => {
  const [theme, layout, panel, app, css] = await Promise.all([
    read("lib/site-theme.ts"),
    read("app/layout.tsx"),
    read("components/nyascans/ThemeSettingsPanel.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);

  for (const value of [
    "ONYX_EDITORIAL",
    "WEBTOON_SPOTLIGHT",
    "SCAN_DIRECTORY",
    "CINEMA_RAILS",
    "PAPER_SHELF",
  ]) {
    assert.match(theme, new RegExp(value));
  }
  for (const value of [
    "POSTER_RAIL",
    "CLEAN_GRID",
    "RANK_STRIP",
    "SPOTLIGHT_STACK",
    "CHAPTER_CAROUSEL",
  ]) {
    assert.match(theme, new RegExp(value));
  }

  assert.match(layout, /siteThemeDataAttributes/);
  assert.match(panel, /templateStyleOptions\.map/);
  assert.match(panel, /sliderStyleOptions\.map/);
  assert.match(app, /function TrendingShowcase/);
  assert.match(css, /--slider-card-width/);
  assert.match(css, /aspect-ratio:\s*var\(--cover-ratio\)/);
});

test("locked chapters derive policy, price, and entitlement on the server", async () => {
  const [api, access, app, panel] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/chapter-access.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);

  const unlockSchema = api.slice(
    api.indexOf("const unlockSchema"),
    api.indexOf("const analyticsEventSchema"),
  );
  assert.doesNotMatch(unlockSchema, /costOnyx|chapterId/);
  assert.match(api, /COALESCE\(\(\s*SELECT SUM\(amount\)/);
  assert.match(api, /NOT EXISTS \(\s*SELECT 1\s*FROM entitlements/);
  assert.match(api, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(api, /requireReadableChapter\(actor, payload\.chapterId\)/);
  assert.match(api, /CHAPTER_PAGES_REQUIRED/);
  assert.doesNotMatch(
    api,
    /chapterAccessTypeSchema\s*\.catch\("FREE"\)/,
  );
  assert.match(access, /state === "PUBLISHED"/);
  assert.match(access, /revoked_at IS NULL/);
  assert.match(access, /export type ChapterAccessType = "FREE" \| "PAID"/);
  assert.doesNotMatch(
    access,
    /ensureDemoCatalogueChapters|ensureDemoChapter|persistDemo/,
  );
  assert.doesNotMatch(
    api,
    /ensureDemoCatalogueChapters|ensureDemoChapter|persistDemo:\s*true/,
  );
  assert.match(app, /chapter-access-list/);
  assert.match(app, /if \(!access\.canRead\)/);
  assert.match(panel, /function ChapterAccessPanel/);
  assert.match(api, /chapter\.access\.update/);
});

test("analytics migration and near-real-time admin contract are present", async () => {
  const [migration, schema, api, panel] = await Promise.all([
    read("drizzle/0004_light_silvermane.sql"),
    read("db/schema.ts"),
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  const database = new DatabaseSync(":memory:");
  database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  assert.deepEqual(
    database
      .prepare("PRAGMA table_info(analytics_events)")
      .all()
      .map((column) => column.name),
    [
      "id",
      "session_id",
      "event_type",
      "series_slug",
      "chapter_slug",
      "created_at",
    ],
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO analytics_events
         (id, session_id, event_type)
         VALUES ('bad', 'session', 'ARBITRARY_EVENT')`,
      )
      .run(),
  );
  database.close();

  assert.match(schema, /analyticsEvents/);
  assert.match(api, /path === "analytics-events"/);
  assert.match(api, /path === "admin\/analytics"/);
  assert.match(api, /ANALYTICS_SCOPE_INVALID/);
  assert.match(api, /activeSessions5m/);
  assert.match(panel, /15_000/);
  assert.match(panel, /analytics-line-chart/);
  assert.match(panel, /document\.visibilityState === "visible"/);
});
