CREATE TABLE `maintenance_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`maintenance_id` integer NOT NULL,
	`operation` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`summary` text,
	`changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`maintenance_id`) REFERENCES `maintenance_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_audit_record_idx` ON `maintenance_audit_logs` (`maintenance_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `mileage_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`recorded_date` text NOT NULL,
	`mileage` integer NOT NULL,
	`annual_mileage_estimate` integer,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mileage_vehicle_date_idx` ON `mileage_entries` (`vehicle_id`,`recorded_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `mileage_vehicle_date_unique` ON `mileage_entries` (`vehicle_id`,`recorded_date`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`service_plan_id` integer,
	`title` text NOT NULL,
	`due_date` text,
	`due_mileage` integer,
	`status` text DEFAULT 'Active' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_plan_id`) REFERENCES `service_plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reminders_vehicle_status_idx` ON `reminders` (`vehicle_id`,`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `service_plan_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_plan_id` integer NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`service_plan_id`) REFERENCES `service_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_plan_items_plan_idx` ON `service_plan_items` (`service_plan_id`,`position`);--> statement-breakpoint
CREATE TABLE `service_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`interval_mileage` integer,
	`interval_months` integer,
	`next_due_mileage` integer,
	`next_due_date` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_plans_vehicle_due_idx` ON `service_plans` (`vehicle_id`,`next_due_date`,`next_due_mileage`);--> statement-breakpoint
ALTER TABLE `vehicles` ADD `annual_mileage_estimate` integer;--> statement-breakpoint
UPDATE `vehicles`
SET `annual_mileage_estimate` = CAST(`mileage` / MAX(1, CAST(strftime('%Y', 'now') AS integer) - `year` + 1) AS integer)
WHERE `annual_mileage_estimate` IS NULL;--> statement-breakpoint
INSERT INTO `mileage_entries` (`vehicle_id`, `recorded_date`, `mileage`, `annual_mileage_estimate`, `notes`)
SELECT `id`, date('now'), `mileage`, `annual_mileage_estimate`, 'Imported from existing vehicle mileage'
FROM `vehicles`;
