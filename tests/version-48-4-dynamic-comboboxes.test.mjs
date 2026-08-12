import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

test("dynamic taxonomy and discount targets use the shared searchable combobox", async () => {
  const [taxonomy, discounts] = await Promise.all([
    read("components/nyascans/admin/TaxonomyManager.tsx"),
    read("components/nyascans/admin/DiscountsPanel.tsx"),
  ]);

  assert.match(
    taxonomy,
    /<AdminCombobox[\s\S]*?ariaLabel="Merge into active replacement"[\s\S]*?options=\{replacementComboboxOptions\}[\s\S]*?onChange=\{setReplacementId\}/u,
  );
  assert.doesNotMatch(
    taxonomy,
    /Merge into active replacement[\s\S]{0,100}<select/u,
  );
  assert.match(
    taxonomy,
    /description: `\$\{entry\.usageCount\} series`/u,
  );

  assert.match(
    discounts,
    /<AdminCombobox[\s\S]*?ariaLabel="Discount content target"[\s\S]*?options=\{targetComboboxOptions\}[\s\S]*?onChange=\{selectTarget\}/u,
  );
  assert.doesNotMatch(
    discounts,
    /\bContent\s*<select/u,
  );
  assert.match(
    discounts,
    /draft\?\.id[\s\S]*?options\.unshift\([\s\S]*?draftTargetKey\(draft\)/u,
  );
  assert.match(
    discounts,
    /description: coinLabel\(target\.originalPrice, settings\)/u,
  );
});

test("canonical admin selections over eight options use the shared combobox", async () => {
  const [
    editorial,
    operations,
    store,
    audit,
    reports,
    siteConfiguration,
  ] = await Promise.all([
    read("components/nyascans/EditorialManagementPanel.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/StoreManagementPanel.tsx"),
    read("components/nyascans/admin/AuditLogPanel.tsx"),
    read("components/nyascans/admin/SeriesReportsPanel.tsx"),
    read("components/nyascans/SiteConfigurationPanel.tsx"),
  ]);

  assert.match(
    editorial,
    /ariaLabel="Search and choose an available editorial series"[\s\S]{0,240}options=\{availableSeriesOptions\}/u,
  );
  assert.doesNotMatch(editorial, /Available series\s*<select/u);

  for (const ariaLabel of [
    "Filter activity result",
    "Search and choose a verified payout team",
    "Search and choose a team for a payout request",
    "Filter dashboard analytics by country",
  ]) {
    assert.match(
      operations,
      new RegExp(`ariaLabel="${ariaLabel}"`, "u"),
    );
  }
  assert.doesNotMatch(
    operations,
    /<select[^>]*(?:value=\{activityResult\}|value=\{accountTeamId\}|value=\{requestTeamId\}|value=\{region\})/u,
  );

  assert.match(
    store,
    /ariaLabel="Search and choose a Store collection"[\s\S]{0,240}options=\{collectionOptions\}/u,
  );
  assert.match(store, /options=\{storeSymbolOptions\}/u);
  assert.doesNotMatch(
    store,
    /<select[^>]*value=\{draft\.(?:collectionId|previewConfig\.symbol)\}/u,
  );

  assert.match(audit, /options=\{auditCategoryOptions\}/u);
  assert.doesNotMatch(
    audit,
    /<select[^>]*value=\{filters\.category\}/u,
  );
  assert.match(reports, /options=\{reportCategoryOptions\}/u);
  assert.doesNotMatch(
    reports,
    /<select[^>]*value=\{category\}/u,
  );
  assert.match(siteConfiguration, /options=\{socialIconOptions\}/u);
  assert.doesNotMatch(
    siteConfiguration,
    /<select[^>]*value=\{link\.icon\}/u,
  );
});
