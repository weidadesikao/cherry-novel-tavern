CREATE TABLE `novel_chat_session` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`novel_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `novel_chapter`(`id`) ON UPDATE no action ON DELETE cascade
);
