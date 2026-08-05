ALTER TABLE `chapters` ADD `include_fixed_first_page` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `include_fixed_last_page` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `can_control_fixed_reader_pages` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_job_items` ADD `include_fixed_first_page` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_job_items` ADD `include_fixed_last_page` integer DEFAULT true NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `teams`
  (`id`, `slug`, `name`, `description`, `verification_status`,
   `can_control_fixed_reader_pages`)
VALUES
  ('team_df536b7e-0982-4137-b1c5-1a1c37c5daa2', 'oceana-team', 'Oceana Team',
   'New team, Made by @oceana.queen', 'VERIFIED', 1);--> statement-breakpoint

UPDATE `teams`
   SET `can_control_fixed_reader_pages` =
       CASE WHEN `id` IN ('team_black_kite', 'team_df536b7e-0982-4137-b1c5-1a1c37c5daa2') THEN 1 ELSE 0 END
 WHERE `id` IN ('team_black_kite', 'team_lumen_house', 'team_df536b7e-0982-4137-b1c5-1a1c37c5daa2');--> statement-breakpoint

INSERT OR IGNORE INTO `users`
  (`id`, `email`, `display_name`, `primary_role`, `status`, `email_verified_at`)
VALUES
  ('fixture_uploader_black_kite', 'black-kite-uploader@fixtures.invalid', 'Mika · Black Kite', 'UPLOADER', 'ACTIVE', CURRENT_TIMESTAMP),
  ('fixture_uploader_lumen', 'lumen-uploader@fixtures.invalid', 'Sora · Lumen House', 'UPLOADER', 'ACTIVE', CURRENT_TIMESTAMP),
  ('fixture_uploader_oceana', 'oceana-team-uploader@fixtures.invalid', 'Oceana Team Studio', 'UPLOADER', 'ACTIVE', CURRENT_TIMESTAMP);--> statement-breakpoint

INSERT OR IGNORE INTO `user_roles` (`user_id`, `role`)
VALUES
  ('fixture_uploader_black_kite', 'UPLOADER'),
  ('fixture_uploader_lumen', 'UPLOADER'),
  ('fixture_uploader_oceana', 'UPLOADER');--> statement-breakpoint

INSERT OR IGNORE INTO `user_profiles`
  (`user_id`, `username`, `normalized_username`, `bio`,
   `profile_visibility`, `followers_visibility`, `show_comments`)
VALUES
  ('fixture_uploader_black_kite', 'black_kite_uploads', 'black_kite_uploads', 'Fixture uploader for Black Kite releases.', 'PUBLIC', 'PUBLIC', 1),
  ('fixture_uploader_lumen', 'lumen_house_uploads', 'lumen_house_uploads', 'Fixture uploader for Lumen House releases.', 'PUBLIC', 'PUBLIC', 1),
  ('fixture_uploader_oceana', 'oceana_team_uploads', 'oceana_team_uploads', 'Fixture uploader for Oceana Team releases.', 'PUBLIC', 'PUBLIC', 1);--> statement-breakpoint

INSERT OR IGNORE INTO `team_memberships`
  (`team_id`, `user_id`, `membership_role`, `status`, `is_primary`,
   `can_request_series`)
VALUES
  ('team_black_kite', 'fixture_uploader_black_kite', 'UPLOADER', 'ACTIVE', 1, 1),
  ('team_lumen_house', 'fixture_uploader_lumen', 'UPLOADER', 'ACTIVE', 1, 1),
  ('team_df536b7e-0982-4137-b1c5-1a1c37c5daa2', 'fixture_uploader_oceana', 'LEADER', 'ACTIVE', 1, 1);--> statement-breakpoint

INSERT OR IGNORE INTO `series_team_assignments`
  (`series_id`, `team_id`, `can_upload`, `can_publish`, `is_primary`,
   `assigned_by_user_id`, `allowed_languages_json`, `upload_requires_review`)
SELECT s.id,
       CASE
         WHEN UPPER(s.type) = 'MANGA' THEN 'team_black_kite'
         WHEN UPPER(s.type) IN ('MANHWA', 'WEBTOON') THEN 'team_lumen_house'
         ELSE 'team_df536b7e-0982-4137-b1c5-1a1c37c5daa2'
       END,
       1, 1, 1, NULL, '["en","fr","ar"]', 0
  FROM `series` s
 WHERE s.is_published = 1 AND s.archived_at IS NULL;--> statement-breakpoint

UPDATE `chapters`
   SET `team_id` = (
         SELECT sta.team_id
           FROM `series_team_assignments` sta
          WHERE sta.series_id = chapters.series_id
            AND sta.is_primary = 1
          LIMIT 1
       ),
       `uploader_user_id` = CASE (
         SELECT sta.team_id
           FROM `series_team_assignments` sta
          WHERE sta.series_id = chapters.series_id
            AND sta.is_primary = 1
          LIMIT 1
       )
         WHEN 'team_black_kite' THEN 'fixture_uploader_black_kite'
         WHEN 'team_lumen_house' THEN 'fixture_uploader_lumen'
         ELSE 'fixture_uploader_oceana'
       END
 WHERE `team_id` IS NULL
   AND EXISTS (
     SELECT 1 FROM `series_team_assignments` sta
      WHERE sta.series_id = chapters.series_id AND sta.is_primary = 1
   );--> statement-breakpoint

INSERT OR IGNORE INTO `chapters`
  (`id`, `series_id`, `team_id`, `uploader_user_id`, `slug`, `volume`,
   `chapter_number`, `title`, `language`, `format`, `state`, `access_type`,
   `price_onyx`, `page_count`, `published_at`, `free_at`, `version`,
   `release_notes`, `credits_json`, `visibility`, `comments_enabled`,
   `include_fixed_first_page`, `include_fixed_last_page`)
SELECT 'fixture_v2_' || c.id, c.series_id, c.team_id, c.uploader_user_id,
       c.slug || '-version-2', c.volume, c.chapter_number,
       c.title || ' · revised release', c.language, c.format, 'PUBLISHED',
       CASE WHEN c.id IN ('ch_test_regent_1', 'ch_test_mechanic_1') THEN 'PAID' ELSE 'FREE' END,
       CASE WHEN c.id IN ('ch_test_regent_1', 'ch_test_mechanic_1') THEN 25 ELSE 0 END,
       c.page_count, datetime('now', '-3 hours'), NULL, 2,
       'Fixture alternate version for release selection testing.',
       '{"translator":"Fixture team","qualityControl":"Version 2 review"}',
       'PUBLIC', 1,
       CASE WHEN c.id = 'ch_test_paper_moon_1' THEN 0 ELSE 1 END,
       CASE WHEN c.id = 'ch_test_carthage_1' THEN 0 ELSE 1 END
  FROM `chapters` c
 WHERE c.id IN (
   'ch_test_regent_1',
   'ch_test_mechanic_1',
   'ch_test_paper_moon_1',
   'ch_test_carthage_1'
 );
