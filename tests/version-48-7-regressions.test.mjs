import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  publicPaidChapterPredicate,
  publicPaidSeriesPredicate,
} from "../lib/server/public-content-visibility.ts";

const read = (file) =>
  readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("48.7 comment removal succeeds on the historical schema without revision", async () => {
  const route = await read("app/api/v1/[...resource]/route.ts");
  const deletionBranch = route.slice(
    route.lastIndexOf('if (path !== "discussion-comments")'),
  );
  const baselineSql = deletionBranch.match(
    /const deletion = await env\.DB\.prepare\(\s*`([\s\S]*?)`,\s*\)/u,
  )?.[1];
  assert.ok(baselineSql, "the baseline tombstone SQL must remain extractable");
  assert.doesNotMatch(baselineSql, /revision|deleted_at|deleted_by|deletion_reason/u);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE discussion_comments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        spoiler INTEGER NOT NULL DEFAULT 0,
        moderation_status TEXT NOT NULL DEFAULT 'VISIBLE',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO discussion_comments
        (id, user_id, body, spoiler, moderation_status)
      VALUES ('legacy-comment', 'legacy-owner', 'remove me', 1, 'VISIBLE');
    `);
    const result = database.prepare(baselineSql).run("legacy-comment");
    assert.equal(result.changes, 1);
    assert.deepEqual(
      { ...database.prepare(`
        SELECT body, spoiler, moderation_status AS moderationStatus
          FROM discussion_comments
         WHERE id = 'legacy-comment'
      `).get() },
      { body: "", spoiler: 0, moderationStatus: "DELETED" },
    );
  } finally {
    database.close();
  }

  const baselineStart = deletionBranch.indexOf("const deletion =");
  const baselineFinish = deletionBranch.indexOf(
    "if (Number(deletion.meta.changes",
  );
  const mediaLookup = deletionBranch.indexOf("FROM discussion_media");
  assert.ok(baselineStart >= 0 && baselineFinish > baselineStart);
  assert.ok(mediaLookup > baselineFinish, "attachment discovery must follow the durable tombstone");
  assert.match(deletionBranch, /!isGlobalModerator\(actor\)/u);
  assert.match(deletionBranch, /alreadyDeleted: true/u);
});

test("48.7 private commerce keeps paid series public and filters only paid chapters", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE commercial_settings (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        settings_json TEXT NOT NULL
      );
      CREATE TABLE feature_flags (
        key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL
      );
      CREATE TABLE series (
        id TEXT PRIMARY KEY,
        access_type TEXT NOT NULL
      );
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        access_type TEXT NOT NULL,
        free_at TEXT
      );
      CREATE TABLE content_visibility_overrides (
        chapter_id TEXT PRIMARY KEY,
        access_type TEXT,
        auto_free_exempt INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO commercial_settings VALUES
        ('active', 1, '{"economy":{"premiumEconomyPublic":false}}');
      INSERT INTO feature_flags VALUES ('premium_unlocks', 1);
      INSERT INTO series VALUES
        ('mixed-paid-series', 'PAID'),
        ('paid-only-series', 'PAID');
      INSERT INTO chapters VALUES
        ('free-chapter', 'mixed-paid-series', 'FREE', NULL),
        ('paid-chapter', 'mixed-paid-series', 'PAID', NULL),
        ('scheduled-free', 'mixed-paid-series', 'PAID', datetime('now', '-1 day')),
        ('only-paid', 'paid-only-series', 'PAID', NULL);
    `);

    const visibilityQuery = `
      SELECT s.id,
             COUNT(CASE WHEN ${publicPaidChapterPredicate("c", "visibility_override")} THEN 1 END) AS visibleChapters
        FROM series s
        LEFT JOIN chapters c ON c.series_id = s.id
        LEFT JOIN content_visibility_overrides visibility_override
          ON visibility_override.chapter_id = c.id
       WHERE ${publicPaidSeriesPredicate("s")}
       GROUP BY s.id
       ORDER BY s.id
    `;
    assert.deepEqual(database.prepare(visibilityQuery).all().map((row) => ({ ...row })), [
      { id: "mixed-paid-series", visibleChapters: 2 },
      { id: "paid-only-series", visibleChapters: 0 },
    ]);

    database.prepare(`
      UPDATE commercial_settings
         SET settings_json = '{"economy":{"premiumEconomyPublic":true}}'
       WHERE id = 'active'
    `).run();
    assert.deepEqual(database.prepare(visibilityQuery).all().map((row) => ({ ...row })), [
      { id: "mixed-paid-series", visibleChapters: 3 },
      { id: "paid-only-series", visibleChapters: 1 },
    ]);
  } finally {
    database.close();
  }
});

