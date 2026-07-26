import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { can, ROLES } from "../lib/permissions.mjs";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function migratedDatabase(beforeMigration) {
  const names = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of names) {
    await beforeMigration?.(database, name);
    database.exec(
      (await read(`drizzle/${name}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return { database, names };
}

test("v1.2 migration normalizes catalogue and administrative entities safely", async () => {
  const { database, names } = await migratedDatabase();
  try {
    assert.ok(names.includes("0012_worried_bill_hollister.sql"));
    const migration = await read("drizzle/0012_worried_bill_hollister.sql");
    assert.match(migration, /PRAGMA defer_foreign_keys=ON/);
    assert.doesNotMatch(migration, /PRAGMA foreign_keys=OFF/);
    for (const table of [
      "creators",
      "publishers",
      "series_aliases",
      "series_external_sources",
      "custom_reactions",
      "discussion_reaction_events",
      "media_cleanup_queue",
      "metadata_import_cache",
      "metadata_import_logs",
    ]) {
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(table).count,
        1,
        `${table} should exist`,
      );
    }
    const genreIndexes = database
      .prepare("PRAGMA index_list('genres')")
      .all()
      .map((entry) => entry.name);
    assert.ok(genreIndexes.includes("genres_normalized_key_uidx"));
    const teamIndexes = database
      .prepare("PRAGMA index_list('series_team_assignments')")
      .all()
      .map((entry) => entry.name);
    assert.ok(teamIndexes.includes("series_team_primary_uidx"));
    const chapterRevision = database
      .prepare("PRAGMA table_info('chapters')")
      .all()
      .find((column) => column.name === "revision");
    assert.equal(chapterRevision?.notnull, 1);
    assert.equal(chapterRevision?.dflt_value, "1");
    const commentRevision = database
      .prepare("PRAGMA table_info('discussion_comments')")
      .all()
      .find((column) => column.name === "revision");
    assert.equal(commentRevision?.notnull, 1);
    assert.equal(commentRevision?.dflt_value, "1");
    const reactionEventIndexes = database
      .prepare("PRAGMA index_list('discussion_reaction_events')")
      .all()
      .map((entry) => entry.name);
    assert.ok(
      reactionEventIndexes.includes(
        "discussion_reaction_events_user_time_idx",
      ),
    );
    const auditIndexes = database
      .prepare("PRAGMA index_list('audit_logs')")
      .all()
      .map((entry) => entry.name);
    assert.ok(auditIndexes.includes("audit_created_idx"));
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("creator normalization preserves ambiguous people and every attribution", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database.exec(`
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('ser_creator_guard', 'creator-guard', 'Creator Guard',
         'A sufficiently detailed synopsis for the creator migration fixture.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'TEST_ORIGINAL', 0);
      INSERT INTO creators (id, name)
      VALUES
        ('creator_guard_a', 'Alex Kim'),
        ('creator_guard_b', 'alex kim');
      INSERT INTO series_creators
        (series_id, creator_id, role, sort_order)
      VALUES
        ('ser_creator_guard', 'creator_guard_a', 'AUTHOR', 0),
        ('ser_creator_guard', 'creator_guard_b', 'AUTHOR', 1);
    `);
  });
  try {
    const creators = database
      .prepare(
        `SELECT id, normalized_name AS normalizedName,
                archived_at AS archivedAt
           FROM creators
          WHERE id LIKE 'creator_guard_%'
          ORDER BY id`,
      )
      .all();
    assert.equal(creators.length, 2);
    assert.equal(creators.every((creator) => creator.archivedAt === null), true);
    assert.equal(
      creators.filter((creator) => creator.normalizedName === "alex kim")
        .length,
      1,
    );
    assert.equal(
      creators.filter((creator) =>
        creator.normalizedName.startsWith("alex kim#review:"),
      ).length,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM series_creators
            WHERE series_id = 'ser_creator_guard'`,
        )
        .get().count,
      2,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE action = 'taxonomy.normalization.review'
              AND target_type = 'CREATOR'
              AND target_id LIKE 'creator_guard_%'`,
        )
        .get().count,
      1,
    );
  } finally {
    database.close();
  }
});

test("v1.2 migration quarantines blank legacy taxonomy and removes blank aliases", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database.exec(`
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('ser_blank_taxonomy', 'blank-taxonomy', 'Blank Taxonomy',
         'A sufficiently detailed synopsis for the blank taxonomy fixture.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'TEST_ORIGINAL', 0);
      UPDATE series
      SET native_title = char(9)
      WHERE id = 'ser_blank_taxonomy';
      INSERT INTO series
        (id, slug, title, native_title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('ser_native_alias_guard', 'native-alias-guard',
         'Native Alias Guard', char(9) || 'Native' || char(13),
         'A sufficiently detailed synopsis for the native alias guard.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'TEST_ORIGINAL', 0);
      INSERT INTO creators (id, name)
      VALUES
        ('creator_blank', ''),
        ('creator_spaces', '   '),
        ('creator_tab', char(9)),
        ('creator_newline', char(10)),
        ('creator_return', char(13));
      INSERT INTO genres (id, slug, name)
      VALUES
        ('genre_blank', 'legacy-blank', ''),
        ('genre_spaces', 'legacy-spaces', '   '),
        ('genre_tab', 'legacy-tab', char(9)),
        ('genre_newline', 'legacy-newline', char(10)),
        ('genre_return', 'legacy-return', char(13));
      INSERT INTO series_aliases (series_id, alias, language)
      VALUES
        ('ser_blank_taxonomy', '', 'ja'),
        ('ser_blank_taxonomy', '   ', 'ja'),
        ('ser_blank_taxonomy', char(9), 'ja'),
        ('ser_blank_taxonomy', char(10), 'ja'),
        ('ser_blank_taxonomy', char(13), 'ja'),
        ('ser_blank_taxonomy', 'Valid alias', 'ja'),
        ('ser_native_alias_guard', 'native', 'ja');
    `);
  });
  try {
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM creators
            WHERE archived_at IS NULL
              AND COALESCE(normalized_name, '') = ''`,
        )
        .get().count,
      0,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM genres
            WHERE archived_at IS NULL
              AND COALESCE(normalized_key, '') = ''`,
        )
        .get().count,
      0,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM series_aliases
            WHERE COALESCE(normalized_alias, '') = ''`,
        )
        .get().count,
      0,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM series_aliases
            WHERE series_id = 'ser_native_alias_guard'
              AND normalized_alias = 'native'`,
        )
        .get().count,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM creators
            WHERE id IN (
              'creator_blank', 'creator_spaces', 'creator_tab',
              'creator_newline', 'creator_return'
            )
              AND archived_at IS NOT NULL
              AND normalized_name LIKE '#review:%'`,
        )
        .get().count,
      5,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM genres
            WHERE id IN (
              'genre_blank', 'genre_spaces', 'genre_tab',
              'genre_newline', 'genre_return'
            )
              AND archived_at IS NOT NULL
              AND normalized_key LIKE '#archived:%'`,
        )
        .get().count,
      5,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE request_id = 'migration-0012'
              AND (
                reason LIKE 'Blank legacy creator%'
                OR reason LIKE 'Blank legacy genre%'
                OR action = 'series.alias.normalization.removed'
              )`,
        )
        .get().count,
      15,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("commercial backfill updates legacy offers without duplicating products or identities", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database
      .prepare(
        `INSERT INTO commercial_settings
         (id, schema_version, settings_json, revision)
         VALUES ('active', 1, ?, 1)`,
      )
      .run(
        JSON.stringify({
          economy: {
            packages: [
              {
                id: "onyx-240",
                name: "Onyx 240",
                description: "Migrated small package",
                baseCoins: 220,
                bonusCoins: 20,
                priceMinor: 399,
                billingCurrency: "USD",
                active: true,
              },
              {
                id: "onyx-720",
                name: "Onyx 720",
                description: "Migrated regular package",
                baseCoins: 620,
                bonusCoins: 100,
                priceMinor: 999,
                billingCurrency: "USD",
                active: true,
              },
              {
                id: "onyx-1600",
                name: "Onyx 1,600",
                description: "Migrated large package",
                baseCoins: 1300,
                bonusCoins: 300,
                priceMinor: 1999,
                billingCurrency: "USD",
                active: true,
              },
            ],
            memberships: [
              {
                id: "nya-plus",
                name: "Nya+",
                description: "Migrated monthly membership",
                monthlyPriceMinor: 499,
                billingCurrency: "USD",
                benefits: ["Ad-free reading"],
                active: true,
              },
            ],
          },
        }),
      );
  });
  try {
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM products WHERE kind = 'CURRENCY_PACKAGE' AND active = 1",
        )
        .get().count,
      3,
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM products WHERE kind = 'MEMBERSHIP' AND active = 1",
        )
        .get().count,
      1,
    );
    assert.deepEqual(
      database
        .prepare(
          `SELECT id FROM products
           WHERE kind = 'CURRENCY_PACKAGE'
           ORDER BY id`,
        )
        .all()
        .map((row) => row.id),
      ["onyx_1600", "onyx_240", "onyx_720"],
    );
    assert.equal(
      database
        .prepare(
          "SELECT id FROM products WHERE kind = 'MEMBERSHIP' LIMIT 1",
        )
        .get().id,
      "nya_plus_monthly",
    );
    assert.equal(
      database
        .prepare("SELECT description FROM products WHERE id = 'onyx_240'")
        .get().description,
      "Migrated small package",
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("commercial backfill namespaces only genuine cross-kind legacy ID collisions", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database.exec(`
      INSERT INTO products
        (id, slug, kind, name, description, price_minor,
         billing_currency, onyx_base, onyx_bonus, active, metadata_json)
      VALUES
        ('product_coin_shared', 'unrelated-shared', 'MEMBERSHIP',
         'Unrelated historical product', 'Must never be overwritten.', 777,
         'USD', 0, 0, 1, '{}');
    `);
    database
      .prepare(
        `INSERT INTO commercial_settings
         (id, schema_version, settings_json, revision)
         VALUES ('active', 1, ?, 1)`,
      )
      .run(
        JSON.stringify({
          economy: {
            packages: [
              {
                id: "shared",
                name: "Shared Coin",
                description: "Coin fixture",
                baseCoins: 10,
                bonusCoins: 0,
                priceMinor: 100,
                billingCurrency: "USD",
                active: true,
              },
            ],
            memberships: [
              {
                id: "shared",
                name: "Shared Membership",
                description: "Membership fixture",
                monthlyPriceMinor: 200,
                billingCurrency: "USD",
                benefits: [],
                active: true,
              },
            ],
          },
        }),
      );
  });
  try {
    const migrated = database
      .prepare(
        `SELECT id, slug, kind FROM products
         WHERE name IN ('Shared Coin', 'Shared Membership')
         ORDER BY kind`,
      )
      .all();
    assert.deepEqual(
      migrated.map((row) => [row.slug, row.kind]),
      [
        ["shared", "CURRENCY_PACKAGE"],
        ["membership-shared", "MEMBERSHIP"],
      ],
    );
    assert.equal(new Set(migrated.map((row) => row.id)).size, 2);
    const historical = database
      .prepare(
        `SELECT slug, kind, name, price_minor AS priceMinor
           FROM products WHERE id = 'product_coin_shared'`,
      )
      .get();
    assert.deepEqual(
      { ...historical },
      {
        slug: "unrelated-shared",
        kind: "MEMBERSHIP",
        name: "Unrelated historical product",
        priceMinor: 777,
      },
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("legacy reactions survive migration and malformed settings are reported without aborting", async () => {
  const valid = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database
      .prepare(
        `UPDATE discussion_settings
            SET settings_json = ?
          WHERE id = 'global'`,
      )
      .run(
        JSON.stringify({
          reactions: [
            {
              key: "clap",
              emoji: "👏",
              label: "Applause",
              enabled: true,
            },
            {
              key: "blank",
              label: "Blank legacy reaction",
              enabled: true,
            },
          ],
        }),
      );
  });
  try {
    const reaction = valid.database
      .prepare(
        `SELECT slug, name, emoji_fallback AS emoji, is_active AS active
         FROM custom_reactions WHERE slug = 'clap'`,
      )
      .get();
    assert.deepEqual(
      { ...reaction },
      { slug: "clap", name: "Applause", emoji: "👏", active: 1 },
    );
    assert.equal(
      valid.database
        .prepare(
          `SELECT is_active AS active
             FROM custom_reactions WHERE slug = 'blank'`,
        )
        .get().active,
      0,
    );
    assert.equal(
      valid.database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE action = 'migration.discussion_reaction.deactivated'
              AND target_id = 'blank'`,
        )
        .get().count,
      1,
    );
  } finally {
    valid.database.close();
  }

  const invalid = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database.exec(`
      UPDATE discussion_settings
         SET settings_json = '{invalid'
       WHERE id = 'global';
      INSERT INTO commercial_settings
        (id, schema_version, settings_json, revision)
      VALUES
        ('active', 1, '{invalid', 1);
    `);
  });
  try {
    assert.equal(
      invalid.database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
           WHERE action = 'migration.settings.invalid_json'`,
        )
        .get().count,
      2,
    );
    assert.deepEqual(
      invalid.database.prepare("PRAGMA foreign_key_check").all(),
      [],
    );
  } finally {
    invalid.database.close();
  }
});

