CREATE TABLE `user_custom_themes` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`theme_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`mutation_marker` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_custom_themes_id_check" CHECK(substr("user_custom_themes"."id", 1, 6) = 'theme_'
          AND length("user_custom_themes"."id") = 38
          AND substr("user_custom_themes"."id", 7) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "user_custom_themes_revision_check" CHECK("user_custom_themes"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `user_custom_themes_updated_idx` ON `user_custom_themes` (`user_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `theme_shortlist_json` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `theme_preference_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `theme_mutation_marker` text;--> statement-breakpoint
WITH `legacy_theme_documents` AS (
  SELECT
    `user_id`,
    CASE
      WHEN json_valid(`custom_theme_json`) THEN `custom_theme_json`
      WHEN json_valid(`settings_json`)
        AND json_valid(json_extract(`settings_json`, '$.themeBuilder.customTheme'))
      THEN json_extract(`settings_json`, '$.themeBuilder.customTheme')
      ELSE NULL
    END AS `theme_json`,
    `updated_at`
  FROM `user_preferences`
)
INSERT INTO `user_custom_themes`
  (`user_id`, `id`, `theme_json`, `revision`, `created_at`, `updated_at`)
SELECT
  `user_id`,
  'theme_' || lower(hex(randomblob(16))),
  `theme_json`,
  1,
  `updated_at`,
  `updated_at`
FROM `legacy_theme_documents`
WHERE `theme_json` IS NOT NULL
  AND json_extract(`theme_json`, '$.schemaVersion') = 1
  AND json_type(`theme_json`, '$.name') = 'text'
  AND length(trim(json_extract(`theme_json`, '$.name'))) BETWEEN 1 AND 48
  AND json_extract(`theme_json`, '$.type') IN ('dark', 'light')
  AND json_type(`theme_json`, '$.tokens') = 'object'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(`theme_json`)
    WHERE `key` NOT IN ('schemaVersion', 'name', 'type', 'tokens', 'logoColorOverride')
  )
  AND (SELECT count(*) FROM json_each(`theme_json`, '$.tokens')) = 39
  AND NOT EXISTS (
    SELECT 1 FROM json_each(`theme_json`, '$.tokens')
    WHERE `key` NOT IN (
      'textColor', 'mainBackground', 'accent', 'accentHover', 'accentActive',
      'accentL1', 'accentL1Hover', 'accentL1Active',
      'accentL2', 'accentL2Hover', 'accentL2Active',
      'accentL3', 'accentL3Hover', 'accentL3Active',
      'accentL4', 'accentL4Hover', 'accentL4Active',
      'accentL5', 'accentL5Hover', 'accentL5Active',
      'midTone', 'contrastL1', 'scrollbarColor', 'scrollbarColorHover',
      'buttonAccent', 'buttonAccentAlternate', 'primary', 'primaryL1',
      'primaryL2', 'statusRed', 'statusGreen', 'statusYellow', 'statusBlue',
      'statusPurple', 'statusGrey', 'indicationBlue', 'danger', 'dangerL1',
      'dangerL2'
    )
      OR `type` <> 'text'
      OR length(`value`) <> 7
      OR substr(`value`, 1, 1) <> '#'
      OR substr(`value`, 2) GLOB '*[^0-9A-Fa-f]*'
  );--> statement-breakpoint
UPDATE `user_preferences`
SET
  `theme` = 'custom:' || (
    SELECT `id`
    FROM `user_custom_themes`
    WHERE `user_custom_themes`.`user_id` = `user_preferences`.`user_id`
    ORDER BY `created_at` ASC, `id` ASC
    LIMIT 1
  ),
  `theme_shortlist_json` = '["nya-midnight","paper-daylight","slate-rain","dracula-bloom","custom:' || (
    SELECT `id`
    FROM `user_custom_themes`
    WHERE `user_custom_themes`.`user_id` = `user_preferences`.`user_id`
    ORDER BY `created_at` ASC, `id` ASC
    LIMIT 1
  ) || '"]'
WHERE lower(trim(`theme`)) = 'custom'
  AND EXISTS (
    SELECT 1
    FROM `user_custom_themes`
    WHERE `user_custom_themes`.`user_id` = `user_preferences`.`user_id`
  );--> statement-breakpoint
CREATE TRIGGER `user_custom_themes_limit_before_insert`
BEFORE INSERT ON `user_custom_themes`
FOR EACH ROW
WHEN (
  SELECT count(*)
  FROM `user_custom_themes`
  WHERE `user_id` = NEW.`user_id`
) >= 15
BEGIN
  SELECT RAISE(ABORT, 'CUSTOM_THEME_LIMIT_REACHED');
END;
