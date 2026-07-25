import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const distRoot = fileURLToPath(new URL("../dist", import.meta.url));

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return nested.flat();
}

test("packages development preview metadata", async () => {
  const worker = await readFile(`${distRoot}/server/index.js`, "utf8");
  assert.match(worker, /codex-preview/);
  assert.match(worker, /development/);
});

test("packages the NyaScans product shell", async () => {
  const files = await filesBelow(distRoot);
  const appBundles = files.filter(
    (path) => path.endsWith(".js") && /NyaScansApp|server\/index/.test(path),
  );
  const product = (
    await Promise.all(appBundles.map((path) => readFile(path, "utf8")))
  ).join("\n");

  assert.match(product, /NyaScans/);
  assert.match(product, /Stories worth losing the night to/);
  assert.doesNotMatch(product, /Starter Project/);

  const visibleCopySource = await readFile(
    fileURLToPath(
      new URL("../components/nyascans/NyaScansApp.tsx", import.meta.url),
    ),
    "utf8",
  );
  assert.doesNotMatch(visibleCopySource, /—|–/);
});

test("includes latest releases, real commerce panels, and admin appearance controls", async () => {
  const component = await readFile(
    fileURLToPath(
      new URL("../components/nyascans/NyaScansApp.tsx", import.meta.url),
    ),
    "utf8",
  );
  const styles = await readFile(
    fileURLToPath(new URL("../app/globals.css", import.meta.url)),
    "utf8",
  );
  const appearance = await readFile(
    fileURLToPath(
      new URL(
        "../components/nyascans/admin/AppearanceWorkspace.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const api = await readFile(
    fileURLToPath(
      new URL("../app/api/v1/[...resource]/route.ts", import.meta.url),
    ),
    "utf8",
  );
  const routes = await readFile(
    fileURLToPath(new URL("../app/[...slug]/page.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(component, /LatestUpdatesView/);
  assert.match(component, /WalletOrdersPanel/);
  assert.match(component, /AppearanceWorkspace/);
  assert.match(appearance, /ThemeSettingsPanel/);
  assert.match(styles, /\.latest-grid/);
  assert.match(styles, /aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(api, /path === "orders"/);
  assert.match(api, /path === "admin\/appearance"/);
  assert.match(routes, /root === "latest"/);
  assert.match(routes, /root === "orders"/);
});

test("orders series details before chapters and includes durable discussions", async () => {
  const component = await readFile(
    fileURLToPath(
      new URL("../components/nyascans/NyaScansApp.tsx", import.meta.url),
    ),
    "utf8",
  );
  const api = await readFile(
    fileURLToPath(
      new URL("../app/api/v1/[...resource]/route.ts", import.meta.url),
    ),
    "utf8",
  );
  const schema = await readFile(
    fileURLToPath(new URL("../db/schema.ts", import.meta.url)),
    "utf8",
  );

  const details = component.indexOf('id="details"');
  const chapters = component.indexOf('id="chapters"');
  assert.ok(details >= 0, "series details section is present");
  assert.ok(chapters >= 0, "latest chapters section is present");
  assert.ok(details < chapters, "details precedes latest chapters in DOM order");
  assert.match(component, /DiscussionSection/);
  assert.match(component, /Chapter comments/);
  assert.match(api, /path === "discussion-comments"/);
  assert.match(api, /path === "discussion-reactions"/);
  assert.match(schema, /discussionComments/);
  assert.match(schema, /discussionReactions/);
});

test("exposes login, logout, and role-aware operations shortcuts", async () => {
  const component = await readFile(
    fileURLToPath(
      new URL("../components/nyascans/NyaScansApp.tsx", import.meta.url),
    ),
    "utf8",
  );

  assert.match(component, />Login</);
  assert.match(component, />Logout</);
  assert.match(component, /\/signout-with-chatgpt\?return_to=%2F/);
  assert.match(component, /role === "ADMINISTRATOR"/);
  assert.match(component, /href: "\/onyx\/admin\/access"/);
  assert.match(component, /href: "\/dashboard"/);
  assert.match(component, /ops-mobile-section/);
});
