import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, operations, uploadCenter, uploadJobs, api, css] =
  await Promise.all([
    readFile("components/nyascans/NyaScansApp.tsx", "utf8"),
    readFile("components/nyascans/OperationsControlPanel.tsx", "utf8"),
    readFile(
      "components/nyascans/upload/UploadCenterWorkspace.tsx",
      "utf8",
    ),
    readFile("app/api/v1/upload-jobs/route.ts", "utf8"),
    readFile("app/api/v1/[...resource]/route.ts", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

test("homepage places the compact Editor's Pick after Latest Updates", () => {
  const homeStart = app.indexOf("function HomeView");
  const latest = app.indexOf("<LatestUpdatesGrid", homeStart);
  const editorsPick = app.indexOf("<EditorsPickSection", homeStart);

  assert.ok(homeStart > -1);
  assert.ok(latest > homeStart);
  assert.ok(editorsPick > latest);
  assert.match(app, /editors-pick-cover-back-left/);
  assert.match(app, /editors-pick-cover-back-right/);
  assert.match(app, /aria-label="Previous Editor’s Pick"/);
  assert.match(app, /aria-label="Next Editor’s Pick"/);
});

test("featured slider stays readable in both site themes", () => {
  assert.match(css, /\.featured-slider-copy,[\s\S]*color: #f4f8fc;/);
  assert.match(css, /\.featured-slider-copy p \{[\s\S]*color: #c5d2dd;/);
  assert.match(css, /\.featured-slider-actions \.button-secondary \{/);
  assert.match(
    css,
    /\.featured-slider-arrows button \{[\s\S]*color: #f4f8fc;/,
  );
});

test("series creation uses one request-and-approval workflow", () => {
  assert.match(operations, /Create New Series/);
  assert.match(
    operations,
    /window\.location\.href = "\/dashboard\/upload-center\/add-series"/,
  );
  assert.doesNotMatch(operations, /createWorkspaceSeries/);
  assert.match(uploadCenter, /\["add-series", "Create New Series", Plus\]/);
  assert.match(api, /SERIES_REQUEST_REQUIRED/);
});

test("Upload Center startup defers cleanup errors without hiding the workspace", () => {
  assert.match(uploadJobs, /try \{\s*await cleanupExpiredUploadDrafts/);
  assert.match(uploadJobs, /Upload draft cleanup deferred/);
});

test("Latest Top Comments names the series and chapter beside each comment", () => {
  assert.match(app, /community-highlight-source/);
  assert.match(app, /<strong>\{item\.seriesTitle\}<\/strong>/);
  assert.match(app, /<em>Chapter \{item\.chapterNumber\}<\/em>/);
  assert.match(app, /community-highlight-cover/);
});
