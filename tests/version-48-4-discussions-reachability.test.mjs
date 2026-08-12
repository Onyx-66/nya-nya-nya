import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("Community Discussions mounts global moderation, policy, and media views under one canonical page", async () => {
  const [app, operations, discussions] = await Promise.all([
    read("components/nyascans/NyaScansApp.tsx"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/admin/ReactionLibraryPanel.tsx"),
  ]);

  assert.doesNotMatch(
    app,
    /activeNavigationItem\?\.slug === "discussions"[\s\S]{0,180}<ReactionLibraryPanel/u,
  );
  assert.match(operations, /sectionKey === "discussions"/u);
  assert.match(
    operations,
    /<ReactionLibraryPanel[\s\S]{0,260}<WorkspacePanel[\s\S]{0,100}section="Comments"[\s\S]{0,100}embedded/u,
  );
  assert.match(operations, /settingsPanel=\{<DiscussionSettingsPanel \/>\}/u);

  assert.match(discussions, /breadcrumbs=\{\["Community", "Discussions"\]\}/u);
  assert.match(discussions, /title="Discussions"/u);
  assert.match(discussions, /"moderation" \| "library" \| "settings"/u);
  assert.match(discussions, /label: "Moderation"/u);
  assert.match(discussions, /label: "Discussion settings"/u);
  assert.match(discussions, /label: "Reactions & GIFs"/u);
});

test("global discussion moderation retains every action and a searchable series selector", async () => {
  const [operations, route] = await Promise.all([
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  for (const action of [
    "EDIT",
    "HIDE",
    "RESTORE",
    "DELETE",
    "PIN",
    "UNPIN",
    "BAN_SERIES",
    "UNBAN_SERIES",
    "SUSPEND_USER",
  ]) {
    assert.match(operations, new RegExp(`"${action}"`, "u"));
  }
  assert.match(operations, /<AdminCombobox/u);
  assert.match(operations, /ariaLabel="Search and choose a series discussion"/u);
  assert.match(operations, /!embedded \? \(/u);
  assert.match(route, /section === "comments"/u);
  assert.match(route, /isGlobalModerator\(actor\)[\s\S]{0,180}FROM series/u);
  assert.match(route, /requireSeriesModerator\(actor, payload\.seriesSlug\)/u);
});
