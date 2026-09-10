# HTTP API reference

The API is intended for SumpLog's own React client. It is not versioned as a public compatibility contract. Unless noted, routes are under `/api`, require the owner session when authentication is enabled, return JSON, and send `Cache-Control: no-store`.

## Authentication and errors

`GET /auth/status`, `POST /auth/login`, and `GET /health` are public. Successful login sets the `sumplog_session` HTTP-only cookie. Write requests with an `Origin` header must match the request host.

Validation errors generally use HTTP 400 or 422. Missing records use 404, workflow conflicts use 409, unauthenticated requests use 401, local-only LAN attempts use 403, and rate limiting uses 429. Error bodies have an `error` string and may include `fields`.

## Routes

### System and access

- `GET /health`
- `GET /auth/status`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/password`

### Vehicles, photos, and mileage

- `GET /vehicles`
- `POST /vehicles`
- `PUT /vehicles/:id`
- `DELETE /vehicles/:id`
- `GET /vin/:vin`
- `GET /vehicles/:id/image`
- `POST /vehicles/:id/image`
- `DELETE /vehicles/:id/image`
- `POST /vehicles/:id/photo-rotation`
- `GET /vehicles/:id/mileage`
- `POST /vehicles/:id/mileage`
- `PUT /mileage/:id`
- `GET /vehicles/:id/dashboard`

Photo reads accept `preview=1` for a reduced WebP derivative, `editor=1` for an editor-sized derivative, `normalized=1` for a rendered full image, and `original=1` to bypass saved rotation where applicable.

### Maintenance

- `GET /vehicles/:id/maintenance`
- `POST /vehicles/:id/maintenance`
- `PUT /maintenance/:id`
- `POST /vehicles/:id/maintenance-bundle`
- `PUT /maintenance/:id/bundle`
- `GET /maintenance/:id/audit`
- `PATCH /maintenance/:id/status`
- `PATCH /maintenance/:id/due`

Bundle routes accept multipart form data: JSON `record`, JSON `attachments`, and repeated `files`. Attachment metadata and files are positional. The UI limits a draft to 50 new files; every file must be at most 15 MB.

### Parts and consumables

- `GET /parts?vehicleId=:id&q=:search`
- `POST /parts`
- `PUT /parts/:id`
- `DELETE /parts/:id`

Omitting `vehicleId` returns garage-wide inventory. Items expose `fitments`; maintenance usage records whole or partial consumption and an equivalent quantity.

### Specifications and projects

- `GET /vehicles/:id/specs`
- `POST /vehicles/:id/specs`
- `PUT /specs/:id`
- `DELETE /specs/:id`
- `POST /specs/:id/clone`
- `PATCH /specs/:id/vehicle`
- `GET /projects?vehicleId=:id`
- `POST /vehicles/:id/projects`
- `PUT /projects/:id`
- `DELETE /projects/:id`
- `PATCH /project-tasks/:id`

### Documents and insurance

- `GET /documents`
- `POST /documents`
- `GET /documents/:id/file`
- `PUT /documents/:id`
- `DELETE /documents/:id`
- `POST /documents/:id/photo-rotation`
- `GET /insurance`
- `POST /insurance`
- `PUT /insurance/:id`
- `DELETE /insurance/:id`

Document filters include `vehicleId`, `kind`, `category`, `from`, and `to`. Uploads use multipart form data and may include `vehicleId`, `maintenanceId` or JSON `maintenanceIds`, `insurancePolicyId`, `projectId`, `kind`, `name`, `notes`, and `file`. File reads support the same image-rendering query parameters as vehicle photos.

### Service tasks, reminders, and alerts

- `GET /vehicles/:id/service-plans`
- `POST /vehicles/:id/service-plans`
- `PUT /service-plans/:id`
- `DELETE /service-plans/:id`
- `POST /service-plans/:id/complete`
- `GET /vehicles/:id/reminders`
- `POST /vehicles/:id/reminders`
- `PUT /reminders/:id`
- `PATCH /reminders/:id`
- `DELETE /reminders/:id`
- `GET /alerts?vehicleId=:id`

### Export, backup, and restore

- `GET /export/archive.zip`
- `GET /export/maintenance.pdf?ids=1,2,3`
- `GET /export/maintenance.csv`
- `GET /export/all.csv`
- `GET /export/json`
- `POST /import/preview`
- `POST /import/json`
- `GET /backups/:name`

Omit `ids` from the PDF route to include every maintenance record. JSON import accepts multipart `file`; the commit route also requires `confirmation=REPLACE`. Export responses use attachment filenames and should be streamed to disk rather than loaded into application memory by clients.

## Upload types and limits

Allowed MIME types are JPEG, PNG, WebP, PDF, plain text, CSV, DOCX, XLSX, and ODT. Each stored upload is limited to 15 MB. The Bun server permits request bodies up to 128 MB. JSON restore accepts backups up to 120 MB.

## Examples

Health check:

```bash
curl http://127.0.0.1:3000/api/health
```

Authenticated clients should first post the password and retain cookies:

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"password":"your-owner-password"}' \
  http://127.0.0.1:3000/api/auth/login

curl -b cookies.txt http://127.0.0.1:3000/api/vehicles
```

The examples describe the interface shape; credentials and garage data must never be committed to the repository.
