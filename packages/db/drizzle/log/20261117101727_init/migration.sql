CREATE TABLE IF NOT EXISTS `doc_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT,
	`doc_id` text NOT NULL,
	`data` blob NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `doc_log_by_doc` ON `doc_log` (`doc_id`,`seq`);