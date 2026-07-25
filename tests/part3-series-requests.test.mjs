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

async function migratedThrough(lastName) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of await migrationNames()) {
    await applyMigration(database, name);
    if (name === lastName) break;
  }
  return database;
}

function seedIdentity(database) {
  database.exec(`
    INSERT INTO users
      (id, email, display_name, primary_role, status)
    VALUES
      ('usr_owner', 'owner@example.com', 'Owner', 'OWNER', 'ACTIVE'),
      ('usr_leader', 'leader@example.com', 'Leader', 'TEAM_LEADER', 'ACTIVE');

    INSERT INTO teams
      (id, slug, name, description, verification_status, is_archived)
    VALUES
      ('team_alpha', 'alpha', 'Alpha Team', '', 'VERIFIED', 0);

    INSERT INTO team_memberships
      (team_id, user_id, membership_role, status, is_primary,
       can_request_series)
    VALUES
      ('team_alpha', 'usr_leader', 'LEADER', 'ACTIVE', 1, 0);
  `);
}

function insertDraft(database, id, externalId = null) {
  database
    .prepare(
      `INSERT INTO series_requests
       (id, submitting_team_id, submitter_user_id, status, primary_title,
        normalized_title, alternative_titles_json, description, series_type,
        publication_status, authors_json, artists_json, publisher_name,
        origin_country, original_language, reading_direction, genres_json,
        cover_key, mangadex_id, mangadex_url, duplicate_matches_json)
       VALUES (?, 'team_alpha', 'usr_leader', 'DRAFT', ?, ?, '[]',
               'A detailed request description long enough for review.',
               'MANGA', 'ONGOING', '[]', '[]', '', 'JP', 'ja',
               'RIGHT_TO_LEFT', '[]', ?, ?, ?, '[]')`,
    )
    .run(
      id,
      `Request ${id}`,
      `request ${id}`,
      `series-requests/${id}/cover-fixture.jpg`,
      externalId,
      externalId ? `https://mangadex.org/title/${externalId}` : null,
    );
}

