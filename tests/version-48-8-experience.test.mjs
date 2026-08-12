import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const names = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const name of names) {
    database.exec(
      (await read(`drizzle/${name}`)).replaceAll("--> statement-breakpoint", ""),
    );
  }
  return database;
}

test("48.8 restores ranked light effects and makes Latest Updates views exclusive", async () => {
  const [app, features, discovery, hot, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/HomeFeatureSections.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("components/nyascans/HotThisWeek.tsx"),
    read("app/globals.css"),
  ]);
  const authority = css.slice(css.lastIndexOf("Version 48.8.0"));

  assert.match(app, /aria-pressed=\{homeStyle === "classic"\}/u);
  assert.match(app, /aria-pressed=\{homeStyle === "table"\}/u);
  assert.match(app, /data-latest-style=\{homeStyle\}/u);
  assert.match(app, /slice\(0, heading && !pagination \? 2 : 4\)/u);
  assert.match(authority, /\.latest-feed-status \.chapter-status-badge[\s\S]*min-width: 4\.6rem/u);
  assert.match(authority, /\.chapter-reactions-box > \.chapter-reaction-options:last-child/u);
  assert.match(hot, /is-top-\$\{record\.rank\}/u);
  assert.match(authority, /\.hot-week-card\.is-top-1 \{ --hot-rank-a:/u);
  assert.match(authority, /\.hot-week-card\.is-top-2 \{ --hot-rank-a:/u);
  assert.match(authority, /\.hot-week-card\.is-top-3 \{ --hot-rank-a:/u);
  assert.match(app, /className="editors-pick-fleur"[^>]*>⚜/u);
  assert.match(authority, /\.editors-pick-section[\s\S]*#211044/u);
  assert.match(discovery, /public-teams\?limit=7/u);
  assert.match(discovery, /record\.rank <= 3/u);
  assert.match(authority, /\.public-teams \.team-carousel-card\.is-ranked-1/u);
  assert.match(features, /\(\[-1, 0, 1\] as const\)/u);
  assert.match(features, /data-pin-position=\{position\}/u);
  assert.match(authority, /\.featured-main-card::before/u);
  assert.match(authority, /@keyframes v488-fire-wave/u);
});

test("48.8 paid chapters and typed announcements share motion-safe whole-box effects", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const authority = css.slice(css.lastIndexOf("Version 48.8.0"));

  assert.match(app, /const groupPaid =[\s\S]*release\.accessType === "PAID"/u);
  assert.match(app, /chapter-release-group\$\{groupPaid \? " is-paid" : ""\}/u);
  assert.match(app, /chapter-variant-row\$\{chapter\.accessType === "PAID" && !groupPaid/u);
  assert.match(authority, /\.chapter-release-group\.is-paid::after/u);
  assert.match(authority, /background: conic-gradient\(from var\(--v487-gold-angle\)/u);
  assert.match(authority, /\.home-announcement-slider > article::after/u);
  assert.match(authority, /var\(--announcement-tone\)/u);
  assert.match(authority, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.featured-main-card::after/u);
});

test("48.8 supports two independently colored active floating-ad slots", async () => {
  const [schema, migration, adminRoute, publicRoute, app, panel, css] = await Promise.all([
    read("db/schema.ts"),
    read("drizzle/0051_nasty_morg.sql"),
    read("app/api/v1/admin/home-promotions/route.ts"),
    read("app/api/v1/home-promotions/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/admin/HomePromotionsPanel.tsx"),
    read("app/globals.css"),
  ]);
  const authority = css.slice(css.lastIndexOf("Version 48.8.0"));

  assert.match(schema, /floating_ads_active_slot_uidx/u);
  assert.doesNotMatch(schema, /floating_ads_single_active_uidx/u);
  assert.match(schema, /displaySlot: integer\("display_slot"\)/u);
  assert.match(migration, /'#65B5FF', '#8B5CF6', '#07111C'/u);
  assert.match(adminRoute, /campaignColorSchema/u);
  assert.match(adminRoute, /display_slot = \?/u);
  assert.match(publicRoute, /ORDER BY display_slot/u);
  assert.match(publicRoute, /LIMIT 2/u);
  assert.match(publicRoute, /floatingAds,/u);
  assert.match(app, /revealDelay=\{activeIndex === 0 \? 450 : 2_000\}/u);
  assert.match(app, /--campaign-primary/u);
  assert.match(panel, /Display slot/u);
  assert.match(panel, /Primary light/u);
  assert.match(authority, /\.event-campaign-modal\.floating-home-ad::after/u);

  const database = await migratedDatabase();
  try {
    database.prepare("INSERT INTO floating_ads (id, title, reset_key, display_slot, is_active) VALUES (?, ?, ?, ?, 1)").run("ad_slot_1", "Ad one", "reset-1", 1);
    database.prepare("INSERT INTO floating_ads (id, title, reset_key, display_slot, is_active) VALUES (?, ?, ?, ?, 1)").run("ad_slot_2", "Ad two", "reset-2", 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM floating_ads WHERE is_active = 1").get().count, 2);
    assert.throws(() => database.prepare("INSERT INTO floating_ads (id, title, reset_key, display_slot, is_active) VALUES (?, ?, ?, ?, 1)").run("ad_slot_collision", "Collision", "reset-3", 1), /UNIQUE/u);
    assert.deepEqual(database.prepare("SELECT display_slot AS slot FROM floating_ads WHERE is_active = 1 ORDER BY display_slot").all().map((row) => row.slot), [1, 2]);
  } finally {
    database.close();
  }
});

test("48.8 admin teams, requests, and phone navigation expose controlled detail", async () => {
  const [teamRoute, teamPanel, requestRoute, requestPanel, adminCss] = await Promise.all([
    read("app/api/v1/admin/team-management/route.ts"),
    read("components/nyascans/admin/TeamManagementPanel.tsx"),
    read("app/api/v1/admin/team-requests/route.ts"),
    read("components/nyascans/admin/TeamRequestsPanel.tsx"),
    read("app/admin.css"),
  ]);

  assert.match(teamRoute, /AS releaseCount/u);
  assert.match(teamRoute, /'chapterCount'/u);
  assert.match(teamPanel, /AdminStatTile/u);
  assert.match(teamPanel, /admin-team-series-disclosure/u);
  assert.match(teamPanel, /admin-team-chapter-disclosure/u);
  assert.match(teamPanel, /draft\.staffBadgeUrl \? <img/u);
  assert.match(requestRoute, /requested_slug AS requestedSlug/u);
  assert.match(requestPanel, /className="team-request-card"/u);
  assert.match(requestPanel, /AdminEmptyState/u);
  const finalDrawer = adminCss.slice(adminCss.lastIndexOf("Final 48.8 phone drawer authority"));
  assert.match(finalDrawer, /display: flex !important/u);
  assert.match(finalDrawer, /flex: 1 1 auto !important/u);
  assert.match(finalDrawer, /overflow-y: auto !important/u);
  assert.doesNotMatch(finalDrawer, /display: initial/u);
});
