import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (file) =>
  readFile(new URL(`../${file}`, import.meta.url), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing source boundary: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing source boundary: ${end}`);
  return source.slice(from, to);
}

test("admin MFA uses an environment-only AES key, RFC 6238 TOTP, rate limiting, and a strict one-hour cookie", async () => {
  const [mfa, exampleEnvironment, scanner] = await Promise.all([
    read("lib/server/admin-mfa.ts"),
    read(".env.example"),
    read("scripts/check-secrets.mjs"),
  ]);

  assert.match(mfa, /ADMIN_TOTP_ENCRYPTION_KEY\?: string/u);
  assert.match(mfa, /if \(!configured\) throw new ApiError\(503, "ADMIN_MFA_NOT_CONFIGURED"/u);
  assert.match(mfa, /if \(bytes\.byteLength !== 32\)/u);
  assert.match(mfa, /importKey\("raw",[\s\S]*"AES-GCM"[\s\S]*\["encrypt", "decrypt"\]/u);
  assert.match(mfa, /crypto\.getRandomValues\(new Uint8Array\(12\)\)/u);
  assert.match(mfa, /crypto\.subtle\.encrypt\(\{ name: "AES-GCM", iv:/u);
  assert.match(mfa, /crypto\.subtle\.decrypt\([\s\S]*name: "AES-GCM"/u);
  assert.doesNotMatch(mfa, /ADMIN_TOTP_ENCRYPTION_KEY\s*\?\?\s*["'`][A-Za-z0-9_-]{20,}/u);

  assert.match(mfa, /const message = new Uint8Array\(8\)/u);
  assert.match(mfa, /\{ name: "HMAC", hash: "SHA-1" \}/u);
  assert.match(mfa, /digest\[digest\.length - 1\]! & 0x0f/u);
  assert.match(mfa, /% 1_000_000/u);
  assert.match(mfa, /algorithm=SHA1&digits=6&period=30/u);
  assert.match(mfa, /\[currentCounter - 1, currentCounter, currentCounter \+ 1\]/u);
  assert.match(mfa, /const MAX_FAILURES = 5/u);
  assert.match(mfa, /datetime\('now', '-15 minutes'\)/u);
  assert.match(mfa, /ADMIN_MFA_RATE_LIMITED/u);

  assert.match(mfa, /const ADMIN_SESSION_SECONDS = 60 \* 60/u);
  assert.match(mfa, /__Host-nyascans_admin_mfa/u);
  assert.match(mfa, /`Max-Age=\$\{ADMIN_SESSION_SECONDS\}`/u);
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict"]) {
    assert.match(mfa, new RegExp(`"${flag}"`, "u"));
  }
  assert.match(exampleEnvironment, /^ADMIN_TOTP_ENCRYPTION_KEY=$/mu);
  assert.match(scanner, /ADMIN_TOTP_ENCRYPTION_KEY/u);
});

