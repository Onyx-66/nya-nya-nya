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
    for (const statement of statements) database.prepare(statement).run();
  }
  return database;
}

test("Version 42 chapter disclosures keep compact identity and honest Paid state", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const titleView = app.slice(
    app.indexOf("function TitleView"),
    app.indexOf("function ReaderPage"),
  );

  assert.doesNotMatch(titleView, /<span>\{group\.number\}<\/span>/u);
  assert.match(titleView, /<strong>[\s\S]*Chapter \{group\.number\}[\s\S]*<\/strong>/u);
  assert.match(
    titleView,
    /group\.releases\.every\([\s\S]*release\.accessType === "PAID" && !release\.canRead/u,
  );
  assert.match(titleView, /className="chapter-compact-lock"/u);
  assert.match(titleView, /: "Paid";/u);
  assert.doesNotMatch(titleView, /"Unavailable"/u);
  assert.match(titleView, /className="chapter-credit-chip"/u);
  assert.match(titleView, /Show all details/u);
  assert.match(titleView, /Hide all details/u);
  assert.match(
    css,
    /\.chapter-release-compact > button \{[\s\S]*grid-template-columns: 50px minmax\(0, 1fr\) auto 20px/u,
  );
  assert.match(
    css,
    /\.chapter-release-compact \.chapter-language-counts \{[\s\S]*grid-column: 3/u,
  );
});

test("Version 42 galleries, flags, title, comments, and branding use the compact responsive contract", async () => {
  const [app, gallery, discovery, panel, configuration, css] =
    await Promise.all([
      read("components/nyascans/NyaScansApp.tsx"),
      read("components/nyascans/SeriesGallerySections.tsx"),
      read("components/nyascans/PublicDiscoverySections.tsx"),
      read("components/nyascans/SiteConfigurationPanel.tsx"),
      read("lib/site-configuration.ts"),
      read("app/globals.css"),
    ]);

  assert.doesNotMatch(gallery, /Inside the pages|Cover archive/u);
  assert.match(gallery, /Sneak Peeks from inside the chapters/u);
  assert.match(gallery, /Other covers for this serie/u);
  assert.match(gallery, /isExpanded \? "is-expanded" : "is-collapsed"/u);
  assert.match(gallery, /series-gallery-mobile-title/u);
  assert.match(
    css,
    /\.series-gallery-section\.is-collapsed \{[\s\S]*height: 162px/u,
  );
  assert.match(
    css,
    /@media \(max-width: 700px\)[\s\S]*\.series-gallery-section\.is-expanded \{[\s\S]*grid-column: 1 \/ -1/u,
  );
  assert.match(
    css,
    /\.series-cover-language-badge \{[\s\S]*border: 0;[\s\S]*background: transparent/u,
  );

  const flagOnlyCalls = app.match(/<SeriesTypeBadge type=\{[^}]+\} flagOnly \/>/gu);
  assert.ok((flagOnlyCalls?.length ?? 0) >= 2);
  assert.match(discovery, /series-type-badge[\s\S]*is-flag-only/u);
  const browseView = app.slice(app.indexOf("function BrowseView"), app.indexOf("function GuestLibraryView"));
  assert.match(browseView, /<SeriesTypeBadge type=\{item\.type\} \/>/u);
  assert.match(browseView, /<SeriesStatusBadge status=\{item\.status\} \/>/u);
  assert.doesNotMatch(
    app.slice(app.indexOf('<section className="title-hero">'), app.indexOf("<nav className=\"series-jump")),
    /title-synopsis|\{item\.synopsis\}/u,
  );
  assert.match(css, /\.enhanced-comments \.comments-refresh \{[\s\S]*height: 46px/u);

  assert.match(app, /slot=compact&v=/u);
  assert.doesNotMatch(app, /slot=compactLogo&v=/u);
  assert.match(app, /className="brand-name"/u);
  assert.match(css, /\.brand\.has-custom-logo \.brand-name \{[\s\S]*display: none/u);
  assert.match(configuration, /logoAlt: z\.string\(\)\.trim\(\)\.max\(160\)\.default\(""\)/u);
  assert.match(panel, /Logo alternative text \(optional\)/u);
  assert.doesNotMatch(
    panel.slice(
      panel.indexOf("Logo alternative text (optional)"),
      panel.indexOf("Short description"),
    ),
    /required/u,
  );
  assert.match(panel, /1:2, 1:1, or 2:1 PNG or WebP/u);
});

test("Version 42 Latest Updates carries language and team for at most four chapters", async () => {
  const [api, app] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);
  const latestApi = api.slice(
    api.indexOf('if (path === "latest-releases")'),
    api.indexOf('if (path === "search")'),
  );
  const latestView = app.slice(
    app.indexOf("function LatestUpdatesGrid"),
    app.indexOf("function LatestUpdatesView"),
  );

  assert.match(latestApi, /t\.slug AS teamSlug/u);
  assert.match(latestApi, /presentation === "table" \? 12 : 4/u);
  assert.match(latestApi, /LIMIT \$\{chapterPresentationLimit\}/u);
  assert.match(latestView, /update\.chapters\.slice\(0, 4\)/u);
  assert.match(latestView, /language=\{chapter\.language\}/u);
  assert.match(latestView, /chapter\.teamSlug/u);
  assert.match(latestView, /Independent release/u);
  assert.match(latestView, /<ChapterAccessBadge/u);
  assert.doesNotMatch(latestView, /premiumEconomyPublic/u);
});

test("Version 42 reconciles and maintains real series counters", async () => {
  const [migration, packagedMigration, api] = await Promise.all([
    read("drizzle/0031_real_metrics.sql"),
    read("dist/.openai/drizzle/0031_real_metrics.sql"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);
  assert.equal(
    packagedMigration,
    migration,
    "the deployment artifact must contain the exact audited metric migration",
  );
  assert.match(migration, /series_real_follow_count_insert_v42/u);
  assert.match(migration, /series_real_view_count_insert_v42/u);
  assert.match(migration, /series_real_rating_update_v42/u);
  assert.match(
    api,
    /COUNT\(DISTINCT CASE[\s\S]*LTRIM\(c\.chapter_number, '0'\)/u,
  );

  const database = await migratedDatabase();
  try {
    const seeded = database
      .prepare(
        `SELECT MAX(follower_count) AS followers,
                MAX(view_count) AS views,
                MAX(rating_tenths) AS rating
           FROM series`,
      )
      .get();
    assert.deepEqual(
      { ...seeded },
      { followers: 0, views: 0, rating: 0 },
      "legacy demonstration counters must reconcile to their empty source tables",
    );

    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_v42', 'v42@example.com', 'Version 42', 'USER', 'ACTIVE');

      INSERT INTO follows (user_id, series_id)
      VALUES ('usr_v42', 'ser_neon_ronin');

      INSERT INTO analytics_events
        (id, session_id, event_type, series_slug)
      VALUES
        ('analytics_v42_series', 'session_v42', 'SERIES_VIEW', 'neon-ronin'),
        ('analytics_v42_home', 'session_v42', 'HOME_VIEW', NULL);

      INSERT INTO reviews
        (id, user_id, series_id, rating, moderation_status)
      VALUES
        ('review_v42', 'usr_v42', 'ser_neon_ronin', 4, 'VISIBLE');
    `);

    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT follower_count AS followers,
                    view_count AS views,
                    rating_tenths AS rating
               FROM series
              WHERE id = 'ser_neon_ronin'`,
          )
          .get(),
      },
      { followers: 1, views: 1, rating: 40 },
    );

    database
      .prepare("UPDATE reviews SET rating = 5 WHERE id = 'review_v42'")
      .run();
    assert.equal(
      database
        .prepare(
          "SELECT rating_tenths AS rating FROM series WHERE id = 'ser_neon_ronin'",
        )
        .get().rating,
      50,
    );

    database
      .prepare(
        "DELETE FROM follows WHERE user_id = 'usr_v42' AND series_id = 'ser_neon_ronin'",
      )
      .run();
    database.prepare("DELETE FROM reviews WHERE id = 'review_v42'").run();
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT follower_count AS followers,
                    view_count AS views,
                    rating_tenths AS rating
               FROM series
              WHERE id = 'ser_neon_ronin'`,
          )
          .get(),
      },
      { followers: 0, views: 1, rating: 0 },
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
