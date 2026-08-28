ALTER TABLE `team_creation_requests` ADD COLUMN `logo_key` text;
--> statement-breakpoint
ALTER TABLE `team_creation_requests` ADD COLUMN `banner_key` text;
--> statement-breakpoint
ALTER TABLE `team_creation_requests` ADD COLUMN `external_links_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `team_creation_requests` ADD COLUMN `member_emails_json` text DEFAULT '[]' NOT NULL;
