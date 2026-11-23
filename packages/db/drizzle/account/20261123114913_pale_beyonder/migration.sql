CREATE TABLE `account_key` (
	`user_id` text PRIMARY KEY,
	`public_key` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `share_invite` (
	`id` text PRIMARY KEY,
	`share_id` text NOT NULL,
	`role` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`wrapped` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `share_member` (
	`id` text PRIMARY KEY,
	`share_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`epoch` integer DEFAULT 0 NOT NULL,
	`wrapped_key` text,
	`label` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shared_page` (
	`id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`epoch` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `share_invite_by_page` ON `share_invite` (`share_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `share_member_by_page_user` ON `share_member` (`share_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `share_member_by_user` ON `share_member` (`user_id`);--> statement-breakpoint
CREATE INDEX `shared_page_by_owner` ON `shared_page` (`owner_id`);