import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { canAny } from "../lib/permissions.mjs";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migrationNames() {
  return (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
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

test("V34 fresh schema keeps Roulette cadence and upload media relationally sound", async () => {
  const database = await migratedDatabase();
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

  const poolColumns = new Set(
    database
      .prepare("PRAGMA table_info(roulette_pool_counters)")
      .all()
      .map((column) => column.name),
  );
  assert.ok(poolColumns.has("last_spin_id"));
  const cadenceColumns = new Set(
    database
      .prepare("PRAGMA table_info(roulette_reward_cadence)")
      .all()
      .map((column) => column.name),
  );
  for (const column of [
    "interval_spins",
    "next_due_spin",
    "last_awarded_spin",
    "last_spin_id",
  ]) {
    assert.ok(cadenceColumns.has(column));
  }
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO roulette_reward_cadence
           (pool_key, reward_key, interval_spins, next_due_spin)
           VALUES ('FREE', 'invalid-interval', 1, 1)`,
        )
        .run(),
    /roulette_reward_cadence_interval_check/u,
  );

  const chapterColumns = new Set(
    database
      .prepare("PRAGMA table_info(chapters)")
      .all()
      .map((column) => column.name),
  );
  const uploadItemColumns = new Set(
    database
      .prepare("PRAGMA table_info(upload_job_items)")
      .all()
      .map((column) => column.name),
  );
  assert.ok(chapterColumns.has("thumbnail_key"));
  assert.ok(uploadItemColumns.has("thumbnail_key"));
  assert.ok(uploadItemColumns.has("replacement_chapter_id"));
  const replacementForeignKey = database
    .prepare("PRAGMA foreign_key_list(upload_job_items)")
    .all()
    .find((foreignKey) => foreignKey.from === "replacement_chapter_id");
  assert.equal(replacementForeignKey?.table, "chapters");
  assert.equal(
    String(replacementForeignKey?.on_delete).toUpperCase(),
    "RESTRICT",
  );

  database.exec(`
    INSERT INTO users
      (id, email, display_name, primary_role, status)
    VALUES
      ('usr_v34_upload', 'upload-v34@example.com', 'Upload V34', 'UPLOADER', 'ACTIVE');
    INSERT INTO series
      (id, slug, title, synopsis, type, status, origin_country,
       original_language, reading_direction, rights_status, is_published)
    VALUES
      ('ser_v34_upload', 'v34-upload', 'V34 Upload',
       'A sufficiently detailed synopsis for the V34 upload fixture.',
       'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'AUTHORIZED', 1);
    INSERT INTO chapters
      (id, series_id, slug, chapter_number, state, published_at,
       thumbnail_key, visibility)
    VALUES
      ('ch_v34_replacement', 'ser_v34_upload', 'chapter-1-en-v1',
       '1', 'PUBLISHED', '2026-01-01T00:00:00.000Z',
       'public/chapter-thumbnails/ch_v34_replacement.webp', 'PUBLIC');
    INSERT INTO upload_jobs
      (id, user_id, series_id, kind, source_type, idempotency_key, expires_at)
    VALUES
      ('job_v34_upload', 'usr_v34_upload', 'ser_v34_upload',
       'SINGLE', 'DIRECT_IMAGES', 'v34-upload-idempotency',
       '2027-01-01T00:00:00.000Z');
    INSERT INTO upload_job_items
      (id, job_id, client_key, source_label, series_id,
       replacement_chapter_id, chapter_number, thumbnail_key)
    VALUES
      ('item_v34_upload', 'job_v34_upload', 'chapter-1', 'Chapter 1',
       'ser_v34_upload', 'ch_v34_replacement', '1',
       'upload/thumbnails/job_v34_upload/item_v34_upload.webp');
  `);
  assert.throws(
    () =>
      database
        .prepare("DELETE FROM chapters WHERE id = 'ch_v34_replacement'")
        .run(),
    /FOREIGN KEY constraint failed/u,
  );
  const linkedUploadItem = database
    .prepare(
      `SELECT replacement_chapter_id AS replacementChapterId,
              thumbnail_key AS thumbnailKey
         FROM upload_job_items
        WHERE id = 'item_v34_upload'`,
    )
    .get();
  assert.equal(
    linkedUploadItem.replacementChapterId,
    "ch_v34_replacement",
  );
  assert.equal(
    linkedUploadItem.thumbnailKey,
    "upload/thumbnails/job_v34_upload/item_v34_upload.webp",
  );
  database.close();
});

test("V34 backfills legacy roles and permits Manager as a synchronized primary role", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const names = await migrationNames();
  for (const name of names) {
    if (name === "0022_peaceful_microbe.sql") break;
    await applyMigration(database, name);
  }

  const legacyRoles = [
    "OWNER",
    "ADMINISTRATOR",
    "MODERATOR",
    "TEAM_LEADER",
    "UPLOADER",
    "USER",
  ];
  const insertUser = database.prepare(
    `INSERT INTO users
     (id, email, display_name, primary_role, status)
     VALUES (?, ?, ?, ?, 'ACTIVE')`,
  );
  for (const role of legacyRoles) {
    insertUser.run(
      `usr_v34_${role}`,
      `${role.toLowerCase()}-v34@example.com`,
      role,
      role,
    );
  }
  for (const name of names.slice(names.indexOf("0022_peaceful_microbe.sql"))) {
    await applyMigration(database, name);
  }

  const backfilled = database
    .prepare(
      `SELECT user_id AS userId, role
         FROM user_roles
        WHERE user_id LIKE 'usr_v34_%'`,
    )
    .all();
  assert.equal(backfilled.length, legacyRoles.length);
  for (const role of legacyRoles) {
    assert.ok(
      backfilled.some(
        (entry) =>
          entry.userId === `usr_v34_${role}` && entry.role === role,
      ),
    );
  }

  database
    .prepare(
      `INSERT INTO users
       (id, email, display_name, primary_role, status)
       VALUES (
         'usr_v34_manager',
         'manager-v34@example.com',
         'Manager',
         'MANAGER',
         'ACTIVE'
       )`,
    )
    .run();
  database
    .prepare(
      `UPDATE users SET primary_role = 'MANAGER'
        WHERE id = 'usr_v34_USER'`,
    )
    .run();
  assert.equal(
    database
      .prepare(
        `SELECT primary_role AS primaryRole FROM users
          WHERE id = 'usr_v34_USER'`,
      )
      .get().primaryRole,
    "MANAGER",
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE users SET primary_role = 'ROOT'
            WHERE id = 'usr_v34_USER'`,
        )
        .run(),
    /invalid_user_role/u,
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("comment moderation protects privileged targets through the full role union", async () => {
  const source = await read("app/api/v1/[...resource]/route.ts");
  assert.match(
    source,
    /SELECT role[\s\S]+FROM user_roles[\s\S]+WHERE user_id = \?/u,
  );
  assert.match(
    source,
    /\["OWNER", "ADMINISTRATOR", "MANAGER", "MODERATOR"\]\.includes\(role\)/u,
  );
  assert.match(source, /!actor\.roles\.includes\("OWNER"\)/u);
  assert.match(source, /targetRoles\.includes\("OWNER"\)/u);
  assert.match(
    source,
    /COUNT\(DISTINCT owner_user\.id\)[\s\S]+owner_role\.role = 'OWNER'/u,
  );
});

test("V34 role capabilities and server guards honor every assigned role", async () => {
  assert.equal(
    canAny(["USER", "MANAGER"], "admin.series-requests.review"),
    true,
  );
  assert.equal(canAny(["USER", "MANAGER"], "admin.support.manage"), true);
  assert.equal(canAny(["USER", "MANAGER"], "upload.create"), false);
  assert.equal(canAny(["USER", "TEAM_LEADER"], "upload.create"), true);
  assert.equal(
    canAny(["USER", "TEAM_LEADER"], "chapter.publish.assigned"),
    true,
  );
  assert.equal(
    canAny(["USER", "UPLOADER"], "chapter.publish.assigned"),
    false,
  );

  const [queue, uploadJobs, uploadFiles, chapterManagement] =
    await Promise.all([
      read("app/api/v1/admin/series-requests/route.ts"),
      read("app/api/v1/upload-jobs/route.ts"),
      read("app/api/v1/upload-job-files/route.ts"),
      read("lib/server/chapter-management.ts"),
    ]);
  assert.match(queue, /action === "APPROVE" && capabilities\.canApprove/u);
  assert.match(queue, /action === "ADD_FEEDBACK" && capabilities\.canReply/u);
  assert.match(
    queue,
    /action === "ASSIGN_REVIEWER" && capabilities\.canReassign/u,
  );
  assert.match(
    queue,
    /action === "ATTACH_EXISTING" && capabilities\.canAttachExisting/u,
  );
  for (const source of [uploadJobs, uploadFiles, chapterManagement]) {
    assert.match(source, /FROM user_roles live_role/u);
    assert.match(
      source,
      /live_actor\.primary_role IN \('TEAM_LEADER', 'UPLOADER'\)/u,
    );
  }
  assert.match(chapterManagement, /chapter\.publish\.assigned/u);
});

test("V34 public chapter thumbnails accept only canonical public rights states", async () => {
  const [route, uploadRoute] = await Promise.all([
    read("app/api/v1/chapter-thumbnail/route.ts"),
    read("app/api/v1/upload-job-thumbnail/route.ts"),
  ]);
  assert.match(
    route,
    /s\.rights_status IN\s+\('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL'\)/u,
  );
  assert.doesNotMatch(route, /'ACTIVE', 'CLAIMED'/u);
  assert.match(route, /c\.state = 'PUBLISHED'/u);
  assert.match(route, /c\.visibility = 'PUBLIC'/u);
  assert.match(route, /datetime\(c\.published_at\) <= datetime\('now'\)/u);

  assert.match(uploadRoute, /function liveThumbnailAuthorization/u);
  assert.match(uploadRoute, /FROM user_roles live_admin_role/u);
  assert.match(uploadRoute, /FROM user_roles live_upload_role/u);
  assert.match(uploadRoute, /FROM team_memberships live_membership/u);
  assert.match(
    uploadRoute,
    /live_team\.verification_status = 'VERIFIED'/u,
  );
  assert.doesNotMatch(uploadRoute, /series_team_assignments/u);
  assert.doesNotMatch(uploadRoute, /live_assignment/u);
  assert.match(
    uploadRoute,
    /live_membership\.membership_role\) IN\s+\('OWNER', 'LEADER', 'TEAM_LEADER', 'MANAGER', 'UPLOADER'\)/u,
  );
  assert.match(
    uploadRoute,
    /\$\{alias\}\.user_id = live_actor\.id[\s\S]+OR UPPER\(live_membership\.membership_role\)/u,
  );
  assert.equal(
    (uploadRoute.match(/liveThumbnailAuthorization\("guarded_job"\)/gu) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(uploadRoute, /user_id = \? OR \? = 1/u);
});
