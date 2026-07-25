import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  deleteMediaObject,
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  retryPendingMediaCleanup,
} from "../lib/server/media-cleanup.ts";
import { randomId } from "../lib/server/random-id.ts";

function cleanupDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE media_cleanup_queue (
      id TEXT PRIMARY KEY NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      media_kind TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'FAILED')),
      last_error TEXT,
      failed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      action TEXT NOT NULL,
      category TEXT NOT NULL,
      source_area TEXT NOT NULL,
      result TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_label TEXT,
      reason TEXT,
      request_id TEXT NOT NULL,
      metadata_json TEXT
    );
  `);
  return database;
}

function d1Adapter(database) {
  function prepare(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return {
          success: true,
          meta: { changes: Number(result.changes) },
        };
      },
      async all() {
        return {
          success: true,
          results: database.prepare(sql).all(...bindings),
          meta: { changes: 0 },
        };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      const results = [];
      database.exec("BEGIN");
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function cleanupBucket(failuresBeforeSuccess = Number.POSITIVE_INFINITY) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async delete() {
      calls += 1;
      if (calls <= failuresBeforeSuccess) {
        throw new Error(`temporary storage failure ${calls}`);
      }
    },
  };
}

const cleanupContext = {
  mediaKind: "SERIES_COVER",
  targetType: "SERIES",
  targetId: "series_cleanup_fixture",
  reason: "Replaced series cover",
};

async function withoutRandomUuid(callback) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const runtimeCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    enumerable: true,
    value: {
      getRandomValues: runtimeCrypto.getRandomValues.bind(runtimeCrypto),
    },
  });
  try {
    return await callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "crypto", descriptor);
    }
  }
}

test("failed media deletion queues once and a later retry clears it", async () => {
  const database = cleanupDatabase();
  const db = d1Adapter(database);
  const bucket = cleanupBucket(1);
  try {
    assert.equal(
      await withoutRandomUuid(() =>
        deleteMediaObject(
          db,
          bucket,
          "series/cleanup-fixture/old-cover.webp",
          cleanupContext,
          randomId,
        ),
      ),
      false,
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            `SELECT attempts, status, failed_at AS failedAt
               FROM media_cleanup_queue`,
          )
          .get(),
      },
      { attempts: 1, status: "PENDING", failedAt: null },
    );

    assert.deepEqual(await retryPendingMediaCleanup(db, bucket, randomId), {
      selected: 1,
      succeeded: 1,
      failed: 0,
    });
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS count FROM media_cleanup_queue")
        .get().count,
      0,
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count,
      0,
    );
    assert.equal(bucket.calls, 2);
  } finally {
    database.close();
  }
});

test("media cleanup becomes a single owner-visible dead letter at the retry limit", async () => {
  const database = cleanupDatabase();
  const db = d1Adapter(database);
  const bucket = cleanupBucket();
  const objectKey = "series/cleanup-fixture/orphaned-banner.webp";
  try {
    assert.equal(
      await deleteMediaObject(
        db,
        bucket,
        objectKey,
        cleanupContext,
        randomId,
      ),
      false,
    );
    for (
      let attempt = 1;
      attempt < MEDIA_CLEANUP_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const result = await retryPendingMediaCleanup(
        db,
        bucket,
        randomId,
      );
      assert.deepEqual(result, {
        selected: 1,
        succeeded: 0,
        failed: 1,
      });
    }

    const deadLetter = database
      .prepare(
        `SELECT attempts, status, last_error AS lastError,
                failed_at AS failedAt
           FROM media_cleanup_queue
          WHERE object_key = ?`,
      )
      .get(objectKey);
    assert.equal(deadLetter.attempts, MEDIA_CLEANUP_MAX_ATTEMPTS);
    assert.equal(deadLetter.status, "FAILED");
    assert.match(deadLetter.lastError, /temporary storage failure 10/);
    assert.ok(deadLetter.failedAt);

    const audit = database
      .prepare(
        `SELECT action, category, source_area AS sourceArea, result,
                target_type AS targetType, target_id AS targetId,
                metadata_json AS metadataJson
           FROM audit_logs`,
      )
      .get();
    assert.deepEqual(
      {
        action: audit.action,
        category: audit.category,
        sourceArea: audit.sourceArea,
        result: audit.result,
        targetType: audit.targetType,
        targetId: audit.targetId,
      },
      {
        action: "media.cleanup.dead_letter",
        category: "SYSTEM_MAINTENANCE",
        sourceArea: "MEDIA_CLEANUP",
        result: "FAILURE",
        targetType: cleanupContext.targetType,
        targetId: cleanupContext.targetId,
      },
    );
    assert.deepEqual(JSON.parse(audit.metadataJson), {
      queueId: database
        .prepare(
          "SELECT id FROM media_cleanup_queue WHERE object_key = ?",
        )
        .get(objectKey).id,
      queueStatus: "FAILED",
      attempts: MEDIA_CLEANUP_MAX_ATTEMPTS,
      maxAttempts: MEDIA_CLEANUP_MAX_ATTEMPTS,
      objectKey,
      mediaKind: cleanupContext.mediaKind,
      cleanupReason: cleanupContext.reason,
      failedAt: deadLetter.failedAt,
    });

    assert.deepEqual(await retryPendingMediaCleanup(db, bucket, randomId), {
      selected: 0,
      succeeded: 0,
      failed: 0,
    });
    assert.equal(bucket.calls, MEDIA_CLEANUP_MAX_ATTEMPTS);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count,
      1,
    );
  } finally {
    database.close();
  }
});