test("48.7 Latest Updates paginates releases at 15 and matches the phone list contract", async () => {
  const [app, route, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/globals.css"),
  ]);
  const latest = app.slice(
    app.indexOf("function LatestUpdatesGrid"),
    app.indexOf("function LatestUpdatesView"),
  );
  const latestRoute = route.slice(
    route.indexOf('if (path === "latest-releases")'),
    route.indexOf('if (path === "search")'),
  );
  const authority = css.slice(css.lastIndexOf("Version 48.7.0"));

  assert.match(latest, /pageSize = 12/u);
  assert.match(latest, /useHomeTable \? 15 : pageSize/u);
  assert.match(latest, /<th scope="col">Status<\/th>/u);
  assert.match(latest, /onPointerDown=\{beginPageSwipe\}/u);
  assert.match(latestRoute, /if \(presentation === "table"\)[\s\S]*const resultPageSize = 15/u);
  assert.match(latestRoute, /SELECT COUNT\(\*\) AS count[\s\S]*FROM chapters c/u);
  assert.doesNotMatch(latestRoute, /COUNT\(DISTINCT s\.id\) AS count[\s\S]*presentation === "table"/u);
  assert.match(authority, /\.latest-style-toggle[\s\S]*inline-size: 2\.75rem/u);
  assert.match(authority, /@media \(max-width: 780px\)[\s\S]*\.latest-release-table thead[\s\S]*display: none/u);
  assert.match(authority, /\.latest-release-table tbody tr > :nth-child\(4\)[\s\S]*grid-row: 2/u);
  assert.match(authority, /\.latest-release-table tbody tr > :nth-child\(3\)[\s\S]*display: none/u);
});

test("48.7 editorial effects and chapter layout remain explicit and motion-safe", async () => {
  const [app, pins, hot, css, cleanup] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/HomeFeatureSections.tsx"),
    read("components/nyascans/HotThisWeek.tsx"),
    read("app/globals.css"),
    read("drizzle/0050_remove_revised_release_labels.sql"),
  ]);
  const authority = css.slice(css.lastIndexOf("Version 48.7.0"));

  assert.match(app, /function sanitizeChapterTitle/u);
  assert.match(app, /className="chapter-team-status-line"/u);
  assert.match(cleanup, /fixture_v2_%/u);
  assert.match(pins, /data-active=\{active \? "true" : "false"\}/u);
  assert.match(pins, /className="v481-featured-badge">Featured Pin/u);
  assert.match(pins, /className="v481-pinned-arrow is-previous"/u);
  assert.match(pins, /data-pin-position=\{position\}/u);
  assert.match(pins, /\(\[-1, 0, 1\] as const\)/u);
  assert.match(hot, /is-top-\$\{record\.rank\}/u);
  assert.match(authority, /\.editors-pick-card::before/u);
  assert.match(authority, /font-family: Georgia, "Times New Roman", serif/u);
  assert.match(authority, /grid-column: 2;[\s\S]*\.event-campaign-modal\.floating-home-ad \.event-campaign-shade/u);
  assert.match(authority, /\.chapter-action-bar > \*[\s\S]*grid-column: auto !important/u);
  assert.match(authority, /@media \(prefers-reduced-motion: reduce\)/u);
});
