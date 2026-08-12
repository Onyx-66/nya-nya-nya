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

test("Version 31 migration preserves valid relational contracts", async () => {
  const database = await migratedDatabase();
  const columns = (table) =>
    new Set(
      database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );

  assert.ok(columns("series").has("slider_key"));
  assert.ok(columns("custom_reactions").has("usage_kind"));
  assert.ok(columns("roulette_spins").has("spin_mode"));
  assert.ok(columns("roulette_spins").has("cost_shards"));
  assert.ok(columns("roulette_spins").has("charge_transaction_id"));
  assert.ok(columns("support_tickets").has("requester_user_id"));
  assert.ok(columns("support_tickets").has("revision"));
  assert.ok(columns("support_ticket_messages").has("ticket_id"));
  assert.ok(columns("discussion_comment_gifs").has("gif_id"));
  assert.ok(columns("discussion_comments").has("cosmetic_item_id"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("Library transfer includes complete progress and merges safely", async () => {
  const [workspace, exportRoute, importRoute, progressRoute] = await Promise.all([
    read("components/nyascans/LibraryWorkspace.tsx"),
    read("app/api/v1/library-export/route.ts"),
    read("app/api/v1/library-import/route.ts"),
    read("app/api/v1/continue-reading/route.ts"),
  ]);

  assert.match(workspace, /Import Library Data/u);
  assert.match(workspace, /accept="application\/json,\.json"/u);
  assert.match(exportRoute, /version: "2\.0"/u);
  for (const field of [
    "progressBasisPoints",
    "scrollOffset",
    "completedAt",
    "favorite",
    "notificationsEnabled",
  ]) {
    assert.match(exportRoute, new RegExp(field, "u"));
  }
  assert.match(importRoute, /ON CONFLICT\(user_id, chapter_id\) DO UPDATE SET/u);
  assert.match(importRoute, /authoritativeLibraryState/u);
  assert.match(importRoute, /is_favorite = CASE WHEN \? = 1/u);
  assert.match(importRoute, /page_index = MAX\(/u);
  assert.match(importRoute, /progress_basis_points = MAX\(/u);
  assert.match(
    importRoute,
    /excluded\.scroll_offset > reading_progress\.scroll_offset/u,
  );
  assert.match(
    importRoute,
    /reading_progress\.completed_at IS NULL[\s\S]+excluded\.completed_at IS NOT NULL/u,
  );
  assert.doesNotMatch(importRoute, /\bDELETE FROM (library_entries|reading_progress)\b/u);
  assert.match(
    progressRoute,
    /COUNT\(DISTINCT completed_chapter\.chapter_number\)/u,
  );
  assert.match(progressRoute, /completed_chapter\.state = 'PUBLISHED'/u);
  assert.match(progressRoute, /\) AS chaptersRead/u);
  assert.match(progressRoute, /\) AS chaptersTotal/u);
});

test("paid Roulette spins use an admin-configured Shard charge", async () => {
  const [route, settings, admin, view] = await Promise.all([
    read("app/api/v1/roulette/route.ts"),
    read("lib/reward-settings.ts"),
    read("components/nyascans/admin/RewardSettingsPanel.tsx"),
    read("components/nyascans/RouletteView.tsx"),
  ]);

  assert.match(settings, /roulettePaidSpinsEnabled/u);
  assert.match(settings, /roulettePaidSpinShardCost/u);
  assert.match(admin, /Allow extra spins paid with Shards/u);
  assert.match(route, /mode:\s*z\.enum\(\["DAILY", "PAID"\]\)/u);
  assert.match(route, /ROULETTE_SPIN_PURCHASE/u);
  assert.match(route, /INSUFFICIENT_SHARDS/u);
  assert.match(route, /PAID_SPINS_DISABLED/u);
  assert.match(route, /await db\.batch\(statements\)/u);
  assert.match(route, /INSERT OR IGNORE INTO ledger_transactions/u);
  assert.match(route, /replayedSpin/u);
  assert.match(
    route,
    /NOT EXISTS \([\s\S]+FROM user_store_items owned_reward/u,
  );
  assert.match(route, /INSERT INTO user_store_items/u);
  assert.doesNotMatch(route, /INSERT OR IGNORE INTO user_store_items/u);
  assert.match(route, /ROULETTE_REWARD_UNAVAILABLE/u);
  assert.match(view, /spin\("PAID"\)/u);
  assert.match(view, /paidSpinCostShards/u);
  assert.match(
    view,
    /mode === "PAID" \? `PAID_\$\{selectedPaidCurrency\}` : mode/u,
  );
  assert.match(view, /spinKeys\.current\[spinKey\] \?\? clientId\(\)/u);
  assert.match(view, /spinKeys\.current\[spinKey\] = null/u);
  assert.match(route, /si\.is_published = 1/u);
  assert.match(route, /si\.is_hidden = 0/u);
});

test("comments expose real avatars, chapter attribution, curated GIFs, and cosmetics", async () => {
  const [
    route,
    view,
    admin,
    storefront,
    reactionMedia,
    reactionAdminRoute,
  ] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("components/nyascans/admin/ReactionLibraryPanel.tsx"),
    read("lib/storefront.ts"),
    read("app/api/v1/admin/reaction-media/route.ts"),
    read("app/api/v1/admin/reaction-library/route.ts"),
  ]);

  assert.match(route, /avatarUrl:/u);
  assert.match(route, /chapterNumber:/u);
  assert.match(route, /commentCosmetic:/u);
  assert.match(route, /dc\.cosmetic_item_id/u);
  assert.match(route, /cosmetic_item_id, parent_id/u);
  assert.match(route, /usage_kind = 'COMMENT_GIF'/u);
  assert.match(route, /GIF_RESTRICTED/u);
  assert.match(view, /comment\.avatarUrl/u);
  assert.match(view, /comment\.chapterNumber/u);
  assert.match(view, /comment\.commentCosmetic/u);
  assert.match(view, /selectedGifIds/u);
  assert.match(admin, /Comment GIF/u);
  assert.match(storefront, /commentOpacity/u);
  assert.match(storefront, /\.default\(65\)/u);
  assert.match(reactionMedia, /COMMENT_GIF_IN_USE/u);
  assert.match(
    reactionMedia,
    /if \(Number\(current\.gifUsageCount\) > 0\)/u,
  );
  assert.match(reactionAdminRoute, /REACTION_USAGE_KIND_IMMUTABLE/u);
});

test("media uploads compress and team artwork uses canonical crops", async () => {
  const [optimizer, mediaField, teams, series, profile, requests] =
    await Promise.all([
      read("lib/client/media-optimizer.ts"),
      read("components/nyascans/admin/AdminMediaField.tsx"),
      read("components/nyascans/admin/TeamManagementPanel.tsx"),
      read("components/nyascans/admin/SeriesManagementPanel.tsx"),
      read("components/nyascans/ProfileSettingsWorkspace.tsx"),
      read("components/nyascans/upload/SeriesRequestWorkspace.tsx"),
    ]);

  assert.match(optimizer, /createImageBitmap/u);
  assert.match(optimizer, /optimizeStaticMedia/u);
  assert.match(optimizer, /cropStaticMedia/u);
  assert.match(optimizer, /export function computeCropRect/u);
  assert.match(mediaField, /cropProfile/u);
  assert.match(teams, /outputWidth:\s*800/u);
  assert.match(teams, /outputWidth:\s*1920/u);
  assert.match(series, /outputWidth:\s*1200/u);
  assert.match(profile, /optimizeStaticMedia/u);
  assert.match(requests, /optimizeStaticMedia/u);
});

test("support, slider artwork, analytics, and mobile Upload Center are functional", async () => {
  const [
    supportRoute,
    supportAdminRoute,
    supportView,
    supportAdminView,
    navigation,
    app,
    seriesAdmin,
    analytics,
    styles,
    adminStyles,
  ] =
    await Promise.all([
      read("app/api/v1/support-tickets/route.ts"),
      read("app/api/v1/admin/support-tickets/route.ts"),
      read("components/nyascans/SupportTicketPanel.tsx"),
      read("components/nyascans/admin/SupportTicketsAdminPanel.tsx"),
      read("lib/admin-navigation.ts"),
      read("components/nyascans/NyaScansApp.tsx"),
      read("components/nyascans/admin/SeriesManagementPanel.tsx"),
      read("components/nyascans/OperationsControlPanel.tsx"),
      read("app/globals.css"),
      read("app/admin.css"),
    ]);

  assert.match(supportRoute, /requireActor/u);
  assert.match(supportRoute, /requester_user_id = \?/u);
  assert.match(supportRoute, /export async function PUT/u);
  assert.match(supportRoute, /expectedRevision/u);
  assert.match(supportAdminRoute, /requireAdmin/u);
  assert.match(supportAdminRoute, /action:\s*z\.literal\("REPLY"\)/u);
  assert.match(supportAdminRoute, /action:\s*z\.literal\("SET_STATUS"\)/u);
  assert.match(supportAdminRoute, /Support replied to your ticket/u);
  assert.match(supportView, /id="support-ticket-form"/u);
  assert.match(supportView, /Ticket history/u);
  assert.match(supportView, /Reply to support/u);
  assert.match(supportAdminView, /Support [Tt]ickets/u);
  assert.match(supportAdminView, /Send reply/u);
  assert.match(navigation, /slug: "support-tickets"[\s\S]+label: "Support Tickets"/u);
  assert.match(seriesAdmin, /label="Featured slider image"/u);
  assert.match(seriesAdmin, /1200 × 1200 px \(1:1\)/u);
  assert.match(app, /item\.slider \?\? item\.cover/u);
  assert.match(styles, /data-featured-slider-style="kakao-panels"[\s\S]+aspect-ratio:\s*1/u);
  assert.match(analytics, /analytics-data-fallback/u);
  assert.match(analytics, /<title>/u);
  assert.match(adminStyles, /\.admin-subnav/u);
  assert.match(adminStyles, /@media \(max-width: 1023px\)[\s\S]+transform: translateX\(-100%\)/u);
});
