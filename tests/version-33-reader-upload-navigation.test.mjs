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

test("Version 33 migration records guarded chapter replacement intent", async () => {
  const database = await migratedDatabase();
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(upload_job_items)")
      .all()
      .map((row) => row.name),
  );
  assert.ok(columns.has("replacement_chapter_id"));

  const replacementForeignKey = database
    .prepare("PRAGMA foreign_key_list(upload_job_items)")
    .all()
    .find((row) => row.from === "replacement_chapter_id");
  assert.equal(replacementForeignKey?.table, "chapters");
  assert.equal(String(replacementForeignKey?.on_delete).toUpperCase(), "RESTRICT");

  const indexes = new Set(
    database
      .prepare("PRAGMA index_list(upload_job_items)")
      .all()
      .map((row) => row.name),
  );
  assert.ok(indexes.has("upload_job_items_replacement_idx"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("reader Page Fit is viewport exact and the reader header exits Home", async () => {
  const [app, settings, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/ReaderSettingsPanel.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(settings, /\["page", "Page fit"\]/u);
  assert.match(app, /reader-ui-visible[\s\S]+reader-ui-hidden/u);
  assert.match(css, /\.reader-ui-hidden\.reader-fit-page[\s\S]+height:\s*100dvh/u);
  assert.match(css, /\.reader-fit-page \.reader-stage[\s\S]+padding-top:\s*64px/u);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]+padding-top:\s*58px/u);

  const headerStart = app.indexOf('<header className="reader-header">');
  const headerEnd = app.indexOf("</header>", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart);
  const readerHeader = app.slice(headerStart, headerEnd);
  assert.match(readerHeader, /href="\/"[\s\S]+<span>Home<\/span>/u);
  assert.doesNotMatch(readerHeader, />Account</u);
  assert.doesNotMatch(readerHeader, />Logout</u);
});

test("Upload Center preserves pages, enforces duplicate decisions, and raises limits", async () => {
  const [workspace, limits, jobsRoute, filesRoute, reviewRoute, api] =
    await Promise.all([
      read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
      read("lib/uploads.ts"),
      read("app/api/v1/upload-jobs/route.ts"),
      read("app/api/v1/upload-job-files/route.ts"),
      read("app/api/v1/[...resource]/route.ts"),
      read("lib/server/api.ts"),
    ]);

  assert.match(limits, /maxChaptersPerJob:\s*25/u);
  assert.match(limits, /maxChapterBytes:\s*250 \* 1024 \* 1024/u);
  assert.match(limits, /maxJobBytes:\s*7 \* 1024 \* 1024 \* 1024/u);
  assert.match(filesRoute, /UPLOAD_LIMITS\.maxChapterBytes/u);

  assert.match(workspace, /Do you want to replace existing chapter\?/u);
  assert.match(workspace, /Yes, request replacement/u);
  assert.match(workspace, /No, change chapter number/u);
  assert.match(workspace, /destructive=\{false\}/u);
  assert.match(workspace, /Boolean\(duplicateRejectedKey\)/u);
  assert.match(workspace, /Change the existing chapter number before saving/u);
  assert.match(workspace, /priorFileIdsByClientKey/u);
  assert.match(workspace, /ordered\.splice\(insertAt < 0 \? ordered\.length : insertAt/u);
  assert.match(workspace, /existing validated pages stay in place/u);
  assert.match(workspace, /removeAttribute\("webkitdirectory"\)/u);
  assert.match(workspace, /event\.currentTarget\.value = ""/u);
  assert.match(workspace, /upload-single-overview/u);
  assert.match(workspace, /upload-batch-overview/u);

  assert.match(api, /details:\s*error\.details \?\? null/u);
  assert.match(jobsRoute, /"DUPLICATE_RELEASE"[\s\S]+existingChapterId/u);
  assert.match(jobsRoute, /replacement_chapter_id IS NOT NULL/u);
  assert.match(reviewRoute, /REPLACEMENT_REVIEW_ADMIN_REQUIRED/u);
  assert.match(reviewRoute, /replacementChapterRevision/u);
  assert.match(reviewRoute, /upload\.chapter_replacement\.approve/u);
  assert.match(reviewRoute, /upload\.chapter_replacement\.return/u);
  assert.match(
    reviewRoute,
    /SET chapter_id = NULL,[\s\S]+replacement_chapter_id = NULL,[\s\S]+status = 'READY'/u,
  );
  assert.match(reviewRoute, /DELETE FROM chapter_pages[\s\S]+UPDATE chapter_pages/u);
});

test("free and paid Roulette pools keep eight rewards and have dedicated admin controls", async () => {
  const [settings, panel, app, route, view, css] = await Promise.all([
    read("lib/reward-settings.ts"),
    read("components/nyascans/admin/RewardSettingsPanel.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/admin/reward-settings/route.ts"),
    read("components/nyascans/RouletteView.tsx"),
    read("app/globals.css"),
  ]);

  assert.ok((settings.match(/\.min\(8\)/gu) ?? []).length >= 2);
  assert.match(settings, /filter\(\(reward\) => reward\.enabled\)\.length < 8/u);
  const defaults = settings.slice(
    settings.indexOf("export const defaultRewardSettings"),
  );
  const freePool = defaults.slice(
    defaults.indexOf("rouletteRewards: ["),
    defaults.indexOf("roulettePaidRewards: ["),
  );
  const paidPool = defaults.slice(
    defaults.indexOf("roulettePaidRewards: ["),
    defaults.indexOf("rouletteTasks: ["),
  );
  assert.ok((freePool.match(/\bid:/gu) ?? []).length >= 8);
  assert.ok((paidPool.match(/\bid:/gu) ?? []).length >= 8);

  assert.match(app, /\["Roulette", Sparkle\]/u);
  assert.match(app, /activeSection === "Roulette"[\s\S]+<RewardSettingsPanel/u);
  assert.match(panel, /settings\.rouletteRewards\.length <= 8/u);
  assert.match(panel, /settings\.roulettePaidRewards\.length <= 8/u);
  assert.match(panel, /settings\.rouletteRewards\.length >= 24/u);
  assert.match(panel, /settings\.rouletteTasks\.length >= 24/u);
  assert.match(route, /settings\.rouletteRewards,[\s\S]+settings\.roulettePaidRewards/u);
  assert.match(view, /aria-valuenow=\{Math\.min\(task\.progress, task\.target\)\}/u);
  assert.match(css, /Version 33 final cascade/u);
  assert.match(css, /--roulette-teal:\s*#39c6b2/u);
  assert.match(css, /\.roulette-tasks article\.is-ready/u);
});

test("comment GIF picker and administrator GIF editing are complete and race-safe", async () => {
  const [discussion, panel, libraryRoute, mediaRoute, css] = await Promise.all([
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("components/nyascans/admin/ReactionLibraryPanel.tsx"),
    read("app/api/v1/admin/reaction-library/route.ts"),
    read("app/api/v1/admin/reaction-media/route.ts"),
    read("app/globals.css"),
  ]);

  assert.match(discussion, /<FilmStrip size=\{18\} \/> GIF/u);
  assert.match(discussion, /All categories/u);
  assert.match(discussion, /No curated GIF matches this search/u);
  assert.match(discussion, /gifIds:\s*selectedGifIds/u);
  assert.match(css, /\.comment-gif-picker-wrap > button/u);

  assert.match(panel, /usageFilter/u);
  assert.match(panel, /New GIF/u);
  assert.match(panel, /loadSequence/u);
  assert.match(panel, /optimizationSequence/u);
  assert.match(panel, /sequence !== loadSequence\.current/u);
  assert.match(panel, /Comment GIF entries require an animated GIF file/u);
  assert.match(panel, /setRemoveAsset\(false\)[\s\S]+setOptimizationNote\(""\)/u);
  assert.match(libraryRoute, /usageKind === "ALL"/u);
  assert.match(libraryRoute, /COMMENT_GIF_ANIMATION_REQUIRED/u);
  assert.match(mediaRoute, /COMMENT_GIF_ANIMATION_REQUIRED/u);
});

test("Ctrl K, site navigation chords, and the footer guide are globally wired", async () => {
  const [app, dialog, shortcuts, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/KeyboardShortcutsDialog.tsx"),
    read("lib/site-shortcuts.ts"),
    read("app/globals.css"),
  ]);

  assert.match(app, /<kbd>Ctrl K<\/kbd>/u);
  assert.match(app, /event\.ctrlKey \|\| event\.metaKey/u);
  assert.match(app, /SITE_NAVIGATION_CHORDS/u);
  assert.match(
    app,
    /\[role="dialog"\]\[aria-modal="true"\],[\s\S]+\[role="alertdialog"\]\[aria-modal="true"\]/u,
  );
  assert.match(app, /Keyboard shortcuts/u);
  assert.match(app, /disabled=\{desktop\}/u);
  assert.match(dialog, /Ctrl\/Command \+ K/u);
  assert.match(dialog, /restoreFocus\.current\?\.focus/u);
  assert.match(shortcuts, /"Ctrl \/ ⌘", "K"/u);
  for (const destination of ["/", "/latest", "/browse", "/library", "/store", "/roulette"]) {
    assert.ok(shortcuts.includes(`"${destination}"`));
  }
  assert.doesNotMatch(css, /\.footer-group > div\[hidden\][\s\S]+!important/u);
});

test("Browse, Library, legal pages, and final UI polish ship as real content", async () => {
  const [css, legal, app] = await Promise.all([
    read("app/globals.css"),
    read("lib/legal-documents.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  const finalCascade = css.lastIndexOf("Version 33 final cascade");
  assert.ok(finalCascade > css.lastIndexOf("Version 32"));
  const finalCss = css.slice(finalCascade);
  assert.match(finalCss, /repeat\(8, minmax\(0, 1fr\)\)/u);
  assert.match(finalCss, /repeat\(6, minmax\(0, 1fr\)\)/u);
  assert.match(finalCss, /repeat\(4, minmax\(0, 1fr\)\)/u);
  assert.match(finalCss, /repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(finalCss, /\.upload-composer-single[\s\S]+grid-template-columns/u);
  assert.match(finalCss, /\.upload-composer-batch/u);
  assert.match(css, /button:enabled[\s\S]+cursor:\s*pointer/u);
  assert.match(css, /button:disabled[\s\S]+cursor:\s*not-allowed/u);

  assert.ok((legal.match(/\bslug:/gu) ?? []).length >= 6);
  for (const title of [
    "Privacy Policy",
    "Terms of Service",
    "Copyright & Content Removal Policy",
    "Content Policy",
    "Cookie Policy",
    "Refund Policy",
  ]) {
    assert.ok(legal.includes(title));
  }
  assert.ok(legal.length > 12_000);
  assert.match(app, /LEGAL_DOCUMENTS_BY_SLUG/u);
  assert.match(app, /legal-document-meta/u);
  assert.match(app, /legal-section-nav/u);
});
