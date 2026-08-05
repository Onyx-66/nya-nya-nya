import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = process.cwd();
const require = createRequire(import.meta.url);

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function migrationNames() {
  return (await fs.readdir(path.join(root, "drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of await migrationNames()) {
    database.exec(
      (await read(`drizzle/${name}`)).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return database;
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("V38 fresh schema enforces gallery ratios and immutable team unlock receipts", async () => {
  const database = await migratedDatabase();
  try {
    for (const table of [
      "series_gallery_assets",
      "chapter_unlock_receipts",
    ]) {
      assert.equal(
        database
          .prepare(
            `SELECT COUNT(*) AS count
               FROM sqlite_master
              WHERE type = 'table' AND name = ?`,
          )
          .get(table).count,
        1,
      );
    }

    const galleryForeignKeys = new Set(
      database
        .prepare("PRAGMA foreign_key_list('series_gallery_assets')")
        .all()
        .map((row) => `${row.from}:${row.table}:${row.on_delete}`),
    );
    assert.ok(galleryForeignKeys.has("series_id:series:CASCADE"));
    assert.ok(galleryForeignKeys.has("submitted_by_user_id:users:RESTRICT"));
    assert.ok(galleryForeignKeys.has("submitter_team_id:teams:SET NULL"));

    const receiptForeignKeys = new Set(
      database
        .prepare("PRAGMA foreign_key_list('chapter_unlock_receipts')")
        .all()
        .map((row) => `${row.from}:${row.table}:${row.on_delete}`),
    );
    assert.ok(
      receiptForeignKeys.has(
        "transaction_id:ledger_transactions:NO ACTION",
      ),
    );
    assert.ok(receiptForeignKeys.has("entitlement_id:entitlements:NO ACTION"));
    assert.ok(receiptForeignKeys.has("chapter_id:chapters:RESTRICT"));
    assert.ok(receiptForeignKeys.has("team_id:teams:SET NULL"));

    database.exec(`
      INSERT INTO users
        (id, email, display_name, primary_role, status)
      VALUES
        ('usr_v38', 'v38@example.com', 'V38 reader', 'UPLOADER', 'ACTIVE');

      INSERT INTO teams
        (id, slug, name, description, verification_status, is_archived)
      VALUES
        ('team_v38', 'team-v38', 'Team V38', '', 'VERIFIED', 0);

      INSERT INTO series
        (id, slug, title, synopsis, type, status, origin_country,
         original_language, reading_direction, age_rating, access_type,
         rights_status, is_published)
      VALUES
        ('series_v38', 'series-v38', 'Series V38',
         'A complete synopsis for the Version 38 regression fixture.',
         'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN',
         'FREE', 'AUTHORIZED', 1);

      INSERT INTO chapters
        (id, series_id, team_id, uploader_user_id, slug, chapter_number,
         title, language, state, access_type, price_onyx, published_at)
      VALUES
        ('chapter_v38', 'series_v38', 'team_v38', 'usr_v38',
         'chapter-v38', '1', 'Team translation', 'en', 'PUBLISHED',
         'PAID', 35, CURRENT_TIMESTAMP);

      INSERT INTO ledger_accounts
        (id, owner_type, owner_id, currency, account_type)
      VALUES
        ('la_usr_v38_wallet', 'USER', 'usr_v38', 'ONYX', 'WALLET'),
        ('la_team_team_v38_earned_onyx', 'TEAM', 'team_v38', 'ONYX',
         'EARNED');

      INSERT INTO ledger_transactions
        (id, kind, reference_type, reference_id, idempotency_key, memo)
      VALUES
        ('tx_v38', 'CHAPTER_UNLOCK', 'CHAPTER', 'chapter_v38',
         'usr_v38:unlock-v38', 'Team-attributed unlock');

      INSERT INTO ledger_entries
        (id, transaction_id, account_id, amount)
      VALUES
        ('entry_v38_debit', 'tx_v38', 'la_usr_v38_wallet', -35),
        ('entry_v38_credit', 'tx_v38',
         'la_team_team_v38_earned_onyx', 35);

      INSERT INTO entitlements
        (id, user_id, chapter_id, source_type, source_id)
      VALUES
        ('entitlement_v38', 'usr_v38', 'chapter_v38', 'ONYX_UNLOCK',
         'tx_v38');

      INSERT INTO chapter_unlock_receipts
        (id, transaction_id, entitlement_id, buyer_user_id, chapter_id,
         team_id, amount, currency)
      VALUES
        ('receipt_v38', 'tx_v38', 'entitlement_v38', 'usr_v38',
         'chapter_v38', 'team_v38', 35, 'ONYX');

      INSERT INTO series_gallery_assets
        (id, series_id, kind, object_key, content_type, width, height,
         byte_size, orientation, submitted_by_user_id, submitter_team_id,
         moderation_status, language, cover_type)
      VALUES
        ('art_v38', 'series_v38', 'ART', 'series-gallery/art-v38.webp',
         'image/webp', 1600, 900, 4096, 'LANDSCAPE', 'usr_v38',
         'team_v38', 'APPROVED', NULL, NULL),
        ('cover_v38', 'series_v38', 'COVER',
         'series-gallery/cover-v38.webp', 'image/webp', 1000, 1500, 4096,
         'PORTRAIT', 'usr_v38', 'team_v38', 'PENDING', 'en', 'OFFICIAL');
    `);

    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT transaction_id AS transactionId,
                    entitlement_id AS entitlementId,
                    team_id AS teamId,
                    amount
               FROM chapter_unlock_receipts
              WHERE id = 'receipt_v38'`,
          )
          .get(),
      },
      {
        transactionId: "tx_v38",
        entitlementId: "entitlement_v38",
        teamId: "team_v38",
        amount: 35,
      },
    );

    assert.throws(
      () =>
        database.exec(`
          INSERT INTO series_gallery_assets
            (id, series_id, kind, object_key, content_type, width, height,
             byte_size, orientation, submitted_by_user_id)
          VALUES
            ('bad_ratio_v38', 'series_v38', 'ART', 'bad-ratio.webp',
             'image/webp', 1600, 901, 1024, 'LANDSCAPE', 'usr_v38')
        `),
      /CHECK constraint failed/u,
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO series_gallery_assets
            (id, series_id, kind, object_key, content_type, width, height,
             byte_size, orientation, submitted_by_user_id, language,
             cover_type)
          VALUES
            ('bad_fk_v38', 'missing_series', 'COVER', 'bad-fk.webp',
             'image/webp', 1000, 1500, 1024, 'PORTRAIT', 'usr_v38',
             'en', 'OFFICIAL')
        `),
      /FOREIGN KEY constraint failed/u,
    );
    assert.throws(
      () =>
        database.exec(`
          INSERT INTO chapter_unlock_receipts
            (id, transaction_id, entitlement_id, buyer_user_id, chapter_id,
             team_id, amount)
          VALUES
            ('bad_amount_v38', 'tx_v38', 'entitlement_v38', 'usr_v38',
             'chapter_v38', 'team_v38', 0)
        `),
      /CHECK constraint failed/u,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("V38 upload authorization is based on exact VERIFIED membership, never a series assignment", async () => {
  const [policy, scopeSource, jobsRoute, filesRoute, thumbnailRoute, management] =
    await Promise.all([
      read("lib/server/policy.ts"),
      read("lib/server/upload-jobs.ts"),
      read("app/api/v1/upload-jobs/route.ts"),
      read("app/api/v1/upload-job-files/route.ts"),
      read("app/api/v1/upload-job-thumbnail/route.ts"),
      read("lib/server/chapter-management.ts"),
    ]);

  const actorUploadTeams = sourceBetween(
    policy,
    "const uploadTeamIds =",
    "return {",
  );
  assert.match(
    actorUploadTeams,
    /membership\.verification_status === "VERIFIED"/u,
  );
  assert.match(actorUploadTeams, /"UPLOADER"/u);

  const uploadScope = sourceBetween(
    scopeSource,
    "export async function requireUploadScope",
    "export function requireUploadCapability",
  );
  assert.match(uploadScope, /FROM team_memberships tm/u);
  assert.match(uploadScope, /t\.verification_status = 'VERIFIED'/u);
  assert.match(
    uploadScope,
    /\('OWNER', 'LEADER', 'UPLOADER'\)/u,
  );
  assert.doesNotMatch(uploadScope, /series_team_assignments/u);
  assert.doesNotMatch(uploadScope, /verification_status <> 'SUSPENDED'/u);

  const authorizationSources = [
    sourceBetween(
      jobsRoute,
      "function liveJobAuthorization",
      "function statusPredicate",
    ),
    sourceBetween(
      filesRoute,
      "function liveMutationAuthorization",
      "async function mutableJob",
    ),
    sourceBetween(
      thumbnailRoute,
      "function liveThumbnailAuthorization",
      "async function loadThumbnail",
    ),
    sourceBetween(
      management,
      "export function chapterManagementAuthorizationClause",
      "type ManagementMembershipRole",
    ),
  ];
  for (const authorization of authorizationSources) {
    assert.match(authorization, /team_memberships live_membership/u);
    assert.match(authorization, /verification_status = 'VERIFIED'/u);
    assert.doesNotMatch(authorization, /series_team_assignments/u);
    assert.doesNotMatch(authorization, /verification_status <> 'SUSPENDED'/u);
  }
});

test("V38 series galleries are moderated, ratio-bound, and fail private before approval", async () => {
  const [publicRoute, mediaRoute, adminRoute, galleryUi] = await Promise.all([
    read("app/api/v1/series-gallery/route.ts"),
    read("app/api/v1/series-gallery-media/route.ts"),
    read("app/api/v1/admin/series-gallery/route.ts"),
    read("components/nyascans/SeriesGallerySections.tsx"),
  ]);

  assert.match(
    publicRoute,
    /sga\.moderation_status = 'APPROVED'/u,
  );
  assert.match(
    publicRoute,
    /submitted_by_user_id = \?[\s\S]+moderation_status IN \('PENDING', 'REJECTED'\)/u,
  );
  assert.match(publicRoute, /canSubmitArt: Boolean\(actor\)/u);
  assert.match(publicRoute, /function canSubmitCover/u);
  assert.match(publicRoute, /COVER_ORIENTATION_INVALID/u);
  assert.match(
    publicRoute,
    /payload\.orientation === "LANDSCAPE"[\s\S]+\{ width: 1600, height: 900 \}[\s\S]+\{ width: 1000, height: 1500 \}/u,
  );
  assert.match(publicRoute, /function canPublishGalleryDirectly/u);
  assert.match(
    publicRoute,
    /const moderationStatus = directPublishing \? "APPROVED" : "PENDING"/u,
  );

  assert.match(
    mediaRoute,
    /asset\?\.moderationStatus === "APPROVED"/u,
  );
  assert.match(mediaRoute, /actor\.id !== asset\.submittedByUserId/u);
  assert.match(mediaRoute, /"private, no-store"/u);
  assert.match(mediaRoute, /"public, max-age=3600/u);

  assert.match(adminRoute, /requireAdmin\(actor\)/u);
  assert.match(adminRoute, /current\.status !== "PENDING"/u);
  assert.match(adminRoute, /moderation_status = 'PENDING'/u);
  assert.match(adminRoute, /REJECTION_REASON_REQUIRED/u);
  assert.match(adminRoute, /revision = revision \+ 1/u);

  assert.match(galleryUi, /id=\{sectionKind\.toLowerCase\(\)\}/u);
  assert.match(galleryUi, /"ART",\s+"Art"/u);
  assert.match(galleryUi, /"COVER",\s+"Covers"/u);
  assert.match(galleryUi, /Add \{art \? "art" : "cover"\}/u);
  assert.match(galleryUi, /AdminMediaField/u);
});

test("V38 reader continuity targets the immediate chapter and preserves team plus language", async () => {
  const { continuityFallbackReason, selectPreferredRelease } = await import(
    "../lib/reader-continuity.ts"
  );
  const preference = { teamId: "team-a", language: "EN" };
  const candidates = [
    {
      chapterSlug: "chapter-2-a-v1",
      teamId: "team-a",
      language: "en",
      version: 1,
      publishedAt: "2026-07-01T00:00:00.000Z",
    },
    {
      chapterSlug: "chapter-2-a-v2",
      teamId: "team-a",
      language: "en",
      version: 2,
      publishedAt: "2026-07-02T00:00:00.000Z",
    },
    {
      chapterSlug: "chapter-2-b",
      teamId: "team-b",
      language: "en",
      version: 9,
      publishedAt: "2026-07-03T00:00:00.000Z",
    },
  ];
  assert.equal(
    selectPreferredRelease(candidates, preference)?.chapterSlug,
    "chapter-2-a-v2",
  );
  assert.equal(
    continuityFallbackReason(
      [
        {
          chapterSlug: "chapter-2-b",
          teamId: "team-b",
          language: "en",
          version: 1,
        },
      ],
      preference,
    ),
    "TEAM_UNAVAILABLE",
  );
  assert.equal(
    continuityFallbackReason(
      [
        {
          chapterSlug: "chapter-2-a-fr",
          teamId: "team-a",
          language: "fr",
          version: 1,
        },
      ],
      preference,
    ),
    "LANGUAGE_UNAVAILABLE",
  );
  assert.equal(
    continuityFallbackReason(
      [
        {
          chapterSlug: "chapter-2-a-fr",
          teamId: "team-a",
          language: "fr",
          version: 1,
        },
        {
          chapterSlug: "chapter-2-b-en",
          teamId: "team-b",
          language: "en",
          version: 1,
        },
      ],
      preference,
    ),
    "TEAM_AND_LANGUAGE_UNAVAILABLE",
  );
  assert.equal(continuityFallbackReason([], preference), null);

  const readerApi = await read("app/api/v1/[...resource]/route.ts");
  const readerContext = sourceBetween(
    readerApi,
    'if (path === "reader-context")',
    'if (path === "chapter-page")',
  );
  assert.match(
    readerContext,
    /CAST\(chapter_number AS REAL\) < CAST\(\? AS REAL\)[\s\S]+ORDER BY CAST\(chapter_number AS REAL\) DESC/u,
  );
  assert.match(
    readerContext,
    /CAST\(chapter_number AS REAL\) > CAST\(\? AS REAL\)[\s\S]+ORDER BY CAST\(chapter_number AS REAL\) ASC/u,
  );
  assert.match(readerContext, /c\.chapter_number = \?/u);
  assert.match(readerContext, /selectPreferredRelease\(nextCandidates/u);
  assert.match(readerContext, /nextAlternatives/u);
  assert.match(readerContext, /nextFallbackRequired/u);
});

test("V38 paid chapter unlocks credit the exact release team and persist a receipt", async () => {
  const api = await read("app/api/v1/[...resource]/route.ts");
  const unlockRoute = sourceBetween(
    api,
    'if (path === "unlocks")',
    'if (path === "uploads")',
  );

  assert.match(
    unlockRoute,
    /access\.teamId\s+\?\s+`la_team_\$\{access\.teamId\}_earned_onyx`/u,
  );
  assert.match(
    unlockRoute,
    /const creditOwnerType = access\.teamId \? "TEAM" : "PLATFORM"/u,
  );
  assert.match(unlockRoute, /current_chapter\.team_id = \?/u);
  assert.match(
    unlockRoute,
    /\{ accountId: creditAccountId, amount: access\.priceOnyx \}/u,
  );
  assert.match(unlockRoute, /INSERT INTO chapter_unlock_receipts/u);
  assert.match(
    unlockRoute,
    /chapter_id, team_id, amount, currency/u,
  );
  assert.match(unlockRoute, /access\.teamId,\s+access\.priceOnyx/u);
  assert.match(
    unlockRoute,
    /FROM chapter_unlock_receipts[\s\S]+WHERE transaction_id = \?/u,
  );
});

test("V38 series page groups release variants and exposes uploader attribution without obsolete boxes", async () => {
  const [detailRoute, app, gallery] = await Promise.all([
    read("app/api/v1/series-detail/route.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/SeriesGallerySections.tsx"),
  ]);

  assert.match(detailRoute, /c\.uploader_user_id AS uploaderUserId/u);
  assert.match(detailRoute, /u\.display_name AS uploaderName/u);
  assert.match(detailRoute, /up\.username AS uploaderUsername/u);
  assert.match(detailRoute, /LEFT JOIN users u ON u\.id = c\.uploader_user_id/u);
  assert.match(
    detailRoute,
    /LEFT JOIN user_profiles up ON up\.user_id = c\.uploader_user_id/u,
  );
  assert.match(detailRoute, /LIMIT 1000/u);

  assert.match(app, /const chapterGroups = \[\.\.\.chapters\.reduce/u);
  assert.match(
    app,
    /groups\.set\(number, \[\.\.\.\(groups\.get\(number\) \?\? \[\]\), chapter\]\)/u,
  );
  assert.match(app, /group\.releases\.map\(\(chapter\)/u);
  assert.match(app, /className="chapter-credit-chip"/u);
  assert.match(app, />Uploader<\/span>/u);
  assert.match(app, /chapter\.uploaderName/u);
  assert.match(app, /chapter\.teamName/u);
  assert.match(app, /<LanguageFlag language=\{chapter\.language\}/u);
  assert.match(app, /Read First/u);
  assert.match(app, /Read Latest/u);
  assert.match(
    app,
    /setCanUploadChapter\(Boolean\(payload\.permissions\?\.canUploadChapter\)\)/u,
  );
  assert.match(app, /\{canUploadChapter \? \(/u);
  assert.match(app, /\/upload-chapter\/single\?series=/u);
  assert.match(app, /Available translations/u);
  assert.match(app, /<SeriesGallerySections/u);
  assert.match(gallery, /series-gallery/u);

  for (const obsolete of [
    /English release/iu,
    /Reading guide/iu,
    /Primary publishing team/iu,
  ]) {
    assert.doesNotMatch(app, obsolete);
  }
});

test("V38 uses local SVG flags without regional-indicator emoji in touched public UI", async () => {
  const [flagComponent, languageFlags, app, discovery] = await Promise.all([
    read("components/nyascans/LanguageFlag.tsx"),
    read("lib/language-flags.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/PublicDiscoverySections.tsx"),
  ]);
  const flagFiles = (
    await fs.readdir(path.join(root, "public/flags/4x3"))
  ).filter((name) => name.endsWith(".svg"));

  assert.ok(flagFiles.length >= 250, `Expected >=250 flags, got ${flagFiles.length}`);
  for (const file of ["gb.svg", "jp.svg", "kr.svg", "cn.svg", "br.svg", "un.svg"]) {
    assert.ok(flagFiles.includes(file), `Missing local flag ${file}`);
  }
  assert.match(flagComponent, /\/flags\/4x3\/\$\{code\}\.svg/u);
  assert.match(languageFlags, /en: "gb"/u);
  assert.match(languageFlags, /ja: "jp"/u);
  assert.match(languageFlags, /"pt-br": "br"/u);
  assert.match(app, /import \{ LanguageFlag \}/u);
  assert.match(discovery, /import \{ LanguageFlag \}/u);

  const regionalIndicatorPair =
    /[\u{1F1E6}-\u{1F1FF}][\u{1F1E6}-\u{1F1FF}]/u;
  for (const source of [flagComponent, app, discovery]) {
    assert.doesNotMatch(source, regionalIndicatorPair);
  }
});

test("V38 comment picker searches the full Unicode emoji catalog and all approved GIF records", async () => {
  const groupData = require("unicode-emoji-json/data-by-group.json");
  const keywordData = require("emojilib");
  const entries = groupData.flatMap((group) =>
    group.emojis.map((entry) => ({
      emoji: entry.emoji,
      searchText: [
        entry.name,
        entry.slug.replaceAll("_", " "),
        group.name,
        ...(keywordData[entry.emoji] ?? []),
      ]
        .join(" ")
        .toLowerCase(),
    })),
  );
  const search = (query) => {
    const terms = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
    return entries.filter((entry) =>
      terms.every((term) => entry.searchText.includes(term)),
    );
  };

  assert.ok(entries.length >= 1900, `Expected >=1900 emoji, got ${entries.length}`);
  assert.ok(search("kitty").some((entry) => entry.emoji === "🐱"));
  assert.ok(search("heart eyes cat").some((entry) => entry.emoji === "😻"));

  const [catalogSource, discussion, api] = await Promise.all([
    read("lib/emoji-catalog.ts"),
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);
  assert.match(catalogSource, /unicode-emoji-json\/data-by-group\.json/u);
  assert.match(catalogSource, /import keywordData from "emojilib"/u);
  assert.match(catalogSource, /terms\.every/u);
  assert.match(discussion, /import\("@\/lib\/emoji-catalog"\)/u);
  assert.match(discussion, /placeholder="Search emoji by name or keyword"/u);
  assert.match(discussion, /media-picker-backdrop/u);

  const gifLibrary = sourceBetween(
    api,
    "const commentGifLibrary",
    "const eligibleCommentGifs",
  );
  assert.match(gifLibrary, /usage_kind = 'COMMENT_GIF'/u);
  assert.match(gifLibrary, /is_active = 1/u);
  assert.match(gifLibrary, /is_archived = 0/u);
  assert.doesNotMatch(gifLibrary, /LIMIT\s+\d+/u);
});

test("V38 ZIP and CBZ imports are locally bounded while RAR and Drive stay disabled", async () => {
  const [policy, importer, workspace] = await Promise.all([
    read("lib/uploads.ts"),
    read("lib/client/archive-import.ts"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
  ]);

  assert.match(
    policy,
    /id: "ZIP",[\s\S]*?supported: true,[\s\S]*?Extracted locally/u,
  );
  assert.match(policy, /id: "RAR",[\s\S]*?supported: false/u);
  assert.match(
    policy,
    /id: "GOOGLE_DRIVE",[\s\S]*?supported: false/u,
  );
  assert.match(importer, /from "fflate"/u);
  assert.match(importer, /archive\.size > 750 \* 1024 \* 1024/u);
  assert.match(
    importer,
    /entry\.originalSize \/ Math\.max\(1, entry\.size\) > 200/u,
  );
  assert.match(importer, /normalizeUploadPath/u);
  assert.match(importer, /function hasExpectedMagic/u);
  assert.match(importer, /UPLOAD_LIMITS\.maxPageBytes/u);
  assert.match(workspace, /<option value="ZIP">ZIP \/ CBZ archive<\/option>/u);
  assert.match(workspace, /await extractZipPages/u);
  assert.match(
    workspace,
    /"\.zip,\.cbz,application\/zip,application\/vnd\.comicbook\+zip"/u,
  );
});
