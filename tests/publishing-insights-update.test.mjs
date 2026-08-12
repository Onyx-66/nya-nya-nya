import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { can, ROLES } from "../lib/permissions.mjs";

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
  return { database, migrationNames };
}

test("Latest Updates exposes two home chapters, four directory chapters, and fifteen globally newest release rows", async () => {
  const [api, app] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const latestMarkup = app.slice(
    app.indexOf("function LatestUpdatesGrid"),
    app.indexOf("function LatestUpdatesView"),
  );

  assert.match(
    api,
    /PARTITION BY LTRIM\(c\.chapter_number, '0'\)/,
  );
  assert.match(api, /WHERE releaseRank = 1/);
  const latestApi = api.slice(
    api.indexOf('if (path === "latest-releases")'),
    api.indexOf('if (path === "search")'),
  );
  assert.match(latestApi, /if \(presentation === "table"\)[\s\S]*const resultPageSize = 15/u);
  assert.match(latestApi, /SELECT COUNT\(\*\) AS count[\s\S]*FROM chapters c/u);
  assert.match(latestApi, /const chapterPresentationLimit = 4/u);
  assert.match(latestApi, /LIMIT \$\{chapterPresentationLimit\}/u);
  assert.match(latestApi, /t\.slug AS teamSlug/);
  assert.match(latestApi, /isNewInPeriod/);
  assert.match(api, /datetime\(newest\.created_at\) DESC/);
  assert.match(api, /newest\.id DESC/);
  assert.match(
    latestMarkup,
    /normalizeChapterNumber\(chapter\.chapterNumber\)/,
  );
  assert.match(latestMarkup, /update\.chapters\.slice\(0, heading && !pagination \? 2 : 4\)/);
  assert.match(latestMarkup, /language=\{chapter\.language\}/);
  assert.match(latestMarkup, /chapter\.teamSlug/);
  assert.match(latestMarkup, /ChapterAccessBadge/);
  assert.match(latestMarkup, /sanitizeChapterTitle\(chapter\.title\)/u);
});

test("Store renders all five sections and preserves data-backed Logo Effects", async () => {
  const [app, storefront] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("lib/storefront.ts"),
  ]);
  for (const section of [
    "coin-packages",
    "memberships",
    "banners",
    "cosmetics",
    "logo-effects",
  ]) {
    assert.match(app, new RegExp(`id="${section}"`));
  }
  assert.match(storefront, /LOGO_EFFECT/);

  const { database, migrationNames } = await migratedDatabase();
  try {
    assert.ok(
      migrationNames.includes("0012_worried_bill_hollister.sql"),
      "The v1.2 administrative migration must be present.",
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM store_items WHERE category = 'LOGO_EFFECT' AND is_published = 1",
        )
        .get().count,
      3,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("series creation and discussion moderation are permission and team scoped", async () => {
  const [api, panel] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);

  assert.equal(can(ROLES.TEAM_LEADER, "series.create"), true);
  assert.equal(can(ROLES.UPLOADER, "series.create"), false);
  assert.equal(can(ROLES.USER, "series.create"), false);
  assert.match(api, /path === "workspace\/series"/);
  assert.match(api, /TEAM_MANAGER_REQUIRED/);
  assert.match(api, /PENDING_REVIEW/);
  assert.match(api, /path === "workspace\/comment-moderation"/);
  assert.match(api, /requireSeriesModerator/);
  assert.match(api, /discussion_user_restrictions/);
  assert.match(api, /Only an administrator can suspend an account platform-wide/);
  assert.match(panel, /Choose a series/);
  assert.match(panel, /Ban from series/);
  assert.match(panel, /Suspend account/);
  assert.match(api, /ORDER BY datetime\(dc\.created_at\) DESC, dc\.id DESC/);
});

test("analytics supports validated custom periods and canonical platform metrics", async () => {
  const [api, panel, schema] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("db/schema.ts"),
  ]);

  assert.match(api, /enum\(\["24h", "7d", "30d", "custom"\]\)/);
  assert.match(api, /durationDays > 366/);
  assert.match(api, /request as Request & \{ cf\?: \{ country\?: unknown \} \}/);
  assert.match(api, /region_code/);
  assert.match(api, /newUsers/);
  assert.match(api, /storePurchases/);
  assert.match(api, /discussion_reactions/);
  assert.match(api, /uploadSessions/);
  assert.match(api, /topChapters/);
  assert.match(panel, /Viewer regions/);
  assert.match(panel, /Most viewed chapters/);
  assert.match(panel, /Start date/);
  assert.match(schema, /analytics_events_region_time_idx/);
  assert.doesNotMatch(api, /ip_address|remote_addr/i);
});

test("administrator site configuration controls safe social, logo, and fixed reader media", async () => {
  const [api, configuration, panel, reader] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/site-configuration.ts"),
    read("components/nyascans/SiteConfigurationPanel.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  assert.match(configuration, /value\.startsWith\("https:\/\/"\)/);
  assert.match(configuration, /!value\.startsWith\("\/\/"\)/);
  assert.match(configuration, /id: "support"/);
  assert.match(api, /path === "admin\/site-media"/);
  assert.match(api, /detectedImageType/);
  assert.match(api, /public\/site\/\$\{name\}-configured/);
  assert.match(panel, /Support and social links/);
  assert.match(panel, /Fixed first page/);
  assert.match(panel, /Fixed last page/);
  assert.match(api, /kind: "FIXED_FIRST"/);
  assert.match(api, /kind: "FIXED_LAST"/);
  assert.match(api, /resolveChapterAccess/);
  assert.match(api, /fixedReaderManifest/);
  assert.match(reader, /contentPageIndex/);
});
