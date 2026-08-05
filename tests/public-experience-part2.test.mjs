import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("homepage discovery uses public database-backed series and teams", async () => {
  const [seriesApi, teamsApi, components] = await Promise.all([
    read("app/api/v1/new-series/route.ts"),
    read("app/api/v1/public-teams/route.ts"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
  ]);

  assert.match(seriesApi, /s\.is_published = 1/);
  assert.match(seriesApi, /s\.archived_at IS NULL/);
  assert.match(seriesApi, /ORDER BY datetime\(publicAt\) DESC, s\.id DESC/);
  assert.match(teamsApi, /verification_status = 'VERIFIED'/);
  assert.match(components, />New Series</);
  assert.match(components, />Publishing Teams</);
  assert.match(components, /aria-label="Publishing teams carousel"/);
});

test("Library provides three persistent views and versioned private transfer", async () => {
  const [workspace, dataApi, exportApi, importApi] = await Promise.all([
    read("components/nyascans/LibraryWorkspace.tsx"),
    read("app/api/v1/library-data/route.ts"),
    read("app/api/v1/library-export/route.ts"),
    read("app/api/v1/library-import/route.ts"),
  ]);

  for (const label of ["Cover grid", "Compact grid", "List view"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /nyascans:library-view/);
  assert.match(dataApi, /libraryViewMode/);
  assert.match(dataApi, /requireActor\("library\.manage\.own"\)/);
  assert.match(exportApi, /format: "nyascans-library-export"/);
  assert.match(exportApi, /version: "2\.0"/);
  assert.match(importApi, /nyascans-library-export/);
  assert.match(importApi, /ON CONFLICT\(user_id, series_id\) DO UPDATE SET/);
  assert.doesNotMatch(importApi, /\bDELETE FROM library_entries\b/);
  assert.match(exportApi, /cache-control": "private, no-store"/);
  assert.doesNotMatch(exportApi, /password|provider_token|access_token/i);
});

test("public profiles keep private reading data server-gated", async () => {
  const [profiles, follow, media, view] = await Promise.all([
    read("app/api/v1/profiles/route.ts"),
    read("app/api/v1/profile-follow/route.ts"),
    read("app/api/v1/profile-media/route.ts"),
    read("components/nyascans/PublicProfileView.tsx"),
  ]);

  assert.match(profiles, /profileVisibility !== "PUBLIC"/);
  assert.match(profiles, /showReadingHistory/);
  assert.match(profiles, /c\.uploader_user_id = \?/);
  assert.match(profiles, /uploads: uploads\.map/);
  assert.doesNotMatch(view, /Library summary/);
  assert.match(profiles, /u\.status = 'ACTIVE'/);
  assert.doesNotMatch(profiles, /SELECT[\s\S]{0,100}u\.email/i);
  assert.match(follow, /SELF_FOLLOW/);
  assert.match(follow, /FOLLOW_RATE_LIMITED/);
  assert.match(media, /private, no-store/);
  assert.match(media, /validateImageFile/);
  assert.match(media, /PROFILE_CHANGED/);
  assert.match(media, /cleanupIfUnreferenced/);
  assert.match(view, /isFollowing/);
  assert.match(view, /Activity/);
});
