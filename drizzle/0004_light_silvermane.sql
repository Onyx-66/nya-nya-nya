CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_type` text NOT NULL,
	`series_slug` text,
	`chapter_slug` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "analytics_events_type_check" CHECK("analytics_events"."event_type" IN (
        'HOME_VIEW',
        'LATEST_VIEW',
        'BROWSE_VIEW',
        'SERIES_VIEW',
        'CHAPTER_START',
        'CHAPTER_COMPLETE'
      ))
);
--> statement-breakpoint
CREATE INDEX `analytics_events_time_idx` ON `analytics_events` (`created_at`,`event_type`);--> statement-breakpoint
CREATE INDEX `analytics_events_session_idx` ON `analytics_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_series_idx` ON `analytics_events` (`series_slug`,`created_at`);