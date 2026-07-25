import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("login and signup are distinct safe entry intents backed only by configured ChatGPT identity", async () => {
  const [router, auth, app] = await Promise.all([
    read("app/[...slug]/page.tsx"),
    read("app/chatgpt-auth.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  assert.match(router, /root === "login".+view: "login"/);
  assert.match(router, /root === "signup".+view: "signup"/);
  assert.match(router, /safeAuthReturnPath/);
  assert.match(auth, /value\.startsWith\("\/\/"\)/);
  assert.match(auth, /url\.origin !== "https:\/\/app\.local"/);
  assert.match(auth, /pathname === "\/login"/);
  assert.match(auth, /pathname === "\/signup"/);
  assert.match(app, /function AuthEntryView/);
  assert.match(app, /Continue with ChatGPT/);
  assert.match(app, /First-time authorization creates your NyaScans reader profile/);
  assert.match(app, /NyaScans never receives or stores your[\s\S]+provider token/);
  assert.doesNotMatch(app, /Continue with (Google|Apple|Facebook)/);
  assert.doesNotMatch(app, /ChatGPT\/OpenAI OAuth/);
});

test("paid chapter unlocks keep price, entitlement, idempotency, and image access on the server", async () => {
  const [api, access, reader] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/chapter-access.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  const unlockSchema = api.slice(
    api.indexOf("const unlockSchema"),
    api.indexOf("const analyticsEventSchema"),
  );
  assert.doesNotMatch(unlockSchema, /price|costOnyx|chapterId/);
  assert.match(api, /current_chapter\.price_onyx = \?/);
  assert.match(api, /NOT EXISTS \(\s*SELECT 1\s*FROM entitlements/);
  assert.match(api, /ON CONFLICT\(user_id, chapter_id\) DO UPDATE/);
  assert.match(api, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(api, /if \(path === "chapter-page"\)[\s\S]+resolveChapterAccess/);
  const chapterPageRoute = api.slice(
    api.indexOf('if (path === "chapter-page")'),
    api.indexOf('if (path === "catalog")'),
  );
  assert.doesNotMatch(chapterPageRoute, /\.uuid\(\)/);
  assert.match(chapterPageRoute, /\.max\(160\)/);
  assert.match(api, /headers\.set\("cache-control", "private, no-store"\)/);
  assert.match(access, /revoked_at IS NULL/);
  assert.match(access, /chapter\.visibility !== "HIDDEN"/);
  assert.match(access, /teamPreviewAllowed/);
  assert.match(access, /sta\.can_upload = 1/);
  assert.match(access, /sta\.revoked_at IS NULL/);
  assert.match(reader, /const unlockIdempotencyKey = useRef\(""\)/);
  assert.match(reader, /idempotencyKey: unlockIdempotencyKey\.current/);
  assert.match(reader, /authEntryPath\(\s*"signup"/);
  assert.match(reader, /\/store\/coins#coin-packages/);
});

test("reader and workspace use exact server-authorized chapter management routes", async () => {
  const [readerApi, reader, scope, management, pages, adminPage, teamPage] =
    await Promise.all([
      read("app/api/v1/[...resource]/route.ts"),
      read("components/nyascans/NyaScansApp.tsx"),
      read("lib/server/chapter-management.ts"),
      read("app/api/v1/chapter-management/route.ts"),
      read("app/api/v1/chapter-management-page/route.ts"),
      read(
        "app/onyx/admin/access/series/[seriesId]/chapters/[chapterId]/page.tsx",
      ),
      read("app/dashboard/series/[seriesId]/chapters/[chapterId]/page.tsx"),
    ]);

  assert.match(readerApi, /requireChapterManagementScope/);
  assert.match(
    readerApi,
    /\/onyx\/admin\/access\/series\/\$\{encodeURIComponent\(record\.seriesId\)\}\/chapters\//,
  );
  assert.match(
    readerApi,
    /\/dashboard\/series\/\$\{encodeURIComponent\(record\.seriesId\)\}\/chapters\//,
  );
  assert.match(reader, /readerContext\?\.chapterManagementHref/);
  assert.doesNotMatch(
    reader.slice(
      reader.indexOf("function ReaderView"),
      reader.indexOf("type WalletActivity"),
    ),
    /\/onyx\/admin\/access\/chapter-access\?series=/,
  );

  assert.match(scope, /sta\.can_upload = 1/);
  assert.match(scope, /sta\.revoked_at IS NULL/);
  assert.match(scope, /tm\.user_id = \?/);
  assert.match(scope, /sta\.team_id = c\.team_id/);
  assert.match(scope, /t\.verification_status <> 'SUSPENDED'/);
  assert.match(scope, /uploadRequiresReview/);
  assert.match(scope, /allowedLanguages/);
  assert.match(scope, /live_assignment\.upload_requires_review = 0/);
  assert.match(scope, /canManageCommerce: false/);
  assert.match(management, /expectedRevision/);
  assert.match(management, /CHAPTER_COMMERCE_FORBIDDEN/);
  assert.match(management, /CHAPTER_PUBLISH_FORBIDDEN/);
  assert.match(management, /RELEASE_LANGUAGE_NOT_ALLOWED/);
  assert.match(management, /DUPLICATE_RELEASE/);
  assert.match(management, /chapterManagementAuthorizationClause/);
  assert.match(management, /comments_enabled = \?/);
  assert.match(management, /visibility = \?/);
  assert.match(management, /page_index = page_index \+ 100000/);
  assert.match(pages, /validateImageFile/);
  assert.match(pages, /DUPLICATE_PAGE/);
  assert.match(pages, /cleanupIfUnreferenced/);
  assert.match(pages, /PUBLISHED_PAGE_REQUIRED/);
  assert.match(pages, /chapterManagementAuthorizationClause/);
  assert.match(pages, /cache-control", "private, no-store"/);
  assert.match(adminPage, /requireChapterManagementScope/);
  assert.match(teamPage, /requireChapterManagementScope/);
});

test("disabled comments and hidden chapters are enforced beyond the management UI", async () => {
  const [api, access, reader] = await Promise.all([
    read("app/api/v1/[...resource]/route.ts"),
    read("lib/server/chapter-access.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
  ]);

  assert.match(api, /CHAPTER_COMMENTS_DISABLED/);
  assert.match(api, /c\.comments_enabled AS commentsEnabled/);
  assert.match(api, /c\.visibility = 'PUBLIC'/);
  assert.match(access, /chapter\.visibility !== "HIDDEN"/);
  assert.match(reader, /readerContext\?\.chapter\.commentsEnabled/);
  assert.match(reader, /Comments are disabled for this release/);
});
