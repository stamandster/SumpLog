# SumpLog

SumpLog is a free, self-hosted garage record for home mechanics and DIY car enthusiasts. It keeps vehicle history, service evidence, inventory, technical references, projects, insurance, and reminders together without per-vehicle limits or a subscription.

The current application is single-owner software. Multi-user and licensed business-mechanic features are future work and are not part of this release.

## What it includes

- Unlimited vehicles, VIN decoding, editable vehicle details and photos, dated mileage readings, and mileage projections
- Maintenance records with parts and partial-consumable usage, costs, labor, next-due values, attachments, PDF reports, void/restore, and change history
- Garage-wide parts and consumables inventory with multi-vehicle fitment, stock thresholds, volume, specifications, approvals, suppliers, and locations
- Vehicle-specific specifications with search, filtering, sorting, copying, and confirmed moving
- Multi-vehicle service tasks, reminders, checklists, and dashboard due-state indicators
- Project planning with workflow status, budgets, target dates, and checklist items
- A searchable document gallery with lazy previews, editable display names, stable tracking IDs, photo rotation, and links to multiple maintenance records
- Independent insurance policies that can cover zero, one, or several vehicles and retain their own documents
- Print-friendly maintenance PDF reports, a human-readable ZIP/Excel export, CSV summaries, and restorable JSON backups
- Local calculators for fluid usage by weight, torque, volume, pressure, flooded-battery hydrometer readings, and coolant protection

## Quick start

Install [Bun](https://bun.sh/), then run:

```bash
bun install
bun run dev
```

Open `http://localhost:5173`. Vite serves the React client and proxies `/api` to the Hono server on port 3000. Database migrations run automatically when the server starts. A new database is empty; `bun run db:seed` adds optional demonstration records only when no vehicle exists.

For a production-style build served entirely by Hono:

```bash
bun run build
bun run start
```

Open `http://localhost:3000`.

## Network access

Without a password, SumpLog deliberately binds to loopback and rejects API access through a LAN address. Set an owner password of at least 12 characters before exposing it to another device:

```powershell
$env:SUMPLOG_PASSWORD = "replace-with-a-long-password"
$env:HOST = "0.0.0.0"
bun run start
```

Then open `http://<server-ip>:3000` from another machine. Windows Firewall and the network profile must permit inbound TCP 3000. Plain HTTP is appropriate only on a trusted private network; use an HTTPS reverse proxy for broader access. See [Self-hosting](docs/SELF_HOSTING.md).

## Documentation

- [User guide](docs/USER_GUIDE.md) — workflows, attachments, deletion behavior, exports, and recovery
- [Self-hosting](docs/SELF_HOSTING.md) — configuration, LAN access, Docker, security, backup, and troubleshooting
- [Architecture and data model](docs/ARCHITECTURE.md) — runtime structure, storage, relationships, and deletion rules
- [API reference](docs/API.md) — routes, authentication, uploads, response behavior, and export endpoints
- [Development guide](docs/DEVELOPMENT.md) — repository layout, scripts, migrations, tests, and contribution checks
- [Visual concepts](design-concepts/README.md) — the explorations that led to the current clean parts-counter direction

## Data location

Defaults:

- SQLite: `data/sumplog.db`
- Uploads: `data/uploads/`
- Automatic pre-restore recovery files: `data/backups/`

Set `DATABASE_URL`, `UPLOAD_DIRECTORY`, `PORT`, and `HOST` to override runtime paths and listening behavior. Back up the database and uploads together, or use the in-app JSON backup, which embeds stored assets.

## Verification

```bash
bun run check
```

This runs TypeScript checking, the production client build, and the Bun test suite.

## License

[MIT](LICENSE)
