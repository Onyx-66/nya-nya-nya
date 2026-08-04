CREATE TABLE `discussion_vote_events` (
	`id` text PRIMARY KEY NOT NULL,
	`voter_user_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`old_value` integer NOT NULL,
	`new_value` integer NOT NULL,
	`delta` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`voter_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discussion_vote_events_target_check" CHECK("discussion_vote_events"."target_type" IN ('SERIES', 'TEAM')),
	CONSTRAINT "discussion_vote_events_old_value_check" CHECK("discussion_vote_events"."old_value" IN (-1, 0, 1)),
	CONSTRAINT "discussion_vote_events_new_value_check" CHECK("discussion_vote_events"."new_value" IN (-1, 0, 1)),
	CONSTRAINT "discussion_vote_events_delta_check" CHECK("discussion_vote_events"."delta" = "discussion_vote_events"."new_value" - "discussion_vote_events"."old_value"
        AND "discussion_vote_events"."delta" <> 0)
);
--> statement-breakpoint
CREATE INDEX `discussion_vote_events_author_time_idx` ON `discussion_vote_events` (`author_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `discussion_vote_events_voter_time_idx` ON `discussion_vote_events` (`voter_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `discussion_vote_events_target_idx` ON `discussion_vote_events` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `team_discussion_mentions` (
	`post_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`target_type` text NOT NULL,
	`target_user_id` text,
	`target_series_id` text,
	`token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`post_id`, `ordinal`),
	FOREIGN KEY (`post_id`) REFERENCES `team_discussion_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_discussion_mentions_target_check" CHECK((
        "team_discussion_mentions"."target_type" = 'USER'
        AND "team_discussion_mentions"."target_user_id" IS NOT NULL
        AND "team_discussion_mentions"."target_series_id" IS NULL
      ) OR (
        "team_discussion_mentions"."target_type" = 'SERIES'
        AND "team_discussion_mentions"."target_user_id" IS NULL
        AND "team_discussion_mentions"."target_series_id" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE INDEX `team_discussion_mentions_user_idx` ON `team_discussion_mentions` (`target_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `team_discussion_mentions_series_idx` ON `team_discussion_mentions` (`target_series_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `team_discussion_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL,
	`idempotency_key` text,
	`moderation_status` text DEFAULT 'VISIBLE' NOT NULL,
	`edited_at` text,
	`deleted_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `team_discussion_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_discussion_posts_depth_check" CHECK("team_discussion_posts"."depth" IN (0, 1)),
	CONSTRAINT "team_discussion_posts_status_check" CHECK("team_discussion_posts"."moderation_status" IN ('VISIBLE', 'DELETED', 'HIDDEN')),
	CONSTRAINT "team_discussion_posts_parent_check" CHECK(("team_discussion_posts"."depth" = 0 AND "team_discussion_posts"."parent_id" IS NULL)
        OR ("team_discussion_posts"."depth" = 1 AND "team_discussion_posts"."parent_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `team_discussion_posts_team_recent_idx` ON `team_discussion_posts` (`team_id`,`moderation_status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `team_discussion_posts_parent_idx` ON `team_discussion_posts` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `team_discussion_posts_user_recent_idx` ON `team_discussion_posts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_discussion_posts_idempotency_uidx` ON `team_discussion_posts` (`team_id`,`user_id`,`idempotency_key`) WHERE "team_discussion_posts"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `team_discussion_votes` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`value` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `team_discussion_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_discussion_votes_value_check" CHECK("team_discussion_votes"."value" IN (-1, 1))
);
--> statement-breakpoint
CREATE INDEX `team_discussion_votes_post_idx` ON `team_discussion_votes` (`post_id`,`value`);--> statement-breakpoint
CREATE INDEX `team_discussion_votes_user_recent_idx` ON `team_discussion_votes` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `team_discussion_posts_parent_insert_guard`
BEFORE INSERT ON `team_discussion_posts`
WHEN NEW.`parent_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'team_discussion_parent_invalid')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `team_discussion_posts` parent
     WHERE parent.`id` = NEW.`parent_id`
       AND parent.`team_id` = NEW.`team_id`
       AND parent.`parent_id` IS NULL
       AND parent.`depth` = 0
       AND parent.`moderation_status` = 'VISIBLE'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `team_discussion_posts_parent_update_guard`
BEFORE UPDATE OF `parent_id`, `team_id`, `depth` ON `team_discussion_posts`
WHEN NEW.`parent_id` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'team_discussion_parent_invalid')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `team_discussion_posts` parent
     WHERE parent.`id` = NEW.`parent_id`
       AND parent.`team_id` = NEW.`team_id`
       AND parent.`parent_id` IS NULL
       AND parent.`depth` = 0
       AND parent.`moderation_status` = 'VISIBLE'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `team_discussion_posts_team_insert_guard`
BEFORE INSERT ON `team_discussion_posts`
BEGIN
  SELECT RAISE(ABORT, 'team_discussion_team_unavailable')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `teams` team
     WHERE team.`id` = NEW.`team_id`
       AND team.`is_archived` = 0
       AND team.`verification_status` = 'VERIFIED'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `team_discussion_posts_insert_guard`
BEFORE INSERT ON `team_discussion_posts`
BEGIN
  SELECT RAISE(ABORT, 'team_discussion_rate_limited')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `team_discussion_posts` prior
     WHERE prior.`team_id` = NEW.`team_id`
       AND prior.`user_id` = NEW.`user_id`
       AND prior.`idempotency_key` = NEW.`idempotency_key`
       AND NEW.`idempotency_key` IS NOT NULL
  )
    AND (
      SELECT COUNT(*)
        FROM `team_discussion_posts` recent
       WHERE recent.`user_id` = NEW.`user_id`
         AND datetime(recent.`created_at`) >= datetime('now', '-1 minute')
    ) >= 5;
  SELECT RAISE(ABORT, 'team_discussion_duplicate')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `team_discussion_posts` prior
     WHERE prior.`team_id` = NEW.`team_id`
       AND prior.`user_id` = NEW.`user_id`
       AND prior.`idempotency_key` = NEW.`idempotency_key`
       AND NEW.`idempotency_key` IS NOT NULL
  )
    AND EXISTS (
      SELECT 1
        FROM `team_discussion_posts` duplicate_post
       WHERE duplicate_post.`team_id` = NEW.`team_id`
         AND duplicate_post.`user_id` = NEW.`user_id`
         AND duplicate_post.`moderation_status` = 'VISIBLE'
         AND lower(trim(duplicate_post.`body`)) = lower(trim(NEW.`body`))
         AND datetime(duplicate_post.`created_at`) >= datetime('now', '-30 seconds')
         AND COALESCE(duplicate_post.`idempotency_key`, '') <>
             COALESCE(NEW.`idempotency_key`, '')
    );
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_votes_no_self_insert`
BEFORE INSERT ON `discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_self_vote_forbidden')
  WHERE EXISTS (
    SELECT 1
      FROM `discussion_comments` comment
     WHERE comment.`id` = NEW.`comment_id`
       AND comment.`user_id` = NEW.`user_id`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_votes_no_self_update`
BEFORE UPDATE ON `discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_self_vote_forbidden')
  WHERE EXISTS (
    SELECT 1
      FROM `discussion_comments` comment
     WHERE comment.`id` = NEW.`comment_id`
       AND comment.`user_id` = NEW.`user_id`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `team_discussion_votes_no_self_insert`
BEFORE INSERT ON `team_discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_self_vote_forbidden')
  WHERE EXISTS (
    SELECT 1
      FROM `team_discussion_posts` post
     WHERE post.`id` = NEW.`post_id`
       AND post.`user_id` = NEW.`user_id`
  );
END;
--> statement-breakpoint
CREATE TRIGGER `team_discussion_votes_no_self_update`
BEFORE UPDATE ON `team_discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_self_vote_forbidden')
  WHERE EXISTS (
    SELECT 1
      FROM `team_discussion_posts` post
     WHERE post.`id` = NEW.`post_id`
       AND post.`user_id` = NEW.`user_id`
  );
END;
--> statement-breakpoint
DELETE FROM `discussion_votes`
 WHERE EXISTS (
   SELECT 1
     FROM `discussion_comments` comment
    WHERE comment.`id` = `discussion_votes`.`comment_id`
      AND comment.`user_id` = `discussion_votes`.`user_id`
 );
--> statement-breakpoint
DELETE FROM `discussion_votes`
 WHERE NOT EXISTS (
   SELECT 1
     FROM `discussion_comments` comment
     JOIN `series` target_series
       ON target_series.`slug` = comment.`series_slug`
    WHERE comment.`id` = `discussion_votes`.`comment_id`
      AND comment.`moderation_status` = 'VISIBLE'
      AND comment.`deleted_at` IS NULL
      AND target_series.`is_published` = 1
      AND target_series.`archived_at` IS NULL
      AND target_series.`status` NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
      AND target_series.`rights_status` IN
        ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
 );
--> statement-breakpoint
INSERT INTO `discussion_vote_events`
(`id`, `voter_user_id`, `author_user_id`, `target_type`, `target_id`,
 `old_value`, `new_value`, `delta`, `created_at`)
SELECT 'dve_seed_series_' || lower(hex(randomblob(16))),
       vote.`user_id`,
       comment.`user_id`,
       'SERIES',
       vote.`comment_id`,
       0,
       vote.`value`,
       vote.`value`,
       vote.`updated_at`
  FROM `discussion_votes` vote
  JOIN `discussion_comments` comment ON comment.`id` = vote.`comment_id`
 WHERE vote.`user_id` <> comment.`user_id`;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_series_insert`
AFTER INSERT ON `discussion_votes`
BEGIN
  INSERT INTO `discussion_vote_events`
  (`id`, `voter_user_id`, `author_user_id`, `target_type`, `target_id`,
   `old_value`, `new_value`, `delta`)
  SELECT 'dve_series_' || lower(hex(randomblob(16))),
         NEW.`user_id`,
         comment.`user_id`,
         'SERIES',
         NEW.`comment_id`,
         0,
         NEW.`value`,
         NEW.`value`
    FROM `discussion_comments` comment
   WHERE comment.`id` = NEW.`comment_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_series_update`
AFTER UPDATE OF `value` ON `discussion_votes`
WHEN OLD.`value` <> NEW.`value`
BEGIN
  INSERT INTO `discussion_vote_events`
  (`id`, `voter_user_id`, `author_user_id`, `target_type`, `target_id`,
   `old_value`, `new_value`, `delta`)
  SELECT 'dve_series_' || lower(hex(randomblob(16))),
         NEW.`user_id`,
         comment.`user_id`,
         'SERIES',
         NEW.`comment_id`,
         OLD.`value`,
         NEW.`value`,
         NEW.`value` - OLD.`value`
    FROM `discussion_comments` comment
   WHERE comment.`id` = NEW.`comment_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_series_delete`
AFTER DELETE ON `discussion_votes`
BEGIN
  INSERT INTO `discussion_vote_events`
  (`id`, `voter_user_id`, `author_user_id`, `target_type`, `target_id`,
   `old_value`, `new_value`, `delta`)
  SELECT 'dve_series_' || lower(hex(randomblob(16))),
         OLD.`user_id`,
         comment.`user_id`,
         'SERIES',
         OLD.`comment_id`,
         OLD.`value`,
         0,
         0 - OLD.`value`
    FROM `discussion_comments` comment
   WHERE comment.`id` = OLD.`comment_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_team_insert`
AFTER INSERT ON `team_discussion_votes`
BEGIN
  INSERT INTO `discussion_vote_events`
  (`id`, `voter_user_id`, `author_user_id`, `target_type`, `target_id`,
   `old_value`, `new_value`, `delta`)
  SELECT 'dve_team_' || lower(hex(randomblob(16))),
         NEW.`user_id`,
         post.`user_id`,
         'TEAM',
         NEW.`post_id`,
         0,
         NEW.`value`,
         NEW.`value`
    FROM `team_discussion_posts` post
   WHERE post.`id` = NEW.`post_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_team_update`
AFTER UPDATE OF `value` ON `team_discussion_votes`
WHEN OLD.`value` <> NEW.`value`
BEGIN
  INSERT INTO `discussion_vote_events`
  (`id`, `voter_user_id`, `author_user_id`, `target_type`, `target_id`,
   `old_value`, `new_value`, `delta`)
  SELECT 'dve_team_' || lower(hex(randomblob(16))),
         NEW.`user_id`,
         post.`user_id`,
         'TEAM',
         NEW.`post_id`,
         OLD.`value`,
         NEW.`value`,
         NEW.`value` - OLD.`value`
    FROM `team_discussion_posts` post
   WHERE post.`id` = NEW.`post_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_team_delete`
AFTER DELETE ON `team_discussion_votes`
BEGIN
  INSERT INTO `discussion_vote_events`
  (`id`, `voter_user_id`, `author_user_id`, `target_type`, `target_id`,
   `old_value`, `new_value`, `delta`)
  SELECT 'dve_team_' || lower(hex(randomblob(16))),
         OLD.`user_id`,
         post.`user_id`,
         'TEAM',
         OLD.`post_id`,
         OLD.`value`,
         0,
         0 - OLD.`value`
    FROM `team_discussion_posts` post
   WHERE post.`id` = OLD.`post_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_immutable_update`
BEFORE UPDATE ON `discussion_vote_events`
BEGIN
  SELECT RAISE(ABORT, 'discussion_vote_events_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_vote_events_immutable_delete`
BEFORE DELETE ON `discussion_vote_events`
WHEN EXISTS (
  SELECT 1 FROM `users` WHERE `id` = OLD.`voter_user_id`
)
AND EXISTS (
  SELECT 1 FROM `users` WHERE `id` = OLD.`author_user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'discussion_vote_events_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `team_discussion_votes_target_insert_guard`
BEFORE INSERT ON `team_discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_vote_target_unavailable')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `team_discussion_posts` post
      JOIN `teams` team ON team.`id` = post.`team_id`
     WHERE post.`id` = NEW.`post_id`
       AND post.`moderation_status` = 'VISIBLE'
       AND post.`deleted_at` IS NULL
       AND team.`is_archived` = 0
       AND team.`verification_status` = 'VERIFIED'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `team_discussion_votes_target_update_guard`
BEFORE UPDATE ON `team_discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_vote_target_unavailable')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `team_discussion_posts` post
      JOIN `teams` team ON team.`id` = post.`team_id`
     WHERE post.`id` = NEW.`post_id`
       AND post.`moderation_status` = 'VISIBLE'
       AND post.`deleted_at` IS NULL
       AND team.`is_archived` = 0
       AND team.`verification_status` = 'VERIFIED'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_votes_target_insert_guard`
BEFORE INSERT ON `discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_vote_target_unavailable')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `discussion_comments` comment
      JOIN `series` target_series
        ON target_series.`slug` = comment.`series_slug`
     WHERE comment.`id` = NEW.`comment_id`
       AND comment.`moderation_status` = 'VISIBLE'
       AND comment.`deleted_at` IS NULL
       AND target_series.`is_published` = 1
       AND target_series.`archived_at` IS NULL
       AND target_series.`status` NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
       AND target_series.`rights_status` IN
         ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
  );
END;
--> statement-breakpoint
CREATE TRIGGER `discussion_votes_target_update_guard`
BEFORE UPDATE ON `discussion_votes`
BEGIN
  SELECT RAISE(ABORT, 'discussion_vote_target_unavailable')
  WHERE NOT EXISTS (
    SELECT 1
      FROM `discussion_comments` comment
      JOIN `series` target_series
        ON target_series.`slug` = comment.`series_slug`
     WHERE comment.`id` = NEW.`comment_id`
       AND comment.`moderation_status` = 'VISIBLE'
       AND comment.`deleted_at` IS NULL
       AND target_series.`is_published` = 1
       AND target_series.`archived_at` IS NULL
       AND target_series.`status` NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
       AND target_series.`rights_status` IN
         ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
  );
END;
--> statement-breakpoint
UPDATE `products`
   SET `active` = 0,
       `lifecycle_status` = 'HIDDEN',
       `archived_at` = COALESCE(`archived_at`, CURRENT_TIMESTAMP),
       `revision` = `revision` + 1,
       `updated_at` = CURRENT_TIMESTAMP
 WHERE `kind` IN ('CURRENCY_PACKAGE', 'MEMBERSHIP')
   AND json_valid(`metadata_json`)
   AND json_extract(`metadata_json`, '$.developmentOnly') = 1;
--> statement-breakpoint
INSERT OR IGNORE INTO `products`
(`id`, `slug`, `kind`, `name`, `description`, `price_minor`,
 `billing_currency`, `onyx_base`, `onyx_bonus`, `active`,
 `short_description`, `detailed_description`, `benefits_json`,
 `discount_percent`, `promotional_badge`, `lifecycle_status`,
 `is_featured`, `sort_order`, `cta_text`, `alt_text`, `theme_key`,
 `metadata_json`, `revision`)
SELECT *
FROM (
VALUES
('product_v43_coin_starter', 'coin-starter-500', 'CURRENCY_PACKAGE',
 'Coin Starter 500', 'A small starter balance for future premium releases.',
 499, 'USD', 500, 0, 1,
 'A clear starter pack with no hidden bonus math.',
 '500 base coins. Checkout remains disabled until a verified payment provider is configured.',
 '[]', 0, 'Starter offer', 'ACTIVE', 0, 5, 'Get starter pack',
 'Starter coin package', 'OCEAN', '{"catalogVersion":43}', 1),
('product_v43_coin_reader', 'coin-reader-1200', 'CURRENCY_PACKAGE',
 'Reader Pack 1,200', 'A balanced pack with a launch bonus.',
 999, 'USD', 1000, 200, 1,
 'Most popular starter offer.',
 '1,000 base coins plus 200 bonus coins. Checkout remains disabled until a verified payment provider is configured.',
 '[]', 10, 'Most popular', 'ACTIVE', 1, 6, 'Get reader pack',
 'Featured reader coin package', 'AURORA', '{"catalogVersion":43}', 1),
('product_v43_coin_marathon', 'coin-marathon-3000', 'CURRENCY_PACKAGE',
 'Marathon Pack 3,000', 'The strongest launch bonus in the starter catalogue.',
 1999, 'USD', 2400, 600, 1,
 'Best starter bonus.',
 '2,400 base coins plus 600 bonus coins. Checkout remains disabled until a verified payment provider is configured.',
 '[]', 20, 'Best bonus', 'ACTIVE', 0, 7, 'Get marathon pack',
 'Marathon coin package', 'SUNSET', '{"catalogVersion":43}', 1)
)
WHERE NOT EXISTS (
  SELECT 1
    FROM `products`
   WHERE `kind` = 'CURRENCY_PACKAGE'
     AND `active` = 1
     AND `lifecycle_status` = 'ACTIVE'
     AND `archived_at` IS NULL
     AND (`starts_at` IS NULL OR datetime(`starts_at`) <= datetime('now'))
     AND (`ends_at` IS NULL OR datetime(`ends_at`) > datetime('now'))
);
--> statement-breakpoint
INSERT OR IGNORE INTO `products`
(`id`, `slug`, `kind`, `name`, `description`, `price_minor`,
 `billing_currency`, `onyx_base`, `onyx_bonus`, `active`,
 `short_description`, `detailed_description`, `benefits_json`,
 `discount_percent`, `promotional_badge`, `lifecycle_status`,
 `is_featured`, `sort_order`, `cta_text`, `alt_text`, `theme_key`,
 `metadata_json`, `revision`)
SELECT *
FROM (
VALUES
('product_v43_nya_plus', 'nya-plus-preview', 'MEMBERSHIP',
 'Nya+', 'A preview of the planned reader membership.',
 499, 'USD', 0, 0, 1,
 'Monthly or annual membership preview.',
 'The catalogue is visible now; activation waits for verified subscription billing and entitlement fulfillment.',
 '["Planned Nya+ profile badge","Planned supporter community role","Early access to future membership features"]',
 0, 'Coming soon', 'ACTIVE', 1, 20, 'Preview Nya+',
 'Nya Plus membership preview', 'AURORA',
 '{"catalogVersion":43,"annualPriceMinor":4790,"monthlyCoins":0}', 1),
('product_v43_nya_patron', 'nya-patron-preview', 'MEMBERSHIP',
 'Nya Patron', 'A higher supporter tier planned for active community members.',
 899, 'USD', 0, 0, 1,
 'A future supporter membership for readers who want to give more back.',
 'The catalogue is visible now; activation waits for verified subscription billing and entitlement fulfillment.',
 '["Everything planned for Nya+","Planned supporter profile flair","Planned team-support recognition"]',
 0, 'Coming soon', 'ACTIVE', 0, 21, 'Preview Nya Patron',
 'Nya Patron membership preview', 'SUNSET',
 '{"catalogVersion":43,"annualPriceMinor":8590,"monthlyCoins":0}', 1)
)
WHERE NOT EXISTS (
  SELECT 1
    FROM `products`
   WHERE `kind` = 'MEMBERSHIP'
     AND `active` = 1
     AND `lifecycle_status` = 'ACTIVE'
     AND `archived_at` IS NULL
     AND (`starts_at` IS NULL OR datetime(`starts_at`) <= datetime('now'))
     AND (`ends_at` IS NULL OR datetime(`ends_at`) > datetime('now'))
);
