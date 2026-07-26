ALTER TABLE `gift_cards` ADD `recipient_user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `gift_cards_recipient_status_idx` ON `gift_cards` (`recipient_user_id`,`status`);