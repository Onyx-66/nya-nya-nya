ALTER TABLE `series_requests` ADD `publication_year` integer
  CHECK (`publication_year` IS NULL OR `publication_year` BETWEEN 1800 AND 2200);--> statement-breakpoint
CREATE INDEX `metadata_import_source_action_time_idx`
  ON `metadata_import_logs` (`source`,`action`,`created_at`);
