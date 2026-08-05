import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migrationNames() {
  return (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of await migrationNames()) {
    database.exec(
      (await read(`drizzle/${migration}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

function tableColumns(database, table) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name),
  );
}

function quotedValues(source) {
  return [...source.matchAll(/"([A-Za-z0-9:_-]+)"/gu)].map(
    (match) => match[1],
  );
}

test("Version 46 migration 0035 is journaled and installs its relational model", async () => {
  const names = await migrationNames();
  assert.ok(names.includes("0035_slim_giant_girl.sql"));

  const journal = JSON.parse(await read("drizzle/meta/_journal.json"));
  const version46Entry = journal.entries.find(
    (entry) => entry.tag === "0035_slim_giant_girl",
  );
  assert.deepEqual(
    {
      index: version46Entry?.idx,
      tag: version46Entry?.tag,
      breakpoints: version46Entry?.breakpoints,
    },
    {
      index: 35,
      tag: "0035_slim_giant_girl",
      breakpoints: true,
    },
  );

  const database = await migratedDatabase();
  try {
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const table of [
      "api_keys",
      "api_key_rate_limits",
      "homepage_sliders",
      "site_announcements",
      "floating_ads",
      "uploader_approvals",
      "upload_review_events",
    ]) {
      assert.ok(tables.has(table), `${table} should be created by migration 0035`);
    }
    assert.ok(tableColumns(database, "upload_jobs").has("source_url"));
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("homepage sliders are independent records with a database-enforced active limit of nine", async () => {
  const database = await migratedDatabase();
  try {
    database.prepare("DELETE FROM homepage_sliders").run();
    const insert = database.prepare(
      `INSERT INTO homepage_sliders (id, title, is_active, sort_order)
       VALUES (?, ?, ?, ?)`,
    );
    for (let index = 1; index <= 9; index += 1) {
      insert.run(`slider_v46_${index}`, `Slider ${index}`, 1, index);
    }
    assert.throws(
      () => insert.run("slider_v46_10", "Slider 10", 1, 10),
      /HOMEPAGE_SLIDER_ACTIVE_LIMIT/u,
    );

    insert.run("slider_v46_10", "Slider 10", 0, 10);
    assert.throws(
      () =>
        database
          .prepare(
            "UPDATE homepage_sliders SET is_active = 1 WHERE id = ?",
          )
          .run("slider_v46_10"),
      /HOMEPAGE_SLIDER_ACTIVE_LIMIT/u,
    );
    database
      .prepare("UPDATE homepage_sliders SET is_active = 0 WHERE id = ?")
      .run("slider_v46_1");
    database
      .prepare("UPDATE homepage_sliders SET is_active = 1 WHERE id = ?")
      .run("slider_v46_10");
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM homepage_sliders WHERE is_active = 1",
        )
        .get().count,
      9,
    );
  } finally {
    database.close();
  }

  const [adminRoute, publicRoute] = await Promise.all([
    read("app/api/v1/admin/sliders/route.ts"),
    read("app/api/v1/homepage-sliders/route.ts"),
  ]);
  assert.match(adminRoute, /SLIDER_LIMIT_REACHED/u);
  assert.match(adminRoute, /replaceActiveId/u);
  assert.match(adminRoute, /ORDER BY datetime\(hs\.created_at\) DESC/u);
  assert.doesNotMatch(adminRoute, /editor_picks/u);
  assert.match(publicRoute, /FROM homepage_sliders/u);
});

test("API Control stores hashes only, exposes a fixed scope vocabulary, and rotates old keys", async () => {
  const database = await migratedDatabase();
  try {
    const columns = tableColumns(database, "api_keys");
    assert.ok(columns.has("secret_hash"));
    assert.ok(columns.has("key_prefix"));
    for (const forbidden of ["secret", "raw_key", "plaintext_key"] ) {
      assert.equal(columns.has(forbidden), false, `${forbidden} must never be stored`);
    }

    database.prepare(
      `INSERT INTO users (id, email, display_name, primary_role, status)
       VALUES ('usr_v46_api', 'api-v46@example.com', 'API V46', 'OWNER', 'ACTIVE')`,
    ).run();
    database.prepare(
      `INSERT INTO api_keys
       (id, app_name, key_prefix, secret_hash, scopes_json, created_by_user_id)
       VALUES ('key_v46', 'Discord bot', 'prefix46', 'sha256-only',
               '["series:read","upload:chapter"]', 'usr_v46_api')`,
    ).run();
    const stored = database
      .prepare(
        `SELECT key_prefix AS prefix, secret_hash AS secretHash, scopes_json AS scopes
           FROM api_keys WHERE id = 'key_v46'`,
      )
      .get();
    assert.deepEqual(
      { ...stored },
      {
        prefix: "prefix46",
        secretHash: "sha256-only",
        scopes: '["series:read","upload:chapter"]',
      },
    );
    assert.throws(
      () =>
        database.prepare(
          `UPDATE api_keys SET status = 'DISABLED' WHERE id = 'key_v46'`,
        ).run(),
      /api_keys_status_check/u,
    );
  } finally {
    database.close();
  }

  const [keyHelper, adminRoute, externalUpload] = await Promise.all([
    read("lib/server/api-keys.ts"),
    read("app/api/v1/admin/api-keys/route.ts"),
    read("app/api/external/v1/upload-jobs/route.ts"),
  ]);
  const scopeBlock = keyHelper.slice(
    keyHelper.indexOf("export const API_KEY_SCOPES"),
    keyHelper.indexOf("] as const") + 1,
  );
  assert.deepEqual(quotedValues(scopeBlock), [
    "series:read",
    "series:create",
    "upload:chapter",
  ]);
  assert.match(keyHelper, /crypto\.subtle\.digest\("SHA-256"/u);
  assert.match(keyHelper, /constantTimeEqual/u);
  assert.match(keyHelper, /API_SCOPE_REQUIRED/u);
  assert.match(keyHelper, /API_TEAM_SCOPE_REQUIRED/u);
  assert.match(adminRoute, /requireOwner\(actor\)/u);
  assert.match(adminRoute, /status = 'ROTATED'/u);
  assert.match(adminRoute, /replaced_by_key_id/u);
  assert.match(externalUpload, /requireApiKey\(request, "upload:chapter"\)/u);
  assert.match(externalUpload, /assertApiTeam\(principal, payload\.teamId\)/u);
  assert.match(externalUpload, /idempotency-key/u);
});

test("team membership roles are reduced to Owner, Leader, and Uploader and protect the final owner", async () => {
  const database = await migratedDatabase();
  try {
    database.exec(`
      INSERT INTO users (id, email, display_name, primary_role, status)
      VALUES
        ('usr_v46_owner', 'owner-v46@example.com', 'Owner V46', 'OWNER', 'ACTIVE'),
        ('usr_v46_member', 'member-v46@example.com', 'Member V46', 'UPLOADER', 'ACTIVE');
      INSERT INTO teams (id, slug, name, verification_status)
      VALUES ('team_v46_roles', 'team-v46-roles', 'Team V46 Roles', 'VERIFIED');
      INSERT INTO team_memberships (team_id, user_id, membership_role, status)
      VALUES ('team_v46_roles', 'usr_v46_owner', 'OWNER', 'ACTIVE');
    `);
    assert.throws(
      () =>
        database.prepare(
          `INSERT INTO team_memberships
           (team_id, user_id, membership_role, status)
           VALUES ('team_v46_roles', 'usr_v46_member', 'CLEANER', 'ACTIVE')`,
        ).run(),
      /TEAM_MEMBERSHIP_ROLE_INVALID/u,
    );
    database.prepare(
      `INSERT INTO team_memberships
       (team_id, user_id, membership_role, status)
       VALUES ('team_v46_roles', 'usr_v46_member', 'UPLOADER', 'ACTIVE')`,
    ).run();
    assert.throws(
      () =>
        database.prepare(
          `UPDATE team_memberships SET membership_role = 'REDRAWER'
            WHERE team_id = 'team_v46_roles' AND user_id = 'usr_v46_member'`,
        ).run(),
      /TEAM_MEMBERSHIP_ROLE_INVALID/u,
    );
  } finally {
    database.close();
  }

  const route = await read("app/api/v1/admin/team-members/route.ts");
  const roleBlock = route.slice(
    route.indexOf("const roleSchema"),
    route.indexOf(";", route.indexOf("const roleSchema")) + 1,
  );
  assert.deepEqual(quotedValues(roleBlock), ["OWNER", "LEADER", "UPLOADER"]);
  assert.match(route, /removesOwner/u);
  assert.match(route, /membership_role = 'OWNER'/u);
  assert.match(route, /FINAL_TEAM_OWNER_PROTECTED/u);
  assert.match(route, /Number\(owners\?\.count \?\? 0\) <= 1/u);
});

test("single chapter upload requires a team, documents the 250 MB limit, and persists Drive sources", async () => {
  const [schema, route, workspace] = await Promise.all([
    read("lib/server/upload-jobs.ts"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
  ]);

  const createSchema = schema.slice(
    schema.indexOf("export const createUploadJobSchema"),
    schema.indexOf("export const uploadJobMutationSchema"),
  );
  assert.match(createSchema, /teamId:\s*z\.string\(\)\.trim\(\)\.min\(3\)/u);
  assert.match(createSchema, /value\.kind === "SINGLE" && value\.items\.length !== 1/u);
  assert.match(createSchema, /drive\.google\.com/u);
  assert.match(createSchema, /docs\.google\.com/u);
  assert.match(route, /payload\.sourceUrl/u);
  assert.match(route, /source_url/u);

  assert.match(
    workspace,
    /Upload the content of your chapter as images, a compressed folder, or through a Google Drive link\./u,
  );
  assert.match(workspace, /Chapter size limit: 250 MB/u);
  assert.match(workspace, /function SingleTeamChooser/u);
  assert.match(workspace, /if \(!teamId\)[\s\S]*Choose your active team\./u);
  assert.match(workspace, /<option value="GOOGLE_DRIVE">Google Drive link<\/option>/u);
  assert.match(
    workspace,
    /sourceUrl: ingestMethod === "GOOGLE_DRIVE" \? googleDriveUrl : null/u,
  );
});

test("Latest Updates derives selectable languages from currently public releases", async () => {
  const [route, app] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const latestRoute = route.slice(
    route.indexOf('if (path === "latest-releases")'),
    route.indexOf('if (path === "search")'),
  );
  const availableQueryStart = latestRoute.indexOf(
    "SELECT DISTINCT LOWER(c.language) AS language",
  );
  const availableQuery = latestRoute.slice(
    availableQueryStart,
    latestRoute.indexOf(".all<{ language: string }>()", availableQueryStart),
  );
  assert.ok(availableQueryStart >= 0, "latest releases should query available languages");
  assert.match(availableQuery, /publicSeriesPredicate/u);
  assert.match(availableQuery, /c\.state = 'PUBLISHED'/u);
  assert.match(availableQuery, /c\.visibility = 'PUBLIC'/u);
  assert.match(availableQuery, /datetime\(c\.published_at\) <= datetime\('now'\)/u);
  assert.doesNotMatch(availableQuery, /chapterLanguagePredicate/u);
  assert.match(latestRoute, /availableLanguages:/u);
  assert.match(latestRoute, /\.array\(languageCodeSchema\)[\s\S]*\.max\(languageOptions\.length\)/u);
  assert.match(latestRoute, /\[\.\.\.new Set\(parsedLanguages\)\]/u);

  const latestGrid = app.slice(
    app.indexOf("function LatestUpdatesGrid"),
    app.indexOf("function TrendingShowcase"),
  );
  assert.match(latestGrid, /setAvailableLanguages\(payload\.availableLanguages \?\? \[\]\)/u);
  assert.match(latestGrid, /availableLanguages\.map/u);
  assert.doesNotMatch(latestGrid, /releaseLanguages\.length >= 2/u);
  assert.doesNotMatch(latestGrid, /slice\(0, 2\)/u);
});

test("announcements accept exactly four typed variants and publish only in their active window", async () => {
  const database = await migratedDatabase();
  try {
    database.prepare("DELETE FROM site_announcements").run();
    const insert = database.prepare(
      `INSERT INTO site_announcements
       (id, type, title, body, is_active, starts_at, ends_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    for (const type of ["UPDATE", "ISSUE", "SUPPORT", "NOTICE"]) {
      insert.run(`announcement_v46_${type}`, type, `${type} title`, `${type} body`, null, null);
    }
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM site_announcements").get().count,
      4,
    );
    assert.throws(
      () => insert.run("announcement_v46_bad", "PROMO", "Bad", "Bad", null, null),
      /site_announcements_type_check/u,
    );
    assert.throws(
      () =>
        insert.run(
          "announcement_v46_dates",
          "NOTICE",
          "Bad dates",
          "The end is before the start",
          "2026-08-06T00:00:00.000Z",
          "2026-08-05T00:00:00.000Z",
        ),
      /site_announcements_date_check/u,
    );
  } finally {
    database.close();
  }

  const [adminRoute, publicRoute, app] = await Promise.all([
    read("app/api/v1/admin/home-promotions/route.ts"),
    read("app/api/v1/home-promotions/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const announcementSchema = adminRoute.slice(
    adminRoute.indexOf("const announcementSchema"),
    adminRoute.indexOf("const adSchema"),
  );
  assert.deepEqual(
    quotedValues(announcementSchema).filter((value) =>
      ["UPDATE", "ISSUE", "SUPPORT", "NOTICE"].includes(value),
    ),
    ["UPDATE", "ISSUE", "SUPPORT", "NOTICE"],
  );
  assert.match(publicRoute, /starts_at IS NULL OR datetime\(starts_at\) <= CURRENT_TIMESTAMP/u);
  assert.match(publicRoute, /ends_at IS NULL OR datetime\(ends_at\) > CURRENT_TIMESTAMP/u);
  assert.match(app, /data-type=\{announcement\.type\.toLowerCase\(\)\}/u);
  const announcementList = app.indexOf('className="v46-announcement-list"');
  const latestUpdates = app.indexOf("<LatestUpdatesGrid />", announcementList);
  assert.ok(announcementList >= 0 && latestUpdates > announcementList);
});

test("unapproved and first-time uploaders are routed through review", async () => {
  const database = await migratedDatabase();
  try {
    database.prepare(
      `INSERT INTO users (id, email, display_name, primary_role, status)
       VALUES ('usr_v46_review', 'review-v46@example.com', 'Review V46', 'UPLOADER', 'ACTIVE')`,
    ).run();
    database.prepare(
      `INSERT INTO uploader_approvals (user_id, status)
       VALUES ('usr_v46_review', 'UNAPPROVED')`,
    ).run();
    assert.throws(
      () =>
        database.prepare(
          `UPDATE uploader_approvals SET status = 'TRUSTED'
            WHERE user_id = 'usr_v46_review'`,
        ).run(),
      /uploader_approvals_status_check/u,
    );
  } finally {
    database.close();
  }

  const [route, workspace] = await Promise.all([
    read("app/api/v1/upload-jobs/route.ts"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
  ]);
  assert.match(route, /FROM uploader_approvals WHERE user_id = \?/u);
  assert.match(route, /hasSubmittedUpload:/u);
  assert.match(route, /uploaderApproval\?\.status !== "APPROVED"/u);
  assert.match(route, /needsReview\s*\?\s*"PENDING_REVIEW"/u);
  assert.match(
    workspace,
    /uploaderReview\.requiresReview && !options\.uploaderReview\.hasSubmittedUpload/u,
  );
  assert.match(workspace, /Submit for required review/u);
});

test("the chapter reaction preset is the six Asura-style reactions", async () => {
  const database = await migratedDatabase();
  try {
    const reactions = database.prepare(
      `SELECT name
         FROM custom_reactions
        WHERE usage_kind = 'REACTION'
          AND is_active = 1
          AND is_archived = 0
        ORDER BY display_order, name COLLATE NOCASE
        LIMIT 6`,
    ).all();
    assert.deepEqual(
      reactions.map((reaction) => reaction.name),
      ["Upvote", "Funny", "Love", "Surprised", "Angry", "Sad"],
    );
  } finally {
    database.close();
  }
});

test("chapter reaction UI and API expose exactly six choices", async () => {
  const [route, app] = await Promise.all([
    read("app/api/v1/chapter-reactions/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const snapshot = route.slice(
    route.indexOf("async function snapshot"),
    route.indexOf("async function replyBadge"),
  );
  assert.match(snapshot, /LIMIT 6/u);
  assert.match(app, /What do you think about this chapter\?/u);
  assert.match(app, /Choose one reaction\./u);
});
