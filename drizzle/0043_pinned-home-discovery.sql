DROP TRIGGER IF EXISTS `home_pinned_series_max_three_featured_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `home_pinned_series_max_three_featured_update`;
--> statement-breakpoint
WITH active_ranked AS (
  SELECT `id`,
         ROW_NUMBER() OVER (
           ORDER BY `display_order`, datetime(`created_at`), `id`
         ) AS active_rank
    FROM `home_pinned_series`
   WHERE (`starts_at` IS NULL OR datetime(`starts_at`) <= CURRENT_TIMESTAMP)
     AND (`ends_at` IS NULL OR datetime(`ends_at`) > CURRENT_TIMESTAMP)
)
UPDATE `home_pinned_series`
   SET `ends_at` = CURRENT_TIMESTAMP,
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `id` IN (
   SELECT `id` FROM active_ranked WHERE active_rank > 9
 );
--> statement-breakpoint
UPDATE `home_pinned_series`
   SET `is_featured` = 1,
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `is_featured` <> 1;
--> statement-breakpoint
CREATE TRIGGER `home_pinned_series_featured_only_insert_v483`
BEFORE INSERT ON `home_pinned_series`
WHEN NEW.`is_featured` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Every Pinned Series must be Featured');
END;
--> statement-breakpoint
CREATE TRIGGER `home_pinned_series_featured_only_update_v483`
BEFORE UPDATE OF `is_featured` ON `home_pinned_series`
WHEN NEW.`is_featured` <> 1
BEGIN
  SELECT RAISE(ABORT, 'Every Pinned Series must be Featured');
END;
--> statement-breakpoint
CREATE TRIGGER `home_pinned_series_max_nine_active_insert_v483`
BEFORE INSERT ON `home_pinned_series`
WHEN (NEW.`starts_at` IS NULL OR datetime(NEW.`starts_at`) <= CURRENT_TIMESTAMP)
 AND (NEW.`ends_at` IS NULL OR datetime(NEW.`ends_at`) > CURRENT_TIMESTAMP)
 AND (
   SELECT COUNT(*)
     FROM `home_pinned_series`
    WHERE (`starts_at` IS NULL OR datetime(`starts_at`) <= CURRENT_TIMESTAMP)
      AND (`ends_at` IS NULL OR datetime(`ends_at`) > CURRENT_TIMESTAMP)
 ) >= 9
BEGIN
  SELECT RAISE(ABORT, 'Pinned Series supports at most nine active items');
END;
--> statement-breakpoint
CREATE TRIGGER `home_pinned_series_max_nine_active_update_v483`
BEFORE UPDATE OF `starts_at`, `ends_at` ON `home_pinned_series`
WHEN (NEW.`starts_at` IS NULL OR datetime(NEW.`starts_at`) <= CURRENT_TIMESTAMP)
 AND (NEW.`ends_at` IS NULL OR datetime(NEW.`ends_at`) > CURRENT_TIMESTAMP)
 AND (
   SELECT COUNT(*)
     FROM `home_pinned_series`
    WHERE `id` <> OLD.`id`
      AND (`starts_at` IS NULL OR datetime(`starts_at`) <= CURRENT_TIMESTAMP)
      AND (`ends_at` IS NULL OR datetime(`ends_at`) > CURRENT_TIMESTAMP)
 ) >= 9
BEGIN
  SELECT RAISE(ABORT, 'Pinned Series supports at most nine active items');
END;
