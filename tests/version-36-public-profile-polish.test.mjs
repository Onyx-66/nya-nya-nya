import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "u"))?.[1];
}

test("public profile comments expose safe covers from public releases only", async () => {
  const route = await read("app/api/v1/profiles/route.ts");
  const query = route.match(
    /isSelf \|\| Boolean\(profile\.showComments\)\s*\?\s*env\.DB\.prepare\(\s*`([\s\S]*?)`\s*,?\s*\)\s*\.bind\(profile\.userId\)/u,
  )?.[1];
  assert.ok(query, "profile comment SQL should be extractable");
  assert.match(query, /s\.id AS seriesId/u);
  assert.match(query, /s\.cover_key AS coverKey/u);
  assert.match(query, /dc\.spoiler/u);
  assert.match(query, /c\.state = 'PUBLISHED'/u);
  assert.match(query, /c\.visibility = 'PUBLIC'/u);
  assert.match(
    query,
    /datetime\(c\.published_at\) <= datetime\('now'\)/u,
  );
  assert.match(query, /\(dc\.chapter_slug IS NULL OR c\.id IS NOT NULL\)/u);

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE series (
      id TEXT PRIMARY KEY,
      slug TEXT,
      title TEXT,
      revision INTEGER,
      cover_key TEXT,
      is_published INTEGER,
      archived_at TEXT,
      rights_status TEXT
    );
    CREATE TABLE chapters (
      id TEXT PRIMARY KEY,
      series_id TEXT,
      slug TEXT,
      chapter_number TEXT,
      state TEXT,
      visibility TEXT,
      published_at TEXT
    );
    CREATE TABLE discussion_comments (
      id TEXT PRIMARY KEY,
      body TEXT,
      series_slug TEXT,
      spoiler INTEGER,
      chapter_slug TEXT,
      created_at TEXT,
      user_id TEXT,
      moderation_status TEXT,
      deleted_at TEXT
    );
    CREATE TABLE discussion_votes (
      comment_id TEXT,
      value INTEGER
    );
    CREATE TABLE discussion_reactions (
      comment_id TEXT
    );

    INSERT INTO series VALUES
      ('series-public', 'public-series', 'Public Series', 7, 'series/cover.webp', 1, NULL, 'AUTHORIZED'),
      ('series-draft', 'draft-series', 'Draft Series', 1, NULL, 0, NULL, 'AUTHORIZED');
    INSERT INTO chapters VALUES
      ('chapter-public', 'series-public', 'chapter-1', '1', 'PUBLISHED', 'PUBLIC', '2020-01-01T00:00:00Z'),
      ('chapter-hidden', 'series-public', 'chapter-2', '2', 'PUBLISHED', 'HIDDEN', '2020-01-01T00:00:00Z'),
      ('chapter-future', 'series-public', 'chapter-3', '3', 'PUBLISHED', 'PUBLIC', '2999-01-01T00:00:00Z');
    INSERT INTO discussion_comments VALUES
      ('series-note', 'Series note', 'public-series', 0, NULL, '2026-01-01T00:00:00Z', 'reader-1', 'VISIBLE', NULL),
      ('public-note', 'Public chapter note', 'public-series', 1, 'chapter-1', '2026-01-02T00:00:00Z', 'reader-1', 'VISIBLE', NULL),
      ('hidden-note', 'Hidden chapter note', 'public-series', 0, 'chapter-2', '2026-01-03T00:00:00Z', 'reader-1', 'VISIBLE', NULL),
      ('future-note', 'Future chapter note', 'public-series', 0, 'chapter-3', '2026-01-04T00:00:00Z', 'reader-1', 'VISIBLE', NULL),
      ('draft-note', 'Draft series note', 'draft-series', 0, NULL, '2026-01-05T00:00:00Z', 'reader-1', 'VISIBLE', NULL);
  `);

  const rows = database.prepare(query).all("reader-1");
  assert.deepEqual(
    rows.map((row) => row.id),
    ["public-note", "series-note"],
  );
  assert.equal(rows[0].seriesId, "series-public");
  assert.equal(rows[0].coverKey, "series/cover.webp");
  database.close();

  const payload = route.slice(
    route.indexOf("comments: comments.map"),
    route.indexOf("uploads:", route.indexOf("comments: comments.map")),
  );
  assert.match(payload, /coverUrl:\s*seriesCoverUrl\(comment\)/u);
  assert.match(payload, /spoiler:\s*Boolean\(comment\.spoiler\)/u);
  assert.doesNotMatch(payload, /\.\.\.comment/u);
  assert.doesNotMatch(payload, /coverKey:/u);
  assert.doesNotMatch(payload, /seriesId:/u);
  assert.doesNotMatch(payload, /revision:/u);
  assert.match(payload, /media: mediaByComment\.get/);
  assert.match(payload, /gifs: gifsByComment\.get/);
});

test("public profile uses an accessible favorite rail and cover-led records", async () => {
  const view = await read("components/nyascans/PublicProfileView.tsx");

  assert.match(view, /coverUrl: string \| null/u);
  assert.match(view, /public-profile-comment-cover/u);
  assert.match(view, /aria-hidden="true"/u);
  assert.match(view, /public-profile-comment-spoiler/u);
  assert.match(view, /<details className="public-profile-comment-spoiler">/u);
  assert.match(view, /public-profile-comment-media/u);
  assert.match(view, /public-profile-uploads/u);
  assert.match(view, /public-profile-activity/u);
  assert.match(view, /public-profile-bookmarks/u);
  assert.match(view, /role="group"/u);
  assert.match(view, /aria-controls="favorite-series-rail"/u);
  assert.match(view, /id="favorite-series-rail"/u);
  assert.match(view, /role="region"/u);
  assert.match(view, /aria-label="Favorite series carousel"/u);
  assert.match(view, /tabIndex=\{0\}/u);
  assert.match(view, /Show previous favorite series/u);
  assert.match(view, /Show next favorite series/u);
  assert.match(view, /rail\.scrollBy/u);
  assert.match(view, /prefers-reduced-motion: reduce/u);
});

test("Version 36 profile CSS is canonical and bounded at phone widths", async () => {
  const css = await read("app/globals.css");
  const version36 = css.lastIndexOf("Version 36");
  assert.ok(version36 > css.lastIndexOf("Version 35"));
  const finalCss = css.slice(version36);

  const rail = cssRule(finalCss, ".public-profile-series-grid");
  assert.ok(rail);
  assert.match(rail, /display:\s*grid/u);
  assert.match(rail, /width:\s*100%/u);
  assert.match(rail, /grid-template-columns:\s*none/u);
  assert.match(rail, /grid-auto-flow:\s*column/u);
  assert.match(rail, /overflow-x:\s*auto/u);
  assert.match(rail, /overscroll-behavior-inline:\s*contain/u);
  assert.match(rail, /scroll-snap-type:\s*inline mandatory/u);
  assert.match(rail, /touch-action:\s*pan-x pan-y pinch-zoom/u);

  const railControls = cssRule(finalCss, ".public-profile-rail-controls");
  assert.ok(railControls);
  assert.match(railControls, /display:\s*inline-flex/u);
  const railButton = cssRule(
    finalCss,
    ".public-profile-rail-controls button",
  );
  assert.ok(railButton);
  assert.match(railButton, /border:\s*1px solid var\(--line\)/u);

  const favoriteCard = cssRule(
    finalCss,
    ".public-profile-series-grid > .public-profile-series-card",
  );
  assert.ok(favoriteCard);
  assert.match(favoriteCard, /min-width:\s*0/u);
  assert.match(favoriteCard, /border:\s*1px solid var\(--line\)/u);
  assert.match(favoriteCard, /scroll-snap-align:\s*start/u);

  const record = cssRule(finalCss, ".public-profile-record-card");
  assert.ok(record);
  assert.match(record, /grid-template-columns:[^;]*minmax\(0, 1fr\)/u);
  assert.match(record, /overflow:\s*hidden/u);
  assert.match(record, /border:\s*1px solid var\(--line\)/u);

  const recordCover = cssRule(finalCss, ".public-profile-record-cover");
  assert.ok(recordCover);
  assert.match(recordCover, /aspect-ratio:\s*2 \/ 3/u);
  assert.match(recordCover, /overflow:\s*hidden/u);
  assert.ok(cssRule(finalCss, ".public-profile-record-label"));
  assert.ok(cssRule(finalCss, ".public-profile-record-action"));

  const comment = cssRule(finalCss, ".public-profile-comments article");
  assert.ok(comment);
  assert.match(comment, /grid-template-columns:\s*4\.25rem minmax\(0, 1fr\)/u);

  const commentCover = cssRule(finalCss, ".public-profile-comment-cover");
  assert.ok(commentCover);
  assert.match(commentCover, /aspect-ratio:\s*2 \/ 3/u);
  assert.match(commentCover, /overflow:\s*hidden/u);
  assert.match(commentCover, /border:\s*1px solid/u);
  assert.ok(cssRule(finalCss, ".public-profile-comment-copy"));
  assert.ok(cssRule(finalCss, ".public-profile-comment-title"));
  const spoiler = cssRule(finalCss, ".public-profile-comment-spoiler");
  assert.ok(spoiler);
  assert.match(spoiler, /overflow:\s*hidden/u);
  assert.match(spoiler, /border:\s*1px solid/u);

  const mobile = finalCss.slice(
    finalCss.indexOf("@media (max-width: 760px)"),
    finalCss.indexOf("@media (max-width: 380px)"),
  );
  assert.match(
    mobile,
    /\.public-profile-record-list\s*\{[\s\S]*?grid-template-columns:\s*1fr/u,
  );
  assert.match(
    mobile,
    /\.public-profile-series-grid\s*\{[\s\S]*?grid-auto-columns:/u,
  );
  assert.match(
    mobile,
    /\.public-profile-comments article\s*\{[\s\S]*?grid-template-columns:\s*3\.5rem minmax\(0, 1fr\)/u,
  );
  assert.match(
    mobile,
    /\.public-profile-record-cover\s*\{[\s\S]*?width:\s*3\.65rem/u,
  );
  assert.match(
    mobile,
    /\.public-profile-record-action\s*\{[\s\S]*?width:\s*1\.95rem/u,
  );
  assert.doesNotMatch(
    finalCss,
    /width:\s*(?:100vw|1(?:0[1-9]|[1-9]\d)vw)/u,
  );
});
