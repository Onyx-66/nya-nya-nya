import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const [app, badge, features, publicApi, adminApi, adminPanel, schema, migration, restore, css] = await Promise.all([
  read("components/nyascans/NyaScansApp.tsx"),
  read("components/nyascans/ActiveDiscountBadge.tsx"),
  read("components/nyascans/HomeFeatureSections.tsx"),
  read("app/api/v1/home-promotions/route.ts"),
  read("app/api/v1/admin/home-promotions/route.ts"),
  read("components/nyascans/admin/HomePromotionsPanel.tsx"),
  read("db/schema.ts"),
  read("drizzle/0057_home_announcement_banners.sql"),
  read("scripts/restore-preview-data.mjs"),
  read("app/globals.css"),
]);

test("logged-out overflow menu removes only duplicate Browse, Latest Updates, and Store links", () => {
  const menus = [...app.matchAll(/<div className="header-overflow-menu"[\s\S]*?<\/div>/g)].map((match) => match[0]);
  const menu = menus.at(-1) ?? "";
  assert.match(menu, /href="\/rankings"/);
  assert.match(menu, /href="\/teams"/);
  assert.match(menu, /href="\/support"/);
  assert.match(menu, /href="\/pinned"/);
  assert.match(menu, /href="\/discounts"/);
  assert.doesNotMatch(menu, /href="\/browse"/);
  assert.doesNotMatch(menu, /href="\/latest"/);
  assert.doesNotMatch(menu, /href="\/store"/);
});

test("ActiveDiscountBadge is icon-free and the shared ribbon is top-left diagonal", () => {
  assert.doesNotMatch(badge, /from ["']@phosphor-icons\/react["']/);
  assert.match(badge, /\{percentage\}% off/);
  assert.match(css, /Canonical discount ribbon/);
  assert.match(css, /\.active-discount-cover-badge[\s\S]*?top: \.7rem !important/);
  assert.match(css, /\.active-discount-cover-badge[\s\S]*?left: \.05rem !important/);
  assert.match(css, /transform: rotate\(-32deg\)/);
  assert.match(css, /background: linear-gradient\(135deg, #e45692/);
  assert.match(features, /ActiveDiscountBadge seriesSlug=\{record\.slug\} className="is-pinned" \/>/);
});

test("floating ads support independently themed stacked banners end to end", () => {
  for (const field of ["highlight_text", "side_icon", "secondary_actions_json", "border_color", "accent_line_position"]) {
    assert.match(schema, new RegExp(field));
    assert.match(migration, new RegExp(field));
  }
  assert.match(publicApi, /highlight_text AS highlightText/);
  assert.match(publicApi, /secondary_actions_json AS secondaryActionsJson/);
  assert.match(publicApi, /secondaryActions:/);
  assert.match(adminApi, /secondaryActions: z\.array/);
  assert.match(adminApi, /accentLinePosition: z\.enum\(\["top", "left", "bottom"\]\)/);
  assert.match(adminApi, /secondary_actions_json/);
  assert.match(adminPanel, /Highlighted title text/);
  assert.match(adminPanel, /Accent line edge/);
  assert.match(adminPanel, /Secondary actions/);
  assert.match(adminPanel, /Add secondary action/);
  assert.match(app, /className="home-announcement-stack"/);
  assert.match(app, /campaigns\.slice\(0, 4\)/);
  assert.match(app, /data-accent-line=\{campaign\.accentLinePosition\}/);
  assert.match(app, /renderAnnouncementTitle\(campaign\.title, campaign\.highlightText\)/);
  assert.doesNotMatch(app, /localStorage\.getItem\(storageKey\)/);
  assert.match(css, /\.home-announcement-banner\[data-accent-line="left"\]/);
  assert.match(css, /\.home-announcement-banner\[data-accent-line="bottom"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("announcement action groups use content-sized primary and plain secondary links", () => {
  assert.match(app, /className="home-announcement-actions"/);
  assert.match(app, /className="home-announcement-primary"/);
  assert.match(app, /className="home-announcement-secondary-actions"/);
  assert.match(css, /\.home-announcement-actions \{[\s\S]*?width: fit-content/);
  assert.match(css, /\.home-announcement-secondary-actions \{[\s\S]*?width: 100%/);
  assert.match(css, /\.home-announcement-secondary-actions a \{[\s\S]*?padding: 0/);
  assert.match(css, /\.home-announcement-secondary-actions a \{[\s\S]*?border: 0/);
  assert.match(css, /\.home-announcement-secondary-actions a:is\(:hover, :focus-visible\)[\s\S]*?color: var\(--campaign-primary\)/);
  assert.match(css, /\.home-announcement-secondary-actions a:is\(:hover, :focus-visible\)[\s\S]*?text-decoration: underline/);
});

test("preview restore contains independent gold and red campaign examples", () => {
  assert.match(restore, /preview-leaderboard-banner/);
  assert.match(restore, /#F7C948/);
  assert.match(restore, /\"top\"/);
  assert.match(restore, /preview-membership-banner/);
  assert.match(restore, /#F23D5D/);
  assert.match(restore, /\"left\"/);
  assert.match(restore, /JSON\.stringify\(\[\{ label: \"Plans\"/);
});