test("admin MFA accepts each counter once and logout revokes the durable session", async () => {
  const [mfa, logout, endpoint] = await Promise.all([
    read("lib/server/admin-mfa.ts"),
    read("app/api/v1/auth/logout/route.ts"),
    read("app/api/v1/admin-mfa/route.ts"),
  ]);
  const updateMatch = mfa.match(
    /const updated = await db\.prepare\(\s*`([\s\S]*?UPDATE admin_mfa_factors[\s\S]*?)`\s*,?\s*\)\.bind/u,
  );
  assert.ok(updateMatch, "the replay-resistant factor update must remain explicit SQL");
  assert.match(updateMatch[1], /WHERE user_id = \? AND last_accepted_counter < \?/u);

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE admin_mfa_factors (
      user_id TEXT PRIMARY KEY,
      confirmed_at TEXT,
      last_accepted_counter INTEGER NOT NULL DEFAULT -1,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO admin_mfa_factors (user_id) VALUES ('owner');
  `);
  const acceptCounter = database.prepare(updateMatch[1]);
  assert.equal(acceptCounter.run(42, "owner", 42).changes, 1);
  assert.equal(
    acceptCounter.run(42, "owner", 42).changes,
    0,
    "a concurrent or replayed authenticator counter must lose atomically",
  );
  assert.equal(
    database.prepare("SELECT last_accepted_counter AS counter FROM admin_mfa_factors").get().counter,
    42,
  );
  database.close();

  assert.match(mfa, /ADMIN_MFA_CODE_REPLAYED/u);
  assert.match(mfa, /UPDATE admin_mfa_sessions SET revoked_at = CURRENT_TIMESTAMP[\s\S]*token_hash = \?/u);
  assert.match(logout, /await revokeAdminMfaSessionFromHeaders\(request\.headers\)/u);
  assert.match(logout, /response\.headers\.append\("set-cookie", clearAdminMfaCookie\(\)\)/u);
  assert.match(endpoint, /await revokeAdminMfaSession\(actor\.id, request\.headers\)/u);
  assert.match(endpoint, /"set-cookie": clearAdminMfaCookie\(\)/u);
});

test("RBAC resolves explicit deny before allow and keeps Owner-only capabilities non-delegable", async () => {
  const [policy, registry, route] = await Promise.all([
    read("lib/server/policy.ts"),
    read("lib/admin-permissions.ts"),
    read("app/api/v1/admin/role-permissions/route.ts"),
  ]);
  const capabilityResolver = between(
    policy,
    "export function actorHasCapability",
    "export async function requireActor",
  );
  assert.match(capabilityResolver, /roles\.includes\(ROLES\.OWNER\)\) return true/u);
  assert.match(capabilityResolver, /NON_DELEGABLE_CAPABILITIES\.has\(capability\)\) return false/u);
  assert.ok(
    capabilityResolver.indexOf("matching.some((rule) => !rule.allowed)") <
      capabilityResolver.indexOf("matching.some((rule) => rule.allowed)"),
    "an explicit deny must win even when another assigned role grants the capability",
  );
  const adminGuard = between(policy, "export function requireAdminCapability", "export function requireAdmin");
  assert.match(adminGuard, /requireAdminConsole\(actor\)/u);
  assert.match(adminGuard, /actorHasCapability\(actor, capability\)/u);
  assert.match(policy, /ADMIN_MFA_REQUIRED/u);

  for (const capability of [
    "roles.manage",
    "api.manage",
    "security.sessions.manage",
    "admin.audit.read",
  ]) {
    assert.match(registry, new RegExp(`"${capability}"`, "u"));
  }
  assert.doesNotMatch(route, /editableRoles = \[[^\]]*ROLES\.OWNER/u);
  assert.ok((route.match(/requireOwner\(actor\)/gu) ?? []).length >= 2);
  assert.match(route, /NON_DELEGABLE_CAPABILITIES\.has\(payload\.capability\)/u);
  assert.match(route, /PERMISSION_NON_DELEGABLE/u);
  assert.match(route, /expectedRevision/u);
});

test("saved schema-v1 site configuration is normalized without discarding legacy values", async () => {
  const [configuration, storage] = await Promise.all([
    read("lib/site-configuration.ts"),
    read("lib/server/site-configuration.ts"),
  ]);
  assert.match(configuration, /schemaVersion: z\.literal\(1\)/u);
  const parser = between(
    configuration,
    "export function parseSiteConfiguration",
    "export function siteMediaUrl",
  );
  assert.match(parser, /\.\.\.defaultSiteConfiguration,[\s\S]*\.\.\.input/u);
  assert.match(parser, /brand: \{ \.\.\.defaultSiteConfiguration\.brand, \.\.\.input\.brand \}/u);
  assert.match(parser, /footer: \{ \.\.\.defaultSiteConfiguration\.footer, \.\.\.input\.footer \}/u);
  assert.match(parser, /reader: \{ \.\.\.defaultSiteConfiguration\.reader, \.\.\.input\.reader \}/u);
  assert.match(parser, /input\.keyboardShortcuts\?\.length[\s\S]*input\.keyboardShortcuts/u);
  assert.match(parser, /input\.legalDocuments\?\.length[\s\S]*input\.legalDocuments/u);
  assert.match(parser, /return parsed\.success \? parsed\.data : defaultSiteConfiguration/u);
  assert.match(storage, /const raw = JSON\.parse\(row\.settings_json\)/u);
  assert.match(storage, /const normalized = parseSiteConfiguration\(raw\)/u);
  assert.doesNotMatch(storage, /schema_version\s*>\s*1/u);
});

test("analytics includes prior-period comparisons, team growth, and an explicit country scope", async () => {
  const [route, panel] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
  ]);
  const analytics = between(
    route,
    'if (path === "admin/analytics")',
    'if (path === "admin/user-control")',
  );
  assert.match(analytics, /requireAdminCapability\(actor, capabilityForAdminPath\(path\)\)/u);
  assert.match(analytics, /url\.searchParams\.get\("region"\)/u);
  assert.match(analytics, /requestedRegion === "UNKNOWN"/u);
  assert.match(analytics, /\^\[A-Z\]\{2\}\$/u);
  assert.match(analytics, /COALESCE\(NULLIF\(region_code, ''\), 'Unknown'\) = \?/u);
  assert.match(analytics, /const previousStartAt = new Date/u);
  assert.match(analytics, /AS newTeams/u);
  assert.match(analytics, /previousSummary:[\s\S]*newTeams: Number\(previousSummary\.newTeams \?\? 0\)/u);
  assert.match(analytics, /regionScope: selectedRegion/u);
  assert.match(panel, /region=\$\{encodeURIComponent\(region\)\}/u);
  assert.match(panel, /"Team growth"[\s\S]*comparison\(activeData\.summary\.newTeams, activeData\.previousSummary\.newTeams\)/u);
  assert.match(panel, /Country filter[\s\S]*applies to visit, reader, timeline, chapter, and series activity/u);
  assert.match(panel, /Account, community, purchase, and economy totals remain global/u);
});

test("platform governance fetches one searchable, paginated area and omits cross-tab private records", async () => {
  const [route, panel] = await Promise.all([
    read("app/api/v1/admin/platform-governance/route.ts"),
    read("components/nyascans/admin/SiteCoveragePanel.tsx"),
  ]);
  assert.match(route, /area: z\.enum\(\["registry", "achievements", "moderation", "access", "security"\]\)/u);
  assert.match(route, /page: z\.coerce\.number\(\)\.int\(\)\.min\(1\)/u);
  assert.match(route, /limit: z\.coerce\.number\(\)\.int\(\)\.min\(10\)\.max\(50\)/u);
  assert.match(route, /q: z\.string\(\)\.trim\(\)\.max\(160\)/u);
  assert.match(route, /const offset = \(page - 1\) \* limit/u);
  assert.match(route, /const fetchLimit = limit \+ 1/u);
  assert.match(route, /const pattern = `%\$\{query\}%`/u);
  assert.match(route, /pagination: \{ page, limit, hasMore \}/u);

  const areaGuards = [
    ['area === "achievements" && permissions.achievements', "achievement_definitions"],
    ['area === "moderation" && permissions.reviews', "FROM reviews"],
    ['area === "moderation" && permissions.teamPosts', "team_discussion_posts"],
    ['area === "access" && permissions.access', "FROM entitlements"],
    ['area === "access" && permissions.access', "FROM gift_cards"],
    ['area === "registry" && permissions.notifications', "FROM notifications"],
    ['area === "security" && permissions.securityRead', "FROM admin_mfa_sessions"],
  ];
  for (const [guard, table] of areaGuards) {
    const guardIndex = route.indexOf(guard);
    assert.notEqual(guardIndex, -1, `missing area guard for ${table}`);
    const tableIndex = route.indexOf(table, guardIndex);
    assert.ok(tableIndex > guardIndex && tableIndex - guardIndex < 1_800, `${table} must stay behind its area and capability guard`);
  }

  const sessionQuery = route.match(
    /rows<Record<string, unknown>>\(area === "security" && permissions\.securityRead,\s*`(SELECT s\.id[\s\S]*?FROM admin_mfa_sessions[\s\S]*?)`/u,
  );
  assert.ok(sessionQuery, "the security-session projection must remain inspectable");
  assert.doesNotMatch(sessionQuery[1], /token_hash|fingerprint_hash/u);
  assert.match(panel, /area: areaForTab\[tab\]/u);
  assert.match(panel, /page: String\(page\)/u);
  assert.match(panel, /params\.set\("q", appliedQuery\)/u);
  assert.match(panel, /setPage\(\(current\) => current \+ 1\)/u);
});

test("platform governance maps every mutation to a capability, rejects no-ops, and makes notices idempotent", async () => {
  const route = await read("app/api/v1/admin/platform-governance/route.ts");
  const expectedCapabilities = {
    FEATURE_FLAG: "platform.features.manage",
    ACHIEVEMENT_SAVE: "community.achievements.manage",
    ACHIEVEMENT_ASSIGN: "community.achievements.manage",
    ACHIEVEMENT_REVOKE: "community.achievements.manage",
    REVIEW_STATUS: "reviews.moderate.global",
    TEAM_POST_STATUS: "comments.moderate.global",
    MFA_SESSION_REVOKE: "security.sessions.manage",
    NOTIFICATION_SEND: "notifications.manage",
  };
  for (const [action, capability] of Object.entries(expectedCapabilities)) {
    assert.match(route, new RegExp(`${action}: "${capability.replaceAll(".", "\\.")}"`, "u"));
  }
  assert.match(route, /requireAdminCapability\(actor, capabilityByAction\[payload\.action\]\)/u);
  assert.match(route, /FEATURE_FLAG_UNCHANGED/u);
  assert.match(route, /REVIEW_STATUS_UNCHANGED/u);
  assert.match(route, /TEAM_POST_STATUS_UNCHANGED/u);
  assert.match(route, /if \(!results\[0\]\?\.meta\.changes\)[\s\S]*STALE_VERSION/u);

  assert.match(route, /clientMutationId: z\.string\(\)\.uuid\(\)/u);
  assert.match(route, /INSERT OR IGNORE INTO notifications/u);
  assert.match(route, /`admin-notice:\$\{actor\.id\}:\$\{payload\.clientMutationId\}`/u);
  assert.match(route, /SYSTEM_ADMIN_NOTICE/u);
  assert.match(route, /idempotent: true/u);
  assert.match(route, /bodyLength: payload\.body\.length/u);

  assert.match(route, /CASE WHEN g\.status = 'ACTIVE' AND datetime\(g\.expires_at\) <= CURRENT_TIMESTAMP THEN 'EXPIRED' ELSE g\.status END AS status/u);
  assert.doesNotMatch(route, /UPDATE gift_cards/u);
  assert.doesNotMatch(route, /DELETE FROM gift_cards/u);

  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE gift_cards (id TEXT PRIMARY KEY, status TEXT NOT NULL, expires_at TEXT);
    INSERT INTO gift_cards VALUES
      ('past', 'ACTIVE', '2000-01-01T00:00:00.000Z'),
      ('future', 'ACTIVE', '2999-01-01T00:00:00.000Z'),
      ('used', 'REDEEMED', '2000-01-01T00:00:00.000Z');
  `);
  const statuses = database.prepare(
    "SELECT id, CASE WHEN status = 'ACTIVE' AND datetime(expires_at) <= CURRENT_TIMESTAMP THEN 'EXPIRED' ELSE status END AS status FROM gift_cards ORDER BY id",
  ).all();
  assert.deepEqual(statuses.map((row) => [row.id, row.status]), [
    ["future", "ACTIVE"],
    ["past", "EXPIRED"],
    ["used", "REDEEMED"],
  ]);
  database.close();
});

