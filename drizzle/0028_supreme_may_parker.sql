CREATE TABLE `upload_rate_limit_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`upload_job_id` text NOT NULL,
	`upload_job_item_id` text NOT NULL,
	`request_id` text NOT NULL,
	`byte_size` integer NOT NULL,
	`admitted` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "upload_rate_attempts_byte_size_check" CHECK("upload_rate_limit_attempts"."byte_size" > 0),
	CONSTRAINT "upload_rate_attempts_admitted_check" CHECK("upload_rate_limit_attempts"."admitted" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `upload_rate_attempts_user_created_idx` ON `upload_rate_limit_attempts` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `upload_rate_attempts_update_guard_v39`
BEFORE UPDATE ON `upload_rate_limit_attempts`
BEGIN
  SELECT RAISE(ABORT, 'immutable_upload_rate_attempt');
END;
--> statement-breakpoint
CREATE TRIGGER `upload_rate_attempts_recent_delete_guard_v39`
BEFORE DELETE ON `upload_rate_limit_attempts`
WHEN OLD.`created_at` >= datetime('now', '-1 day')
BEGIN
  SELECT RAISE(ABORT, 'recent_upload_rate_attempt');
END;
