ALTER TABLE `reminders` ADD `maintenance_id` integer REFERENCES `maintenance_records`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `reminders_maintenance_status_idx` ON `reminders` (`maintenance_id`, `status`);
--> statement-breakpoint
INSERT INTO `reminders` (`vehicle_id`, `maintenance_id`, `title`, `due_date`, `due_mileage`, `status`, `notes`)
SELECT `vehicle_id`, `id`, `title`, `next_due_date`, `next_due_mileage`, 'Active', 'Created from maintenance follow-up.'
FROM `maintenance_records`
WHERE `voided_at` IS NULL
  AND (`next_due_date` IS NOT NULL OR `next_due_mileage` IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `reminders` WHERE `reminders`.`maintenance_id` = `maintenance_records`.`id` AND `reminders`.`status` = 'Active');
