import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function migrationNames() {
  return (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

async function applyMigration(database, name) {
  database.exec(
    (await read(`drizzle/${name}`)).replaceAll(
      "--> statement-breakpoint",
      "",
    ),
  );
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of await migrationNames()) {
    await applyMigration(database, name);
  }
  return database;
}

function seedUploadScope(database) {
  database.exec(`
    INSERT INTO users
      (id, email, display_name, primary_role, status)
    VALUES
      ('usr_upload', 'upload@example.com', 'Uploader', 'TEAM_LEADER', 'ACTIVE');

    INSERT INTO teams
      (id, slug, name, description, verification_status, is_archived)
    VALUES
      ('team_upload', 'upload-team', 'Upload Team', '', 'VERIFIED', 0),
      ('team_other', 'other-team', 'Other Team', '', 'VERIFIED', 0);

    INSERT INTO series
      (id, slug, title, synopsis, type, status, origin_country,
       original_language, reading_direction, age_rating, access_type,
       rights_status, is_published)
    VALUES
      ('series_upload', 'upload-series', 'Upload Series',
       'A complete synopsis for the chapter upload regression fixture.',
       'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
       'FREE', 'AUTHORIZED', 1);

    INSERT INTO upload_jobs
      (id, user_id, team_id, series_id, kind, source_type, status,
       idempotency_key, expires_at)
    VALUES
      ('job_upload', 'usr_upload', 'team_upload', 'series_upload', 'SINGLE',
       'DIRECT_IMAGES', 'DRAFT', 'create-upload-job-0001',
       datetime('now', '+14 days'));

    INSERT INTO upload_job_items
      (id, job_id, client_key, source_label, series_id, team_id,
       chapter_number, language, version, access_type, price_onyx)
    VALUES
      ('item_upload', 'job_upload', 'row-1', 'Chapter 1', 'series_upload',
       'team_upload', '1', 'en', 1, 'FREE', 0);
  `);
}

test("Upload Center routes every visible publishing action to a real workspace", async () => {
  const [page, workspace, requestWorkspace, panel, policy, app] = await Promise.all([
    read("app/upload-chapter/[[...mode]]/page.tsx"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("components/nyascans/upload/SeriesRequestWorkspace.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("lib/server/policy.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  for (const route of [
    "dashboard",
    "add-series",
    "series-requests",
    "series",
    "single",
    "multi",
    "drafts",
    "history",
    "review-status",
    "rights",
    "rules",
  ]) {
    assert.match(page, new RegExp(`"${route}"`));
    assert.match(workspace, new RegExp(`"${route}"`));
  }
  assert.match(panel, /UploadCenterWorkspace/);
  assert.match(requestWorkspace, /\/api\/v1\/series-requests/);
  assert.match(requestWorkspace, /\/api\/v1\/series-request-media/);
  assert.match(requestWorkspace, /Save draft/);
  assert.match(requestWorkspace, /Submit for review/);
  assert.match(requestWorkspace, /teamsLoaded/);
  assert.match(requestWorkspace, /No eligible publishing team/);
  assert.match(requestWorkspace, /eligibleTeamIds\.has\(selected\.submittingTeamId\)/);
  assert.match(requestWorkspace, /href=\{`\/title\/\$\{metadataPreview\.duplicate\.slug\}`\}/);
  assert.match(page, /!actor\.canUseUploadCenter/);
  assert.match(policy, /tm\.can_request_series/);
  assert.match(policy, /requestTeamIds/);
  assert.match(policy, /uploadTeamIds/);
  assert.match(policy, /canUseUploadCenter/);
  assert.match(workspace, /availableNavItems/);
  assert.match(workspace, /canRequestSeries/);
  assert.match(workspace, /chapterManagementRoute/);
  assert.match(app, /actor\.canUpload/);
  assert.doesNotMatch(workspace, /href=["']#["']/);
});

test("upload policy limits methods, paths, media, batches, and paid metadata", async () => {
  const [policy, server, jobsApi, filesApi, legacyApi] = await Promise.all([
    read("lib/uploads.ts"),
    read("lib/server/upload-jobs.ts"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("app/api/v1/upload-job-files/route.ts"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  assert.match(policy, /maxChaptersPerJob:\s*25/);
  assert.match(policy, /maxPagesPerChapter:\s*500/);
  assert.match(policy, /maxPageBytes:\s*25 \* 1024 \* 1024/);
  assert.match(policy, /maxChapterBytes:\s*250 \* 1024 \* 1024/);
  assert.match(policy, /maxJobBytes:\s*7 \* 1024 \* 1024 \* 1024/);
  assert.match(policy, /segment === "\.\."/);
  assert.match(policy, /segment\.startsWith\("\."\)/);
  assert.match(policy, /id: "ZIP"[\s\S]*supported: false/);
  assert.match(policy, /id: "RAR"[\s\S]*supported: false/);
  assert.match(policy, /id: "GOOGLE_DRIVE"[\s\S]*supported: false/);

  assert.match(server, /z\.enum\(\["DIRECT_IMAGES", "DIRECT_FOLDER"\]\)/);
  assert.match(
    server,
    /Paid chapters need a premium coin price of at least 1/,
  );
  assert.match(server, /Free chapters cannot have a premium coin price/);
  assert.doesNotMatch(server, /Onyx price/);
  assert.match(server, /APPROVED_SERIES_REQUIRED/);
  assert.match(server, /UPLOAD_PERMISSION_REQUIRED/);
  assert.match(server, /RELEASE_LANGUAGE_NOT_ALLOWED/);
  assert.match(server, /validateImageFile/);
  assert.match(server, /sha256Hex/);
  assert.match(server, /cleanupExpiredUploadDrafts/);
  assert.match(server, /DRAFT_EXPIRED/);
  assert.match(server, /CLEANUP_PENDING/);
  assert.match(server, /objectLimit \?\? 8/);
  assert.match(server, /public_item\.chapter_id IS NOT NULL/);
  assert.match(server, /cleanup_actor\.status = 'ACTIVE'/);
  assert.match(server, /cleanup_membership\.status = 'ACTIVE'/);
  assert.match(server, /failed_cleanup\.status = 'FAILED'/);
  assert.match(server, /reason: "Expired upload draft"/);

  assert.match(jobsApi, /upload_publish_guards/);
  assert.match(jobsApi, /publish_idempotency_key/);
  assert.match(jobsApi, /DUPLICATE_RELEASE/);
  assert.match(jobsApi, /PUBLISH_CONFLICT/);
  assert.match(jobsApi, /liveJobAuthorization/);
  assert.match(jobsApi, /live_assignment\.revoked_at IS NULL/);
  assert.match(jobsApi, /live_assignment\.upload_requires_review = 0/);
  assert.match(jobsApi, /json_each\(live_assignment\.allowed_languages_json\)/);
  assert.match(
    jobsApi,
    /cleanupExpiredUploadDrafts\(\s*env\.DB,\s*env\.BUCKET,\s*actor,\s*id/,
  );
  assert.match(filesApi, /DUPLICATE_PAGE_CONTENT/);
  assert.match(filesApi, /DUPLICATE_PAGE_FILENAME/);
  assert.match(filesApi, /UPLOAD_JOB_TOO_LARGE/);
  assert.match(filesApi, /deleteMediaObject/);
  assert.match(filesApi, /cache-control": "private, no-store"/i);
  assert.match(filesApi, /liveMutationAuthorization/);
  assert.match(
    filesApi,
    /privatePageObjectKey\(\s*actor\.id,\s*jobId,\s*itemId,\s*randomId\(\)/,
  );
  assert.match(filesApi, /storedObjectKey = null/);
  assert.match(filesApi, /CASE WHEN changes\(\) = 1 THEN 1 ELSE NULL END/);
  assert.match(legacyApi, /LEGACY_UPLOAD_ENDPOINT_RETIRED/);
  assert.doesNotMatch(
    legacyApi,
    /Queue direct images, folders, ZIP\/CBZ archives, batches, or a public Drive link/,
  );
});

test("0014 preserves legacy uploads and adds guarded job storage", async () => {
  const names = await migrationNames();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  try {
    for (const name of names) {
      if (name === "0014_tranquil_xorn.sql") break;
      await applyMigration(database, name);
    }
    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_legacy_upload', 'legacy-upload@example.com', 'Legacy uploader',
         'ADMINISTRATOR', 'ACTIVE');
      INSERT INTO upload_sessions
        (id, user_id, object_key, filename, content_type, byte_size,
         status, validation_json)
      VALUES
        ('legacy_upload', 'usr_legacy_upload', 'legacy/page-001.jpg',
         'page-001.jpg', 'image/jpeg', 2048, 'READY', '{}');
    `);

    await applyMigration(database, "0014_tranquil_xorn.sql");

    const legacy = database
      .prepare(
        `SELECT object_key AS objectKey, byte_size AS byteSize,
                upload_job_id AS jobId, source_path AS sourcePath,
                retry_count AS retryCount
           FROM upload_sessions
          WHERE id = 'legacy_upload'`,
      )
      .get();
    assert.deepEqual(
      {
        objectKey: legacy.objectKey,
        byteSize: legacy.byteSize,
        jobId: legacy.jobId,
        sourcePath: legacy.sourcePath,
        retryCount: legacy.retryCount,
      },
      {
        objectKey: "legacy/page-001.jpg",
        byteSize: 2048,
        jobId: null,
        sourcePath: "",
        retryCount: 0,
      },
    );

    for (const table of [
      "upload_jobs",
      "upload_job_items",
      "upload_publish_guards",
    ]) {
      assert.equal(
        database
          .prepare(
            `SELECT COUNT(*) AS count
               FROM sqlite_master
              WHERE type = 'table' AND name = ?`,
          )
          .get(table).count,
        1,
      );
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("database guards upload scope, page readiness, idempotency, and state transitions", async () => {
  const database = await migratedDatabase();
  try {
    seedUploadScope(database);

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO upload_job_items
            (id, job_id, client_key, source_label, series_id, team_id,
             chapter_number, language, version, access_type, price_onyx)
          VALUES
            ('item_wrong_team', 'job_upload', 'row-2', 'Chapter 2',
             'series_upload', 'team_other', '2', 'en', 1, 'FREE', 0)
        `),
      /upload_item_scope_mismatch/,
    );

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO upload_sessions
            (id, user_id, team_id, upload_job_id, upload_job_item_id,
             object_key, filename, source_path, content_type, byte_size,
             page_index, status, validation_json)
          VALUES
            ('page_invalid', 'usr_upload', 'team_upload', 'job_upload',
             'item_upload', 'private/page-invalid.jpg', 'page-invalid.jpg',
             'page-invalid.jpg', 'image/jpeg', 12, 0, 'READY', '{}')
        `),
      /invalid_upload_session/,
    );

    database.exec(`
      INSERT INTO upload_sessions
        (id, user_id, team_id, upload_job_id, upload_job_item_id,
         object_key, filename, source_path, content_type, byte_size,
         page_index, sha256, width, height, status, validation_json)
      VALUES
        ('page_ready', 'usr_upload', 'team_upload', 'job_upload',
         'item_upload', 'private/page-ready.jpg', 'page-ready.jpg',
         'page-ready.jpg', 'image/jpeg', 2048, 0, 'abc123', 1000, 1600,
         'READY', '{"signatureChecked":true}');
    `);

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO upload_sessions
            (id, user_id, team_id, upload_job_id, upload_job_item_id,
             object_key, filename, source_path, content_type, byte_size,
             page_index, sha256, width, height, status, validation_json)
          VALUES
            ('page_duplicate', 'usr_upload', 'team_upload', 'job_upload',
             'item_upload', 'private/page-copy.jpg', 'page-copy.jpg',
             'page-copy.jpg', 'image/jpeg', 2048, 1, 'abc123', 1000, 1600,
             'READY', '{"signatureChecked":true}')
        `),
      /UNIQUE constraint failed/,
    );

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO upload_jobs
            (id, user_id, team_id, series_id, kind, source_type, status,
             idempotency_key, expires_at)
          VALUES
            ('job_duplicate', 'usr_upload', 'team_upload', 'series_upload',
             'SINGLE', 'DIRECT_IMAGES', 'DRAFT', 'create-upload-job-0001',
             datetime('now', '+14 days'))
        `),
      /UNIQUE constraint failed/,
    );

    assert.throws(
      () =>
        database.exec(
          `UPDATE upload_jobs
              SET status = 'PUBLISHED'
            WHERE id = 'job_upload'`,
        ),
      /invalid_upload_job_status_transition/,
    );

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO upload_publish_guards (job_id, verified)
          VALUES ('job_upload', 0)
        `),
      /CHECK constraint failed/,
    );
    database.exec(`
      INSERT INTO upload_publish_guards (job_id, verified)
      VALUES ('job_upload', 1)
    `);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("expired draft lifecycle cancels only unlinked pre-public jobs", async () => {
  const database = await migratedDatabase();
  try {
    seedUploadScope(database);
    const expireDraft = database.prepare(
      `UPDATE upload_jobs
          SET status = 'CANCELLED',
              revision = revision + 1,
              completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND revision = ?
          AND status IN ('DRAFT', 'UPLOADING', 'READY', 'FAILED')
          AND datetime(expires_at) <= datetime('now')
          AND NOT EXISTS (
            SELECT 1 FROM upload_job_items public_item
             WHERE public_item.job_id = upload_jobs.id
               AND public_item.chapter_id IS NOT NULL
          )`,
    );
    database.exec(
      `UPDATE upload_jobs
          SET expires_at = datetime('now', '-1 day')
        WHERE id = 'job_upload'`,
    );
    assert.equal(expireDraft.run("job_upload", 1).changes, 1);
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT status, revision
               FROM upload_jobs
              WHERE id = 'job_upload'`,
          )
          .get(),
      },
      { status: "CANCELLED", revision: 2 },
    );

    database.exec(`
      INSERT INTO upload_jobs
        (id, user_id, team_id, series_id, kind, source_type, status,
         idempotency_key, expires_at)
      VALUES
        ('job_published', 'usr_upload', 'team_upload', 'series_upload',
         'SINGLE', 'DIRECT_IMAGES', 'PUBLISHED',
         'create-upload-job-published', datetime('now', '-1 day'));

      INSERT INTO chapters
        (id, series_id, team_id, uploader_user_id, slug, chapter_number,
         title, language, state, access_type, price_onyx)
      VALUES
        ('chapter_linked', 'series_upload', 'team_upload', 'usr_upload',
         'chapter-linked', '2', 'Linked chapter', 'en', 'DRAFT', 'FREE', 0);

      INSERT INTO upload_jobs
        (id, user_id, team_id, series_id, kind, source_type, status,
         idempotency_key, expires_at)
      VALUES
        ('job_linked', 'usr_upload', 'team_upload', 'series_upload',
         'SINGLE', 'DIRECT_IMAGES', 'DRAFT',
         'create-upload-job-linked', datetime('now', '-1 day'));

      INSERT INTO upload_job_items
        (id, job_id, client_key, source_label, series_id, team_id,
         chapter_id, chapter_number, language, version, access_type,
         price_onyx)
      VALUES
        ('item_linked', 'job_linked', 'linked-row', 'Chapter 2',
         'series_upload', 'team_upload', 'chapter_linked', '2', 'en', 1,
         'FREE', 0);
    `);
    assert.equal(expireDraft.run("job_published", 1).changes, 0);
    assert.equal(expireDraft.run("job_linked", 1).changes, 0);
    assert.equal(
      database
        .prepare("SELECT state FROM chapters WHERE id = 'chapter_linked'")
        .get().state,
      "DRAFT",
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
