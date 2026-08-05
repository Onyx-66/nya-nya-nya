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
    const statements = (await read(`drizzle/${migration}`))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      database.prepare(statement).run();
    }
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

test("V40 fresh schema enforces cover metadata, report states, and always-on comments", async () => {
  const reportsMigration = await read("drizzle/0030_handy_firestar.sql");
  const packagedReportsMigration = await read(
    "dist/.openai/drizzle/0030_handy_firestar.sql",
  );
  assert.equal(
    packagedReportsMigration,
    reportsMigration,
    "The deploy artifact must package the exact audited reports migration.",
  );
  assert.match(
    reportsMigration,
    /CREATE TRIGGER `reports_series_insert_guard`/u,
  );
  assert.doesNotMatch(reportsMigration, /SELECT CASE/u);
  assert.ok(
    reportsMigration.indexOf("Series report rate limit exceeded.") <
      reportsMigration.indexOf("Active series report already exists."),
    "The report-rate guard must run before duplicate detection.",
  );

  const database = await migratedDatabase();
  try {
    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_v40', 'v40@example.com', 'Version 40', 'TEAM_LEADER', 'ACTIVE');

      INSERT INTO teams
        (id, slug, name, description, verification_status, is_archived)
      VALUES
        ('team_v40', 'team-v40', 'Team V40', '', 'VERIFIED', 0);

      INSERT INTO team_memberships
        (team_id, user_id, membership_role, status)
      VALUES
        ('team_v40', 'usr_v40', 'LEADER', 'ACTIVE');

      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('series_v40', 'series-v40', 'Series V40',
         'A complete synopsis for the Version 40 regression fixture.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'AUTHORIZED', 1);

      INSERT INTO chapters
        (id, series_id, team_id, uploader_user_id, slug, chapter_number,
         title, language, state, access_type, price_onyx, published_at,
         comments_enabled)
      VALUES
        ('chapter_v40', 'series_v40', 'team_v40', 'usr_v40',
         'chapter-v40', '1', 'One release', 'en', 'PUBLISHED',
         'FREE', 0, CURRENT_TIMESTAMP, 1);

      INSERT INTO upload_jobs
        (id, user_id, team_id, series_id, kind, source_type,
         idempotency_key, expires_at)
      VALUES
        ('job_v40', 'usr_v40', 'team_v40', 'series_v40', 'SINGLE',
         'DIRECT_IMAGES', 'job-v40-idempotency', datetime('now', '+1 day'));

      INSERT INTO upload_job_items
        (id, job_id, client_key, source_label, series_id, team_id,
         chapter_number, comments_enabled)
      VALUES
        ('item_v40', 'job_v40', 'client-v40', 'Chapter 2', 'series_v40',
         'team_v40', '2', 1);

      INSERT INTO series_gallery_assets
        (id, series_id, kind, object_key, content_type, width, height,
         byte_size, orientation, language, cover_type,
         submitted_by_user_id, submitter_team_id, moderation_status)
      VALUES
        ('cover_v40', 'series_v40', 'COVER', 'gallery/cover-v40.webp',
         'image/webp', 1000, 1500, 4096, 'PORTRAIT', 'ja', 'OFFICIAL',
         'usr_v40', 'team_v40', 'APPROVED');

      INSERT INTO reports
        (id, reporter_user_id, target_type, target_id, category, detail,
         status)
      VALUES
        ('report_v40', 'usr_v40', 'SERIES', 'series_v40', 'HENTAI',
         'The report contains enough detail for an administrator.', 'OPEN');
    `);

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO series_gallery_assets
            (id, series_id, kind, object_key, content_type, width, height,
             byte_size, orientation, submitted_by_user_id)
          VALUES
            ('cover_missing_v40', 'series_v40', 'COVER',
             'gallery/missing.webp', 'image/webp', 1000, 1500, 4096,
             'PORTRAIT', 'usr_v40')
        `),
      /covers require portrait format, language, and a valid cover type/iu,
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO series_gallery_assets
            (id, series_id, kind, object_key, content_type, width, height,
             byte_size, orientation, language, submitted_by_user_id)
          VALUES
            ('cover_no_type_v40', 'series_v40', 'COVER',
             'gallery/no-type.webp', 'image/webp', 1000, 1500, 4096,
             'PORTRAIT', 'en', 'usr_v40')
        `),
      /covers require portrait format, language, and a valid cover type/iu,
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO series_gallery_assets
            (id, series_id, kind, object_key, content_type, width, height,
             byte_size, orientation, language, cover_type,
             submitted_by_user_id)
          VALUES
            ('cover_landscape_v40', 'series_v40', 'COVER',
             'gallery/landscape.webp', 'image/webp', 1600, 900, 4096,
             'LANDSCAPE', 'en', 'FAN_MADE', 'usr_v40')
        `),
      /covers require portrait format, language, and a valid cover type/iu,
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO series_gallery_assets
            (id, series_id, kind, object_key, content_type, width, height,
             byte_size, orientation, cover_type, submitted_by_user_id)
          VALUES
            ('art_type_v40', 'series_v40', 'ART', 'gallery/art.webp',
             'image/webp', 1600, 900, 4096, 'LANDSCAPE', 'OFFICIAL',
             'usr_v40')
        `),
      /covers require portrait format, language, and a valid cover type/iu,
    );
    assert.throws(
      () =>
        database.exec(
          "UPDATE chapters SET comments_enabled = 0 WHERE id = 'chapter_v40'",
        ),
      /Chapter comments must remain enabled/u,
    );
    assert.throws(
      () =>
        database.exec(
          "UPDATE upload_job_items SET comments_enabled = 0 WHERE id = 'item_v40'",
        ),
      /Upload comments must remain enabled/u,
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO reports
            (id, reporter_user_id, target_type, target_id, category, detail,
             status)
          VALUES
            ('bad_report_v40', 'usr_v40', 'SERIES', 'series_v40', 'OTHER',
             'Invalid state fixture with sufficient descriptive detail.',
             'IGNORED')
        `),
      /CHECK constraint failed/iu,
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO reports
            (id, reporter_user_id, target_type, target_id, category, detail,
             status)
          VALUES
            ('duplicate_report_v40', 'usr_v40', 'SERIES', 'series_v40',
             'HENTAI', 'Concurrent duplicate report regression fixture.',
             'OPEN')
        `),
      /Active series report already exists/iu,
    );
    database.exec(`
      UPDATE reports
         SET status = 'RESOLVED'
       WHERE id = 'report_v40';

      INSERT INTO reports
        (id, reporter_user_id, target_type, target_id, category, detail, status)
      VALUES
        ('replacement_report_v40', 'usr_v40', 'SERIES', 'series_v40',
         'HENTAI', 'New active report after the first report was resolved.',
         'OPEN');
    `);
    assert.throws(
      () =>
        database.exec(`
          UPDATE reports
             SET status = 'OPEN'
           WHERE id = 'report_v40'
        `),
      /Active series report already exists/iu,
    );
    database.exec(`
      INSERT INTO reports
        (id, reporter_user_id, target_type, target_id, category, detail, status)
      VALUES
        ('rate_3_v40', 'usr_v40', 'SERIES', 'series_v40', 'COPYRIGHT',
         'Rate limit fixture number three with sufficient detail.', 'RESOLVED'),
        ('rate_4_v40', 'usr_v40', 'SERIES', 'series_v40', 'EXTREME_VIOLENCE',
         'Rate limit fixture number four with sufficient detail.', 'RESOLVED'),
        ('rate_5_v40', 'usr_v40', 'SERIES', 'series_v40',
         'SPAM_OR_MISLEADING',
         'Rate limit fixture number five with sufficient detail.', 'RESOLVED');
    `);
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO reports
            (id, reporter_user_id, target_type, target_id, category, detail,
             status)
          VALUES
            ('rate_6_v40', 'usr_v40', 'SERIES', 'series_v40', 'OTHER',
             'The sixth report must be rejected atomically.', 'OPEN')
        `),
      /Series report rate limit exceeded/iu,
    );

    const reportColumns = new Set(
      database
        .prepare("PRAGMA table_info('reports')")
        .all()
        .map((row) => row.name),
    );
    for (const column of [
      "moderated_by_user_id",
      "moderated_at",
      "resolution_note",
      "revision",
    ]) {
      assert.ok(reportColumns.has(column), `Missing reports.${column}`);
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("V40 publishing-team choices are membership-scoped and render team identity", async () => {
  const [jobsRoute, scope, filesRoute, thumbnailRoute, workspace, css] =
    await Promise.all([
      read("app/api/v1/upload-jobs/route.ts"),
      read("lib/server/upload-jobs.ts"),
      read("app/api/v1/upload-job-files/route.ts"),
      read("app/api/v1/upload-job-thumbnail/route.ts"),
      read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
      read("app/globals.css"),
    ]);
  const options = sourceBetween(
    jobsRoute,
    "async function uploadOptions",
    "export async function GET",
  );

  assert.match(options, /LEFT JOIN team_memberships tm/u);
  assert.match(options, /ON tm\.team_id = t\.id/u);
  assert.match(options, /tm\.user_id = \?/u);
  assert.match(options, /tm\.status = 'ACTIVE'/u);
  assert.match(options, /t\.verification_status = 'VERIFIED'/u);
  assert.match(options, /logoUrl/u);
  assert.match(options, /bannerUrl/u);
  assert.match(options, /requiresReview/u);
  assert.doesNotMatch(options, /if \(admin\)[\s\S]*FROM teams/u);
  assert.match(
    jobsRoute,
    /const createAuthorization = liveJobAuthorization\(actor,[\s\S]*alias: "draft"/u,
  );
  assert.match(
    jobsRoute,
    /FROM \([\s\S]*SELECT \? AS id,[\s\S]*\) draft[\s\S]*WHERE \$\{createAuthorization\.sql\}/u,
  );
  assert.match(
    jobsRoute,
    /const discardAuthorization = liveJobAuthorization\(actor\)[\s\S]*AND \$\{discardAuthorization\.sql\}/u,
  );
  assert.match(jobsRoute, /live_membership\.user_id = \?/u);

  const uploadScope = sourceBetween(
    scope,
    "export async function requireUploadScope",
    "export function requireUploadCapability",
  );
  assert.match(uploadScope, /FROM team_memberships tm/u);
  assert.match(uploadScope, /\.bind\(teamId, actor\.id\)/u);
  assert.match(filesRoute, /live_membership\.user_id = \?/u);
  assert.match(thumbnailRoute, /live_membership\.user_id = live_actor\.id/u);

  assert.match(workspace, /function PublishingTeamVisual/u);
  assert.match(workspace, /upload-team-option-banner/u);
  assert.match(workspace, /upload-team-option-logo/u);
  assert.match(workspace, /Direct publishing access/u);
  assert.match(workspace, /Submission requires review/u);
  assert.match(workspace, /function SingleTeamChooser/u);
  assert.match(css, /\.ops-main \.upload-team-search input:is\(:focus, :focus-visible\)[\s\S]*box-shadow: none !important/u);
  assert.match(css, /\.upload-team-option-banner/u);
});

test("V40 chapter rows support per-chapter disclosures and linked attribution", async () => {
  const [app, route, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/globals.css"),
  ]);
  const title = sourceBetween(app, "function TitleView", "type ChapterAccessData");
  const chapterRoute = sourceBetween(
    route,
    'if (path === "chapter-access-list")',
    'if (path === "chapter-pages")',
  );

  assert.match(title, /collapsedChapterNumbers/u);
  assert.match(title, /toggleChapterGroup\(group\.number\)/u);
  assert.match(title, /aria-controls=\{disclosureId\}/u);
  assert.match(title, /Show all details/u);
  assert.match(title, /Hide all details/u);
  assert.match(title, /representativeChapterThumbnail/u);
  assert.match(title, /chapterLanguageCounts/u);
  assert.match(title, /showCode=\{false\}/u);
  assert.ok(
    title.includes(
      "href={`/u/${encodeURIComponent(chapter.uploaderUsername)}`}",
    ),
  );
  assert.ok(
    title.includes("href={`/team/${encodeURIComponent(chapter.teamSlug)}`}"),
  );
  assert.match(title, /dateTime=\{chapter\.publishedAt \?\? undefined\}/u);
  assert.doesNotMatch(title, /#\{group\.number\}/u);

  assert.match(chapterRoute, /t\.slug AS teamSlug/u);
  assert.match(chapterRoute, /teamSlug: source\?\.teamSlug \?\? null/u);
  assert.match(chapterRoute, /LIMIT 1000/u);
  assert.match(css, /\.chapter-release-compact > button/u);
  assert.match(css, /\.chapter-language-counts/u);
});

test("V40 series reports have a red reader dialog and an administrative moderation page", async () => {
  const [
    app,
    dialog,
    publicRoute,
    aggregateRoute,
    adminRoute,
    panel,
    operations,
    css,
  ] =
    await Promise.all([
      read("components/nyascans/NyaScansApp.tsx"),
      read("components/nyascans/SeriesReportDialog.tsx"),
      read("app/api/v1/series-reports/route.ts"),
      read("app/api/v1/[...resource]/route.ts"),
      read("app/api/v1/admin/series-reports/route.ts"),
      read("components/nyascans/admin/SeriesReportsPanel.tsx"),
      read("components/nyascans/OperationsControlPanel.tsx"),
      read("app/globals.css"),
    ]);

  assert.match(app, /\["Series Reports", WarningCircle\]/u);
  assert.match(app, /className="button button-danger report-link"/u);
  assert.match(app, /<SeriesReportDialog/u);
  assert.match(dialog, /SERIES_REPORT_CATEGORIES\.map/u);
  assert.match(dialog, /CHILD_SEXUAL_ABUSE_MATERIAL/u);
  assert.match(dialog, /Do not upload, quote, or reproduce illegal material/u);
  assert.match(dialog, /minLength=\{12\}/u);

  assert.match(publicRoute, /requireActor\("report\.create"\)/u);
  assert.match(publicRoute, /status IN \('OPEN', 'IN_REVIEW'\)/u);
  assert.match(publicRoute, /series\.report\.created/u);
  assert.match(publicRoute, /Series report rate limit exceeded\./u);
  assert.match(publicRoute, /Active series report already exists\./u);
  assert.match(aggregateRoute, /targetType: z\.literal\("COMMENT"\)/u);
  assert.match(adminRoute, /requireAdmin\(actor\)/u);
  assert.match(adminRoute, /expectedRevision/u);
  assert.match(adminRoute, /series\.report\.status\.updated/u);
  assert.match(adminRoute, /ACTIVE_REPORT_CONFLICT/u);
  assert.match(panel, /title="Series Reports"/u);
  assert.match(panel, /Mark in review/u);
  assert.match(panel, /Resolve/u);
  assert.match(panel, /Dismiss/u);
  assert.match(operations, /section === "Series Reports"/u);
  assert.match(css, /\.series-report-backdrop/u);
  assert.match(
    css,
    /\.chapter-action-bar \.report-link\.button-danger[\s\S]*background:/u,
  );
});

test("V40 galleries publish privileged additions directly and label every cover", async () => {
  const [route, gallery, moderation, css] = await Promise.all([
    read("app/api/v1/series-gallery/route.ts"),
    read("components/nyascans/SeriesGallerySections.tsx"),
    read("components/nyascans/admin/SeriesGalleryModerationPanel.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(route, /coverType/u);
  assert.match(route, /languageCodeSchema/u);
  assert.match(route, /function canPublishGalleryDirectly/u);
  assert.match(route, /roles\.has\("MANAGER"\)/u);
  assert.match(route, /roles\.has\("TEAM_LEADER"\)/u);
  assert.match(route, /directPublishing \? "APPROVED" : "PENDING"/u);
  assert.match(route, /cover_type/u);
  assert.match(route, /defaultCoverLanguage/u);

  assert.match(gallery, /Cover language/u);
  assert.match(gallery, /Cover type/u);
  assert.match(gallery, /Official/u);
  assert.match(gallery, /Fan Made/u);
  assert.match(gallery, /series-cover-type-badge/u);
  assert.match(gallery, /series-cover-language-badge/u);
  assert.match(gallery, /showCode=\{false\}/u);
  assert.match(gallery, /gallery-viewer-backdrop/u);
  assert.match(gallery, /event\.key === "Escape"/u);
  assert.match(gallery, /publishesDirectly \? "Add to gallery" : "Submit for review"/u);
  assert.match(moderation, /asset\.coverType/u);
  assert.match(moderation, /asset\.language/u);

  assert.match(
    css,
    /\.series-galleries \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u,
  );
  assert.match(css, /\.series-cover-badges/u);
  assert.match(css, /\.gallery-viewer-backdrop/u);
  assert.match(
    css,
    /@media \(max-width: 960px\)[\s\S]*\.series-galleries \{[\s\S]*grid-template-columns: 1fr/u,
  );
});

test("V40 removes every comments switch while preserving responsive thumbnail controls", async () => {
  const [workspace, management, uploadRoute, managementRoute, migration, css] =
    await Promise.all([
      read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
      read("components/nyascans/ChapterManagementWorkspace.tsx"),
      read("app/api/v1/upload-jobs/route.ts"),
      read("app/api/v1/chapter-management/route.ts"),
      read("drizzle/0029_great_trish_tilby.sql"),
      read("app/globals.css"),
    ]);

  assert.doesNotMatch(workspace, />Comments enabled</u);
  assert.doesNotMatch(management, />Allow chapter comments</u);
  assert.match(
    uploadRoute,
    /uji\.thumbnail_key, uji\.visibility, 1, 1/u,
  );
  assert.match(
    managementRoute,
    /payload\.accessType === "PAID" \? payload\.priceOnyx : 0,\s*1,\s*payload\.chapterId/u,
  );
  assert.match(migration, /chapters_comments_enabled_insert_guard/u);
  assert.match(migration, /upload_items_comments_enabled_update_guard/u);
  assert.match(workspace, /upload-thumbnail-card/u);
  assert.match(workspace, /upload-thumbnail-control/u);
  assert.match(
    css,
    /\.upload-thumbnail-control \.admin-media-field[\s\S]*grid-template-columns:/u,
  );
  assert.match(
    css,
    /@media \(max-width: 430px\)[\s\S]*\.upload-thumbnail-control \.admin-media-field \{[\s\S]*grid-template-columns: 1fr/u,
  );
});
