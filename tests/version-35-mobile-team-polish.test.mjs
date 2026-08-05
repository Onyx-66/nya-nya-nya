import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("publishing-team aggregates count unique public followers and releases", async () => {
  const [source, schema, migration] = await Promise.all([
    read("app/api/v1/public-teams/route.ts"),
    read("db/schema.ts"),
    read("drizzle/0025_swift_nuke.sql"),
  ]);
  assert.match(schema, /follows_series_user_idx/u);
  assert.match(
    migration,
    /CREATE INDEX `follows_series_user_idx` ON `follows` \(`series_id`,`user_id`\)/u,
  );
  const query = source.match(
    /const records = await env\.DB\.prepare\(\s*`([\s\S]*?)`,\s*\)\s*\.bind\(limit\)/u,
  )?.[1];
  assert.ok(query, "public teams SQL should be extractable for regression testing");

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE teams (
      id TEXT PRIMARY KEY, slug TEXT, name TEXT, description TEXT,
      revision INTEGER, logo_key TEXT, banner_key TEXT,
      is_archived INTEGER, verification_status TEXT
    );
    CREATE TABLE series (
      id TEXT PRIMARY KEY, is_published INTEGER, archived_at TEXT,
      status TEXT, rights_status TEXT, slug TEXT
    );
    CREATE TABLE series_team_assignments (
      team_id TEXT, series_id TEXT, revoked_at TEXT
    );
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY, series_id TEXT, team_id TEXT,
      state TEXT, visibility TEXT, published_at TEXT, language TEXT
    );
    CREATE TABLE follows (user_id TEXT, series_id TEXT);
    CREATE TABLE analytics_events (
      id TEXT PRIMARY KEY, event_type TEXT, series_slug TEXT
    );
    CREATE TABLE discussion_comments (
      id TEXT PRIMARY KEY, series_slug TEXT, moderation_status TEXT,
      deleted_at TEXT
    );

    INSERT INTO teams VALUES
      ('team-1', 'team-one', 'Team One', '', 1, NULL, NULL, 0, 'VERIFIED');
    INSERT INTO series VALUES
      ('series-1', 1, NULL, 'ONGOING', 'AUTHORIZED', 'series-one'),
      ('series-2', 1, NULL, 'ONGOING', 'LICENSED', 'series-two'),
      ('series-draft', 0, NULL, 'DRAFT', 'AUTHORIZED', 'series-draft'),
      ('series-revoked', 1, NULL, 'ONGOING', 'AUTHORIZED', 'series-revoked');
    INSERT INTO series_team_assignments VALUES
      ('team-1', 'series-1', NULL),
      ('team-1', 'series-2', NULL),
      ('team-1', 'series-draft', NULL),
      ('team-1', 'series-revoked', '2025-01-01T00:00:00Z');
    INSERT INTO follows VALUES
      ('reader-a', 'series-1'),
      ('reader-a', 'series-2'),
      ('reader-b', 'series-1'),
      ('reader-c', 'series-draft'),
      ('reader-d', 'series-revoked');
    INSERT INTO chapters VALUES
      ('chapter-public', 'series-1', 'team-1', 'PUBLISHED', 'PUBLIC', '2020-01-01T00:00:00Z', 'en'),
      ('chapter-future', 'series-2', 'team-1', 'PUBLISHED', 'PUBLIC', '2999-01-01T00:00:00Z', 'en'),
      ('chapter-draft-series', 'series-draft', 'team-1', 'PUBLISHED', 'PUBLIC', '2020-01-01T00:00:00Z', 'en'),
      ('chapter-revoked', 'series-revoked', 'team-1', 'PUBLISHED', 'PUBLIC', '2020-01-01T00:00:00Z', 'en'),
      ('chapter-private', 'series-1', 'team-1', 'PUBLISHED', 'PRIVATE', '2020-01-01T00:00:00Z', 'en');
  `);

  const row = database.prepare(query).get(10);
  assert.equal(Number(row.publicSeriesCount), 2);
  assert.equal(Number(row.releaseCount), 2);
  assert.equal(Number(row.followerCount), 3);
  database.close();
});

test("publishing teams expose a complete privacy-safe public experience", async () => {
  const [cardsApi, teamApi, cards, teamView] = await Promise.all([
    read("app/api/v1/public-teams/route.ts"),
    read("app/api/v1/public-team/route.ts"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("components/nyascans/PublicTeamView.tsx"),
  ]);

  assert.match(cardsApi, /COUNT\(DISTINCT team_follow\.user_id\)/u);
  assert.match(cardsApi, /WITH public_releases AS/u);
  assert.match(cardsApi, /public_team_followers AS/u);
  assert.match(cardsApi, /followerCount:\s*Number\(record\.followerCount\)/u);
  assert.match(cards, /\{record\.releaseCount\} releases/u);
  assert.match(cards, /\{record\.followerCount\} followers/u);

  assert.match(teamApi, /latestReleases:/u);
  assert.match(teamApi, /pinnedComments:/u);
  assert.match(teamApi, /dc\.deleted_at IS NULL/u);
  assert.match(teamApi, /pinned_chapter\.access_type = 'FREE'/u);
  assert.match(teamApi, /tm\.status = 'ACTIVE'/u);
  assert.match(
    teamApi,
    /premiumEconomyPublic && supportSummaryRow[\s\S]+supporterCount/u,
  );
  const publicPayload = teamApi.slice(teamApi.indexOf("return json("));
  assert.doesNotMatch(publicPayload, /supporter_user_id/u);
  assert.doesNotMatch(publicPayload, /\bmessage:\s*support/u);

  for (const label of [
    "Published series",
    "Latest releases",
    "Pinned team comments",
    "Community support",
  ]) {
    assert.ok(teamView.includes(label));
  }
  assert.match(teamView, /\{team\.followerCount\}/u);
  assert.match(teamView, /Spoiler-tagged team note/u);
});

test("mobile discovery, profile and Browse controls stay inside the viewport", async () => {
  const [app, profile, profileSettings, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/PublicProfileView.tsx"),
    read("components/nyascans/ProfileSettingsWorkspace.tsx"),
    read("app/globals.css"),
  ]);
  const finalCss = css.slice(css.lastIndexOf("Version 35"));
  const browseSummary = app.slice(
    app.indexOf('<div className="catalog-summary">'),
    app.indexOf("{moreOpen ?", app.indexOf('<div className="catalog-summary">')),
  );

  assert.doesNotMatch(browseSummary, /pagination\.total/u);
  assert.match(browseSummary, /catalog-sort-control/u);
  assert.match(browseSummary, /catalog-page-size-control/u);
  assert.match(
    finalCss,
    /\.catalog-summary > div[\s\S]+grid-template-columns:\s*minmax\(0, 1fr\) 44px 44px/u,
  );
  assert.match(
    finalCss,
    /\.profile-media-composer\s*\{[\s\S]*?overflow:\s*hidden/u,
  );
  assert.match(
    finalCss,
    /\.profile-media-action\.is-banner[\s\S]+max-width:\s*calc\(100% - 1\.5rem\)/u,
  );
  assert.match(profile, /public-profile-series-grid/u);
  assert.match(profileSettings, /profile-favorite-cover/u);
  assert.match(profileSettings, /Move \$\{favorite\.seriesTitle\} left/u);
  assert.match(profileSettings, /Move \$\{favorite\.seriesTitle\} right/u);
  assert.match(finalCss, /grid-auto-flow:\s*column/u);
  assert.match(finalCss, /scroll-snap-type:\s*inline mandatory/u);

  assert.match(
    finalCss,
    /\.featured-edge-card, \.featured-outer-card\)[\s\S]+display:\s*none !important/u,
  );
  assert.match(
    finalCss,
    /\.featured-slider-stage[\s\S]+grid-template-columns:\s*10% minmax\(0, 80%\) 10%/u,
  );
  assert.doesNotMatch(finalCss, /width:\s*108vw/u);
});

test("Roulette cards and comment pickers use semantic, mobile-safe layout", async () => {
  const [roulette, discussion, css] = await Promise.all([
    read("components/nyascans/RouletteView.tsx"),
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("app/globals.css"),
  ]);
  const finalCss = css.slice(css.lastIndexOf("Version 35"));

  assert.match(roulette, /roulette-reward-copy/u);
  assert.match(roulette, /roulette-history-icon/u);
  assert.match(roulette, /roulette-history-copy/u);
  assert.match(roulette, /roulette-tasks-empty/u);
  assert.match(
    finalCss,
    /\.roulette-wheel\s*\{[\s\S]*?width:\s*min\(100%, 420px\)/u,
  );
  assert.match(
    finalCss,
    /grid-template-areas:\s*"icon copy time"/u,
  );
  assert.match(
    finalCss,
    /\.roulette-tasks article > button[\s\S]+grid-column:\s*2/u,
  );

  assert.match(discussion, /aria-modal="true"/u);
  assert.match(discussion, /closeOnOutsidePointer/u);
  assert.match(discussion, /event\.key !== "Tab"/u);
  assert.match(
    finalCss,
    /\.comment-gif-picker,[\s\S]+top:\s*50% !important[\s\S]+left:\s*50% !important/u,
  );
  assert.match(finalCss, /z-index:\s*1500 !important/u);
  assert.match(
    finalCss,
    /\.comment-engagement\s*\{[\s\S]+flex-direction:\s*row/u,
  );
  assert.match(
    finalCss,
    /\.comment-reaction-picker-wrap\s*\{[\s\S]+order:\s*-1/u,
  );
});

test("Store offers are deterministic from the lowest price upward", async () => {
  const [products, app, commercialServer] = await Promise.all([
    read("app/api/v1/store/products/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("lib/server/commercial-settings.ts"),
  ]);

  assert.match(
    commercialServer,
    /commercialSettingsSchema\.safeParse[\s\S]+settings:\s*failClosedCommercialSettings[\s\S]+recoveredFromInvalid:\s*true/u,
  );
  assert.match(
    products,
    /publicCosmeticCurrencyClause[\s\S]+si\.price_currency = 'SHARDS'/u,
  );
  assert.match(
    products,
    /ORDER BY price_minor ASC, sort_order ASC,[\s\S]+name COLLATE NOCASE, id ASC/u,
  );
  assert.match(
    app,
    /setPackages\([\s\S]+Number\(left\.priceMinor\) - Number\(right\.priceMinor\)/u,
  );
  assert.match(
    app,
    /sortedMemberships[\s\S]+billing === "monthly"[\s\S]+monthlyPriceMinor[\s\S]+annualPriceMinor/u,
  );
});
