import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, root), "utf8");

test("Home fetch helper enforces a deadline without exposing the unmount controller", async () => {
  const source = await readProjectFile("lib/home-fetch.ts");
  assert.match(source, /HOME_REQUEST_TIMEOUT_MS\s*=\s*9_000/);
  assert.match(source, /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?timedOut\s*=\s*true/);
  assert.match(source, /if \(timedOut\) throw new HomeRequestTimeoutError\(\)/);
  assert.match(source, /externalSignal\?\.removeEventListener\("abort", relayAbort\)/);
});

test("all Home data sections use the bounded helper and render a terminal branch", async () => {
  const app = await readProjectFile("components/nyascans/NyaScansApp.tsx");
  const feature = await readProjectFile("components/nyascans/HomeFeatureSections.tsx");
  const discovery = await readProjectFile("components/nyascans/PublicDiscoverySections.tsx");
  const popular = await readProjectFile("components/nyascans/HotThisWeek.tsx");

  for (const [label, source, endpoint] of [
    ["Trending", app, "catalog\\?page=1&pageSize=12&sort=viewed"],
    ["Latest Comments", app, "community-highlights"],
    ["Latest Updates", app, "latest-releases"],
    ["Editor’s Pick", app, "editor-picks"],
    ["Pinned Series", feature, "pinned-series"],
    ["Recent Reviews", feature, "recent-reviews"],
    ["New Series", discovery, "new-series"],
    ["Top Teams", discovery, "public-teams"],
    ["Most Popular", popular, "hot-this-week"],
  ]) {
    assert.match(source, new RegExp(`fetchWithHomeTimeout[\\s\\S]{0,320}${endpoint}`), `${label} must use the bounded helper`);
  }

  assert.match(feature, /No active Pinned Series/);
  assert.match(feature, /Recent reviews could not be loaded/);
  assert.match(discovery, /No teams publish in this language yet/);
  assert.match(app, /No reader activity yet/);
  assert.match(popular, /No \{periodLabel\.toLowerCase\(\)\} ranking yet/);
});

test("dark mode is the first-run default and the dark tokens are near-black", async () => {
  const theme = await readProjectFile("lib/site-theme.ts");
  const userTheme = await readProjectFile("lib/theme-system.ts");
  const css = await readProjectFile("app/globals.css");
  assert.match(userTheme, /activeThemeId: "nya-midnight"/);
  assert.doesNotMatch(userTheme, /prefers-color-scheme/);
  assert.match(theme, /background: "#070708"/);
  assert.match(theme, /surface: "#111216"/);
  assert.match(css, /--theme-main-background: var\(--site-dark-bg, #070708\)/);
  assert.match(css, /--bg: var\(--theme-main-background\)/);
});

test("logged-out meatball menu exposes public destinations and conditional Store", async () => {
  const app = await readProjectFile("components/nyascans/NyaScansApp.tsx");
  const menuStart = app.indexOf('aria-label="Open site menu"');
  const menu = app.slice(menuStart, app.indexOf("</div>", menuStart));
  for (const href of ["/browse", "/latest", "/rankings", "/teams", "/support", "/pinned", "/discounts"]) {
    assert.match(menu, new RegExp(`href=\\"${href}\\"`), `${href} must be in the public menu`);
  }
  assert.match(menu, /lockAndPayVisible/);
  assert.ok(menu.includes('href="/store"'));
  assert.ok(menu.includes("Change Theme"));
  assert.ok(app.includes('href="/account"'));
  assert.ok(app.includes("Open Admin Panel"));
  assert.ok(app.includes("Preferences &amp; language"));
  assert.ok(app.includes("<LogoutAction"));
});
