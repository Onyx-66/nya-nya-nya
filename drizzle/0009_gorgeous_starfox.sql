CREATE TABLE `creators` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`biography` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creators_name_uidx` ON `creators` (`name`);--> statement-breakpoint
CREATE TABLE `editor_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`category_label` text DEFAULT 'Featured' NOT NULL,
	`short_description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `editor_picks_series_uidx` ON `editor_picks` (`series_id`);--> statement-breakpoint
CREATE INDEX `editor_picks_public_idx` ON `editor_picks` (`is_published`,`sort_order`);--> statement-breakpoint
CREATE TABLE `genres` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genres_slug_uidx` ON `genres` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `genres_name_uidx` ON `genres` (`name`);--> statement-breakpoint
CREATE TABLE `series_creators` (
	`series_id` text NOT NULL,
	`creator_id` text NOT NULL,
	`role` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`series_id`, `creator_id`, `role`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `creators`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "series_creators_role_check" CHECK("series_creators"."role" IN ('AUTHOR', 'ARTIST'))
);
--> statement-breakpoint
CREATE INDEX `series_creators_creator_idx` ON `series_creators` (`creator_id`,`role`);--> statement-breakpoint
CREATE TABLE `series_genres` (
	`series_id` text NOT NULL,
	`genre_id` text NOT NULL,
	PRIMARY KEY(`series_id`, `genre_id`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `series_genres_genre_idx` ON `series_genres` (`genre_id`,`series_id`);--> statement-breakpoint
CREATE TABLE `store_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`theme_key` text NOT NULL,
	`is_seasonal` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_collections_slug_uidx` ON `store_collections` (`slug`);--> statement-breakpoint
CREATE INDEX `store_collections_public_idx` ON `store_collections` (`enabled`,`sort_order`);--> statement-breakpoint
CREATE TABLE `store_items` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`collection_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`price_onyx` integer NOT NULL,
	`preview_key` text,
	`preview_config_json` text DEFAULT '{}' NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `store_collections`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "store_items_price_check" CHECK("store_items"."price_onyx" >= 0),
	CONSTRAINT "store_items_category_check" CHECK("store_items"."category" IN (
        'PROFILE_BANNER',
        'PROFILE_FRAME',
        'USERNAME_DECORATION',
        'COMMENT_EFFECT',
        'COMMENT_GRADIENT',
        'SEASONAL_PROFILE'
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_items_slug_uidx` ON `store_items` (`slug`);--> statement-breakpoint
CREATE INDEX `store_items_public_idx` ON `store_items` (`collection_id`,`is_published`,`is_hidden`,`sort_order`);--> statement-breakpoint
CREATE TABLE `user_cosmetic_loadouts` (
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`item_id` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `category`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `store_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_cosmetic_loadouts_item_idx` ON `user_cosmetic_loadouts` (`item_id`);--> statement-breakpoint
CREATE TABLE `user_store_items` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `store_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_store_items_recent_idx` ON `user_store_items` (`user_id`,`created_at`);
--> statement-breakpoint
UPDATE `series`
SET
  `type` = CASE
    WHEN `type` = 'WEBTOON' THEN 'MANHWA'
    WHEN `type` = 'COMIC' THEN 'MANGA'
    ELSE `type`
  END,
  `access_type` = CASE
    WHEN `access_type` = 'FREE' THEN 'FREE'
    ELSE 'PAID'
  END,
  `cover_key` = CASE
    WHEN `cover_key` LIKE 'public/%' THEN REPLACE(`cover_key`, 'public', '')
    ELSE `cover_key`
  END;
--> statement-breakpoint
UPDATE `chapters`
SET
  `access_type` = CASE
    WHEN `access_type` = 'FREE'
      OR (
        `access_type` = 'WAIT_TO_UNLOCK'
        AND `free_at` IS NOT NULL
        AND datetime(`free_at`) <= datetime('now')
      )
    THEN 'FREE'
    ELSE 'PAID'
  END,
  `price_onyx` = CASE
    WHEN `access_type` = 'FREE'
      OR (
        `access_type` = 'WAIT_TO_UNLOCK'
        AND `free_at` IS NOT NULL
        AND datetime(`free_at`) <= datetime('now')
      )
    THEN 0
    ELSE MAX(`price_onyx`, 30)
  END,
  `free_at` = NULL;
--> statement-breakpoint
CREATE TRIGGER `series_type_insert_guard`
BEFORE INSERT ON `series`
WHEN NEW.`type` NOT IN ('MANGA', 'MANHWA', 'MANHUA')
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_type');
END;
--> statement-breakpoint
CREATE TRIGGER `series_type_update_guard`
BEFORE UPDATE OF `type` ON `series`
WHEN NEW.`type` NOT IN ('MANGA', 'MANHWA', 'MANHUA')
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_type');
END;
--> statement-breakpoint
CREATE TRIGGER `series_access_insert_guard`
BEFORE INSERT ON `series`
WHEN NEW.`access_type` NOT IN ('FREE', 'PAID')
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_access');
END;
--> statement-breakpoint
CREATE TRIGGER `series_access_update_guard`
BEFORE UPDATE OF `access_type` ON `series`
WHEN NEW.`access_type` NOT IN ('FREE', 'PAID')
BEGIN
  SELECT RAISE(ABORT, 'invalid_series_access');
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_access_insert_guard`
BEFORE INSERT ON `chapters`
WHEN NEW.`access_type` NOT IN ('FREE', 'PAID')
BEGIN
  SELECT RAISE(ABORT, 'invalid_chapter_access');
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_access_update_guard`
BEFORE UPDATE OF `access_type` ON `chapters`
WHEN NEW.`access_type` NOT IN ('FREE', 'PAID')
BEGIN
  SELECT RAISE(ABORT, 'invalid_chapter_access');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `series`
  (`id`, `slug`, `title`, `native_title`, `synopsis`, `type`, `status`,
   `origin_country`, `original_language`, `reading_direction`, `age_rating`,
   `access_type`, `cover_key`, `rating_tenths`, `follower_count`, `view_count`,
   `rights_status`, `is_published`)
VALUES
  ('ser_blue_hour_alchemist', 'blue-hour-alchemist', 'Blue Hour Alchemist', '蒼時の錬金術師', 'A novice alchemist can only transmute memories during the blue hour before sunrise.', 'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN', 'FREE', '/art/cover-neon-ronin.png', 47, 12400, 462000, 'TEST_ORIGINAL', 1),
  ('ser_regents_shadow', 'the-regents-shadow', 'The Regent''s Shadow', '섭정의 그림자', 'A palace archivist discovers that the regent''s shadow has been signing orders of its own.', 'MANHWA', 'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'PAID', '/art/cover-glass-orchard.png', 48, 18200, 731000, 'TEST_ORIGINAL', 1),
  ('ser_jade_circuit', 'jade-circuit', 'Jade Circuit', '玉回路', 'An exiled engineer rebuilds ancient cultivation arrays as programmable jade machines.', 'MANHUA', 'ONGOING', 'CN', 'zh', 'LEFT_TO_RIGHT', 'TEEN', 'FREE', '/art/cover-signal-zero.png', 46, 9700, 388000, 'TEST_ORIGINAL', 1),
  ('ser_atlas_falling_stars', 'atlas-of-falling-stars', 'Atlas of Falling Stars', '墜星地図', 'A student cartographer maps the places where fallen stars rewrite the laws of distance.', 'MANGA', 'COMPLETED', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN', 'FREE', '/art/cover-crown-of-tides.png', 49, 15100, 622000, 'TEST_ORIGINAL', 1),
  ('ser_saffron_blade', 'saffron-blade', 'Saffron Blade', '사프란 검', 'A retired royal guard opens a spice shop and finds every customer tied to her final mission.', 'MANHWA', 'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'PAID', '/art/cover-ash-aster.png', 47, 11300, 441000, 'TEST_ORIGINAL', 1),
  ('ser_lanterns_winter', 'lanterns-beyond-winter', 'Lanterns Beyond Winter', '冬尽灯明', 'Two lantern makers guide lost spirits through a winter that refuses to end.', 'MANHUA', 'COMPLETED', 'CN', 'zh', 'LEFT_TO_RIGHT', 'EVERYONE', 'FREE', '/art/cover-moon-parcel.png', 45, 6800, 217000, 'TEST_ORIGINAL', 1),
  ('ser_last_cartographer', 'the-last-cartographer', 'The Last Cartographer', '最後の地図師', 'The final licensed mapmaker must chart a continent that moves whenever it is observed.', 'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN', 'PAID', '/art/cover-crown-of-tides.png', 48, 14300, 590000, 'TEST_ORIGINAL', 1),
  ('ser_crimson_tea_house', 'crimson-tea-house', 'Crimson Tea House', '진홍 찻집', 'A tea master solves supernatural disputes by brewing the one memory nobody wants to taste.', 'MANHWA', 'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'FREE', '/art/cover-glass-orchard.png', 46, 8800, 309000, 'TEST_ORIGINAL', 1),
  ('ser_celestial_mechanic', 'celestial-mechanic', 'Celestial Mechanic', '天工维修师', 'A mechanic repairing divine weapons learns the heavens are overdue for maintenance.', 'MANHUA', 'ONGOING', 'CN', 'zh', 'LEFT_TO_RIGHT', 'TEEN', 'PAID', '/art/cover-signal-zero.png', 47, 13200, 516000, 'TEST_ORIGINAL', 1),
  ('ser_after_school_exorcists', 'after-school-exorcists', 'After School Exorcists', '放課後祓魔部', 'Five students keep their school safe from urban legends before the last train home.', 'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN', 'FREE', '/art/cover-neon-ronin.png', 44, 7600, 241000, 'TEST_ORIGINAL', 1),
  ('ser_duchess_disasters', 'a-duchess-of-small-disasters', 'A Duchess of Small Disasters', '소소한 재앙의 공작부인', 'A meticulous duchess handles magical catastrophes that are never quite important enough for heroes.', 'MANHWA', 'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'PAID', '/art/cover-ash-aster.png', 49, 16900, 802000, 'TEST_ORIGINAL', 1),
  ('ser_river_dragons_promise', 'river-dragons-promise', 'River Dragon''s Promise', '江龙之约', 'A ferry captain must honor a promise made to the river dragon who saved her village.', 'MANHUA', 'COMPLETED', 'CN', 'zh', 'LEFT_TO_RIGHT', 'EVERYONE', 'FREE', '/art/cover-crown-of-tides.png', 48, 10400, 427000, 'TEST_ORIGINAL', 1),
  ('ser_paper_moon_detective', 'paper-moon-detective', 'Paper Moon Detective', '紙月探偵', 'A private detective follows clues hidden in paper moons that appear above unsolved cases.', 'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN', 'FREE', '/art/cover-moon-parcel.png', 45, 5900, 191000, 'TEST_ORIGINAL', 1),
  ('ser_villainess_receipts', 'the-villainess-keeps-receipts', 'The Villainess Keeps Receipts', '악녀는 영수증을 보관한다', 'Reborn as a notorious heiress, an accountant defeats court intrigue with impeccable records.', 'MANHWA', 'ONGOING', 'KR', 'ko', 'VERTICAL', 'TEEN', 'PAID', '/art/cover-glass-orchard.png', 49, 17800, 910000, 'TEST_ORIGINAL', 1),
  ('ser_fortress_quiet_gods', 'fortress-of-quiet-gods', 'Fortress of Quiet Gods', '静神堡', 'A border captain discovers the silent statues defending her fortress are sleeping gods.', 'MANHUA', 'ONGOING', 'CN', 'zh', 'LEFT_TO_RIGHT', 'MATURE', 'PAID', '/art/cover-signal-zero.png', 46, 9200, 351000, 'TEST_ORIGINAL', 1),
  ('ser_orbiting_you', 'orbiting-you', 'Orbiting You', '君をめぐる軌道', 'Two astronomy students keep meeting at the same observatory in slightly different timelines.', 'MANGA', 'COMPLETED', 'JP', 'ja', 'RIGHT_TO_LEFT', 'TEEN', 'FREE', '/art/cover-ash-aster.png', 48, 13600, 574000, 'TEST_ORIGINAL', 1),
  ('ser_apothecary_carthage', 'the-apothecary-of-carthage', 'The Apothecary of Carthage', 'قرطاج의 약제사', 'A harbor apothecary deciphers remedies left by sailors from cities that no longer exist.', 'MANHWA', 'ONGOING', 'TN', 'ar', 'VERTICAL', 'TEEN', 'FREE', '/art/cover-crown-of-tides.png', 47, 8400, 288000, 'TEST_ORIGINAL', 1),
  ('ser_black_salt_requiem', 'black-salt-requiem', 'Black Salt Requiem', '玄盐镇魂曲', 'A musician hunts sea-born curses using an instrument strung with crystallized black salt.', 'MANHUA', 'ONGOING', 'CN', 'zh', 'LEFT_TO_RIGHT', 'MATURE', 'PAID', '/art/cover-neon-ronin.png', 45, 7100, 233000, 'TEST_ORIGINAL', 1),
  ('ser_cat_courier_midnight', 'cat-courier-midnight', 'Cat Courier Midnight', '夜更けの猫便', 'A street cat delivers letters between dreams and expects payment in grilled fish.', 'MANGA', 'ONGOING', 'JP', 'ja', 'RIGHT_TO_LEFT', 'EVERYONE', 'FREE', '/art/cover-moon-parcel.png', 46, 9900, 362000, 'TEST_ORIGINAL', 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `series_aliases` (`series_id`, `alias`, `language`)
VALUES
  ('ser_neon_ronin', 'Blade Protocol', 'en'),
  ('ser_glass_orchard', 'Crystal Greenhouse', 'en'),
  ('ser_signal_zero', 'Tomorrow Frequency', 'en'),
  ('ser_crown_tides', 'The Drowned Crown', 'en'),
  ('ser_moon_parcel', 'Midnight Delivery', 'en'),
  ('ser_ash_aster', 'The Last Seed Garden', 'en'),
  ('ser_blue_hour_alchemist', 'Alchemy at Dawn', 'en'),
  ('ser_regents_shadow', 'Shadow of the Palace Regent', 'en'),
  ('ser_jade_circuit', 'Programmable Cultivation', 'en'),
  ('ser_atlas_falling_stars', 'Starfall Atlas', 'en'),
  ('ser_saffron_blade', 'The Spice Shop Guard', 'en'),
  ('ser_lanterns_winter', 'Winter Lantern Road', 'en'),
  ('ser_last_cartographer', 'Moving Continent', 'en'),
  ('ser_crimson_tea_house', 'Tea of Forgotten Memories', 'en'),
  ('ser_celestial_mechanic', 'Heaven Repair Manual', 'en'),
  ('ser_after_school_exorcists', 'The Last Train Exorcists', 'en'),
  ('ser_duchess_disasters', 'Minor Calamity Duchess', 'en'),
  ('ser_river_dragons_promise', 'Promise at the Ferry', 'en'),
  ('ser_paper_moon_detective', 'Detective Under a Paper Moon', 'en'),
  ('ser_villainess_receipts', 'The Accountant Villainess', 'en'),
  ('ser_fortress_quiet_gods', 'Citadel of Sleeping Gods', 'en'),
  ('ser_orbiting_you', 'Our Shared Orbit', 'en'),
  ('ser_apothecary_carthage', 'Harbor Remedies', 'en'),
  ('ser_black_salt_requiem', 'Song of Black Salt', 'en'),
  ('ser_cat_courier_midnight', 'Dream Letter Cat', 'en');
--> statement-breakpoint
INSERT OR IGNORE INTO `creators` (`id`, `name`)
SELECT 'cr_' || `id`, `title` || ' Studio'
FROM `series`
WHERE `id` LIKE 'ser_%';
--> statement-breakpoint
INSERT OR IGNORE INTO `series_creators`
  (`series_id`, `creator_id`, `role`, `sort_order`)
SELECT `id`, 'cr_' || `id`, 'AUTHOR', 0
FROM `series`
WHERE `id` LIKE 'ser_%';
--> statement-breakpoint
INSERT OR IGNORE INTO `series_creators`
  (`series_id`, `creator_id`, `role`, `sort_order`)
SELECT `id`, 'cr_' || `id`, 'ARTIST', 0
FROM `series`
WHERE `id` LIKE 'ser_%';
--> statement-breakpoint
INSERT OR IGNORE INTO `genres` (`id`, `slug`, `name`)
VALUES
  ('genre_action', 'action', 'Action'),
  ('genre_adventure', 'adventure', 'Adventure'),
  ('genre_comedy', 'comedy', 'Comedy'),
  ('genre_drama', 'drama', 'Drama'),
  ('genre_fantasy', 'fantasy', 'Fantasy'),
  ('genre_mystery', 'mystery', 'Mystery'),
  ('genre_romance', 'romance', 'Romance'),
  ('genre_scifi', 'sci-fi', 'Sci-Fi'),
  ('genre_slice_life', 'slice-of-life', 'Slice of Life'),
  ('genre_supernatural', 'supernatural', 'Supernatural'),
  ('genre_thriller', 'thriller', 'Thriller'),
  ('genre_historical', 'historical', 'Historical');
--> statement-breakpoint
INSERT OR IGNORE INTO `series_genres` (`series_id`, `genre_id`)
VALUES
  ('ser_neon_ronin', 'genre_action'), ('ser_neon_ronin', 'genre_scifi'),
  ('ser_glass_orchard', 'genre_fantasy'), ('ser_glass_orchard', 'genre_romance'),
  ('ser_signal_zero', 'genre_scifi'), ('ser_signal_zero', 'genre_thriller'),
  ('ser_crown_tides', 'genre_adventure'), ('ser_crown_tides', 'genre_fantasy'),
  ('ser_moon_parcel', 'genre_comedy'), ('ser_moon_parcel', 'genre_slice_life'),
  ('ser_ash_aster', 'genre_drama'), ('ser_ash_aster', 'genre_fantasy'),
  ('ser_blue_hour_alchemist', 'genre_fantasy'), ('ser_blue_hour_alchemist', 'genre_mystery'),
  ('ser_regents_shadow', 'genre_historical'), ('ser_regents_shadow', 'genre_mystery'),
  ('ser_jade_circuit', 'genre_action'), ('ser_jade_circuit', 'genre_scifi'),
  ('ser_atlas_falling_stars', 'genre_adventure'), ('ser_atlas_falling_stars', 'genre_drama'),
  ('ser_saffron_blade', 'genre_action'), ('ser_saffron_blade', 'genre_slice_life'),
  ('ser_lanterns_winter', 'genre_drama'), ('ser_lanterns_winter', 'genre_supernatural'),
  ('ser_last_cartographer', 'genre_adventure'), ('ser_last_cartographer', 'genre_fantasy'),
  ('ser_crimson_tea_house', 'genre_mystery'), ('ser_crimson_tea_house', 'genre_supernatural'),
  ('ser_celestial_mechanic', 'genre_action'), ('ser_celestial_mechanic', 'genre_fantasy'),
  ('ser_after_school_exorcists', 'genre_comedy'), ('ser_after_school_exorcists', 'genre_supernatural'),
  ('ser_duchess_disasters', 'genre_comedy'), ('ser_duchess_disasters', 'genre_romance'),
  ('ser_river_dragons_promise', 'genre_adventure'), ('ser_river_dragons_promise', 'genre_romance'),
  ('ser_paper_moon_detective', 'genre_mystery'), ('ser_paper_moon_detective', 'genre_thriller'),
  ('ser_villainess_receipts', 'genre_comedy'), ('ser_villainess_receipts', 'genre_romance'),
  ('ser_fortress_quiet_gods', 'genre_action'), ('ser_fortress_quiet_gods', 'genre_historical'),
  ('ser_orbiting_you', 'genre_romance'), ('ser_orbiting_you', 'genre_scifi'),
  ('ser_apothecary_carthage', 'genre_historical'), ('ser_apothecary_carthage', 'genre_mystery'),
  ('ser_black_salt_requiem', 'genre_action'), ('ser_black_salt_requiem', 'genre_supernatural'),
  ('ser_cat_courier_midnight', 'genre_comedy'), ('ser_cat_courier_midnight', 'genre_slice_life');
--> statement-breakpoint
WITH `chapter_seed`
  (`id`, `series_id`, `slug`, `chapter_number`, `title`, `access_type`,
   `price_onyx`, `published_offset`)
AS (
  VALUES
    ('ch_test_blue_hour_3', 'ser_blue_hour_alchemist', 'chapter-3', '3', 'The cobalt rule', 'FREE', 0, '-2 hours'),
    ('ch_test_blue_hour_2', 'ser_blue_hour_alchemist', 'chapter-2', '2', 'A memory in glass', 'FREE', 0, '-4 days'),
    ('ch_test_blue_hour_1', 'ser_blue_hour_alchemist', 'chapter-1', '1', 'Before sunrise', 'FREE', 0, '-11 days'),
    ('ch_test_regent_3', 'ser_regents_shadow', 'chapter-3', '3', 'Unsigned orders', 'PAID', 35, '-3 hours'),
    ('ch_test_regent_2', 'ser_regents_shadow', 'chapter-2', '2', 'The west archive', 'FREE', 0, '-5 days'),
    ('ch_test_regent_1', 'ser_regents_shadow', 'chapter-1', '1', 'A shadow at court', 'FREE', 0, '-12 days'),
    ('ch_test_jade_3', 'ser_jade_circuit', 'chapter-3', '3', 'Array fault', 'FREE', 0, '-5 hours'),
    ('ch_test_jade_2', 'ser_jade_circuit', 'chapter-2', '2', 'The copper meridian', 'FREE', 0, '-6 days'),
    ('ch_test_jade_1', 'ser_jade_circuit', 'chapter-1', '1', 'Boot sequence', 'FREE', 0, '-13 days'),
    ('ch_test_atlas_3', 'ser_atlas_falling_stars', 'chapter-3', '3', 'North moves east', 'FREE', 0, '-7 hours'),
    ('ch_test_atlas_2', 'ser_atlas_falling_stars', 'chapter-2', '2', 'Meteor ink', 'FREE', 0, '-7 days'),
    ('ch_test_atlas_1', 'ser_atlas_falling_stars', 'chapter-1', '1', 'The first crater', 'FREE', 0, '-14 days'),
    ('ch_test_saffron_3', 'ser_saffron_blade', 'chapter-3', '3', 'A royal customer', 'PAID', 40, '-9 hours'),
    ('ch_test_saffron_2', 'ser_saffron_blade', 'chapter-2', '2', 'Cinnamon smoke', 'FREE', 0, '-8 days'),
    ('ch_test_saffron_1', 'ser_saffron_blade', 'chapter-1', '1', 'The quiet shop', 'FREE', 0, '-15 days'),
    ('ch_test_lanterns_3', 'ser_lanterns_winter', 'chapter-3', '3', 'Road of warm light', 'FREE', 0, '-12 hours'),
    ('ch_test_lanterns_2', 'ser_lanterns_winter', 'chapter-2', '2', 'Snow remembers', 'FREE', 0, '-9 days'),
    ('ch_test_lanterns_1', 'ser_lanterns_winter', 'chapter-1', '1', 'First lantern', 'FREE', 0, '-16 days'),
    ('ch_test_cartographer_3', 'ser_last_cartographer', 'chapter-3', '3', 'The moving coast', 'PAID', 45, '-15 hours'),
    ('ch_test_cartographer_2', 'ser_last_cartographer', 'chapter-2', '2', 'An impossible scale', 'FREE', 0, '-10 days'),
    ('ch_test_cartographer_1', 'ser_last_cartographer', 'chapter-1', '1', 'License number one', 'FREE', 0, '-17 days'),
    ('ch_test_tea_3', 'ser_crimson_tea_house', 'chapter-3', '3', 'Bitter recollection', 'FREE', 0, '-18 hours'),
    ('ch_test_tea_2', 'ser_crimson_tea_house', 'chapter-2', '2', 'The empty cup', 'FREE', 0, '-11 days'),
    ('ch_test_tea_1', 'ser_crimson_tea_house', 'chapter-1', '1', 'House rules', 'FREE', 0, '-18 days'),
    ('ch_test_mechanic_3', 'ser_celestial_mechanic', 'chapter-3', '3', 'Warranty void', 'PAID', 45, '-21 hours'),
    ('ch_test_mechanic_2', 'ser_celestial_mechanic', 'chapter-2', '2', 'A divine loose screw', 'FREE', 0, '-12 days'),
    ('ch_test_mechanic_1', 'ser_celestial_mechanic', 'chapter-1', '1', 'Repair ticket', 'FREE', 0, '-19 days'),
    ('ch_test_exorcists_3', 'ser_after_school_exorcists', 'chapter-3', '3', 'Platform seven', 'FREE', 0, '-24 hours'),
    ('ch_test_exorcists_2', 'ser_after_school_exorcists', 'chapter-2', '2', 'Locker 404', 'FREE', 0, '-13 days'),
    ('ch_test_exorcists_1', 'ser_after_school_exorcists', 'chapter-1', '1', 'Club application', 'FREE', 0, '-20 days'),
    ('ch_test_duchess_3', 'ser_duchess_disasters', 'chapter-3', '3', 'The polite avalanche', 'PAID', 35, '-27 hours'),
    ('ch_test_duchess_2', 'ser_duchess_disasters', 'chapter-2', '2', 'Tea table tremor', 'FREE', 0, '-14 days'),
    ('ch_test_duchess_1', 'ser_duchess_disasters', 'chapter-1', '1', 'Minor emergency', 'FREE', 0, '-21 days'),
    ('ch_test_river_3', 'ser_river_dragons_promise', 'chapter-3', '3', 'Flood marks', 'FREE', 0, '-30 hours'),
    ('ch_test_river_2', 'ser_river_dragons_promise', 'chapter-2', '2', 'Fare for one dragon', 'FREE', 0, '-15 days'),
    ('ch_test_river_1', 'ser_river_dragons_promise', 'chapter-1', '1', 'The old promise', 'FREE', 0, '-22 days'),
    ('ch_test_paper_moon_3', 'ser_paper_moon_detective', 'chapter-3', '3', 'Folded alibi', 'FREE', 0, '-33 hours'),
    ('ch_test_paper_moon_2', 'ser_paper_moon_detective', 'chapter-2', '2', 'Ink at midnight', 'FREE', 0, '-16 days'),
    ('ch_test_paper_moon_1', 'ser_paper_moon_detective', 'chapter-1', '1', 'A moon in the alley', 'FREE', 0, '-23 days'),
    ('ch_test_receipts_3', 'ser_villainess_receipts', 'chapter-3', '3', 'Audit the duke', 'PAID', 40, '-36 hours'),
    ('ch_test_receipts_2', 'ser_villainess_receipts', 'chapter-2', '2', 'Ledger of rumors', 'FREE', 0, '-17 days'),
    ('ch_test_receipts_1', 'ser_villainess_receipts', 'chapter-1', '1', 'Opening balance', 'FREE', 0, '-24 days'),
    ('ch_test_fortress_3', 'ser_fortress_quiet_gods', 'chapter-3', '3', 'Stone heartbeat', 'PAID', 50, '-39 hours'),
    ('ch_test_fortress_2', 'ser_fortress_quiet_gods', 'chapter-2', '2', 'The sealed gate', 'FREE', 0, '-18 days'),
    ('ch_test_fortress_1', 'ser_fortress_quiet_gods', 'chapter-1', '1', 'Silent watch', 'FREE', 0, '-25 days'),
    ('ch_test_orbiting_3', 'ser_orbiting_you', 'chapter-3', '3', 'Same sky, again', 'FREE', 0, '-42 hours'),
    ('ch_test_orbiting_2', 'ser_orbiting_you', 'chapter-2', '2', 'Red shift', 'FREE', 0, '-19 days'),
    ('ch_test_orbiting_1', 'ser_orbiting_you', 'chapter-1', '1', 'First observation', 'FREE', 0, '-26 days'),
    ('ch_test_carthage_3', 'ser_apothecary_carthage', 'chapter-3', '3', 'Purple sail remedy', 'FREE', 0, '-45 hours'),
    ('ch_test_carthage_2', 'ser_apothecary_carthage', 'chapter-2', '2', 'Harbor fever', 'FREE', 0, '-20 days'),
    ('ch_test_carthage_1', 'ser_apothecary_carthage', 'chapter-1', '1', 'The old amphora', 'FREE', 0, '-27 days'),
    ('ch_test_salt_3', 'ser_black_salt_requiem', 'chapter-3', '3', 'Third movement', 'PAID', 50, '-48 hours'),
    ('ch_test_salt_2', 'ser_black_salt_requiem', 'chapter-2', '2', 'Cursed strings', 'FREE', 0, '-21 days'),
    ('ch_test_salt_1', 'ser_black_salt_requiem', 'chapter-1', '1', 'Salt song', 'FREE', 0, '-28 days'),
    ('ch_test_cat_3', 'ser_cat_courier_midnight', 'chapter-3', '3', 'Return address unknown', 'FREE', 0, '-51 hours'),
    ('ch_test_cat_2', 'ser_cat_courier_midnight', 'chapter-2', '2', 'Two grilled fish', 'FREE', 0, '-22 days'),
    ('ch_test_cat_1', 'ser_cat_courier_midnight', 'chapter-1', '1', 'Night route', 'FREE', 0, '-29 days')
)
INSERT OR IGNORE INTO `chapters`
  (`id`, `series_id`, `slug`, `chapter_number`, `title`, `language`, `format`,
   `state`, `access_type`, `price_onyx`, `page_count`, `published_at`)
SELECT
  `id`,
  `series_id`,
  `slug`,
  `chapter_number`,
  `title`,
  'en',
  'VERTICAL',
  'PUBLISHED',
  `access_type`,
  `price_onyx`,
  0,
  datetime('now', `published_offset`)
FROM `chapter_seed`;
--> statement-breakpoint
INSERT OR IGNORE INTO `editor_picks`
  (`id`, `series_id`, `category_label`, `short_description`, `sort_order`, `is_published`)
VALUES
  ('pick_regent', 'ser_regents_shadow', 'Palace intrigue', 'A tense archival mystery with a shadow that knows too much.', 10, 1),
  ('pick_carthage', 'ser_apothecary_carthage', 'Historical fantasy', 'Harbor medicine, vanished cities, and a distinctly Mediterranean mystery.', 20, 1),
  ('pick_atlas', 'ser_atlas_falling_stars', 'Adventure', 'A completed celestial journey for readers who like strange maps and quiet wonder.', 30, 1),
  ('pick_receipts', 'ser_villainess_receipts', 'Romantic comedy', 'A sharp villainess story where bookkeeping is the strongest form of revenge.', 40, 1),
  ('pick_jade', 'ser_jade_circuit', 'Cultivation sci-fi', 'Ancient arrays meet clean engineering in a fast, inventive adventure.', 50, 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `store_collections`
  (`id`, `slug`, `name`, `description`, `theme_key`, `is_seasonal`, `enabled`, `sort_order`)
VALUES
  ('collection_summer', 'summer', 'Summer', 'Sunlit color, sea glass, and warm-night profile accents.', 'SUMMER', 1, 1, 10),
  ('collection_samurai', 'samurai', 'Samurai', 'Ink, steel, lacquer, and disciplined motion.', 'SAMURAI', 0, 1, 20),
  ('collection_carthage', 'carthage', 'Carthage', 'Deep sea blue, antique gold, and Punic-inspired geometry.', 'CARTHAGE', 0, 1, 30),
  ('collection_odyssey', 'odyssey', 'Odyssey', 'Starlight, navigation, and mythic voyage effects.', 'ODYSSEY', 1, 1, 40);
--> statement-breakpoint
INSERT OR IGNORE INTO `store_items`
  (`id`, `slug`, `collection_id`, `name`, `description`, `category`, `price_onyx`,
   `preview_config_json`, `is_published`, `is_hidden`, `sort_order`)
VALUES
  ('item_summer_tide_banner', 'summer-tide-banner', 'collection_summer', 'Summer Tide', 'A bright profile banner with cool sea-glass depth.', 'PROFILE_BANNER', 220, '{"from":"#0ea5e9","to":"#fbbf24","accent":"#e0f2fe","symbol":"SUN"}', 1, 0, 10),
  ('item_summer_glow_frame', 'summer-glow-frame', 'collection_summer', 'Sunset Loop', 'An animated profile frame with a slow sunset pulse.', 'PROFILE_FRAME', 340, '{"from":"#fb7185","to":"#f59e0b","accent":"#fff7ed","symbol":"RING"}', 1, 0, 20),
  ('item_summer_spark_comment', 'summer-spark-comment', 'collection_summer', 'Solar Spark', 'Adds a restrained warm sparkle when your comment appears.', 'COMMENT_EFFECT', 180, '{"from":"#f59e0b","to":"#38bdf8","accent":"#fef3c7","symbol":"SPARK"}', 1, 0, 30),
  ('item_summer_wave_name', 'summer-wave-name', 'collection_summer', 'Wave Signature', 'A sea-blue underline decoration for your username.', 'USERNAME_DECORATION', 140, '{"from":"#0284c7","to":"#22d3ee","accent":"#e0f2fe","symbol":"WAVE"}', 1, 0, 40),
  ('item_samurai_ink_banner', 'samurai-ink-banner', 'collection_samurai', 'Ink Discipline', 'A monochrome banner cut by a single vermilion stroke.', 'PROFILE_BANNER', 260, '{"from":"#111827","to":"#374151","accent":"#ef4444","symbol":"INK"}', 1, 0, 10),
  ('item_samurai_lacquer_frame', 'samurai-lacquer-frame', 'collection_samurai', 'Lacquer Guard', 'A dark animated frame with lacquer-red edge light.', 'PROFILE_FRAME', 360, '{"from":"#450a0a","to":"#111827","accent":"#fca5a5","symbol":"RING"}', 1, 0, 20),
  ('item_samurai_cut_effect', 'samurai-cut-effect', 'collection_samurai', 'Clean Cut', 'A precise slash transition for newly posted comments.', 'COMMENT_EFFECT', 210, '{"from":"#0f172a","to":"#991b1b","accent":"#f8fafc","symbol":"SLASH"}', 1, 0, 30),
  ('item_samurai_steel_gradient', 'samurai-steel-gradient', 'collection_samurai', 'Tempered Steel', 'A cool steel-to-ink gradient for comment surfaces.', 'COMMENT_GRADIENT', 190, '{"from":"#64748b","to":"#0f172a","accent":"#e2e8f0","symbol":"STEEL"}', 1, 0, 40),
  ('item_carthage_harbor_banner', 'carthage-harbor-banner', 'collection_carthage', 'Carthage Harbor', 'Ocean blue and antique gold arranged like a moonlit harbor.', 'PROFILE_BANNER', 280, '{"from":"#082f49","to":"#0369a1","accent":"#d4af37","symbol":"HARBOR"}', 1, 0, 10),
  ('item_carthage_punic_frame', 'carthage-punic-frame', 'collection_carthage', 'Punic Orbit', 'A premium animated frame inspired by geometric coin borders.', 'PROFILE_FRAME', 390, '{"from":"#075985","to":"#0f172a","accent":"#fbbf24","symbol":"COIN"}', 1, 0, 20),
  ('item_carthage_gold_name', 'carthage-gold-name', 'collection_carthage', 'Merchant Gold', 'A fine antique-gold username flourish with ocean-blue shadow.', 'USERNAME_DECORATION', 170, '{"from":"#d4af37","to":"#0c4a6e","accent":"#fef3c7","symbol":"GLYPH"}', 1, 0, 30),
  ('item_carthage_mosaic_gradient', 'carthage-mosaic-gradient', 'collection_carthage', 'Mosaic Current', 'A blue mosaic gradient for highlighted comments.', 'COMMENT_GRADIENT', 230, '{"from":"#0e7490","to":"#172554","accent":"#fde68a","symbol":"MOSAIC"}', 1, 0, 40),
  ('item_odyssey_star_banner', 'odyssey-star-banner', 'collection_odyssey', 'Star Route', 'A deep-space banner traced by a luminous navigation route.', 'PROFILE_BANNER', 300, '{"from":"#0f172a","to":"#1d4ed8","accent":"#bfdbfe","symbol":"STAR"}', 1, 0, 10),
  ('item_odyssey_compass_frame', 'odyssey-compass-frame', 'collection_odyssey', 'Compass Halo', 'An animated celestial frame with a slowly turning compass halo.', 'PROFILE_FRAME', 420, '{"from":"#1e3a8a","to":"#020617","accent":"#60a5fa","symbol":"COMPASS"}', 1, 0, 20),
  ('item_odyssey_comet_effect', 'odyssey-comet-effect', 'collection_odyssey', 'Comet Reply', 'A small comet trail introduces your comment without obscuring text.', 'COMMENT_EFFECT', 240, '{"from":"#2563eb","to":"#7dd3fc","accent":"#f8fafc","symbol":"COMET"}', 1, 0, 30);
--> statement-breakpoint
UPDATE `series`
SET `reading_direction` = CASE
  WHEN `reading_direction` = 'RTL' THEN 'RIGHT_TO_LEFT'
  WHEN `reading_direction` = 'LTR' THEN 'LEFT_TO_RIGHT'
  ELSE `reading_direction`
END
WHERE `reading_direction` IN ('RTL', 'LTR');
--> statement-breakpoint
UPDATE `chapters`
SET `format` = CASE
  WHEN `format` IN ('RTL', 'LTR') THEN 'PAGED'
  ELSE `format`
END
WHERE `format` IN ('RTL', 'LTR');
--> statement-breakpoint
UPDATE `chapters`
SET
  `state` = 'PUBLISHED',
  `published_at` = COALESCE(`published_at`, datetime('now', '-60 days')),
  `updated_at` = CURRENT_TIMESTAMP
WHERE `state` = 'SCHEDULED'
  AND `series_id` IN (
    SELECT `id`
    FROM `series`
    WHERE `rights_status` IN ('DEMO_ORIGINAL', 'TEST_ORIGINAL')
  );
--> statement-breakpoint
UPDATE `chapters`
SET `page_count` = (
  SELECT COUNT(*)
  FROM `chapter_pages`
  WHERE `chapter_pages`.`chapter_id` = `chapters`.`id`
)
WHERE `series_id` IN (
  SELECT `id`
  FROM `series`
  WHERE `rights_status` IN ('DEMO_ORIGINAL', 'TEST_ORIGINAL')
);
--> statement-breakpoint
UPDATE `site_theme_settings`
SET
  `settings_json` = json_set(
    `settings_json`,
    '$.dark.background', '#07111f',
    '$.dark.backgroundSoft', '#0a1728',
    '$.dark.surface', '#0d1d31',
    '$.dark.surfaceRaised', '#12263f',
    '$.dark.surfaceStrong', '#18314f',
    '$.dark.line', '#244563',
    '$.dark.lineStrong', '#376789',
    '$.light.background', '#f3f8fc',
    '$.light.backgroundSoft', '#e8f1f8',
    '$.light.surface', '#ffffff',
    '$.light.surfaceRaised', '#dceaf4',
    '$.light.surfaceStrong', '#cddfeb',
    '$.light.line', '#bfd2df',
    '$.light.lineStrong', '#91afc3',
    '$.accent', '#39a9ff',
    '$.accentStrong', '#168de2',
    '$.accentInk', '#03111f',
    '$.gradient.from', '#168de2',
    '$.gradient.to', '#68d5ff'
  ),
  `revision` = `revision` + 1,
  `updated_at` = CURRENT_TIMESTAMP;
--> statement-breakpoint
UPDATE `commercial_settings`
SET
  `settings_json` = json_set(
    `settings_json`,
    '$.announcement.text', 'Discover premium chapters and profile cosmetics with Onyx Coins.',
    '$.announcement.buttonLabel', 'Open Store',
    '$.announcement.destinationUrl', '/store',
    '$.economy.packages[0].description', 'A small balance for occasional paid chapters and cosmetics.',
    '$.economy.memberships[0].description', 'Monthly reading benefits, cosmetic offers, and a recurring coin grant.',
    '$.economy.memberships[0].benefits', json_array('Ad-free reading', 'Member cosmetic offers', 'Monthly coin grant')
  ),
  `revision` = `revision` + 1,
  `updated_at` = CURRENT_TIMESTAMP;
