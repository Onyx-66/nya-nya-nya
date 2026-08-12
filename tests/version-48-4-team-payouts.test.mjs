import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);
  const migrations = (await readdir(directory))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    database.exec(
      (await read(`drizzle/${migration}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

test("team payout administration is permissioned, same-origin, and CAS reviewed", async () => {
  const [route, service] = await Promise.all([
    read("app/api/v1/admin/team-payouts/route.ts"),
    read("lib/server/payments/team-payouts.ts"),
  ]);
  assert.match(route, /requireAdminCapability\(actor, "finance\.transactions\.read"\)/u);
  assert.match(route, /requireAdminCapability\(actor, "finance\.balances\.manage"\)/u);
  assert.match(route, /assertSameOrigin\(request\)/u);
  for (const action of ["SET_ACCOUNT", "REQUEST", "APPROVE", "REJECT", "PAY"]) {
    assert.match(route, new RegExp(`literal\\(\"${action}\"\\)`, "u"));
  }
  assert.match(service, /WHERE id = \? AND revision = \? AND status = 'APPROVED'/u);
  assert.match(service, /WHERE id = \? AND revision = \? AND status = 'PROCESSING'/u);
  assert.match(service, /PAYOUT_OWNER_REQUIRED/u);
  assert.match(service, /PAYOUT_INDEPENDENT_REVIEW_REQUIRED/u);
  assert.match(service, /current\.requestedByUserId === actor\.id/u);
  assert.match(service, /auditStatement\(/u);
});

test("team payout transfers fail closed and reconcile into a balanced idempotent ledger", async () => {
  const [stripe, service] = await Promise.all([
    read("lib/server/payments/stripe.ts"),
    read("lib/server/payments/team-payouts.ts"),
  ]);
  for (const variable of [
    "STRIPE_CONNECT_ENABLED",
    "TEAM_PAYOUT_CURRENCY",
    "TEAM_PAYOUT_MINOR_PER_ONYX",
  ]) {
    assert.match(service, new RegExp(variable, "u"));
  }
  assert.match(stripe, /"\/v1\/transfers"/u);
  assert.match(stripe, /"idempotency-key"/u);
  assert.match(stripe, /metadata\[payout_request_id\]/u);
  assert.match(service, /idempotencyKey: `nya-team-payout-\$\{current\.id\}`/u);
  assert.match(service, /'TEAM_PAYOUT', 'TEAM_PAYOUT_REQUEST'/u);
  assert.match(service, /account_type IN \('EARNED', 'SUPPORT'\)/u);
  assert.match(service, /'NYASCANS_TEAM_PAYOUTS', 'ONYX', 'PAYOUT_CLEARING'/u);
  assert.match(service, /SUM\(amount\).*transaction_id = \?\) = 0/su);
  assert.match(service, /PAYOUT_LEDGER_RECONCILIATION_REQUIRED/u);
  assert.doesNotMatch(`${stripe}\n${service}`, /console\.(?:log|debug|info)\(/u);
});

test("payout UI exposes the persisted review lifecycle and safe processing recovery", async () => {
  const operations = await read("components/nyascans/OperationsControlPanel.tsx");
  assert.match(operations, /\/api\/v1\/admin\/team-payouts/u);
  assert.match(operations, /"PENDING".*"APPROVED".*"PROCESSING".*"PAID".*"REJECTED"/u);
  assert.match(operations, /Verify and save account/u);
  assert.match(operations, /Request payout/u);
  assert.match(operations, /Resume safely/u);
  assert.match(operations, /balanced payout ledger entry/u);
});

test("payout migration enforces immutable destinations and reviewed state transitions", async () => {
  const database = await migratedDatabase();
  try {
    database
      .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
      .run("payout-admin", "payout-admin@example.test", "Payout Admin");
    database
      .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
      .run("payout-reviewer", "payout-reviewer@example.test", "Payout Reviewer");
    database
      .prepare(
        `INSERT INTO teams (id, slug, name, verification_status)
         VALUES ('team-paid', 'team-paid', 'Paid Team', 'VERIFIED')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO team_payout_accounts
         (team_id, provider_account_id, updated_by_user_id)
         VALUES ('team-paid', 'acct_fixture123', 'payout-admin')`,
      )
      .run();
    assert.throws(
      () =>
        database
          .prepare("DELETE FROM team_payout_accounts WHERE team_id = 'team-paid'")
          .run(),
      /team_payout_accounts_no_delete/u,
    );

    database
      .prepare(
        `INSERT INTO team_payout_requests
         (id, team_id, requested_by_user_id, amount_onyx, amount_minor,
          currency, reason)
         VALUES ('payout-fixture', 'team-paid', 'payout-admin', 50, 500,
                 'USD', 'Test payout request')`,
      )
      .run();
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE team_payout_requests
                SET status = 'APPROVED', reviewed_by_user_id = 'payout-admin',
                    reviewed_at = CURRENT_TIMESTAMP, revision = 2
              WHERE id = 'payout-fixture' AND revision = 1`,
          )
          .run(),
      /team_payout_requests_reviewer_separation_check/u,
    );
    database
      .prepare(
        `UPDATE team_payout_requests
            SET status = 'APPROVED', reviewed_by_user_id = 'payout-reviewer',
                reviewed_at = CURRENT_TIMESTAMP, revision = 2
          WHERE id = 'payout-fixture' AND revision = 1`,
      )
      .run();
    database
      .prepare(
        `UPDATE team_payout_requests
            SET status = 'PROCESSING', revision = 3
          WHERE id = 'payout-fixture' AND revision = 2`,
      )
      .run();
    database
      .prepare(
        `UPDATE team_payout_requests
            SET provider_transfer_id = 'tr_fixture123', revision = 4
          WHERE id = 'payout-fixture' AND revision = 3`,
      )
      .run();
    database
      .prepare(
        `UPDATE team_payout_requests
            SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, revision = 5
          WHERE id = 'payout-fixture' AND revision = 4`,
      )
      .run();
    assert.equal(
      database
        .prepare("SELECT status FROM team_payout_requests WHERE id = 'payout-fixture'")
        .get().status,
      "PAID",
    );
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE team_payout_requests
                SET status = 'REJECTED', paid_at = NULL, revision = 6
              WHERE id = 'payout-fixture'`,
          )
          .run(),
      /team_payout_requests_invalid_transition|CHECK constraint failed/u,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
