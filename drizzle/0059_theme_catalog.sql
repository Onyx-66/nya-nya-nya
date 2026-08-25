CREATE TABLE `theme_catalog_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`settings_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "theme_catalog_settings_id_check" CHECK("theme_catalog_settings"."id" = 'active'),
	CONSTRAINT "theme_catalog_settings_schema_check" CHECK("theme_catalog_settings"."schema_version" = 1),
	CONSTRAINT "theme_catalog_settings_revision_check" CHECK("theme_catalog_settings"."revision" >= 1)
);
