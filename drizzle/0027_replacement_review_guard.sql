DROP TRIGGER IF EXISTS `chapters_release_identity_insert_guard_v14`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `chapters_release_identity_update_guard_v14`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `chapters_release_identity_insert_guard_v39`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `chapters_release_identity_update_guard_v39`;--> statement-breakpoint
CREATE TRIGGER `chapters_release_identity_insert_guard_v39`
BEFORE INSERT ON `chapters`
WHEN NEW.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  AND EXISTS (
    SELECT 1
      FROM `chapters` existing
     WHERE existing.`series_id` = NEW.`series_id`
       AND existing.`chapter_number` = NEW.`chapter_number`
       AND existing.`language` = NEW.`language`
       AND COALESCE(existing.`team_id`, '') = COALESCE(NEW.`team_id`, '')
       AND existing.`version` = NEW.`version`
       AND existing.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_chapter_release');
END;--> statement-breakpoint
CREATE TRIGGER `chapters_release_identity_update_guard_v39`
BEFORE UPDATE OF `series_id`, `chapter_number`, `language`, `team_id`, `version`, `state`
ON `chapters`
WHEN NEW.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  AND EXISTS (
    SELECT 1
      FROM `chapters` existing
     WHERE existing.`id` <> OLD.`id`
       AND existing.`series_id` = NEW.`series_id`
       AND existing.`chapter_number` = NEW.`chapter_number`
       AND existing.`language` = NEW.`language`
       AND COALESCE(existing.`team_id`, '') = COALESCE(NEW.`team_id`, '')
       AND existing.`version` = NEW.`version`
       AND existing.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
  )
  AND NOT (
    (
      OLD.`state` = 'DRAFT'
      AND NEW.`state` = 'READY_FOR_REVIEW'
      AND EXISTS (
        SELECT 1
          FROM `upload_job_items` proposal_item
          JOIN `upload_jobs` proposal_job
            ON proposal_job.`id` = proposal_item.`job_id`
          JOIN `chapters` replacement
            ON replacement.`id` = proposal_item.`replacement_chapter_id`
         WHERE proposal_item.`chapter_id` = NEW.`id`
           AND proposal_item.`status` = 'PENDING_REVIEW'
           AND proposal_job.`status` = 'PUBLISHING'
           AND replacement.`id` <> NEW.`id`
           AND replacement.`series_id` = NEW.`series_id`
           AND replacement.`chapter_number` = NEW.`chapter_number`
           AND replacement.`language` = NEW.`language`
           AND COALESCE(replacement.`team_id`, '') =
               COALESCE(NEW.`team_id`, '')
           AND replacement.`version` = NEW.`version`
           AND replacement.`state` IN ('READY_FOR_REVIEW', 'PUBLISHED')
      )
    )
    OR
    (
      NEW.`state` = 'PUBLISHED'
      AND EXISTS (
        SELECT 1
          FROM `upload_job_items` proposal_item
          JOIN `upload_jobs` proposal_job
            ON proposal_job.`id` = proposal_item.`job_id`
          JOIN `chapters` proposed
            ON proposed.`id` = proposal_item.`chapter_id`
         WHERE proposal_item.`replacement_chapter_id` = NEW.`id`
           AND proposal_item.`status` = 'PENDING_REVIEW'
           AND proposal_job.`status` = 'PENDING_REVIEW'
           AND proposed.`id` <> NEW.`id`
           AND proposed.`state` = 'READY_FOR_REVIEW'
           AND proposed.`series_id` = NEW.`series_id`
           AND proposed.`chapter_number` = NEW.`chapter_number`
           AND proposed.`language` = NEW.`language`
           AND COALESCE(proposed.`team_id`, '') =
               COALESCE(NEW.`team_id`, '')
           AND proposed.`version` = NEW.`version`
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'duplicate_chapter_release');
END;
