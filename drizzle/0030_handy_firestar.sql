PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_user_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`category` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`moderated_by_user_id` text,
	`moderated_at` text,
	`resolution_note` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moderated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "reports_status_check" CHECK("__new_reports"."status" IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'))
);
--> statement-breakpoint
INSERT INTO `__new_reports`
  ("id", "reporter_user_id", "target_type", "target_id", "category",
   "detail", "status", "created_at", "updated_at")
SELECT "id", "reporter_user_id", "target_type", "target_id", "category",
       "detail", "status", "created_at", "updated_at"
  FROM `reports`;--> statement-breakpoint
DROP TABLE `reports`;--> statement-breakpoint
ALTER TABLE `__new_reports` RENAME TO `reports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `reports_queue_idx` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_target_idx` ON `reports` (`target_type`,`target_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `reports_series_insert_guard`
BEFORE INSERT ON `reports`
WHEN NEW.`target_type` = 'SERIES' AND NEW.`reporter_user_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Series report rate limit exceeded.')
   WHERE (
    SELECT COUNT(*)
      FROM `reports`
     WHERE `reporter_user_id` = NEW.`reporter_user_id`
       AND `target_type` = 'SERIES'
       AND datetime(`created_at`) >= datetime('now', '-1 hour')
  ) >= 5;

  SELECT RAISE(ABORT, 'Active series report already exists.')
   WHERE EXISTS (
    SELECT 1
      FROM `reports`
     WHERE `reporter_user_id` = NEW.`reporter_user_id`
       AND `target_type` = 'SERIES'
       AND `target_id` = NEW.`target_id`
       AND `category` = NEW.`category`
       AND `status` IN ('OPEN', 'IN_REVIEW')
  );
END;--> statement-breakpoint
CREATE TRIGGER `reports_series_update_guard`
BEFORE UPDATE OF `reporter_user_id`, `target_type`, `target_id`, `category`, `status`
ON `reports`
WHEN (
  NEW.`target_type` = 'SERIES'
  AND NEW.`reporter_user_id` IS NOT NULL
  AND NEW.`status` IN ('OPEN', 'IN_REVIEW')
  AND EXISTS (
    SELECT 1
      FROM `reports`
     WHERE `id` <> NEW.`id`
       AND `reporter_user_id` = NEW.`reporter_user_id`
       AND `target_type` = 'SERIES'
       AND `target_id` = NEW.`target_id`
       AND `category` = NEW.`category`
       AND `status` IN ('OPEN', 'IN_REVIEW')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Active series report already exists.');
END;
