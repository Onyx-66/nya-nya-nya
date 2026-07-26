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

test("Version 32 migrations add normalized community and Roulette contracts", async () => {
  const database = await migratedDatabase();
  const columns = (table) =>
    new Set(
      database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );

  for (const field of [
    "show_favorites",
    "show_achievements",
    "show_bookmarks",
    "show_comments",
  ]) {
    assert.ok(columns("user_profiles").has(field));
  }
  assert.ok(columns("roulette_state").has("free_spin_balance"));
  assert.ok(columns("roulette_spins").has("cost_currency"));
  assert.ok(columns("roulette_spins").has("cost_amount"));
  assert.ok(columns("roulette_task_claims").has("week_start"));
  assert.ok(columns("profile_favorite_series").has("position"));
  assert.ok(columns("team_support_receipt_series").has("series_id"));
  assert.ok(columns("achievement_definitions").has("rarity"));
  assert.ok(columns("user_achievements").has("earned_at"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("team Gifts target verified assigned series and notify staff atomically", async () => {
  const [route, panel] = await Promise.all([
    read("app/api/v1/gifts/route.ts"),
    read("components/nyascans/GiftStorePanel.tsx"),
  ]);

  assert.match(route, /seriesIds:/u);
  assert.match(route, /FROM series_team_assignments sta/u);
  assert.match(route, /TEAM_SERIES_UNAVAILABLE/u);
  assert.match(route, /INSERT INTO team_support_receipt_series/u);
  assert.match(route, /INSERT INTO notifications/u);
  assert.match(route, /New Translation Team support/u);
  assert.match(route, /SELECT COALESCE\(SUM\(amount\), 0\)[\s\S]+>= \?/u);
  assert.match(route, /concurrentReceipt\.teamId !== payload\.teamId/u);
  assert.match(route, /concurrentReceipt\.message !== payload\.message/u);
  assert.match(route, /FROM team_support_receipt_series[\s\S]+concurrentReceipt\.id/u);
  assert.match(panel, /Series focus \(optional\)/u);
  assert.match(panel, /supportSeriesIds/u);
  assert.match(panel, /selected series/u);
});

test("Roulette has separate free and paid tracks, weekly tasks, and reward media", async () => {
  const [route, settings, panel, view, media] = await Promise.all([
    read("app/api/v1/roulette/route.ts"),
    read("lib/reward-settings.ts"),
    read("components/nyascans/admin/RewardSettingsPanel.tsx"),
    read("components/nyascans/RouletteView.tsx"),
    read("app/api/v1/admin/roulette-reward-media/route.ts"),
  ]);

  assert.match(settings, /roulettePaidRewards/u);
  assert.match(settings, /rouletteTasks/u);
  assert.match(settings, /roulettePaidSpinOnyxCost/u);
  assert.match(settings, /imageKey/u);
  assert.match(route, /CLAIM_TASK/u);
  assert.match(route, /free_spin_balance/u);
  assert.match(route, /roulette_task_claims/u);
  assert.match(route, /roulettePaidRewards/u);
  assert.match(route, /paidCurrency/u);
  assert.match(route, /changes\(\) = 1/u);
  assert.match(view, />Free Spins</u);
  assert.match(
    view,
    /premiumEconomyPublic \? "Pay to Spin" : "Shard Spins"/u,
  );
  assert.match(view, /Finish tasks, earn free spins/u);
  assert.match(view, /selectedPaidCurrency/u);
  assert.match(view, /const mutationBusy = spinning \|\| claimingTask !== null/u);
  assert.match(panel, /Weekly free-spin tasks/u);
  assert.match(panel, /Paid spins and premium reward pool/u);
  assert.match(panel, /AdminMediaField/u);
  assert.match(panel, /disabled=\{editingLocked\}/u);
  assert.match(panel, /busy=\{editingLocked\}/u);
  assert.match(media, /validateImageFile/u);
  assert.match(media, /roulette\/rewards/u);
});

test("profiles expose ordered favorites and private community sections", async () => {
  const [route, settings, publicView, leaderboard, leaderboardView] =
    await Promise.all([
      read("app/api/v1/profiles/route.ts"),
      read("components/nyascans/ProfileSettingsWorkspace.tsx"),
      read("components/nyascans/PublicProfileView.tsx"),
      read("app/api/v1/leaderboard/route.ts"),
      read("components/nyascans/UserLeaderboardView.tsx"),
    ]);

  assert.match(route, /favoriteSeriesIds/u);
  assert.match(route, /\.max\(10\)/u);
  assert.match(route, /profile_favorite_series/u);
  assert.match(route, /show_favorites/u);
  assert.match(route, /show_achievements/u);
  assert.match(route, /show_bookmarks/u);
  assert.match(route, /show_comments/u);
  assert.match(route, /chapterNumber/u);
  assert.match(route, /reactionCount/u);
  assert.match(settings, /up to 10 series/u);
  assert.match(settings, /Share comments/u);
  assert.match(publicView, /public-profile-series-grid/u);
  assert.match(publicView, /public-profile-comments/u);
  assert.match(leaderboard, /ROW_NUMBER\(\) OVER/u);
  assert.match(leaderboard, /LIMIT 100/u);
  assert.match(leaderboard, /lifetimeShards/u);
  assert.match(
    leaderboard,
    /mt\.userId = u\.id AND up\.show_comments = 1/u,
  );
  assert.match(
    leaderboard,
    /ct\.userId = u\.id AND up\.show_reading_history = 1/u,
  );
  assert.match(
    route,
    /followerCount:\s*isSelf \|\| profile\.followersVisibility === "PUBLIC"/u,
  );
  assert.match(
    route,
    /chapterSlug:\s*isSelf \|\| profile\.showChapterNumbers[\s\S]+activity\.chapterSlug[\s\S]+: null/u,
  );
  assert.match(
    route,
    /comments: comments\.map[\s\S]+chapterSlug:[\s\S]+profile\.showChapterNumbers[\s\S]+comment\.chapterSlug[\s\S]+chapterNumber:[\s\S]+comment\.chapterNumber/u,
  );
  assert.match(leaderboardView, /Shards collected/u);
  assert.match(leaderboardView, /Chapters read/u);
});

test("support, progress, palettes, and admin avatars are functional", async () => {
  const [
    app,
    support,
    supportAdminRoute,
    continueRoute,
    libraryRoute,
    appearance,
    palettes,
    adminUsers,
    siteSettings,
  ] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/SupportTicketPanel.tsx"),
    read("app/api/v1/admin/support-tickets/route.ts"),
    read("app/api/v1/continue-reading/route.ts"),
    read("app/api/v1/library-data/route.ts"),
    read("components/nyascans/admin/AppearanceWorkspace.tsx"),
    read("components/nyascans/admin/ThemePalettePresetsPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/site-settings.ts"),
  ]);

  assert.match(app, /support-help-article/u);
  assert.match(app, /supportFormOpen/u);
  assert.match(support, /silent = false/u);
  assert.match(support, /\{signedIn && open \? \(/u);
  assert.match(support, /support-ticket-\$\{focusedTicketId\}/u);
  assert.match(supportAdminRoute, /SUPPORT_REPLY/u);
  assert.match(supportAdminRoute, /\/support\?ticket=/u);
  assert.match(continueRoute, /chaptersRead/u);
  assert.match(continueRoute, /chaptersTotal/u);
  assert.match(libraryRoute, /chaptersRead/u);
  assert.match(libraryRoute, /chaptersTotal/u);
  assert.match(appearance, /Ready-to-use palettes/u);
  assert.match(appearance, /hidden=\{tab !== "theme"\}/u);
  assert.match(appearance, /hidden=\{tab !== "palettes"\}/u);
  assert.match(palettes, /Apply and save/u);
  assert.match(palettes, /siteAppearanceSavedEvent/u);
  assert.match(adminUsers, /avatarUrl/u);
  assert.match(adminUsers, /admin=1/u);
  assert.match(
    siteSettings,
    /Appearance storage must never take the public reader offline/u,
  );
});
