CREATE TABLE `theme_catalog_reward_claims` (
	`creator_user_id` text NOT NULL,
	`theme_reference` text NOT NULL,
	`transaction_id` text NOT NULL,
	`selected_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`creator_user_id`, `theme_reference`),
	FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `ledger_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`selected_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `theme_catalog_reward_claims_theme_reference_check` CHECK (`theme_reference` LIKE 'custom:%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `theme_catalog_reward_claims_transaction_uidx`	ON `theme_catalog_reward_claims` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `theme_catalog_reward_claims_creator_idx`	ON `theme_catalog_reward_claims` (`creator_user_id`, `created_at`);
