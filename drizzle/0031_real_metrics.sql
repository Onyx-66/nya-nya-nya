UPDATE `series`
   SET `follower_count` = (
         SELECT COUNT(*)
           FROM `follows`
          WHERE `follows`.`series_id` = `series`.`id`
       ),
       `view_count` = (
         SELECT COUNT(*)
           FROM `analytics_events`
          WHERE `analytics_events`.`event_type` = 'SERIES_VIEW'
            AND `analytics_events`.`series_slug` = `series`.`slug`
       ),
       `rating_tenths` = COALESCE((
         SELECT CAST(ROUND(AVG(`reviews`.`rating`) * 10) AS INTEGER)
           FROM `reviews`
          WHERE `reviews`.`series_id` = `series`.`id`
            AND `reviews`.`moderation_status` = 'VISIBLE'
       ), 0);
--> statement-breakpoint
CREATE TRIGGER `series_real_follow_count_insert_v42`
AFTER INSERT ON `follows`
BEGIN
  UPDATE `series`
     SET `follower_count` = (
       SELECT COUNT(*)
         FROM `follows`
        WHERE `series_id` = NEW.`series_id`
     )
   WHERE `id` = NEW.`series_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `series_real_follow_count_delete_v42`
AFTER DELETE ON `follows`
BEGIN
  UPDATE `series`
     SET `follower_count` = (
       SELECT COUNT(*)
         FROM `follows`
        WHERE `series_id` = OLD.`series_id`
     )
   WHERE `id` = OLD.`series_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `series_real_view_count_insert_v42`
AFTER INSERT ON `analytics_events`
WHEN NEW.`event_type` = 'SERIES_VIEW' AND NEW.`series_slug` IS NOT NULL
BEGIN
  UPDATE `series`
     SET `view_count` = (
       SELECT COUNT(*)
         FROM `analytics_events`
        WHERE `event_type` = 'SERIES_VIEW'
          AND `series_slug` = NEW.`series_slug`
     )
   WHERE `slug` = NEW.`series_slug`;
END;
--> statement-breakpoint
CREATE TRIGGER `series_real_rating_insert_v42`
AFTER INSERT ON `reviews`
BEGIN
  UPDATE `series`
     SET `rating_tenths` = COALESCE((
       SELECT CAST(ROUND(AVG(`rating`) * 10) AS INTEGER)
         FROM `reviews`
        WHERE `series_id` = NEW.`series_id`
          AND `moderation_status` = 'VISIBLE'
     ), 0)
   WHERE `id` = NEW.`series_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `series_real_rating_update_v42`
AFTER UPDATE ON `reviews`
BEGIN
  UPDATE `series`
     SET `rating_tenths` = COALESCE((
       SELECT CAST(ROUND(AVG(`rating`) * 10) AS INTEGER)
         FROM `reviews`
        WHERE `series_id` = `series`.`id`
          AND `moderation_status` = 'VISIBLE'
     ), 0)
   WHERE `id` IN (OLD.`series_id`, NEW.`series_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `series_real_rating_delete_v42`
AFTER DELETE ON `reviews`
BEGIN
  UPDATE `series`
     SET `rating_tenths` = COALESCE((
       SELECT CAST(ROUND(AVG(`rating`) * 10) AS INTEGER)
         FROM `reviews`
        WHERE `series_id` = OLD.`series_id`
          AND `moderation_status` = 'VISIBLE'
     ), 0)
   WHERE `id` = OLD.`series_id`;
END;
