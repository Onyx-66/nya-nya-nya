import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);

test("immutable public-reference contract is present", () => {
  const helper = read("lib/server/public-identifiers.ts");
  const migration = read("drizzle/0055_colossal_luminals.sql");
  assert.match(helper, /SR\|TM\|CH/);
  assert.match(helper, /never be changed|publicReferenceSchema|newPublicReference/s);
  for (const table of ["chapters", "series", "teams"]) {
    assert.ok(migration.includes(`ALTER TABLE \`${table}\` ADD \`public_ref\` text NOT NULL`));
    assert.ok(migration.includes(`CREATE UNIQUE INDEX \`${table}_public_ref_uidx\``));
  }
  assert.match(migration, /public_identifier_reservations/);
});

test("Bot routes use permanent public references and shared actor authentication", () => {
  const files = [
    "app/api/v1/bot/series/route.ts",
    "app/api/v1/bot/chapters/route.ts",
    "app/api/v1/bot/chapters/bulk/route.ts",
    "app/api/v1/bot/chapters/[chapterId]/route.ts",
    "app/api/v1/bot/chapters/[chapterId]/publish/route.ts",
    "app/api/v1/bot/chapters/[chapterId]/thumbnail/route.ts",
    "app/api/v1/bot/chapters/bulk-thumbnails/route.ts",
    "app/api/v1/bot/operations/[operationId]/route.ts",
    "app/api/v1/bot/taxonomy/genres/route.ts",
  ];
  for (const file of files) {
    exists(file);
    const source = read(file);
    assert.match(source, /botContext/);
  }
  assert.match(read("lib/server/api-keys.ts"), /nya_bot_/);
  assert.match(read("lib/server/api-keys.ts"), /getActorForUserId/);
});

test("Bot mutations have idempotency and audit hooks", () => {
  for (const file of [
    "app/api/v1/bot/series/route.ts",
    "app/api/v1/bot/chapters/route.ts",
    "app/api/v1/bot/chapters/bulk/route.ts",
    "app/api/v1/bot/chapters/[chapterId]/publish/route.ts",
  ]) {
    const source = read(file);
    assert.match(source, /botIdempotencyStart/);
    assert.match(source, /botIdempotencyFinish/);
    assert.match(source, /botAudit/);
  }
  const helper = read("lib/server/bot-api.ts");
  assert.match(helper, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(helper, /IDEMPOTENCY_IN_PROGRESS/);
  assert.match(helper, /BOT_API/);
  const uploadRoute = read("app/api/v1/upload-jobs/route.ts");
  assert.match(uploadRoute, /reservedChapterRefs/);
  assert.match(uploadRoute, /UPDATE public_identifier_reservations/);
});

test("upload and security acceptance rules are explicit", () => {
  const chapter = read("app/api/v1/bot/chapters/route.ts");
  const bulk = read("app/api/v1/bot/chapters/bulk/route.ts");
  const thumbnail = read("app/api/v1/bot/chapters/[chapterId]/thumbnail/route.ts");
  const bulkThumbnail = read("app/api/v1/bot/chapters/bulk-thumbnails/route.ts");
  const series = read("app/api/v1/bot/series/route.ts");
  assert.match(chapter, /SOURCE_EXACTLY_ONE/);
  assert.match(chapter, /validateChapterPage/);
  assert.match(chapter, /unzipSync/);
  assert.match(chapter, /SOURCE_RAR_UNSUPPORTED/);
  assert.match(chapter, /archivePages/);
  assert.match(series, /alternativeTitles/);
  assert.match(series, /authorNames/);
  assert.match(series, /artistNames/);
  assert.match(series, /publisherName/);
  assert.match(bulkThumbnail, /THUMBNAILS_EXIST/);
  assert.match(bulkThumbnail, /confirmationRequired/);
  assert.match(bulk, /paidRange/);
  assert.match(bulk, /paid range must be inside/);
  assert.match(thumbnail, /THUMBNAIL_EXISTS/);
  assert.match(thumbnail, /confirmationRequired/);
});

test("admin identifier and Bot Activity routes are read-only and capability-gated", () => {
  const identifiers = read("app/api/v1/admin/identifiers/route.ts");
  const activity = read("app/api/v1/admin/bot-activity/route.ts");
  assert.match(identifiers, /admin\.identifiers\.read/);
  assert.match(activity, /admin\.bot-actions\.read/);
  assert.match(activity, /source_area = 'BOT_API'/);
  assert.doesNotMatch(identifiers, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(activity, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(read("lib/admin-permissions.ts"), /admin\.identifiers\.read/);
  assert.match(read("lib/admin-permissions.ts"), /admin\.bot-actions\.read/);
});

test("team member and admin surfaces expose stable TM references", () => {
  assert.match(read("app/api/v1/admin/team-management/route.ts"), /public_ref AS publicRef/);
  assert.match(read("app/api/v1/teams/community/route.ts"), /newPublicReference\("TEAM"\)/);
  assert.match(read("components/nyascans/admin/TeamManagementPanel.tsx"), /Public team reference/);
  assert.match(read("components/nyascans/NyaScansApp.tsx"), /IdentifiersPanel/);
  assert.match(read("components/nyascans/NyaScansApp.tsx"), /BotActivityPanel/);
});
