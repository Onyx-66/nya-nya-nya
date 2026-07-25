CREATE TABLE `series_request_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`request_revision` integer NOT NULL,
	`author_user_id` text,
	`visibility` text DEFAULT 'SUBMITTER' NOT NULL,
	`kind` text DEFAULT 'COMMENT' NOT NULL,
	`field_path` text,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `series_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "series_request_feedback_visibility_check" CHECK("series_request_feedback"."visibility" IN ('SUBMITTER', 'INTERNAL')),
	CONSTRAINT "series_request_feedback_kind_check" CHECK("series_request_feedback"."kind" IN (
        'COMMENT',
        'CHANGE_REQUEST',
        'REJECTION',
        'APPROVAL',
        'ASSIGNMENT'
      ))
);
--> statement-breakpoint
CREATE INDEX `series_request_feedback_request_idx` ON `series_request_feedback` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `series_request_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`author_user_id` text,
	`kind` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`changed_fields_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `series_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "series_request_revisions_kind_check" CHECK("series_request_revisions"."kind" IN (
        'SUBMISSION',
        'RESUBMISSION',
        'APPROVAL',
        'ATTACHED_TO_EXISTING'
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_request_revisions_number_uidx` ON `series_request_revisions` (`request_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `series_request_revisions_request_idx` ON `series_request_revisions` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `series_request_teams` (
	`request_id` text NOT NULL,
	`team_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`requested_can_upload` integer DEFAULT true NOT NULL,
	`requested_can_publish` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`request_id`, `team_id`),
	FOREIGN KEY (`request_id`) REFERENCES `series_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `series_request_teams_team_idx` ON `series_request_teams` (`team_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_request_teams_primary_uidx` ON `series_request_teams` (`request_id`) WHERE "series_request_teams"."is_primary" = 1;--> statement-breakpoint
CREATE TABLE `series_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`submitting_team_id` text NOT NULL,
	`submitter_user_id` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`primary_title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`alternative_titles_json` text DEFAULT '[]' NOT NULL,
	`description` text NOT NULL,
	`series_type` text NOT NULL,
	`publication_status` text NOT NULL,
	`authors_json` text DEFAULT '[]' NOT NULL,
	`artists_json` text DEFAULT '[]' NOT NULL,
	`publisher_name` text DEFAULT '' NOT NULL,
	`origin_country` text NOT NULL,
	`original_language` text NOT NULL,
	`reading_direction` text DEFAULT 'RIGHT_TO_LEFT' NOT NULL,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`cover_key` text,
	`banner_key` text,
	`mangadex_id` text,
	`mangadex_url` text,
	`mangaupdates_id` text,
	`mangaupdates_url` text,
	`canonical_source_url` text,
	`submitter_notes` text DEFAULT '' NOT NULL,
	`duplicate_confirmation` integer DEFAULT false NOT NULL,
	`duplicate_explanation` text DEFAULT '' NOT NULL,
	`duplicate_risk_score` integer DEFAULT 0 NOT NULL,
	`duplicate_matches_json` text DEFAULT '[]' NOT NULL,
	`assigned_reviewer_user_id` text,
	`approved_series_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`submitted_at` text,
	`review_started_at` text,
	`reviewed_at` text,
	`withdrawn_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submitting_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "series_requests_status_check" CHECK("series_requests"."status" IN (
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'CHANGES_REQUESTED',
        'APPROVED',
        'REJECTED',
        'WITHDRAWN'
      )),
	CONSTRAINT "series_requests_type_check" CHECK("series_requests"."series_type" IN ('MANGA', 'MANHWA', 'MANHUA')),
	CONSTRAINT "series_requests_publication_status_check" CHECK("series_requests"."publication_status" IN (
        'ONGOING',
        'COMPLETED',
        'HIATUS',
        'UPCOMING'
      ))
);
--> statement-breakpoint
CREATE INDEX `series_requests_queue_idx` ON `series_requests` (`status`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `series_requests_team_idx` ON `series_requests` (`submitting_team_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `series_requests_submitter_idx` ON `series_requests` (`submitter_user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `series_requests_reviewer_idx` ON `series_requests` (`assigned_reviewer_user_id`,`status`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `series_requests_normalized_title_idx` ON `series_requests` (`normalized_title`);--> statement-breakpoint
CREATE UNIQUE INDEX `series_requests_mangadex_active_uidx` ON `series_requests` (`mangadex_id`) WHERE "series_requests"."mangadex_id" IS NOT NULL
          AND "series_requests"."status" IN (
            'SUBMITTED',
            'UNDER_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED'
          );--> statement-breakpoint
CREATE UNIQUE INDEX `series_requests_mangaupdates_active_uidx` ON `series_requests` (`mangaupdates_id`) WHERE "series_requests"."mangaupdates_id" IS NOT NULL
          AND "series_requests"."status" IN (
            'SUBMITTED',
            'UNDER_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED'
          );--> statement-breakpoint
CREATE UNIQUE INDEX `series_requests_canonical_source_active_uidx` ON `series_requests` (`canonical_source_url`) WHERE "series_requests"."canonical_source_url" IS NOT NULL
          AND "series_requests"."status" IN (
            'SUBMITTED',
            'UNDER_REVIEW',
            'CHANGES_REQUESTED',
            'APPROVED'
          );--> statement-breakpoint
CREATE TABLE `user_blocks` (
	`blocker_user_id` text NOT NULL,
	`blocked_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`blocker_user_id`, `blocked_user_id`),
	FOREIGN KEY (`blocker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_blocks_not_self_check" CHECK("user_blocks"."blocker_user_id" <> "user_blocks"."blocked_user_id")
);
--> statement-breakpoint
CREATE INDEX `user_blocks_blocked_idx` ON `user_blocks` (`blocked_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_follows` (
	`follower_user_id` text NOT NULL,
	`followed_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`follower_user_id`, `followed_user_id`),
	FOREIGN KEY (`follower_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`followed_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_follows_not_self_check" CHECK("user_follows"."follower_user_id" <> "user_follows"."followed_user_id")
);
--> statement-breakpoint
CREATE INDEX `user_follows_followed_idx` ON `user_follows` (`followed_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`normalized_username` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_key` text,
	`banner_key` text,
	`preferred_language` text DEFAULT 'en' NOT NULL,
	`profile_visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`followers_visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`show_reading_history` integer DEFAULT false NOT NULL,
	`show_chapter_numbers` integer DEFAULT false NOT NULL,
	`show_library_summary` integer DEFAULT false NOT NULL,
	`social_links_json` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_username_uidx` ON `user_profiles` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_normalized_username_uidx` ON `user_profiles` (`normalized_username`);--> statement-breakpoint
CREATE INDEX `user_profiles_visibility_idx` ON `user_profiles` (`profile_visibility`,`updated_at`);--> statement-breakpoint
ALTER TABLE `chapters` ADD `visibility` text DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `comments_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `chapters_visibility_idx` ON `chapters` (`visibility`,`state`,`published_at`);--> statement-breakpoint
CREATE TRIGGER `chapters_visibility_insert_guard_v13`
BEFORE INSERT ON `chapters`
WHEN NEW.`visibility` NOT IN ('PUBLIC', 'UNLISTED', 'HIDDEN')
BEGIN
  SELECT RAISE(ABORT, 'invalid_chapter_visibility');
END;--> statement-breakpoint
CREATE TRIGGER `chapters_visibility_update_guard_v13`
BEFORE UPDATE OF `visibility` ON `chapters`
WHEN NEW.`visibility` NOT IN ('PUBLIC', 'UNLISTED', 'HIDDEN')
BEGIN
  SELECT RAISE(ABORT, 'invalid_chapter_visibility');
END;--> statement-breakpoint
ALTER TABLE `notifications` ADD `action_url` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `metadata_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX `notifications_dedupe_idx` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `allowed_languages_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `upload_requires_review` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `revoked_at` text;--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `revoked_by_user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `restriction_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `series_team_assignments` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `series_team_assignments_rights_idx` ON `series_team_assignments` (`team_id`,`revoked_at`,`can_upload`);--> statement-breakpoint
ALTER TABLE `team_memberships` ADD `can_request_series` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TRIGGER `series_requests_insert_guard_v13`
BEFORE INSERT ON `series_requests`
WHEN NEW.`status` <> 'DRAFT'
  OR NEW.`revision` <> 1
  OR NEW.`normalized_title` <> lower(trim(NEW.`normalized_title`))
  OR (NEW.`mangadex_id` IS NOT NULL
      AND NEW.`mangadex_id` <> lower(trim(NEW.`mangadex_id`)))
  OR (NEW.`mangaupdates_id` IS NOT NULL
      AND NEW.`mangaupdates_id` <> lower(trim(NEW.`mangaupdates_id`)))
  OR json_valid(NEW.`alternative_titles_json`) = 0
  OR json_type(NEW.`alternative_titles_json`) <> 'array'
  OR json_valid(NEW.`authors_json`) = 0
  OR json_type(NEW.`authors_json`) <> 'array'
  OR json_valid(NEW.`artists_json`) = 0
  OR json_type(NEW.`artists_json`) <> 'array'
  OR json_valid(NEW.`genres_json`) = 0
  OR json_type(NEW.`genres_json`) <> 'array'
  OR json_valid(NEW.`duplicate_matches_json`) = 0
  OR json_type(NEW.`duplicate_matches_json`) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_request');
END;--> statement-breakpoint
CREATE TRIGGER `series_requests_revision_guard_v13`
BEFORE UPDATE ON `series_requests`
WHEN NEW.`revision` <> OLD.`revision` + 1
BEGIN
  SELECT RAISE(ABORT, 'series_request_revision_required');
END;--> statement-breakpoint
CREATE TRIGGER `series_requests_owner_guard_v13`
BEFORE UPDATE ON `series_requests`
WHEN NEW.`submitting_team_id` <> OLD.`submitting_team_id`
  OR NEW.`submitter_user_id` <> OLD.`submitter_user_id`
BEGIN
  SELECT RAISE(ABORT, 'series_request_owner_immutable');
END;--> statement-breakpoint
CREATE TRIGGER `series_requests_json_guard_v13`
BEFORE UPDATE ON `series_requests`
WHEN NEW.`normalized_title` <> lower(trim(NEW.`normalized_title`))
  OR (NEW.`mangadex_id` IS NOT NULL
      AND NEW.`mangadex_id` <> lower(trim(NEW.`mangadex_id`)))
  OR (NEW.`mangaupdates_id` IS NOT NULL
      AND NEW.`mangaupdates_id` <> lower(trim(NEW.`mangaupdates_id`)))
  OR json_valid(NEW.`alternative_titles_json`) = 0
  OR json_type(NEW.`alternative_titles_json`) <> 'array'
  OR json_valid(NEW.`authors_json`) = 0
  OR json_type(NEW.`authors_json`) <> 'array'
  OR json_valid(NEW.`artists_json`) = 0
  OR json_type(NEW.`artists_json`) <> 'array'
  OR json_valid(NEW.`genres_json`) = 0
  OR json_type(NEW.`genres_json`) <> 'array'
  OR json_valid(NEW.`duplicate_matches_json`) = 0
  OR json_type(NEW.`duplicate_matches_json`) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_request');
END;--> statement-breakpoint
CREATE TRIGGER `series_requests_transition_guard_v13`
BEFORE UPDATE OF `status` ON `series_requests`
WHEN NEW.`status` <> OLD.`status`
 AND NOT (
   (OLD.`status` = 'DRAFT'
      AND NEW.`status` IN ('SUBMITTED', 'WITHDRAWN'))
   OR (OLD.`status` = 'SUBMITTED'
      AND NEW.`status` IN (
        'UNDER_REVIEW',
        'CHANGES_REQUESTED',
        'APPROVED',
        'REJECTED',
        'WITHDRAWN'
      ))
   OR (OLD.`status` = 'UNDER_REVIEW'
      AND NEW.`status` IN (
        'CHANGES_REQUESTED',
        'APPROVED',
        'REJECTED',
        'WITHDRAWN'
      ))
   OR (OLD.`status` = 'CHANGES_REQUESTED'
      AND NEW.`status` IN ('SUBMITTED', 'REJECTED', 'WITHDRAWN'))
 )
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_request_transition');
END;--> statement-breakpoint
CREATE TRIGGER `series_requests_submission_guard_v13`
BEFORE UPDATE OF `status` ON `series_requests`
WHEN NEW.`status` = 'SUBMITTED'
 AND OLD.`status` IN ('DRAFT', 'CHANGES_REQUESTED')
 AND (
   NOT EXISTS (
     SELECT 1
       FROM `series_request_teams` rt
       JOIN `teams` t ON t.`id` = rt.`team_id`
      WHERE rt.`request_id` = OLD.`id`
        AND rt.`team_id` = OLD.`submitting_team_id`
        AND rt.`is_primary` = 1
        AND t.`is_archived` = 0
        AND t.`verification_status` <> 'SUSPENDED'
   )
   OR (
     SELECT COUNT(*)
       FROM `series_request_teams`
      WHERE `request_id` = OLD.`id`
        AND `is_primary` = 1
   ) <> 1
   OR NEW.`cover_key` IS NULL
   OR length(trim(NEW.`cover_key`)) < 3
   OR (NEW.`duplicate_risk_score` > 0
       AND (
         NEW.`duplicate_confirmation` <> 1
         OR length(trim(NEW.`duplicate_explanation`)) < 12
       ))
   OR EXISTS (
     SELECT 1
       FROM `series_external_sources` ses
      WHERE (NEW.`mangadex_id` IS NOT NULL
              AND ses.`source` = 'MANGADEX'
              AND ses.`external_id` = NEW.`mangadex_id`)
         OR (NEW.`mangaupdates_id` IS NOT NULL
              AND ses.`source` = 'MANGAUPDATES'
              AND ses.`external_id` = NEW.`mangaupdates_id`)
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'series_request_submission_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `series_requests_approval_guard_v13`
BEFORE UPDATE OF `status` ON `series_requests`
WHEN NEW.`status` = 'APPROVED'
 AND (
   NEW.`approved_series_id` IS NULL
   OR NEW.`reviewed_at` IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM `series` s
      WHERE s.`id` = NEW.`approved_series_id`
   )
 )
BEGIN
  SELECT RAISE(ABORT, 'series_request_approval_incomplete');
END;--> statement-breakpoint
CREATE TRIGGER `series_request_feedback_revision_guard_v13`
BEFORE INSERT ON `series_request_feedback`
WHEN NOT EXISTS (
  SELECT 1
    FROM `series_requests` r
   WHERE r.`id` = NEW.`request_id`
     AND NEW.`request_revision` > 0
     AND NEW.`request_revision` <= r.`revision`
)
BEGIN
  SELECT RAISE(ABORT, 'series_request_feedback_revision_invalid');
END;--> statement-breakpoint
CREATE TRIGGER `series_request_approval_metadata_guard_v13`
BEFORE INSERT ON `series_request_revisions`
WHEN NEW.`kind` = 'APPROVAL'
 AND NOT EXISTS (
   SELECT 1
     FROM `series_requests` r
     JOIN `series` s ON s.`id` = r.`approved_series_id`
    WHERE r.`id` = NEW.`request_id`
      AND r.`status` = 'APPROVED'
      AND r.`revision` = NEW.`revision_number`
      AND s.`title` = r.`primary_title`
      AND (
        SELECT COUNT(*)
          FROM `series_aliases` sa
         WHERE sa.`series_id` = s.`id`
      ) = json_array_length(r.`alternative_titles_json`)
      AND (
        SELECT COUNT(*)
          FROM `series_creators` sc
         WHERE sc.`series_id` = s.`id`
           AND sc.`role` = 'AUTHOR'
      ) = json_array_length(r.`authors_json`)
      AND (
        SELECT COUNT(*)
          FROM `series_creators` sc
         WHERE sc.`series_id` = s.`id`
           AND sc.`role` = 'ARTIST'
      ) = json_array_length(r.`artists_json`)
      AND (
        SELECT COUNT(*)
          FROM `series_genres` sg
         WHERE sg.`series_id` = s.`id`
      ) = json_array_length(r.`genres_json`)
      AND (
        length(trim(r.`publisher_name`)) = 0
        OR s.`publisher_id` IS NOT NULL
      )
      AND (
        r.`mangadex_id` IS NULL
        OR EXISTS (
          SELECT 1 FROM `series_external_sources` source
           WHERE source.`series_id` = s.`id`
             AND source.`source` = 'MANGADEX'
             AND source.`external_id` = r.`mangadex_id`
        )
      )
      AND (
        r.`mangaupdates_id` IS NULL
        OR EXISTS (
          SELECT 1 FROM `series_external_sources` source
           WHERE source.`series_id` = s.`id`
             AND source.`source` = 'MANGAUPDATES'
             AND source.`external_id` = r.`mangaupdates_id`
        )
      )
      AND (
        SELECT COUNT(*)
          FROM `series_team_assignments` sta
         WHERE sta.`series_id` = s.`id`
           AND sta.`revoked_at` IS NULL
      ) = json_array_length(json_extract(NEW.`snapshot_json`, '$.teamRights'))
 )
BEGIN
  SELECT RAISE(ABORT, 'series_request_approval_metadata_incomplete');
END;--> statement-breakpoint
CREATE TRIGGER `series_request_team_active_insert_v13`
BEFORE INSERT ON `series_request_teams`
WHEN NOT EXISTS (
  SELECT 1 FROM `teams` t
   WHERE t.`id` = NEW.`team_id`
     AND t.`is_archived` = 0
     AND t.`verification_status` <> 'SUSPENDED'
)
BEGIN
  SELECT RAISE(ABORT, 'series_request_team_not_active');
END;--> statement-breakpoint
CREATE TRIGGER `series_team_rights_insert_guard_v13`
BEFORE INSERT ON `series_team_assignments`
WHEN (NEW.`can_publish` = 1 AND NEW.`can_upload` <> 1)
  OR (NEW.`revoked_at` IS NOT NULL
      AND (
        NEW.`can_upload` <> 0
        OR NEW.`can_publish` <> 0
        OR NEW.`revoked_by_user_id` IS NULL
        OR length(trim(NEW.`restriction_reason`)) < 8
      ))
  OR json_valid(NEW.`allowed_languages_json`) = 0
  OR json_type(NEW.`allowed_languages_json`) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_team_rights');
END;--> statement-breakpoint
CREATE TRIGGER `series_team_rights_update_guard_v13`
BEFORE UPDATE ON `series_team_assignments`
WHEN (NEW.`can_publish` = 1 AND NEW.`can_upload` <> 1)
  OR (NEW.`revoked_at` IS NOT NULL
      AND (
        NEW.`can_upload` <> 0
        OR NEW.`can_publish` <> 0
        OR NEW.`revoked_by_user_id` IS NULL
        OR length(trim(NEW.`restriction_reason`)) < 8
      ))
  OR json_valid(NEW.`allowed_languages_json`) = 0
  OR json_type(NEW.`allowed_languages_json`) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_team_rights');
END;--> statement-breakpoint
CREATE TRIGGER `user_profiles_insert_guard_v13`
BEFORE INSERT ON `user_profiles`
WHEN NEW.`normalized_username` <> lower(trim(NEW.`normalized_username`))
  OR NEW.`profile_visibility` NOT IN ('PUBLIC', 'PRIVATE')
  OR NEW.`followers_visibility` NOT IN ('PUBLIC', 'PRIVATE')
  OR json_valid(NEW.`social_links_json`) = 0
  OR json_type(NEW.`social_links_json`) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'invalid_user_profile');
END;--> statement-breakpoint
CREATE TRIGGER `user_profiles_update_guard_v13`
BEFORE UPDATE ON `user_profiles`
WHEN NEW.`revision` <> OLD.`revision` + 1
  OR NEW.`normalized_username` <> lower(trim(NEW.`normalized_username`))
  OR NEW.`profile_visibility` NOT IN ('PUBLIC', 'PRIVATE')
  OR NEW.`followers_visibility` NOT IN ('PUBLIC', 'PRIVATE')
  OR json_valid(NEW.`social_links_json`) = 0
  OR json_type(NEW.`social_links_json`) <> 'array'
BEGIN
  SELECT RAISE(ABORT, 'invalid_user_profile');
END;
