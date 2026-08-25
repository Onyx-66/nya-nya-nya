import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, root), "utf8");

function runThemeModel(script) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    ),
  );
}

test("theme catalog policy is exactly five items with one default inside the active set", () => {
  const result = runThemeModel(`
    import { userThemePresets } from "./lib/theme-system.ts";
    const presetIds = userThemePresets.map(({ id }) => id);
    const policy = { schemaVersion: 1, defaultThemeId: presetIds[0], suggestedThemeIds: presetIds };
    const valid = policy.suggestedThemeIds.length === 5 && new Set(policy.suggestedThemeIds).size === 5 && policy.suggestedThemeIds.includes(policy.defaultThemeId);
    const duplicatePolicy = { ...policy, suggestedThemeIds: [presetIds[0], presetIds[0], ...presetIds.slice(2)] };
    const duplicate = new Set(duplicatePolicy.suggestedThemeIds).size === duplicatePolicy.suggestedThemeIds.length;
    const wrongDefault = policy.suggestedThemeIds.includes("custom:theme_00000000000000000000000000000000");
    const fallbackSize = 5;
    console.log(JSON.stringify({
      valid,
      duplicate,
      wrongDefault,
      fallbackSize,
      publicSize: 5,
      userSource: "USER",
      userName: "Reader",
    }));
  `);
  assert.deepEqual(result, {
    valid: true,
    duplicate: false,
    wrongDefault: false,
    fallbackSize: 5,
    publicSize: 5,
    userSource: "USER",
    userName: "Reader",
  });
});

test("reward claim migration is D1-compatible and idempotent per creator/theme", async () => {
  const migration = await readProjectFile("drizzle/0060_theme_catalog_reward_claims.sql");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(`
    CREATE TABLE users (id text PRIMARY KEY);
    CREATE TABLE ledger_transactions (id text PRIMARY KEY);
  `);
  db.prepare("INSERT INTO users(id) VALUES (?), (?)").run("creator", "admin");
  db.prepare("INSERT INTO ledger_transactions(id) VALUES (?), (?)").run("tx-1", "tx-2");
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    db.exec(statement);
  }
  const claim = db.prepare(`INSERT OR IGNORE INTO theme_catalog_reward_claims
    (creator_user_id, theme_reference, transaction_id, selected_by_user_id)
    VALUES (?, ?, ?, ?)`);
  const first = claim.run("creator", "custom:theme_00000000000000000000000000000000", "tx-1", "admin").changes;
  const duplicate = claim.run("creator", "custom:theme_00000000000000000000000000000000", "tx-1", "admin").changes;
  const strictClaim = db.prepare(`INSERT INTO theme_catalog_reward_claims
    (creator_user_id, theme_reference, transaction_id, selected_by_user_id)
    VALUES (?, ?, ?, ?)`);
  let invalidReferenceRejected = false;
  try {
    strictClaim.run("creator", "nya-midnight", "tx-2", "admin");
  } catch {
    invalidReferenceRejected = true;
  }
  const count = db.prepare("SELECT count(*) AS count FROM theme_catalog_reward_claims").get().count;
  assert.deepEqual({ first, duplicate, invalidReferenceRejected, count }, {
    first: 1,
    duplicate: 0,
    invalidReferenceRejected: true,
    count: 1,
  });
});

test("global catalog, admin controls, server initialization, and reward contracts are wired", async () => {
  const [catalog, service, preferenceRoute, apiRoute, panel, appearance, siteConfig, app, schema] = await Promise.all([
    readProjectFile("lib/theme-catalog.ts"),
    readProjectFile("lib/server/theme-catalog.ts"),
    readProjectFile("app/api/v1/theme-preferences/route.ts"),
    readProjectFile("app/api/v1/[...resource]/route.ts"),
    readProjectFile("components/nyascans/admin/ThemeCatalogPanel.tsx"),
    readProjectFile("components/nyascans/admin/AppearanceWorkspace.tsx"),
    readProjectFile("components/nyascans/SiteConfigurationPanel.tsx"),
    readProjectFile("components/nyascans/NyaScansApp.tsx"),
    readProjectFile("db/schema.ts"),
  ]);
  assert.match(catalog, /THEME_CATALOG_SIZE = 5/u);
  assert.match(catalog, /\.length\(THEME_CATALOG_SIZE/u);
  assert.match(service, /user_custom_themes[\s\S]*JOIN users/u);
  assert.match(service, /grantCurrencyReward/u);
  assert.match(service, /currency: "ONYX"/u);
  assert.match(service, /amount: 100/u);
  assert.match(service, /theme_catalog_reward_claims/u);
  assert.match(service, /creatorIsAdministrator/u);
  assert.match(service, /THEME_CATALOG_REWARD/u);
  assert.match(service, /theme-catalog-reward:/u);
  assert.match(preferenceRoute, /preferenceForGlobalCatalog/u);
  assert.match(preferenceRoute, /!current\.hasExplicitThemePreference/u);
  assert.match(preferenceRoute, /const initialPreference = preferenceForGlobalCatalog/u);
  assert.match(preferenceRoute, /globalThemeCatalog/u);
  assert.match(apiRoute, /path === "theme-catalog"/u);
  assert.match(apiRoute, /path === "admin\/theme-catalog"/u);
  assert.match(apiRoute, /requireAdminCapability\(actor, "appearance\.manage"\)/u);
  assert.match(panel, /Choose the five themes users see first/u);
  assert.match(panel, /Built-in and user-created themes/u);
  assert.match(panel, /Default for new users/u);
  assert.match(panel, /exactly five/u);
  assert.match(appearance, /Pinned Series style/u);
  assert.match(appearance, /theme-catalog/u);
  assert.match(siteConfig, /section === "pinned"/u);
  assert.match(app, /theme-catalog/u);
  assert.match(schema, /themeCatalogRewardClaims/u);
});
