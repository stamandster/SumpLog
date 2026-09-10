CREATE TABLE `insurance_policies` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `provider` text NOT NULL,
  `policy_number` text,
  `agent_name` text,
  `agent_phone` text,
  `effective_at` text,
  `expires_at` text,
  `premium_cents` integer,
  `notes` text,
  `legacy_source_vehicle_id` integer,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_policies_legacy_source_vehicle_id_unique` ON `insurance_policies` (`legacy_source_vehicle_id`);
--> statement-breakpoint
CREATE INDEX `insurance_policies_provider_idx` ON `insurance_policies` (`provider`);
--> statement-breakpoint
CREATE TABLE `insurance_policy_vehicles` (
  `insurance_policy_id` integer NOT NULL,
  `vehicle_id` integer NOT NULL,
  PRIMARY KEY(`insurance_policy_id`, `vehicle_id`),
  FOREIGN KEY (`insurance_policy_id`) REFERENCES `insurance_policies`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `insurance_policy_id` integer REFERENCES `insurance_policies`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `documents_insurance_policy_idx` ON `documents` (`insurance_policy_id`);
--> statement-breakpoint
INSERT INTO `insurance_policies` (`provider`, `policy_number`, `agent_name`, `agent_phone`, `effective_at`, `expires_at`, `premium_cents`, `notes`, `legacy_source_vehicle_id`)
SELECT COALESCE(NULLIF(`insurance_provider`, ''), 'Insurance policy'), NULLIF(`insurance_policy_number`, ''), NULLIF(`insurance_agent_name`, ''), NULLIF(`insurance_agent_phone`, ''), NULLIF(`insurance_effective_at`, ''), NULLIF(`insurance_expires_at`, ''), `insurance_premium_cents`, NULLIF(`insurance_notes`, ''), `id`
FROM `vehicles`
WHERE NULLIF(`insurance_provider`, '') IS NOT NULL OR NULLIF(`insurance_policy_number`, '') IS NOT NULL;
--> statement-breakpoint
INSERT INTO `insurance_policy_vehicles` (`insurance_policy_id`, `vehicle_id`)
SELECT `id`, `legacy_source_vehicle_id` FROM `insurance_policies` WHERE `legacy_source_vehicle_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `vehicles` SET `insurance_provider` = NULL, `insurance_policy_number` = NULL, `insurance_agent_name` = NULL, `insurance_agent_phone` = NULL, `insurance_effective_at` = NULL, `insurance_expires_at` = NULL, `insurance_premium_cents` = NULL, `insurance_notes` = NULL;
