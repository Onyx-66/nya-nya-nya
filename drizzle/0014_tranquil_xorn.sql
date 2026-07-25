CREATE TABLE `upload_job_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`client_key` text NOT NULL,
	`source_label` text NOT NULL,
	`series_id` text NOT NULL,
	`team_id` text,
	`chapter_id` text,
	`volume` text,
	`chapter_number` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`release_notes` text DEFAULT '' NOT NULL,
	`credits_json` text DEFAULT '{}' NOT NULL,
	`access_type` text DEFAULT 'FREE' NOT NULL,
	`price_onyx` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`scheduled_at` text,
	`comments_enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `upload_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "upload_job_items_status_check" CHECK("upload_job_items"."status" IN (
        'DRAFT',
        'UPLOADING',
        'READY',
        'PENDING_REVIEW',
        'PUBLISHED',
        'SCHEDULED',
        'REJECTED',
        'FAILED',
        'CANCELLED'
      )),
	CONSTRAINT "upload_job_items_access_check" CHECK(("upload_job_items"."access_type" = 'FREE' AND "upload_job_items"."price_onyx" = 0)
        OR ("upload_job_items"."access_type" = 'PAID' AND "upload_job_items"."price_onyx" > 0)),
	CONSTRAINT "upload_job_items_visibility_check" CHECK("upload_job_items"."visibility" IN ('PUBLIC', 'UNLISTED', 'HIDDEN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_job_items_client_uidx` ON `upload_job_items` (`job_id`,`client_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `upload_job_items_release_uidx` ON `upload_job_items` (`job_id`,`chapter_number`,`language`,`version`);--> statement-breakpoint
CREATE INDEX `upload_job_items_status_idx` ON `upload_job_items` (`job_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `upload_job_items_chapter_idx` ON `upload_job_items` (`chapter_id`);--> statement-breakpoint
CREATE TABLE `upload_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text,
	`series_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_type` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`idempotency_key` text NOT NULL,
	`publish_idempotency_key` text,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`last_error_message` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL,
	`submitted_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "upload_jobs_kind_check" CHECK("upload_jobs"."kind" IN ('SINGLE', 'BATCH')),
	CONSTRAINT "upload_jobs_source_check" CHECK("upload_jobs"."source_type" IN ('DIRECT_IMAGES', 'DIRECT_FOLDER')),
	CONSTRAINT "upload_jobs_status_check" CHECK("upload_jobs"."status" IN (
        'DRAFT',
        'UPLOADING',
        'VALIDATING',
        'READY',
        'PUBLISHING',
        'PENDING_REVIEW',
        'PUBLISHED',
        'SCHEDULED',
        'REJECTED',
        'FAILED',
        'CANCELLED'
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upload_jobs_user_idempotency_uidx` ON `upload_jobs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `upload_jobs_publish_idempotency_uidx` ON `upload_jobs` (`user_id`,`publish_idempotency_key`) WHERE "upload_jobs"."publish_idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `upload_jobs_user_status_idx` ON `upload_jobs` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `upload_jobs_team_status_idx` ON `upload_jobs` (`team_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `upload_jobs_series_idx` ON `upload_jobs` (`series_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `upload_jobs_expiry_idx` ON `upload_jobs` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `upload_publish_guards` (
	`job_id` text PRIMARY KEY NOT NULL,
	`verified` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `upload_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "upload_publish_guards_verified_check" CHECK("upload_publish_guards"."verified" = 1)
);
--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `upload_job_id` text REFERENCES upload_jobs(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `upload_job_item_id` text REFERENCES upload_job_items(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `source_path` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `page_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_sessions` ADD `expires_at` text;--> statement-breakpoint
CREATE INDEX `uploads_job_idx` ON `upload_sessions` (`upload_job_id`,`upload_job_item_id`,`page_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_item_path_uidx` ON `upload_sessions` (`upload_job_item_id`,`source_path`) WHERE "upload_sessions"."upload_job_item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_item_page_uidx` ON `upload_sessions` (`upload_job_item_id`,`page_index`) WHERE "upload_sessions"."upload_job_item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_item_sha_uidx` ON `upload_sessions` (`upload_job_item_id`,`sha256`) WHERE "upload_sessions"."upload_job_item_id" IS NOT NULL AND "upload_sessions"."sha256" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `upload_jobs_immutable_scope_guard_v14`
BEFORE UPDATE ON `upload_jobs`
WHEN NEW.`user_id` <> OLD.`user_id`
  OR NEW.`series_id` <> OLD.`series_id`
  OR COALESCE(NEW.`team_id`, '') <> COALESCE(OLD.`team_id`, '')
  OR NEW.`kind` <> OLD.`kind`
  OR NEW.`source_type` <> OLD.`source_type`
  OR NEW.`idempotency_key` <> OLD.`idempotency_key`
BEGIN
  SELECT RAISE(ABORT, 'upload_job_scope_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `upload_jobs_status_transition_guard_v14`
BEFORE UPDATE OF `status` ON `upload_jobs`
WHEN NEW.`status` <> OLD.`status`
  AND NOT (
    (OLD.`status` = 'DRAFT'
      AND NEW.`status` IN ('UPLOADING', 'FAILED', 'CANCELLED'))
    OR (OLD.`status` = 'UPLOADING'
      AND NEW.`status` IN ('READY', 'FAILED', 'CANCELLED'))
    OR (OLD.`status` = 'READY'
      AND NEW.`status` IN ('UPLOADING', 'PUBLISHING', 'FAILED', 'CANCELLED'))
    OR (OLD.`status` = 'PUBLISHING'
      AND NEW.`status` IN ('PENDING_REVIEW', 'PUBLISHED', 'SCHEDULED'))
    OR (OLD.`status` = 'PENDING_REVIEW'
      AND NEW.`status` IN ('PUBLISHED', 'SCHEDULED', 'REJECTED'))
    OR (OLD.`status` = 'FAILED'
      AND NEW.`status` IN ('UPLOADING', 'CANCELLED'))
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_upload_job_status_transition');
END;--> statement-breakpoint
CREATE TRIGGER `upload_job_items_scope_insert_guard_v14`
BEFORE INSERT ON `upload_job_items`
WHEN NOT EXISTS (
  SELECT 1
    FROM `upload_jobs` job
   WHERE job.`id` = NEW.`job_id`
     AND job.`series_id` = NEW.`series_id`
     AND COALESCE(job.`team_id`, '') = COALESCE(NEW.`team_id`, '')
)
BEGIN
  SELECT RAISE(ABORT, 'upload_item_scope_mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `upload_job_items_scope_update_guard_v14`
BEFORE UPDATE ON `upload_job_items`
WHEN NEW.`job_id` <> OLD.`job_id`
  OR NEW.`series_id` <> OLD.`series_id`
  OR COALESCE(NEW.`team_id`, '') <> COALESCE(OLD.`team_id`, '')
  OR NEW.`client_key` <> OLD.`client_key`
BEGIN
  SELECT RAISE(ABORT, 'upload_item_scope_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `upload_sessions_job_insert_guard_v14`
BEFORE INSERT ON `upload_sessions`
WHEN (NEW.`upload_job_id` IS NULL) <> (NEW.`upload_job_item_id` IS NULL)
  OR (
    NEW.`upload_job_id` IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM `upload_job_items` item
       WHERE item.`id` = NEW.`upload_job_item_id`
         AND item.`job_id` = NEW.`upload_job_id`
         AND COALESCE(item.`team_id`, '') = COALESCE(NEW.`team_id`, '')
    )
  )
  OR (
    NEW.`upload_job_id` IS NOT NULL
    AND (
      NEW.`page_index` < 0
      OR NEW.`byte_size` < 0
      OR (
        NEW.`status` = 'READY'
        AND (
          NEW.`sha256` IS NULL
          OR NEW.`width` IS NULL
          OR NEW.`height` IS NULL
          OR NEW.`width` < 1
          OR NEW.`height` < 1
          OR NEW.`byte_size` < 1
        )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_upload_session');
END;--> statement-breakpoint
CREATE TRIGGER `upload_sessions_job_update_guard_v14`
BEFORE UPDATE ON `upload_sessions`
WHEN COALESCE(NEW.`upload_job_id`, '') <> COALESCE(OLD.`upload_job_id`, '')
  OR COALESCE(NEW.`upload_job_item_id`, '') <>
      COALESCE(OLD.`upload_job_item_id`, '')
  OR (
    NEW.`status` = 'READY'
    AND (
      NEW.`sha256` IS NULL
      OR NEW.`width` IS NULL
      OR NEW.`height` IS NULL
      OR NEW.`width` < 1
      OR NEW.`height` < 1
      OR NEW.`byte_size` < 1
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_upload_session_update');
END;--> statement-breakpoint
CREATE TRIGGER `chapters_release_identity_insert_guard_v14`
BEFORE INSERT ON `chapters`
WHEN NEW.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  AND EXISTS (
    SELECT 1
      FROM `chapters` existing
     WHERE existing.`series_id` = NEW.`series_id`
       AND existing.`chapter_number` = NEW.`chapter_number`
       AND existing.`language` = NEW.`language`
       AND COALESCE(existing.`team_id`, '') = COALESCE(NEW.`team_id`, '')
       AND existing.`version` = NEW.`version`
       AND existing.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_chapter_release');
END;--> statement-breakpoint
CREATE TRIGGER `chapters_release_identity_update_guard_v14`
BEFORE UPDATE OF `series_id`, `chapter_number`, `language`, `team_id`, `version`, `state`
ON `chapters`
WHEN NEW.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  AND EXISTS (
    SELECT 1
      FROM `chapters` existing
     WHERE existing.`id` <> OLD.`id`
       AND existing.`series_id` = NEW.`series_id`
       AND existing.`chapter_number` = NEW.`chapter_number`
       AND existing.`language` = NEW.`language`
       AND COALESCE(existing.`team_id`, '') = COALESCE(NEW.`team_id`, '')
       AND existing.`version` = NEW.`version`
       AND existing.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_chapter_release');
END;--> statement-breakpoint
CREATE TRIGGER `upload_review_publish_sync_v14`
AFTER UPDATE OF `state` ON `chapters`
WHEN OLD.`state` = 'READY_FOR_REVIEW'
  AND NEW.`state` = 'PUBLISHED'
BEGIN
  UPDATE `upload_job_items`
     SET `status` = 'PUBLISHED',
         `revision` = `revision` + 1,
         `updated_at` = CURRENT_TIMESTAMP
   WHERE `chapter_id` = NEW.`id`
     AND `status` = 'PENDING_REVIEW';

  UPDATE `upload_jobs`
     SET `status` = 'PUBLISHED',
         `revision` = `revision` + 1,
         `completed_at` = CURRENT_TIMESTAMP,
         `updated_at` = CURRENT_TIMESTAMP
   WHERE `id` IN (
     SELECT item.`job_id`
       FROM `upload_job_items` item
      WHERE item.`chapter_id` = NEW.`id`
   )
     AND `status` = 'PENDING_REVIEW'
     AND NOT EXISTS (
       SELECT 1
         FROM `upload_job_items` pending
        WHERE pending.`job_id` = `upload_jobs`.`id`
          AND pending.`status` <> 'PUBLISHED'
     );
END;--> statement-breakpoint
CREATE TRIGGER `upload_review_reject_sync_v14`
AFTER UPDATE OF `state` ON `chapters`
WHEN OLD.`state` = 'READY_FOR_REVIEW'
  AND NEW.`state` = 'DRAFT'
BEGIN
  UPDATE `upload_job_items`
     SET `status` = 'REJECTED',
         `error_code` = 'REVIEW_RETURNED',
         `error_message` = 'The release was returned by review.',
         `revision` = `revision` + 1,
         `updated_at` = CURRENT_TIMESTAMP
   WHERE `chapter_id` = NEW.`id`
     AND `status` = 'PENDING_REVIEW';

  UPDATE `upload_jobs`
     SET `status` = 'REJECTED',
         `last_error_code` = 'REVIEW_RETURNED',
         `last_error_message` = 'One or more releases were returned by review.',
         `revision` = `revision` + 1,
         `completed_at` = CURRENT_TIMESTAMP,
         `updated_at` = CURRENT_TIMESTAMP
   WHERE `id` IN (
     SELECT item.`job_id`
       FROM `upload_job_items` item
      WHERE item.`chapter_id` = NEW.`id`
   )
     AND `status` = 'PENDING_REVIEW';
END;
