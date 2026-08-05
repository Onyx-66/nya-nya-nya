import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("home discovery is compact and keeps swipe or keyboard navigation", async () => {
  const [app, discovery, styles] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("app/globals.css"),
  ]);
  const trending = app.slice(
    app.indexOf("function TrendingShowcase"),
    app.indexOf("type CommunityHighlight"),
  );

  assert.doesNotMatch(trending, /Previous Trending titles|Next Trending titles/);
  assert.match(trending, /onKeyDown/);
  assert.match(
    styles,
    /\.featured-slider:not\(\.featured-slider-fallback\) \.featured-slider-inner\s*\{[^}]*padding-block:\s*1\.2rem/s,
  );
  assert.match(
    styles,
    /\[data-new-series-layout="carousel"\] \.new-series-grid::\-webkit-scrollbar\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    styles,
    /\.new-series-cover > small\s*\{[^}]*font-size:\s*8px/s,
  );
  assert.match(discovery, /onKeyDown/);
});

test("Latest Updates defaults to This Week and exposes the compact language filter", async () => {
  const [app, api, styles] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("app/globals.css"),
  ]);
  const latestGrid = app.slice(
    app.indexOf("function LatestUpdatesGrid"),
    app.indexOf("function LatestUpdatesView"),
  );
  const latestPage = app.slice(
    app.indexOf("function LatestUpdatesView"),
    app.indexOf("function TrendingShowcase"),
  );
  const latestApi = api.slice(
    api.indexOf('if (path === "latest-releases")'),
    api.indexOf('if (path === "search")'),
  );

  assert.match(latestGrid, /useState<[\s\S]*>\("week"\)/);
  assert.doesNotMatch(latestGrid, /This Month/);
  assert.match(latestGrid, /releaseLanguages/);
  assert.match(latestPage, />\("week"\)/);
  assert.match(latestGrid, /latest-age-dot/);
  assert.match(latestApi, /CASE WHEN \$\{newInPeriodExpression\}/);
  assert.match(latestApi, /isNewInPeriod: Boolean\(chapter\.isNewInPeriod\)/);
  assert.doesNotMatch(
    latestApi,
    /AND datetime\(c\.published_at\) <= datetime\('now'\)\s+\$\{countPeriodPredicate\}\s+\)/,
  );
  assert.doesNotMatch(latestApi, /WHERE releaseRank = 1[\s\S]*LIMIT 5/);
  assert.match(styles, /\.period-chapter-mark\s*\{/);
  assert.match(styles, /@keyframes period-chapter-pulse/);
});

test("header notifications open a real preview and hydrate the saved avatar", async () => {
  const [app, styles] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const header = app.slice(
    app.indexOf("function SiteHeader"),
    app.indexOf("function MobileNav"),
  );

  assert.match(header, /role="region"/);
  assert.match(header, /onBlur=/);
  assert.match(header, /state=ALL&page=1&pageSize=5/);
  assert.match(header, /header-notification-menu/);
  assert.match(header, /View all notifications/);
  assert.match(header, /safeHeaderActionUrl\(notification\.actionUrl\)/);
  assert.match(header, /nyascans:notifications-changed/);
  assert.match(header, /fetch\("\/api\/v1\/profiles"/);
  assert.match(header, /profileAvatarUrl/);
  assert.match(header, /nyascans:profile-changed/);
  assert.match(styles, /\.header-notification-menu\s*\{/);
  assert.match(styles, /\.header-avatar img,/);
});

test("avatar selection uses a 512 square crop with server enforcement", async () => {
  const [profile, mediaApi, styles] = await Promise.all([
    read("components/nyascans/ProfileSettingsWorkspace.tsx"),
    read("app/api/v1/profile-media/route.ts"),
    read("app/globals.css"),
  ]);

  assert.match(profile, /const AVATAR_OUTPUT_SIZE = 512/);
  assert.match(profile, /function AvatarCropDialog/);
  assert.match(profile, /canvas\.toBlob/);
  assert.match(profile, /Horizontal position/);
  assert.match(profile, /Vertical position/);
  assert.match(profile, /Crop & save/);
  assert.match(profile, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(profile, /URL\.revokeObjectURL/);
  assert.match(profile, /AVATAR_SOURCE_MAX_PIXELS/);
  assert.match(profile, /createImageBitmap/);
  assert.match(profile, /nyascans:profile-changed/);
  assert.match(mediaApi, /AVATAR_CROP_REQUIRED/);
  assert.match(
    mediaApi,
    /verified\.dimensions\.width !== verified\.dimensions\.height/,
  );
  assert.match(styles, /\.avatar-crop-dialog\s*\{/);
  assert.match(styles, /\.avatar-crop-preview\s*\{/);
});
