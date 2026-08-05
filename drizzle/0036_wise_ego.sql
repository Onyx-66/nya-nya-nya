CREATE TABLE `chapter_access_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_job_id` text,
	`upload_job_item_id` text,
	`chapter_id` text NOT NULL,
	`series_id` text NOT NULL,
	`reference_chapter_id` text,
	`reference_chapter_number` text NOT NULL,
	`reason` text NOT NULL,
	`requested_access_type` text DEFAULT 'FREE' NOT NULL,
	`forced_price_onyx` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`resolved_by_user_id` text,
	`resolution_note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chapter_access_decisions_reason_check" CHECK("chapter_access_decisions"."reason" IN ('SAME_CHAPTER_VERSION', 'PREVIOUS_CHAPTER')),
	CONSTRAINT "chapter_access_decisions_status_check" CHECK("chapter_access_decisions"."status" IN ('PENDING', 'KEPT_PAID', 'MADE_FREE')),
	CONSTRAINT "chapter_access_decisions_price_check" CHECK("chapter_access_decisions"."forced_price_onyx" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_access_decisions_chapter_uidx` ON `chapter_access_decisions` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `chapter_access_decisions_status_idx` ON `chapter_access_decisions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `chapter_access_decisions_reference_idx` ON `chapter_access_decisions` (`reference_chapter_id`,`created_at`);
