import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const config = readFileSync(`${root}lib/site-configuration.ts`, "utf8");
const navigation = readFileSync(`${root}lib/admin-navigation.ts`, "utf8");
const permissions = readFileSync(`${root}lib/admin-permissions.ts`, "utf8");
const api = readFileSync(`${root}app/api/v1/[...resource]/route.ts`, "utf8");
const leaderboardApi = readFileSync(`${root}app/api/v1/leaderboard/route.ts`, "utf8");
const page = readFileSync(`${root}app/[...slug]/page.tsx`, "utf8");
const panel = readFileSync(`${root}components/nyascans/admin/LeaderboardSettingsPanel.tsx`, "utf8");
const leaderboard = readFileSync(`${root}components/nyascans/UserLeaderboardView.tsx`, "utf8");

test("Leaderboard settings are persisted, editable, and server-gated", () => {
  assert.match(config, /leaderboardSettingsSchema = z\.object/);
  assert.match(config, /isPublic: z\.boolean\(\)\.default\(true\)/);
  assert.match(config, /guidanceTitle: z\.string\(\)/);
  assert.match(config, /guidanceBody: z\.string\(\)/);
  assert.match(config, /leaderboard: \{ \.\.\.defaultSiteConfiguration\.leaderboard, \.\.\.input\.leaderboard \}/);
  assert.match(navigation, /slug: "leaderboard-settings"[\s\S]*label: "Leaderboard"[\s\S]*community\.leaderboard\.manage/);
  assert.match(permissions, /\["community\.leaderboard\.manage"/);
  assert.match(permissions, /leaderboard-settings.*community\.leaderboard\.manage/);
  assert.match(panel, /\/api\/v1\/admin\/leaderboard-settings/);
  assert.match(panel, /aria-label="Leaderboard visibility"/);
  assert.match(panel, /Guidance explanation/);
  assert.match(api, /path === "admin\/leaderboard-settings"/);
  assert.match(api, /settings: document\.settings\.leaderboard/);
  assert.match(api, /settings: leaderboardSettingsSchema/);
  assert.match(leaderboardApi, /siteConfiguration\.settings\.leaderboard\.isPublic/);
  assert.match(leaderboardApi, /LEADERBOARD_PRIVATE/);
  assert.match(page, /resolved\.view === "rankings"/);
  assert.match(page, /settings\.leaderboard\.isPublic/);
  assert.match(leaderboard, /settings\.leaderboard\.guidanceTitle/);
  assert.match(leaderboard, /settings\.leaderboard\.guidanceBody/);
});
