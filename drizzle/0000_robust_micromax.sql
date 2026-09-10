CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer,
	`maintenance_id` integer,
	`project_id` integer,
	`kind` text DEFAULT 'Other' NOT NULL,
	`name` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`maintenance_id`) REFERENCES `maintenance_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `documents_vehicle_kind_idx` ON `documents` (`vehicle_id`,`kind`);--> statement-breakpoint
CREATE TABLE `maintenance_parts` (
	`maintenance_id` integer NOT NULL,
	`part_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_cost_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`maintenance_id`, `part_id`),
	FOREIGN KEY (`maintenance_id`) REFERENCES `maintenance_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `maintenance_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`service_date` text NOT NULL,
	`mileage` integer NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`labor_hours` real DEFAULT 0 NOT NULL,
	`difficulty` integer DEFAULT 1 NOT NULL,
	`shop_name` text,
	`notes` text,
	`next_due_date` text,
	`next_due_mileage` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_vehicle_date_idx` ON `maintenance_records` (`vehicle_id`,`service_date`);--> statement-breakpoint
CREATE INDEX `maintenance_vehicle_mileage_idx` ON `maintenance_records` (`vehicle_id`,`mileage`);--> statement-breakpoint
CREATE TABLE `parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`part_number` text NOT NULL,
	`name` text NOT NULL,
	`manufacturer` text,
	`supplier_name` text,
	`supplier_url` text,
	`purchase_price_cents` integer DEFAULT 0 NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`minimum_quantity` integer DEFAULT 0 NOT NULL,
	`storage_location` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parts_number_manufacturer_idx` ON `parts` (`part_number`,`manufacturer`);--> statement-breakpoint
CREATE INDEX `parts_name_idx` ON `parts` (`name`);--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`estimated_cost_cents` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_tasks_project_position_idx` ON `project_tasks` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'Backlog' NOT NULL,
	`estimated_budget_cents` integer DEFAULT 0 NOT NULL,
	`actual_cost_cents` integer DEFAULT 0 NOT NULL,
	`target_date` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `projects_vehicle_status_idx` ON `projects` (`vehicle_id`,`status`);--> statement-breakpoint
CREATE TABLE `reference_specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`group_name` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`source` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `specs_vehicle_label_idx` ON `reference_specs` (`vehicle_id`,`group_name`,`label`);--> statement-breakpoint
CREATE TABLE `vehicle_parts` (
	`vehicle_id` integer NOT NULL,
	`part_id` integer NOT NULL,
	`fitment_notes` text,
	PRIMARY KEY(`vehicle_id`, `part_id`),
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vin` text,
	`year` integer NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`trim` text,
	`nickname` text,
	`mileage` integer DEFAULT 0 NOT NULL,
	`color` text,
	`engine` text,
	`transmission` text,
	`insurance_expires_at` text,
	`registration_expires_at` text,
	`image_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_vin_unique` ON `vehicles` (`vin`);--> statement-breakpoint
CREATE INDEX `vehicles_make_model_idx` ON `vehicles` (`make`,`model`);