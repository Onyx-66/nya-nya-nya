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
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    database.exec(
      (await read(`drizzle/${migration}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

test("Version 47 migration installs the audited chapter access decision queue", async () => {
  const [migration, journalText] = await Promise.all([
    read("drizzle/0036_wise_ego.sql"),
    read("drizzle/meta/_journal.json"),
  ]);
  assert.match(migration, /CREATE TABLE `chapter_access_decisions`/u);
  assert.doesNotMatch(migration, /DROP TABLE `upload_jobs`/u);
  const journal = JSON.parse(journalText);
  assert.equal(journal.entries.at(-1)?.tag, "0036_wise_ego");

  const database = await migratedDatabase();
  try {
    const columns = new Set(
      database
        .prepare("PRAGMA table_info(chapter_access_decisions)")
        .all()
        .map((column) => column.name),
    );
    for (const column of [
      "chapter_id",
      "reference_chapter_id",
      "requested_access_type",
      "forced_price_onyx",
      "resolved_by_user_id",
      "revision",
    ]) {
      assert.ok(columns.has(column), `${column} should be persisted`);
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("free upload continuity is enforced before the atomic publish batch", async () => {
  const [route, policy, schema] = await Promise.all([
    read("app/api/v1/upload-jobs/route.ts"),
    read("lib/server/chapter-access-policy.ts"),
    read("db/schema.ts"),
  ]);
  assert.match(policy, /SAME_CHAPTER_VERSION/u);
  assert.match(policy, /PREVIOUS_CHAPTER/u);
  assert.match(policy, /compareChapterNumbers/u);
  assert.match(policy, /CHAPTER_PRICE_POLICY_CONFLICT/u);
  assert.match(route, /findPaidChapterReference/u);
  assert.match(route, /SET access_type = 'PAID'/u);
  assert.match(route, /INSERT INTO chapter_access_decisions/u);
  assert.match(route, /CHAPTER_ACCESS_DECISION/u);
  assert.match(route, /'OWNER', 'ADMINISTRATOR', 'MANAGER'/u);
  assert.match(route, /accessAdjustments/u);
  assert.match(schema, /chapterAccessDecisions/u);
});

test("only Manager+ can resolve a reference chapter and every decision is audited", async () => {
  const [route, page, app, panel, operations] = await Promise.all([
    read("app/api/v1/admin/chapter-access-decisions/route.ts"),
    read("app/onyx/admin/access/[[...slug]]/page.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/admin/ChapterAccessDecisionPanel.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  assert.match(route, /requireAdminConsole\(actor\)/u);
  assert.match(route, /KEEP_PAID/u);
  assert.match(route, /MAKE_REFERENCE_FREE/u);
  assert.match(route, /status = 'PENDING'/u);
  assert.match(route, /auditStatement/u);
  assert.match(route, /id <> \?/u);
  assert.match(page, /"access-decisions"/u);
  assert.match(app, /\["Access decisions",/u);
  assert.match(operations, /<ChapterAccessDecisionPanel \/>/u);
  assert.match(panel, /The newly uploaded chapter remains Paid/u);
});

test("anchored menus are opaque, positioned below their triggers, and dismiss outside", async () => {
  const [css, app, teams] = await Promise.all([
    read("app/globals.css"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
  ]);
  const authority = css.slice(css.lastIndexOf("/* Version 47"));
  assert.match(authority, /top: calc\(100% \+ \.5rem\) !important/u);
  assert.match(authority, /background-color: var\(--surface-strong\) !important/u);
  assert.match(authority, /opacity: 1 !important/u);
  assert.doesNotMatch(authority, /position: fixed/u);
  assert.match(app, /useAnchoredMenuDismissal/u);
  assert.match(app, /document\.addEventListener\("pointerdown"/u);
  assert.match(app, /document\.addEventListener\("toggle"/u);
  assert.match(teams, /closest\("details"\)\?\.removeAttribute\("open"\)/u);
});

test("team list and grid have distinct responsive geometry", async () => {
  const css = await read("app/globals.css");
  const authority = css.slice(css.lastIndexOf("/* Version 47"));
  assert.match(authority, /\.teams-directory-results\.is-grid[\s\S]*auto-fill/u);
  assert.match(authority, /\.teams-directory-results\.is-list \.team-directory-card[\s\S]*grid-template-areas: "banner identity"/u);
  assert.match(authority, /grid-template-areas: "logo identity"/u);
  assert.match(authority, /\.team-carousel-banner \{[\s\S]*display: none/u);
  assert.match(authority, /\.public-team-series-grid[\s\S]*repeat\(2/u);
});

test("announcement formatting and floating ad previews are safe and immediate", async () => {
  const [renderer, panel, app] = await Promise.all([
    read("components/nyascans/FormattedAnnouncementText.tsx"),
    read("components/nyascans/admin/HomePromotionsPanel.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  assert.match(renderer, /https:\\\/\\\//u);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/u);
  assert.match(panel, /TextB/u);
  assert.match(panel, /TextItalic/u);
  assert.match(panel, /LinkSimple/u);
  assert.match(panel, /URL\.createObjectURL\(adImage\)/u);
  assert.match(panel, /Floating campaign preview/u);
  assert.match(app, /FormattedAnnouncementText/u);
  assert.match(app, /announcement\.type === "UPDATE" \? Star/u);
});

test("image validation accepts safe mobile MIME aliases and avoids an unnecessary hash copy", async () => {
  const validation = await read("lib/server/admin-utils.ts");
  assert.match(validation, /image\/jpg/u);
  assert.match(validation, /image\/pjpeg/u);
  assert.match(validation, /application\/octet-stream/u);
  assert.match(validation, /marker === 0xff/u);
  assert.match(validation, /marker >= 0xd0 && marker <= 0xd7/u);
  assert.match(validation, /bytes\.buffer instanceof ArrayBuffer/u);
});

test("slider fallback and reading progress share the intended visual system", async () => {
  const [route, css, upload] = await Promise.all([
    read("app/api/v1/homepage-sliders/route.ts"),
    read("app/globals.css"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
  ]);
  assert.match(route, /row\.seriesSliderKey \|\| row\.coverKey \|\| row\.bannerKey/u);
  assert.match(route, /row\.seriesSliderKey \? "slider" : row\.coverKey \? "cover" : "banner"/u);
  const authority = css.slice(css.lastIndexOf("/* Version 47"));
  assert.match(authority, /\.continue-reading-progress > b,[\s\S]*background: var\(--brand-gradient\) !important/u);
  assert.match(upload, /aria-label="Remove selected page"[\s\S]*<Trash size=\{16\}/u);
});
