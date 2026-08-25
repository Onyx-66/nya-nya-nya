import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Paid System uses the payments flag plus premium availability and fails closed", async () => {
  const [flags, api, hook, app] = await Promise.all([
    read("lib/server/feature-flags.ts"),
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/useCommercialSettings.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  assert.match(flags, /states\.payments\.enabled && states\.premium_unlocks\.effective/u);
  assert.match(flags, /PAID_SYSTEM_DISABLED/u);
  assert.match(api, /paidSystem: paidSystemEnabled/u);
  assert.match(api, /sanitizedSettings = paidSystemEnabled[\s\S]+failClosedCommercialSettings/u);
  assert.match(hook, /paidSystem: boolean/u);
  assert.match(hook, /paidSystem: false/u);
  assert.match(app, /const lockAndPayVisible = runtimeFeatures\.paidSystem/u);
  assert.match(app, /paidSystemEnabled \? <DiscountsSection enabled \/> : null/u);
});

test("paid API surfaces are server-gated and public chapter SQL hides paid releases", async () => {
  const [api, products, checkout, billing, purchases, discounts, gifts, bulk, visibility, page, access] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/store/products/route.ts"),
    read("app/api/v1/payments/checkout/route.ts"),
    read("app/api/v1/payments/billing-portal/route.ts"),
    read("app/api/v1/store/purchases/route.ts"),
    read("lib/server/content-discounts.ts"),
    read("app/api/v1/gifts/route.ts"),
    read("app/api/v1/series-unlock-all/route.ts"),
    read("lib/server/public-content-visibility.ts"),
    read("app/[...slug]/page.tsx"),
    read("lib/server/chapter-access.ts"),
  ]);
  assert.match(api, /path === "wallet"[\s\S]+requirePaidSystem\(env\.DB, 404\)/u);
  assert.match(api, /path === "orders"[\s\S]+requirePaidSystem\(env\.DB, 404\)/u);
  assert.match(api, /path === "orders"[\s\S]+requirePaidSystem\(env\.DB\)[\s\S]+requireFeature\("payments"/u);
  assert.match(api, /path === "unlocks"[\s\S]+requirePaidSystem\(env\.DB\)/u);
  assert.match(products, /requirePaidSystem\(env\.DB, 404\)/u);
  assert.match(checkout, /requirePaidSystem\(env\.DB\)[\s\S]+requireFeature\("payments"/u);
  assert.match(billing, /requirePaidSystem\(env\.DB\)/u);
  assert.match(purchases, /requirePaidSystem\(env\.DB\)/u);
  assert.match(discounts, /await requirePaidSystem\(db, 404\)/u);
  assert.match(gifts, /requirePaidSystem\(database\(\), 404\)/u);
  assert.match(bulk, /requirePaidSystem\(env\.DB\)/u);
  assert.match(visibility, /public_paid_system_feature/u);
  assert.doesNotMatch(page.slice(page.indexOf('const chapterWhere'), page.indexOf('return env.DB.prepare')), /publicPaidChapterPredicate/u);
  assert.match(access, /This chapter is currently unavailable\./u);
});

test("Paid/Free labels are suppressed and technical upload validation remains", async () => {
  const [app, profile, upload, technical] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/PublicProfileView.tsx"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("app/api/v1/upload-job-files/route.ts"),
  ]);
  assert.match(app, /function ChapterAccessBadge[\s\S]+if \(!visible\) return null/u);
  assert.match(app, /premiumEconomyPublic \? \(\s*<span className=\{`reader-chapter-access/u);
  assert.match(profile, /const premiumEconomyPublic = runtimeFeatures\.paidSystem/u);
  assert.doesNotMatch(upload, /findPaidChapterReference/u);
  assert.doesNotMatch(upload, /INSERT INTO chapter_access_decisions/u);
  assert.doesNotMatch(upload, /accessAdjustments/u);
  assert.match(upload, /upload_publish_guards/u);
  assert.match(upload, /duplicate/i);
  assert.match(technical, /validateImageFile|sha256|processing_status|page_count/u);
});

test("Feature Flags admin panel labels payments as Paid System", async () => {
  const panel = await read("components/nyascans/admin/SiteCoveragePanel.tsx");
  assert.match(panel, /flag\.key === "payments" \? "Paid System"/u);
  assert.match(panel, /Global kill switch for Store, paid chapters, discounts, wallets, and payment account surfaces\./u);
});
