ALTER TABLE `upload_job_items` ADD `replacement_chapter_id` text REFERENCES chapters(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX `upload_job_items_replacement_idx` ON `upload_job_items` (`replacement_chapter_id`,`status`);
