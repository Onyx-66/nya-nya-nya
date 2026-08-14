import { DatabaseSync } from "node:sqlite";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetPath = process.argv[2];
if (!targetPath) throw new Error("Usage: node scripts/restore-preview-data.mjs <d1-sqlite-path>");

const now = new Date();
const iso = (offsetMinutes = 0) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString().replace("T", " ").replace("Z", "");
const date = (offsetDays = 0) => new Date(now.getTime() + offsetDays * 86_400_000).toISOString().replace("T", " ").replace("Z", "");
const slug = (value) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const b64url = (value) => Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const passwordDigest = (password) => {
  const salt = randomBytes(16);
  return {
    algorithm: "PBKDF2-SHA256",
    iterations: 600_000,
    salt: b64url(salt),
    passwordHash: b64url(pbkdf2Sync(password, salt, 600_000, 32, "sha256")),
  };
};

await mkdir(path.dirname(targetPath), { recursive: true });
await rm(targetPath, { force: true });
const db = new DatabaseSync(targetPath);
db.exec("PRAGMA foreign_keys = ON");
const migrations = (await readdir(path.join(root, "drizzle")))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .sort();
for (const migration of migrations) {
  const sql = await readFile(path.join(root, "drizzle", migration), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

const exec = (sql, ...params) => db.prepare(sql).run(...params);
// This is a local-only test configuration. It makes seeded paid chapters and
// discounts visible in the temporary preview; it does not configure a real payment provider.
const localCommercialSettings = {
  schemaVersion: 2,
  announcement: {
    id: "preview-paid-content",
    enabled: true,
    label: "Preview",
    text: "Temporary test data for paid chapters and live discounts.",
    buttonLabel: "Browse Series",
    destinationUrl: "/browse",
    startsAt: null,
    endsAt: null,
    resetKey: 1,
  },
  economy: {
    coinName: "Paw Coin",
    coinPlural: "Paw Coins",
    coinIcon: "🐾",
    coinIconKey: null,
    coinIconRevision: 1,
    premiumEconomyPublic: true,
    defaultChapterPrice: 30,
    defaultSeriesPrice: 300,
    permanentChapterUnlocks: true,
    temporaryChapterUnlockHours: 72,
    seriesUnlocksEnabled: false,
    membershipDiscountsEnabled: true,
    packages: [],
    memberships: [],
  },
};
exec(`UPDATE feature_flags SET enabled = 1 WHERE key IN ('payments', 'premium_unlocks')`);
exec(
  `INSERT INTO commercial_settings (id, schema_version, settings_json, revision)
   VALUES ('active', 2, ?, 1)
   ON CONFLICT(id) DO UPDATE SET
     schema_version = 2,
     settings_json = excluded.settings_json,
     revision = CASE WHEN commercial_settings.revision < 1 THEN 1 ELSE commercial_settings.revision + 1 END,
     updated_at = CURRENT_TIMESTAMP`,
  JSON.stringify(localCommercialSettings),
);

const previewAccounts = [
  {
    id: "test-owner",
    email: "owner.preview@nyascans.test",
    name: "Preview Owner",
    role: "OWNER",
    username: "preview-owner",
    password: "NyaOwner!2026#Test",
    bio: "Owner account for the populated NyaScans test environment.",
  },
  {
    id: "test-administrator",
    email: "admin.preview@nyascans.test",
    name: "Preview Administrator",
    role: "ADMINISTRATOR",
    username: "preview-administrator",
    password: "NyaAdmin!2026#Test",
    bio: "Administrator account for local preview workflow testing.",
  },
  {
    id: "test-manager",
    email: "manager.preview@nyascans.test",
    name: "Preview Manager",
    role: "MANAGER",
    username: "preview-manager",
    password: "NyaManager!2026#Test",
    bio: "Manager account for local preview capability testing.",
  },
];
for (const account of previewAccounts) {
  const digest = passwordDigest(account.password);
  exec(
    `INSERT INTO users (id, email, display_name, primary_role, status, email_verified_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`,
    account.id, account.email, account.name, account.role,
  );
  exec(
    `INSERT INTO user_password_credentials (user_id, algorithm, iterations, salt, password_hash)
     VALUES (?, ?, ?, ?, ?)`,
    account.id, digest.algorithm, digest.iterations, digest.salt, digest.passwordHash,
  );
  exec(`INSERT INTO user_roles (user_id, role, assigned_by_user_id) VALUES (?, ?, ?)`, account.id, account.role, "test-owner");
  exec(
    `INSERT INTO user_profiles (user_id, username, normalized_username, bio, preferred_language)
     VALUES (?, ?, ?, ?, 'en')`,
    account.id, account.username, account.username, account.bio,
  );
}
const owner = previewAccounts[0];
const manager = previewAccounts[2];

const readers = [
  ["reader-amber", "Amber Vale", "amber.vale@nyascans.test"],
  ["reader-kai", "Kai Nocturne", "kai.nocturne@nyascans.test"],
  ["reader-lin", "Lin Wren", "lin.wren@nyascans.test"],
  ["reader-mira", "Mira Sol", "mira.sol@nyascans.test"],
  ["reader-oro", "Oro Finch", "oro.finch@nyascans.test"],
  ["reader-rin", "Rin Aster", "rin.aster@nyascans.test"],
  ["reader-sora", "Sora Miel", "sora.miel@nyascans.test"],
  ["reader-tavi", "Tavi June", "tavi.june@nyascans.test"],
];
for (const [id, name, email] of readers) {
  exec(`INSERT INTO users (id, email, display_name, primary_role, status, email_verified_at) VALUES (?, ?, ?, 'USER', 'ACTIVE', CURRENT_TIMESTAMP)`, id, email, name);
  exec(`INSERT INTO user_roles (user_id, role, assigned_by_user_id) VALUES (?, 'USER', ?)`, id, owner.id);
  exec(`INSERT INTO user_profiles (user_id, username, normalized_username, bio, preferred_language) VALUES (?, ?, ?, ?, 'en')`, id, slug(name), slug(name), `Reader profile for ${name}.`);
}

const teams = [
  ["team-onyx", "onyx-archive", "Onyx Archive", "A verified testing team focused on polished reader releases.", "/art/seed/cover-1.jpg", "/art/mangadex-preview/team-banner-00.jpg"],
  ["team-starlit", "starlit-forge", "Starlit Forge", "A verified team with weekly discovery releases.", "/art/seed/cover-2.png", "/art/mangadex-preview/team-banner-01.jpg"],
  ["team-blue", "blue-lantern", "Blue Lantern", "An active test publishing team for paid and free chapter checks.", "/art/seed/cover-3.jpg", "/art/mangadex-preview/team-banner-02.jpg"],
  ["team-kite", "kiteworks", "Kiteworks", "Community translators and release coordinators.", "/art/seed/cover-4.jpg", "/art/mangadex-preview/team-banner-03.jpg"],
  ["team-ember", "ember-circle", "Ember Circle", "A testing group for cross-device reader validation.", "/art/seed/cover-5.jpg", "/art/mangadex-preview/team-banner-04.jpg"],
];
for (const [teamIndex, [id, teamSlug, name, description, logoKey, bannerKey]] of teams.entries()) {
  exec(
    `INSERT INTO teams (id, slug, name, created_by_user_id, description, logo_key, banner_key, verification_status, is_archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'VERIFIED', 0)`,
    id, teamSlug, name, owner.id, description, logoKey, bannerKey,
  );
  exec(`INSERT INTO team_memberships (team_id, user_id, membership_role, status, is_primary, can_request_series) VALUES (?, ?, 'OWNER', 'ACTIVE', ?, 1)`, id, owner.id, teamIndex === 0 ? 1 : 0);
}
exec(`INSERT INTO team_memberships (team_id, user_id, membership_role, status, is_primary, can_request_series) VALUES ('team-onyx', ?, 'LEADER', 'ACTIVE', 1, 1)`, manager.id);

const genreNames = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Mystery", "Romance", "School Life", "Sci-Fi", "Slice of Life"];
for (const name of genreNames) {
  exec(`INSERT OR IGNORE INTO genres (id, slug, name, normalized_key) VALUES (?, ?, ?, ?)`, `genre-${slug(name)}`, slug(name), name, slug(name));
  exec(`UPDATE genres SET archived_at = NULL WHERE normalized_key = ?`, slug(name));
}
const genreIdFor = (name) => db.prepare(`SELECT id FROM genres WHERE normalized_key = ? AND archived_at IS NULL LIMIT 1`).get(slug(name))?.id ?? null;

const series = [
  ["ser-solo-leveling", "Solo Leveling", "Na Honjaman Level-Up", "Ten years after gates opened, the weakest hunter discovers a private route to impossible growth.", "MANHWA", "ONGOING", "KR", "ko", 2018, 91, 18240, 43520, 0, ["Action", "Adventure", "Fantasy"], "team-onyx", "/art/seed/cover-1.jpg", "/art/mangadex-preview/team-banner-00.jpg", "32d76d19-8a05-4db0-9fc2-e0b0648fe9d0"],
  ["ser-discarded-mercenary", "The Discarded Mercenary Wants to Live Freely", "捨てられ傭兵は自由気ままに生きたい", "After being framed by the commander he trusted, a mercenary chooses a quieter road and finds a new purpose.", "MANGA", "ONGOING", "JP", "ja", 2026, 86, 11380, 24870, 1, ["Adventure", "Drama", "Fantasy"], "team-starlit", "/art/seed/cover-2.png", "/art/mangadex-preview/team-banner-01.jpg", "9800fcce-b7af-46d7-aefc-b9364ee75b55"],
  ["ser-frieren", "Frieren: Beyond Journey's End", "葬送のフリーレン", "An elven mage retraces a past adventure and discovers what companionship meant after the journey ends.", "MANGA", "ONGOING", "JP", "ja", 2020, 95, 17660, 39240, 0, ["Adventure", "Drama", "Fantasy"], "team-blue", "/art/seed/cover-3.jpg", "/art/mangadex-preview/team-banner-02.jpg", "b0b721ff-c388-4486-aa0f-c2b0bb321512"],
  ["ser-apothecary", "The Apothecary Diaries", "薬屋のひとりごと", "A sharp young apothecary is drawn into palace mysteries where every answer has a hidden cost.", "MANGA", "ONGOING", "JP", "ja", 2017, 89, 14920, 30110, 1, ["Drama", "Mystery", "Romance"], "team-kite", "/art/seed/cover-4.jpg", "/art/mangadex-preview/team-banner-03.jpg", "bcfbd2f3-0b8f-4a3c-8f46-5bf0d2e5fa23"],
  ["ser-dandadan", "Dandadan", "ダンダダン", "A pair of students trade ghost stories for alien conspiracies and end up confronting both.", "MANGA", "ONGOING", "JP", "ja", 2021, 87, 13150, 27840, 0, ["Action", "Comedy", "Sci-Fi"], "team-ember", "/art/seed/cover-5.jpg", "/art/mangadex-preview/team-banner-04.jpg", "d391c8d4-7a30-4d4b-b6a4-4740ad55cf74"],
  ["ser-blue-lock", "Blue Lock", "ブルーロック", "Strikers enter a ruthless development program where individual ambition is the only way forward.", "MANGA", "ONGOING", "JP", "ja", 2018, 84, 10450, 22200, 0, ["Action", "Drama", "School Life"], "team-onyx", "/art/seed/cover-6.jpg", "/art/mangadex-preview/team-banner-05.jpg", "d8f5d4d6-50d8-4f19-9b1c-1e60954fd72d"],
  ["ser-sakamoto-days", "Sakamoto Days", "SAKAMOTO DAYS", "A retired assassin attempts a peaceful life until his former world keeps knocking on the door.", "MANGA", "ONGOING", "JP", "ja", 2020, 83, 9720, 19760, 1, ["Action", "Comedy"], "team-starlit", "/art/seed/cover-7.jpg", "/art/mangadex-preview/team-banner-06.jpg", "f3c2e0a4-9c12-4a87-b9d3-3d91e5f6eb3d"],
  ["ser-fragrant-flower", "The Fragrant Flower Blooms With Dignity", "薫る花は凛と咲く", "Two students from rival schools find an unexpectedly gentle friendship across the divide.", "MANGA", "ONGOING", "JP", "ja", 2021, 90, 11800, 25580, 0, ["Drama", "Romance", "School Life"], "team-blue", "/art/seed/cover-8.jpg", "/art/mangadex-preview/team-banner-07.jpg", "7c2a6f80-2e86-4caf-9e77-8b53d2eb79d3"],
  ["ser-kaiju-8", "Kaiju No. 8", "怪獣8号", "A cleanup worker gains the power of the monsters he has always fought from the sidelines.", "MANGA", "ONGOING", "JP", "ja", 2020, 82, 8950, 18600, 1, ["Action", "Adventure", "Sci-Fi"], "team-kite", "/art/seed/cover-1.jpg", "/art/mangadex-preview/team-banner-00.jpg", "a31c4aa8-7a91-4d2a-9a14-9669ff1a0ee0"],
  ["ser-nagatoro", "Don't Toy With Me, Miss Nagatoro", "イジらないで、長瀞さん", "A quiet upperclassman and an energetic underclassman build an awkward but sincere connection.", "MANGA", "COMPLETED", "JP", "ja", 2017, 80, 7640, 15980, 0, ["Comedy", "Romance", "School Life"], "team-ember", "/art/seed/cover-2.png", "/art/mangadex-preview/team-banner-01.jpg", "fc1149d3-1b90-4848-8cbd-b5704d25c91c"],
];

for (const [id, title, nativeTitle, synopsis, type, status, country, language, year, rating, followers, views, paid, tags, teamId, coverKey, bannerKey, mangaDexId] of series) {
  const seriesSlug = slug(title);
  exec(
    `INSERT INTO series (id, slug, title, native_title, synopsis, type, status, origin_country, original_language, reading_direction, publication_year, access_type, cover_key, banner_key, slider_key, rating_tenths, follower_count, view_count, rights_status, is_published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RIGHT_TO_LEFT', ?, ?, ?, ?, ?, ?, ?, ?, 'TEST_ORIGINAL', 1, ?, ?)`,
    id, seriesSlug, title, nativeTitle, synopsis, type, status, country, language, year, paid ? "PAID" : "FREE", coverKey, bannerKey, coverKey, rating, followers, views, iso(-1440 - Math.floor(Math.random() * 5000)), iso(-20),
  );
  exec(
    `INSERT INTO series_team_assignments (series_id, team_id, can_upload, can_publish, is_primary, assigned_by_user_id, allowed_languages_json, upload_requires_review)
     VALUES (?, ?, 1, 1, 1, ?, '["en"]', 0)`,
    id, teamId, owner.id,
  );
  exec(
    `INSERT INTO series_external_sources (id, series_id, source, external_id, source_url, response_hash, last_imported_by_user_id)
     VALUES (?, ?, 'MANGADEX', ?, ?, 'preview-seed', ?)`,
    `source-${id}`, id, mangaDexId, `https://mangadex.org/title/${mangaDexId}`, owner.id,
  );
  for (const tag of tags) {
    const genreId = genreIdFor(tag);
    if (genreId) exec(`INSERT INTO series_genres (series_id, genre_id) VALUES (?, ?)`, id, genreId);
  }
}

for (let index = 0; index < series.length; index += 1) {
  const seriesId = series[index][0];
  const title = series[index][1];
  const teamId = series[index][14];
  for (let chapter = 1; chapter <= 4; chapter += 1) {
    const paid = chapter === 4 && index % 3 === 1;
    const publishedAt = iso(-(index * 38 + chapter * 11));
    exec(
      `INSERT INTO chapters (id, series_id, team_id, uploader_user_id, slug, chapter_number, title, language, format, state, access_type, price_onyx, page_count, published_at, free_at, release_notes, credits_json, thumbnail_key, visibility, comments_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'en', 'VERTICAL', 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLIC', 1)`,
      `chapter-${index + 1}-${chapter}`, seriesId, teamId, owner.id, `chapter-${chapter}`, String(chapter), `${title} · Chapter ${chapter}`, paid ? "PAID" : "FREE", paid ? 180 : 0, 18 + chapter, publishedAt, paid ? date(5) : null, chapter === 4 ? "A fresh release is ready for testing." : "Back-catalog release for preview testing.", JSON.stringify({ team: teams.find((team) => team[0] === teamId)?.[2] ?? "NyaScans" }), `/art/seed/cover-${(index % 8) + 1}${index % 8 === 1 ? ".png" : ".jpg"}`,
    );
  }
  if (index < 9) {
    exec(`INSERT INTO home_pinned_series (id, series_id, display_order, is_featured, created_by_user_id) VALUES (?, ?, ?, 1, ?)`, `pin-${index + 1}`, seriesId, index, owner.id);
  }
}

for (const [order, seriesIndex] of [0, 1, 2].entries()) {
  const [seriesId, title] = series[seriesIndex];
  exec(
    `INSERT INTO homepage_sliders (id, series_id, title, category_label, short_description, destination_url, image_key, is_active, sort_order, created_by_user_id)
     VALUES (?, ?, ?, 'Featured', ?, ?, ?, 1, ?, ?)`,
    `slider-${order + 1}`, seriesId, title, `Featured MangaDex metadata brought into the temporary preview for visual testing.`, `/series/${slug(title)}`, `/art/mangadex-preview/team-banner-${String(order).padStart(2, "0")}.jpg`, order, owner.id,
  );
  exec(`INSERT INTO editor_picks (id, series_id, category_label, short_description, sort_order, is_published) VALUES (?, ?, ?, ?, ?, 1)`, `pick-${order + 1}`, seriesId, "Editor's Pick", `A richly populated temporary pick for layout, media, and action testing.`, order);
}

for (const [id, seriesIndex, targetType, discountValue, originalPrice, reducedPrice] of [
  ["discount-solo", 0, "CHAPTER", 35, 220, 143],
  ["discount-mercenary", 1, "SERIES", 40, 180, 108],
  ["discount-kaiju", 8, "CHAPTER", 25, 200, 150],
]) {
  const [seriesId] = series[seriesIndex];
  const chapterId = targetType === "CHAPTER" ? `chapter-${seriesIndex + 1}-4` : null;
  exec(
    `INSERT INTO content_discounts (id, target_type, series_id, chapter_id, discount_type, discount_value, original_price, reduced_price, starts_at, ends_at, is_active, created_by_user_id)
     VALUES (?, ?, ?, ?, 'PERCENT', ?, ?, ?, ?, ?, 1, ?)`,
    id, targetType, seriesId, chapterId, discountValue, originalPrice, reducedPrice, date(-1), date(6 + seriesIndex), owner.id,
  );
}

for (let index = 0; index < readers.length; index += 1) {
  const [userId] = readers[index];
  const seriesIndex = index % series.length;
  const reviewId = `review-${index + 1}`;
  exec(`INSERT INTO follows (user_id, series_id, created_at) VALUES (?, ?, ?)`, userId, series[seriesIndex][0], iso(-index * 84));
  exec(`INSERT INTO reading_progress (user_id, chapter_id, page_index, scroll_offset, progress_basis_points, onsite_activity_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, userId, `chapter-${seriesIndex + 1}-4`, 8 + index, 1240 + index * 60, 6500 + index * 250, iso(-index * 15), iso(-index * 15));
  exec(`INSERT INTO reviews (id, user_id, series_id, rating, body, spoiler, moderation_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'VISIBLE', ?, ?)`, reviewId, userId, series[seriesIndex][0], 7 + (index % 4), `A test review for ${series[seriesIndex][1]} used to validate review cards, reactions, text wrapping, and mobile scrolling.`, iso(-index * 240), iso(-index * 240));
  exec(`INSERT INTO comments (id, user_id, chapter_id, body, spoiler, moderation_status, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'VISIBLE', ?, ?)`, `comment-${index + 1}`, userId, `chapter-${seriesIndex + 1}-4`, `This release looks great in the preview. Checking the new reader and discussion layout.`, iso(-index * 30), iso(-index * 30));
  exec(`INSERT INTO discussion_comments (id, user_id, series_slug, chapter_slug, depth, body, spoiler, affiliation_team_id, moderation_status, created_at, updated_at) VALUES (?, ?, ?, 'chapter-4', 0, ?, 0, ?, 'VISIBLE', ?, ?)`, `discussion-${index + 1}`, userId, slug(series[seriesIndex][1]), `Latest discussion on ${series[seriesIndex][1]} for the populated testing preview.`, teams[index % teams.length][0], iso(-index * 24), iso(-index * 24));
  exec(`INSERT INTO analytics_events (id, session_id, visitor_id, event_type, series_slug, chapter_slug, region_code, created_at) VALUES (?, ?, ?, 'SERIES_VIEW', ?, 'chapter-4', 'GB', ?)`, `analytics-${index + 1}`, `session-${index + 1}`, userId, slug(series[seriesIndex][1]), iso(-index * 13));
}
for (let index = 0; index < readers.length; index += 1) {
  const reactor = readers[(index + 2) % readers.length][0];
  exec(`INSERT INTO review_reactions (user_id, review_id, reaction) VALUES (?, ?, 'LIKE')`, reactor, `review-${index + 1}`);
}

exec(`INSERT INTO site_announcements (id, type, title, body, link_label, link_url, is_active, starts_at, ends_at, sort_order, created_by_user_id) VALUES ('preview-announcement', 'NOTICE', 'Preview dataset restored', 'This temporary environment contains seeded MangaDex-referenced metadata, free and paid chapters, live discounts, reviews, teams, and activity for interface testing.', 'Browse series', '/browse', 1, ?, ?, 1, ?)`, date(-1), date(14), owner.id);
exec(`UPDATE home_pinned_series_state SET mutation_marker = 'preview-restore', updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE collection_key = 'pinned-series'`, owner.id);

const counts = {};
for (const table of ["users", "teams", "series", "chapters", "content_discounts", "reviews", "comments", "homepage_sliders", "home_pinned_series"]) {
  counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}
console.log(JSON.stringify({ database: targetPath, counts }, null, 2));
db.close();
