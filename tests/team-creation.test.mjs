import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname;
const requesterApi = readFileSync(`${root}app/api/v1/team-creation-requests/route.ts`, "utf8");
const adminApi = readFileSync(`${root}app/api/v1/admin/team-requests/route.ts`, "utf8");
const upload = readFileSync(`${root}components/nyascans/upload/UploadCenterWorkspace.tsx`, "utf8");
const panel = readFileSync(`${root}components/nyascans/upload/TeamCreationPanel.tsx`, "utf8");
const schema = readFileSync(`${root}db/schema.ts`, "utf8");
const migration = readFileSync(`${root}drizzle/0061_team_creation_requests.sql`, "utf8");

test("Upload Center team creation follows submit-review-approve workflow", () => {
  assert.match(schema, /teamCreationRequests = sqliteTable\(/);
  assert.match(migration, /CREATE TABLE `team_creation_requests`/);
  assert.match(requesterApi, /createSchema = z\.object/);
  assert.match(requesterApi, /TEAM_CREATION_REQUEST_EXISTS/);
  assert.match(requesterApi, /team_creation_requests/);
  assert.match(requesterApi, /team\.creation\.request/);
  assert.match(upload, /\["create-team", "Create Team"/);
  assert.match(upload, /selectedMode === "create-team"/);
  assert.match(panel, /\/api\/v1\/team-creation-requests/);
  assert.match(panel, /Send for admin review/);
  assert.match(panel, /team leader and uploader/);
  assert.match(adminApi, /kind: z\.enum\(\["OWNERSHIP", "TITLE", "CREATION"\]\)/);
  assert.match(adminApi, /payload\.kind === "CREATION"/);
  assert.match(adminApi, /verification_status\)\s*\n\s*SELECT .*'VERIFIED'/);
  assert.match(adminApi, /membership_role.*'LEADER'/);
  assert.match(adminApi, /SELECT \?, 'TEAM_LEADER'/);
  assert.match(adminApi, /SELECT \?, 'UPLOADER'/);
  assert.match(adminApi, /Team creation approved/);
});
