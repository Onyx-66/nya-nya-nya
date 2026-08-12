import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

test("series requests use the shared searchable picker for eligible submitting teams", async () => {
  const workspace = await read(
    "components/nyascans/upload/SeriesRequestWorkspace.tsx",
  );

  assert.match(
    workspace,
    /<AdminCombobox[\s\S]*?value=\{teamId\}[\s\S]*?options=\{submittingTeamOptions\}[\s\S]*?onChange=\{setTeamId\}[\s\S]*?ariaLabel="Search eligible submitting teams"/u,
  );
  assert.match(
    workspace,
    /description: `\$\{team\.slug\} · \$\{team\.membershipRole\}`/u,
  );
  assert.doesNotMatch(
    workspace,
    /<span>Submitting team<\/span>[\s\S]{0,120}<select/u,
  );
});

test("single and batch uploads share searchable series and language pickers", async () => {
  const [workspace, css] = await Promise.all([
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("app/globals.css"),
  ]);

  assert.equal(
    workspace.match(/ariaLabel="Search eligible public series"/gu)?.length,
    2,
  );
  assert.equal(
    workspace.match(/options=\{eligibleSeriesComboboxOptions\}/gu)?.length,
    2,
  );
  assert.match(workspace, /if \(!seriesId\) throw new Error\("Choose a public series\."\)/u);
  assert.match(
    workspace,
    /ariaLabel="Chapter language"[\s\S]*?placeholder="Search languages…"/u,
  );
  assert.match(
    workspace,
    /uploadLanguages\.map\(\(\[code, flag, name\]\) => \(\{[\s\S]*?value: code,[\s\S]*?label: `\$\{flag\} \$\{name\}`/u,
  );
  assert.doesNotMatch(
    workspace,
    /<span>Language<\/span>[\s\S]{0,120}<select/u,
  );
  assert.match(css, /\.upload-combobox-field \.admin-combobox-list \{/u);
  assert.match(css, /max-height: 240px/u);
});

test("upload draft and series-request destructive actions use shared dialogs", async () => {
  const [uploads, requests] = await Promise.all([
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("components/nyascans/upload/SeriesRequestWorkspace.tsx"),
  ]);

  assert.doesNotMatch(uploads, /window\.confirm/u);
  assert.doesNotMatch(requests, /window\.confirm/u);
  assert.match(
    uploads,
    /open=\{Boolean\(pageRemovalPrompt\)\}[\s\S]*?confirmLabel="Remove page"/u,
  );
  assert.match(
    uploads,
    /open=\{discardPromptOpen\}[\s\S]*?confirmLabel="Discard draft"/u,
  );
  assert.match(
    requests,
    /open=\{pendingMutation !== null\}[\s\S]*?pendingMutation === "WITHDRAW" \? "Withdraw request" : "Delete draft"/u,
  );
  assert.match(requests, /\.\.\.\(action === "WITHDRAW" \? \{ reason \} : \{\}\)/u);
});
