import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("chapter numbers normalize leading zeroes and sort decimals numerically", async () => {
  const { compareChapterNumbers, normalizeChapterNumber } = await import(
    "../lib/chapter-number.ts"
  );

  assert.equal(normalizeChapterNumber("01"), "1");
  assert.equal(normalizeChapterNumber("02.1"), "2.1");
  assert.equal(normalizeChapterNumber("001a"), "1a");
  assert.equal(normalizeChapterNumber("０３.4"), "3.4");
  assert.deepEqual(
    ["03", "1.5", "02.9", "1", "3.4", "1.2", "02.1", "1.1", "2"]
      .sort(compareChapterNumbers)
      .map(normalizeChapterNumber),
    ["1", "1.1", "1.2", "1.5", "2", "2.1", "2.9", "3", "3.4"],
  );
});

test("discussion media compresses static images and only uses curated GIFs", async () => {
  const discussion = await read(
    "components/nyascans/EnhancedDiscussionSection.tsx",
  );
  const uploadMedia = discussion.slice(
    discussion.indexOf("async function uploadMedia"),
    discussion.indexOf("async function removePendingMedia"),
  );

  assert.match(uploadMedia, /optimizeStaticMedia\(typedFile/);
  assert.match(discussion, /rawSettings\?\.gifs/);
  assert.match(discussion, /gifIds:\s*selectedGifIds/);
  assert.match(
    uploadMedia,
    /Choose a GIF from the NyaScans GIF library instead/,
  );
  assert.match(uploadMedia, /const responseText = await response\.text\(\)/);
  assert.match(uploadMedia, /response\.status === 413/);
  assert.match(uploadMedia, /payload too large/i);
  assert.doesNotMatch(uploadMedia, /await response\.json\(\)/);
});

test("desktop discovery uses an expanded shortcut search and a wider dotless carousel", async () => {
  const [app, styles] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const navigation = app.slice(
    app.indexOf("const navItems"),
    app.indexOf("function elevatedDestination"),
  );

  assert.doesNotMatch(navigation, /label: "Completed"/);
  assert.match(
    app,
    /showNineCards \? "9" : showFiveCards \? "5" : "3"/,
  );
  assert.match(app, /<span>Search<\/span>\s*<kbd>Ctrl K<\/kbd>/);
  assert.match(styles, /\.featured-slider-dots\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.header-search\s+kbd\s*\{/);
});

test("profile media presents one full-width banner with its avatar centered", async () => {
  const [profile, styles] = await Promise.all([
    read("components/nyascans/ProfileSettingsWorkspace.tsx"),
    read("app/globals.css"),
  ]);
  const media = profile.slice(
    profile.indexOf('className="profile-settings-card profile-media-composer"'),
    profile.indexOf('className="profile-settings-card profile-identity-card"'),
  );

  assert.match(
    media,
    /profile-media-banner-stage[\s\S]*profile-media-avatar-preview/,
  );
  assert.doesNotMatch(media, /JPEG, PNG|WebP, or static|Images are verified/);
  assert.match(styles, /\.profile-media-composer\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(
    styles,
    /\.profile-media-avatar-preview\s*\{[^}]*position:\s*absolute/s,
  );
  assert.match(styles, /\.profile-media-avatar-preview\s*\{[^}]*left:\s*50%/s);
});

test("chapter APIs normalize contracts, freshness, ordering, and duplicate identity", async () => {
  const [
    resourceApi,
    chapterManagement,
    chapterAccess,
    seriesDetail,
    uploadJobs,
    uploadService,
  ] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/chapter-management/route.ts"),
    read("lib/server/chapter-access.ts"),
    read("app/api/v1/series-detail/route.ts"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("lib/server/upload-jobs.ts"),
  ]);

  assert.match(resourceApi, /PARTITION BY LTRIM\(c\.chapter_number, '0'\)/);
  assert.match(resourceApi, /datetime\('now', '-36 hours'\) AS isFresh/);
  assert.match(resourceApi, /chapterNumber: normalizeChapterNumber/);
  assert.match(resourceApi, /CAST\(c\.chapter_number AS REAL\) DESC/);
  assert.match(chapterAccess, /chapterNumber = normalizeChapterNumber/);
  assert.match(seriesDetail, /CAST\(c\.chapter_number AS REAL\) DESC/);
  assert.match(seriesDetail, /normalizeChapterNumber/);
  assert.match(uploadService, /\.transform\(normalizeChapterNumber\)/);
  assert.match(chapterManagement, /\.transform\(normalizeChapterNumber\)/);
  assert.match(
    `${chapterManagement}\n${resourceApi}\n${uploadJobs}`,
    /LTRIM\(chapter_number, '0'\) = LTRIM\(\?, '0'\)/,
  );
  assert.match(
    uploadJobs,
    /LTRIM\(duplicate\.chapter_number, '0'\)\s*=\s*LTRIM\(uji\.chapter_number, '0'\)/,
  );
});
