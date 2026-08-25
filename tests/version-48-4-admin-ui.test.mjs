import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("admin navigation has one typed registry with legacy aliases and duplicate guards", async () => {
  const [navigation, permissions, app] = await Promise.all([
    read("lib/admin-navigation.ts"),
    read("lib/admin-permissions.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  for (const id of [
    "dashboard",
    "catalog",
    "homepage-marketing",
    "publishing-queue",
    "teams",
    "community",
    "monetization",
    "settings",
    "activity",
  ]) {
    assert.equal(navigation.match(new RegExp(`id: "${id}"`, "gu"))?.length, 1);
  }
  assert.match(navigation, /slug: "home"[\s\S]+aliases: \["dashboard", "analytics", "overview", "summary"\]/u);
  assert.match(navigation, /function validateAdminNavigation/u);
  assert.match(navigation, /validateAdminNavigation\(\);/u);
  assert.match(permissions, /export \{ ADMIN_SECTION_CAPABILITIES \} from "@\/lib\/admin-navigation"/u);
  assert.match(app, /adminNavigationGroupsForCapabilities/u);
  assert.match(app, /findAdminNavigationDestination/u);
  assert.doesNotMatch(app, /const allGroups: OperationsNavigationGroup/u);
  assert.equal(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import('./lib/admin-navigation.ts').then((module) => process.stdout.write(String(module.validateAdminNavigation())))",
      ],
      { cwd: root, encoding: "utf8" },
    ),
    "true",
  );
});

test("admin shell provides searchable navigation, command palette, and an off-canvas drawer", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/admin.css"),
  ]);

  assert.match(app, /className="ops-sidebar-search"/u);
  assert.match(app, /nyascans:admin-command-open/u);
  assert.match(app, /className="admin-command-overlay"/u);
  assert.match(app, /className="ops-admin-mobile-bar"/u);
  assert.match(app, /className="ops-sidebar-backdrop"/u);
  assert.match(app, /new MutationObserver\(scheduleEnhancement\)/u);
  assert.match(app, /table\.dataset\.mobileCards = "true"/u);
  assert.match(app, /cell\.dataset\.label = headings\[index\]/u);
  assert.match(app, /nyascans-\$\{mode\}-\$\{adminPreferenceKey\}-nav-groups/u);
  assert.match(app, /href="\/account\?tab=preferences"/u);
  assert.match(css, /grid-template-columns: 260px minmax\(0, 1fr\)/u);
  assert.match(css, /grid-template-columns: 72px minmax\(0, 1fr\)/u);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]+transform: translateX\(-100%\)/u);
  assert.match(css, /\.ops-sidebar\.is-mobile-open[\s\S]+transform: translateX\(0\)/u);
  assert.match(css, /\.ops-admin-navigation-tools[\s\S]+display: none !important/u);
  assert.match(css, /\.ops-release-version,[\s\S]+\.ops-account-menu[\s\S]+display: none !important/u);
  assert.match(css, /opacity: 0[\s\S]+pointer-events: none[\s\S]+visibility: hidden/u);
});

