# Self-hosting SumpLog

SumpLog runs as one Bun process in production: Hono serves both the compiled React application and `/api`. SQLite and uploads require persistent storage.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Hono HTTP port |
| `HOST` | `0.0.0.0` when a password exists; otherwise forced to `127.0.0.1` | Listening interface |
| `DATABASE_URL` | `./data/sumplog.db` | SQLite file path |
| `UPLOAD_DIRECTORY` | `data/uploads` | Vehicle photos and document files |
| `SUMPLOG_PASSWORD` | unset | Initial owner password; minimum 12 characters in production |
| `NODE_ENV` | unset | `production` enables the production password requirement and stricter headers/cookies |

Migrations run automatically at startup. The application creates the database parent directory and enables SQLite WAL mode and foreign keys.

## Native installation

```bash
bun install --frozen-lockfile
bun run build
```

Set the environment for the shell or service manager, then start:

```powershell
$env:NODE_ENV = "production"
$env:SUMPLOG_PASSWORD = "replace-with-a-long-unique-password"
$env:HOST = "0.0.0.0"
$env:PORT = "3000"
bun run start
```

Verify locally:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Expected fields are `ok: true` and `service: sumplog`.

## Windows bootstrap script

For a production-style background instance with a checked build and LAN address check, run the repository's `bootstrap.ps1` from its root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -OpenBrowser
```

It reuses a healthy SumpLog already listening on the requested port; otherwise it checks whether the local database already has an owner credential. On a first run it securely prompts for and confirms a 12+ character password. The server converts that initial value into a password hash stored in SQLite, so later launcher runs do not need the password again. It then installs locked dependencies, builds the app, starts it in the background, and prints the process ID, logs, local URL, and verified LAN URL. It never seeds, resets, or replaces garage data.

To stop the instance, use the PID printed at startup:

```powershell
Stop-Process -Id <PID>
```

If the startup window was closed, find and stop the process listening on the default SumpLog port:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  Select-Object -ExpandProperty OwningProcess |
  ForEach-Object { Stop-Process -Id $_ }
```

Only use that fallback if port 3000 is dedicated to SumpLog; it intentionally stops whatever process owns that port. To use another port, start with `-Port 3001` and substitute that number in the lookup command.

## LAN access on Windows

Find the private IPv4 address:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -NotLike '169.254*'
```

From another device on the same trusted network, open `http://<private-ip>:3000`. If it cannot connect, confirm that SumpLog is listening and that Windows Firewall permits inbound TCP 3000 for the appropriate network profile.

Binding to `0.0.0.0` exposes the service on every host interface. SumpLog intentionally refuses LAN API access when no owner password is configured. Do not forward port 3000 directly to the internet. Put SumpLog behind an HTTPS reverse proxy with access controls if access must cross an untrusted network.

## Docker Compose

The included Compose configuration publishes only to `127.0.0.1:3000` by default and stores data in the `sumplog-data` volume:

```powershell
$env:SUMPLOG_PASSWORD = "replace-with-a-long-unique-password"
docker compose up --build -d
```

For deliberate LAN exposure, change the port mapping in `compose.yaml` from `127.0.0.1:3000:3000` to `3000:3000`, then recreate the service. Keep the password configured and limit firewall scope to the trusted subnet.

## Authentication behavior

- Sessions live in server memory for 12 hours and use an HTTP-only, SameSite=Strict cookie.
- Ten failed sign-in attempts within 15 minutes trigger a 15-minute rate limit.
- Password changes use scrypt with a random salt, persist the hash in SQLite, and invalidate other sessions.
- Restarting the process invalidates every active session.
- In production, the session cookie is marked Secure. Production deployments therefore need HTTPS for normal browser sign-in.
- SumpLog is single-owner. It does not provide user accounts, roles, business licensing, password recovery email, or remote identity integration.

## Backups

Use Settings > Data & backups > Full ZIP backup. It packages JSON records with original files and supports in-app restore. Legacy JSON backups remain importable. The separate readable Excel export is not a restore format.

For a filesystem backup, stop SumpLog first and copy the SQLite database, its `-wal` and `-shm` companions if present, and the entire uploads directory. Copying a running WAL database without its companion files can produce an incomplete backup.

Before an in-app restore, SumpLog creates `pre-restore-<uuid>.zip` under a `backups` directory beside the database. Restore replaces all garage tables and regenerates asset paths while preserving original file bytes, identifiers and record links. The owner credential table is retained, and browser preferences are unaffected. Download the offered recovery backup after completion; missing files in that recovery snapshot are reported. Existing upload files are not purged during restore.

## Updating

1. Create a Full ZIP backup and, for important garages, a stopped filesystem backup.
2. Install the updated code and dependencies.
3. Run `bun run build`.
4. Start SumpLog. Pending Drizzle migrations apply automatically.
5. Run the health check and open the main workflows before removing the previous deployment.

There is no automated downgrade path. Roll back application code together with the pre-update data backup when a migration is incompatible with the older version.

## Troubleshooting

### LAN address returns 403

No password is configured. Set `SUMPLOG_PASSWORD` to at least 12 characters and restart.

### Production exits during startup

Production requires either a saved owner credential in the database or a `SUMPLOG_PASSWORD` of at least 12 characters.

### Upload returns 500 or 422

Check free disk space and permissions for `UPLOAD_DIRECTORY`. Ordinary uploads must be 15 MB or less per file and use a supported MIME type. Backup restoration is exempt from that per-file cap and the server has no HTTP request-body size cap; keep it authenticated and restrict network access to trusted users.

### Restore is rejected

Select the complete version 4 ZIP backup, or a legacy version 2/3 JSON file. Run Check backup first. Restore requires `REPLACE` and rejects missing/damaged attachments and unsafe archive entries. There are no backup byte or record-count caps. ZIP files are staged in the OS temporary directory and processed using streams; allow space there and in the data directory for the archive, extracted originals and recovery backup. JSON record parsing and multipart requests still require memory. Reverse proxies may need larger upload/time limits. For backups beyond host capacity, use the stopped-server procedure above.

### Health works but the interface is missing

Run `bun run build` so `dist/index.html` exists, then restart the production server.
