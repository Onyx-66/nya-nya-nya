import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("new uploads inherit Content Visibility while legacy drafts stay explicit", async () => {
  const [schema, workspace, route] = await Promise.all([
    read("lib/server/upload-jobs.ts"),
    read("components/nyascans/upload/UploadCenterWorkspace.tsx"),
    read("app/api/v1/upload-jobs/route.ts"),
  ]);

  assert.match(
    schema,
    /useVisibilityDefault:\s*z\.boolean\(\)\.default\(false\)/u,
  );
  assert.match(
    schema,
    /!value\.useVisibilityDefault[\s\S]*value\.accessType === "PAID"/u,
  );
  assert.match(
    schema,
    /visibilityDefaultItemIds:[\s\S]*\.default\(\[\]\)/u,
  );

  assert.match(
    workspace,
    /function newComposerItem[\s\S]*useVisibilityDefault:\s*true/u,
  );
  assert.match(
    workspace,
    /useVisibilityDefault:\s*item\.useVisibilityDefault \?\? false/u,
  );
  assert.match(workspace, /Global default/u);
  assert.match(
    workspace,
    /visibilityDefaultItemIds:\s*\(current\.items \?\? \[\]\)/u,
  );

  assert.match(route, /async function readVisibilityDefaults/u);
  assert.match(route, /resolveVisibilityDefault\(item, visibilityDefaults\)/u);
  assert.match(route, /visibilityDefaultsRevisionSql/u);
  assert.match(route, /uploadCreditsJson\(item\.credits, item\.useVisibilityDefault\)/u);
  assert.match(
    route,
    /credits_json = json_set\([\s\S]*'\$\.useVisibilityDefault'/u,
  );
});

test("upload publication schedules auto-free only for inherited paid chapters", async () => {
  const [uploadRoute, reviewRoute] = await Promise.all([
    read("app/api/v1/upload-jobs/route.ts"),
    read("app/api/v1/[...resource]/route.ts"),
  ]);

  assert.match(
    uploadRoute,
    /free_at, version,[\s\S]*uji\.access_type = 'PAID'[\s\S]*'\$\.useVisibilityDefault'[\s\S]*settings\.auto_free_after_days IS NOT NULL[\s\S]*datetime\([\s\S]*publishedAt/u,
  );
  assert.match(
    reviewRoute,
    /free_at = CASE[\s\S]*inherited_upload_item\.chapter_id = chapters\.id[\s\S]*'\$\.useVisibilityDefault'[\s\S]*auto_free_after_days/u,
  );

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE drafts (
        id TEXT PRIMARY KEY,
        access_type TEXT NOT NULL,
        credits_json TEXT NOT NULL
      );
      INSERT INTO drafts VALUES
        ('legacy', 'PAID', '{}'),
        ('explicit', 'PAID', '{"useVisibilityDefault":false}'),
        ('inherited', 'PAID', '{"useVisibilityDefault":true}');
    `);
    const inherited = database
      .prepare(
        `SELECT id,
                COALESCE(json_extract(credits_json, '$.useVisibilityDefault'), 0)
                  AS usesDefault,
                CASE
                  WHEN access_type = 'PAID'
                   AND COALESCE(
                     json_extract(credits_json, '$.useVisibilityDefault'), 0
                   ) = 1
                  THEN datetime('2026-08-10T12:00:00.000Z', '+7 days')
                  ELSE NULL
                END AS freeAt
           FROM drafts
          ORDER BY id`,
      )
      .all();

    assert.deepEqual(
      inherited.map((row) => ({ ...row })),
      [
        { id: "explicit", usesDefault: 0, freeAt: null },
        {
          id: "inherited",
          usesDefault: 1,
          freeAt: "2026-08-17 12:00:00",
        },
        { id: "legacy", usesDefault: 0, freeAt: null },
      ],
    );
  } finally {
    database.close();
  }
});
