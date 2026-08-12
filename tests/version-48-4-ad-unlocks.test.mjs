import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = (await fs.readdir(path.join(root, "drizzle")))
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

test("ad reward configuration and callback verification fail closed", async () => {
  const [service, callbackRoute] = await Promise.all([
    read("lib/server/ad-unlocks.ts"),
    read("app/api/v1/ad-unlocks/provider-callback/route.ts"),
  ]);

  for (const name of [
    "AD_REWARD_PROVIDER_URL",
    "AD_REWARD_WEBHOOK_SECRET",
    "AD_UNLOCK_HOURS",
  ]) {
    assert.match(service, new RegExp(name, "u"));
  }
  assert.match(service, /url\.protocol !== "https:"/u);
  assert.match(service, /url\.search/u);
  assert.match(service, /webhookSecret\.length < 32/u);
  assert.match(service, /unlockHours < 1[\s\S]*unlockHours > 168/u);
  assert.match(service, /CALLBACK_TOLERANCE_SECONDS = 5 \* 60/u);
  assert.match(service, /crypto\.subtle\.sign/u);
  assert.match(service, /constantTimeEqual\(expected, supplied\)/u);
  assert.match(service, /`\$\{timestampHeader\}\.\$\{rawBody\}`/u);
  assert.match(callbackRoute, /await request\.text\(\)/u);
  assert.match(callbackRoute, /x-ad-reward-timestamp/u);
  assert.match(callbackRoute, /x-ad-reward-signature/u);
  assert.doesNotMatch(
    `${service}\n${callbackRoute}`,
    /console\.(?:log|info|debug)|AD_REWARD_WEBHOOK_SECRET\s*[:=]\s*["'][^"']{8}/u,
  );
});

test("ad challenge lifecycle is authenticated, same-origin, CAS and idempotent", async () => {
  const [service, route] = await Promise.all([
    read("lib/server/ad-unlocks.ts"),
    read("app/api/v1/ad-unlocks/route.ts"),
  ]);

  assert.match(route, /requireActor\(\)/u);
  assert.match(route, /assertSameOrigin\(request\)/u);
  assert.match(route, /requireFeature\("ad_supported_unlocks"/u);
  assert.match(service, /access\.accessLevel === "PREMIUM"/u);
  assert.match(service, /access\.reason !== "PURCHASE_REQUIRED"/u);
  assert.match(
    service,
    /WHERE id = \? AND status = 'PENDING'[\s\S]*datetime\(expires_at\) > CURRENT_TIMESTAMP/u,
  );
  assert.match(service, /source_type, source_id, expires_at/u);
  assert.match(service, /'AD_REWARD', challenge\.id/u);
  assert.match(service, /ON CONFLICT\(user_id, chapter_id\) DO UPDATE/u);
  assert.match(
    service,
    /WHERE entitlements\.revoked_at IS NOT NULL[\s\S]*datetime\(entitlements\.expires_at\) <= CURRENT_TIMESTAMP/u,
  );
  assert.match(service, /NOT EXISTS \([\s\S]*notifications existing/u);
  assert.match(
    service,
    /SET status = 'CLAIMED'[\s\S]*WHERE id = \? AND user_id = \? AND status = 'VERIFIED'/u,
  );
});

test("ad challenge storage constrains state and provider replay", async () => {
  const database = await migratedDatabase();
  try {
    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ad_unlock_challenges'",
      )
      .get();
    assert.equal(table?.name, "ad_unlock_challenges");

    database
      .prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)")
      .run("ad-user", "ad-user@example.test", "Ad User");
    database
      .prepare(
        `INSERT INTO series
         (id, slug, title, synopsis, type, status, origin_country,
          original_language, reading_direction, age_rating, access_type,
          rights_status, is_published)
         VALUES ('ad-series', 'ad-series', 'Ad Series',
                 'A sufficiently detailed synopsis for ad reward tests.',
                 'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
                 'FREE', 'TEST_ORIGINAL', 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO chapters
         (id, series_id, slug, chapter_number, state, access_type,
          price_onyx, published_at)
         VALUES ('ad-chapter', 'ad-series', 'chapter-1', '1', 'PUBLISHED',
                 'PAID', 10, CURRENT_TIMESTAMP)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO ad_unlock_challenges
         (id, user_id, chapter_id, provider, provider_reference, status, verified_at, expires_at)
         VALUES (?, 'ad-user', 'ad-chapter', 'https://ads.example.test', ?,
                 'VERIFIED', CURRENT_TIMESTAMP, datetime('now', '+15 minutes'))`,
      )
      .run("challenge-one", "provider-reference-one");
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO ad_unlock_challenges
             (id, user_id, chapter_id, provider, provider_reference, status, verified_at, expires_at)
             VALUES (?, 'ad-user', 'ad-chapter', 'https://ads.example.test', ?,
                     'VERIFIED', CURRENT_TIMESTAMP, datetime('now', '+15 minutes'))`,
          )
          .run("challenge-two", "provider-reference-one"),
      /UNIQUE constraint failed/u,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO ad_unlock_challenges
             (id, user_id, chapter_id, provider, status, expires_at)
             VALUES (?, 'ad-user', 'ad-chapter', 'https://ads.example.test',
                     'GRANTED_WITHOUT_VERIFICATION', datetime('now', '+15 minutes'))`,
          )
          .run("challenge-invalid"),
      /CHECK constraint failed/u,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("reader exposes ad unlock only through verified server claim", async () => {
  const reader = await read("components/nyascans/NyaScansApp.tsx");
  assert.match(reader, /Unlock by watching an ad/u);
  assert.match(reader, /action: "CREATE"/u);
  assert.match(reader, /action: "CLAIM"/u);
  assert.match(reader, /Check ad status/u);
  assert.match(reader, /payload\.data\?\.access\?\.canRead/u);
  assert.match(reader, /setReaderContext\(\(current\) =>/u);
  assert.doesNotMatch(
    reader,
    /Unlock by watching an ad[\s\S]{0,250}setReaderContext/u,
  );
});
