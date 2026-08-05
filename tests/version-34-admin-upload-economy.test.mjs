import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { canAny, ROLES } from "../lib/permissions.mjs";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migrationName of migrations) {
    const migration = await read(`drizzle/${migrationName}`);
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

function columns(database, table) {
  return new Set(
    database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name),
  );
}

test("Version 34 migrations align roles, thumbnails, analytics, and global Roulette cadence", async () => {
  const database = await migratedDatabase();
  try {
    for (const table of [
      "user_roles",
      "upload_job_media_guards",
      "roulette_pool_counters",
      "roulette_reward_cadence",
    ]) {
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(table).count,
        1,
      );
    }

    for (const field of ["access_revision", "access_update_token"]) {
      assert.ok(columns(database, "users").has(field));
    }
    assert.ok(columns(database, "chapters").has("thumbnail_key"));
    assert.ok(columns(database, "upload_job_items").has("thumbnail_key"));
    assert.ok(columns(database, "roulette_spins").has("global_spin_number"));
    assert.ok(columns(database, "roulette_pool_counters").has("last_spin_id"));
    assert.ok(columns(database, "analytics_events").has("visitor_id"));

    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_v34_roles', 'v34@example.com', 'V34 Roles', 'MANAGER', 'ACTIVE');
      INSERT INTO user_roles (user_id, role)
      VALUES
        ('usr_v34_roles', 'MANAGER'),
        ('usr_v34_roles', 'UPLOADER');
    `);
    assert.deepEqual(
      database
        .prepare(
          "SELECT role FROM user_roles WHERE user_id = ? ORDER BY role",
        )
        .all("usr_v34_roles")
        .map((row) => row.role),
      ["MANAGER", "UPLOADER"],
    );
    assert.throws(() =>
      database.exec(`
        INSERT INTO users
          (id, email, display_name, primary_role, status)
        VALUES
          ('usr_v34_invalid', 'invalid@example.com', 'Invalid', 'ROOT', 'ACTIVE');
      `),
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("multi-role authorization grants the union while managers stay least-privileged", async () => {
  const [
    policy,
    chapterAccess,
    queueRoute,
    supportRoute,
    adminPage,
    usersPanel,
    api,
  ] = await Promise.all([
    read("lib/server/policy.ts"),
    read("lib/server/chapter-access.ts"),
    read("app/api/v1/admin/series-requests/route.ts"),
    read("app/api/v1/admin/support-tickets/route.ts"),
    read("app/onyx/admin/access/[[...slug]]/page.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  assert.equal(
    canAny([ROLES.MANAGER, ROLES.UPLOADER], "upload.create"),
    true,
  );
  assert.equal(canAny([ROLES.MANAGER], "admin.series-requests.review"), true);
  assert.equal(canAny([ROLES.MANAGER], "admin.support.manage"), true);
  assert.equal(canAny([ROLES.MANAGER], "admin.audit.read"), false);
  assert.equal(canAny([ROLES.ADMINISTRATOR], "admin.audit.read"), false);
  assert.equal(canAny([ROLES.OWNER], "admin.audit.read"), true);

  assert.match(policy, /FROM user_roles/u);
  assert.match(policy, /const roles = \[[\s\S]+roleRows\.results/u);
  assert.match(policy, /resolvedPrimaryRole = highestRole/u);
  assert.match(chapterAccess, /canAny\(/u);
  assert.doesNotMatch(chapterAccess, /can\(actor\.primaryRole/u);

  assert.match(queueRoute, /requireActor\("admin\.series-requests\.review"\)/u);
  assert.match(queueRoute, /requireAdminConsole\(actor\)/u);
  assert.match(queueRoute, /canApprove:\s*reviewer/u);
  assert.match(queueRoute, /canReject:\s*reviewer/u);
  assert.match(queueRoute, /canReply:\s*reviewer/u);
  assert.match(queueRoute, /canStartReview:\s*fullAdministrator/u);
  assert.match(supportRoute, /requireActor\("admin\.support\.manage"\)/u);
  assert.match(adminPage, /managerSections = new Set\(\[[\s\S]*new-series-queue/u);
  assert.match(adminPage, /support-tickets/u);

  assert.match(usersPanel, /className="user-role-chips"/u);
  assert.match(usersPanel, /expectedAccessRevision:\s*user\.accessRevision/u);
  assert.match(usersPanel, /ownerManagedRoles/u);
  assert.match(api, /SELECT role FROM user_roles WHERE user_id = \?/u);
  assert.match(api, /highestRole\(nextRoles\)/u);
  assert.match(api, /FINAL_OWNER_PROTECTED/u);
  assert.match(api, /access_revision = access_revision \+ 1/u);
});

test("series requests, catalogue editing, and chapter thumbnails preserve visual context", async () => {
  const [
    requests,
    seriesPanel,
    upload,
    uploadThumbnail,
    chapterThumbnail,
    jobsRoute,
    api,
  ] = await Promise.all([
    read("components/nyascans/upload/SeriesRequestWorkspace.tsx"),
    read("components/nyascans/admin/SeriesManagementPanel.tsx"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("app/api/v1/upload-job-thumbnail/route.ts"),
    read("app/api/v1/chapter-thumbnail/route.ts"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  assert.match(
    requests,
    /payload\.data\.find\([\s\S]+payload\.data\[0\][\s\S]+setSelected\(detail\.data\)/u,
  );
  assert.match(requests, /className="request-record-cover"/u);
  assert.match(requests, /record\.coverUrl/u);
  assert.doesNotMatch(requests, /Select a request/u);

  assert.match(
    seriesPanel,
    /Select and edit an existing series[\s\S]+reviewed series-request queue/u,
  );
  assert.match(seriesPanel, /record\.coverUrl[\s\S]+<img src=\{record\.coverUrl\}/u);
  assert.doesNotMatch(seriesPanel, /setMode\("create"\)|startCreate|createSeries/u);

  assert.match(upload, /className="upload-series-cover"/u);
  assert.match(upload, /series\.coverUrl/u);
  assert.match(upload, /\/api\/v1\/upload-job-thumbnail/u);
  assert.match(upload, /onThumbnailChange/u);
  assert.match(upload, /Chapter thumbnail/u);
  const composer = upload.slice(upload.indexOf("<form"));
  const releaseContext = composer.indexOf("Quick upload settings");
  const pages = composer.indexOf('"Chapter content"');
  const batchSettings = composer.indexOf(">Upload queue<");
  assert.ok(releaseContext >= 0);
  assert.ok(pages > releaseContext);
  assert.ok(batchSettings > pages);

  assert.match(uploadThumbnail, /requireActor\("upload\.create"\)/u);
  assert.match(uploadThumbnail, /upload_job_media_guards/u);
  assert.match(uploadThumbnail, /THUMBNAIL_NOT_SQUARE/u);
  assert.match(uploadThumbnail, /current\.revision !== expectedRevision/u);
  assert.match(jobsRoute, /uji\.thumbnail_key/u);
  assert.match(api, /thumbnail_key = \([\s\S]+SELECT thumbnail_key FROM chapters/u);
  assert.match(api, /\/api\/v1\/chapter-thumbnail\?id=/u);
  assert.match(chapterThumbnail, /c\.state = 'PUBLISHED'/u);
  assert.match(chapterThumbnail, /c\.visibility = 'PUBLIC'/u);
  assert.match(chapterThumbnail, /s\.is_published = 1/u);
  assert.match(chapterThumbnail, /s\.rights_status IN/u);
});

test("Paw Coins, premium visibility, and interval Roulette rewards are configurable end to end", async () => {
  const [
    commercial,
    commercialPanel,
    coinIcon,
    rewards,
    rewardPanel,
    roulette,
    storeProducts,
    storePurchases,
    gifts,
  ] = await Promise.all([
    read("lib/commercial-settings.ts"),
    read("components/nyascans/CommercialSettingsPanel.tsx"),
    read("app/api/v1/coin-icon/route.ts"),
    read("lib/reward-settings.ts"),
    read("components/nyascans/admin/RewardSettingsPanel.tsx"),
    read("app/api/v1/roulette/route.ts"),
    read("app/api/v1/store/products/route.ts"),
    read("app/api/v1/store/purchases/route.ts"),
    read("app/api/v1/gifts/route.ts"),
  ]);

  assert.match(commercial, /coinName:\s*"Paw Coin"/u);
  assert.match(commercial, /coinPlural:\s*"Paw Coins"/u);
  assert.match(commercial, /coinIcon:\s*"🐾"/u);
  assert.match(commercial, /premiumEconomyPublic:\s*true/u);
  assert.match(commercialPanel, /Upload coin SVG/u);
  assert.match(commercialPanel, /premiumEconomyPublic/u);
  assert.match(commercialPanel, /\? "Public" : "Hidden"/u);

  assert.match(coinIcon, /requireOwner\(actor\)/u);
  assert.match(coinIcon, /file\.type !== "image\/svg\+xml"/u);
  assert.match(coinIcon, /file\.size > 128_000/u);
  assert.match(coinIcon, /UNSAFE_SVG/u);
  assert.match(coinIcon, /lower\.includes\("<script"\)/u);
  assert.match(coinIcon, /content-security-policy/u);

  assert.match(rewards, /z\.enum\(\["WEIGHT", "GLOBAL_INTERVAL"\]\)/u);
  assert.match(rewards, /globalIntervalSpins/u);
  assert.match(rewards, /filter\(\(reward\) => reward\.enabled\)\.length < 8/u);
  assert.match(rewards, /at least one weighted reward enabled/u);
  assert.match(rewardPanel, /Global spin interval/u);
  assert.match(rewardPanel, /commercial\.economy\.coinPlural/u);
  assert.match(roulette, /roulette_pool_counters/u);
  assert.match(roulette, /roulette_reward_cadence/u);
  assert.match(roulette, /last_spin_id/u);
  assert.match(roulette, /global_spin_number/u);
  assert.match(roulette, /reward\.distributionMode === "GLOBAL_INTERVAL"/u);
  assert.match(roulette, /commercial\.settings\.economy\.coinPlural/u);
  assert.match(roulette, /Shard spins remain available/u);

  assert.match(storeProducts, /premiumEconomyPublic/u);
  assert.match(storePurchases, /PAID_ECONOMY_HIDDEN/u);
  assert.match(gifts, /requirePaidEconomyPublic\(\)/u);
});

test("Users Control and the administrator shell are complete, safe, and responsive", async () => {
  const [app, panel, api, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/globals.css"),
  ]);

  for (const label of [
    "Users Control",
    "Users & roles",
    "User activity",
    "Purchases",
    "Balances",
  ]) {
    assert.ok(app.includes(label));
  }
  assert.match(app, /<details className="ops-account-menu">/u);
  assert.match(app, /actor\.avatarUrl/u);
  assert.match(app, /<span>Reader site<\/span>/u);
  assert.match(app, /<span>Logout<\/span>/u);
  assert.match(panel, /loadSequenceRef/u);
  assert.match(panel, /loadControllerRef\.current\?\.abort\(\)/u);
  assert.match(panel, /adjustmentKeyRef/u);
  assert.match(panel, /crypto\.randomUUID\(\)/u);
  assert.match(panel, /ownerActor = actorRoles\.includes\("OWNER"\)/u);

  assert.match(api, /path === "admin\/user-control"/u);
  assert.match(api, /ownerCanAdjust:\s*actor\.roles\.includes\("OWNER"\)/u);
  assert.match(api, /path === "admin\/balance-adjustments"/u);
  assert.match(api, /requireOwner\(actor\)/u);
  assert.match(api, /balance-adjustment:\$\{payload\.idempotencyKey\}/u);
  assert.match(api, /buyer_entry\.amount < 0/u);
  assert.match(api, /This adjustment would make the user balance negative/u);

  const finalCascade = css.lastIndexOf("Version 34 canonical final cascade");
  assert.ok(finalCascade > css.lastIndexOf("Version 33 final cascade"));
  const finalCss = css.slice(finalCascade);
  assert.match(finalCss, /select:not\(\[multiple\]\)[\s\S]+appearance:\s*none/u);
  assert.match(finalCss, /color-scheme:\s*normal/u);
  assert.match(
    finalCss,
    /\.ops-sidebar[\s\S]+grid-template-rows:\s*auto minmax\(0, 1fr\) auto/u,
  );
  assert.match(finalCss, /\.ops-header,[\s\S]+display:\s*none !important/u);
  assert.match(finalCss, /\.ops-account-menu/u);
  assert.match(finalCss, /\.user-role-chips/u);
  assert.match(finalCss, /\.users-control-metrics/u);
  assert.match(finalCss, /\.chapter-access-manager/u);
  assert.match(finalCss, /\.roulette-admin-list/u);
  assert.match(finalCss, /@media \(max-width: 700px\)/u);
});

test("site overview analytics bind country changes to readable decision metrics", async () => {
  const [api, panel] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);

  assert.match(api, /requestedRegion === "UNKNOWN"[\s\S]+\?\s*"Unknown"/u);
  assert.match(api, /COALESCE\(NULLIF\(region_code, ''\), 'Unknown'\) = \?/u);
  assert.match(
    api,
    /NOT EXISTS \([\s\S]+prior\.visitor_id = analytics_events\.visitor_id/u,
  );
  assert.match(api, /purchaseRankedSeries/u);
  assert.match(api, /topUsers/u);
  assert.match(api, /shardsCollected/u);
  assert.match(api, /registeredUsers/u);
  assert.match(api, /regionScope:\s*selectedRegion/u);

  const activeDataStart = panel.indexOf("const activeData");
  assert.ok(activeDataStart >= 0);
  const expectedRegionStart = panel.lastIndexOf(
    "const expectedRegion",
    activeDataStart,
  );
  assert.ok(expectedRegionStart >= 0);
  const expectedRegionDeclaration = panel.slice(
    expectedRegionStart,
    activeDataStart,
  );
  assert.match(expectedRegionDeclaration, /region\.trim\(\)\.toUpperCase\(\)/u);
  assert.match(expectedRegionDeclaration, /\?\s*"Unknown"/u);
  const activeDataDeclaration = panel.slice(activeDataStart, activeDataStart + 420);
  assert.match(activeDataDeclaration, /selectedRegion/u);
  assert.match(
    activeDataDeclaration,
    /data\.selectedRegion === expectedRegion/u,
  );
  assert.match(panel, /aria-label="Scrollable activity chart"/u);
  assert.match(panel, /aria-label="Line chart of page views and chapter starts"/u);
  assert.match(panel, /className="analytics-data-fallback"/u);
  assert.match(panel, /activeData\.purchaseRankedSeries/u);
  assert.match(panel, /activeData\.topUsers/u);
});
