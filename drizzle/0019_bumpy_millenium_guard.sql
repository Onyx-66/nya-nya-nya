ALTER TABLE `discussion_comments` ADD `cosmetic_item_id` text REFERENCES store_items(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `support_tickets` ADD `revision` integer DEFAULT 1 NOT NULL;
