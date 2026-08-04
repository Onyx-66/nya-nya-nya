import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

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

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("V39 series actions sit below Chapters List while the hero keeps only Follow and Share", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const title = sourceBetween(app, "function TitleView", "type ChapterAccessData");
  const heroActions = sourceBetween(
    title,
    '<div className="title-actions">',
    "</div>",
  );
  const chapterPanel = sourceBetween(
    title,
    '<section className="chapter-panel"',
    "<SeriesReviews",
  );

  assert.match(heroActions, /Follow series/u);
  assert.match(heroActions, /Share series/u);
  assert.doesNotMatch(heroActions, /Read (?:First|Latest)|Upload Chapter/u);
  assert.match(title, />Chapters List</u);
  assert.doesNotMatch(title, />Latest Chapters</u);
  assert.ok(
    chapterPanel.indexOf('className="chapter-heading"') <
      chapterPanel.indexOf('className="chapter-action-bar"'),
  );
  assert.ok(
    chapterPanel.indexOf('className="chapter-action-bar"') <
      chapterPanel.indexOf("chapter-group-list"),
  );
  assert.match(chapterPanel, /Read First/u);
  assert.match(chapterPanel, /Read Latest/u);
  assert.match(chapterPanel, /Upload Chapter/u);
  assert.match(chapterPanel, /aria-disabled="true"/u);
  assert.match(css, /\.chapter-action-bar[\s\S]*margin-top: 14px/u);
  assert.match(
    css,
    /@media \(max-width: 430px\)[\s\S]*\.title-actions \{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/u,
  );
});

test("V39 uses Follow as the one public series-following contract and keeps Library separate", async () => {
  const [followRoute, profilesRoute, aggregateRoute, profileView, settings] =
    await Promise.all([
      read("app/api/v1/series-follow/route.ts"),
      read("app/api/v1/profiles/route.ts"),
      read("app/api/v1/[...resource]/route.ts"),
      read("components/nyascans/PublicProfileView.tsx"),
      read("components/nyascans/ProfileSettingsWorkspace.tsx"),
    ]);
  const editorPicks = sourceBetween(
    aggregateRoute,
    'if (path === "editor-picks")',
    'if (path === "store-preview")',
  );

  assert.match(followRoute, /INSERT OR IGNORE INTO follows/u);
  assert.match(followRoute, /DELETE FROM follows/u);
  assert.doesNotMatch(followRoute, /INSERT OR IGNORE INTO library_entries/u);
  assert.match(profilesRoute, /FROM follows f/u);
  assert.match(profilesRoute, /'FOLLOWING' AS listType/u);
  assert.match(editorPicks, /FROM follows follower_count/u);
  assert.match(editorPicks, /AS followerCount/u);
  assert.doesNotMatch(editorPicks, /bookmarkCount/u);
  assert.match(profileView, />Followed series</u);
  assert.doesNotMatch(profileView, />Bookmarks</u);
  assert.match(settings, /Share followed series/u);
  assert.match(settings, /Shows the public series you follow/u);
});

test("V39 removes Age Rating from public and administrative contracts while retaining legacy schema compatibility", async () => {
  const [app, seriesPanel, publicDetail, adminRoute, metadata, catalog, schema] =
    await Promise.all([
      read("components/nyascans/NyaScansApp.tsx"),
      read("components/nyascans/admin/SeriesManagementPanel.tsx"),
      read("app/api/v1/series-detail/route.ts"),
      read("app/api/v1/admin/series-management/route.ts"),
      read("lib/admin-metadata.ts"),
      read("lib/catalog.ts"),
      read("db/schema.ts"),
    ]);
  const title = sourceBetween(app, "function TitleView", "type ChapterAccessData");

  for (const source of [
    title,
    seriesPanel,
    publicDetail,
    metadata,
    catalog,
  ]) {
    assert.doesNotMatch(source, /ageRating|Age rating|Content rating/u);
  }
  assert.doesNotMatch(adminRoute, /payload\.ageRating|AS ageRating/u);
  assert.match(adminRoute, /age_rating, access_type/u);
  assert.match(adminRoute, /'TEEN'/u);
  assert.match(schema, /ageRating: text\("age_rating"\)\.notNull\(\)\.default\("TEEN"\)/u);
});

