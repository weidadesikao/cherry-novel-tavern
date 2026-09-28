CREATE TABLE `timeline_event` (
	`id` text PRIMARY KEY NOT NULL,
	`novel_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`event_type` text DEFAULT 'other' NOT NULL,
	`story_time` text,
	`location` text,
	`participants` text,
	`chapter_id` text,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `novel_chapter`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "timeline_event_type_check" CHECK("timeline_event"."event_type" IN ('plot', 'turn', 'reveal', 'conflict', 'daily', 'other'))
);
--> statement-breakpoint
CREATE INDEX `timeline_event_novel_id_order_key_idx` ON `timeline_event` (`novel_id`,`order_key`);