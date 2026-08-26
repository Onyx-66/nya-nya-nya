import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("mobile drawer is narrower than the viewport and leaves the backdrop visible", () => {
  const styles = read("app/admin.css");
  assert.match(styles, /width: max-content !important/);
  assert.match(styles, /max-width: calc\(100vw - 8px\) !important/);
  assert.match(styles, /inset: 0 auto 0 0 !important/);
  assert.doesNotMatch(styles, /width:\s*100vw\s*!important/);
  assert.doesNotMatch(styles, /max-width:\s*100vw\s*!important/);
});

test("mobile drawer uses a uniform edge inset and independent navigation scroll", () => {
  const styles = read("app/admin.css");
  assert.match(styles, /padding: max\(8px, env\(safe-area-inset-top\)\) 8px max\(8px, env\(safe-area-inset-bottom\)\) !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-grouped-nav[\s\S]*?overflow-y: auto !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-grouped-nav[\s\S]*?flex: 1 1 auto !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-nav-group-toggle[\s\S]*?padding-inline: 0 !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] :is\(\.ops-nav-group-items > a, \.ops-active-pinned\)[\s\S]*?padding-inline: 0 !important/);
});

test("mobile drawer pins the account entry below the scrolling navigation", () => {
  const styles = read("app/admin.css");
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-account-menu[\s\S]*?display: block !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-account-menu[\s\S]*?flex: 0 0 auto !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-account-menu[\s\S]*?border-top: 1px solid var\(--admin-border\)/);
});

test("mobile drawer header aligns logo left and close action to drawer right", () => {
  const styles = read("app/admin.css");
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-sidebar-head[\s\S]*?justify-content: space-between !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-sidebar-head \.brand[\s\S]*?justify-content: flex-start/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-sidebar-mobile-close[\s\S]*?margin-left: auto/);
});

test("mobile drawer keeps complete labels and no obsolete controls or version text", () => {
  const source = read("components/nyascans/NyaScansApp.tsx");
  const styles = read("app/admin.css");
  assert.doesNotMatch(source, /className="ops-admin-navigation-tools"/);
  assert.doesNotMatch(source, /className="ops-sidebar-search"/);
  assert.doesNotMatch(source, /className="ops-release-version"/);
  assert.match(source, /className="ops-nav-label">\{child\.label\}<\/span>/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-nav-label[\s\S]*?text-overflow: clip/);
  assert.match(styles, /overflow-wrap: anywhere/);
});

test("profile avatar uses a server-resolved media URL", () => {
  const source = read("components/nyascans/NyaScansApp.tsx");
  const mediaRoute = read("app/api/v1/profile-media/route.ts");
  assert.match(source, /useState<string \| null>\(\s*\(\) => actor\?\.avatarUrl \?\? null/);
  assert.match(source, /src=\{profileAvatarUrl\}/);
  assert.match(mediaRoute, /\[a-zA-Z0-9\]\[a-zA-Z0-9_-\]\*/);
});
