import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("all database migrations apply cleanly with the production indexes", async () => {
  const migrationNames = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migrationName of migrationNames) {
    const migration = await read(`drizzle/${migrationName}`);
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }

  const chapterColumns = database
    .prepare("PRAGMA table_info(chapters)")
    .all()
    .map((column) => column.name);
  assert.ok(chapterColumns.includes("team_id"));
  assert.ok(chapterColumns.includes("credits_json"));
  assert.ok(chapterColumns.includes("release_notes"));

  const commentColumns = database
    .prepare("PRAGMA table_info(discussion_comments)")
    .all()
    .map((column) => column.name);
  assert.ok(commentColumns.includes("pinned_at"));
  assert.ok(commentColumns.includes("pinned_by_user_id"));

  const preferenceColumns = database
    .prepare("PRAGMA table_info(user_preferences)")
    .all()
    .map((column) => column.name);
  assert.ok(preferenceColumns.includes("settings_json"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("browse is database paginated and owns its URL history state", async () => {
  const [app, api] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  assert.match(api, /path === "catalog"/);
  assert.match(api, /LIMIT \? OFFSET \?/);
  assert.match(api, /pageSize/);
  assert.match(api, /function publicSeriesPredicate/);
  assert.match(api, /archived_at IS NULL/);
  assert.match(app, /window\.history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(app, /window\.addEventListener\("popstate"/);
  assert.match(app, /catalog-pagination/);
  assert.match(app, /Per page/);
  assert.doesNotMatch(
    app.slice(app.indexOf("function BrowseView"), app.indexOf("function LibraryView")),
    /demoSeries\.filter/,
  );
});

test("direct chapter images become private reader pages after review", async () => {
  const [api, uploadJobs, uploadPolicy, reader, schema] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("lib/server/upload-jobs.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("db/schema.ts"),
  ]);

  assert.match(uploadJobs, /INSERT INTO chapter_pages/);
  assert.match(uploadPolicy, /sha256Hex/);
  assert.match(uploadJobs, /processing_status\)/);
  assert.match(uploadJobs, /needsReview \? "READY_FOR_REVIEW" : "PUBLISHED"/);
  assert.match(api, /path === "chapter-pages"/);
  assert.match(api, /path === "chapter-page"/);
  assert.match(api, /resolveChapterAccess/);
  assert.match(reader, /readerPages\.map/);
  assert.match(reader, /chapter-image-page/);
  assert.doesNotMatch(
    reader.slice(reader.indexOf("function ReaderView"), reader.indexOf("type WalletActivity")),
    /THE CITY KEPT EVERY OATH/,
  );
  assert.match(schema, /chapterPages/);
});

test("community, account, and response security controls are connected", async () => {
  const [discussion, app, api, policy, worker] = await Promise.all([
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/policy.ts"),
    read("worker/index.ts"),
  ]);

  assert.match(api, /path === "community-highlights"/);
  assert.match(api, /path === "discussion-pin"/);
  assert.match(discussion, /20_000/);
  assert.match(discussion, /Pinned by moderation/);
  assert.match(app, /path === "account-settings"|api\/v1\/account-settings/);
  assert.match(app, /account-export/);
  assert.doesNotMatch(policy, /test\.onyx@gmail\.com/);
  assert.match(policy, /NYASCANS_ADMIN_EMAILS/);
  assert.match(worker, /content-security-policy/);
  assert.match(worker, /strict-transport-security/);
  assert.match(worker, /x-content-type-options/);
});
