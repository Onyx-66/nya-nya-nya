import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("admin sidebar does not render search, filter, or release-version controls", () => {
  const source = read("components/nyascans/NyaScansApp.tsx");
  assert.doesNotMatch(source, /className="ops-admin-navigation-tools"/);
  assert.doesNotMatch(source, /className="ops-sidebar-search"/);
  assert.doesNotMatch(source, /className="ops-release-version"/);
  assert.doesNotMatch(source, /sidebarQuery/);
  assert.match(source, /className="ops-account-menu"/);
});

test("mobile admin drawer is content-sized with a scroll-only nav and fixed account footer", () => {
  const styles = read("app/admin.css");
  assert.match(styles, /width: max-content !important/);
  assert.match(styles, /max-width: calc\(100vw - 8px\) !important/);
  assert.match(styles, /padding: max\(8px, env\(safe-area-inset-top\)\) 8px max\(8px, env\(safe-area-inset-bottom\)\) !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-grouped-nav[\s\S]*?overflow-y: auto !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-account-menu[\s\S]*?display: block !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-account-menu[\s\S]*?flex: 0 0 auto !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-nav-label[\s\S]*?white-space: normal/);
  assert.match(styles, /overflow-wrap: anywhere/);
});

test("mobile drawer header keeps the logo left and close button right", () => {
  const styles = read("app/admin.css");
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-sidebar-head[\s\S]*?justify-content: space-between !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-sidebar-mobile-close[\s\S]*?margin-left: auto/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-sidebar-head \.brand[\s\S]*?justify-content: flex-start/);
});

test("mobile drawer no longer contains a full-viewport width override", () => {
  const styles = read("app/admin.css");
  assert.doesNotMatch(styles, /width:\s*100vw !important/);
  assert.doesNotMatch(styles, /max-width:\s*100vw !important/);
});

test("header profile photo uses the actor URL immediately and refreshes with identity changes", () => {
  const source = read("components/nyascans/NyaScansApp.tsx");
  assert.match(source, /useState<string \| null>\(\s*\(\) => actor\?\.avatarUrl \?\? null/);
  assert.match(source, /setProfileAvatarUrl\(actor\?\.avatarUrl \?\? null\)/);
  assert.match(source, /src=\{profileAvatarUrl\}/);
});

test("actor avatar URL remains sourced from stored profile media", () => {
  const source = read("lib/server/policy.ts");
  assert.match(source, /avatarUrl: row\.avatar_key && row\.profile_username/);
  assert.match(source, /\/api\/v1\/profile-media\?username=/);
});

test("profile media accepts stored usernames with hyphens", () => {
  const source = read("app/api/v1/profile-media/route.ts");
  assert.match(source, /\.regex\(\/\^\[a-zA-Z0-9\]\[a-zA-Z0-9_-\]\*\$\/\)/);
});