test("Part 3 request, social profile, rights and chapter schema applies cleanly", async () => {
  const names = await migrationNames();
  assert.ok(names.includes("0013_bored_silhouette.sql"));
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  try {
    for (const name of names) await applyMigration(database, name);
    for (const table of [
      "series_requests",
      "series_request_teams",
      "series_request_revisions",
      "series_request_feedback",
      "user_profiles",
      "user_follows",
      "user_blocks",
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
        `${table} should exist`,
      );
    }
    const rightsColumns = database
      .prepare("PRAGMA table_info('series_team_assignments')")
      .all()
      .map((column) => column.name);
    for (const column of [
      "allowed_languages_json",
      "upload_requires_review",
      "revoked_at",
      "revoked_by_user_id",
      "restriction_reason",
      "revision",
    ]) {
      assert.ok(rightsColumns.includes(column), `${column} should exist`);
    }
    const chapterColumns = database
      .prepare("PRAGMA table_info('chapters')")
      .all()
      .map((column) => column.name);
    assert.ok(chapterColumns.includes("visibility"));
    assert.ok(chapterColumns.includes("comments_enabled"));
    const requestIndexes = database
      .prepare("PRAGMA index_list('series_requests')")
      .all()
      .map((index) => index.name);
    assert.ok(requestIndexes.includes("series_requests_queue_idx"));
    assert.ok(requestIndexes.includes("series_requests_mangadex_active_uidx"));
    assert.ok(
      requestIndexes.includes("series_requests_canonical_source_active_uidx"),
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("0013 upgrades populated v19 rights, chapters and notifications without data loss", async () => {
  const database = await migratedThrough("0012_worried_bill_hollister.sql");
  try {
    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_legacy', 'legacy@example.com', 'Legacy User', 'OWNER', 'ACTIVE');
      INSERT INTO teams
        (id, slug, name, description, verification_status, is_archived)
      VALUES
        ('team_legacy', 'legacy', 'Legacy Team', '', 'VERIFIED', 0);
      INSERT INTO team_memberships
        (team_id, user_id, membership_role, status, is_primary)
      VALUES
        ('team_legacy', 'usr_legacy', 'LEADER', 'ACTIVE', 1);
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('series_legacy', 'legacy-series', 'Legacy Series',
         'A complete legacy synopsis kept during the Part 3 upgrade.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'AUTHORIZED', 1);
      INSERT INTO series_team_assignments
        (series_id, team_id, can_upload, can_publish, is_primary,
         assigned_by_user_id)
      VALUES
        ('series_legacy', 'team_legacy', 1, 0, 1, 'usr_legacy');
      INSERT INTO chapters
        (id, series_id, team_id, uploader_user_id, slug, chapter_number,
         title, language, state)
      VALUES
        ('chapter_legacy', 'series_legacy', 'team_legacy', 'usr_legacy',
         'chapter-1', '1', 'Legacy Chapter', 'en', 'PUBLISHED');
      INSERT INTO notifications
        (id, user_id, kind, title, body)
      VALUES
        ('notification_legacy', 'usr_legacy', 'LEGACY', 'Legacy', 'Preserved');
    `);
    await applyMigration(database, "0013_bored_silhouette.sql");
    const right = database
      .prepare(
        `SELECT can_upload AS canUpload,
                allowed_languages_json AS languages,
                upload_requires_review AS requiresReview,
                revoked_at AS revokedAt,
                revision
           FROM series_team_assignments
          WHERE series_id = 'series_legacy'
            AND team_id = 'team_legacy'`,
      )
      .get();
    assert.deepEqual(
      {
        canUpload: right.canUpload,
        languages: right.languages,
        requiresReview: right.requiresReview,
        revokedAt: right.revokedAt,
        revision: right.revision,
      },
      {
        canUpload: 1,
        languages: "[]",
        requiresReview: 1,
        revokedAt: null,
        revision: 1,
      },
    );
    const chapter = database
      .prepare(
        `SELECT visibility, comments_enabled AS commentsEnabled
           FROM chapters WHERE id = 'chapter_legacy'`,
      )
      .get();
    assert.deepEqual(
      {
        visibility: chapter.visibility,
        commentsEnabled: chapter.commentsEnabled,
      },
      { visibility: "PUBLIC", commentsEnabled: 1 },
    );
    const notification = database
      .prepare(
        `SELECT body, action_url AS actionUrl, metadata_json AS metadataJson
           FROM notifications WHERE id = 'notification_legacy'`,
      )
      .get();
    assert.deepEqual(
      {
        body: notification.body,
        actionUrl: notification.actionUrl,
        metadataJson: notification.metadataJson,
      },
      { body: "Preserved", actionUrl: null, metadataJson: "{}" },
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("request transitions, exact source uniqueness and approval invariants are database guarded", async () => {
  const database = await migratedThrough("0013_bored_silhouette.sql");
  try {
    seedIdentity(database);
    const externalId = "11111111-1111-4111-8111-111111111111";
    insertDraft(database, "request_one", externalId);
    insertDraft(database, "request_two", externalId);

    assert.throws(
      () =>
        database.exec(
          `UPDATE series_requests
              SET status = 'SUBMITTED', revision = 2
            WHERE id = 'request_one'`,
        ),
      /series_request_submission_invalid/,
      "submission needs one active primary requesting team",
    );
    database.exec(`
      INSERT INTO series_request_teams
        (request_id, team_id, is_primary)
      VALUES
        ('request_one', 'team_alpha', 1),
        ('request_two', 'team_alpha', 1);
    `);
    database.exec(
      "UPDATE series_requests SET cover_key = NULL, revision = 2 WHERE id = 'request_one'",
    );
    assert.throws(
      () =>
        database.exec(
          `UPDATE series_requests
              SET status = 'SUBMITTED',
                  submitted_at = CURRENT_TIMESTAMP,
                  revision = 3
            WHERE id = 'request_one'`,
        ),
      /series_request_submission_invalid/,
      "request submission requires a server-recorded cover",
    );
    database.exec(`
      UPDATE series_requests
         SET cover_key = 'series-requests/request_one/cover-fixture.jpg',
             revision = 3
       WHERE id = 'request_one';
      UPDATE series_requests
         SET status = 'SUBMITTED',
             submitted_at = CURRENT_TIMESTAMP,
             revision = 4
       WHERE id = 'request_one';
    `);
    assert.throws(
      () =>
        database.exec(
          `UPDATE series_requests
              SET status = 'SUBMITTED',
                  submitted_at = CURRENT_TIMESTAMP,
                  revision = 2
            WHERE id = 'request_two'`,
        ),
      /UNIQUE constraint failed/,
      "active requests cannot reserve the same external ID twice",
    );
    assert.throws(
      () =>
        database.exec(
          `UPDATE series_requests
              SET status = 'APPROVED',
                  approved_series_id = 'missing_series',
                  reviewed_at = CURRENT_TIMESTAMP,
                  revision = 5
            WHERE id = 'request_one'`,
        ),
      /series_request_approval_incomplete|FOREIGN KEY constraint failed/,
    );
    database.exec(`
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('series_incomplete', 'series-incomplete', 'Request request_one',
         'A canonical series missing the reviewed relationship records.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'AUTHORIZED', 1);
      BEGIN;
      UPDATE series_requests
         SET status = 'APPROVED',
             approved_series_id = 'series_incomplete',
             reviewed_at = CURRENT_TIMESTAMP,
             revision = 5
       WHERE id = 'request_one';
    `);
    assert.throws(
      () =>
        database.exec(
          `INSERT INTO series_request_revisions
             (id, request_id, revision_number, author_user_id, kind,
              snapshot_json)
           VALUES
             ('revision_incomplete', 'request_one', 5, 'usr_owner',
              'APPROVAL',
              '{"teamRights":[{"teamId":"team_alpha"}]}')`,
        ),
      /series_request_approval_metadata_incomplete/,
      "approval revisions abort when reviewed metadata did not materialize",
    );
    database.exec("ROLLBACK");
    assert.throws(
      () =>
        database.exec(
          `UPDATE series_requests
              SET status = 'DRAFT', revision = 5
            WHERE id = 'request_one'`,
        ),
      /invalid_series_request_transition/,
    );
    assert.throws(
      () =>
        database.exec(
          `UPDATE series_requests
              SET submitter_notes = 'changed', revision = 6
            WHERE id = 'request_one'`,
        ),
      /series_request_revision_required/,
      "every request mutation must advance exactly one revision",
    );
  } finally {
    database.close();
  }
});

test("revoked team rights retain history and cannot remain upload-capable", async () => {
  const database = await migratedThrough("0013_bored_silhouette.sql");
  try {
    seedIdentity(database);
    database.exec(`
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('series_rights', 'series-rights', 'Series Rights',
         'A detailed series synopsis for rights enforcement tests.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'AUTHORIZED', 1);
      INSERT INTO series_team_assignments
        (series_id, team_id, can_upload, can_publish, is_primary,
         assigned_by_user_id, allowed_languages_json,
         upload_requires_review, revision)
      VALUES
        ('series_rights', 'team_alpha', 1, 0, 1, 'usr_owner',
         '["en"]', 1, 1);
    `);
    assert.throws(
      () =>
        database.exec(
          `UPDATE series_team_assignments
              SET revoked_at = CURRENT_TIMESTAMP,
                  revoked_by_user_id = 'usr_owner',
                  restriction_reason = 'Rights were revoked',
                  revision = 2
            WHERE series_id = 'series_rights'
              AND team_id = 'team_alpha'`,
        ),
      /invalid_series_team_rights/,
    );
    database.exec(`
      UPDATE series_team_assignments
         SET can_upload = 0,
             can_publish = 0,
             is_primary = 0,
             revoked_at = CURRENT_TIMESTAMP,
             revoked_by_user_id = 'usr_owner',
             restriction_reason = 'Rights were revoked',
             revision = 2
       WHERE series_id = 'series_rights'
         AND team_id = 'team_alpha';
    `);
    const revoked = database
      .prepare(
        `SELECT can_upload AS canUpload,
                revoked_at AS revokedAt,
                revision
           FROM series_team_assignments
          WHERE series_id = 'series_rights'
            AND team_id = 'team_alpha'`,
      )
      .get();
    assert.equal(revoked.canUpload, 0);
    assert.ok(revoked.revokedAt);
    assert.equal(revoked.revision, 2);
  } finally {
    database.close();
  }
});

test("request, review, media and rights routes expose real protected workflows", async () => {
  const [teamRoute, adminRoute, mediaRoute, rightsRoute, rightsServer, approval] =
    await Promise.all([
      read("app/api/v1/series-requests/route.ts"),
      read("app/api/v1/admin/series-requests/route.ts"),
      read("app/api/v1/series-request-media/route.ts"),
      read("app/api/v1/upload-rights/route.ts"),
      read("lib/server/upload-rights.ts"),
      read("lib/server/series-request-admin.ts"),
    ]);
  assert.match(teamRoute, /requireActor/);
  assert.match(teamRoute, /CHECK_DUPLICATES/);
  assert.match(teamRoute, /RESUBMIT/);
  assert.match(adminRoute, /requireAdmin/);
  assert.match(adminRoute, /REQUEST_CHANGES/);
  assert.match(adminRoute, /ATTACH_EXISTING/);
  assert.match(mediaRoute, /validateImageFile/);
  assert.match(mediaRoute, /private, no-store/);
  assert.match(mediaRoute, /deleteMediaObject/);
  assert.match(rightsRoute, /requireAdmin/);
  assert.match(
    rightsServer,
    /live_actor\.primary_role IN \('OWNER', 'ADMINISTRATOR'\)/,
  );
  assert.match(rightsServer, /live_series\.archived_at IS NULL/);
  assert.match(rightsServer, /live_team\.verification_status <> 'SUSPENDED'/);
  assert.match(approval, /await db\.batch\(statements\)/);
  assert.match(approval, /APPROVAL_CONFLICT/);
  assert.match(approval, /approved_series_id IS NULL/);
  assert.doesNotMatch(
    `${teamRoute}\n${adminRoute}\n${mediaRoute}\n${rightsRoute}`,
    /\bprompt\s*\(/,
  );
});
