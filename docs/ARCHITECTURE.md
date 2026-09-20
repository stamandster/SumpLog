# Architecture and data model

## Runtime

SumpLog is a client-heavy React single-page application. Vite builds the browser assets, and a Bun-hosted Hono application provides JSON/file endpoints and serves `dist/index.html` in production. There is no separate queue, cache server, object store, or external database.

```text
Browser
  ├─ React UI and local display preferences
  └─ /api requests and streamed downloads
        ↓
Bun + Hono
  ├─ authentication and security headers
  ├─ Zod request validation
  ├─ reports, exports, image derivatives, and file delivery
  └─ Drizzle ORM
        ↓
SQLite (WAL) + local upload directory
```

VIN decoding is the only built-in network integration. It calls the US NHTSA vPIC endpoint with an eight-second timeout. Calculators run locally in the browser.

## Source layout

```text
server/app.ts              API routes, validation, and workflows
server/security.ts         owner authentication and request protections
server/backup.ts           JSON snapshot validation, restore, and recovery backup
server/export.ts           ZIP/Excel and maintenance PDF generation
server/photos.ts           image normalization and bounded derivative cache
server/db/schema.ts        Drizzle schema and relationships
server/db/migrate.ts       startup/CLI migrations
src/App.tsx                application data orchestration and navigation
src/api.ts                 typed browser API client
src/components/            views, dialogs, evidence, charts, and navigation
src/calculators.ts         pure calculator functions
src/styles.css             responsive industrial design system
drizzle/                   ordered SQLite migrations
```

## Data relationships

| Record | Ownership and important relationships |
| --- | --- |
| Vehicle | Owns maintenance, mileage, specs, reminders, and vehicle-scoped records |
| Maintenance record | Belongs to one vehicle; links many parts and many documents; owns audit entries |
| Part/consumable | Garage-wide; links to zero or many vehicles and zero or many maintenance records |
| Specification | Belongs to one vehicle; may be copied or moved |
| Project | May belong to one vehicle; owns checklist tasks |
| Insurance policy | Garage-wide; links many vehicles and owns linked documents |
| Document | Stored once; may belong to a vehicle, project, or insurance policy and may link to many maintenance records |
| Service task | Has a compatibility owner plus a many-vehicle link table; owns checklist items and may link reminders |
| Reminder | Belongs to one vehicle and may reference a service task or maintenance record |

The `document_maintenance_links` table is authoritative for shared service evidence. The legacy `documents.maintenance_id` column remains for compatibility. Likewise, `service_plan_vehicles` is authoritative for multi-vehicle tasks while `service_plans.vehicle_id` remains a compatibility anchor.

## Storage and identity

SQLite uses foreign keys and WAL mode. Uploaded files are stored outside SQLite using UUID-based filenames. A document has:

- `tracking_id`: stable UUID used for identity and export tracking
- `original_name`: upload-time filename, retained unchanged
- `name`: user-editable display name used by the UI and search
- `storage_path`: server-side UUID path, never accepted directly from browser input

Image rotation, and vehicle zoom/position, are metadata. Originals are not overwritten. The server produces 640 px document previews and 960 px vehicle previews as WebP at quality 72, plus editor derivatives up to 1600 px. A bounded in-memory cache stores at most 128 derivative entries and approximately 20 MB.

## Deletion rules

SQLite cascades dependent rows where appropriate, but application services handle file cleanup and cross-record exceptions.

- Vehicle deletion removes vehicle-owned history and stored vehicle/doc files, unlinks garage parts and insurance, and preserves a service task if it still applies to another vehicle.
- Part deletion is refused while maintenance history references the part (`ON DELETE RESTRICT`).
- Maintenance deletion is represented in the UI by void/restore so audit history remains available.
- Insurance deletion removes policy documents; vehicle deletion does not delete an insurance policy.
- Document deletion removes every maintenance link and the stored file.

## Maintenance transaction behavior

Creating or editing maintenance with attachments uses a bundle endpoint. Metadata, part usage, audit state, document rows, and links are committed in one database transaction after uploads validate. Failed database work removes newly stored files. A submission key prevents accidental duplicate creation from retries.

Whole part quantities and fractional consumable equivalents are stored in `maintenance_parts`. The row also snapshots unit cost so later catalogue price changes do not rewrite historical service cost.

## Backup compatibility

Current backups are ZIP64 archives with version 4 `backup.json` and original files in `assets/`. Restore also accepts legacy JSON versions 2 and 3. Restore materializes legacy insurance, multi-vehicle task links, shared document links and missing document identities.

Portable snapshots contain all garage tables, image adjustment metadata and per-maintenance attachment order. ZIP asset entries have path, MIME type, byte size and SHA-256 checksums, not Base64. `server/backupZip.ts` uses archiver and yauzl for streaming disk-based staging and safe extraction into generated filenames. Missing/corrupt files and unsafe entries block restore. Recovery backups use ZIP too. Owner credentials are retained. Inserts are batched in one transaction, without a total row cap. Multipart uploads and JSON record parsing still consume memory; temporary disk capacity also matters.

## Security boundary

SumpLog assumes one trusted owner and a trusted host. It provides password authentication, same-origin write checks, request validation, safe upload-path checks, MIME allowlisting, security headers, and protected API routes. It does not provide per-record authorization, multiple users, encrypted storage, TLS termination, malware scanning, or cloud backup. Host access, disk encryption, HTTPS, firewall policy, and off-site backups remain deployment responsibilities.
