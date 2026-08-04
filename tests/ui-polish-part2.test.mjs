import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Trending is filter-free and Latest Updates owns the date period controls", async () => {
  const app = await read("components/nyascans/NyaScansApp.tsx");
  const trending = app.slice(
    app.indexOf("function TrendingShowcase"),
    app.indexOf("type CommunityHighlight"),
  );
  const latest = app.slice(
    app.indexOf("function LatestUpdatesView"),
    app.indexOf("function TrendingShowcase"),
  );

  assert.doesNotMatch(trending, /Today|This week|This month|All time/);
  assert.match(latest, /Today/);
  assert.match(latest, /This week/);
  assert.match(latest, /This month/);
  assert.match(latest, /All time/);
});

test("announcement and economy settings are persistent administrator data", async () => {
  const [settings, server, schema, migration, panel] = await Promise.all([
    read("lib/commercial-settings.ts"),
    read("lib/server/commercial-settings.ts"),
    read("db/schema.ts"),
    read("drizzle/0008_fresh_glorian.sql"),
    read("components/nyascans/CommercialSettingsPanel.tsx"),
  ]);

  assert.match(settings, /coinPlural/);
  assert.match(settings, /temporaryChapterUnlockHours/);
  assert.match(settings, /packages: z\.array/);
  assert.match(settings, /memberships: z\.array/);
  assert.match(server, /site\.commercial\.update/);
  assert.match(schema, /commercialSettings/);
  assert.match(migration, /CREATE TABLE `commercial_settings`/);
  assert.match(panel, /Reset reader dismissals/);
  assert.match(panel, /Start date \(optional\)/);
  assert.match(panel, /End date \(optional\)/);
});

test("locked chapter media stays server-gated and the reader recovers per page", async () => {
  const [app, api, access, management] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/chapter-access.ts"),
    read("lib/server/chapter-management.ts"),
  ]);
  const reader = app.slice(
    app.indexOf("function ReaderView"),
    app.indexOf("type WalletActivity"),
  );

  assert.match(api, /resolveChapterAccess[\s\S]*CHAPTER_LOCKED/);
  assert.match(api, /CHAPTER_PAGES_INCOMPLETE/);
  assert.match(api, /if-none-match/);
  assert.match(
    access,
    /\["LICENSED", "AUTHORIZED", "DEMO_ORIGINAL", "TEST_ORIGINAL"\]\.includes/,
  );
  assert.match(
    reader,
    /ConfiguredCoinMark[\s\S]+Buy\{" "\}[\s\S]+\{commercial\.economy\.coinPlural\}/,
  );
  assert.match(reader, /Your balance/);
  assert.match(reader, /Retry chapter pages/);
  assert.match(app, /Try page again/);
  assert.match(reader, /readerContext\?\.chapterManagementHref/);
  assert.match(api, /requireChapterManagementScope/);
  assert.match(management, /t\.verification_status = 'VERIFIED'/);
  assert.doesNotMatch(management, /series_team_assignments/);
  assert.doesNotMatch(reader, /chapter-access\?series=/);
});

test("reader settings expose professional manga controls and persistence", async () => {
  const settings = await read(
    "components/nyascans/ReaderSettingsPanel.tsx",
  );

  for (const label of [
    "Long strip",
    "Single page",
    "Double page",
    "Fit width",
    "Fit height",
    "Original",
    "Smart fit",
    "Image spacing",
    "Brightness",
    "Tap zones",
    "Reading direction",
    "Keep screen awake",
    "Auto mark as read",
    "Preload next chapter",
    "Save reading progress",
    "Remember last reader settings",
    "Restore defaults",
  ]) {
    assert.match(settings, new RegExp(label));
  }
});

test("chapter shortcut workspace includes metadata, page order, and moderation", async () => {
  const [panel, api] = await Promise.all([
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  assert.match(panel, /Chapter management/);
  assert.match(panel, /Chapter information/);
  assert.match(panel, /Pages &amp; order/);
  assert.match(panel, /Chapter comments &amp; moderation/);
  assert.match(api, /path === "admin\/chapter-detail"/);
  assert.match(api, /PAGE_ORDER_CHANGED/);
  assert.match(api, /page_index = page_index \+ 100000/);
});
