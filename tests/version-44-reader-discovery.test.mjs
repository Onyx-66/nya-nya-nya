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
  const migrations = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
  for (const migration of migrations) {
    for (const statement of (await read(`drizzle/${migration}`)).split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      database.prepare(statement).run();
    }
  }
  return database;
}

test("Version 44 exposes compact Home, team directory, language, reader, and transaction contracts", async () => {
  const [app, discovery, api, teamApi, reactionApi, css, route] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/public-teams/route.ts"),
    read("app/api/v1/chapter-reactions/route.ts"),
    read("app/globals.css"),
    read("app/[...slug]/page.tsx"),
  ]);
  assert.doesNotMatch(app, /This Month/u);
  assert.doesNotMatch(app, /Select up to two/u);
  assert.match(app, /className="release-language-options"/u);
  assert.match(api, /languages\.map\(\(\) => "\?"\)/u);
  assert.match(app, /Released within 24 hours/u);
  assert.match(css, /grid-auto-columns: minmax\(19rem, calc\(\(100% - 2rem\) \/ 3\)\)/u);
  assert.match(discovery, /Discover our publishing teams/u);
  assert.match(discovery, /Browse Teams/u);
  assert.match(discovery, /PublishingTeamsDirectory/u);
  assert.match(route, /root === "teams"/u);
  assert.match(teamApi, /public_team_activity/u);
  assert.match(teamApi, /ORDER BY releaseCount DESC, totalViews DESC, commentCount DESC/u);
  assert.match(app, /Default reader by series type/u);
  assert.match(app, /Continue with \{teamName\} translation/u);
  assert.match(app, /reader-progress-shell/u);
  assert.match(app, /chapter-reactions-box/u);
  assert.match(reactionApi, /requireReadableChapter/u);
  assert.match(app, /Real-money purchases and Roulette activity are kept separate/u);
  assert.match(api, /Promise\.allSettled/u);
});

test("Version 44 chapter reactions are one-per-reader and cascade with chapter deletion", async () => {
  const database = await migratedDatabase();
  try {
    database.exec(`
      INSERT INTO users (id, email, display_name, primary_role, status)
      VALUES ('usr_v44', 'v44@example.com', 'V44', 'USER', 'ACTIVE');
      INSERT INTO series (id, slug, title, native_title, synopsis, type, status, origin_country, original_language, reading_direction, rights_status, is_published)
      VALUES ('ser_v44', 'series-v44', 'Series V44', '', 'A complete test synopsis for the Version 44 reaction contract.', 'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEST_ORIGINAL', 1);
      INSERT INTO chapters (id, series_id, slug, chapter_number, language, state, visibility, access_type, published_at)
      VALUES ('ch_v44', 'ser_v44', 'chapter-v44', '1', 'en', 'PUBLISHED', 'PUBLIC', 'FREE', CURRENT_TIMESTAMP);
      INSERT INTO custom_reactions (id, slug, name, accessible_label, emoji_fallback, usage_kind)
      VALUES ('react_v44_a', 'v44-a', 'Loved it', 'Loved it', '❤', 'REACTION'),
             ('react_v44_b', 'v44-b', 'Surprised', 'Surprised', '😮', 'REACTION');
      INSERT INTO chapter_reactions (user_id, chapter_id, reaction_id)
      VALUES ('usr_v44', 'ch_v44', 'react_v44_a');
    `);
    assert.throws(() => database.prepare("INSERT INTO chapter_reactions (user_id, chapter_id, reaction_id) VALUES (?, ?, ?)").run("usr_v44", "ch_v44", "react_v44_b"), /UNIQUE constraint/u);
    database.prepare("DELETE FROM chapters WHERE id = ?").run("ch_v44");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM chapter_reactions").get().count, 0);
  } finally {
    database.close();
  }
});
