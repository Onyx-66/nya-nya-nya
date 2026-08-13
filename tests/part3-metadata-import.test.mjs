import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("administrator and team request previews reuse the shared MangaDex boundary", async () => {
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
    2,
    "title search and detail lookup should both stay in the shared provider service",
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

test("MangaUpdates URLs keep the public token separate from the numeric API ID", async () => {
  const {
    mangaUpdatesExternalIdAliases,
    mangaUpdatesIdentifierFromProviderId,
    mangaUpdatesIdentifierFromUrl,
  } = await import("../lib/mangaupdates-identifiers.ts");
  const expected = {
    externalId: "623698779",
    providerId: "623698779",
    sourceToken: "abc123",
    sourceUrl: "https://www.mangaupdates.com/series/abc123",
  };
  assert.deepEqual(
    mangaUpdatesIdentifierFromUrl(
      "https://www.mangaupdates.com/series/abc123/a-human-readable-slug",
    ),
    expected,
  );
  assert.deepEqual(
    mangaUpdatesIdentifierFromUrl(
      "https://www.mangaupdates.com/series.html?id=623698779",
    ),
    expected,
  );
  assert.deepEqual(
    mangaUpdatesIdentifierFromProviderId("623698779"),
    expected,
  );
  assert.deepEqual(
    mangaUpdatesExternalIdAliases(
      "623698779",
      "https://www.mangaupdates.com/series/abc123",
    ),
    ["623698779", "abc123"],
  );
  assert.deepEqual(
    mangaUpdatesExternalIdAliases(
      "1371",
      "https://www.mangaupdates.com/series/123",
    ),
    ["1371", "123"],
    "the canonical URL disambiguates an all-numeric legacy base-36 token",
  );
  for (const invalid of [
    "http://www.mangaupdates.com/series/abc123/title",
    "https://example.com/series/abc123/title",
    "https://www.mangaupdates.com/series/",
  ]) {
    assert.equal(mangaUpdatesIdentifierFromUrl(invalid), null);
  }
});

test("MangaUpdates duplicate checks accept decimal and legacy URL-token IDs", async () => {
  const [service, seriesRoute, adminMetadata] = await Promise.all([
    read("lib/server/metadata-import.ts"),
    read("app/api/v1/admin/series-management/route.ts"),
    read("lib/admin-metadata.ts"),
  ]);
  assert.match(
    service,
    /mangaUpdatesExternalIdAliases\(normalized\.id, normalized\.url\)/u,
  );
  assert.match(
    seriesRoute,
    /mangaUpdatesExternalIdAliases\(source\.externalId, source\.sourceUrl\)/u,
  );
  for (const source of [service, seriesRoute]) {
    assert.match(
      source,
      /mangaupdates_id = \? OR mangaupdates_id = \?/u,
    );
    assert.match(
      source,
      /ses\.external_id = \?[\s\S]*ses\.external_id = \?/u,
    );
  }
  assert.match(
    adminMetadata,
    /exactLegacyUrl && linkedIdentifier[\s\S]*resolvedIdentifier\.externalId/u,
    "an all-numeric legacy URL token must win over ambiguous decimal parsing",
  );
});

test("every outbound provider attempt reserves its own indexed budget entry", async () => {
  const [service, schema, migration, snapshotText] = await Promise.all([
    read("lib/server/metadata-import.ts"),
    read("db/schema.ts"),
    read("drizzle/0049_cold_union_jack.sql"),
    read("drizzle/meta/0049_snapshot.json"),
  ]);
  assert.match(service, /async function reserveProviderFetch/u);
  assert.match(service, /action = 'PROVIDER_FETCH'/u);
  assert.match(
    service,
    /for \(let attempt = 0; attempt < 2; attempt \+= 1\) \{\s*const providerLogId = await reserveProviderFetch/u,
  );
  assert.match(service, /normalized\.providerId/u);
  assert.match(schema, /metadata_import_source_action_time_idx/u);
  assert.match(migration, /metadata_import_source_action_time_idx/u);
  const snapshot = JSON.parse(snapshotText);
  assert.deepEqual(
    snapshot.tables.metadata_import_logs.indexes
      .metadata_import_source_action_time_idx.columns,
    ["source", "action", "created_at"],
  );
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

test("MangaUpdates detail URLs canonicalize to the decimal API identifier used by the provider", async () => {
  const { mangaUpdatesIdentifierFromUrl } = await import(
    "../lib/mangaupdates-identifiers.ts"
  );
  assert.deepEqual(
    mangaUpdatesIdentifierFromUrl(
      "https://www.mangaupdates.com/series/mbhnrbb/suterare-youhei-wa-jiyuu-kimama-ni-ikitai",
    ),
    {
      externalId: "48584001287",
      providerId: "48584001287",
      sourceToken: "mbhnrbb",
      sourceUrl: "https://www.mangaupdates.com/series/mbhnrbb",
    },
  );
});

test("metadata import detects provider URLs before source-specific normalization", async () => {
  const [service, editor] = await Promise.all([
    read("lib/server/metadata-import.ts"),
    read("components/nyascans/admin/SeriesManagementPanel.tsx"),
  ]);
  assert.match(service, /providerFromMetadataInput/);
  assert.match(service, /source: detectedSource/);
  assert.match(editor, /providerFromImportInput/);
  assert.match(editor, /const requestSource = detectedSource \?\? importSource/);
  assert.match(service, /mangaUpdatesTitleFromUrl/);
  assert.match(service, /MANGAUPDATES_RESPONSE_INVALID/);
});
