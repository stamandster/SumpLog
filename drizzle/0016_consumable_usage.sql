ALTER TABLE maintenance_parts ADD COLUMN usage_mode text NOT NULL DEFAULT 'Whole';
--> statement-breakpoint
ALTER TABLE maintenance_parts ADD COLUMN amount_used real;
--> statement-breakpoint
ALTER TABLE maintenance_parts ADD COLUMN amount_unit text;
