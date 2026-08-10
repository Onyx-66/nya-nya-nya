INSERT OR IGNORE INTO `custom_reactions`
  (`id`, `slug`, `name`, `accessible_label`, `emoji_fallback`, `is_active`, `is_archived`, `display_order`, `category`, `usage_kind`, `availability_json`)
VALUES
  ('reaction_v46_upvote', 'upvote', 'Upvote', 'Upvote', '👍', 1, 0, 0, 'Core', 'REACTION', '{"scope":"GLOBAL","teamIds":[]}'),
  ('reaction_laugh', 'laugh', 'Funny', 'Funny', '😂', 1, 0, 1, 'Core', 'REACTION', '{"scope":"GLOBAL","teamIds":[]}'),
  ('reaction_heart', 'heart', 'Love', 'Love', '❤️', 1, 0, 2, 'Core', 'REACTION', '{"scope":"GLOBAL","teamIds":[]}'),
  ('reaction_v46_surprised', 'surprised', 'Surprised', 'Surprised', '😮', 1, 0, 3, 'Core', 'REACTION', '{"scope":"GLOBAL","teamIds":[]}'),
  ('reaction_v46_angry', 'angry', 'Angry', 'Angry', '😠', 1, 0, 4, 'Core', 'REACTION', '{"scope":"GLOBAL","teamIds":[]}'),
  ('reaction_sad', 'sad', 'Sad', 'Sad', '😢', 1, 0, 5, 'Core', 'REACTION', '{"scope":"GLOBAL","teamIds":[]}');--> statement-breakpoint
UPDATE `custom_reactions`
SET `usage_kind` = 'REACTION',
    `is_active` = 1,
    `is_archived` = 0,
    `display_order` = CASE `slug`
      WHEN 'upvote' THEN 0
      WHEN 'laugh' THEN 1
      WHEN 'heart' THEN 2
      WHEN 'surprised' THEN 3
      WHEN 'angry' THEN 4
      WHEN 'sad' THEN 5
    END,
    `category` = 'Core',
    `availability_json` = '{"scope":"GLOBAL","teamIds":[]}',
    `updated_at` = CURRENT_TIMESTAMP
WHERE `slug` IN ('upvote', 'laugh', 'heart', 'surprised', 'angry', 'sad');
