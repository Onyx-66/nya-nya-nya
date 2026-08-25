import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(home, /className="v481-pinned-stage v481-pinned-touch-only"/u);
  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*?\.card-coverflow-desktop \{ display: block; \}[\s\S]*?\.v481-pinned-touch-only \{ display: none/u);
  assert.match(css, /--theme-effect-cover-glow/u);
  assert.match(css, /--theme-effect-button-glow/u);
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
