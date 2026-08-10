import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("Version 48 exposes every published release language without a two-language ceiling", async () => {
  const [route, app] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const latest = route.slice(
    route.indexOf('if (path === "latest-releases")'),
    route.indexOf('if (path === "search")'),
  );
  assert.match(latest, /SELECT DISTINCT LOWER\(c\.language\) AS language/u);
  assert.match(latest, /\.max\(languageOptions\.length\)/u);
  assert.match(latest, /\[\.\.\.new Set\(parsedLanguages\)\]/u);
  const latestUi = app.slice(
    app.indexOf('className="latest-updates-block"'),
    app.indexOf('className="latest-grid latest-loading-grid"'),
  );
  assert.doesNotMatch(latestUi, /Select up to two/u);
  assert.doesNotMatch(latestUi, /slice\(0, 2\)/u);
  assert.match(latestUi, /All\s+<ArrowRight/u);
});

test("Version 48 resolves dedicated slider, cover, then banner while preserving static media URLs", async () => {
  const [resolver, publicRoute, adminRoute, app] = await Promise.all([
    read("lib/server/series-media-url.ts"),
    read("app/api/v1/homepage-sliders/route.ts"),
    read("app/api/v1/admin/sliders/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  assert.match(resolver, /normalized\.startsWith\("\/"\)/u);
  assert.match(resolver, /\^https\?:\\\/\\\//u);
  for (const source of [publicRoute, adminRoute]) {
    assert.match(source, /preferredSeriesArtworkUrl/u);
    assert.match(source, /\["slider",[\s\S]*\["cover",[\s\S]*\["banner",/u);
  }
  assert.match(app, /item\.slider\?\.trim\(\) \|\| item\.cover\?\.trim\(\)/u);
});

test("Version 48 anchors opaque menus above content and centers the floating ad at viewport scale", async () => {
  const [css, app] = await Promise.all([
    read("app/globals.css"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const authority = css.slice(css.indexOf("/* Version 48 — authoritative public controls"));
  const campaignAuthority = css.slice(
    css.indexOf("/* Version 48.2.0 final cascade authority."),
    css.indexOf("/* Version 48.2.0 — configurable typography"),
  );
  const dropdownLayer = Number(css.match(/--z-dropdown:\s*(\d+)/u)?.[1]);
  const modalLayer = Number(css.match(/--z-modal:\s*(\d+)/u)?.[1]);
  assert.ok(dropdownLayer > modalLayer, "dropdowns must render above the floating-ad modal layer");
  assert.match(authority, /--anchored-menu-top/u);
  assert.match(authority, /position: fixed !important/u);
  assert.match(authority, /z-index: var\(--z-dropdown\)/u);
  assert.match(authority, /background: var\(--surface-strong\) !important/u);
  assert.match(app, /document\.addEventListener\("pointerdown"/u);
  assert.match(app, /document\.addEventListener\("scroll", queueOpenMenuPosition, passiveCapture\)/u);
  assert.match(campaignAuthority, /\.event-campaign-backdrop \{[\s\S]*position: fixed !important;[\s\S]*inset: 0 !important;[\s\S]*display: grid !important;[\s\S]*place-items: center !important;/u);
  assert.match(campaignAuthority, /\.event-campaign-modal\.floating-home-ad \{[\s\S]*width: min\(960px, 94vw\) !important;[\s\S]*min-height: min\(580px, 82dvh\) !important;[\s\S]*max-height: 92dvh !important;[\s\S]*transform: none !important;/u);
  assert.match(campaignAuthority, /@media \(max-width: 760px\)[\s\S]*place-items: end center !important;[\s\S]*width: 100% !important;[\s\S]*overflow-y: auto !important;/u);
  assert.match(app, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="event-campaign-title"/u);
  assert.match(app, /event-campaign-info/u);
  assert.match(app, /event-campaign-action/u);
  assert.match(app, /doNotShowToday/u);
});

test("Version 48 makes team identity order and Browse controls explicit", async () => {
  const [css, discovery] = await Promise.all([
    read("app/globals.css"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
  ]);
  const authority = css.slice(css.indexOf("/* Version 48 — authoritative public controls"));
  assert.match(authority, /\.teams-directory-results\.is-grid \.team-directory-card \{[\s\S]*grid-template-areas: "banner" "logo" "identity"[\s\S]*grid-template-rows: auto clamp\(3\.2rem, 4\.5vw, 3\.625rem\) auto/u);
  assert.match(authority, /\.teams-directory-results\.is-grid \.team-directory-card > div \{[\s\S]*grid-area: identity;[\s\S]*padding: 1rem;/u);
  assert.match(css, /\.teams-directory-results\.is-list \.team-directory-card \{[\s\S]*grid-template-areas: "logo identity"/u);
  assert.match(discovery, /className="team-release-languages"/u);
  assert.match(discovery, /className="team-card-action"/u);
  assert.match(discovery, /href="\/browse\?sort=added">\s*All\s+<ArrowRight/u);
  assert.match(authority, /\.catalog-toolbar \.compact-option-menu > summary[\s\S]*font-weight: 400/u);
  assert.match(authority, /border-radius: var\(--site-button-radius, var\(--radius-small\)\)/u);
});

test("Version 48 supports Brazilian Portuguese as a distinct admin and upload language", async () => {
  const [metadata, upload, flags] = await Promise.all([
    read("lib/admin-metadata.ts"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("lib/language-flags.ts"),
  ]);
  assert.match(metadata, /\["pt", "Portuguese"\],[\s\S]*\["pt-br", "Brazilian Portuguese"\]/u);
  assert.match(metadata, /BR: "pt-br"/u);
  assert.match(upload, /\["pt", "🇵🇹", "Portuguese"\],[\s\S]*\["pt-br", "🇧🇷", "Brazilian Portuguese"\]/u);
  assert.match(flags, /"pt-br": "br"/u);
  assert.match(flags, /"pt-br": "Brazilian Portuguese"/u);
});

test("Version 48 keeps media-only saves out of metadata mutation and preserves team rights", async () => {
  const [panel, route, optimizer, field] = await Promise.all([
    read("components/nyascans/admin/SeriesManagementPanel.tsx"),
    read("app/api/v1/admin/series-management/route.ts"),
    read("lib/client/media-optimizer.ts"),
    read("components/nyascans/admin/AdminMediaField.tsx"),
  ]);
  assert.match(panel, /if \(metadataDirty\)[\s\S]*\/api\/v1\/admin\/series-management/u);
  assert.match(panel, /saveStage = `\$\{slot\} upload`/u);
  assert.match(panel, /x-request-id/u);
  assert.match(route, /allowed_languages_json AS allowedLanguagesJson/u);
  assert.match(route, /upload_requires_review AS uploadRequiresReview/u);
  assert.match(route, /series_management_operation_failed/u);
  assert.match(optimizer, /const outputType = blob\.type/u);
  assert.match(field, /Pending upload/u);
  assert.match(field, /Discard pending/u);
  assert.match(field, /Preview unavailable/u);
});

test("Version 48 groups functional admin areas and hides technical references by default", async () => {
  const [app, operations, css, route] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/globals.css"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);
  for (const label of ["Command center", "Publishing & content", "People & trust", "Revenue & balances", "Operations record", "Platform controls"]) {
    assert.match(app, new RegExp(`label: "${label}"`, "u"));
  }
  assert.match(app, /\["Categories & genres", Tag\]/u);
  assert.match(operations, /section === "Categories & genres"[\s\S]*<TaxonomyManager/u);
  const dispatcher = operations.slice(operations.indexOf("export function OperationsControlPanel"));
  assert.doesNotMatch(dispatcher, /section === "Overview"[\s\S]{0,240}<AnalyticsPanel/u);
  assert.match(app, /items: \[\["Analytics", ChartLineUp\], \["Overview", SquaresFour\]\]/u);
  assert.match(operations, /className="user-admin-record"/u);
  assert.match(operations, /className="technical-reference"/u);
  assert.match(operations, /loadFailed && users\.length === 0 \? null/u);
  assert.match(operations, /payload === null \? null : payload\.rows\.length/u);
  assert.match(operations, /aria-label="Copy transaction reference"/u);
  assert.match(operations, /Recent adjustments/u);
  assert.match(operations, /balanceSummary\?\.fundedAccounts/u);
  assert.match(operations, /section === "Transactions"/u);
  assert.match(app, /\["Transactions", Storefront\]/u);
  assert.match(route, /WITH user_balances AS/u);
  assert.match(route, /const \[result, totals, history\] = await Promise\.all/u);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.ops-shell\[data-operations-mode="admin"\][\s\S]*display: block/u);
});
