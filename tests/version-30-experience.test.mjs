import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const migrations = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migrationName of migrations) {
    const migration = await read(`drizzle/${migrationName}`);
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

test("Version 30 binds new Gift Cards to one registered recipient", async () => {
  const database = await migratedDatabase();
  const giftColumns = new Set(
    database
      .prepare("PRAGMA table_info(gift_cards)")
      .all()
      .map((row) => row.name),
  );
  assert.ok(giftColumns.has("recipient_user_id"));

  const recipientForeignKey = database
    .prepare("PRAGMA foreign_key_list(gift_cards)")
    .all()
    .find((row) => row.from === "recipient_user_id");
  assert.equal(recipientForeignKey?.table, "users");

  const indexes = new Set(
    database
      .prepare("PRAGMA index_list(gift_cards)")
      .all()
      .map((row) => row.name),
  );
  assert.ok(indexes.has("gift_cards_recipient_status_idx"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("Gift issue and redemption resolve followed readers or account email server-side", async () => {
  const [route, panel] = await Promise.all([
    read("app/api/v1/gifts/route.ts"),
    read("components/nyascans/GiftStorePanel.tsx"),
  ]);

  assert.match(route, /recipientMode:\s*z\.enum\(\["FOLLOWED", "EMAIL"\]\)/u);
  assert.match(route, /lower\(u\.email\) = \?/u);
  assert.match(route, /FROM user_follows uf[\s\S]+uf\.followed_user_id = \?/u);
  assert.match(route, /u\.status = 'ACTIVE'/u);
  assert.match(route, /recipient_user_id AS recipientUserId/u);
  assert.match(
    route,
    /\(recipient_user_id IS NULL OR recipient_user_id = \?\)/u,
  );
  assert.match(panel, /People you follow/u);
  assert.match(panel, /Reader email/u);
  assert.doesNotMatch(panel, /placeholder="Reader name"/u);
  assert.match(panel, /giftIdempotencyKey = useRef\(requestKey\("gift"\)\)/u);
  assert.match(panel, /idempotencyKey: giftIdempotencyKey\.current/u);
  assert.match(panel, /idempotencyKey: teamIdempotencyKey\.current/u);
});

test("Continue Reading returns the latest progress for up to 12 distinct series", async () => {
  const [route, app] = await Promise.all([
    read("app/api/v1/continue-reading/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  assert.match(route, /ROW_NUMBER\(\) OVER \([\s\S]+PARTITION BY s\.id/u);
  assert.match(route, /WHERE recentRank = 1[\s\S]+LIMIT 12/u);
  assert.match(route, /requireActor\("reader\.progress\.own"\)/u);
  assert.match(route, /continueReadingViewMode/u);
  assert.match(route, /json_set\(/u);
  assert.match(app, /function ContinueReadingSection/u);
  assert.match(app, /Resume one of the last 12 series you opened\./u);
  assert.match(app, /"LIST" \| "SHELF"/u);
  assert.doesNotMatch(
    app.slice(
      app.indexOf("function HomeView"),
      app.indexOf("function LatestUpdatesView"),
    ),
    /the-glass-orchard\/chapter\/episode-30/u,
  );
});

test("desktop featured carousel has three admin-selectable models and banner support", async () => {
  const [theme, settingsPanel, app, api, styles] = await Promise.all([
    read("lib/site-theme.ts"),
    read("components/nyascans/ThemeSettingsPanel.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/globals.css"),
  ]);

  for (const style of ["ASURA_SHOWCASE", "KAKAO_PANELS", "ONYX_DECK"]) {
    assert.match(theme, new RegExp(style, "u"));
  }
  assert.match(theme, /data-featured-slider-style/u);
  assert.match(settingsPanel, /Desktop featured carousel/u);
  assert.match(settingsPanel, /featuredSliderStyleOptions\.map/u);
  assert.match(settingsPanel, /if \(hasLoaded\) applyPreview\(settings\)/u);
  assert.match(settingsPanel, /restoreRootPreview\(rootSnapshot\)/u);
  assert.match(app, /featured-card-banner/u);
  assert.match(app, /data-visible-count=\{/u);
  assert.doesNotMatch(app, /Pause automatic featured series rotation/u);
  assert.doesNotMatch(app, /Resume automatic featured series rotation/u);
  assert.match(api, /slot=banner/u);
  assert.match(api, /s\.banner_key AS bannerKey/u);
  assert.match(
    styles,
    /@media \(min-width: 981px\)[\s\S]+data-featured-slider-style="asura-showcase"[\s\S]+data-featured-slider-style="kakao-panels"/u,
  );
});

test("Roulette uses the server candidate pool and a reward-count-aware wheel", async () => {
  const [route, view, styles] = await Promise.all([
    read("app/api/v1/roulette/route.ts"),
    read("components/nyascans/RouletteView.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(route, /async function availableRewards/u);
  assert.match(route, /availableRewards: candidates/u);
  assert.match(route, /canSpin: eligible && candidates\.length > 0/u);
  assert.match(view, /data\?\.availableRewards/u);
  assert.match(view, /selectedIndex < 0 \|\| reduceMotion/u);
  assert.doesNotMatch(view, /Math\.max\(\s*0,\s*rewards\.findIndex/u);
  assert.match(view, /--roulette-slice/u);
  assert.match(view, /Roulette unavailable/u);
  assert.match(styles, /repeating-conic-gradient\([\s\S]+var\(--roulette-slice\)/u);
});

test("pagination and the operations sidebar expose aligned, accessible controls", async () => {
  const [app, styles] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(app, /label="Show"/u);
  assert.match(styles, /\.catalog-pagination\s*\{[\s\S]*align-items:\s*end/u);
  assert.match(app, /aria-label=\{effectiveSidebarCollapsed \? "Expand sidebar"/u);
  assert.match(app, /aria-controls="operations-navigation"/u);
  assert.match(app, /nyascans-\$\{mode\}-sidebar-collapsed/u);
  assert.match(app, /className="ops-nav-label"/u);
  assert.match(styles, /\.ops-shell\.is-sidebar-collapsed/u);
  assert.match(styles, /\.ops-sidebar nav \.ops-nav-group-toggle > span/u);
});
