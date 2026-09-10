ALTER TABLE vehicles ADD COLUMN photo_zoom real NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE vehicles ADD COLUMN photo_position_x integer NOT NULL DEFAULT 50;
--> statement-breakpoint
ALTER TABLE vehicles ADD COLUMN photo_position_y integer NOT NULL DEFAULT 50;
