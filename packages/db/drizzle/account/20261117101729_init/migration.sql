CREATE TABLE `doc_version` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`doc` text NOT NULL,
	`meta` text NOT NULL,
	`blob_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `key_wrap` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text NOT NULL,
	`login_hash` text,
	`wrapped` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `share_link` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`blob_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_version_by_doc` ON `doc_version` (`user_id`,`doc`);--> statement-breakpoint
CREATE INDEX `key_wrap_by_user` ON `key_wrap` (`user_id`);--> statement-breakpoint
CREATE INDEX `key_wrap_by_login` ON `key_wrap` (`kind`,`login_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `share_link_by_token` ON `share_link` (`token`);