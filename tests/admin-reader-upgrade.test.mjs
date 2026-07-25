import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("admin control room uses real secured management endpoints", async () => {
  const [panel, api] = await Promise.all([
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  for (const route of [
    "admin/summary",
    "admin/series",
    "admin/teams",
    "admin/users",
    "admin/audit",
  ]) {
    assert.match(api, new RegExp(route.replace("/", "\\/")));
    assert.match(panel, new RegExp(route.replace("/", "\\/")));
  }
  assert.match(api, /requireAdmin\(actor\)/);
  assert.match(api, /audit_logs/);
  assert.match(api, /SELF_ADMIN_CHANGE_BLOCKED/);
  assert.match(panel, /Site overview/);
  assert.match(panel, /Series and roles|Users and roles/);
  assert.doesNotMatch(panel, /record A|record B|record C/);
});

test("chapter importer exposes only the upload methods implemented in production", async () => {
  const [workspace, jobsApi, filesApi, uploadPolicy, uploadSchemas] =
    await Promise.all([
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("app/api/v1/upload-job-files/route.ts"),
    read("lib/uploads.ts"),
    read("lib/server/upload-jobs.ts"),
  ]);

  for (const source of ["DIRECT_IMAGES", "DIRECT_FOLDER"]) {
    assert.match(workspace, new RegExp(source));
    assert.match(uploadPolicy, new RegExp(source));
    assert.match(uploadSchemas, new RegExp(source));
  }
  assert.match(workspace, /webkitdirectory/);
  assert.match(workspace, /Multi-chapter upload/);
  assert.match(uploadPolicy, /id: "ZIP"[\s\S]*supported: false/);
  assert.match(uploadPolicy, /id: "RAR"[\s\S]*supported: false/);
  assert.match(uploadPolicy, /id: "GOOGLE_DRIVE"[\s\S]*supported: false/);
  assert.match(filesApi, /validateChapterPage/);
  assert.match(filesApi, /DUPLICATE_PAGE_CONTENT/);
  assert.match(jobsApi, /requireUploadScope/);
  assert.match(jobsApi, /upload_publish_guards/);
});

test("administrator security guidance is truthful and not a fake checklist", async () => {
  const panel = await read("components/nyascans/OperationsControlPanel.tsx");

  assert.match(
    panel,
    /Archive imports remain unavailable until bounded extraction is configured/,
  );
  assert.match(panel, /className="security-operator-item"/);
  assert.doesNotMatch(
    panel.slice(panel.indexOf("Operator checklist"), panel.indexOf("function AuditLog")),
    /<input\s+type="checkbox"/,
  );
});

test("reader shows ten top threads, collapsible replies, recommendations, and quick jumps", async () => {
  const [discussion, app, styles] = await Promise.all([
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(discussion, /COMMENTS_PAGE_SIZE = 10/);
  assert.match(
    discussion,
    /setVisibleRootCount\(\(value\) => value \+ COMMENTS_PAGE_SIZE\)/,
  );
  assert.match(discussion, /const visibleReplies = repliesExpanded \? replies : \[\]/);
  assert.match(discussion, /aria-expanded=\{repliesExpanded\}/);
  assert.match(discussion, /Hide replies/);

  assert.match(app, /function SeriesRecommendations/);
  assert.match(app, /sharedGenres\.length \* 100/);
  assert.match(app, /Series recommendations/);
  assert.match(app, /id="reader-start"/);
  assert.match(app, /id="chapter-end"/);
  assert.match(app, /reader-quick-nav/);
  assert.match(styles, /--cover-ratio:\s*2\s*\/\s*3/);
  assert.match(styles, /\.reader-quick-nav/);
});

test("ratings, database catalog, and team-scoped releases are wired end to end", async () => {
  const [app, api, uploadPolicy, schema, migration, styles] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/upload-jobs.ts"),
    read("db/schema.ts"),
    read("drizzle/0005_previous_overlord.sql"),
    read("app/globals.css"),
  ]);

  assert.match(app, /function SeriesReviews/);
  assert.match(app, /Ratings & Reviews/);
  assert.match(api, /path === "reviews"/);
  assert.match(api, /AVG\(rating\)/);
  assert.match(api, /function publicSeriesPredicate/);
  assert.match(api, /rights_status IN/);
  assert.match(api, /series_team_assignments/);
  assert.match(uploadPolicy, /TEAM_SCOPE_REQUIRED/);
  assert.match(schema, /seriesTeamAssignments/);
  assert.match(schema, /creditsJson/);
  assert.match(migration, /chapters_release_identity_idx/);
  assert.match(styles, /\.review-summary-grid/);
  assert.match(styles, /\.footer-main/);
});
