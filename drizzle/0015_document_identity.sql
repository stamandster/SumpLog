ALTER TABLE documents ADD COLUMN tracking_id text;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN original_name text;
--> statement-breakpoint
UPDATE documents
SET tracking_id = lower(
  hex(randomblob(4)) || '-' ||
  hex(randomblob(2)) || '-' ||
  '4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' ||
  hex(randomblob(6))
), original_name = name
WHERE tracking_id IS NULL OR original_name IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX documents_tracking_id_unique ON documents (tracking_id);
