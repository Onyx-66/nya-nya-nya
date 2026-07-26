INSERT OR IGNORE INTO `library_entries`
  (`user_id`, `series_id`, `list_type`, `is_favorite`, `notifications_enabled`)
SELECT `user_id`, `series_id`, 'PLANNING', 0, 1
  FROM `follows`;
--> statement-breakpoint
INSERT INTO `library_entries`
  (`user_id`, `series_id`, `list_type`, `is_favorite`, `notifications_enabled`)
SELECT DISTINCT rp.`user_id`, c.`series_id`, 'READING', 0, 1
  FROM `reading_progress` rp
  JOIN `chapters` c ON c.`id` = rp.`chapter_id`
 WHERE 1
ON CONFLICT(`user_id`, `series_id`) DO UPDATE SET
  `list_type` = CASE
    WHEN `library_entries`.`list_type` = 'PLANNING' THEN 'READING'
    ELSE `library_entries`.`list_type`
  END,
  `updated_at` = CURRENT_TIMESTAMP;
