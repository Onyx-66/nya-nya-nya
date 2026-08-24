import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("..", import.meta.url);
const componentsRoot = fileURLToPath(new URL("../components/nyascans/", import.meta.url));
const readProjectFile = (filePath) => readFile(new URL(filePath, root), "utf8");

async function componentFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return componentFiles(absolute);
      return entry.isFile() && entry.name.endsWith(".tsx") ? [absolute] : [];
    }),
  );
  return nested.flat();
}

test("every native single-choice surface uses the canonical Library listbox", async () => {
  const files = await componentFiles(componentsRoot);
  const sources = await Promise.all(
    files.map(async (file) => ({ file, source: await readFile(file, "utf8") })),
  );
  const nativeSelects = sources.flatMap(({ file, source }) =>
    [...source.matchAll(/<select\b/gu)].map(() => path.basename(file)),
  );
  const sharedSelectCount = sources.reduce(
    (total, { source }) => total + [...source.matchAll(/<UnifiedSingleSelect\b/gu)].length,
    0,
  );

  assert.deepEqual(nativeSelects, ["UnifiedSingleSelect.tsx"]);
  assert.ok(sharedSelectCount >= 130, `Expected at least 130 shared select surfaces; found ${sharedSelectCount}.`);

  const shared = await readProjectFile("components/nyascans/UnifiedSingleSelect.tsx");
  assert.match(shared, /role="listbox"/u);
  assert.match(shared, /role="option"/u);
  assert.match(shared, /aria-selected=/u);
  assert.match(shared, /CheckCircle/u);
  assert.match(shared, /event\.key === "ArrowDown"/u);
  assert.match(shared, /event\.key === "ArrowUp"/u);
  assert.match(shared, /event\.key === "Home"/u);
  assert.match(shared, /event\.key === "End"/u);
  assert.match(shared, /event\.key !== "Escape"/u);
});

test("Library and Browse single-choice filters share the same component while checkbox facets stay separate", async () => {
  const library = await readProjectFile("components/nyascans/LibraryWorkspace.tsx");
  const app = await readProjectFile("components/nyascans/NyaScansApp.tsx");
  const css = await readProjectFile("app/globals.css");

  assert.match(library, /function LibraryDropdown[\s\S]*?<UnifiedSingleSelect/u);
  assert.match(app, /if \(!multiple\)[\s\S]*?<UnifiedSingleSelect/u);
  assert.match(app, /function CatalogFacetMenu[\s\S]*?role="checkbox"/u);
  assert.match(css, /\.unified-single-select-trigger/u);
  assert.match(css, /\.unified-single-select-menu button\[aria-selected="true"\]/u);
});

test("series Following and Ratings controls are live-theme-driven and accessible", async () => {
  const app = await readProjectFile("components/nyascans/NyaScansApp.tsx");
  const css = await readProjectFile("app/globals.css");

  assert.match(app, /className="button button-secondary series-secondary-action"[\s\S]*?aria-pressed=\{followed\}/u);
  assert.match(app, /weight=\{followed \? "fill" : "regular"\}/u);
  assert.match(css, /\.title-actions \.series-secondary-action\[aria-pressed="true"\][\s\S]*?var\(--theme-button-accent/u);
  assert.match(css, /\.title-actions \.series-secondary-action\[aria-pressed="true"\][\s\S]*?var\(--theme-primary-l1/u);

  assert.match(app, /const \[expanded, setExpanded\] = useState\(false\)/u);
  assert.match(app, /aria-controls="reviews-content"/u);
  assert.match(app, /aria-expanded=\{expanded\}/u);
  assert.match(app, /id="reviews-content"[\s\S]*?hidden=\{!expanded\}/u);
  assert.match(app, /window\.location\.hash === "#reviews"/u);
  assert.match(app, /a\[href="#reviews"\]/u);
});
