import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("administrator and team request previews reuse one MangaDex boundary", async () => {
  const [service, adminRoute, teamRoute] = await Promise.all([
    read("lib/server/metadata-import.ts"),
    read("app/api/v1/admin/metadata-import/route.ts"),
    read("app/api/v1/series-request-metadata-import/route.ts"),
  ]);
  assert.match(adminRoute, /previewExternalMetadata/);
  assert.match(teamRoute, /previewExternalMetadata/);
  assert.doesNotMatch(adminRoute, /api\.mangadex\.org/);
  assert.doesNotMatch(teamRoute, /api\.mangadex\.org/);
  assert.equal(
    (service.match(/api\.mangadex\.org/g) ?? []).length,
    1,
    "the external provider URL should exist in one shared implementation",
  );
});

test("team metadata preview is freshly authorized and cannot target locked requests", async () => {
  const route = await read(
    "app/api/v1/series-request-metadata-import/route.ts",
  );
  assert.match(route, /assertSameOrigin/);
  assert.match(route, /requireActor/);
  assert.match(route, /assertSeriesRequestTeamPermission/);
  assert.match(route, /submitting_team_id = \?/);
  assert.match(route, /status IN \('DRAFT', 'CHANGES_REQUESTED'\)/);
  assert.match(route, /refresh: false/);
  assert.match(route, /cache-control": "private, no-store/);
});

test("shared import service validates sources, rate-limits, caches and detects exact duplicates", async () => {
  const service = await read("lib/server/metadata-import.ts");
  assert.match(service, /\["mangadex\.org", "www\.mangadex\.org"\]/);
  assert.match(service, /url\.protocol !== "https:"/);
  assert.match(service, /uuid\("Enter a valid MangaDex title URL or UUID\."\)/);
  assert.match(service, /action IN \('PREVIEW', 'REQUEST_PREVIEW'\)/);
  assert.match(service, /datetime\('now', '-1 hour'\)/);
  assert.match(service, /\) < 30/);
  assert.match(service, /metadata_import_cache/);
  assert.match(service, /datetime\('now', '\+12 hours'\)/);
  assert.match(service, /series_external_sources/);
  assert.match(service, /FROM series_requests/);
  assert.match(service, /mangadex_id = \?/);
  assert.match(service, /normalizeMangaUpdatesInput/);
  assert.match(service, /api\.mangaupdates\.com\/v1\/series/);
  assert.match(service, /mapMangaUpdates/);
  assert.match(service, /coverReferenceUrl/);
  assert.match(service, /result = 'FAILURE'/);
});

test("request workspace requires preview and explicit per-field acceptance", async () => {
  const [workspace, teamApi] = await Promise.all([
    read("components/nyascans/upload/SeriesRequestWorkspace.tsx"),
    read("app/api/v1/series-requests/route.ts"),
  ]);
  assert.match(workspace, /series-request-metadata-import/);
  assert.match(workspace, /Preview MangaDex metadata/);
  assert.match(workspace, /acceptedImportFields/);
  assert.match(workspace, /toggleImportField/);
  assert.match(workspace, /Apply selected fields/);
  assert.match(workspace, /Nothing is published or changed automatically/);
  assert.match(workspace, /metadataPreview\.duplicateRequest/);
  assert.match(
    workspace,
    /This exact MangaDex identifier already belongs to a series or active request/,
  );
  assert.match(
    workspace,
    /MangaUpdates import remains unavailable|MangaUpdates import is unavailable/,
  );
  assert.match(teamApi, /mangaDex: true/);
  assert.match(teamApi, /mangaUpdates: false/);
  assert.match(teamApi, /previewRequired: true/);
  assert.match(teamApi, /perFieldAcceptance: true/);
});
