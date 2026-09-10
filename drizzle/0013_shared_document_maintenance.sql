CREATE TABLE `document_maintenance_links` (
	`document_id` integer NOT NULL,
	`maintenance_id` integer NOT NULL,
	PRIMARY KEY(`document_id`, `maintenance_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`maintenance_id`) REFERENCES `maintenance_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_maintenance_links_record_idx` ON `document_maintenance_links` (`maintenance_id`,`document_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `document_maintenance_links` (`document_id`, `maintenance_id`)
SELECT `id`, `maintenance_id` FROM `documents` WHERE `maintenance_id` IS NOT NULL;
