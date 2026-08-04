ALTER TABLE `series_gallery_assets` ADD `cover_type` text;--> statement-breakpoint
UPDATE `series_gallery_assets`
   SET `language` = COALESCE(
         NULLIF(TRIM(`language`), ''),
         (
           SELECT `original_language`
             FROM `series`
            WHERE `series`.`id` = `series_gallery_assets`.`series_id`
         ),
         'en'
       ),
       `cover_type` = 'OFFICIAL'
 WHERE `kind` = 'COVER';--> statement-breakpoint
CREATE TRIGGER `series_gallery_cover_metadata_insert_guard`
BEFORE INSERT ON `series_gallery_assets`
WHEN (
  (
    NEW.`kind` = 'COVER'
    AND (
      NEW.`orientation` <> 'PORTRAIT'
      OR NEW.`language` IS NULL
      OR LENGTH(TRIM(NEW.`language`)) = 0
      OR NEW.`cover_type` IS NULL
      OR NEW.`cover_type` NOT IN ('OFFICIAL', 'FAN_MADE')
    )
  )
  OR (
    NEW.`kind` = 'ART'
    AND NEW.`cover_type` IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Series covers require portrait format, language, and a valid cover type.'
  );
END;--> statement-breakpoint
CREATE TRIGGER `series_gallery_cover_metadata_update_guard`
BEFORE UPDATE OF `kind`, `orientation`, `language`, `cover_type`
ON `series_gallery_assets`
WHEN (
  (
    NEW.`kind` = 'COVER'
    AND (
      NEW.`orientation` <> 'PORTRAIT'
      OR NEW.`language` IS NULL
      OR LENGTH(TRIM(NEW.`language`)) = 0
      OR NEW.`cover_type` IS NULL
      OR NEW.`cover_type` NOT IN ('OFFICIAL', 'FAN_MADE')
    )
  )
  OR (
    NEW.`kind` = 'ART'
    AND NEW.`cover_type` IS NOT NULL
  )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Series covers require portrait format, language, and a valid cover type.'
  );
END;--> statement-breakpoint
UPDATE `chapters`
   SET `comments_enabled` = 1
 WHERE `comments_enabled` <> 1;--> statement-breakpoint
UPDATE `upload_job_items`
   SET `comments_enabled` = 1
 WHERE `comments_enabled` <> 1;--> statement-breakpoint
CREATE TRIGGER `chapters_comments_enabled_insert_guard`
BEFORE INSERT ON `chapters`
WHEN NEW.`comments_enabled` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Chapter comments must remain enabled.');
END;--> statement-breakpoint
CREATE TRIGGER `chapters_comments_enabled_update_guard`
BEFORE UPDATE OF `comments_enabled` ON `chapters`
WHEN NEW.`comments_enabled` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Chapter comments must remain enabled.');
END;--> statement-breakpoint
CREATE TRIGGER `upload_items_comments_enabled_insert_guard`
BEFORE INSERT ON `upload_job_items`
WHEN NEW.`comments_enabled` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Upload comments must remain enabled.');
END;--> statement-breakpoint
CREATE TRIGGER `upload_items_comments_enabled_update_guard`
BEFORE UPDATE OF `comments_enabled` ON `upload_job_items`
WHEN NEW.`comments_enabled` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Upload comments must remain enabled.');
END;--> statement-breakpoint
CREATE INDEX `reports_target_idx` ON `reports` (`target_type`,`target_id`,`status`,`created_at`);
