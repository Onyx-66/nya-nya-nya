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

test("mobile admin drawer uses the viewport and child labels wrap", () => {
  const styles = read("app/admin.css");
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-sidebar[\s\S]*?width: 100vw !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-nav-label[\s\S]*?white-space: normal/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /padding-left: 1\.9rem !important/);
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
