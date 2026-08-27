import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("admin navigation marks items with children as explicit parents", () => {
  const source = read("components/nyascans/NyaScansApp.tsx");
  const styles = read("app/admin.css");
  assert.match(source, /className=\{item\.children\?\.length \? "ops-nav-parent" : undefined\}/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-nav-group-items > a\.ops-nav-parent[\s\S]*?font-weight: 850/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-nav-group-items > a\.ops-nav-child[\s\S]*?padding-inline-start: 22px !important/);
  assert.match(styles, /\.ops-shell\[data-operations-mode="admin"\] \.ops-nav-group-items > a\.ops-nav-child \.ops-nav-child-marker[\s\S]*?width: \.35rem !important/);
});

test("all audited start/end scheduling editors use the unified datetime range picker", () => {
  const files = [
    "components/nyascans/CommercialSettingsPanel.tsx",
    "components/nyascans/admin/HomePromotionsPanel.tsx",
    "components/nyascans/admin/DiscountsPanel.tsx",
    "components/nyascans/admin/CommerceOfferManager.tsx",
    "components/nyascans/StoreManagementPanel.tsx",
    "components/nyascans/admin/PinnedSeriesPanel.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /PremiumDateRangePicker/);
    assert.doesNotMatch(source, /PremiumDateTimePicker/);
    assert.match(source, /includeTime/);
  }
  const picker = read("components/nyascans/PremiumDateRangePicker.tsx");
  assert.match(picker, /includeTime\?: boolean/);
  assert.match(picker, /premium-range-time-fields/);
  assert.match(picker, /SELECTED RANGE/);
});

test("announcement notices no longer use the beam/conic overlay", () => {
  const styles = read("app/globals.css");
  const themeSurfaces = read("app/theme-surfaces.css");
  const noticeStart = styles.indexOf(".home-announcement-slider > article::after");
  const noticeEnd = styles.indexOf(".home-announcement-slider > article > span:first-child", noticeStart);
  const noticeBlock = styles.slice(noticeStart, noticeEnd);
  assert.match(noticeBlock, /background: radial-gradient/);
  assert.doesNotMatch(noticeBlock, /conic-gradient/);
  assert.doesNotMatch(themeSurfaces, /\.home-announcement-slider > article::after/);
  assert.match(styles, /\.home-announcement-media img[\s\S]*?object-fit: contain/);
  assert.match(styles, /\.home-announcement-stack \.home-announcement-actions[\s\S]*?flex-direction: row !important/);
  assert.match(styles, /\.home-announcement-stack \.home-announcement-secondary-actions[\s\S]*?justify-content: flex-start !important/);
});

test("Pinned and New Series rails do not paint the requested drop shadows", () => {
  const featureStyles = read("components/nyascans/HomeFeatureSections.tsx");
  const globalStyles = read("app/globals.css");
  assert.match(featureStyles, /\.v481-pinned-slide > \.v481-pin-card \{ border-color:transparent; box-shadow:none; \}/);
  assert.match(globalStyles, /\.home-main \.public-new-series \.new-series-card,[\s\S]*?box-shadow: none !important/);
  assert.match(globalStyles, /\.home-main \.public-new-series \.new-series-cover,[\s\S]*?box-shadow: none !important/);
});
