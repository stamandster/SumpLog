ALTER TABLE document_maintenance_links ADD COLUMN position integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE document_maintenance_links
SET position = (
  SELECT COUNT(*)
  FROM document_maintenance_links AS earlier
  WHERE earlier.maintenance_id = document_maintenance_links.maintenance_id
    AND earlier.document_id < document_maintenance_links.document_id
);
--> statement-breakpoint
DROP INDEX IF EXISTS document_maintenance_links_record_idx;
--> statement-breakpoint
CREATE INDEX document_maintenance_links_record_idx
  ON document_maintenance_links (maintenance_id, position, document_id);
