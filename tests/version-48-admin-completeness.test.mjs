import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  effectiveCapabilities,
  ROLES,
} from "../lib/permissions.mjs";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("effective role permissions are derived from the authorization source", () => {
  assert.deepEqual(effectiveCapabilities([ROLES.OWNER]), ["*"]);
  assert.deepEqual(effectiveCapabilities([ROLES.ADMINISTRATOR]), ["admin.*"]);
  const publishing = effectiveCapabilities([
    ROLES.UPLOADER,
    ROLES.TEAM_LEADER,
  ]);
  assert.ok(publishing.includes("upload.create"));
  assert.ok(publishing.includes("team.manage.own"));
  assert.equal(new Set(publishing).size, publishing.length);
});

test("Payouts is a read-only report over canonical receipts and TEAM ledger accounts", async () => {
  const [route, operations, app] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const payoutRoute = route.slice(
    route.indexOf('if (path === "admin/payouts")'),
    route.indexOf('if (path === "admin/user-control")'),
  );
  assert.match(payoutRoute, /requireAdmin\(actor\)/u);
  assert.match(payoutRoute, /chapter_unlock_receipts/u);
  assert.match(payoutRoute, /team_support_receipts/u);
  assert.match(payoutRoute, /currency = 'ONYX'/u);
  assert.match(payoutRoute, /la\.owner_type = 'TEAM'/u);
  assert.match(payoutRoute, /la\.account_type IN \('EARNED', 'SUPPORT'\)/u);
  assert.doesNotMatch(payoutRoute, /account_type = '(?:PENDING|WITHDRAWN)'/u);
  assert.doesNotMatch(payoutRoute, /TEAM_PAYOUT/u);
  assert.match(payoutRoute, /key = 'team_payouts'/u);
  assert.doesNotMatch(payoutRoute, /\b(?:INSERT|UPDATE|DELETE)\b/u);
  assert.match(operations, /function PayoutsPanel/u);
  assert.match(operations, /No payout lifecycle is persisted/u);
  assert.match(operations, /no availability,[\s\S]*pending state, or withdrawal is inferred/u);
  assert.match(operations, /section === "Payouts"/u);
  assert.match(app, /\["Payouts", Coins\]/u);
});

test("balance summaries expose totals and unavailable lifecycle states without overflow", async () => {
  const [route, operations, css] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(route, /la\.account_type = 'AVAILABLE'/u);
  assert.match(route, /pendingOnyx: null/u);
  assert.match(route, /withdrawnOnyx: null/u);
  assert.match(operations, /`Total \$\{coinPlural\}`/u);
  assert.match(operations, /"Pending ledger balances"/u);
  assert.match(operations, /"Withdrawn ledger balances"/u);
  assert.match(operations, /"Not tracked"/u);
  assert.match(css, /\.users-control-metrics > article \{[\s\S]*min-width: 0;[\s\S]*overflow: hidden;/u);
  assert.match(css, /overflow-wrap: anywhere/u);
  assert.match(css, /\.users-control-metrics\.payout-summary-metrics/u);
});

test("Users and Roles returns effective permissions and contextual recent activity", async () => {
  const [route, operations] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  const usersRoute = route.slice(
    route.indexOf('if (path === "admin/users")'),
    route.indexOf('if (path === "admin/payouts")'),
  );
  assert.match(usersRoute, /effectiveCapabilities\(roles\)/u);
  assert.match(usersRoute, /recentActivityByUser/u);
  assert.match(usersRoute, /s\.title AS seriesTitle/u);
  assert.match(usersRoute, /c\.chapter_number AS chapterNumber/u);
  assert.match(operations, /Effective permissions/u);
  assert.match(operations, /Recent activity/u);
  assert.match(operations, /recentAdminActivityLabel/u);
});

test("User Activity joins chapter and series context and renders human-readable copy", async () => {
  const [route, operations] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  const activityQuery = route.slice(
    route.indexOf('} else if (view === "activity")'),
    route.indexOf("} else {", route.indexOf('} else if (view === "activity")')),
  );
  assert.match(activityQuery, /s\.title AS seriesTitle/u);
  assert.match(activityQuery, /c\.chapter_number AS chapterNumber/u);
  assert.match(activityQuery, /JOIN chapters c ON c\.id = rp\.chapter_id/u);
  assert.match(activityQuery, /JOIN series s ON s\.id = c\.series_id/u);
  assert.match(operations, /`Chapter \$\{chapterNumber\} of \$\{seriesTitle\}`/u);
  assert.match(operations, /published \$\{chapterReference\}/u);
});
