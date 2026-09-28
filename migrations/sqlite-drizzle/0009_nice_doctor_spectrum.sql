CREATE TABLE `novel_chapter` (
	`id` text PRIMARY KEY NOT NULL,
	`novel_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`outline` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "novel_chapter_status_check" CHECK("novel_chapter"."status" IN ('draft', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `novel_chapter_novel_id_order_key_idx` ON `novel_chapter` (`novel_id`,`order_key`);--> statement-breakpoint
CREATE TABLE `novel` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`synopsis` text,
	`creation_mode` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "novel_creation_mode_check" CHECK("novel"."creation_mode" IN ('structured', 'remodel', 'free', 'imported'))
);
--> statement-breakpoint
CREATE TABLE `novel_entity_relation` (
	`id` text PRIMARY KEY NOT NULL,
	`novel_id` text NOT NULL,
	`from_entity_id` text NOT NULL,
	`to_entity_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_entity_id`) REFERENCES `novel_entity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_entity_id`) REFERENCES `novel_entity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_entity_relation_novel_idx` ON `novel_entity_relation` (`novel_id`);--> statement-breakpoint
CREATE TABLE `novel_entity` (
	`id` text PRIMARY KEY NOT NULL,
	`novel_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`card` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "novel_entity_type_check" CHECK("novel_entity"."type" IN ('character', 'location', 'item', 'organization', 'other'))
);
--> statement-breakpoint
CREATE INDEX `novel_entity_novel_type_idx` ON `novel_entity` (`novel_id`,`type`);--> statement-breakpoint
CREATE TABLE `st_preset` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worldbook_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`worldbook_id` text NOT NULL,
	`keys` text NOT NULL,
	`secondary_keys` text,
	`comment` text,
	`content` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`constant` integer DEFAULT false NOT NULL,
	`selective` integer DEFAULT false NOT NULL,
	`position` integer,
	`depth` integer,
	`insertion_order` integer DEFAULT 100 NOT NULL,
	`probability` integer,
	`extra` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`worldbook_id`) REFERENCES `worldbook`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `worldbook_entry_worldbook_idx` ON `worldbook_entry` (`worldbook_id`);--> statement-breakpoint
CREATE TABLE `worldbook` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "worldbook_source_check" CHECK("worldbook"."source" IN ('imported', 'created'))
);
