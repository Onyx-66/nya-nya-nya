import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, root), "utf8");

test("progress indicators are exposed as custom-theme tokens and consumed by the homepage/library CSS", async () => {
  const [theme, globals, surfaces, pinned] = await Promise.all([
    readProjectFile("lib/theme-system.ts"),
    readProjectFile("app/globals.css"),
    readProjectFile("app/theme-surfaces.css"),
    readProjectFile("components/nyascans/HomeFeatureSections.tsx"),
  ]);
  for (const token of [
    "progressTrack",
    "progressFill",
    "progressStarting",
    "progressBuilding",
    "progressHalfway",
    "progressStrong",
    "progressNearly",
    "progressComplete",
  ]) {
    assert.match(theme, new RegExp(`\\b${token}\\b`, "u"));
  }
  assert.match(globals, /\.featured-slider-dots button[\s\S]*background: var\(--theme-progress-track\)/u);
  assert.match(globals, /\.featured-slider-dots button\[aria-pressed="true"\][\s\S]*background: var\(--theme-progress-fill\)/u);
  assert.match(globals, /\.mini-progress i[\s\S]*background: var\(--theme-progress-fill\)/u);
  assert.match(globals, /\.continue-reading-progress > b[\s\S]*background: var\(--theme-progress-fill\)/u);
  assert.match(globals, /data-progress-tone="starting"[\s\S]*var\(--theme-progress-starting\)/u);
  assert.match(globals, /\.library-record-progress i[\s\S]*background: var\(--theme-progress-fill\)/u);
  assert.match(surfaces, /\.featured-slider \.featured-slider-dots button\[aria-pressed="true"\][\s\S]*var\(--theme-progress-fill\)/u);
  assert.match(pinned, /\.v481-pinned-dots button[\s\S]*var\(--theme-progress-track\)/u);
  assert.match(pinned, /\.v481-pinned-dots button\[aria-current='true'\][\s\S]*var\(--theme-progress-fill\)/u);
  assert.doesNotMatch(pinned, /v481-pinned-dots button \{[^}]*rgb\(255 216 119/u);
});

test("Most Popular period buttons expose and style distinct inactive and active states", async () => {
  const [component, css] = await Promise.all([
    readProjectFile("components/nyascans/HotThisWeek.tsx"),
    readProjectFile("app/globals.css"),
  ]);
  assert.match(component, /aria-pressed=\{period === option\.key\}/u);
  assert.match(component, /className=\{period === option\.key \? "is-active" : ""\}/u);
  assert.match(css, /\.hot-this-week \.hot-week-tabs button \{[\s\S]*background: color-mix\(in srgb, var\(--theme-home-hot-this-week-accent\)/u);
  assert.match(css, /\.hot-this-week \.hot-week-tabs button\.is-active \{[\s\S]*background: var\(--theme-home-hot-this-week-accent\)/u);
});

test("series requests place provider import first and no longer require duplicate explanation", async () => {
  const [component, schema, server] = await Promise.all([
    readProjectFile("components/nyascans/upload/SeriesRequestWorkspace.tsx"),
    readProjectFile("lib/series-requests.ts"),
    readProjectFile("lib/server/series-request-team.ts"),
  ]);
  assert.ok(component.indexOf("<SourceImportWorkspace") < component.indexOf("<legend>Title and team</legend>"));
  assert.match(component, /Import from MangaDex or MangaUpdates/u);
  assert.match(component, /value=\{importSource\}/u);
  assert.match(component, /<option value="MANGADEX">MangaDex<\/option>/u);
  assert.match(component, /<option value="MANGAUPDATES">MangaUpdates<\/option>/u);
  assert.doesNotMatch(component, /Why this is not a duplicate/u);
  const requestFormType = component.match(/type RequestForm = \{[\s\S]*?\n\};/u)?.[0] ?? "";
  assert.doesNotMatch(requestFormType, /duplicateExplanation/u);
  assert.doesNotMatch(component, /Why this is not a duplicate|value=\{form\.duplicateExplanation\}/u);
  assert.doesNotMatch(schema, /duplicateExplanation/u);
  assert.doesNotMatch(server, /input\.metadata\.duplicateExplanation/u);
  assert.match(server, /metadata\.duplicateConfirmation \? 1 : 0,[\s\S]*"",/u);
  assert.match(server, /POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED[\s\S]*confirm that this is a distinct series/u);
});
