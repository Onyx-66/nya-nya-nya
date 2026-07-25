import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("discussion migration preserves threads and upgrades legacy likes", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrations = await Promise.all(
    [
      "drizzle/0000_spooky_loa.sql",
      "drizzle/0001_sleepy_miek.sql",
      "drizzle/0002_past_senator_kelly.sql",
      "drizzle/0003_harsh_gwen_stacy.sql",
    ].map(read),
  );

  database.exec(migrations[0]);
  database.exec(migrations[1]);
  database.exec(migrations[2]);
  database
    .prepare(
      `INSERT INTO users (id, email, display_name)
       VALUES ('usr_reader', 'reader@example.com', 'Mina Park')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO discussion_comments
       (id, user_id, series_slug, body)
       VALUES ('root', 'usr_reader', 'neon-ronin', 'Root theory')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO discussion_comments
       (id, user_id, series_slug, parent_id, body)
       VALUES ('reply', 'usr_reader', 'neon-ronin', 'root', 'Reply theory')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO discussion_reactions (user_id, comment_id, reaction)
       VALUES ('usr_reader', 'root', 'LIKE')`,
    )
    .run();

  database.exec(migrations[3]);

  assert.deepEqual(
    database
      .prepare(
        "SELECT id, depth FROM discussion_comments ORDER BY id",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "reply", depth: 1 },
      { id: "root", depth: 0 },
    ],
  );
  assert.equal(
    database
      .prepare(
        "SELECT reaction FROM discussion_reactions WHERE comment_id = 'root'",
      )
      .get().reaction,
    "heart",
  );
  const settings = JSON.parse(
    database
      .prepare(
        "SELECT settings_json AS settingsJson FROM discussion_settings WHERE id = 'global'",
      )
      .get().settingsJson,
  );
  assert.equal(settings.allowImages, true);
  assert.equal(settings.allowGifs, true);
  assert.ok(settings.reactions.some((reaction) => reaction.key === "heart"));
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO discussion_votes (user_id, comment_id, value)
         VALUES ('usr_reader', 'root', 0)`,
      )
      .run(),
  );
  database
    .prepare(
      `INSERT INTO discussion_votes (user_id, comment_id, value)
       VALUES ('usr_reader', 'root', 1)`,
    )
    .run();
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO discussion_votes (user_id, comment_id, value)
         VALUES ('usr_reader', 'root', -1)`,
      )
      .run(),
  );
  database.close();
});

test("discussion UI and API expose the complete interaction contract", async () => {
  const [component, admin, api, schema, css] = await Promise.all([
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("components/nyascans/DiscussionSettingsPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
    read("db/schema.ts"),
    read("app/globals.css"),
  ]);

  for (const contract of [
    "discussion-votes",
    "discussion-reactions",
    "discussion-media",
    "admin/discussion-settings",
  ]) {
    assert.match(api, new RegExp(contract.replace("/", "\\/")));
  }
  assert.match(api, /export async function PATCH/);
  assert.match(api, /detectedImageType/);
  assert.match(schema, /discussionVotes/);
  assert.match(schema, /discussionMedia/);
  assert.match(schema, /discussionCommentEdits/);
  assert.match(schema, /discussionSettings/);

  assert.match(component, /Upvote/);
  assert.match(component, /Downvote/);
  assert.match(component, /Emoji/);
  assert.match(component, /GIF/);
  assert.match(component, /Image/);
  assert.match(component, /Post reply/);
  assert.match(component, /Save edit/);
  assert.match(component, /Load more comments/);
  assert.match(component, /maxReplyDepth/);

  assert.match(admin, /Reaction set/);
  assert.match(admin, /Add reaction/);
  assert.match(admin, /Allow images/);
  assert.match(admin, /Allow GIFs/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /\.comment-media-grid/);
  assert.match(css, /\.comment-reaction-picker/);
});
