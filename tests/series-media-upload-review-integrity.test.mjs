import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../", import.meta.url);

function read(path) {
  return readFile(new URL(path, root), "utf8");
}

test("series media classifies storage, database, and provider failures", async () => {
  const source = await read("app/api/v1/admin/series-media/route.ts");

  for (const code of [
    "MEDIA_DATABASE_READ_FAILED",
    "MEDIA_DATABASE_COMMIT_FAILED",
    "MEDIA_STORAGE_WRITE_FAILED",
    "IMPORTED_COVER_DOWNLOAD_FAILED",
    "MEDIA_REQUEST_FAILED",
  ]) {
    assert.match(source, new RegExp(`\\b${code}\\b`));
  }
  assert.match(source, /performMediaOperation[\s\S]*retryable: true/u);
  assert.match(
    source,
    /series_media_operation_failed[\s\S]*requestId[\s\S]*operation/u,
  );
  assert.equal((source.match(/bucket\.put\(/gu) ?? []).length, 2);
  assert.ok(
    (source.match(/performMediaOperation\(requestId, "storage\.write"/gu) ?? [])
      .length >= 2,
  );
  assert.ok(
    (source.match(/"database\.commit"/gu) ?? []).length >= 4,
  );
});

test("series media rollback is best-effort and preserves the primary request id", async () => {
  const source = await read("app/api/v1/admin/series-media/route.ts");

  assert.match(
    source,
    /const responseError = normalizeMediaError\(requestId, error\);[\s\S]*settleMediaObject\([\s\S]*"storage\.rollback"[\s\S]*errorResponse\(requestId, responseError\)/u,
  );
  assert.match(
    source,
    /Cleanup must never replace the primary failure[\s\S]*logMediaFailure\(requestId, operation, error\)/u,
  );
  assert.doesNotMatch(
    source,
    /catch \(error\) \{[\s\S]{0,450}await deleteMediaObject\(/u,
  );
});

test("uploader decisions are guarded by the successful chapter transition", async () => {
  const source = await read("app/api/v1/[...resource]/route.ts");
  const workflow = source.slice(source.indexOf("const nextState ="), source.indexOf("let reviewResults;", source.indexOf("const nextState =")));

  assert.match(source, /UPLOADER_APPROVAL_CONTEXT_MISSING/u);
  assert.match(source, /UPLOADER_APPROVAL_DECISION_REQUIRED/u);
  assert.match(
    source,
    /uploaderApprovalStatus !== "APPROVED"[\s\S]*payload\.action !== "SUBMIT"/u,
  );
  assert.match(workflow, /CASE WHEN changes\(\) = 1 THEN 1 ELSE NULL/u);

  const chapterUpdate = workflow.indexOf("UPDATE chapters");
  const guard = workflow.indexOf("INSERT INTO upload_publish_guards");
  const approval = workflow.indexOf("...uploaderDecisionStatements");
  const itemUpdate = workflow.indexOf("UPDATE upload_job_items");

  assert.ok(chapterUpdate >= 0, "chapter transition statement is present");
  assert.ok(guard > chapterUpdate, "guard follows the optimistic chapter update");
  assert.ok(approval > guard, "approval follows the successful-transition guard");
  assert.ok(itemUpdate > approval, "job item state follows the uploader decision");
  assert.match(
    source,
    /function uploaderReviewDecisionStatements[\s\S]*INSERT INTO uploader_approvals[\s\S]*INSERT INTO upload_review_events/u,
  );
  const decisionBuilder = source.slice(
    source.indexOf("function uploaderReviewDecisionStatements"),
    source.indexOf("const adminChapterAccessSchema"),
  );
  assert.match(
    decisionBuilder,
    /WHERE uploader_approvals\.revision = \?/u,
  );
  assert.ok(
    decisionBuilder.indexOf("UPDATE upload_publish_guards") >
      decisionBuilder.indexOf("INSERT INTO uploader_approvals"),
    "approval revision is verified through the transaction guard",
  );
  assert.ok(
    decisionBuilder.indexOf("INSERT INTO upload_review_events") >
      decisionBuilder.indexOf("UPDATE upload_publish_guards"),
    "the append-only event is written only after approval verification",
  );
  assert.ok(
    (source.match(/uploaderReviewDecisionStatements\(env\.DB/gu) ?? []).length >=
      3,
    "normal and replacement decisions share the guarded statement builder",
  );
});

test("uploader approval SQL rejects a stale concurrent decision", async () => {
  const source = await read("app/api/v1/[...resource]/route.ts");
  const decisionBuilder = source.slice(
    source.indexOf("function uploaderReviewDecisionStatements"),
    source.indexOf("const adminChapterAccessSchema"),
  );
  const statements = [...decisionBuilder.matchAll(/db\.prepare\(\s*`([\s\S]*?)`/gu)].map(
    (match) => match[1],
  );
  assert.equal(statements.length, 3);
  const [approvalSql, approvalGuardSql, eventSql] = statements;
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE upload_publish_guards (
        job_id TEXT PRIMARY KEY NOT NULL,
        verified INTEGER NOT NULL CHECK (verified = 1)
      );
      CREATE TABLE uploader_approvals (
        user_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        reviewed_by_user_id TEXT,
        reviewed_at TEXT,
        note TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE upload_review_events (
        id TEXT PRIMARY KEY NOT NULL,
        job_id TEXT NOT NULL,
        uploader_user_id TEXT NOT NULL,
        reviewer_user_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    database.exec("BEGIN");
    database
      .prepare("INSERT INTO upload_publish_guards (job_id, verified) VALUES (?, 1)")
      .run("job-first");
    database
      .prepare(approvalSql)
      .run("uploader", "APPROVED", "owner", "Approved", null);
    database.prepare(approvalGuardSql).run("job-first");
    database
      .prepare(eventSql)
      .run("event-first", "job-first", "uploader", "owner", "APPROVE", "Approved");
    database.exec("COMMIT");

    database.exec("BEGIN");
    database
      .prepare("INSERT INTO upload_publish_guards (job_id, verified) VALUES (?, 1)")
      .run("job-stale");
    database
      .prepare(approvalSql)
      .run("uploader", "REJECTED", "owner", "Stale", null);
    assert.throws(
      () => database.prepare(approvalGuardSql).run("job-stale"),
      /CHECK constraint failed/u,
    );
    database.exec("ROLLBACK");

    assert.deepEqual(
      {
        ...database
          .prepare("SELECT status, revision FROM uploader_approvals WHERE user_id = ?")
          .get("uploader"),
      },
      { status: "APPROVED", revision: 1 },
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM upload_review_events").get()
        .count,
      1,
    );
  } finally {
    database.close();
  }
});
