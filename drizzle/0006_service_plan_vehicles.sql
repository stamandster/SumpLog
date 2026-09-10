CREATE TABLE `service_plan_vehicles` (
  `service_plan_id` integer NOT NULL,
  `vehicle_id` integer NOT NULL,
  PRIMARY KEY(`service_plan_id`, `vehicle_id`),
  FOREIGN KEY (`service_plan_id`) REFERENCES `service_plans`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_plan_vehicles_vehicle_idx` ON `service_plan_vehicles` (`vehicle_id`);
--> statement-breakpoint
INSERT INTO `service_plan_vehicles` (`service_plan_id`, `vehicle_id`)
SELECT `id`, `vehicle_id` FROM `service_plans`;
