import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("Version 45 repairs responsive discovery controls", async () => {
  const [app, teams, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
    read("app/globals.css"),
  ]);
  const latest = app.slice(app.indexOf("function LatestUpdatesGrid"), app.indexOf("function TrendingShowcase"));
  assert.ok(latest.indexOf('className="latest-language-filter"') > latest.indexOf('className="latest-home-periods"'));
  assert.match(latest, /ChapterAccessBadge/);
  assert.match(css, /grid-template-rows:\s*repeat\(2/);
  assert.match(css, /latest-chapter-title-line > a > \.chapter-status-badge/);
  assert.match(css, /catalog-pagination[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(teams, /aria-label="Grid view"[\s\S]*SquaresFour/);
  assert.match(teams, /aria-label="List view"[\s\S]*<List/);
});

test("Version 45 connects profile uploads, spoiler media, and preferences", async () => {
  const [route, profile, settings, app] = await Promise.all([
    read("app/api/v1/profiles/route.ts"),
    read("components/nyascans/PublicProfileView.tsx"),
    read("components/nyascans/ProfileSettingsWorkspace.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  assert.match(route, /discussion_media/);
  assert.match(route, /discussion_comment_gifs/);
  assert.match(route, /c\.uploader_user_id = \?/);
  assert.doesNotMatch(profile, /Library summary/);
  assert.match(profile, /public-profile-comment-media/);
  assert.match(profile, /<h2>Uploads<\/h2>/);
  assert.match(settings, /mode\?: "profile" \| "privacy"/);
  assert.match(app, /ProfileSettingsWorkspace mode="privacy"/);
  assert.match(app, /readerSettings: \{ \.\.\.defaultReaderSettings \}/);
});

test("Version 45 connects team activity, fixed pages, sliders, and first-open ad", async () => {
  const [teamPanel, teamRoute, upload, uploadRoute, schema, app, navigation, operations] = await Promise.all([
    read("components/nyascans/admin/TeamManagementPanel.tsx"),
    read("app/api/v1/admin/team-management/route.ts"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("db/schema.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("lib/admin-navigation.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  assert.match(teamPanel, /updateMember/);
  assert.match(teamPanel, /Preview images/);
  assert.match(teamPanel, /Move to draft/);
  assert.match(teamRoute, /chapter\.hide-to-draft/);
  assert.match(teamRoute, /chapter_reactions/);
  assert.match(upload, /Add first page/);
  assert.match(upload, /Add last page/);
  assert.match(uploadRoute, /FIXED_READER_PAGE_CONTROL_FORBIDDEN/);
  assert.match(schema, /canControlFixedReaderPages/);
  assert.match(navigation, /slug: "sliders"[\s\S]+label: "Sliders"/u);
  assert.match(operations, /<SliderManagementPanel \/>/);
  assert.match(operations, /<HomePromotionsPanel \/>/);
  assert.match(app, /nyascans:floating-ad:/);
  assert.match(app, /campaign\.resetKey/);
});
