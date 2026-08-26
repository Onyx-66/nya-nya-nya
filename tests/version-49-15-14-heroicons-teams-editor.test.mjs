import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Heroicons v2 is the only imported icon library", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.dependencies["@heroicons/react"], "2.2.0");
  assert.equal(packageJson.dependencies["@phosphor-icons/react"], undefined);
  assert.equal(packageJson.dependencies["lucide-react"], undefined);

  const adapter = read("components/nyascans/heroicons.tsx");
  assert.match(adapter, /@heroicons\/react\/24\/outline/);
  assert.match(adapter, /@heroicons\/react\/24\/solid/);
  assert.match(adapter, /weight === "fill"/);

  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) sourceFiles.push(relative);
    }
  };
  visit("app");
  visit("components");
  visit("lib");
  for (const file of sourceFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /@phosphor-icons\/react|lucide-react|react-icons|@fortawesome/);
  }
});

test("Teams directory defaults to list view while retaining both controls", () => {
  const source = read("components/nyascans/PublicDiscoverySections.tsx");
  assert.match(source, /useState<"GRID" \| "LIST">\("LIST"\)/);
  assert.match(source, /aria-label="Grid view"/);
  assert.match(source, /aria-label="List view"/);
  assert.match(source, /setView\("GRID"\)/);
  assert.match(source, /setView\("LIST"\)/);
});

test("Editor’s Pick heading uses the neutral theme text token", () => {
  const styles = read("app/globals.css");
  assert.match(styles, /\.home-main \.editors-pick-heading h2\s*\{[\s\S]*color:\s*var\(--theme-text-color\)\s*!important/);
});