test("V39 Art and Covers are accessible disclosures and recommendations render up to eight titles", async () => {
  const [gallery, app, css] = await Promise.all([
    read("components/nyascans/SeriesGallerySections.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(gallery, /aria-expanded=\{isExpanded\}/u);
  assert.match(gallery, /aria-controls=\{contentId\}/u);
  assert.match(gallery, /aria-labelledby=\{headingId\}/u);
  assert.match(gallery, /<h2 id=\{headingId\}>/u);
  assert.match(gallery, /hidden=\{!isExpanded\}/u);
  assert.match(gallery, /hash === "#art" \|\| hash === "#covers"/u);
  assert.match(gallery, /window\.addEventListener\("hashchange"/u);
  assert.match(gallery, /window\.removeEventListener\("hashchange"/u);
  assert.match(css, /\.series-gallery-toggle:focus-visible/u);
  assert.match(app, /\.slice\(0, 8\)/u);
});

test("V39 multi-upload starts with a verified team gate and accepts mixed recursive sources", async () => {
  const [workspace, jobsRoute] = await Promise.all([
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("app/api/v1/upload-jobs/route.ts"),
  ]);
  const teamStep = sourceBetween(
    workspace,
    "function BatchTeamStep",
    "function UploadComposer",
  );

  assert.match(teamStep, /Choose your publishing team/u);
  assert.match(teamStep, /role="radiogroup"/u);
  assert.match(teamStep, /type="radio"/u);
  assert.match(teamStep, /name="batch-publishing-team"/u);
  assert.match(teamStep, /disabled=\{!selectedTeamId\}/u);
  assert.match(workspace, /teamStepComplete/u);
  assert.match(workspace, /kind === "BATCH" && !teamStepComplete/u);
  assert.match(workspace, /resumeLoading/u);
  assert.match(workspace, /onInvalid=\{revealInvalidField\}/u);
  assert.match(jobsRoute, /verification_status = 'VERIFIED'/u);
  assert.match(workspace, /async function droppedEntryFiles/u);
  assert.match(workspace, /DROP_MAX_DEPTH = 12/u);
  assert.match(workspace, /state\.entries > DROP_MAX_ENTRIES/u);
  assert.match(workspace, /state\.totalBytes > UPLOAD_LIMITS\.maxJobBytes/u);
  assert.match(workspace, /while \(true\)[\s\S]*reader\.readEntries/u);
  assert.match(workspace, /async function filesFromDrop/u);
  assert.match(workspace, /withEntry\.getAsFile\?\.\(\)/u);
  assert.match(workspace, /function batchContainerRoots/u);
  assert.match(workspace, /function looksLikeChapterFolder/u);
  assert.match(workspace, /return directories\[1\]!/u);
  assert.match(workspace, /uploadBatchGroup/u);
  assert.match(workspace, /handleBatchDrop/u);
  assert.match(workspace, /Add ZIP files/u);
  assert.match(workspace, /Add folders/u);
  assert.match(workspace, /webkitdirectory/u);
  assert.match(workspace, /extractArchives\(archives\)/u);
});

test("V39 batch paid access has one global price and one explicit toggle per queued chapter", async () => {
  const [workspace, schema, jobsRoute] = await Promise.all([
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("lib/server/upload-jobs.ts"),
    read("app/api/v1/upload-jobs/route.ts"),
  ]);
  const batchQueue = sourceBetween(
    workspace,
    "<strong>Upload queue</strong>",
    '{job?.status === "READY"',
  );

  assert.match(workspace, /function changeBatchPaidEnabled/u);
  assert.match(
    workspace,
    /accessType: "FREE",[\s\S]*priceOnyx: 0/u,
  );
  assert.match(workspace, /function changeBatchPaidPrice/u);
  assert.match(workspace, /item\.accessType === "PAID"[\s\S]*priceOnyx: nextPrice/u);
  assert.match(workspace, /function changeBatchItemPaid/u);
  assert.match(
    workspace,
    /showCommerce=\{\s*commercialLoaded &&\s*commercial\.economy\.premiumEconomyPublic\s*\}/u,
  );
  assert.match(batchQueue, /upload-queue-paid-toggle/u);
  assert.match(batchQueue, /checked=\{item\.accessType === "PAID"\}/u);
  assert.match(batchQueue, /disabled=\{busy \|\| !batchPaidEnabled\}/u);
  assert.match(batchQueue, /showCommerce=\{false\}/u);
  assert.doesNotMatch(batchQueue, />Availability</u);
  assert.match(schema, /value\.kind === "BATCH" && !value\.teamId/u);
  assert.match(schema, /paidPrices\.size > 1/u);
  assert.match(schema, /UPDATE_BATCH_COMMERCE/u);
  assert.match(jobsRoute, /requirePaidEconomyPublic/u);
  assert.match(jobsRoute, /payload\.action === "UPDATE_BATCH_COMMERCE"/u);
  assert.match(jobsRoute, /BATCH_PAID_PRICE_MISMATCH/u);
  assert.match(jobsRoute, /batchPaidPrices\.size > 1/u);
  assert.match(
    jobsRoute,
    /replacement\.id = uji\.replacement_chapter_id[\s\S]*replacement\.series_id = uji\.series_id/u,
  );
});

test("V39 multi-upload queue is bounded across phone, tablet, desktop, and wide displays", async () => {
  const css = await read("app/globals.css");

  for (const selector of [
    ".upload-team-step",
    ".upload-quick-grid",
    ".upload-batch-paid-panel",
    ".upload-batch-dropzone",
    ".upload-queue-summary",
    ".upload-batch-table > article > header",
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(css, /@container \(max-width: 900px\)/u);
  assert.match(css, /@container \(max-width: 700px\)/u);
  assert.match(css, /@media \(max-width: 430px\)/u);
  assert.match(css, /@container \(max-width: 430px\)/u);
  assert.match(
    css,
    /\.upload-batch-table > article > header[\s\S]*grid-template-columns: 30px minmax\(0, 1fr\) auto/u,
  );
  assert.match(
    css,
    /\.upload-batch-drop-actions \.button[\s\S]*min-width: 0/u,
  );
  assert.match(css, /\.upload-team-options > label:focus-within/u);
  assert.match(css, /\.upload-queue-paid-toggle b[\s\S]*overflow-wrap: anywhere/u);
});

test("V39 upload previews stay bounded and destructive draft controls remain distinct", async () => {
  const [workspace, css] = await Promise.all([
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(workspace, /const PAGE_PREVIEW_LIMIT = 30/u);
  assert.match(workspace, /activePreviewGroup/u);
  assert.match(workspace, /previewOffsets/u);
  assert.match(
    workspace,
    /\.slice\(\s*offset,\s*offset \+ PAGE_PREVIEW_LIMIT,\s*\)/u,
  );
  assert.match(workspace, /loading="lazy"/u);
  assert.match(workspace, /className="upload-page-pagination"/u);
  assert.match(workspace, /"Clear new selection"/u);
  assert.match(workspace, /Discard draft/u);
  assert.match(workspace, /draggable=\{!busy\}/u);
  assert.match(workspace, /aria-busy=\{busy\}/u);
  assert.match(workspace, /const persistingRef = useRef\(false\)/u);
  assert.match(workspace, /if \(persistingRef\.current\) return/u);
  assert.match(workspace, /resumeFailed/u);
  assert.match(workspace, /Start a new upload/u);
  assert.match(css, /\.upload-final-review > \.button[\s\S]*white-space: normal/u);
  assert.match(css, /\.upload-page-disclosure/u);
  assert.match(workspace, /const replacedStoredBytes/u);
  assert.match(
    workspace,
    /if \(local && local\.group === storedItem\.sourceLabel\) continue/u,
  );
  assert.match(
    workspace,
    /state\.entries \+ batch\.length > DROP_MAX_ENTRIES/u,
  );
});

test("V39 paid upload state fails closed and is guarded inside each database mutation", async () => {
  const [commercialSettings, jobsRoute, uploadSchema, workspace] =
    await Promise.all([
      read("lib/server/commercial-settings.ts"),
      read("app/api/v1/upload-jobs/route.ts"),
      read("lib/server/upload-jobs.ts"),
      read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    ]);

  assert.match(
    commercialSettings,
    /if \(!row\)[\s\S]*settings: failClosedCommercialSettings/u,
  );
  assert.match(
    commercialSettings,
    /document\.recoveredFromInvalid[\s\S]*PAID_ECONOMY_HIDDEN/u,
  );
  assert.match(jobsRoute, /function paidEconomyPublicSql/u);
  assert.match(jobsRoute, /live_commercial\.revision = \$\{expectedRevision\}/u);
  assert.match(jobsRoute, /json_valid\(live_commercial\.settings_json\)/u);
  assert.match(jobsRoute, /COMMERCIAL_SETTINGS_CHANGED/u);
  assert.match(
    jobsRoute,
    /CASE WHEN \? = 'BATCH' THEN access_type ELSE \? END/u,
  );
  assert.match(
    jobsRoute,
    /payload\.action === "UPDATE_BATCH_COMMERCE"[\s\S]*upload_publish_guards/u,
  );
  assert.match(uploadSchema, /retryAfterSeconds/u);
  assert.match(uploadSchema, /FILE_BURST_RATE_LIMIT/u);
  assert.match(uploadSchema, /FILE_SUSTAINED_RATE_LIMIT/u);
  assert.match(workspace, /uploadError\.code === "UPLOAD_RATE_LIMITED"/u);
  assert.match(workspace, /uploadError\.details\?\.retryAfterSeconds/u);
  assert.match(workspace, /if \(retryAfter > 65\)/u);
  assert.match(workspace, /resume this private draft in about/u);
  assert.match(workspace, /const reconciled = current\.items/u);
  assert.match(
    workspace,
    /file\.status === "READY"[\s\S]*normalizeUploadPath\(file\.sourcePath\) === page\.path/u,
  );
});

test("V39 file upload limits use an actor-scoped immutable attempt ledger before expensive work", async () => {
  const [route, uploadServer, migration] = await Promise.all([
    read("app/api/v1/upload-job-files/route.ts"),
    read("lib/server/upload-jobs.ts"),
    read("drizzle/0028_supreme_may_parker.sql"),
  ]);
  const post = sourceBetween(
    route,
    "export async function POST",
    "export async function PATCH",
  );
  const reservation = sourceBetween(
    uploadServer,
    "export async function reserveUploadRateLimitAttempt",
    "export async function assertUploadRateLimit",
  );

  const validFile = post.indexOf("if (!(file instanceof File) || file.size <= 0)");
  const reserve = post.indexOf("await reserveUploadRateLimitAttempt");
  assert.ok(validFile >= 0 && reserve > validFile);
  for (const expensiveMarker of [
    "await mutableJob",
    "await validateChapterPage",
    "await env.BUCKET.put",
  ]) {
    assert.ok(
      reserve < post.indexOf(expensiveMarker),
      `rate reservation must precede ${expensiveMarker}`,
    );
  }
  assert.match(reservation, /WITH usage AS/u);
  assert.match(
    reservation,
    /INSERT INTO upload_rate_limit_attempts[\s\S]*SELECT[\s\S]*RETURNING admitted/u,
  );
  assert.match(reservation, /WHERE user_id = \?/u);
  assert.doesNotMatch(reservation, /upload_publish_guards|upload_sessions/u);
  assert.match(
    uploadServer,
    /DELETE FROM upload_rate_limit_attempts[\s\S]*created_at < datetime\('now', '-1 day'\)/u,
  );
  assert.doesNotMatch(route, /DELETE FROM upload_rate_limit_attempts/u);
  assert.match(migration, /BEFORE UPDATE ON `upload_rate_limit_attempts`/u);
  assert.match(
    migration,
    /BEFORE DELETE ON `upload_rate_limit_attempts`[\s\S]*datetime\('now', '-1 day'\)/u,
  );

  const database = await migratedDatabase();
  try {
    assert.deepEqual(
      database
        .prepare("PRAGMA foreign_key_list('upload_rate_limit_attempts')")
        .all(),
      [],
      "attempt history must not cascade with mutable upload drafts",
    );
    database.exec(`
      INSERT INTO upload_rate_limit_attempts
        (id, user_id, upload_job_id, upload_job_item_id, request_id, byte_size,
         admitted, created_at)
      VALUES
        ('attempt_now', 'user_v39', 'job_v39', 'item_v39', 'request_now',
         1024, 1, CURRENT_TIMESTAMP),
        ('attempt_2h', 'user_v39', 'job_v39', 'item_v39', 'request_2h',
         2048, 0, datetime('now', '-2 hours')),
        ('attempt_old', 'user_v39', 'job_v39', 'item_v39', 'request_old',
         4096, 1, datetime('now', '-2 days'));
    `);
    assert.throws(
      () =>
        database.exec(
          "UPDATE upload_rate_limit_attempts SET byte_size = 1 WHERE id = 'attempt_now'",
        ),
      /immutable_upload_rate_attempt/u,
    );
    assert.throws(
      () =>
        database.exec(
          "DELETE FROM upload_rate_limit_attempts WHERE id = 'attempt_2h'",
        ),
      /recent_upload_rate_attempt/u,
    );
    database.exec(
      "DELETE FROM upload_rate_limit_attempts WHERE id = 'attempt_old'",
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM upload_rate_limit_attempts WHERE id = 'attempt_old'",
        )
        .get().count,
      0,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("V39 replacement review proposals bypass the duplicate guard only through an exact linked upload item", async () => {
  const database = await migratedDatabase();
  try {
    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_v39', 'v39@example.com', 'V39 Uploader', 'UPLOADER', 'ACTIVE');
      INSERT INTO teams
        (id, slug, name, verification_status)
      VALUES
        ('team_v39', 'v39-team', 'V39 Team', 'VERIFIED');
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('series_v39', 'v39-series', 'V39 Series', 'Summary', 'MANHWA',
         'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'FREE', 'APPROVED', 1);
      INSERT INTO chapters
        (id, series_id, slug, chapter_number, title, language, format, state,
         access_type, price_onyx, page_count, version, team_id,
         uploader_user_id, visibility, comments_enabled)
      VALUES
        ('chapter_v39_old', 'series_v39', 'chapter-1-old', '1', 'Old', 'en',
         'VERTICAL', 'PUBLISHED', 'FREE', 0, 1, 1, 'team_v39', 'usr_v39',
         'PUBLIC', 1),
        ('chapter_v39_new', 'series_v39', 'chapter-1-new', '1', 'New', 'en',
         'VERTICAL', 'DRAFT', 'FREE', 0, 1, 1, 'team_v39', 'usr_v39',
         'PUBLIC', 1);
      INSERT INTO upload_jobs
        (id, user_id, team_id, series_id, kind, source_type, status,
         idempotency_key, expires_at)
      VALUES
        ('job_v39', 'usr_v39', 'team_v39', 'series_v39', 'BATCH',
         'DIRECT_FOLDER', 'PUBLISHING', 'intent-v39',
         datetime('now', '+1 day'));
      INSERT INTO upload_job_items
        (id, job_id, client_key, source_label, series_id, team_id, chapter_id,
         replacement_chapter_id, chapter_number, title, language, version,
         status, page_count)
      VALUES
        ('item_v39', 'job_v39', 'client-v39', 'Chapter 1', 'series_v39',
         'team_v39', 'chapter_v39_new', 'chapter_v39_old', '1', 'New', 'en',
         1, 'PENDING_REVIEW', 1);
    `);

    database.exec(
      "UPDATE chapters SET state = 'READY_FOR_REVIEW' WHERE id = 'chapter_v39_new'",
    );
    assert.equal(
      database
        .prepare("SELECT state FROM chapters WHERE id = 'chapter_v39_new'")
        .get().state,
      "READY_FOR_REVIEW",
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO chapters
            (id, series_id, slug, chapter_number, title, language, format,
             state, access_type, price_onyx, page_count, version, team_id,
             uploader_user_id, visibility, comments_enabled)
          VALUES
            ('chapter_v39_unlinked', 'series_v39', 'chapter-1-unlinked', '1',
             'Unlinked', 'en', 'VERTICAL', 'READY_FOR_REVIEW', 'FREE', 0, 1,
             1, 'team_v39', 'usr_v39', 'PUBLIC', 1);
        `),
      /duplicate_chapter_release/u,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
