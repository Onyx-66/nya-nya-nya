import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("administrator navigation exposes Series Submissions with source cross-check", async () => {
  const [navigation, panel, queue] = await Promise.all([
    read("lib/admin-navigation.ts"),
    read("components/nyascans/OperationsControlPanel.tsx"),
    read("components/nyascans/admin/NewSeriesQueuePanel.tsx"),
  ]);

  assert.match(
    navigation,
    /slug: "series-submissions"[\s\S]+label: "Series Submissions"/,
    "the administrator catalogue navigation should expose the queue",
  );
  assert.match(panel, /import \{ NewSeriesQueuePanel \}/);
  assert.match(
    panel,
    /section === "Series Submissions"[\s\S]*<NewSeriesQueuePanel \/>/,
  );
  assert.match(queue, /External metadata cross-check/);
  assert.match(queue, /MANGADEX/);
  assert.match(queue, /MANGAUPDATES/);
  assert.match(queue, /\/api\/v1\/admin\/series-requests/);
  assert.doesNotMatch(queue, /href=["']#["']/);
});

test("queue list uses server pagination and the complete operational filter set", async () => {
  const [queue, apiRoute] = await Promise.all([
    read("components/nyascans/admin/NewSeriesQueuePanel.tsx"),
    read("app/api/v1/admin/series-requests/route.ts"),
  ]);

  for (const filter of [
    "query",
    "status",
    "teamId",
    "reviewerId",
    "type",
    "duplicateRisk",
    "source",
    "from",
    "to",
    "page",
    "limit",
  ]) {
    assert.match(queue, new RegExp(`parameters\\.set\\("${filter}"`));
  }
  assert.match(queue, /pagination\.total/);
  assert.match(queue, /pagination\.pages/);
  assert.match(queue, /Previous queue page/);
  assert.match(queue, /Next queue page/);
  assert.match(queue, /window\.history\.replaceState/);
  assert.match(queue, /request\.assignedReviewer/);
  assert.match(queue, /request\.duplicateRiskScore/);
  assert.match(apiRoute, /requireAdminConsole\(actor\)/);
  assert.match(apiRoute, /queueCapabilities\(actor\)/);
  assert.match(apiRoute, /canApprove:\s*reviewer/);
  assert.match(apiRoute, /canReject:\s*reviewer/);
  assert.match(apiRoute, /canReply:\s*reviewer/);
  assert.match(apiRoute, /canStartReview:\s*fullAdministrator/);
  assert.match(apiRoute, /listAdminSeriesRequests/);
  assert.match(
    apiRoute,
    /options: await queueOptions\(capabilities\.canReassign\)/,
  );
});

test("request detail renders reviewed media, metadata, teams, sources, duplicates, feedback, and revisions", async () => {
  const queue = await read(
    "components/nyascans/admin/NewSeriesQueuePanel.tsx",
  );

  assert.match(queue, /detail\.coverUrl/);
  assert.match(queue, /detail\.bannerUrl/);
  assert.match(queue, /Submitted metadata/);
  assert.match(queue, /detail\.requestedTeams\.map/);
  assert.match(queue, /safeExternalUrl\(source\.sourceUrl\)/);
  assert.match(queue, /rel="noopener noreferrer"/);
  assert.match(queue, /detail\.duplicateMatches\.map/);
  assert.match(queue, /match\.exactExternalId/);
  assert.match(queue, /Use for attachment/);
  assert.match(queue, /detail\.feedback\.map/);
  assert.match(queue, /record\.visibility === "INTERNAL"/);
  assert.match(queue, /detail\.revisions\.map/);
  assert.match(queue, /revisionChanges/);
});

test("every review mutation is confirmed and revision-guarded", async () => {
  const [queue, schema] = await Promise.all([
    read("components/nyascans/admin/NewSeriesQueuePanel.tsx"),
    read("lib/series-requests.ts"),
  ]);

  for (const action of [
    "START_REVIEW",
    "ASSIGN_REVIEWER",
    "ADD_FEEDBACK",
    "REQUEST_CHANGES",
    "REJECT",
    "APPROVE",
    "ATTACH_EXISTING",
  ]) {
    assert.match(
      queue,
      new RegExp(`case "${action}"`),
      `${action} should have a real mutation branch`,
    );
    assert.match(
      schema,
      new RegExp(`z\\.literal\\("${action}"\\)`),
      `${action} should be validated by the shared server schema`,
    );
  }

  assert.match(queue, /expectedRevision: detail\.revision/);
  assert.match(queue, /<ConfirmActionDialog/);
  assert.match(queue, /setPendingAction\("START_REVIEW"\)/);
  assert.match(queue, /setPendingAction\("ASSIGN_REVIEWER"\)/);
  assert.match(queue, /setPendingAction\("ADD_FEEDBACK"\)/);
  assert.match(queue, /setPendingAction\("REQUEST_CHANGES"\)/);
  assert.match(queue, /setPendingAction\("REJECT"\)/);
  assert.match(queue, /setPendingAction\("APPROVE"\)/);
  assert.match(queue, /setPendingAction\("ATTACH_EXISTING"\)/);
  assert.match(queue, /error instanceof QueueApiError && error\.status === 409/);
  assert.match(queue, /The latest revision is being reloaded/);
});

test("approval UI distinguishes canonical creation from duplicate attachment and scopes team rights", async () => {
  const [queue, server] = await Promise.all([
    read("components/nyascans/admin/NewSeriesQueuePanel.tsx"),
    read("lib/server/series-request-admin.ts"),
  ]);

  assert.match(queue, /Approved team rights/);
  assert.match(queue, /canUpload/);
  assert.match(queue, /canPublish/);
  assert.match(queue, /uploadRequiresReview/);
  assert.match(queue, /allowedLanguages/);
  assert.match(queue, /filter\(\(right\) => right\.isPrimary\)\.length === 1/);
  assert.match(
    queue,
    /\/api\/v1\/admin\/series-management\?query=/,
    "attachment should search real canonical series",
  );
  assert.match(queue, /Approve new canonical series/);
  assert.match(queue, /Attach to an existing series/);
  assert.match(server, /validateTeamRights\(input\.teamRights/);
  assert.match(server, /findRequestDuplicates/);
  assert.match(server, /EXTERNAL_SOURCE_DUPLICATE/);
  assert.match(server, /Another reviewer decided this request first/);
});

test("queue layout has responsive list, detail, decision, and rights treatments", async () => {
  const css = await read("app/globals.css");

  for (const selector of [
    ".nsq-filter-panel",
    ".nsq-master-detail",
    ".nsq-request-list",
    ".nsq-detail-tabs",
    ".nsq-comparison-grid",
    ".nsq-feedback-timeline",
    ".nsq-rights-list",
    ".nsq-decision-grid",
  ]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(css, /@media \(max-width: 1000px\)[\s\S]*\.nsq-master-detail/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.nsq-filter-panel/);
  assert.match(css, /\.nsq-detail-tabs[\s\S]*overflow-x: auto/);
}
);
