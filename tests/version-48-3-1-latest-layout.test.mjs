import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) =>
  readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Version 48.3.1 lets readers persist either Latest Updates style", async () => {
  const app = await read("components/nyascans/NyaScansApp.tsx");
  const latest = app.slice(
    app.indexOf("function LatestUpdatesGrid"),
    app.indexOf("function LatestUpdatesView"),
  );

  assert.match(latest, /useState<LatestUpdatesStyle>\("classic"\)/u);
  assert.match(app, /nyascans:latest-updates-style/u);
  assert.match(latest, /className="latest-style-toggle"/u);
  assert.match(latest, /aria-pressed=\{homeStyle === "classic"\}/u);
  assert.match(latest, /aria-pressed=\{homeStyle === "table"\}/u);
  assert.match(latest, /chooseHomeStyle\("classic"\)/u);
  assert.match(latest, /chooseHomeStyle\("table"\)/u);
  assert.match(latest, /setHomeStyle\(nextStyle\)/u);
  assert.match(latest, /localStorage\.setItem\([\s\S]*nextStyle/u);
  assert.match(latest, /mode=\$\{useHomeTable \? "table" : "cards"\}/u);
  assert.match(latest, /useHomeTable \? \(/u);
});

test("Version 48.3.1 preserves classic cards and simplifies only the release table", async () => {
  const app = await read("components/nyascans/NyaScansApp.tsx");
  const tableStart = app.indexOf('className="latest-release-table-shell"');
  const classicStart = app.indexOf('className="latest-grid"', tableStart);
  const table = app.slice(tableStart, classicStart);
  const classic = app.slice(classicStart, app.indexOf("<EmptyState", classicStart));

  assert.ok(tableStart >= 0 && classicStart > tableStart);
  assert.doesNotMatch(table, /latest-age-dot/u);
  assert.doesNotMatch(table, /latest-read-state/u);
  assert.doesNotMatch(table, /SeriesTypeBadge/u);
  assert.doesNotMatch(table, /update\.status/u);
  assert.match(table, /<ChapterAccessBadge/u);
  assert.match(table, /<LanguageFlag language=\{chapter\.language\}/u);

  assert.match(classic, /className="latest-card"/u);
  assert.match(classic, /latest-age-dot/u);
  assert.match(classic, /latest-read-state/u);
  assert.match(classic, /SeriesStatusBadge status=\{update\.status\}/u);
  assert.match(classic, /SeriesTypeBadge type=\{update\.type\} flagOnly/u);
});
