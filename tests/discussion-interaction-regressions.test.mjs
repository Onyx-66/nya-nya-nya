import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("an open reaction picker raises its owning comment stacking context", async () => {
  const [component, css] = await Promise.all([
    read("components/nyascans/EnhancedDiscussionSection.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(
    component,
    /reactionPickerId === comment\.id[\s\S]*?"is-reaction-picker-open"/u,
  );
  assert.match(
    css,
    /\.enhanced-comments \.comment-item\.is-reaction-picker-open\s*\{[\s\S]*?z-index:\s*101/u,
  );
  assert.match(
    css,
    /\.comment-item\.is-reaction-picker-open \.comment-reaction-picker-wrap[\s\S]*?z-index:\s*102/u,
  );
});

test("pinning accepts persisted opaque comment IDs and has route-specific validation", async () => {
  const api = await read("app/api/v1/[...resource]/route.ts");

  const schemaStart = api.indexOf("const discussionPinSchema");
  const schemaEnd = api.indexOf("const workspaceCommentModerationSchema", schemaStart);
  const pinSchema = api.slice(schemaStart, schemaEnd);
  assert.match(pinSchema, /commentId:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(160\)/u);
  assert.doesNotMatch(pinSchema, /\.uuid\(\)/u);
  assert.match(
    api,
    /path === "discussion-pin"[\s\S]*?"Choose a valid comment and pin state\."/u,
  );
});
