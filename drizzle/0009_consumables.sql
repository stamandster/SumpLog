ALTER TABLE parts ADD COLUMN item_type text NOT NULL DEFAULT 'Part';
--> statement-breakpoint
ALTER TABLE parts ADD COLUMN category text;
--> statement-breakpoint
ALTER TABLE parts ADD COLUMN specifications text;
--> statement-breakpoint
ALTER TABLE parts ADD COLUMN approvals text;
