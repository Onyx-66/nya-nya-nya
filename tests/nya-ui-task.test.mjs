import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("..", import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, root), "utf8");

 test("DotsRing is the reusable loading visual and legacy spinner implementations are absent", async () => {
  const [dotsRing, components, globals] = await Promise.all([
    readProjectFile("components/nyascans/DotsRing.tsx"),
    readProjectFile("components/nyascans/NyaScansApp.tsx"),
    readProjectFile("app/globals.css"),
  ]);
  assert.match(dotsRing, /from "framer-motion"/u);
  assert.match(dotsRing, /motion\.span/u);
  assert.match(dotsRing, /useReducedMotion/u);
  assert.match(dotsRing, /role=\{accessible \? "status"/u);
  assert.match(globals, /\.dots-ring[\s\S]*?--theme-effect-moving-light/u);
  assert.match(dotsRing, /size\?: DotsRingSize \| number/u);
  assert.match(dotsRing, /export type DotsRingSize = "inline" \| "sm" \| "md" \| "lg" \| "xl"/u);
  assert.doesNotMatch(components, /SpinnerGap|admin-spinner|is-spinning/u);
  assert.doesNotMatch(globals, /@keyframes (catalog-skeleton|review-skeleton|hot-week-list-skeleton|v481-skeleton|reader-spin|discussion-spin|control-spin|upload-spin)/u);
  assert.match(components, /dots-ring-loading continue-reading-loading/u);
});

test("CardCoverFlow is reusable, desktop-gated, accessible, and wired to the Pinned Series data path", async () => {
  const [flow, home, css] = await Promise.all([
    readProjectFile("components/nyascans/CardCoverFlow.tsx"),
    readProjectFile("components/nyascans/HomeFeatureSections.tsx"),
    readProjectFile("app/globals.css"),
  ]);
  assert.match(flow, /items: T\[\]/u);
  assert.match(flow, /renderCard: \(item: T, index: number, active: boolean\)/u);
  assert.match(flow, /autoAdvanceMs = 7_000/u);
  assert.match(flow, /setInterval/u);
  assert.match(flow, /onMouseEnter=\{\(\) => setPaused\(true\)\}/u);
  assert.match(flow, /aria-roledescription="carousel"/u);
  assert.match(flow, /aria-roledescription="slide"/u);
  assert.match(flow, /aria-label=\{`\$\{index \+ 1\} of \$\{count\}`\}/u);
  assert.match(flow, /className="card-coverflow__progress"/u);
  assert.match(home, /<CardCoverFlow/u);
  assert.match(home, /autoAdvanceMs=\{7000\}/u);
  assert.match(home, /v481-pinned-stage.*v481-pinned-touch-only/su);
  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*?\.card-coverflow-desktop \{ display: block; \}[\s\S]*?\.v481-pinned-touch-only \{ display: none/u);
  assert.match(css, /--theme-effect-cover-glow/u);
  assert.match(css, /--theme-effect-button-glow/u);
});

test("Pinned Series exposes an admin-selectable Classic/CardCoverFlow mode", async () => {
  const [config, panel, workspace, home, app] = await Promise.all([
    readProjectFile("lib/site-configuration.ts"),
    readProjectFile("components/nyascans/SiteConfigurationPanel.tsx"),
    readProjectFile("components/nyascans/admin/AppearanceWorkspace.tsx"),
    readProjectFile("components/nyascans/HomeFeatureSections.tsx"),
    readProjectFile("components/nyascans/NyaScansApp.tsx"),
  ]);
  assert.match(config, /pinnedSeriesStyle: pinnedSeriesCarouselStyleSchema\.default\("CLASSIC"\)/u);
  assert.match(config, /homepage: \{ \.\.\.defaultSiteConfiguration\.homepage, \.\.\.input\.homepage \}/u);
  assert.match(panel, /Homepage layout|Pinned Series carousel style/u);
  assert.match(panel, /value="CARD_COVER_FLOW"/u);
  assert.match(workspace, /homepage.*Homepage layout/su);
  assert.match(app, /<PinnedSeriesSection carouselStyle=\{siteConfiguration\.homepage\.pinnedSeriesStyle\}/u);
  assert.match(home, /data-carousel-style="CARD_COVER_FLOW"/u);
  assert.match(home, /v481-pinned-classic/u);
});

test("pasted-content UI contracts remove Home elevation, unify section accents, and normalize badges/pagination", async () => {
  const [surfaces, globals, builder] = await Promise.all([
    readProjectFile("app/theme-surfaces.css"),
    readProjectFile("app/globals.css"),
    readProjectFile("components/nyascans/ThemeBuilderPage.tsx"),
  ]);
  assert.match(surfaces, /canonical Home surface\/effect contracts/u);
  assert.match(surfaces, /\.home-main > :is\(\.featured-slider, \.page-wrap, \.content-section, \.updates-section, \.home-announcement-stack\)/u);
  assert.match(surfaces, /background: transparent !important;[\s\S]*box-shadow: none !important;[\s\S]*color: var\(--section-accent\)/u);
  assert.match(surfaces, /var\(--section-accent-soft, var\(--section-accent\)\)/u);
  assert.match(surfaces, /\.latest-pagination[\s\S]*width: 2\.5rem !important[\s\S]*height: 2\.5rem !important[\s\S]*place-items: center !important/u);
  assert.match(surfaces, /\.series-type-badge\.is-flag-only[\s\S]*width: max-content !important[\s\S]*padding: \.14rem !important/u);
  assert.match(surfaces, /\.v481-ticket-ribbon[\s\S]*border-radius: 999px !important/u);
  assert.match(surfaces, /\.v481-ticket-ribbon[\s\S]*transform: none !important/u);
  assert.match(surfaces, /\.theme-builder-export[\s\S]*\.theme-token-group-chevron/u);
  assert.match(builder, /Current JSON/u);
  assert.match(builder, /Current MD/u);
  assert.match(builder, /Blank JSON/u);
  assert.match(builder, /Blank MD/u);
  assert.match(builder, /CaretUp/u);
  assert.match(builder, /CaretDown/u);
  assert.doesNotMatch(builder, /<small>Design tokens<\/small>/u);
  assert.match(globals, /section-action-orbit/u);
});

test("site configuration preserves Classic for legacy data and accepts CardCoverFlow safely", () => {
  const validation = spawnSync(
    fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url)),
    [
      "--eval",
      `import { parseSiteConfiguration } from './lib/site-configuration.ts';
       const legacy = parseSiteConfiguration({});
       const selected = parseSiteConfiguration({ homepage: { pinnedSeriesStyle: 'CARD_COVER_FLOW' } });
       const malformed = parseSiteConfiguration({ homepage: { pinnedSeriesStyle: 'NOT_A_STYLE' } });
       if (legacy.homepage.pinnedSeriesStyle !== 'CLASSIC') throw new Error('legacy default was not Classic');
       if (selected.homepage.pinnedSeriesStyle !== 'CARD_COVER_FLOW') throw new Error('CardCoverFlow was not accepted');
       if (malformed.homepage.pinnedSeriesStyle !== 'CLASSIC') throw new Error('malformed style did not fall back to Classic');`,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(validation.status, 0, validation.stderr);
});

test("Claude presets replace the circled Slate Rain and Jade Night themes", async () => {
  const model = await readProjectFile("lib/theme-system.ts");
  assert.match(model, /name: "Ember Cloth"/u);
  assert.match(model, /name: "Light Brick"/u);
  assert.doesNotMatch(model, /name: "Slate Rain"/u);
  assert.doesNotMatch(model, /name: "Jade Night"/u);
  assert.match(model, /background: "#1A1815"/u);
  assert.match(model, /background: "#F5F3EE"/u);
  assert.match(model, /effectMovingLight: "#D97757"/u);
  assert.match(model, /homePinnedSeriesAccent: "#D9AE6C"/u);
});

test("discount badges use the opposite top-right placement and Latest Updates starts with the compact page sequence", async () => {
  const [css, pagination] = await Promise.all([
    readProjectFile("app/globals.css"),
    readProjectFile("components/nyascans/latest-pagination.ts"),
  ]);
  assert.match(css, /Canonical discount badge: one horizontal top-right treatment/u);
  assert.match(css, /right: \.7rem !important;[\s\S]*?left: auto !important;[\s\S]*?transform: none !important;/u);
  assert.doesNotMatch(css, /left: \.05rem !important;[\s\S]*?transform: rotate\(-32deg\)/u);
  assert.match(pagination, /if \(page <= 2\) return \[1, 2, "ellipsis", pageCount\]/u);
});

test("Latest Updates pagination helper renders compact, direct navigation sequences", () => {
  const validation = spawnSync(
    fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url)),
    [
      "--eval",
      `import { latestPageItems } from './components/nyascans/latest-pagination.ts';
       const cases = [
         [latestPageItems(1, 9), [1, 2, 'ellipsis', 9]],
         [latestPageItems(2, 9), [1, 2, 'ellipsis', 9]],
         [latestPageItems(5, 9), [1, 'ellipsis', 4, 5, 6, 'ellipsis', 9]],
         [latestPageItems(9, 9), [1, 'ellipsis', 7, 8, 9]],
       ];
       for (const [actual, expected] of cases) {
         if (JSON.stringify(actual) !== JSON.stringify(expected)) {
           throw new Error('pagination mismatch: ' + JSON.stringify(actual));
         }
       }`,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(validation.status, 0, validation.stderr);
});

test("Theme Builder exposes independently addressable groups, workspace tokens, and both interchange formats", async () => {
  const [model, builder, surfaces] = await Promise.all([
    readProjectFile("lib/theme-system.ts"),
    readProjectFile("components/nyascans/ThemeBuilderPage.tsx"),
    readProjectFile("app/theme-surfaces.css"),
  ]);
  for (const group of [
    "Core Palette",
    "Home · Pinned Series",
    "Home · Hero Slider",
    "Home · Trending",
    "Home · Recent Reviews",
    "Home · New Series",
    "Home · Announcements",
    "Home · Top Teams",
    "Home · Latest Comments",
    "Browse Filters & Catalog",
    "Library",
    "Reader",
    "Team Pages",
    "Store",
    "Admin",
    "Effects & Glows",
    "Notifications",
    "Status Signals",
  ]) assert.match(model, new RegExp(`name: "${group.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"`, "u"));
  for (const token of ["browseAccent", "libraryAccent", "readerAccent", "teamPagesAccent", "storeAccent", "adminAccent"]) {
    assert.match(model, new RegExp(`\\b${token}: hexColor`, "u"));
    assert.match(surfaces, new RegExp(`--theme-${token.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}` , "u"));
  }
  assert.match(builder, /useState<Set<string>>/u);
  assert.match(builder, /new Set\(\[themeTokenGroups\[0\]/u);
  assert.match(builder, /Expand all/u);
  assert.match(builder, /Collapse all/u);
  assert.match(builder, /aria-expanded=\{isOpen\}/u);
  assert.match(builder, /exportThemeMarkdown/u);
  assert.match(builder, /blankThemeMarkdownTemplate/u);
  assert.match(builder, /accept="application\/json,\.json,text\/markdown,\.md"/u);
  assert.match(model, /exportThemeMarkdown/u);
  assert.match(model, /parseThemeMarkdown/u);
  assert.match(model, /The theme Markdown repeats token/u);
});