test("admin design tokens and responsive primitives follow the panel specification", async () => {
  const [layout, css, scaffold, operations] = await Promise.all([
    read("app/layout.tsx"),
    read("app/admin.css"),
    read("components/nyascans/admin/AdminPageScaffold.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  assert.ok(layout.indexOf('import "./admin.css"') > layout.indexOf('import "./globals.css"'));
  for (const tokenBridge of [
    "--admin-bg-app: var(--theme-main-background)",
    "--admin-bg-surface: var(--theme-accent)",
    "--admin-bg-card: var(--theme-accent-l1)",
    "--admin-bg-card-hover: var(--theme-accent-l2)",
    "--admin-border-subtle: var(--theme-accent-l3)",
    "--admin-border-strong: var(--theme-accent-l4)",
    "--admin-accent: var(--theme-primary)",
    "--admin-success: var(--theme-status-green)",
    "--admin-warning: var(--theme-status-yellow)",
    "--admin-danger: var(--theme-danger)",
    "--admin-text-primary: var(--theme-text-color)",
    "--admin-text-tertiary: var(--theme-mid-tone)",
  ]) {
    assert.match(css, new RegExp(tokenBridge.replaceAll(/[()]/gu, "\\$&"), "u"));
  }
  assert.match(css, /@media \(max-width: 767px\)/u);
  assert.match(css, /table\[data-mobile-cards="true"\]/u);
  assert.match(css, /\.admin-sticky-actions/u);
  for (const size of ["30px", "20px", "15px", "14px", "12px"]) {
    assert.match(css, new RegExp(`font-size:\\s*${size}`, "u"));
  }
  assert.match(scaffold, /<h1>\{title\}<\/h1>/u);
  assert.match(operations, /className="admin-breadcrumbs"/u);
  assert.match(operations, /<h1>\{title\}<\/h1>/u);
  assert.match(css, /\.control-panel-header/u);
  for (const primitive of ["AdminStatTile", "AdminSectionCard", "AdminStatusBadge", "AdminFormField", "AdminResponsiveData", "AdminStickyActions", "AdminEmptyState"]) {
    assert.match(scaffold, new RegExp(`export function ${primitive}`, "u"));
  }
});

test("administrator MFA uses six accessible inputs with paste and backspace support", async () => {
  const mfa = await read("components/nyascans/admin/AdminMfaGate.tsx");
  assert.match(mfa, /digits\.map\(\(digit, index\)/u);
  assert.match(mfa, /aria-label=\{`Digit \$\{index \+ 1\} of 6`\}/u);
  assert.match(mfa, /function handlePaste/u);
  assert.match(mfa, /event\.key === "Backspace"/u);
  assert.match(mfa, /autoComplete=\{index === 0 \? "one-time-code" : "off"\}/u);
  assert.match(mfa, /One-hour protected session/u);
  assert.doesNotMatch(mfa, /placeholder="000000"/u);
});

test("reader memberships send the selected billing cycle and expose Stripe billing management", async () => {
  const [app, portal] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/payments/billing-portal/route.ts"),
  ]);
  assert.match(app, /billingCycle: "MONTHLY" \| "ANNUAL" = "MONTHLY"/u);
  assert.match(app, /body: JSON\.stringify\(\{[\s\S]+productId,[\s\S]+billingCycle,/u);
  assert.match(app, /billing === "monthly" \? "MONTHLY" : "ANNUAL"/u);
  assert.match(app, /fetch\("\/api\/v1\/payments\/billing-portal"/u);
  assert.match(app, /Manage existing membership/u);
  assert.match(app, /billing\.stripe\.com/u);
  assert.match(portal, /requireActor\(\)/u);
  assert.match(portal, /provider_customer_id AS providerCustomerId/u);
  assert.match(portal, /createStripeBillingPortalSession/u);
});

test("public premium navigation and chapter lists consume effective feature states", async () => {
  const [app, api, commercial, publicVisibility] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/commercial-settings.ts"),
    read("lib/server/public-content-visibility.ts"),
  ]);
  assert.match(api, /paidSystemEnabled = Boolean\([\s\S]+payments\.enabled[\s\S]+premium_unlocks\.effective/u);
  assert.match(api, /paidSystem: paidSystemEnabled/u);
  assert.match(api, /publicPaidChapterPredicate/u);
  assert.match(api, /if \(featureStates\.memberships\.effective\) \{[\s\S]+FROM user_memberships/u);
  assert.match(app, /const lockAndPayVisible = runtimeFeatures\.paidSystem/u);
  assert.doesNotMatch(app, /ownerPreview/u);
  assert.match(publicVisibility, /premium_unlocks/u);
  assert.match(commercial, /key IN \('premium_unlocks', 'payments'\)/u);
  assert.match(commercial, /paid_system_feature\.enabled = 1/u);
});

test("monetization pages remain discoverable while paid mutations fail closed", async () => {
  const [app, gate, navigation, visibility, discounts, commercialHook] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/onyx/admin/access/[[...slug]]/page.tsx"),
    read("lib/admin-navigation.ts"),
    read("lib/server/content-visibility.ts"),
    read("app/api/v1/admin/discounts/route.ts"),
    read("components/nyascans/useCommercialSettings.ts"),
  ]);
  assert.match(navigation, /slug: "discounts"/u);
  assert.match(navigation, /slug: "content-access-control"/u);
  assert.doesNotMatch(app, /paidContentActive/u);
  assert.doesNotMatch(gate, /redirect\("\/onyx\/admin\/access\/commerce"\)/u);
  assert.match(visibility, /states\.payments/u);
  assert.match(discounts, /requirePaidSystem/u);
  assert.match(app, /paidSystemEnabled \? <DiscountsSection enabled \/> : null/u);
  assert.match(commercialHook, /failClosedRuntimeFeatures/u);
});