test("invalid legacy commercial entries are skipped and audited without aborting", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database
      .prepare(
        `INSERT INTO commercial_settings
         (id, schema_version, settings_json, revision)
         VALUES ('active', 1, ?, 1)`,
      )
      .run(
        JSON.stringify({
          economy: {
            packages: [{ id: "broken-coin" }],
            memberships: [
              {
                id: "broken-membership",
                name: "Broken membership",
                monthlyPriceMinor: -1,
              },
            ],
          },
        }),
      );
  });
  try {
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM products
            WHERE slug IN ('broken-coin', 'broken-membership')`,
        )
        .get().count,
      0,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE action = 'migration.commercial_product.skipped'`,
        )
        .get().count,
      2,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("primitive legacy settings entries are skipped without aborting migration", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database
      .prepare(
        `UPDATE discussion_settings
            SET settings_json = ?
          WHERE id = 'global'`,
      )
      .run(JSON.stringify({ reactions: ["oops", 7, null] }));
    database
      .prepare(
        `INSERT INTO commercial_settings
         (id, schema_version, settings_json, revision)
         VALUES ('active', 1, ?, 1)`,
      )
      .run(
        JSON.stringify({
          economy: {
            packages: ["oops", 7, null],
            memberships: ["bad"],
          },
        }),
      );
  });
  try {
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE action = 'migration.commercial_product.skipped'`,
        )
        .get().count,
      4,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE action = 'migration.discussion_reaction.skipped'`,
        )
        .get().count,
      3,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("duplicate legacy offer IDs are deduplicated and audited", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database
      .prepare(
        `INSERT INTO commercial_settings
         (id, schema_version, settings_json, revision)
         VALUES ('active', 1, ?, 1)`,
      )
      .run(
        JSON.stringify({
          economy: {
            packages: [
              {
                id: "duplicate-coin",
                name: "Coin First",
                baseCoins: 10,
                priceMinor: 100,
              },
              {
                id: "duplicate-coin",
                name: "Coin Second",
                baseCoins: 20,
                priceMinor: 200,
              },
            ],
            memberships: [
              {
                id: "duplicate-membership",
                name: "Membership First",
                monthlyPriceMinor: 300,
                benefits: "not-an-array",
              },
              {
                id: "duplicate-membership",
                name: "Membership Second",
                monthlyPriceMinor: 400,
              },
            ],
          },
        }),
      );
  });
  try {
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM products
            WHERE slug IN ('duplicate-coin', 'duplicate-membership')`,
        )
        .get().count,
      2,
    );
    assert.equal(
      database
        .prepare(
          `SELECT benefits_json AS benefits
             FROM products
            WHERE slug = 'duplicate-membership'`,
        )
        .get().benefits,
      "[]",
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE action = 'migration.commercial_product.normalized'`,
        )
        .get().count,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_logs
            WHERE action = 'migration.commercial_product.skipped'`,
        )
        .get().count,
      2,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("v1.2 migration preserves and canonicalizes legacy country, language, aliases, and genres", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database.exec(`
      INSERT INTO series
        (id, slug, title, native_title, synopsis, type, status,
         origin_country, original_language, reading_direction, age_rating,
         access_type, rights_status, is_published)
      VALUES
        ('ser_v12_fixture', 'v12-fixture', 'Migration Fixture',
         '  Die   Reise  ', 'A migration fixture with enough synopsis text.',
         'MANGA', 'ONGOING', 'Australia', 'German', 'RIGHT_TO_LEFT',
         'TEEN', 'FREE', 'TEST_ORIGINAL', 0);
      INSERT INTO series_aliases (series_id, alias, language)
      VALUES
        ('ser_v12_fixture', 'Science  Fiction', 'de'),
        ('ser_v12_fixture', 'science fiction', 'de');
      INSERT INTO genres (id, slug, name)
      VALUES
        ('genre_v12_a', 'science-fiction-a', 'Science  Fiction'),
        ('genre_v12_b', 'science-fiction-b', 'science fiction');
      INSERT INTO series_genres (series_id, genre_id)
      VALUES
        ('ser_v12_fixture', 'genre_v12_a'),
        ('ser_v12_fixture', 'genre_v12_b');
    `);
  });
  try {
    const series = database
      .prepare(
        `SELECT origin_country AS country, original_language AS language
         FROM series WHERE id = 'ser_v12_fixture'`,
      )
      .get();
    assert.equal(series.country, "AU");
    assert.equal(series.language, "de");
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM series_aliases
           WHERE series_id = 'ser_v12_fixture'
             AND normalized_alias = 'science fiction'`,
        )
        .get().count,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM genres
           WHERE normalized_key = 'science fiction' AND archived_at IS NULL`,
        )
        .get().count,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM series_genres
           WHERE series_id = 'ser_v12_fixture'`,
        )
        .get().count,
      1,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("v1.2 migration assigns primaries only when legacy intent is unambiguous", async () => {
  const { database } = await migratedDatabase((database, name) => {
    if (name !== "0012_worried_bill_hollister.sql") return;
    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('user_primary_single', 'primary-single@example.test',
         'Primary Single', 'USER', 'ACTIVE'),
        ('user_primary_multiple', 'primary-multiple@example.test',
         'Primary Multiple', 'USER', 'ACTIVE');
      INSERT INTO teams
        (id, slug, name, description, verification_status)
      VALUES
        ('team_primary_a', 'team-primary-a', 'Primary Team A',
         'Primary backfill fixture A.', 'VERIFIED'),
        ('team_primary_b', 'team-primary-b', 'Primary Team B',
         'Primary backfill fixture B.', 'VERIFIED'),
        ('team_primary_c', 'team-primary-c', 'Primary Team C',
         'Primary backfill fixture C.', 'VERIFIED');
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('ser_primary_single', 'primary-single', 'Primary Single',
         'A sufficiently detailed single-assignment migration fixture.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'TEST_ORIGINAL', 0),
        ('ser_primary_multiple', 'primary-multiple', 'Primary Multiple',
         'A sufficiently detailed multiple-assignment migration fixture.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'TEST_ORIGINAL', 0);
      INSERT INTO series_team_assignments
        (series_id, team_id, can_upload, can_publish)
      VALUES
        ('ser_primary_single', 'team_primary_a', 1, 0),
        ('ser_primary_multiple', 'team_primary_a', 1, 0),
        ('ser_primary_multiple', 'team_primary_b', 1, 0);
      INSERT INTO team_memberships
        (team_id, user_id, membership_role, status)
      VALUES
        ('team_primary_a', 'user_primary_single', 'MEMBER', 'ACTIVE'),
        ('team_primary_b', 'user_primary_single', 'MEMBER', 'SUSPENDED'),
        ('team_primary_a', 'user_primary_multiple', 'MEMBER', 'ACTIVE'),
        ('team_primary_b', 'user_primary_multiple', 'MEMBER', 'ACTIVE'),
        ('team_primary_c', 'user_primary_multiple', 'MEMBER', 'SUSPENDED');
    `);
  });
  try {
    assert.equal(
      database
        .prepare(
          `SELECT is_primary AS isPrimary
             FROM series_team_assignments
            WHERE series_id = 'ser_primary_single'`,
        )
        .get().isPrimary,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT SUM(is_primary) AS primaryCount
             FROM series_team_assignments
            WHERE series_id = 'ser_primary_multiple'`,
        )
        .get().primaryCount,
      0,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM audit_logs
            WHERE action = 'series.team.primary.review'
              AND target_id = 'ser_primary_multiple'`,
        )
        .get().count,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT is_primary AS isPrimary
             FROM team_memberships
            WHERE user_id = 'user_primary_single'
              AND status = 'ACTIVE'`,
        )
        .get().isPrimary,
      1,
    );
    assert.equal(
      database
        .prepare(
          `SELECT SUM(is_primary) AS primaryCount
             FROM team_memberships
            WHERE user_id = 'user_primary_multiple'
              AND status = 'ACTIVE'`,
        )
        .get().primaryCount,
      0,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM team_memberships
            WHERE user_id IN (
              'user_primary_single', 'user_primary_multiple'
            )
              AND status = 'SUSPENDED'
              AND is_primary <> 0`,
        )
        .get().count,
      0,
    );
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM audit_logs
            WHERE action = 'team.membership.primary.review'
              AND target_id = 'user_primary_multiple'`,
        )
        .get().count,
      1,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("the database prevents demoting or suspending the final active owner", async () => {
  const { database } = await migratedDatabase();
  try {
    database
      .prepare(
        `INSERT INTO users
         (id, email, display_name, primary_role, status)
         VALUES ('owner_one', 'owner-one@example.test', 'Owner One',
                 'OWNER', 'ACTIVE')`,
      )
      .run();
    assert.throws(
      () =>
        database
          .prepare(
            `UPDATE users SET status = 'SUSPENDED'
             WHERE id = 'owner_one'`,
          )
          .run(),
      /final_active_owner_required/,
    );
    database
      .prepare(
        `INSERT INTO users
         (id, email, display_name, primary_role, status)
         VALUES ('owner_two', 'owner-two@example.test', 'Owner Two',
                 'OWNER', 'ACTIVE')`,
      )
      .run();
    database
      .prepare(
        `UPDATE users SET status = 'SUSPENDED'
         WHERE id = 'owner_one'`,
      )
      .run();
    assert.equal(
      database
        .prepare("SELECT status FROM users WHERE id = 'owner_one'")
        .get().status,
      "SUSPENDED",
    );
  } finally {
    database.close();
  }
});

test("the database rejects assignments to archived or suspended teams atomically", async () => {
  const { database } = await migratedDatabase();
  try {
    database.exec(`
      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('ser_team_guard', 'team-guard', 'Team Guard',
         'A sufficiently detailed synopsis for the assignment guard fixture.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'TEST_ORIGINAL', 0);
      INSERT INTO teams
        (id, slug, name, description, verification_status, is_archived)
      VALUES
        ('team_guard_active', 'team-guard-active', 'Active Team',
         'Active assignment fixture.', 'VERIFIED', 0),
        ('team_guard_archived', 'team-guard-archived', 'Archived Team',
         'Archived assignment fixture.', 'VERIFIED', 1),
        ('team_guard_suspended', 'team-guard-suspended', 'Suspended Team',
         'Suspended assignment fixture.', 'SUSPENDED', 0);
      INSERT INTO series_team_assignments
        (series_id, team_id, can_upload, can_publish)
      VALUES
        ('ser_team_guard', 'team_guard_active', 1, 0);
    `);
    for (const teamId of [
      "team_guard_archived",
      "team_guard_suspended",
    ]) {
      assert.throws(
        () =>
          database
            .prepare(
              `INSERT INTO series_team_assignments
               (series_id, team_id, can_upload, can_publish)
               VALUES ('ser_team_guard', ?, 1, 0)`,
            )
            .run(teamId),
        /series_team_not_active/,
      );
      assert.throws(
        () =>
          database
            .prepare(
              `UPDATE series_team_assignments
                  SET team_id = ?
                WHERE series_id = 'ser_team_guard'
                  AND team_id = 'team_guard_active'`,
            )
            .run(teamId),
        /series_team_not_active/,
      );
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("owner-only audit capability and protected routes agree", async () => {
  const [permissions, auditRoute, page, navigation] = await Promise.all([
    read("lib/permissions.mjs"),
    read("app/api/v1/admin/audit-events/route.ts"),
    read("app/onyx/admin/access/[[...slug]]/page.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  assert.equal(can(ROLES.OWNER, "admin.audit.read"), true);
  assert.equal(can(ROLES.ADMINISTRATOR, "admin.audit.read"), false);
  assert.equal(can(ROLES.MODERATOR, "admin.audit.read"), false);
  assert.match(permissions, /ownerOnlyCapabilities/);
  assert.match(auditRoute, /requireOwner/);
  assert.match(auditRoute, /audit\.access\.denied/);
  assert.match(page, /forbidden\(\)/);
  assert.match(
    navigation,
    /\(actor\.roles \?\? \[actor\.role\]\)\.includes\("OWNER"\)/,
  );
});

test("series, reaction, commerce, and media operations are server protected", async () => {
  const files = await Promise.all([
    read("app/api/v1/admin/series-management/route.ts"),
    read("app/api/v1/admin/team-management/route.ts"),
    read("app/api/v1/admin/reaction-library/route.ts"),
    read("app/api/v1/admin/commerce-offers/route.ts"),
    read("app/api/v1/admin/series-media/route.ts"),
    read("app/api/v1/admin/team-media/route.ts"),
    read("app/api/v1/admin/reaction-media/route.ts"),
    read("app/api/v1/admin/commerce-media/route.ts"),
  ]);
  for (const source of files) {
    assert.match(source, /assertSameOrigin/);
    assert.match(source, /requireAdmin/);
  }
  assert.match(files[0], /STALE_VERSION/);
  assert.match(files[0], /series_team_assignments/);
  assert.match(files[2], /usageCount/);
  assert.match(files[2], /REACTION_SLUG_IMMUTABLE/);
  assert.match(files[2], /REACTION_VISUAL_REQUIRED/);
  assert.match(files[2], /asset_key AS assetKey/);
  assert.doesNotMatch(files[2], /DELETE FROM custom_reactions/);
  assert.match(files[3], /lifecycleStatus/);
  assert.match(files[6], /export async function DELETE/);
  assert.match(files[6], /cr\.is_active AS isActive/);
  assert.match(files[6], /Number\(current\.reactionUsageCount\) > 0/);
  assert.match(files[6], /Number\(current\.gifUsageCount\) > 0/);
  assert.match(files[6], /Deactivate unused reactions or add an emoji fallback/);
});

test("moderation, media lifecycle, and settings saves retain server-side guards", async () => {
  const [api, commerceMedia, storePreview, theme, site, commerce] =
    await Promise.all([
      read("app/api/v1/[...resource]/route.ts"),
      read("app/api/v1/commerce-media/route.ts"),
      read("app/api/v1/store-preview/route.ts"),
      read("lib/server/site-settings.ts"),
      read("lib/server/site-configuration.ts"),
      read("lib/server/commercial-settings.ts"),
    ]);
  assert.match(api, /const seriesOptions = isGlobalModerator\(actor\)/);
  assert.match(api, /return rows\.results\[0\]\?\.id \?\? null/);
  assert.match(commerceMedia, /publicVisible/);
  assert.match(commerceMedia, /order_items/);
  assert.match(storePreview, /startsAt/);
  assert.match(storePreview, /administrator/);
  for (const source of [theme, site, commerce]) {
    assert.match(source, /WHERE id = 'active' AND revision = \?/);
    assert.match(
      source,
      /if \(!(?:mutation\.meta\.changes|results\[0\]\?\.meta\.changes)\)/,
    );
  }
  for (const source of [theme, site, commerce]) {
    assert.match(source, /recoveredFromInvalid: true/);
    assert.match(
      source,
      /catch \{\s*throw new ApiError\([\s\S]+_(?:SETTINGS|CONFIGURATION)_UNAVAILABLE/,
    );
  }
});

test("public APIs expose safe series metadata and isolate Store categories", async () => {
  const [seriesRoute, storeRoute, app] = await Promise.all([
    read("app/api/v1/series-detail/route.ts"),
    read("app/api/v1/store/products/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  for (const field of [
    "alternativeTitles",
    "authors",
    "artists",
    "publisher",
    "countryCode",
    "languageCode",
    "genres",
    "teams",
    "coverUrl",
    "bannerUrl",
  ]) {
    assert.match(seriesRoute, new RegExp(field));
  }
  assert.doesNotMatch(seriesRoute, /responseHash|lastImportedBy/);
  assert.match(
    storeRoute,
    /enum\(\[[\s\S]*"coins"[\s\S]*"memberships"[\s\S]*"gifts"[\s\S]*"banners"[\s\S]*"cosmetics"[\s\S]*"logo-effects"[\s\S]*\]\)/,
  );
  assert.match(app, /store\/gifts/);
  assert.match(app, /store\/logo-effects/);
  assert.match(app, /category=\$\{encodeURIComponent\(selectedCategory\)\}/);
});

test("aggregate chapter and team mutations use revision contracts and conditional audits", async () => {
  const [apiRoute, uploadJobRoute, operations, migration] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("app/api/v1/upload-jobs/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("drizzle/0012_worried_bill_hollister.sql"),
  ]);
  assert.match(migration, /ALTER TABLE `chapters` ADD `revision`/);
  assert.match(apiRoute, /expectedSeriesRevision/);
  assert.match(apiRoute, /series\.team\.assignment\.upsert/);
  assert.match(apiRoute, /WHERE changes\(\) = 1/);
  assert.match(apiRoute, /SET revision = revision \+ 1/);
  assert.match(apiRoute, /PAGE_ORDER_CHANGED/);
  assert.match(uploadJobRoute, /expectedRevision/);
  assert.match(uploadJobRoute, /uj\.revision = \?/);
  assert.match(operations, /expectedSeriesRevision: selectedSeries\.revision/);
  assert.match(operations, /expectedRevision: chapter\.revision/);
  assert.match(apiRoute, /expectedRevision: z\.coerce\.number/);
  assert.match(
    apiRoute,
    /UPDATE discussion_comments[\s\S]+revision = revision \+ 1[\s\S]+WHERE id = \? AND revision = \?/,
  );
  assert.match(operations, /expectedRevision: Number\(record\.revision\)/);
});

test("reaction changes are rate-limited across add, change, and remove actions", async () => {
  const [apiRoute, migration] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("drizzle/0012_worried_bill_hollister.sql"),
  ]);
  assert.match(migration, /CREATE TABLE `discussion_reaction_events`/);
  assert.match(apiRoute, /INSERT INTO discussion_reaction_events/);
  assert.match(apiRoute, /created_at >= datetime\('now', '-1 minute'\)/);
  assert.match(apiRoute, /REACTION_RATE_LIMITED/);
  assert.match(
    apiRoute,
    /existing\?\.reaction === payload\.reaction[\s\S]+reactionAction/,
  );
});

test("public chapter access is resolved with bounded queries and private caching", async () => {
  const [apiRoute, access] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/chapter-access.ts"),
  ]);
  assert.match(access, /export function decideChapterAccess/);
  assert.match(apiRoute, /if \(path === "chapter-access-list"\)/);
  assert.match(apiRoute, /const unlockedIds = new Set<string>\(\)/);
  assert.match(apiRoute, /decideChapterAccess/);
  assert.match(apiRoute, /"cache-control": "private, no-store"/);
});

test("role provisioning, settings, and workspace creation retain atomic authorization", async () => {
  const [policy, settings, discussionPanel, apiRoute, seriesRoute] =
    await Promise.all([
      read("lib/server/policy.ts"),
      read("lib/server/discussion-settings.ts"),
      read("components/nyascans/DiscussionSettingsPanel.tsx"),
      read("app/api/v1/[...resource]/route.ts"),
      read("lib/admin-metadata.ts"),
    ]);
  assert.match(policy, /authorization\.role\.provision/);
  assert.match(policy, /authorization\.role\.promote/);
  assert.match(
    policy,
    /WHERE id = \?[\s\S]+primary_role = \?[\s\S]+status = 'ACTIVE'/,
  );
  assert.match(settings, /expectedRevision/);
  assert.match(settings, /STALE_VERSION/);
  assert.match(discussionPanel, /expectedRevision: revision/);
  assert.match(apiRoute, /workspace\.series\.create/);
  assert.match(apiRoute, /verification_status <> 'SUSPENDED'/);
  assert.match(seriesRoute, /A series can be published only after its rights/);
});

test("archived taxonomy relations cannot leak into new or public records", async () => {
  const [taxonomy, seriesRoute, seriesManagement, metadata] =
    await Promise.all([
    read("app/api/v1/admin/taxonomy/route.ts"),
    read("app/api/v1/series-detail/route.ts"),
    read("app/api/v1/admin/series-management/route.ts"),
    read("lib/admin-metadata.ts"),
  ]);
  assert.match(taxonomy, /ARCHIVED_ENTITY/);
  assert.match(taxonomy, /MERGED_ENTITY/);
  assert.doesNotMatch(taxonomy, /normalized_(?:name|key)\s+LIKE\s+\?/);
  assert.doesNotMatch(
    seriesManagement,
    /normalized_(?:name|key)\s+LIKE\s+\?/,
  );
  assert.match(seriesRoute, /p\.archived_at IS NULL/);
  for (const acronym of ["LGBTQIA", "MMORPG", "VRMMO"]) {
    assert.match(metadata, new RegExp(`"${acronym}"`));
  }
});

test("Unicode-equivalent lookup scans every taxonomy page instead of a fixed prefix", async () => {
  const [{ findNormalizedEquivalent }, { normalizedLookupKey }] =
    await Promise.all([
      import("../lib/server/taxonomy-equivalence.ts"),
      import("../lib/admin-metadata.ts"),
    ]);
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE creators (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT
    );
    BEGIN;
  `);
  const insert = database.prepare(
    `INSERT INTO creators
     (id, name, normalized_name, revision, archived_at)
     VALUES (?, ?, ?, 1, ?)`,
  );
  for (let index = 0; index < 2_100; index += 1) {
    const suffix = String(index).padStart(4, "0");
    insert.run(
      `a_active_${suffix}`,
      `Active filler ${suffix}`,
      `active filler ${suffix}`,
      null,
    );
    insert.run(
      `b_archived_${suffix}`,
      `Archived filler ${suffix}`,
      `archived filler ${suffix}`,
      "2026-01-01T00:00:00Z",
    );
  }
  insert.run(
    "z_active_target",
    "Ｆｕｌｌ\u00a0Width",
    "legacy-active-key",
    null,
  );
  insert.run(
    "z_archived_target",
    "Ａrchived\u00a0Name",
    "legacy-archived-key",
    "2026-01-01T00:00:00Z",
  );
  database.exec("COMMIT");

  const d1 = {
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async all() {
          return { results: database.prepare(sql).all(...bindings) };
        },
      };
    },
  };
  try {
    const active = await findNormalizedEquivalent(
      d1,
      "creators",
      normalizedLookupKey("Full Width"),
      normalizedLookupKey,
      "ACTIVE",
    );
    assert.equal(active?.id, "z_active_target");
    const archived = await findNormalizedEquivalent(
      d1,
      "creators",
      normalizedLookupKey("Archived Name"),
      normalizedLookupKey,
      "ARCHIVED",
    );
    assert.equal(archived?.id, "z_archived_target");
    const excluded = await findNormalizedEquivalent(
      d1,
      "creators",
      normalizedLookupKey("Full Width"),
      normalizedLookupKey,
      "ACTIVE",
      "z_active_target",
    );
    assert.equal(excluded, null);
  } finally {
    database.close();
  }
});

test("GIF frame parsing ignores comma bytes inside extension and image data blocks", async () => {
  const { gifFrameCount } = await import("../lib/gif.ts");
  const commas = Array.from({ length: 121 }, () => 0x2c);
  const header = [
    ...Buffer.from("GIF89a", "ascii"),
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x00,
  ];
  const commentExtension = [0x21, 0xfe, commas.length, ...commas, 0x00];
  const frame = [
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0x02,
    commas.length,
    ...commas,
    0x00,
  ];
  assert.equal(
    gifFrameCount(
      Uint8Array.from([...header, ...commentExtension, ...frame, 0x3b]),
    ),
    1,
  );
  assert.equal(
    gifFrameCount(Uint8Array.from([...header, ...frame, ...frame, 0x3b])),
    2,
  );
});

test("archived team assignment races return a safe recoverable conflict", async () => {
  const api = await read("lib/server/api.ts");
  assert.match(api, /series_team_not_active/);
  assert.match(api, /code: "SERIES_RELATION_CHANGED"/);
  assert.match(
    api,
    /A selected team was archived or suspended\.[\s\S]+status: 409/,
  );
});

test("commerce lifecycle filters use the same scheduled and expired boundaries", async () => {
  const { commerceEffectiveLifecycle } =
    await import("../lib/commerce-lifecycle.ts");
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  assert.equal(
    commerceEffectiveLifecycle(
      {
        lifecycleStatus: "ACTIVE",
        startsAt: null,
        endsAt: "2026-07-24T11:59:59.000Z",
        archivedAt: null,
      },
      now,
    ),
    "EXPIRED",
  );
  assert.equal(
    commerceEffectiveLifecycle(
      {
        lifecycleStatus: "ACTIVE",
        startsAt: "2026-07-24T12:00:01.000Z",
        endsAt: null,
        archivedAt: null,
      },
      now,
    ),
    "SCHEDULED",
  );
  const commerceRoute = await read(
    "app/api/v1/admin/commerce-offers/route.ts",
  );
  assert.match(commerceRoute, /commerceEffectiveLifecycleSql/);
  assert.match(
    commerceRoute,
    /AND \(\? = 'ALL' OR \(\$\{commerceEffectiveLifecycleSql\}\) = \?\)/,
  );
});

test("external source records require canonical HTTPS IDs and matching URLs", async () => {
  const { externalSourceSchema } = await import("../lib/admin-metadata.ts");
  const mangaDexId = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(
    externalSourceSchema.parse({
      source: "MANGADEX",
      externalId: mangaDexId.toUpperCase(),
      sourceUrl: `https://www.mangadex.org/title/${mangaDexId}/fixture`,
    }).sourceUrl,
    `https://mangadex.org/title/${mangaDexId}`,
  );
  assert.equal(
    externalSourceSchema.safeParse({
      source: "MANGADEX",
      externalId: mangaDexId,
      sourceUrl: `http://mangadex.org/title/${mangaDexId}`,
    }).success,
    false,
  );
  assert.equal(
    externalSourceSchema.safeParse({
      source: "MANGADEX",
      externalId: mangaDexId,
      sourceUrl:
        "https://mangadex.org/title/223e4567-e89b-42d3-a456-426614174000",
    }).success,
    false,
  );
  assert.equal(
    externalSourceSchema.parse({
      source: "MANGAUPDATES",
      externalId: "AbC123",
      sourceUrl: "https://www.mangaupdates.com/series/abc123/fixture",
    }).sourceUrl,
    "https://www.mangaupdates.com/series/abc123",
  );
  for (const sourceUrl of [
    "http://www.mangaupdates.com/series/abc123",
    "https://www.mangaupdates.com/series/different",
  ]) {
    assert.equal(
      externalSourceSchema.safeParse({
        source: "MANGAUPDATES",
        externalId: "abc123",
        sourceUrl,
      }).success,
      false,
    );
  }
});

test("migration schema and snapshot agree on every table, column, and index", async () => {
  const [{ database }, journalText] = await Promise.all([
    migratedDatabase(),
    read("drizzle/meta/_journal.json"),
  ]);
  try {
    const journal = JSON.parse(journalText);
    const latestTag = journal.entries.at(-1)?.tag;
    assert.ok(latestTag, "the migration journal must contain a current entry");
    const snapshotText = await read(`drizzle/meta/${latestTag.slice(0, 4)}_snapshot.json`);
    const snapshot = JSON.parse(snapshotText);
    const actualTables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all()
      .map((row) => row.name);
    assert.deepEqual(actualTables, Object.keys(snapshot.tables).sort());
    for (const [tableName, table] of Object.entries(snapshot.tables)) {
      const columns = database
        .prepare(`PRAGMA table_info('${tableName.replaceAll("'", "''")}')`)
        .all()
        .map((column) => column.name)
        .sort();
      assert.deepEqual(
        columns,
        Object.keys(table.columns).sort(),
        `${tableName} columns drifted from the snapshot`,
      );
      const indexes = database
        .prepare(`PRAGMA index_list('${tableName.replaceAll("'", "''")}')`)
        .all()
        .map((index) => index.name)
        .filter((name) => !name.startsWith("sqlite_autoindex_"))
        .sort();
      assert.deepEqual(
        indexes,
        Object.keys(table.indexes).sort(),
        `${tableName} indexes drifted from the snapshot`,
      );
      const actualForeignKeys = database
        .prepare(
          `PRAGMA foreign_key_list('${tableName.replaceAll("'", "''")}')`,
        )
        .all()
        .map((foreignKey) =>
          [
            foreignKey.table,
            foreignKey.from,
            foreignKey.to,
            String(foreignKey.on_update).toLowerCase(),
            String(foreignKey.on_delete).toLowerCase(),
          ].join("|"),
        )
        .sort();
      const expectedForeignKeys = Object.values(
        table.foreignKeys ?? {},
      )
        .flatMap((foreignKey) =>
          foreignKey.columnsFrom.map((from, index) =>
            [
              foreignKey.tableTo,
              from,
              foreignKey.columnsTo[index],
              String(foreignKey.onUpdate ?? "no action").toLowerCase(),
              String(foreignKey.onDelete ?? "no action").toLowerCase(),
            ].join("|"),
          ),
        )
        .sort();
      assert.deepEqual(
        actualForeignKeys,
        expectedForeignKeys,
        `${tableName} foreign keys drifted from the snapshot`,
      );
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
