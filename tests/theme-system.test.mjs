import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, root), "utf8");

const exactTokenKeys = [
  "textColor",
  "mainBackground",
  "accent",
  "accentHover",
  "accentActive",
  "accentL1",
  "accentL1Hover",
  "accentL1Active",
  "accentL2",
  "accentL2Hover",
  "accentL2Active",
  "accentL3",
  "accentL3Hover",
  "accentL3Active",
  "accentL4",
  "accentL4Hover",
  "accentL4Active",
  "accentL5",
  "accentL5Hover",
  "accentL5Active",
  "midTone",
  "contrastL1",
  "scrollbarColor",
  "scrollbarColorHover",
  "buttonAccent",
  "buttonAccentAlternate",
  "primary",
  "primaryL1",
  "primaryL2",
  "statusRed",
  "statusGreen",
  "statusYellow",
  "statusBlue",
  "statusPurple",
  "statusGrey",
  "indicationBlue",
  "danger",
  "dangerL1",
  "dangerL2",
];

function runThemeModel(script) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    ),
  );
}

test("theme schema preserves the exact 39-token contract and adds logo metadata", async () => {
  const source = await readProjectFile("lib/theme-system.ts");
  const keyBlock = source.match(/export const themeTokenKeys = \[([\s\S]*?)\] as const;/u)?.[1] ?? "";
  const keys = [...keyBlock.matchAll(/"([A-Za-z0-9]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(keys, exactTokenKeys);
  assert.match(source, /themeTokensSchema[\s\S]*?\.strict\(\)/u);
  assert.match(source, /themeDocumentSchema[\s\S]*?logoColorOverride: hexColor\.nullable\(\)\.default\(null\)/u);
  assert.match(source, /themeDocumentSchema[\s\S]*?\.strict\(\)/u);
  assert.match(source, /\^#\[0-9a-fA-F\]\{6\}\$/u);
  assert.match(source, /The theme is incomplete or invalid/u);
});

test("portable themes round-trip, migrate logo metadata, and reject malformed or partial input atomically", () => {
  const result = runThemeModel(`
    import {
      encodeThemeForUrl,
      parseThemeImport,
      themeContrastWarnings,
      themeCssVariables,
      themeShareUrl,
      themeTokenKeys,
      userThemePresets,
    } from "./lib/theme-system.ts";
    const theme = userThemePresets[3].theme;
    const legacy = structuredClone(theme);
    delete legacy.logoColorOverride;
    const missing = structuredClone(theme);
    delete missing.tokens.dangerL2;
    const extra = structuredClone(theme);
    extra.tokens.rogue = "#FFFFFF";
    const invalidLogo = { ...structuredClone(theme), logoColorOverride: "red" };
    const rejected = [missing, extra, invalidLogo, { ...theme, type: "sepia" }].every((value) => {
      try { parseThemeImport(JSON.stringify(value)); return false; } catch { return true; }
    });
    let malformed = "";
    try { parseThemeImport("A"); } catch (error) { malformed = error.message; }
    const parsedLegacy = parseThemeImport(JSON.stringify(legacy));
    console.log(JSON.stringify({
      tokenCount: themeTokenKeys.length,
      runtimeVariableCount: Object.keys(themeCssVariables(theme)).length,
      presetCount: userThemePresets.length,
      codeRoundTrip: JSON.stringify(parseThemeImport(encodeThemeForUrl(theme))) === JSON.stringify(theme),
      urlRoundTrip: JSON.stringify(parseThemeImport(themeShareUrl(theme, "https://example.test/account"))) === JSON.stringify(theme),
      legacyLogoDefault: parsedLegacy.logoColorOverride,
      rejected,
      malformed,
      presetWarnings: userThemePresets.flatMap(({ theme }) => themeContrastWarnings(theme)).length,
    }));
  `);
  assert.deepEqual(result, {
    tokenCount: 39,
    runtimeVariableCount: 42,
    presetCount: 5,
    codeRoundTrip: true,
    urlRoundTrip: true,
    legacyLogoDefault: null,
    rejected: true,
    malformed: "The shared theme code is malformed.",
    presetWarnings: 0,
  });
});

test("preference v2 enforces a combined five-theme shortlist and fifteen saved custom themes", () => {
  const result = runThemeModel(`
    import {
      customThemeReference,
      defaultThemePreference,
      MAX_SAVED_CUSTOM_THEMES,
      MAX_SHORTLISTED_THEMES,
      parseThemePreference,
      themePreferenceSchema,
      themeShortlistSchema,
      userThemePresets,
    } from "./lib/theme-system.ts";
    const now = "2026-08-24T12:00:00.000Z";
    const makeSaved = (index) => ({
      id: \`theme_\${index.toString(16).padStart(32, "0")}\`,
      theme: { ...structuredClone(userThemePresets[index % 5].theme), name: \`Custom \${index}\` },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    const customs = Array.from({ length: 15 }, (_, index) => makeSaved(index));
    const firstRef = customThemeReference(customs[0].id);
    const combined = ["nya-midnight", "paper-daylight", "slate-rain", "dracula-bloom", firstRef];
    const valid = themePreferenceSchema.safeParse({
      schemaVersion: 2,
      activeThemeId: firstRef,
      shortlist: combined,
      customThemes: customs,
    }).success;
    const tooManySaved = themePreferenceSchema.safeParse({
      schemaVersion: 2,
      activeThemeId: "nya-midnight",
      shortlist: ["nya-midnight"],
      customThemes: [...customs, makeSaved(15)],
    }).success;
    const tooManyShortlisted = themeShortlistSchema.safeParse([
      "nya-midnight", "paper-daylight", "slate-rain", "dracula-bloom", "jade-night", firstRef,
    ]).success;
    const duplicateShortlist = themeShortlistSchema.safeParse([
      "nya-midnight", "nya-midnight",
    ]).success;
    const activeMissing = themePreferenceSchema.safeParse({
      schemaVersion: 2,
      activeThemeId: firstRef,
      shortlist: ["nya-midnight"],
      customThemes: customs,
    }).success;
    const unknownCustom = themePreferenceSchema.safeParse({
      schemaVersion: 2,
      activeThemeId: "nya-midnight",
      shortlist: ["nya-midnight", "custom:theme_ffffffffffffffffffffffffffffffff"],
      customThemes: customs,
    }).success;
    const migrated = parseThemePreference({
      schemaVersion: 1,
      activeThemeId: "custom",
      customTheme: userThemePresets[1].theme,
    });
    console.log(JSON.stringify({
      maxSaved: MAX_SAVED_CUSTOM_THEMES,
      maxShortlist: MAX_SHORTLISTED_THEMES,
      defaultShortlistLength: defaultThemePreference.shortlist.length,
      valid,
      tooManySaved,
      tooManyShortlisted,
      duplicateShortlist,
      activeMissing,
      unknownCustom,
      migratedVersion: migrated.schemaVersion,
      migratedCount: migrated.customThemes.length,
      migratedActiveOwned: migrated.activeThemeId === customThemeReference(migrated.customThemes[0].id),
      migratedActiveShortlisted: migrated.shortlist.includes(migrated.activeThemeId),
    }));
  `);
  assert.deepEqual(result, {
    maxSaved: 15,
    maxShortlist: 5,
    defaultShortlistLength: 5,
    valid: true,
    tooManySaved: false,
    tooManyShortlisted: false,
    duplicateShortlist: false,
    activeMissing: false,
    unknownCustom: false,
    migratedVersion: 2,
    migratedCount: 1,
    migratedActiveOwned: true,
    migratedActiveShortlisted: true,
  });
});

test("quick switcher renders the curated combined list with type, swatch, active check, and management", async () => {
  const [model, app] = await Promise.all([
    readProjectFile("lib/theme-system.ts"),
    readProjectFile("components/nyascans/NyaScansApp.tsx"),
  ]);
  for (const id of [
    "nya-midnight",
    "paper-daylight",
    "slate-rain",
    "dracula-bloom",
    "jade-night",
  ]) {
    assert.ok(model.includes(`id: "${id}"`));
  }
  assert.match(app, />Change Theme</u);
  assert.match(app, /"Manage themes" : "Select Theme"/u);
  assert.match(app, /controller\.shortlist[\s\S]*?\.map\(entryFor\)/u);
  assert.match(app, /userThemePresets\.map/u);
  assert.match(app, /controller\.customThemes\.map/u);
  assert.match(app, /entry\.source\} · \{entry\.theme\.type/u);
  assert.match(app, /conic-gradient\(from 35deg/u);
  assert.match(app, /aria-checked=\{selected\}/u);
  assert.match(app, /controller\.shortlist\.length >= MAX_SHORTLISTED_THEMES/u);
  assert.match(app, /href="\/theme-builder#manage-themes"/u);
});

test("Theme Identity exposes all five safe actions and a manual-delete saved library", async () => {
  const [builder, controller, route] = await Promise.all([
    readProjectFile("components/nyascans/ThemeBuilderPage.tsx"),
    readProjectFile("components/nyascans/UserThemeSystem.tsx"),
    readProjectFile("app/[...slug]/page.tsx"),
  ]);
  for (const label of [
    "Save theme",
    "Load theme",
    "Create new",
    "Copy theme URL",
    "Export theme",
    "Import theme",
    "Import system theme",
    "Preview",
  ]) {
    assert.match(builder, new RegExp(label, "u"));
  }
  assert.match(builder, /setEditor\([\s\S]*?null,[\s\S]*?new unsaved base/u);
  assert.match(builder, /saveCustomTheme\(document, editingThemeId\)/u);
  assert.match(builder, /Edits stay in this builder until you choose Save/u);
  assert.match(builder, /Create new never overwrites the loaded theme/u);
  assert.match(builder, /customThemes\.length\} \/ \{MAX_SAVED_CUSTOM_THEMES\} saved/u);
  assert.match(builder, /Delete “\$\{saved\.theme\.name\}” permanently/u);
  assert.match(builder, /controller\.deleteCustomTheme\(saved\.id\)/u);
  assert.match(builder, /Delete a saved theme to create a new one/u);
  assert.match(builder, /themeContrastWarnings/u);
  assert.match(builder, /I understand and want to save these colors/u);
  assert.match(controller, /action: "create-custom"/u);
  assert.match(controller, /action: "update-custom"/u);
  assert.match(controller, /action: "delete-custom"/u);
  assert.match(controller, /expectedRevision: existing\.revision/u);
  assert.match(route, /root === "theme-builder"/u);
});

test("account persistence is authenticated, revision-aware, capped, and never auto-prunes", async () => {
  const [api, controller, schema, migration] = await Promise.all([
    readProjectFile("app/api/v1/theme-preferences/route.ts"),
    readProjectFile("components/nyascans/UserThemeSystem.tsx"),
    readProjectFile("db/schema.ts"),
    readProjectFile("drizzle/0058_eager_sentinel.sql"),
  ]);
  assert.match(api, /export async function GET/u);
  assert.match(api, /export async function PATCH/u);
  assert.equal((api.match(/requireActor\(\)/gu) ?? []).length, 2);
  assert.match(api, /assertSameOrigin\(request\)/u);
  assert.match(api, /mutation\.action === "create-custom"/u);
  assert.match(api, /mutation\.action === "update-custom"/u);
  assert.match(api, /mutation\.action === "delete-custom"/u);
  assert.match(api, /mutation\.action === "set-shortlist"/u);
  assert.match(api, /revision = revision \+ 1/u);
  assert.match(api, /theme_preference_revision = user_preferences\.theme_preference_revision \+ 1/u);
  assert.match(api, /mutation\.expectedPreferenceRevision !== current\.preferenceRevision/u);
  assert.match(api, /mutation_marker = \?/u);
  assert.match(api, /CUSTOM_THEME_REVISION_CONFLICT/u);
  assert.match(api, /Delete a saved theme to create a new one/u);
  assert.match(api, /"cache-control": "private, no-store"/u);
  assert.match(controller, /THEME_STORAGE_KEY/u);
  assert.match(controller, /\/api\/v1\/theme-preferences/u);
  assert.match(controller, /mutationQueueRef/u);
  assert.match(controller, /action: "reconcile"/u);
  assert.match(schema, /userCustomThemes/u);
  assert.match(schema, /themeShortlistJson/u);
  assert.match(migration, /CREATE TABLE `user_custom_themes`/u);
  assert.match(migration, /WHERE `user_id` = NEW\.`user_id`[\s\S]*?>= 15/u);
  assert.match(migration, /RAISE\(ABORT, 'CUSTOM_THEME_LIMIT_REACHED'\)/u);
  assert.match(migration, /json_extract\(`settings_json`, '\$\.themeBuilder\.customTheme'\)/u);
  assert.match(migration, /INSERT INTO `user_custom_themes`/u);
  assert.doesNotMatch(migration, /DELETE FROM `user_custom_themes`/u);
  assert.doesNotMatch(migration, /ORDER BY[\s\S]*?DELETE/iu);
});

test("D1 migration preserves valid legacy themes, rejects damaged capacity, enforces 15, and supports preference CAS", () => {
  const result = runThemeModel(`
    import { DatabaseSync } from "node:sqlite";
    import { readFileSync } from "node:fs";
    import { userThemePresets } from "./lib/theme-system.ts";
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec(\`CREATE TABLE users (id text PRIMARY KEY);
      CREATE TABLE user_preferences (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme text NOT NULL DEFAULT 'SYSTEM',
        content_language text NOT NULL DEFAULT 'en',
        reader_mode text NOT NULL DEFAULT 'VERTICAL',
        mature_content integer NOT NULL DEFAULT 0,
        settings_json text NOT NULL DEFAULT '{}',
        custom_theme_json text,
        updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
      );\`);
    db.prepare("INSERT INTO users(id) VALUES (?),(?),(?)").run("valid", "invalid", "cas");
    db.prepare("INSERT INTO user_preferences(user_id,theme,custom_theme_json) VALUES (?,?,?)")
      .run("valid", "custom", JSON.stringify(userThemePresets[0].theme));
    db.prepare("INSERT INTO user_preferences(user_id,theme,custom_theme_json) VALUES (?,?,?)")
      .run("invalid", "custom", '{"broken":true}');
    const migration = readFileSync("drizzle/0058_eager_sentinel.sql", "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      db.exec(statement);
    }
    const validMigrated = db.prepare("SELECT count(*) AS count FROM user_custom_themes WHERE user_id = ?").get("valid").count;
    const invalidMigrated = db.prepare("SELECT count(*) AS count FROM user_custom_themes WHERE user_id = ?").get("invalid").count;
    for (let index = 1; index <= 14; index += 1) {
      db.prepare("INSERT INTO user_custom_themes(user_id,id,theme_json) VALUES (?,?,?)")
        .run("valid", \`theme_\${index.toString(16).padStart(32, "0")}\`, "{}");
    }
    let limitRaised = false;
    try {
      db.prepare("INSERT INTO user_custom_themes(user_id,id,theme_json) VALUES (?,?,?)")
        .run("valid", \`theme_\${"f".repeat(32)}\`, "{}");
    } catch (error) {
      limitRaised = String(error).includes("CUSTOM_THEME_LIMIT_REACHED");
    }
    db.prepare("DELETE FROM user_custom_themes WHERE user_id = ? AND id = ?")
      .run("valid", \`theme_\${"1".padStart(32, "0")}\`);
    const afterExplicitDelete = db.prepare("SELECT count(*) AS count FROM user_custom_themes WHERE user_id = ?").get("valid").count;
    const casSql = \`INSERT INTO user_preferences
      (user_id,theme,content_language,reader_mode,mature_content,settings_json,
       custom_theme_json,theme_shortlist_json,theme_preference_revision,
       theme_mutation_marker,updated_at)
      SELECT ?,?,'en','VERTICAL',0,'{}',NULL,?,1,?,CURRENT_TIMESTAMP
      WHERE ((?=0 AND NOT EXISTS(SELECT 1 FROM user_preferences WHERE user_id=?))
        OR EXISTS(SELECT 1 FROM user_preferences WHERE user_id=? AND theme_preference_revision=?))
      ON CONFLICT(user_id) DO UPDATE SET
        theme=excluded.theme,
        theme_shortlist_json=excluded.theme_shortlist_json,
        theme_preference_revision=user_preferences.theme_preference_revision+1,
        theme_mutation_marker=excluded.theme_mutation_marker,
        updated_at=CURRENT_TIMESTAMP
      WHERE user_preferences.theme_preference_revision=?\`;
    const cas = (theme, expected, marker) => db.prepare(casSql).run(
      "cas", theme, JSON.stringify([theme]), marker,
      expected, "cas", "cas", expected, expected,
    ).changes;
    const firstCas = cas("nya-midnight", 0, "first");
    const staleCas = cas("paper-daylight", 0, "stale");
    const casRow = db.prepare("SELECT theme,theme_preference_revision AS revision FROM user_preferences WHERE user_id = ?").get("cas");
    console.log(JSON.stringify({
      validMigrated,
      invalidMigrated,
      limitRaised,
      afterExplicitDelete,
      firstCas,
      staleCas,
      casRow,
      customColumns: db.prepare("PRAGMA table_info('user_custom_themes')").all().map((row) => row.name),
    }));
  `);
  assert.deepEqual(result, {
    validMigrated: 1,
    invalidMigrated: 0,
    limitRaised: true,
    afterExplicitDelete: 14,
    firstCas: 1,
    staleCas: 0,
    casRow: { theme: "nya-midnight", revision: 1 },
    customColumns: [
      "user_id",
      "id",
      "theme_json",
      "revision",
      "mutation_marker",
      "created_at",
      "updated_at",
    ],
  });
});

test("logo placeholder is inline, part-addressable, live-token-bound, and manually overridable", async () => {
  const [logo, builder, model, css] = await Promise.all([
    readProjectFile("components/nyascans/ThemeAwareLogo.tsx"),
    readProjectFile("components/nyascans/ThemeBuilderPage.tsx"),
    readProjectFile("lib/theme-system.ts"),
    readProjectFile("app/globals.css"),
  ]);
  assert.match(logo, /<svg/u);
  assert.match(logo, /data-logo-part="base"/u);
  assert.match(logo, /data-logo-part="accent"/u);
  assert.match(logo, /data-logo-part="outline"/u);
  assert.match(logo, /var\(--theme-logo-color\)/u);
  assert.match(logo, /var\(--theme-logo-accent-color\)/u);
  assert.match(logo, /var\(--theme-logo-outline-color\)/u);
  assert.match(builder, /<legend>Logo color<\/legend>/u);
  assert.match(builder, />Automatic</u);
  assert.match(builder, />Custom</u);
  assert.match(builder, /logoColorOverride: null/u);
  assert.match(model, /override \?\? theme\.tokens\.textColor/u);
  assert.match(model, /override \?\? theme\.tokens\.primary/u);
  assert.match(css, /\.theme-aware-logo/u);
});

test("notification and browser chrome states are driven by editable theme tokens", async () => {
  const [css, adminCss, browseCss] = await Promise.all([
    readProjectFile("app/globals.css"),
    readProjectFile("app/admin.css"),
    readProjectFile("components/nyascans/BrowseFixes.module.css"),
  ]);
  for (const selectorOrVariable of [
    "::selection",
    "::placeholder",
    ":focus-visible",
    "dialog::backdrop",
    ".header-notifications > span",
    ".notification-card.is-unread",
    ".notification-card.is-read",
    ".system-notification-success",
    ".system-notification-warning",
    ".system-notification-info",
    "--theme-placeholder",
    "--theme-disabled-surface",
    "--theme-tooltip-background",
    "--theme-skeleton-base",
    "--theme-skeleton-highlight",
  ]) {
    assert.ok(css.includes(selectorOrVariable), `${selectorOrVariable} must be tokenized`);
  }
  assert.match(css, /system-notification-success \{ --notice-color: var\(--theme-status-green\)/u);
  assert.match(css, /system-notification-warning \{ --notice-color: var\(--theme-status-yellow\)/u);
  assert.match(css, /header-notification-action-error[\s\S]*?var\(--theme-danger\)/u);
  assert.match(adminCss, /--theme-placeholder/u);
  assert.match(adminCss, /--theme-disabled-surface/u);
  assert.doesNotMatch(browseCss, /#[0-9a-fA-F]{3,8}\b/u);
});

test("first-paint cache accepts dynamic custom references and all 42 runtime variables", async () => {
  const layout = await readProjectFile("app/layout.tsx");
  assert.match(layout, /nyascans:user-theme-cache:v2/u);
  assert.match(layout, /schemaVersion!==2/u);
  assert.match(layout, /\^custom:theme_\[0-9a-f\]\{32\}\$/u);
  assert.match(layout, /Object\.keys\(v\)\.length!==k\.length/u);
  assert.match(layout, /--theme-logo-color/u);
  assert.match(layout, /--theme-logo-accent-color/u);
  assert.match(layout, /--theme-logo-outline-color/u);
});

test("all canonical CSS variables bridge into app semantics and legacy profile themes stay retired", async () => {
  const [model, css, profile] = await Promise.all([
    readProjectFile("lib/theme-system.ts"),
    readProjectFile("app/globals.css"),
    readProjectFile("components/nyascans/ProfileSettingsWorkspace.tsx"),
  ]);
  const cssNames = [...model.matchAll(/: "(--theme-[a-z0-9-]+)"/gu)].map((match) => match[1]);
  assert.equal(new Set(cssNames).size, 39);
  for (const name of new Set(cssNames)) {
    assert.ok(
      css.split(name).length - 1 >= 2,
      `${name} must be declared and consumed by rendered UI`,
    );
  }
  assert.doesNotMatch(css, /data-profile-theme/u);
  assert.doesNotMatch(profile, /nyascans:profile-theme/u);
  assert.match(profile, /href="\/theme-builder"/u);
});
