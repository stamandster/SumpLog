ALTER TABLE maintenance_records ADD COLUMN submission_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX maintenance_submission_key_idx ON maintenance_records(submission_key);
