import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("floating campaign uses a composed desktop card and image-first mobile layout", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const campaign = app.slice(
    app.indexOf("function FloatingHomeAd"),
    app.indexOf("type CatalogResult"),
  );
  const authority = css.slice(css.lastIndexOf("Version 48.6.0"));

  assert.match(campaign, /className="event-campaign-visual"/u);
  assert.match(campaign, /className="event-campaign-content"/u);
  assert.match(campaign, /className="event-campaign-footer"/u);
  assert.match(campaign, /campaign\.infoBlocks\.slice\(0, 4\)/u);
  assert.match(campaign, /Do not show again today/u);
  assert.match(authority, /grid-template-columns: minmax\(0, 1\.02fr\)/u);
  assert.match(authority, /@media \(max-width: 780px\)[\s\S]*grid-template-rows: clamp\(/u);
  assert.doesNotMatch(authority, /place-items:\s*end center/u);
});

test("chapter reactions match the comments heading and the six Hive choices", async () => {
  const [app, api, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/api/v1/chapter-reactions/route.ts"),
    read("app/globals.css"),
  ]);
  const reader = app.slice(
    app.indexOf("const CHAPTER_REACTION_PRESENTATION"),
    app.indexOf("function fetchReaderResource"),
  ) + app.slice(
    app.indexOf("const orderedChapterReactions"),
    app.indexOf("return (", app.indexOf("const orderedChapterReactions")),
  );
  const authority = css.slice(css.lastIndexOf("Version 48.6.0"));

  for (const label of ["Like", "Love", "Laugh", "Wow", "Sad", "Angry"]) {
    assert.match(reader, new RegExp(`label: "${label}"`, "u"));
  }
  assert.match(app, /className="comments-header chapter-reactions-header"/u);
  assert.match(app, />Chapter Reactions</u);
  assert.doesNotMatch(app, /Choose one reaction/u);
  assert.doesNotMatch(app, /chapter-reaction-summary/u);
  assert.match(api, /WHEN 'upvote' THEN 0 WHEN 'heart' THEN 1 WHEN 'laugh' THEN 2/u);
  assert.match(authority, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/u);
  assert.match(authority, /@media \(max-width: 780px\)[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
});

test("chapter lists are flag-only, version-free, team-linked, and access-colored", async () => {
  const [app, css] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("app/globals.css"),
  ]);
  const drawer = app.slice(
    app.indexOf("ui && chapterDrawerOpen"),
    app.indexOf('<section className="reader-stage">'),
  );
  const authority = css.slice(css.lastIndexOf("Version 48.6.0"));

  assert.match(drawer, /showCode=\{false\}/u);
  assert.match(drawer, /className="reader-chapter-team"/u);
  assert.match(drawer, /reader-chapter-access is-\$\{paid \? "paid" : "free"\}/u);
  assert.doesNotMatch(drawer, /Version \{chapter\.version\}/u);
  assert.doesNotMatch(drawer, />v\{chapter\.version\}</u);
  assert.match(authority, /\.reader-chapter-access\.is-free[\s\S]*#62e8a7/u);
  assert.match(authority, /\.reader-chapter-access\.is-paid[\s\S]*#f2cc72/u);
});

test("paid Private is role-independent and preserves stored commerce data", async () => {
  const [visibility, access, app, admin] = await Promise.all([
    read("lib/server/public-content-visibility.ts"),
    read("lib/server/chapter-access.ts"),
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/admin/ContentVisibilityPanel.tsx"),
  ]);

  assert.match(visibility, /PAID_CONTENT_PUBLIC_SQL/u);
  assert.match(visibility, /WHEN \$\{overrideAlias\}\.access_type IN/u);
  assert.ok(
    visibility.indexOf("overrideAlias}.access_type IN") <
      visibility.indexOf("chapterAlias}.free_at IS NOT NULL"),
    "explicit access overrides must take precedence over scheduled-free logic",
  );
  assert.match(visibility, /return "1 = 1"/u);
  assert.doesNotMatch(access, /chapter\.seriesAccessType === "PAID"/u);
  assert.match(access, /chapter\.accessLevel !== "FREE"/u);
  assert.match(access, /paidContentIsPublic\(env\.DB\)/u);
  assert.doesNotMatch(app, /ownerPreview/u);
  assert.match(admin, /Paid content visibility/u);
  assert.match(admin, /Existing chapters, balances, purchases, settings, and entitlements are preserved/u);
  assert.match(admin, /Make paid content private\?/u);
});

test("comment deletion persists first and optional cleanup cannot cause Action Failed", async () => {
  const route = await read("app/api/v1/[...resource]/route.ts");
  const deleteHandler = route.slice(
    route.indexOf("export async function DELETE"),
  );
  const deletion = deleteHandler.slice(
    deleteHandler.lastIndexOf('if (path !== "discussion-comments")'),
  );
  assert.match(deletion, /const actor = await requireActor\(\);/u);
  assert.match(deletion, /Tombstone the visible comment first/u);
  assert.match(deletion, /UPDATE discussion_comments[\s\S]*\.run\(\);[\s\S]*Promise\.allSettled/u);
  const baselineTombstone = deletion.slice(
    deletion.indexOf("const deletion ="),
    deletion.indexOf("if (Number(deletion.meta.changes"),
  );
  assert.doesNotMatch(baselineTombstone, /revision|deleted_at|discussion_media/u);
  assert.match(deletion, /!isGlobalModerator\(actor\)/u);
  assert.match(deletion, /alreadyDeleted: true/u);
  assert.doesNotMatch(deletion, /requireActor\("comment\.create"\)[\s\S]*const commentId/u);
});
