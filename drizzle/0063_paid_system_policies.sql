ALTER TABLE `content_visibility_settings` ADD COLUMN `mode` text DEFAULT 'NORMAL' NOT NULL;
--> statement-breakpoint
CREATE TABLE `series_paid_policies` (
  `series_id` text PRIMARY KEY NOT NULL REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
  `paid_chapter_count` integer DEFAULT 0 NOT NULL,
  `price_onyx` integer DEFAULT 50 NOT NULL,
  `auto_free_after_days` integer,
  `revision` integer DEFAULT 1 NOT NULL,
  `updated_by_user_id` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT `series_paid_policies_count_check` CHECK (`paid_chapter_count` >= 0),
  CONSTRAINT `series_paid_policies_price_check` CHECK (`price_onyx` > 0),
  CONSTRAINT `series_paid_policies_auto_free_check` CHECK (`auto_free_after_days` IS NULL OR `auto_free_after_days` BETWEEN 1 AND 3650)
);
--> statement-breakpoint
CREATE INDEX `series_paid_policies_updated_idx` ON `series_paid_policies` (`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `series_paid_policy_sync_after_chapter_insert`
AFTER INSERT ON `chapters`
WHEN (SELECT mode FROM `content_visibility_settings` WHERE id = 'active') = 'LAST_PAID'
BEGIN
  UPDATE `chapters`
     SET `access_type` = CASE WHEN id IN (
       SELECT id FROM (
         SELECT c.id, ROW_NUMBER() OVER (ORDER BY CAST(c.chapter_number AS REAL) DESC, datetime(COALESCE(c.published_at, c.created_at)) DESC, c.id DESC) rn
           FROM chapters c
          WHERE c.series_id = NEW.series_id AND c.state IN ('READY_FOR_REVIEW','PUBLISHED')
            AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = c.id)
       ) ranked WHERE rn <= COALESCE((SELECT NULLIF(paid_chapter_count, 0) FROM series_paid_policies WHERE series_id = NEW.series_id), 1)
     ) THEN 'PAID' ELSE 'FREE' END,
     `price_onyx` = CASE WHEN id IN (
       SELECT id FROM (
         SELECT c.id, ROW_NUMBER() OVER (ORDER BY CAST(c.chapter_number AS REAL) DESC, datetime(COALESCE(c.published_at, c.created_at)) DESC, c.id DESC) rn
           FROM chapters c
          WHERE c.series_id = NEW.series_id AND c.state IN ('READY_FOR_REVIEW','PUBLISHED')
            AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = c.id)
       ) ranked WHERE rn <= COALESCE((SELECT NULLIF(paid_chapter_count, 0) FROM series_paid_policies WHERE series_id = NEW.series_id), 1)
     ) THEN COALESCE((SELECT price_onyx FROM series_paid_policies WHERE series_id = NEW.series_id), 50) ELSE 0 END
   WHERE series_id = NEW.series_id AND state IN ('READY_FOR_REVIEW','PUBLISHED')
     AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = chapters.id);
END;
--> statement-breakpoint
CREATE TRIGGER `series_paid_policy_schedule_autofree_after_chapter_insert`
AFTER INSERT ON `chapters`
WHEN NEW.access_type = 'PAID' AND NEW.state = 'PUBLISHED' AND NEW.published_at IS NOT NULL
BEGIN
  UPDATE chapters SET free_at = datetime(NEW.published_at, '+' || COALESCE((SELECT auto_free_after_days FROM series_paid_policies WHERE series_id = NEW.series_id), (SELECT auto_free_after_days FROM content_visibility_settings WHERE id = 'active'), 7) || ' days') WHERE id = NEW.id AND free_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `series_paid_policy_sync_after_chapter_publish`
AFTER UPDATE OF `state`, `published_at` ON `chapters`
WHEN NEW.state = 'PUBLISHED' AND (SELECT mode FROM `content_visibility_settings` WHERE id = 'active') = 'LAST_PAID'
BEGIN
  UPDATE chapters
     SET access_type = CASE WHEN id IN (
       SELECT id FROM (
         SELECT c.id, ROW_NUMBER() OVER (ORDER BY CAST(c.chapter_number AS REAL) DESC, datetime(COALESCE(c.published_at, c.created_at)) DESC, c.id DESC) rn
           FROM chapters c
          WHERE c.series_id = NEW.series_id AND c.state IN ('READY_FOR_REVIEW','PUBLISHED')
            AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = c.id)
       ) ranked WHERE rn <= COALESCE((SELECT NULLIF(paid_chapter_count, 0) FROM series_paid_policies WHERE series_id = NEW.series_id), 1)
     ) THEN 'PAID' ELSE 'FREE' END,
     price_onyx = CASE WHEN id IN (
       SELECT id FROM (
         SELECT c.id, ROW_NUMBER() OVER (ORDER BY CAST(c.chapter_number AS REAL) DESC, datetime(COALESCE(c.published_at, c.created_at)) DESC, c.id DESC) rn
           FROM chapters c
          WHERE c.series_id = NEW.series_id AND c.state IN ('READY_FOR_REVIEW','PUBLISHED')
            AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = c.id)
       ) ranked WHERE rn <= COALESCE((SELECT NULLIF(paid_chapter_count, 0) FROM series_paid_policies WHERE series_id = NEW.series_id), 1)
     ) THEN COALESCE((SELECT price_onyx FROM series_paid_policies WHERE series_id = NEW.series_id), 50) ELSE 0 END
   WHERE series_id = NEW.series_id AND state IN ('READY_FOR_REVIEW','PUBLISHED')
     AND NOT EXISTS (SELECT 1 FROM content_visibility_overrides o WHERE o.chapter_id = chapters.id);
  UPDATE chapters SET free_at = datetime(published_at, '+' || COALESCE((SELECT auto_free_after_days FROM series_paid_policies WHERE series_id = NEW.series_id), (SELECT auto_free_after_days FROM content_visibility_settings WHERE id = 'active'), 7) || ' days') WHERE series_id = NEW.series_id AND access_type = 'PAID' AND state = 'PUBLISHED' AND published_at IS NOT NULL AND free_at IS NULL;
END;
