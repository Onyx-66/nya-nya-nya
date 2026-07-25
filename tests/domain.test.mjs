import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCapability,
  can,
  canAccessTeam,
  ROLES,
  sumBalancedEntries,
} from "../lib/permissions.mjs";

test("primary roles are deny by default", () => {
  assert.equal(can(ROLES.USER, "admin.audit.read"), false);
  assert.equal(can(ROLES.UPLOADER, "chapter.publish.assigned"), false);
  assert.equal(can(ROLES.TEAM_LEADER, "chapter.publish.assigned"), true);
  assert.equal(can(ROLES.ADMINISTRATOR, "admin.audit.read"), false);
  assert.equal(can(ROLES.OWNER, "admin.audit.read"), true);
});

test("elevated publishing roles retain reader account capabilities", () => {
  for (const role of [ROLES.TEAM_LEADER, ROLES.UPLOADER]) {
    assert.equal(can(role, "wallet.read.own"), true);
    assert.equal(can(role, "orders.read.own"), true);
    assert.equal(can(role, "library.manage.own"), true);
  }
});

test("every active reader role can join discussions without moderation access", () => {
  for (const role of [ROLES.USER, ROLES.UPLOADER, ROLES.TEAM_LEADER]) {
    assert.equal(can(role, "comment.create"), true);
  }
  assert.equal(can(ROLES.USER, "comments.moderate.own"), false);
  assert.equal(can(ROLES.ADMINISTRATOR, "comments.moderate.own"), true);
});

test("cross-team access is rejected", () => {
  const uploader = {
    primaryRole: ROLES.UPLOADER,
    teamIds: ["team_black_kite"],
  };
  assert.equal(canAccessTeam(uploader, "team_black_kite"), true);
  assert.equal(canAccessTeam(uploader, "team_lumen_house"), false);
});

test("ledger postings must balance", () => {
  const entries = [
    { accountId: "reader", amount: -18 },
    { accountId: "platform", amount: 18 },
  ];
  assert.equal(sumBalancedEntries(entries), 0);
  assert.notEqual(
    sumBalancedEntries([...entries, { accountId: "bad", amount: 1 }]),
    0,
  );
});

test("permission failures are typed", () => {
  assert.throws(
    () => assertCapability(ROLES.USER, "wallet.refund"),
    (error) =>
      error instanceof Error &&
      error.code === "FORBIDDEN" &&
      error.status === 403,
  );
});
