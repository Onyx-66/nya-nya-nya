CREATE TABLE `roulette_reward_cadence` (
	`pool_key` text NOT NULL,
	`reward_key` text NOT NULL,
	`interval_spins` integer NOT NULL,
	`next_due_spin` integer NOT NULL,
	`last_awarded_spin` integer,
	`last_spin_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`pool_key`, `reward_key`),
	CONSTRAINT "roulette_reward_cadence_interval_check" CHECK("roulette_reward_cadence"."interval_spins" >= 2)
);
--> statement-breakpoint
CREATE INDEX `roulette_reward_cadence_due_idx` ON `roulette_reward_cadence` (`pool_key`,`next_due_spin`);--> statement-breakpoint
ALTER TABLE `analytics_events` ADD `visitor_id` text;--> statement-breakpoint
CREATE INDEX `analytics_events_visitor_idx` ON `analytics_events` (`visitor_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `roulette_pool_counters` ADD `last_spin_id` text;