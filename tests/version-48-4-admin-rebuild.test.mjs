import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("48.4 uses the binding admin information architecture with one standalone activity page", async () => {
  const navigation = await read("lib/admin-navigation.ts");
  for (const group of [
    "Dashboard",
    "Catalog",
    "Homepage & Marketing",
    "Publishing Queue",
    "Teams",
    "Community",
    "Monetization",
    "Settings",
  ]) {
    assert.match(navigation, new RegExp(`label: "${group}"`, "u"));
  }
  for (const page of [
    "Home",
    "Series",
    "Chapters",
    "Genres & Tags",
    "Series Submissions",
    "Chapter Review",
    "Content Access Control",
    "Branding & Appearance",
    "Footer & Legal",
    "Keyboard Shortcuts",
    "Feature Flags",
    "Integrations & API",
    "Activity Log",
  ]) {
    assert.match(navigation, new RegExp(`label: "${page}"`, "u"));
  }
  assert.match(navigation, /id: "activity",\s*label: "",/u);
  assert.match(navigation, /"audit-log": "admin\.audit\.read"/u);
  assert.match(navigation, /commerce: "commerce\.manage"/u);
});

test("Catalog Series has a direct one-page create and dual-source import flow", async () => {
  const [panel, route] = await Promise.all([
    read("components/nyascans/admin/SeriesManagementPanel.tsx"),
    read("app/api/v1/admin/series-management/route.ts"),
  ]);
  assert.match(panel, /\+ Add Series/u);
  assert.match(panel, /Import from MangaDex/u);
  assert.match(panel, /Import from MangaUpdates/u);
  assert.match(panel, /Start from scratch/u);
  assert.match(panel, /Search by title or paste/u);
  assert.match(panel, /Use this/u);
  assert.match(panel, /<summary>[\s\S]*Advanced/u);
  assert.match(panel, /Save as draft/u);
  assert.match(panel, /Publish now/u);
  assert.match(panel, /const unresolvedImportConflicts = importConflicts\.filter/u);
  assert.match(panel, /setImportConflictChoices\(\{\}\)/u);
  assert.match(panel, /series-create-conflict-status/u);
  assert.equal(panel.match(/hasUnresolvedProviderConflicts/gu)?.length, 3);
  assert.equal(
    panel.match(/ariaLabel="Search and choose a publishing team"/gu)?.length,
    2,
  );
  assert.doesNotMatch(panel, /<select[\s\S]{0,160}Choose team/u);
  assert.doesNotMatch(panel, /displayedTeamSearchResults/u);
  assert.equal(panel.match(/onChangeCapture=\{captureTeamSearch\}/gu)?.length, 2);
  assert.match(panel, /series-options\?query=\$\{encodeURIComponent\(teamSearch\)\}/u);
  assert.match(
    panel,
    /setField\("teamIds", \[[\s\S]{0,80}\.\.\.form\.teamIds,[\s\S]{0,40}teamDraft/u,
  );
  assert.match(panel, /form\.teamIds\.filter\([\s\S]{0,80}id !== team\.id/u);
  assert.match(
    panel,
    /unresolvedImportConflicts\.length > 0[\s\S]+before saving or publishing/u,
  );
  assert.match(panel, /method:\s*form\.id \? "PUT" : "POST"/u);
  assert.match(route, /export async function POST/u);
  assert.match(route, /EXTERNAL_SOURCE_RESERVED/u);
});

test("unified Store and Chapters routes preserve delegated capability reachability", async () => {
  const [navigation, page, operations, store] = await Promise.all([
    read("lib/admin-navigation.ts"),
    read("app/onyx/admin/access/[[...slug]]/page.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/admin/StoreManagementWorkspace.tsx"),
  ]);
  assert.match(navigation, /alternateCapabilities: \["uploads\.review"\]/u);
  assert.match(navigation, /alternateCapabilities: \["commerce\.manage"\]/u);
  assert.match(navigation, /ADMIN_SECTION_ALTERNATE_CAPABILITIES/u);
  assert.match(navigation, /nested\.capability/u);
  assert.match(page, /hasRequestedCapability/u);
  assert.match(page, /ADMIN_SECTION_ALTERNATE_CAPABILITIES/u);
  assert.match(
    operations,
    /label: "Upload chapters",[\s\S]{0,160}destination: "Chapters",[\s\S]{0,80}subsection: "single"/u,
  );
  assert.match(
    operations,
    /!capabilities\.includes\("content\.chapters\.manage"\)[\s\S]{0,100}capabilities\.includes\("uploads\.review"\)/u,
  );
  assert.match(store, /capabilities\.includes\("commerce\.manage"\)/u);
  assert.match(store, /capabilities\.includes\("store\.manage"\)/u);
});

test("Team Directory is one editor with staff essentials before closed Advanced controls", async () => {
  const [panel, css] = await Promise.all([
    read("components/nyascans/admin/TeamManagementPanel.tsx"),
    read("app/admin.css"),
  ]);
  assert.doesNotMatch(panel, /role="tablist"/u);
  assert.doesNotMatch(panel, /activeEditorTab|teamEditorTabs/u);
  assert.doesNotMatch(panel, /window\.confirm/u);
  assert.match(panel, /<h3>Identity<\/h3>/u);
  assert.match(panel, /<h3>Status & visibility<\/h3>/u);
  assert.match(panel, /<h3>Members<\/h3>/u);
  assert.match(panel, /<details className="team-editor-advanced">/u);
  assert.doesNotMatch(panel, /team-editor-advanced"\s+open/u);
  assert.match(panel, /<strong>Advanced<\/strong>/u);
  assert.match(panel, /label="Team logo"/u);
  assert.match(panel, /label="Team banner"/u);
  assert.match(panel, /label="Staff badge"/u);
  assert.match(panel, /<h3>Series relationships<\/h3>/u);
  assert.match(panel, /className="admin-team-activity"/u);
  assert.match(panel, /<AdminCombobox/u);
  assert.match(panel, /<ConfirmActionDialog/u);
  assert.match(panel, /updateMember/u);
  assert.match(panel, /requestChapterHide/u);
  assert.match(
    css,
    /\.team-editor-advanced[\s\S]*\.team-editor-advanced-content/u,
  );
});

test("visible admin page headers use the canonical 48.4 information architecture", async () => {
  const [
    operations,
    series,
    submissions,
    reports,
    directory,
    requests,
    permissions,
    discussions,
    access,
    promotions,
    roulette,
  ] = await Promise.all([
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/admin/SeriesManagementPanel.tsx"),
    read("components/nyascans/admin/NewSeriesQueuePanel.tsx"),
    read("components/nyascans/admin/SeriesReportsPanel.tsx"),
    read("components/nyascans/admin/TeamManagementPanel.tsx"),
    read("components/nyascans/admin/TeamRequestsPanel.tsx"),
    read("components/nyascans/admin/RolePermissionsPanel.tsx"),
    read("components/nyascans/admin/ReactionLibraryPanel.tsx"),
    read("components/nyascans/admin/ContentVisibilityPanel.tsx"),
    read("components/nyascans/admin/HomePromotionsPanel.tsx"),
    read("components/nyascans/admin/RewardSettingsPanel.tsx"),
  ]);

  for (const [group, page] of [
    ["Dashboard", "Home"],
    ["Community", "Users & Roles"],
    ["Publishing Queue", "Chapter Review"],
    ["Catalog", "Chapters"],
    ["Settings", "Security"],
  ]) {
    assert.match(
      operations,
      new RegExp(
        `breadcrumbs=\\{\\["${group}", "${page}"\\]\\}`,
        "u",
      ),
    );
    assert.match(operations, new RegExp(`title="${page}"`, "u"));
  }
  assert.match(series, /\["Catalog", "Series", "Add Series"\]/u);
  assert.match(series, /title=\{mode === "create" \? "Add Series" : "Series"\}/u);
  assert.match(submissions, /breadcrumbs=\{\["Publishing Queue", "Series Submissions"\]\}/u);
  assert.match(submissions, /title="Series Submissions"/u);
  assert.match(reports, /breadcrumbs=\{\["Community", "Reports"\]\}/u);
  assert.match(reports, /title="Reports"/u);
  assert.match(directory, /breadcrumbs=\{\["Teams", "Directory"\]\}/u);
  assert.match(directory, /title="Directory"/u);
  assert.match(requests, /breadcrumbs=\{\["Teams", "Requests"\]\}/u);
  assert.match(requests, /title="Requests"/u);
  assert.match(permissions, /breadcrumbs=\{\["Community", "Permissions"\]\}/u);
  assert.match(permissions, /title="Permissions"/u);
  assert.match(discussions, /breadcrumbs=\{\["Community", "Discussions"\]\}/u);
  assert.match(discussions, /title="Discussions"/u);
  assert.match(access, /breadcrumbs=\{\["Monetization", "Content Access Control"\]\}/u);
  assert.match(access, /title="Content Access Control"/u);
  assert.match(promotions, /breadcrumbs=\{\["Homepage & Marketing", "Announcements & Ads"\]\}/u);
  assert.match(promotions, /title="Announcements & Ads"/u);
  assert.match(roulette, /<span>Monetization<\/span>/u);
  assert.match(roulette, /<h1>Roulette<\/h1>/u);
});

test("Roulette keeps everyday controls visible and rare editors in one closed Advanced disclosure", async () => {
  const [roulette, css] = await Promise.all([
    read("components/nyascans/admin/RewardSettingsPanel.tsx"),
    read("app/admin.css"),
  ]);
  const fieldset = roulette.slice(
    roulette.indexOf("<fieldset"),
    roulette.lastIndexOf("</fieldset>"),
  );
  const [everyday, advanced = ""] = fieldset.split(
    '<details className="roulette-advanced-settings">',
  );

  assert.equal((fieldset.match(/<details\b/gu) ?? []).length, 1);
  assert.doesNotMatch(fieldset, /<details[^>]*\sopen(?:\s|>)/u);
  assert.match(everyday, /Everyday controls/u);
  for (const setting of [
    "roulettePaidSpinsEnabled",
    "rouletteCooldownHours",
    "roulettePaidSpinShardCost",
    "roulettePaidSpinOnyxCost",
    "roulettePaidCurrencies",
    "chapterMinimumSeconds",
    "chapterCompleteShards",
    "commentCreatedShards",
    "upvoteReceivedShards",
  ]) {
    assert.match(everyday, new RegExp(`settings\\.${setting}`, "u"));
  }
  for (const advancedSection of [
    "Advanced configuration",
    "Shard identity",
    "Free reward pool",
    "Paid spins and premium reward pool",
    "Weekly free-spin tasks",
  ]) {
    assert.match(advanced, new RegExp(advancedSection, "u"));
  }
  assert.equal((advanced.match(/<AdminCombobox/gu) ?? []).length, 2);
  assert.equal((advanced.match(/<select/gu) ?? []).length, 5);
  assert.match(css, /\.roulette-core-settings/u);
  assert.match(css, /\.roulette-advanced-settings\[open\]/u);
});

test("metadata import supports cached title search, both providers, and queue-side cross-check", async () => {
  const [service, route, queue] = await Promise.all([
    read("lib/server/metadata-import.ts"),
    read("app/api/v1/admin/metadata-import/route.ts"),
    read("components/nyascans/admin/NewSeriesQueuePanel.tsx"),
  ]);
  assert.match(service, /api\.mangadex\.org\/manga\?/u);
  assert.match(service, /api\.mangaupdates\.com\/v1\/series\/search/u);
  assert.match(service, /datetime\('now', '\+1 hour'\)/u);
  assert.match(service, /datetime\('now', '\+12 hours'\)/u);
  assert.match(service, /source = \?[\s\S]*'-1 minute'/u);
  assert.match(service, /mangaupdates_id = \?/u);
  assert.match(route, /admin\.series-requests\.review/u);
  assert.match(queue, /External metadata cross-check/u);
  assert.match(queue, /Title search matched|Find match/u);
  assert.match(queue, /Attributed to/u);
  assert.match(queue, /nsq-source-comparison/u);
});

test("settings are split, Store is unified, and Activity Log switches view modes", async () => {
  const [app, operations, appearance, configuration, store, api, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/admin/AppearanceWorkspace.tsx"),
    read("components/nyascans/SiteConfigurationPanel.tsx"),
    read("components/nyascans/admin/StoreManagementWorkspace.tsx"),
    read("components/nyascans/admin/ApiControlPanel.tsx"),
    read("app/admin.css"),
  ]);
  assert.match(app, /workspace="branding-appearance"/u);
  assert.match(app, /workspace="footer-legal"/u);
  assert.match(app, /workspace="keyboard-shortcuts"/u);
  assert.match(appearance, /title: "Footer & Legal"/u);
  assert.match(operations, /Readable/u);
  assert.match(operations, /Technical/u);
  assert.match(operations, /admin\.audit\.read/u);
  assert.match(store, /key: "offers"/u);
  assert.match(store, /CommerceOfferManager/u);
  assert.match(api, /MangaDex/u);
  assert.match(api, /MangaUpdates/u);
  assert.match(api, /no credential required/u);
  assert.match(configuration, /className="legal-document-picker"/u);
  assert.match(configuration, /className="legal-document-common-card"/u);
  assert.match(configuration, /className="legal-document-advanced"/u);
  assert.doesNotMatch(configuration, /open=\{documentIndex === 0\}/u);
  assert.match(configuration, /className="legal-document-action-bar"/u);
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*\.legal-document-action-bar \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/u,
  );
});

test("Store destructive and discard actions use accessible shared confirmations", async () => {
  const [inventory, commercial] = await Promise.all([
    read("components/nyascans/StoreManagementPanel.tsx"),
    read("components/nyascans/CommercialSettingsPanel.tsx"),
  ]);

  for (const panel of [inventory, commercial]) {
    assert.doesNotMatch(panel, /window\.confirm|\bconfirm\(/u);
    assert.match(panel, /<ConfirmActionDialog/u);
  }
  assert.match(inventory, /This item has owners[\s\S]*existing owners will keep access/u);
  assert.match(inventory, /permanently deleted[\s\S]*cannot be undone/u);
  assert.match(inventory, /Unsaved edits and staged preview changes/u);
  assert.match(commercial, /Reloading replaces every unsaved announcement/u);
});

test("admin CSS enforces the 48.4 token system and responsive thresholds", async () => {
  const css = await read("app/admin.css");
  for (const token of [
    "#0A0E14",
    "#111826",
    "#151E2E",
    "#1B2536",
    "#232F42",
    "#37475F",
    "#4C8DFF",
    "#33C481",
    "#F5A623",
    "#F1495B",
    "#F4F6FA",
    "#93A1B8",
    "#5C6A82",
  ]) {
    assert.match(css, new RegExp(token, "iu"));
  }
  const literalSizes = [...css.matchAll(/font-size:\s*(\d+)px/gu)].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(
    [...new Set(literalSizes)].sort((a, b) => a - b),
    [12, 14, 15, 20, 30],
  );
  assert.match(css, /@media \(max-width: 1023px\)/u);
  assert.match(css, /@media \(max-width: 767px\)/u);
  assert.match(css, /\.system-notification-region[\s\S]*bottom:/u);
});

test("retained admin editors obey the mobile and token contracts", async () => {
  const [css, discounts] = await Promise.all([
    read("app/admin.css"),
    read("components/nyascans/admin/DiscountsPanel.tsx"),
  ]);
  const finalMobileRules = css.slice(
    css.lastIndexOf("@media (max-width: 767px)"),
  );

  for (const statGrid of [
    "users-control-metrics",
    "users-control-metrics.payout-summary-metrics",
    "v46-slider-admin-summary",
    "admin-summary-grid",
  ]) {
    assert.match(finalMobileRules, new RegExp(statGrid.replaceAll(".", "\\."), "u"));
  }
  assert.match(
    finalMobileRules,
    /grid-template-columns:\s*minmax\(0, 1fr\) !important/u,
  );

  for (const mobileSheet of [
    "admin-crop-dialog",
    "admin-crop-dialog-card",
    "v46-replacement-dialog",
  ]) {
    assert.match(finalMobileRules, new RegExp(mobileSheet, "u"));
  }
  assert.match(finalMobileRules, /height:\s*100dvh/u);
  assert.match(finalMobileRules, /max-height:\s*100dvh/u);
  assert.match(finalMobileRules, /display:\s*flex/u);
  assert.match(finalMobileRules, /flex-direction:\s*column/u);
  assert.match(finalMobileRules, /border-radius:\s*0 !important/u);
  assert.match(finalMobileRules, /\.ad-admin-info-row/u);

  assert.match(
    css,
    /:is\([\s\S]*\.admin-crop-dialog-card,[\s\S]*\.audit-detail-drawer,[\s\S]*\.v46-replacement-dialog > div[\s\S]*\) \{[\s\S]*box-shadow:\s*none !important;/u,
  );
  assert.match(
    discounts,
    /className="admin-sticky-actions v481-editor-actions"/u,
  );

  assert.match(
    css,
    /:is\(\.nsq-status, \.team-status\)[\s\S]*border-radius:\s*999px !important/u,
  );
  for (const statusToken of [
    "var(--admin-warning)",
    "var(--admin-accent)",
    "var(--admin-success)",
    "var(--admin-danger)",
  ]) {
    assert.ok(css.includes(statusToken));
  }

  for (const spacingOverride of [
    ".v46-slider-form > label",
    ".v46-admin-switch",
    ".v46-replacement-list button",
    ".v481-series-results > article",
    ".v481-pin-date-grid",
    ".v481-discount-preview > div",
  ]) {
    assert.ok(css.includes(spacingOverride));
  }
});
