import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("paid economy guard distinguishes hidden settings from a public revision race", async () => {
  const server = await read("lib/server/commercial-settings.ts");

  assert.match(server, /export function paidEconomyRevisionGuardSql/u);
  assert.match(server, /live_commercial\.revision = \$\{expectedRevision\}/u);
  assert.match(server, /json_valid\(live_commercial\.settings_json\)/u);
  assert.match(server, /premiumEconomyPublic[\s\S]+='true'|premiumEconomyPublic[\s\S]+= 'true'/u);
  assert.match(
    server,
    /requirePaidEconomyPublicDocument[\s\S]+PAID_ECONOMY_HIDDEN/u,
  );
  assert.match(
    server,
    /assertPaidEconomyRevisionFresh[\s\S]+COMMERCIAL_SETTINGS_CHANGED/u,
  );

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE commercial_settings (
      id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL,
      revision INTEGER NOT NULL
    );
  `);
  const guard = (revision) =>
    database
      .prepare(`
        SELECT EXISTS (
          SELECT 1
            FROM commercial_settings live_commercial
           WHERE live_commercial.id = 'active'
             AND live_commercial.revision = ?
             AND json_valid(live_commercial.settings_json)
             AND json_type(
                   CASE
                     WHEN json_valid(live_commercial.settings_json)
                       THEN live_commercial.settings_json
                     ELSE '{}'
                   END,
                   '$.economy.premiumEconomyPublic'
                 ) = 'true'
        ) AS allowed
      `)
      .get(revision).allowed;

  database
    .prepare(
      "INSERT INTO commercial_settings VALUES ('active', ?, 7)",
    )
    .run(JSON.stringify({ economy: { premiumEconomyPublic: true } }));
  assert.equal(guard(7), 1);

  database
    .prepare("UPDATE commercial_settings SET revision = 8")
    .run();
  assert.equal(guard(7), 0, "a still-public revision change must fail the pin");

  database
    .prepare("UPDATE commercial_settings SET settings_json = ?")
    .run(JSON.stringify({ economy: { premiumEconomyPublic: false } }));
  assert.equal(guard(8), 0, "a hidden economy must fail the pin");

  database
    .prepare("UPDATE commercial_settings SET settings_json = '{'")
    .run();
  assert.equal(guard(8), 0, "invalid JSON must fail closed without SQL errors");

  database.prepare("DELETE FROM commercial_settings").run();
  assert.equal(guard(8), 0, "a missing row must fail closed");
});

test("chapter publication, management, unlock, and ONYX purchases pin the live revision", async () => {
  const [catchAll, chapterManagement, storePurchases] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/chapter-management/route.ts"),
    read("app/api/v1/store/purchases/route.ts"),
  ]);

  const review = catchAll.slice(
    catchAll.indexOf('if (path === "workspace/review")'),
    catchAll.indexOf('if (path === "workspace/settings")'),
  );
  assert.match(review, /c\.access_type AS accessType/u);
  assert.match(
    review,
    /payload\.action === "PUBLISH" && chapter\.accessType === "PAID"[\s\S]+requirePaidEconomyPublicDocument/u,
  );
  assert.ok(
    review.match(/paidEconomyRevisionGuardSql\(paidEconomyRevision\)/gu)
      ?.length >= 2,
    "normal and replacement publication must both carry the SQL pin",
  );
  assert.ok(
    review.match(/assertPaidEconomyRevisionFresh\(paidEconomyRevision\)/gu)
      ?.length >= 4,
    "both publication paths must diagnose hidden vs changed settings",
  );

  const putStart = catchAll.indexOf("export async function PUT");
  const catchAllManagementStart = catchAll.indexOf(
    'if (path === "admin/chapters")',
    putStart,
  );
  const catchAllManagement = catchAll.slice(
    catchAllManagementStart,
    catchAll.indexOf('if (path === "admin/teams")', catchAllManagementStart),
  );
  assert.match(
    catchAllManagement,
    /payload\.accessType === "PAID"[\s\S]+requirePaidEconomyPublicDocument/u,
  );
  assert.ok(
    catchAllManagement.match(
      /paidEconomyRevisionGuardSql\(paidEconomyRevision\)/gu,
    )?.length >= 2,
    "page order and chapter update must share the paid pin",
  );
  assert.match(
    catchAllManagement,
    /assertPaidEconomyRevisionFresh\(paidEconomyRevision\)/u,
  );

  assert.match(
    chapterManagement,
    /payload\.accessType === "PAID"[\s\S]+requirePaidEconomyPublicDocument/u,
  );
  assert.ok(
    chapterManagement.match(
      /paidEconomyRevisionGuardSql\(paidEconomyRevision\)/gu,
    )?.length >= 2,
  );
  assert.match(
    chapterManagement,
    /assertPaidEconomyRevisionFresh\(paidEconomyRevision\)/u,
  );

  const postStart = catchAll.indexOf("export async function POST");
  const unlockStart = catchAll.indexOf('if (path === "unlocks")', postStart);
  const unlock = catchAll.slice(
    unlockStart,
    catchAll.indexOf('if (path === "uploads")', unlockStart),
  );
  assert.match(unlock, /requirePaidEconomyPublicDocument/u);
  assert.ok(
    unlock.match(/paidEconomyRevisionGuardSql\(paidEconomyRevision\)/gu)
      ?.length >= 2,
    "account creation and the ONYX debit transaction must share the pin",
  );
  assert.match(
    unlock,
    /refreshedAccess\.canRead[\s\S]+assertPaidEconomyRevisionFresh/u,
  );

  assert.match(
    storePurchases,
    /item\.priceCurrency === "ONYX"[\s\S]+requirePaidEconomyPublicDocument/u,
  );
  assert.match(
    storePurchases,
    /paidEconomyRevision === null[\s\S]+1 = 1[\s\S]+paidEconomyRevisionGuardSql/u,
  );
  assert.match(
    storePurchases,
    /if \(!ownership\)[\s\S]+paidEconomyRevision !== null[\s\S]+assertPaidEconomyRevisionFresh/u,
  );
  assert.ok(
    storePurchases.indexOf("existingOwnership") <
      storePurchases.indexOf("requirePaidEconomyPublicDocument()"),
    "an already-committed idempotent purchase remains readable while hidden",
  );
});
