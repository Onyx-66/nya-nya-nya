import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (relativePath) => fs.readFile(path.join(root, relativePath), "utf8");

test("Branding & Appearance exposes the full management surfaces", async () => {
  const [appearance, app, themeBuilder, discountStyles, reviewStyles] = await Promise.all([
    read("components/nyascans/admin/AppearanceWorkspace.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/ThemeBuilderPage.tsx"),
    read("components/nyascans/admin/DiscountCardStylePanel.tsx"),
    read("components/nyascans/admin/RecentReviewsSettingsPanel.tsx"),
  ]);

  for (const label of ["Theme Management", "Discount presentation", "Recent Reviews"]) {
    assert.match(appearance, new RegExp(`label: "${label}"`));
  }
  assert.match(appearance, /<ThemeBuilderPage controller=\{themeController\} notify=\{notify\} embedded \/>/u);
  assert.match(appearance, /<DiscountCardStylePanel \/>/u);
  assert.match(appearance, /<RecentReviewsSettingsPanel \/>/u);
  assert.match(app, /"theme-management"/u);
  assert.match(app, /themeController=\{themeController\}/u);
  assert.match(themeBuilder, /embedded\?: boolean/u);
  assert.match(discountStyles, /STYLE_1/u);
  assert.match(discountStyles, /STYLE_2/u);
  assert.match(discountStyles, /STYLE_3/u);
  assert.match(discountStyles, /\/api\/v1\/admin\/commercial-settings/u);
  assert.match(reviewStyles, /recentReviewsStyle/u);
  assert.match(reviewStyles, /\/api\/v1\/admin\/site-configuration/u);
});

test("Recent Reviews presentation is persisted with a backward-compatible default and rendered", async () => {
  const [configuration, server, home] = await Promise.all([
    read("lib/site-configuration.ts"),
    read("lib/server/site-configuration.ts"),
    read("components/nyascans/HomeFeatureSections.tsx"),
  ]);
  assert.match(configuration, /recentReviewsPresentationStyleSchema = z\.enum\(\["CLASSIC_RAIL", "COMPACT_RAIL"\]\)/u);
  assert.match(configuration, /recentReviewsStyle: recentReviewsPresentationStyleSchema\.default\("CLASSIC_RAIL"\)/u);
  assert.match(configuration, /recentReviewsStyle: "CLASSIC_RAIL"/u);
  assert.match(server, /recentReviewsStyle: settings\.homepage\.recentReviewsStyle/u);
  assert.match(home, /useSiteConfiguration\(\)/u);
  assert.match(home, /data-review-style=\{siteConfiguration\.homepage\.recentReviewsStyle\}/u);
});

test("mixed-concern admin pages use the shared tabbed/window shell", async () => {
  const [pinned, discounts, sliders] = await Promise.all([
    read("components/nyascans/admin/PinnedSeriesPanel.tsx"),
    read("components/nyascans/admin/DiscountsPanel.tsx"),
    read("components/nyascans/admin/SliderManagementPanel.tsx"),
  ]);
  assert.match(pinned, /tabs=\{\[/u);
  assert.match(pinned, /Select series/u);
  assert.match(pinned, /Order & schedule/u);
  assert.match(discounts, /Discount schedule/u);
  assert.match(discounts, /New \/ edit discount/u);
  assert.match(sliders, /Create slider/u);
  assert.match(sliders, /Slider history/u);
});

test("new presentation CSS stays on theme tokens", async () => {
  const [adminCss, globalCss] = await Promise.all([
    read("app/admin.css"),
    read("app/globals.css"),
  ]);
  assert.match(adminCss, /appearance-presentation-window/u);
  assert.match(adminCss, /appearance-discount-style-option/u);
  assert.match(adminCss, /appearance-review-style-option/u);
  assert.match(globalCss, /data-review-style="COMPACT_RAIL"/u);
  const newAdminCss = adminCss.slice(adminCss.indexOf("/* Branding & Appearance consolidated presentation windows. */"));
  assert.doesNotMatch(newAdminCss, /#(?:[0-9a-fA-F]{3}){1,2}\b/u);
});