test("event campaigns are scheduled and fully admin-managed with a responsive accessible modal", async () => {
  const [migration, adminRoute, publicRoute, panel, app, css] = await Promise.all([
    read("drizzle/0040_sticky_reptil.sql"),
    read("app/api/v1/admin/home-promotions/route.ts"),
    read("app/api/v1/home-promotions/route.ts"),
    read("components/nyascans/admin/HomePromotionsPanel.tsx"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  for (const column of ["action_label", "info_blocks_json", "starts_at", "ends_at"]) {
    assert.match(migration, new RegExp(`floating_ads.{0,80}${column}|ADD .${column}.`, "su"));
  }
  assert.match(adminRoute, /infoBlocks: z\.array\([\s\S]*\)\.max\(4\)/u);
  assert.match(adminRoute, /actionLabel: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(60\)/u);
  assert.match(adminRoute, /End time must be later than start time/u);
  assert.match(adminRoute, /requireAdminCapability\(actor, "announcements\.manage"\)/u);
  assert.match(adminRoute, /JSON\.stringify\(data\.infoBlocks\)/u);
  assert.match(publicRoute, /datetime\(starts_at\) <= CURRENT_TIMESTAMP/u);
  assert.match(publicRoute, /datetime\(ends_at\) > CURRENT_TIMESTAMP/u);
  assert.match(publicRoute, /infoBlocks: \(\(\) =>/u);

  assert.match(panel, /localDateTimeValue/u);
  assert.match(panel, /utcDateTimeValue/u);
  assert.match(panel, /ad\.infoBlocks\.length < 4/u);
  assert.match(panel, /Primary action label/u);
  assert.match(panel, /Starts at \(optional\)/u);
  assert.match(panel, /Ends at \(optional\)/u);
  assert.match(app, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="event-campaign-title"/u);
  assert.match(app, /campaign\.infoBlocks\.slice\(0, 4\)/u);
  assert.match(app, /Do not show again today/u);
  assert.match(app, /now\.getFullYear\(\)[\s\S]*now\.getMonth\(\)[\s\S]*now\.getDate\(\)/u);
  assert.match(app, /localStorage\.setItem\(storageKey, "dismissed"\)/u);
  assert.match(app, /doNotShowTodayRef\.current/u);
  assert.match(app, /onClick=\{persistDismissal\}/u);
  assert.match(app, /window\.addEventListener\("keydown", close\)/u);
  assert.match(css, /\.event-campaign-art/u);
  assert.match(css, /\.event-campaign-shade/u);
  assert.match(css, /@keyframes v482-(?:backdrop|modal)-in/u);
  assert.match(css, /@media \(max-width: 760px\)/u);
});

test("reader progress is pointer-draggable and keyboard-accessible while chapter reactions keep six durable slots", async () => {
  const [app, route, adminRoute, discussion, repairMigration] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/chapter-reactions/route.ts"),
    read("app/api/v1/admin/reaction-library/route.ts"),
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("drizzle/0042_repair_chapter_reaction_slots.sql"),
  ]);
  const footer = between(app, "<footer className={`reader-footer", "<nav className=\"reader-quick-nav\"");
  assert.doesNotMatch(footer, /pages · Continuous|Series details/u);
  assert.match(footer, /role="slider"/u);
  assert.match(footer, /aria-valuenow/u);
  assert.match(footer, /onPointerDown/u);
  assert.match(footer, /setPointerCapture\(event\.pointerId\)/u);
  assert.match(footer, /onPointerMove/u);
  assert.match(footer, /hasPointerCapture\(event\.pointerId\)/u);
  assert.match(footer, /onPointerUp/u);
  assert.match(footer, /onPointerCancel/u);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    assert.match(footer, new RegExp(`event\\.key === "${key}"`, "u"));
  }
  assert.match(app, /function seekReaderFromPointer/u);
  assert.match(app, /event\.clientX - rect\.left/u);
  assert.match(app, /scrollIntoView/u);

  const six = "'upvote', 'laugh', 'heart', 'surprised', 'angry', 'sad'";
  assert.ok((route.match(new RegExp(six, "gu")) ?? []).length >= 2);
  assert.match(route, /COUNT\(chr\.user_id\) AS count/u);
  assert.match(route, /MAX\(CASE WHEN chr\.user_id = \? THEN 1 ELSE 0 END\) AS selected/u);
  assert.match(route, /ON CONFLICT\(user_id, chapter_id\) DO UPDATE SET/u);
  assert.match(route, /return \{[\s\S]*total: data\.reduce/u);
  assert.match(app, /const orderedChapterReactions = \[\.\.\.chapterReactions\]\.sort/u);
  assert.match(app, />Chapter Reactions</u);
  assert.doesNotMatch(app, /Choose one reaction\./u);
  assert.match(discussion, /chapter-reaction-placement/u);
  assert.match(adminRoute, /const chapterReactionSlots = new Set\(\["upvote", "laugh", "heart", "surprised", "angry", "sad"\]\)/u);
  assert.match(adminRoute, /CHAPTER_REACTION_SLOT_PROTECTED/u);
  assert.match(adminRoute, /Edit only the label, accessible label, emoji, or asset/u);
  assert.match(adminRoute, /SELECT COUNT\(\*\) FROM chapter_reactions/u);
  assert.match(repairMigration, /INSERT OR IGNORE INTO `custom_reactions`/u);
  assert.match(repairMigration, /`usage_kind` = 'REACTION'/u);
  assert.match(repairMigration, /`is_active` = 1/u);
  assert.match(repairMigration, /`is_archived` = 0/u);
  assert.match(repairMigration, /`availability_json` = '\{"scope":"GLOBAL","teamIds":\[\]\}'/u);
});

test("comment formatting and emoji/GIF pickers have searchable categorized resilient contracts", async () => {
  const [discussion, emojiCatalog, profile, teamView] = await Promise.all([
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("lib/emoji-catalog.ts"),
    read("components/nyascans/PublicProfileView.tsx"),
    read("components/nyascans/PublicTeamView.tsx"),
  ]);
  assert.match(discussion, /void import\("@\/lib\/emoji-catalog"\)/u);
  assert.match(discussion, /setEmojiCatalog\(catalog\.emojiCatalog\)/u);
  assert.match(discussion, /setEmojiGroups\(catalog\.emojiGroups\)/u);
  assert.match(discussion, /setEmojiError\("The emoji catalog could not be loaded\."\)/u);
  assert.match(discussion, /setEmojiReload\(\(value\) => value \+ 1\)/u);
  assert.match(discussion, /entry\.groupSlug === emojiGroup/u);
  assert.match(discussion, /entry\.searchText\.includes\(term\)/u);
  assert.match(emojiCatalog, /unicode-emoji-json\/data-by-group\.json/u);
  assert.match(emojiCatalog, /export const emojiGroups/u);
  assert.match(emojiCatalog, /export function searchEmojiCatalog/u);

  assert.match(discussion, /const gifCategories = useMemo/u);
  assert.match(discussion, /gif\.category === gifCategory/u);
  assert.match(discussion, /gif\.name\.toLowerCase\(\)\.includes\(term\)/u);
  assert.match(discussion, /className="comment-gif-grid"/u);
  assert.match(discussion, /No curated GIF matches this search/u);
  assert.match(discussion, /Retry GIF catalog/u);
  assert.match(discussion, /setGifPickerOpen\(false\)[\s\S]*setEmojiOpen\(next\)/u);
  assert.match(discussion, /role="dialog"[\s\S]*aria-label="Choose a GIF"/u);
  assert.match(discussion, /role="dialog"[\s\S]*aria-label="Choose an emoji"/u);

  for (const contract of [
    /formatSelection\("\*\*"\)/u,
    /formatSelection\("_"\)/u,
    /formatSelection\("~~"\)/u,
    /formatSelection\("", "", true\)/u,
  ]) {
    assert.match(discussion, contract);
  }
  assert.match(discussion, /export function FormattedCommentText/u);
  assert.match(profile, /<FormattedCommentText value=\{comment\.body\} \/>/u);
  assert.match(teamView, /<FormattedCommentText value=\{comment\.body\} \/>/u);
});

test("authenticated actor avatars use the public profile-media contract", async () => {
  const policy = await read("lib/server/policy.ts");

  assert.equal(
    (policy.match(/p\.username AS profile_username/gu) ?? []).length,
    3,
    "every actor refresh path must retain the media username",
  );
  assert.match(
    policy,
    /profile-media\?username=\$\{encodeURIComponent\(row\.profile_username\)\}&slot=avatar&v=\$\{Number\(row\.profile_revision \?\? 1\)\}/u,
  );
  assert.doesNotMatch(policy, /profile-media\?slot=avatar&revision=/u);
});
