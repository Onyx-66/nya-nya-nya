import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    const statements = (await read(`drizzle/${migration}`))
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      database.prepare(statement).run();
    }
  }
  return database;
}

test("Version 43 Latest, responsive reader surfaces, Store, and Roulette expose the requested contracts", async () => {
  const [app, latestApi, roulette, teamView, teamPanel, teamApi, css] =
    await Promise.all([
      read("components/nyascans/NyaScansApp.tsx"),
      read("app/api/v1/[...resource]/route.ts"),
      read("components/nyascans/RouletteView.tsx"),
      read("components/nyascans/PublicTeamView.tsx"),
      read("components/nyascans/TeamDiscussionPanel.tsx"),
      read("app/api/v1/team-discussion/route.ts"),
      read("app/globals.css"),
    ]);

  assert.match(app, /className=\{`latest-read-state\$\{chapter\.isRead/u);
  assert.match(app, /<Eye[\s\S]*chapter\.isRead \? "fill" : "regular"/u);
  assert.match(app, /className="latest-chapter-title-line"/u);
  assert.match(latestApi, /FROM reading_progress rp/u);
  assert.match(latestApi, /rp\.progress_basis_points >= 9200/u);
  assert.match(latestApi, /"cache-control": "private, no-store"/u);
  assert.match(css, /\.latest-chapter-attribution::before/u);
  assert.match(css, /@media \(min-width: 701px\)[\s\S]*\.title-hero-inner \{[\s\S]*align-items: start/u);
  assert.match(css, /\.title-main > \.enhanced-comments \{[\s\S]*max-width: none/u);
  assert.match(css, /\.library-records\.is-compact \.library-record-copy h3 \{[\s\S]*-webkit-line-clamp: 2/u);
  assert.match(css, /\.catalog-summary > div \{[\s\S]*minmax\(0, 1\.45fr\)/u);

  assert.match(roulette, /Ready to claim/u);
  assert.match(roulette, /className="roulette-task-progress-meta"/u);
  assert.match(roulette, /compactSpinTime\(spinItem\.spunAt\)/u);
  const rewardOverride = css.indexOf(
    ".roulette-reward-list ul",
    css.indexOf("Version 43"),
  );
  assert.ok(rewardOverride > css.indexOf("max-height: 184px"));
  assert.match(
    css.slice(rewardOverride, rewardOverride + 220),
    /max-height: none[\s\S]*overflow: visible/u,
  );

  assert.match(app, /Memberships are in preview/u);
  assert.match(app, /Coming soon/u);
  assert.match(css, /\.package-grid \{[\s\S]*repeat\(auto-fit/u);
  assert.match(teamView, /"discussion", "Discussion"/u);
  assert.match(teamView, /Focused languages/u);
  assert.match(teamView, /Group ID/u);
  assert.match(teamView, /<TeamDiscussionPanel/u);
  assert.match(teamPanel, /@series\//u);
  assert.match(teamPanel, /renderMentions/u);
  assert.match(teamPanel, /Load older discussions/u);
  assert.match(teamApi, /root_page AS/u);
  assert.match(teamApi, /IDEMPOTENCY_CONFLICT/u);
  assert.match(teamApi, /s\.rights_status IN/u);
  assert.match(css, /Version 43 · authoritative ranking/u);
  assert.match(roulette, /mutationLock\.current/u);
});

test("Version 43 migration enforces team discussion, immutable vote history, and starter offers", async () => {
  const [migration, packagedMigration] = await Promise.all([
    read("drizzle/0032_volatile_misty_knight.sql"),
    read("dist/.openai/drizzle/0032_volatile_misty_knight.sql"),
  ]);
  assert.equal(
    packagedMigration,
    migration,
    "the deployment artifact must package the exact audited Version 43 migration",
  );
  assert.doesNotMatch(migration, /SELECT CASE/u);
  assert.match(migration, /team_discussion_posts_insert_guard/u);
  assert.match(migration, /discussion_vote_events_immutable_update/u);
  assert.match(migration, /discussion_votes_no_self_insert/u);
  assert.match(migration, /product_v43_nya_plus/u);

  const database = await migratedDatabase();
  try {
    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_v43_a', 'v43-a@example.com', 'V43 A', 'USER', 'ACTIVE'),
        ('usr_v43_b', 'v43-b@example.com', 'V43 B', 'USER', 'ACTIVE');

      INSERT INTO user_profiles
        (user_id, username, normalized_username, profile_visibility)
      VALUES
        ('usr_v43_a', 'v43a', 'v43a', 'PUBLIC'),
        ('usr_v43_b', 'v43b', 'v43b', 'PUBLIC');

      INSERT INTO teams
        (id, slug, name, description, verification_status, is_archived)
      VALUES
        ('team_v43_a', 'team-v43-a', 'Team V43 A', '', 'VERIFIED', 0),
        ('team_v43_b', 'team-v43-b', 'Team V43 B', '', 'VERIFIED', 0);

      INSERT INTO team_discussion_posts
        (id, team_id, user_id, parent_id, depth, body, idempotency_key)
      VALUES
        ('post_v43_root', 'team_v43_a', 'usr_v43_a', NULL, 0,
         'Welcome @v43b', 'post-v43-root-key'),
        ('post_v43_reply', 'team_v43_a', 'usr_v43_b', 'post_v43_root', 1,
         'Thanks', 'post-v43-reply-key');
    `);

    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO team_discussion_posts
             (id, team_id, user_id, parent_id, depth, body, idempotency_key)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            "post_v43_cross_team",
            "team_v43_b",
            "usr_v43_b",
            "post_v43_root",
            "Invalid reply",
            "post-v43-cross-key",
          ),
      /team_discussion_parent_invalid/u,
    );

    database
      .prepare(
        `INSERT OR IGNORE INTO team_discussion_posts
         (id, team_id, user_id, parent_id, depth, body, idempotency_key)
         VALUES (?, ?, ?, NULL, 0, ?, ?)`,
      )
      .run(
        "post_v43_retry",
        "team_v43_a",
        "usr_v43_a",
        "Welcome @v43b",
        "post-v43-root-key",
      );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM team_discussion_posts WHERE idempotency_key = 'post-v43-root-key'",
        )
        .get().count,
      1,
    );

    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO team_discussion_posts
             (id, team_id, user_id, parent_id, depth, body, idempotency_key)
             VALUES (?, ?, ?, NULL, 0, ?, ?)`,
          )
          .run(
            "post_v43_duplicate",
            "team_v43_a",
            "usr_v43_a",
            "Welcome @v43b",
            "post-v43-duplicate-key",
          ),
      /team_discussion_duplicate/u,
    );

    database
      .prepare(
        `INSERT INTO team_discussion_mentions
         (post_id, ordinal, target_type, target_user_id, target_series_id, token)
         VALUES ('post_v43_root', 0, 'USER', 'usr_v43_b', NULL, '@v43b')`,
      )
      .run();
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO team_discussion_mentions
             (post_id, ordinal, target_type, target_user_id,
              target_series_id, token)
             VALUES ('post_v43_root', 1, 'USER', NULL, NULL, '@missing')`,
          )
          .run(),
      /team_discussion_mentions_target_check/u,
    );

    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO team_discussion_votes
             (user_id, post_id, value)
             VALUES ('usr_v43_a', 'post_v43_root', 1)`,
          )
          .run(),
      /discussion_self_vote_forbidden/u,
    );

    database
      .prepare(
        `INSERT INTO team_discussion_votes
         (user_id, post_id, value)
         VALUES ('usr_v43_b', 'post_v43_root', 1)`,
      )
      .run();
    database
      .prepare(
        `UPDATE team_discussion_votes
            SET value = -1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = 'usr_v43_b' AND post_id = 'post_v43_root'`,
      )
      .run();
    database
      .prepare(
        `DELETE FROM team_discussion_votes
          WHERE user_id = 'usr_v43_b' AND post_id = 'post_v43_root'`,
      )
      .run();
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT COUNT(*) AS events, SUM(delta) AS reputation
               FROM discussion_vote_events
              WHERE target_type = 'TEAM'
                AND target_id = 'post_v43_root'`,
          )
          .get(),
      },
      { events: 3, reputation: 0 },
    );

    database
      .prepare(
        `INSERT INTO team_discussion_votes
         (user_id, post_id, value)
         VALUES ('usr_v43_b', 'post_v43_root', 1)`,
      )
      .run();
    database
      .prepare(
        `UPDATE team_discussion_posts
            SET moderation_status = 'DELETED',
                deleted_at = CURRENT_TIMESTAMP,
                body = ''
          WHERE id = 'post_v43_root'`,
      )
      .run();
    database
      .prepare(
        `DELETE FROM team_discussion_votes
          WHERE user_id = 'usr_v43_b' AND post_id = 'post_v43_root'`,
      )
      .run();
    assert.equal(
      database
        .prepare(
          `SELECT SUM(delta) AS reputation
             FROM discussion_vote_events
            WHERE target_type = 'TEAM'
              AND target_id = 'post_v43_root'`,
        )
        .get().reputation,
      0,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `INSERT INTO team_discussion_votes
             (user_id, post_id, value)
             VALUES ('usr_v43_b', 'post_v43_root', 1)`,
          )
          .run(),
      /discussion_vote_target_unavailable/u,
    );
    assert.throws(
      () =>
        database
          .prepare(
            `DELETE FROM discussion_vote_events
              WHERE target_type = 'TEAM' AND target_id = 'post_v43_root'`,
          )
          .run(),
      /discussion_vote_events_immutable/u,
    );

    const offers = database
      .prepare(
        `SELECT id, kind, price_minor AS priceMinor,
                lifecycle_status AS lifecycleStatus,
                promotional_badge AS badge
           FROM products
          WHERE id LIKE 'product_v43_%'
          ORDER BY id`,
      )
      .all();
    assert.equal(offers.length, 5);
    assert.ok(offers.every((offer) => offer.lifecycleStatus === "ACTIVE"));
    assert.equal(
      offers.filter((offer) => offer.kind === "MEMBERSHIP").length,
      2,
    );
    assert.ok(
      database
        .prepare(
          `SELECT theme_key AS themeKey
             FROM products
            WHERE id = 'product_v43_nya_patron'`,
        )
        .get().themeKey === "SUNSET",
    );
    database
      .prepare("DELETE FROM users WHERE id = 'usr_v43_b'")
      .run();
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count
             FROM discussion_vote_events
            WHERE voter_user_id = 'usr_v43_b'
               OR author_user_id = 'usr_v43_b'`,
        )
        .get().count,
      0,
      "account deletion must be able to cascade vote history safely",
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("Version 43 ranking is personalized, period-aware, and excludes unearned adjustments", async () => {
  const [route, view, app] = await Promise.all([
    read("app/api/v1/leaderboard/route.ts"),
    read("components/nyascans/UserLeaderboardView.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  assert.match(route, /z\.enum\(\["weekly", "monthly", "all"\]\)/u);
  assert.match(route, /datetime\('now', 'weekday 0', '-6 days', 'start of day'\)/u);
  assert.match(route, /lt\.kind IN \([\s\S]*'CHAPTER_REWARD'[\s\S]*'ROULETTE_REWARD'/u);
  assert.doesNotMatch(
    route.slice(
      route.indexOf("lt.kind IN"),
      route.indexOf("community_comments"),
    ),
    /ADJUST/u,
  );
  assert.match(route, /FROM discussion_vote_events/u);
  assert.match(route, /top_ranked AS \([\s\S]*LIMIT 100/u);
  assert.match(
    route,
    /SELECT \* FROM ranked WHERE userId = \? AND rank > 100/u,
  );
  assert.match(route, /raw_votes\.reputation/u);
  assert.match(route, /profile_visibility = 'PUBLIC'/u);
  assert.match(route, /"cache-control": "private, no-store"/u);
  assert.match(view, /viewer\.rank > 100/u);
  assert.match(view, /user-leaderboard-ellipsis/u);
  assert.match(view, /Weekly/u);
  assert.match(view, /Monthly/u);
  assert.match(view, /All time/u);
  assert.match(app, /<Trophy size=\{18\} \/> Ranking[\s\S]*<Sparkle size=\{18\} \/> Roulette/u);
});
