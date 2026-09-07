import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
const { resolveWorkspaceLocation } = await import(`data:text/javascript;base64,${Buffer.from(compile(read("lib/workspace-navigation.ts"))).toString("base64")}`);
const app = read("components/nyascans/NyaScansApp.tsx");
const sidebar = app.slice(app.indexOf('id: "general",', app.indexOf("function OperationsView")), app.indexOf("return adminNavigationGroupsForCapabilities", app.indexOf("function OperationsView")));
const items = [...sidebar.matchAll(/workspaceNavigationItem\("([^"]+)", \w+(?:, \{ ([^}]+) \})?\)/g)].map(([, label, options = ""]) => ({
  label, slug: label.toLowerCase().replaceAll(" ", "-"), aliases: [],
  targetSection: options.match(/targetSection: "([^"]+)"/)?.[1],
  targetSubsection: options.match(/targetSubsection: "([^"]+)"/)?.[1],
}));

test("every uploader feature resolves identically after a click, reload and browser history", () => {
  assert.deepEqual(resolveWorkspaceLocation(items), { section: "Dashboard", subsection: "" });
  const modes = ["dashboard", "add-series", "series-requests", "single", "multi", "drafts", "create-team", "review-status", "history", "rules", "rights"];
  for (const mode of modes) {
    const item = items.find((entry) => entry.targetSubsection === mode);
    assert.ok(item, `missing sidebar action: ${mode}`);
    const expected = { section: item.label, subsection: mode };
    assert.deepEqual(resolveWorkspaceLocation(items, item.label), expected);
    assert.deepEqual(resolveWorkspaceLocation(items, "upload-center", mode), expected);
    assert.deepEqual(resolveWorkspaceLocation(items, "chapters", mode), expected);
  }
  assert.deepEqual(resolveWorkspaceLocation(items, "series", "new"), {
    section: "Create new series", subsection: "add-series",
  });
  assert.equal(resolveWorkspaceLocation(items, "create-new-serie").subsection, "add-series");
  for (const route of ["series", "my-teams", "settings"]) {
    assert.equal(resolveWorkspaceLocation(items, route).section, items.find((item) => item.slug === route).label);
  }
});

test("upload navigation does not retain the initial single/batch composer hint", () => {
  assert.match(app, /initialUploadMode=\{activeSubsection \? undefined : initialUploadMode\}/);
  assert.match(app, /key=\{`\$\{dispatchedSection\}:\$\{activeSubsection\}`\}/);
  assert.match(app, /id=\{drawerMode \? "operations-navigation-drawer" : undefined\}/);
});

test("language selections use the shared searchable list in all uploader editors", () => {
  for (const file of ["OperationsControlPanel.tsx", "ChapterManagementWorkspace.tsx", "upload/SeriesRequestWorkspace.tsx", "upload/UploadCenterWorkspace.tsx"]) {
    const source = read(`components/nyascans/${file}`);
    assert.match(source, /<LanguageSelect/);
    assert.doesNotMatch(source, /<input\s+value=\{(?:form\.language(?:Code)?|settings\.defaultLanguage|item\.language)\}/);
  }
});

test("upload options read saved preferences and reject an ineligible default team", async () => {
  const source = read("app/api/v1/upload-jobs/route.ts");
  const start = source.indexOf("async function uploadOptions(");
  const end = source.indexOf("async function assertFixedReaderPageControl", start);
  const getOptions = new Function("isUploadAdmin", "readVisibilityDefaults", "canAny", "parseJson", "UPLOAD_METHODS", "UPLOAD_LIMITS",
    `${compile(source.slice(start, end))}; return uploadOptions;`)(
    () => false, async () => ({ defaultAccessType: "FREE" }), () => true,
    (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } }, [], {},
  );
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE series (id, slug, title, cover_key, revision, is_published, archived_at, status, rights_status);
    CREATE TABLE teams (id, slug, name, revision, can_control_fixed_reader_pages, logo_key, banner_key, is_archived, verification_status);
    CREATE TABLE team_memberships (team_id, user_id, status, membership_role);
    CREATE TABLE user_preferences (user_id, content_language, settings_json);
    CREATE TABLE uploader_approvals (user_id, status);
    CREATE TABLE upload_jobs (user_id, submitted_at);
    INSERT INTO teams VALUES ('team', 'team', 'My team', 1, 0, NULL, NULL, 0, 'VERIFIED');
    INSERT INTO team_memberships VALUES ('team', 'uploader', 'ACTIVE', 'UPLOADER');
    INSERT INTO user_preferences VALUES ('uploader', 'en', '{"workspace":{"defaultTeamId":"team","defaultLanguage":"ja"}}');
  `);
  const d1 = { prepare(sql) {
    const statement = db.prepare(sql);
    let bindings = [];
    return { bind(...values) { bindings = values; return this; },
      async all() { return { results: statement.all(...bindings) }; },
      async first() { return statement.get(...bindings) ?? null; } };
  } };
  const actor = { id: "uploader", primaryRole: "UPLOADER", roles: ["UPLOADER"] };
  try {
    assert.deepEqual((await getOptions(d1, actor)).workspaceSettings, { defaultTeamId: "team", defaultLanguage: "ja" });
    db.exec("UPDATE teams SET verification_status = 'SUSPENDED'");
    assert.deepEqual((await getOptions(d1, actor)).workspaceSettings, { defaultTeamId: null, defaultLanguage: "ja" });
    db.exec("UPDATE user_preferences SET settings_json = '{}', content_language = 'fr'");
    assert.deepEqual((await getOptions(d1, actor)).workspaceSettings, { defaultTeamId: null, defaultLanguage: "fr" });
    db.exec("DELETE FROM user_preferences");
    assert.deepEqual((await getOptions(d1, actor)).workspaceSettings, { defaultTeamId: null, defaultLanguage: "en" });
  } finally { db.close(); }
});
