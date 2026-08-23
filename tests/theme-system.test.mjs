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

test("theme schema exposes the exact complete 39-token contract", async () => {
  const source = await readProjectFile("lib/theme-system.ts");
  const keyBlock = source.match(/export const themeTokenKeys = \[([\s\S]*?)\] as const;/u)?.[1] ?? "";
  const keys = [...keyBlock.matchAll(/"([A-Za-z0-9]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(keys, exactTokenKeys);
  assert.match(source, /themeTokensSchema[\s\S]*?\.strict\(\)/u);
  assert.match(source, /themeDocumentSchema[\s\S]*?schemaVersion: z\.literal/u);
  assert.match(source, /\^#\[0-9a-fA-F\]\{6\}\$/u);
  assert.match(source, /The theme is incomplete or invalid/u);
});

test("portable themes round-trip and malformed or partial payloads fail atomically", () => {
  const script = `
    import {
      encodeThemeForUrl,
      parseThemeImport,
      themeContrastWarnings,
      themeShareUrl,
      themeTokenKeys,
      userThemePresets,
    } from "./lib/theme-system.ts";
    const theme = userThemePresets[3].theme;
    const missing = structuredClone(theme);
    delete missing.tokens.dangerL2;
    const extra = structuredClone(theme);
    extra.tokens.rogue = "#FFFFFF";
    const rejected = [missing, extra, { ...theme, type: "sepia" }].every((value) => {
      try { parseThemeImport(JSON.stringify(value)); return false; } catch { return true; }
    });
    let malformed = "";
    try { parseThemeImport("A"); } catch (error) { malformed = error.message; }
    console.log(JSON.stringify({
      tokenCount: themeTokenKeys.length,
      presetCount: userThemePresets.length,
      codeRoundTrip: JSON.stringify(parseThemeImport(encodeThemeForUrl(theme))) === JSON.stringify(theme),
      urlRoundTrip: JSON.stringify(parseThemeImport(themeShareUrl(theme, "https://example.test/account"))) === JSON.stringify(theme),
      rejected,
      malformed,
      presetWarnings: userThemePresets.flatMap(({ theme }) => themeContrastWarnings(theme)).length,
    }));
  `;
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    ),
  );
  assert.deepEqual(result, {
    tokenCount: 39,
    presetCount: 5,
    codeRoundTrip: true,
    urlRoundTrip: true,
    rejected: true,
    malformed: "The shared theme code is malformed.",
    presetWarnings: 0,
  });
});

test("five immutable NyaScans presets and Custom are wired", async () => {
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
  assert.match(model, /activeThemeIdSchema[\s\S]*?"custom"/u);
  assert.match(app, />Change Theme</u);
  assert.match(app, />Select Theme</u);
  assert.match(app, />Custom</u);
  assert.match(app, /aria-checked=\{controller\.activeThemeId === "custom"\}/u);
  assert.match(app, /href="\/theme-builder"/u);
});

test("builder implements live preview and every portable-theme action", async () => {
  const [builder, controller, route] = await Promise.all([
    readProjectFile("components/nyascans/ThemeBuilderPage.tsx"),
    readProjectFile("components/nyascans/UserThemeSystem.tsx"),
    readProjectFile("app/[...slug]/page.tsx"),
  ]);
  for (const label of [
    "Save theme",
    "Load saved theme",
    "Copy theme URL",
    "Import theme",
    "Export theme",
    "Import system theme",
    "Preview",
  ]) {
    assert.match(builder, new RegExp(label, "u"));
  }
  assert.match(builder, /type="color"/u);
  assert.match(builder, /applyPreview\(draft\)/u);
  assert.match(builder, /themeContrastWarnings/u);
  assert.match(builder, /I understand and want to save these colors/u);
  const model = await readProjectFile("lib/theme-system.ts");
  assert.match(model, /nyascans:user-theme:v1/u);
  assert.match(controller, /\/api\/v1\/theme-preferences/u);
  assert.match(route, /root === "theme-builder"/u);
});

test("account persistence is authenticated, same-origin, and isolates custom documents", async () => {
  const [api, controller, migration] = await Promise.all([
    readProjectFile("app/api/v1/theme-preferences/route.ts"),
    readProjectFile("components/nyascans/UserThemeSystem.tsx"),
    readProjectFile("drizzle/0056_clammy_firelord.sql"),
  ]);
  assert.match(api, /export async function GET/u);
  assert.match(api, /export async function PATCH/u);
  assert.equal((api.match(/requireActor\(\)/gu) ?? []).length, 2);
  assert.match(api, /assertSameOrigin\(request\)/u);
  assert.match(api, /themePreferenceMutationSchema\.parse\(body\)/u);
  assert.match(api, /mutation\.action === "select"/u);
  assert.match(api, /mutation\.action === "save-custom"/u);
  assert.match(api, /CUSTOM_THEME_MISSING/u);
  assert.match(api, /custom_theme_json = excluded\.custom_theme_json/u);
  assert.doesNotMatch(api, /settings_json =/u);
  assert.match(api, /"cache-control": "private, no-store"/u);
  assert.match(api, /hasExplicitThemePreference/u);
  assert.match(controller, /mutationQueueRef/u);
  assert.match(controller, /confirmedPreferenceRef/u);
  assert.match(controller, /setAndApply\(confirmedPreferenceRef\.current\)/u);
  assert.match(controller, /migrateBrowserPreference/u);
  assert.match(controller, /action: "reconcile"/u);
  assert.match(controller, /:account:\$\{accountId\}/u);
  assert.match(api, /user_preferences\.custom_theme_json IS NULL/u);
  assert.match(migration, /ADD `custom_theme_json` text/u);
});

test("all canonical CSS variables bridge into app semantics and legacy profile themes are retired", async () => {
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
