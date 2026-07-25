export const MEDIA_CLEANUP_MAX_ATTEMPTS = 10;

export type MediaCleanupContext = {
  mediaKind: string;
  targetType: string;
  targetId: string;
  reason: string;
};

function safeCleanupError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Object storage deletion failed.";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

export async function deleteMediaObject(
  db: D1Database,
  bucket: R2Bucket,
  objectKey: string,
  context: MediaCleanupContext,
  idFactory: () => string,
) {
  try {
    await bucket.delete(objectKey);
    await db
      .prepare("DELETE FROM media_cleanup_queue WHERE object_key = ?")
      .bind(objectKey)
      .run()
      .catch(() => undefined);
    return true;
  } catch (error) {
    const queueId = idFactory();
    const errorSummary = safeCleanupError(error);
    await db
      .batch([
        db
          .prepare(
            `INSERT INTO media_cleanup_queue
             (id, object_key, media_kind, target_type, target_id, reason,
              attempts, status, last_error, failed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 'PENDING', ?, NULL,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(object_key) DO UPDATE SET
               media_kind = excluded.media_kind,
               target_type = excluded.target_type,
               target_id = excluded.target_id,
               reason = excluded.reason,
               attempts = media_cleanup_queue.attempts + 1,
               status = CASE
                 WHEN media_cleanup_queue.attempts + 1 >= ?
                   THEN 'FAILED'
                 ELSE 'PENDING'
               END,
               last_error = excluded.last_error,
               failed_at = CASE
                 WHEN media_cleanup_queue.attempts + 1 >= ?
                   THEN CURRENT_TIMESTAMP
                 ELSE NULL
               END,
               updated_at = CURRENT_TIMESTAMP
             WHERE media_cleanup_queue.status = 'PENDING'`,
          )
          .bind(
            queueId,
            objectKey,
            context.mediaKind,
            context.targetType,
            context.targetId,
            context.reason,
            errorSummary,
            MEDIA_CLEANUP_MAX_ATTEMPTS,
            MEDIA_CLEANUP_MAX_ATTEMPTS,
          ),
        db
          .prepare(
            `INSERT INTO audit_logs
             (id, action, category, source_area, result, target_type,
              target_id, target_label, reason, request_id, metadata_json)
             SELECT ?, 'media.cleanup.dead_letter', 'SYSTEM_MAINTENANCE',
                    'MEDIA_CLEANUP', 'FAILURE', queue.target_type,
                    queue.target_id, queue.media_kind,
                    'Object storage cleanup reached the retry limit and requires owner review.',
                    ?, json_object(
                      'queueId', queue.id,
                      'queueStatus', queue.status,
                      'attempts', queue.attempts,
                      'maxAttempts', ?,
                      'objectKey', queue.object_key,
                      'mediaKind', queue.media_kind,
                      'cleanupReason', queue.reason,
                      'failedAt', queue.failed_at
                    )
               FROM media_cleanup_queue queue
              WHERE changes() = 1
                AND queue.object_key = ?
                AND queue.status = 'FAILED'
                AND queue.attempts = ?`,
          )
          .bind(
            idFactory(),
            `media-cleanup-${idFactory()}`,
            MEDIA_CLEANUP_MAX_ATTEMPTS,
            objectKey,
            MEDIA_CLEANUP_MAX_ATTEMPTS,
          ),
      ])
      .catch(() => undefined);
    return false;
  }
}

export async function retryPendingMediaCleanup(
  db: D1Database,
  bucket: R2Bucket,
  idFactory: () => string,
  limit = 5,
) {
  const pending = await db
    .prepare(
      `SELECT object_key AS objectKey,
              media_kind AS mediaKind,
              target_type AS targetType,
              target_id AS targetId,
              reason
         FROM media_cleanup_queue
        WHERE status = 'PENDING'
          AND failed_at IS NULL
          AND attempts < ?
        ORDER BY created_at
        LIMIT ?`,
    )
    .bind(
      MEDIA_CLEANUP_MAX_ATTEMPTS,
      Math.max(1, Math.min(limit, 20)),
    )
    .all<{
      objectKey: string;
      mediaKind: string;
      targetType: string;
      targetId: string;
      reason: string;
    }>()
    .catch(() => ({ results: [] }));
  let succeeded = 0;
  let failed = 0;
  for (const entry of pending.results) {
    if (
      await deleteMediaObject(
        db,
        bucket,
        entry.objectKey,
        entry,
        idFactory,
      )
    ) {
      succeeded += 1;
    } else {
      failed += 1;
    }
  }
  return {
    selected: pending.results.length,
    succeeded,
    failed,
  };
}
