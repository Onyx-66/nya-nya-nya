import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

async function read(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

async function tsxFiles(relativePath) {
  const directory = join(root, relativePath);
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

test("shared pickers expose the requested theme-token-driven interaction model", async () => {
  const [dateTime, range, color, primitives, css] = await Promise.all([
    read("components/nyascans/PremiumDateTimePicker.tsx"),
    read("components/nyascans/PremiumDateRangePicker.tsx"),
    read("components/nyascans/PremiumColorPicker.tsx"),
    read("components/nyascans/PremiumPickerPrimitives.tsx"),
    read("app/globals.css"),
  ]);
  for (const token of ["Today", "Now", "Done", "Previous month", "Next month", "MonthYearNavigator"]) {
    assert.match(`${dateTime}\n${primitives}`, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  for (const token of ["Last 7 Days", "This Month", "Clear", "Apply Range", "in-range", "valueFormat"]) {
    assert.match(`${range}\n${primitives}`, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  for (const token of ["Grid", "Spectrum", "RGB", "Opacity", "Copy", "Swatches", "Save current color as swatch", "Done"]) {
    assert.match(color, new RegExp(token, "u"));
  }
  assert.match(`${dateTime}\n${range}\n${color}\n${css}`, /var\(--theme-/u);
  assert.match(css, /prefers-reduced-motion/u);
});

test("active UI source contains no native date, datetime, or color input controls", async () => {
  const files = [...(await tsxFiles("components")), ...(await tsxFiles("app"))];
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/type=["'](?:color|date|datetime-local)["']/u.test(source)) violations.push(file);
  }
  assert.deepEqual(violations, []);
});

test("admin shell has token-driven responsive navigation and real queue badge", async () => {
  const [app, css, navigation] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/admin.css"),
    read("lib/admin-navigation.ts"),
  ]);
for (const token of ["Collapse sidebar", "Expand sidebar", "ops-sidebar-backdrop", "ops-nav-label", "aria-current", "ops-account-menu"]) {
    assert.match(`${app}\\n${css}`, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(navigation, /Publishing Queue/u);
  assert.match(css, /@media\s*\(max-width:\s*1023px\)/u);
  assert.match(css, /var\(--admin-/u);
  assert.match(navigation, /children/u);
});

test("admin console and security API are passkey-only while normal login stays separate", async () => {
  const [policy, page, gate, security, accountSecurity, login, logout, env, scanner] = await Promise.all([
    read("lib/server/policy.ts"),
    read("app/onyx/admin/access/[[...slug]]/page.tsx"),
    read("components/nyascans/admin/AdminPasskeyGate.tsx"),
    read("app/api/v1/security/route.ts"),
    read("lib/server/account-security.ts"),
    read("app/api/v1/auth/login/route.ts"),
    read("app/api/v1/auth/logout/route.ts"),
    read(".env.example"),
    read("scripts/check-secrets.mjs"),
  ]);
  assert.match(policy, /account_passkeys/u);
  assert.match(page, /adminPasskeyRequired && !actor\.adminPasskeyEnrolled/u);
  assert.match(gate, /startRegistration/u);
  assert.match(security, /PASSKEY_REGISTER_BEGIN/u);
  assert.match(security, /PASSKEY_REGISTER_FINISH/u);
  assert.match(accountSecurity, /beginPasskeyRegistration/u);
  assert.doesNotMatch(`${policy}\n${page}\n${gate}\n${security}\n${accountSecurity}\n${login}\n${logout}\n${env}\n${scanner}`, /TOTP|ADMIN_TOTP_ENCRYPTION_KEY|admin_mfa_sessions|admin-mfa/iu);
  assert.match(login, /password|credentials|sign/iu);
  assert.doesNotMatch(logout, /MFA|mfa|TOTP|totp/u);
});
