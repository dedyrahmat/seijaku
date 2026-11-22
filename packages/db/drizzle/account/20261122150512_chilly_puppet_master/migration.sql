CREATE TABLE `blob_owner` (
	`blob_id` text PRIMARY KEY,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `blob_owner_by_user` ON `blob_owner` (`user_id`);