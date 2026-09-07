import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = async (path) => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(read(path), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString("base64")}`);
const { readUploadAnalytics } = await load("lib/server/upload-analytics.ts");
const { computeCropRect } = await load("lib/client/media-optimizer.ts");

test("analytics include active teams and personal published work, never unrelated site activity", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE teams (id, name, is_archived, verification_status);
    CREATE TABLE team_memberships (team_id, user_id, status);
    CREATE TABLE series_team_assignments (series_id, team_id, revoked_at);
    CREATE TABLE series (id, slug, title, archived_at);
    CREATE TABLE chapters (id, series_id, slug, chapter_number, team_id, uploader_user_id, state);
    CREATE TABLE analytics_events (series_slug, chapter_slug, session_id, event_type, created_at);
    CREATE TABLE users (id, display_name);
    CREATE TABLE discussion_comments (id, series_slug, chapter_slug, user_id, body, spoiler, moderation_status, deleted_at, created_at);
    CREATE TABLE discussion_reactions (comment_id, user_id);
    INSERT INTO teams VALUES ('a','Team A',0,'VERIFIED'),('b','Team B',0,'VERIFIED'),('s','Suspended',0,'SUSPENDED');
    INSERT INTO team_memberships VALUES ('a','u','ACTIVE'),('b','u','ACTIVE'),('s','u','ACTIVE');
    INSERT INTO series VALUES ('a','a','Assigned',NULL),('b','b','Personal',NULL),('x','x','Outsider',NULL),('r','r','Revoked',NULL),('d','d','Draft only',NULL),('s','s','Suspended',NULL);
    INSERT INTO series_team_assignments VALUES ('a','a',NULL),('a','b',NULL),('r','a','2026-09-01'),('s','s',NULL);
    INSERT INTO chapters VALUES ('ca','a','one','1','a','someone','PUBLISHED'),('cb','b','two','2',NULL,'u','PUBLISHED'),('cd','d','draft','1',NULL,'u','DRAFT');
    INSERT INTO analytics_events VALUES
      ('a',NULL,'reader1','SERIES_VIEW','2026-09-01 00:00:00'),
      ('a','one','reader1','CHAPTER_START','2026-09-07 12:00:00'),
      ('b','two','reader2','CHAPTER_START','2026-09-07 12:00:00'),
      ('x',NULL,'reader3','SERIES_VIEW','2026-09-07 12:00:00'),
      ('r',NULL,'reader3','SERIES_VIEW','2026-09-07 12:00:00'),
      ('d',NULL,'reader3','SERIES_VIEW','2026-09-07 12:00:00'),
      ('s',NULL,'reader3','SERIES_VIEW','2026-09-07 12:00:00'),
      ('a',NULL,'old','SERIES_VIEW','2026-08-31 23:59:59'),
      ('a',NULL,'future','SERIES_VIEW','2026-09-08 00:00:00');
    INSERT INTO users VALUES ('reader1','Reader');
    INSERT INTO discussion_comments VALUES
      ('visible','a','one','reader1','A visible comment',0,'VISIBLE',NULL,'2026-09-07'),
      ('hidden','a',NULL,'reader1','Secret',0,'HIDDEN',NULL,'2026-09-07'),
      ('deleted','a',NULL,'reader1','Removed',0,'VISIBLE','2026-09-07','2026-09-07'),
      ('unrelated','x',NULL,'reader1','Other series',0,'VISIBLE',NULL,'2026-09-07');
    INSERT INTO discussion_reactions VALUES ('visible','one'),('visible','two'),('hidden','one');
  `);
  const d1 = {
    prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch(statements) { return statements.map(({ sql, values }) => ({ results: db.prepare(sql).all(...values) })); },
  };
  try {
    const data = await readUploadAnalytics(d1, "u", 7, new Date("2026-09-07T14:00:00Z"));
    assert.equal(data.summary.seriesCount, 2);
    assert.equal(data.summary.seriesViews, 1, "duplicate team assignments must not multiply views");
    assert.equal(data.summary.chapterViews, 2);
    assert.equal(data.summary.uniqueViewers, 2);
    assert.equal(data.summary.comments, 1);
    assert.deepEqual(data.topComments.map((comment) => comment.id), ["visible"]);
    assert.equal(data.topComments[0].reactions, 2);
    assert.equal(data.topComments[0].chapterSlug, "one");
    assert.equal(data.timeline.length, 7);
    assert.equal(data.timeline[0].day, "2026-09-01");
    assert.equal(data.timeline[1].seriesViews, 0);
    assert.deepEqual(data.topSeries.map((series) => series.slug), ["a", "b"]);
    db.exec("UPDATE team_memberships SET status = 'REMOVED'");
    const personal = await readUploadAnalytics(d1, "u", 7, new Date("2026-09-07T14:00:00Z"));
    assert.equal(personal.summary.seriesCount, 1);
    assert.equal(personal.summary.chapterViews, 1);
    const unrelated = await readUploadAnalytics(d1, "admin-without-teams", 7, new Date("2026-09-07T14:00:00Z"));
    assert.equal(unrelated.summary.seriesViews, 0);
    assert.equal(unrelated.summary.seriesCount, 0);
  } finally { db.close(); }
});

test("cover and banner crop frames stay inside narrow, tall and large source images", () => {
  for (const [width, height] of [[80, 4000], [4000, 80], [640, 120], [400, 600]]) {
    for (const aspect of [2 / 3, 8 / 3]) {
      for (const position of [{ zoom: 1, x: 0, y: 0 }, { zoom: 3, x: 1, y: 1 }]) {
        const crop = computeCropRect(width, height, aspect, position);
        assert.ok(crop.sourceX >= 0 && crop.sourceY >= 0);
        assert.ok(crop.sourceX + crop.cropWidth <= width + 1e-8);
        assert.ok(crop.sourceY + crop.cropHeight <= height + 1e-8);
        assert.ok(Math.abs(crop.cropWidth / crop.cropHeight - aspect) < 1e-8);
      }
    }
  }
});

test("the dashboard uses only the protected scoped endpoint and replaces the upload feed", () => {
  const dashboard = read("components/nyascans/upload/UploadAnalyticsDashboard.tsx");
  const route = read("app/api/v1/upload-analytics/route.ts");
  assert.match(dashboard, /\/api\/v1\/upload-analytics/);
  assert.doesNotMatch(dashboard, /workspace\/analytics|Latest activity|Recent uploads/);
  assert.match(route, /readUploadAnalytics\(env.DB, actor.id, days\)/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(read("lib/server/upload-analytics.ts"), /isAdmin|1 = 1/);
});
