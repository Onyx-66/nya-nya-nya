import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [controls, app, features, discovery, css] = await Promise.all([
  read("components/nyascans/HomeRailControls.tsx"),
  read("components/nyascans/NyaScansApp.tsx"),
  read("components/nyascans/HomeFeatureSections.tsx"),
  read("components/nyascans/PublicDiscoverySections.tsx"),
  read("app/globals.css"),
]);

test("shared rail controls scroll one card and disable at both boundaries", () => {
  assert.match(controls, /railStep\(rail\)/);
  assert.match(controls, /rail\.scrollBy\(\{/);
  assert.match(controls, /behavior: reduceMotion \? "auto" : "smooth"/);
  assert.match(controls, /canPrevious: rail\.scrollLeft > 2/);
  assert.match(controls, /canNext: maxScrollLeft > 2 && rail\.scrollLeft < maxScrollLeft - 2/);
  assert.match(controls, /disabled={!boundaries\.canPrevious}/);
  assert.match(controls, /disabled={!boundaries\.canNext}/);
});

test("target Home sections use the shared controls without replacing their touch rails", () => {
  assert.match(app, /<HomeRailControls railRef={railRef} label="Trending" \/>/);
  assert.match(features, /<HomeRailControls railRef={railRef} label="Recent Reviews" \/>/);
  assert.match(discovery, /<HomeRailControls railRef={railRef} label="New Series" \/>/);
  assert.match(app, /className="series-rail trending-rail"/);
  assert.match(features, /className="recent-reviews-rail"/);
  assert.match(discovery, /className="new-series-grid"/);
  assert.match(app, /onKeyDown=\{\(event\) =>/);
  assert.match(features, /onPointerUp=\{syncActiveReview\}/);
  assert.match(discovery, /onKeyDown=\{\(event\) =>/);
});

test("arrows are separate from section header actions and hidden on mobile", () => {
  assert.match(css, /\.home-scroll-row \{/);
  assert.match(css, /\.home-scroll-row > \.home-rail-controls \{/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /\.home-rail-controls \.v481-pinned-arrow \{/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.home-rail-controls \{/);
  assert.match(css, /display: none;/);
  assert.match(app, /className="trending-actions"/);
  assert.match(features, /allHref="\/latest\?view=reviews"/);
  assert.match(discovery, /className="new-series-heading-actions"/);
});
