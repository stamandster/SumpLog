import { getTableColumns } from "drizzle-orm";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { db } from "./db/client";
import * as schema from "./db/schema";
import { createReadStream, readBackupZip, stageAsset, temporaryBackup, writeBackupZip, type StoredAsset } from "./backupZip";

const tables = {
  vehicles: schema.vehicles, parts: schema.parts, maintenanceRecords: schema.maintenanceRecords,
  projects: schema.projects, servicePlans: schema.servicePlans, servicePlanVehicles: schema.servicePlanVehicles, vehicleParts: schema.vehicleParts,
  maintenanceParts: schema.maintenanceParts, referenceSpecs: schema.referenceSpecs,
  projectTasks: schema.projectTasks, servicePlanItems: schema.servicePlanItems,
  reminders: schema.reminders, mileageEntries: schema.mileageEntries,
  maintenanceAuditLogs: schema.maintenanceAuditLogs, insurancePolicies: schema.insurancePolicies,
  insurancePolicyVehicles: schema.insurancePolicyVehicles, documents: schema.documents,
  documentMaintenanceLinks: schema.documentMaintenanceLinks,
};
type TableKey = keyof typeof tables;
type Row = Record<string, string | number | boolean | null | undefined>;
const uploads = resolve(process.env.UPLOAD_DIRECTORY ?? "data/uploads");
const backups = resolve(dirname(process.env.DATABASE_URL ?? "data/sumplog.db"), "backups");
const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf", "text/plain": ".txt", "text/csv": ".csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx", "application/vnd.oasis.opendocument.text": ".odt" };
function safeUploadPath(path: string) {
  const resolved = resolve(path); const rel = relative(uploads, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("A backup contains an unsafe attachment path.");
  return resolved;
}

const rowValidators = Object.fromEntries(Object.entries(tables).map(([key, table]) => {
  const fields: Record<string, z.ZodType> = {};
  for (const [name, column] of Object.entries(getTableColumns(table))) {
    let validator: z.ZodType = column.dataType === "number" ? (column.columnType === "SQLiteInteger" ? z.number().int() : z.number()) : column.dataType === "boolean" ? z.boolean() : column.enumValues?.length ? z.enum(column.enumValues as [string, ...string[]]) : z.string();
    // SQLite's INTEGER affinity also stores fractional consumable balances.
    if (key === "parts" && name === "quantity") validator = z.number().nonnegative();
    if (name === "id") validator = z.number().int().positive();
    else { if (!column.notNull) validator = validator.nullable(); if (column.hasDefault || !column.notNull) validator = validator.optional(); }
    fields[name] = validator;
  }
  const rows = z.array(z.object(fields));
  return [key, ["maintenanceParts", "insurancePolicies", "insurancePolicyVehicles", "servicePlanVehicles", "documentMaintenanceLinks"].includes(key) ? rows.default([]) : rows];
}));
const assetValidator = z.object({ mimeType: z.string().transform((mime) => mime.split(";", 1)[0].toLowerCase()).refine((mime) => Boolean(extensions[mime]), "Unsupported attachment format."), data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).refine((value) => value.length % 4 === 0, "Invalid base64 attachment."), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });
const zipAssetValidator = z.object({ mimeType: assetValidator.shape.mimeType, file: z.string().regex(/^assets\/(vehicles|documents)-[1-9]\d*\.[a-z]+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().nonnegative() });
const backupValidator = z.union([
  z.object({ formatVersion: z.union([z.literal(2), z.literal(3)]), ...rowValidators, assets: z.record(z.string(), assetValidator).default({}) }),
  z.object({ formatVersion: z.literal(4), ...rowValidators, assets: z.record(z.string(), zipAssetValidator) }),
]);
type Snapshot = { formatVersion: number; assets: Record<string, { mimeType: string; data?: string; sha256?: string; file?: string; sizeBytes?: number }> } & Record<TableKey, Row[]>;

function snapshotRows() {
  return db.transaction((tx) => Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, tx.select().from(table).all()]))) as unknown as Record<TableKey, Row[]>;
}

async function createPortableZip(destination: string, allowMissing = false) {
  const temp = await temporaryBackup();
  try {
    const snapshot = snapshotRows(); const assets: Snapshot["assets"] = {}; const files = new Map<string, StoredAsset>(); const warnings: string[] = [];
    for (const [table, column] of [["vehicles", "imageUrl"], ["documents", "storagePath"]] as const) for (const row of snapshot[table]) {
      if (!row[column]) continue;
      const key = `${table}-${row.id}`;
      try {
        const source = safeUploadPath(String(row[column]));
        const mimeType = String(row.mimeType || Bun.file(source).type || "text/plain").split(";", 1)[0].toLowerCase();
        if (!extensions[mimeType]) throw new Error("Unsupported attachment format.");
        const file = `assets/${key}${extensions[mimeType]}`;
        const stored = await stageAsset(createReadStream(source), resolve(temp.root, key));
        assets[key] = { mimeType, file, sha256: stored.sha256, sizeBytes: stored.sizeBytes }; files.set(file, stored);
      } catch (error) {
        if (!allowMissing) throw new Error(`Complete backup failed for ${row.name || `vehicle ${row.id}`}: ${error instanceof Error ? error.message : "unreadable attachment"}`);
        warnings.push(`Missing attachment: ${row.name || `vehicle ${row.id}`}`);
      }
      row[column] = `asset:${key}`;
    }
    await writeBackupZip(destination, { formatVersion: 4, exportedAt: new Date().toISOString(), ...snapshot, assets, warnings }, files);
    return warnings;
  } catch (error) { await unlink(destination).catch(() => undefined); throw error; }
  finally { await temp.cleanup(); }
}

/** Old backups stored policies on vehicles. Preserve them as independent policies on restore. */
function materializeLegacyInsurance(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  for (const vehicle of tx.select().from(schema.vehicles).all()) {
    if (!vehicle.insuranceProvider?.trim() && !vehicle.insurancePolicyNumber?.trim()) continue;
    const existing = tx.select({ id: schema.insurancePolicies.id }).from(schema.insurancePolicies).where(eq(schema.insurancePolicies.legacySourceVehicleId, vehicle.id)).get();
    if (!existing) {
      const policy = tx.insert(schema.insurancePolicies).values({ provider: vehicle.insuranceProvider?.trim() || "Insurance policy", policyNumber: vehicle.insurancePolicyNumber || null, agentName: vehicle.insuranceAgentName || null, agentPhone: vehicle.insuranceAgentPhone || null, effectiveAt: vehicle.insuranceEffectiveAt || null, expiresAt: vehicle.insuranceExpiresAt || null, premiumCents: vehicle.insurancePremiumCents, notes: vehicle.insuranceNotes || null, legacySourceVehicleId: vehicle.id }).returning().get();
      tx.insert(schema.insurancePolicyVehicles).values({ insurancePolicyId: policy.id, vehicleId: vehicle.id }).run();
    }
    tx.update(schema.vehicles).set({ insuranceProvider: null, insurancePolicyNumber: null, insuranceAgentName: null, insuranceAgentPhone: null, insuranceEffectiveAt: null, insuranceExpiresAt: null, insurancePremiumCents: null, insuranceNotes: null }).where(eq(schema.vehicles.id, vehicle.id)).run();
  }
}

/** Backups made before shared schedules only have service_plans.vehicle_id. */
function materializeLegacyPlanVehicles(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  for (const plan of tx.select().from(schema.servicePlans).all()) {
    if (!tx.select().from(schema.servicePlanVehicles).where(eq(schema.servicePlanVehicles.servicePlanId, plan.id)).get()) {
      tx.insert(schema.servicePlanVehicles).values({ servicePlanId: plan.id, vehicleId: plan.vehicleId }).run();
    }
  }
}

/** Backups made before shared evidence only have documents.maintenance_id. */
function materializeLegacyDocumentLinks(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  for (const document of tx.select().from(schema.documents).all()) {
    if (document.maintenanceId && !tx.select().from(schema.documentMaintenanceLinks).where(eq(schema.documentMaintenanceLinks.documentId, document.id)).get()) {
      tx.insert(schema.documentMaintenanceLinks).values({ documentId: document.id, maintenanceId: document.maintenanceId }).run();
    }
  }
}

/** Backups made before immutable document identities used the display label as the only filename. */
function materializeDocumentIdentity(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  for (const document of tx.select().from(schema.documents).all()) {
    if (document.trackingId && document.originalName) continue;
    tx.update(schema.documents).set({ trackingId: document.trackingId || crypto.randomUUID(), originalName: document.originalName || document.name }).where(eq(schema.documents.id, document.id)).run();
  }
}

export async function createSnapshot() {
  const snapshot = snapshotRows();
  const assets: Snapshot["assets"] = {}; const warnings: string[] = [];
  for (const [table, column] of [["vehicles", "imageUrl"], ["documents", "storagePath"]] as const) {
    for (const row of snapshot[table]) {
      if (!row[column]) continue;
      const key = `${table}-${row.id}`;
      try {
        const path = safeUploadPath(String(row[column])); const file = Bun.file(path);
        if (!(await file.exists())) throw new Error("Missing file");
        const bytes = Buffer.from(await file.arrayBuffer());
        assets[key] = { mimeType: String(row.mimeType || file.type || "text/plain").split(";", 1)[0].toLowerCase(), data: bytes.toString("base64"), sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") };
      } catch { warnings.push(`Missing attachment: ${row.name || `${row.year} ${row.make} ${row.model}`}`); }
      row[column] = `asset:${key}`;
    }
  }
  return { formatVersion: 3, exportedAt: new Date().toISOString(), ...snapshot, assets, warnings };
}

async function parseBackup(file: unknown) {
  if (!(file instanceof File) || !file.size) throw new Error("Choose a non-empty SumpLog ZIP or JSON backup.");
  let cleanup = async () => {}; let files = new Map<string, StoredAsset>();
  try {
  let raw: unknown;
  if (await file.slice(0, 2).text() === "PK") {
    const archive = await readBackupZip(file); raw = archive.raw; files = archive.files; cleanup = archive.cleanup;
    if ((raw as { formatVersion?: number })?.formatVersion !== 4) throw new Error("Unsupported ZIP backup version.");
  } else {
    try { raw = JSON.parse(await file.text()); } catch { throw new Error("The selected backup is not valid JSON or a SumpLog ZIP."); }
    if ((raw as { formatVersion?: number })?.formatVersion === 4) throw new Error("Select the complete ZIP, not backup.json extracted from it.");
  }
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Record<string, unknown>).vehicles)) throw new Error("This is not a SumpLog backup.");
  const validated = backupValidator.safeParse(raw);
  if (!validated.success) throw new Error(`Invalid backup: ${validated.error.issues[0]?.path.join(".")} ${validated.error.issues[0]?.message}`);
  const snapshot = validated.data as unknown as Snapshot;
  const vehicleIds = new Set(snapshot.vehicles.map((row) => row.id));
  const maintenance = new Map(snapshot.maintenanceRecords.map((row) => [row.id, row.vehicleId]));
  const projects = new Map(snapshot.projects.map((row) => [row.id, row.vehicleId]));
  const plans = new Map(snapshot.servicePlans.map((row) => [row.id, row.vehicleId]));
  for (const key of Object.keys(tables) as TableKey[]) for (const row of snapshot[key]) {
    if (row.vehicleId != null && !vehicleIds.has(row.vehicleId)) throw new Error(`${key} refers to a missing vehicle.`);
  }
  const partIds = new Set(snapshot.parts.map((row) => row.id));
  for (const key of Object.keys(tables) as TableKey[]) { const ids = snapshot[key].map((row) => key === "vehicleParts" ? `${row.vehicleId}:${row.partId}` : key === "maintenanceParts" ? `${row.maintenanceId}:${row.partId}` : key === "servicePlanVehicles" ? `${row.servicePlanId}:${row.vehicleId}` : key === "insurancePolicyVehicles" ? `${row.insurancePolicyId}:${row.vehicleId}` : key === "documentMaintenanceLinks" ? `${row.documentId}:${row.maintenanceId}` : row.id); if (new Set(ids).size !== ids.length) throw new Error(`${key} contains duplicate IDs.`); }
  const policyIds = new Set(snapshot.insurancePolicies.map((row) => row.id));
  for (const row of snapshot.insurancePolicyVehicles) if (!policyIds.has(row.insurancePolicyId)) throw new Error("An insurance link refers to a missing policy.");
  for (const row of snapshot.documents) if (row.insurancePolicyId != null && !policyIds.has(row.insurancePolicyId)) throw new Error("A document refers to a missing insurance policy.");
  for (const row of snapshot.reminders) if (row.maintenanceId != null && !maintenance.has(row.maintenanceId)) throw new Error("A reminder refers to missing maintenance.");
  for (const row of snapshot.vehicleParts) if (!partIds.has(row.partId)) throw new Error("A fitment refers to a missing part.");
  for (const row of snapshot.maintenanceParts) if (!partIds.has(row.partId) || !maintenance.has(row.maintenanceId)) throw new Error("Maintenance parts contain an invalid reference.");
  for (const row of snapshot.maintenanceAuditLogs) if (!maintenance.has(row.maintenanceId)) throw new Error("An audit entry refers to missing maintenance.");
  for (const row of snapshot.projectTasks) if (!projects.has(row.projectId)) throw new Error("A task refers to a missing project.");
  for (const row of snapshot.servicePlanItems) if (!plans.has(row.servicePlanId)) throw new Error("A checklist item refers to a missing service plan.");
  for (const row of snapshot.servicePlanVehicles) if (!plans.has(row.servicePlanId) || !vehicleIds.has(row.vehicleId)) throw new Error("A service-plan vehicle link is invalid.");
  for (const row of snapshot.documents) {
    if (row.maintenanceId != null && (!maintenance.has(row.maintenanceId) || maintenance.get(row.maintenanceId) !== row.vehicleId)) throw new Error("A document has an invalid maintenance/vehicle relationship.");
    if (row.projectId != null && (!projects.has(row.projectId) || projects.get(row.projectId) !== row.vehicleId)) throw new Error("A document has an invalid project/vehicle relationship.");
  }
  const documentIds = new Set(snapshot.documents.map((row) => row.id));
  for (const row of snapshot.documentMaintenanceLinks) if (!documentIds.has(row.documentId) || !maintenance.has(row.maintenanceId)) throw new Error("A document-maintenance link is invalid.");
  for (const row of snapshot.reminders) if (row.servicePlanId != null && (!plans.has(row.servicePlanId) || !(snapshot.servicePlanVehicles.length ? snapshot.servicePlanVehicles.some((link) => link.servicePlanId === row.servicePlanId && link.vehicleId === row.vehicleId) : plans.get(row.servicePlanId) === row.vehicleId))) throw new Error("A reminder has an invalid service-plan relationship.");
  const warnings: string[] = [];
  let attachmentBytes = 0;
  for (const [key, asset] of Object.entries(snapshot.assets)) {
    if (snapshot.formatVersion === 4) {
      const stored = files.get(asset.file!);
      if (!stored || stored.sha256 !== asset.sha256 || stored.sizeBytes !== asset.sizeBytes) throw new Error(`Missing or damaged attachment: ${key}.`);
      attachmentBytes += stored.sizeBytes; continue;
    }
    const bytes = Buffer.from(asset.data!, "base64");
    attachmentBytes += bytes.length;
    if (asset.sha256 && new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error(`Attachment integrity check failed: ${key}. Choose an undamaged backup.`);
  }
  for (const [table, column] of [["vehicles", "imageUrl"], ["documents", "storagePath"]] as const) for (const row of snapshot[table]) {
    const value = row[column]; if (!value) continue;
    if (String(value).startsWith("asset:")) {
      if (!snapshot.assets[String(value).slice(6)]) warnings.push(`Attachment unavailable: ${row.name || `vehicle ${row.id}`}`);
      else if (table === "vehicles" && !snapshot.assets[String(value).slice(6)].mimeType.startsWith("image/")) throw new Error("Vehicle photos must be images.");
    } else {
      const path = safeUploadPath(String(value));
      if (!(await Bun.file(path).exists())) warnings.push(`Attachment unavailable: ${row.name || `vehicle ${row.id}`}`);
    }
  }
  if (snapshot.formatVersion === 4) {
    const declared = new Set(Object.values(snapshot.assets).map((asset) => asset.file));
    if (declared.size !== files.size || [...files.keys()].some((name) => !declared.has(name))) throw new Error("ZIP contains unlisted attachment files.");
  }
  return { snapshot, warnings, attachmentCount: Object.keys(snapshot.assets).length, attachmentBytes, files, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export function installBackupRoutes(app: Hono) {
  app.get("/api/export/backup.zip", async (c) => {
    const temp = await temporaryBackup();
    try {
      const path = resolve(temp.root, "backup.zip"); await createPortableZip(path);
      // Hold only stream chunks in memory; delete the staged download on completion/cancel.
      const reader = Bun.file(path).stream().getReader();
      const stream = new ReadableStream({
        async pull(controller) { try { const next = await reader.read(); if (next.done) { controller.close(); await temp.cleanup(); } else controller.enqueue(next.value); } catch (error) { controller.error(error); await reader.cancel().catch(() => undefined); await temp.cleanup(); } },
        async cancel() { await reader.cancel(); await temp.cleanup(); },
      });
      return new Response(stream, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="sumplog-backup-${new Date().toISOString().slice(0, 10)}.zip"`, "Cache-Control": "no-store" } });
    } catch (error) { await temp.cleanup(); return c.json({ error: error instanceof Error ? error.message : "Backup failed." }, 422); }
  });
  app.get("/api/export/json", async (c) => {
    const snapshot = await createSnapshot();
    if (snapshot.warnings.length) return c.json({ error: "A complete backup could not be created. Restore the missing source files and try again.", warnings: snapshot.warnings }, 422);
    c.header("Content-Disposition", `attachment; filename="sumplog-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(snapshot);
  });
  app.post("/api/import/preview", async (c) => {
    let cleanup = async () => {};
    try { const parsed = await parseBackup((await c.req.parseBody()).file); cleanup = parsed.cleanup; const { snapshot, warnings, attachmentCount, attachmentBytes } = parsed; return c.json({ counts: Object.fromEntries(Object.keys(tables).map((key) => [key, snapshot[key as TableKey].length])), warnings, attachmentCount, attachmentBytes }); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : "Backup validation failed." }, 422); }
    finally { await cleanup(); }
  });
  app.post("/api/import/json", async (c) => {
    const stored: string[] = [];
    let cleanup = async () => {};
    try {
      const body = await c.req.parseBody();
      if (body.confirmation !== "REPLACE") return c.json({ error: "Type REPLACE to confirm a full restore." }, 422);
      const parsed = await parseBackup(body.file); cleanup = parsed.cleanup;
      const { snapshot, warnings, files } = parsed;
      if (warnings.length) throw new Error(`Restore blocked because attachments are missing. ${warnings.join(" ")}`);
      const backupName = `pre-restore-${crypto.randomUUID()}.zip`;
      await mkdir(backups, { recursive: true });
      const recoveryWarnings = await createPortableZip(resolve(backups, backupName), true);
      warnings.push(...recoveryWarnings.map((warning) => `Pre-restore recovery backup: ${warning}`));
      await mkdir(uploads, { recursive: true });
      for (const [table, column] of [["vehicles", "imageUrl"], ["documents", "storagePath"]] as const) for (const row of snapshot[table]) {
        const value = row[column]; if (!value) continue;
        if (String(value).startsWith("asset:")) {
          const asset = snapshot.assets[String(value).slice(6)];
          if (asset) {
            if (table === "vehicles" && !asset.mimeType.startsWith("image/")) throw new Error("Vehicle photos must be images.");
            const path = resolve(uploads, `${crypto.randomUUID()}${extensions[asset.mimeType]}`); stored.push(path);
            let sizeBytes: number;
            if (snapshot.formatVersion === 4) { const source = files.get(asset.file!)!; await copyFile(source.path, path); sizeBytes = source.sizeBytes; }
            else { const bytes = Buffer.from(asset.data!, "base64"); await Bun.write(path, bytes); sizeBytes = bytes.length; }
            row[column] = path;
            if (table === "documents") { row.mimeType = asset.mimeType; row.sizeBytes = sizeBytes; }
          } else row[column] = table === "vehicles" ? null : resolve(uploads, `missing-${crypto.randomUUID()}`);
        } else row[column] = safeUploadPath(String(value));
      }
      db.transaction((tx) => {
        for (const table of Object.values(tables).reverse()) tx.delete(table).run();
        for (const [key, table] of Object.entries(tables)) {
          const rows = snapshot[key as TableKey];
          // Bound each SQL statement, not the backup's total number of records.
          const batchSize = Math.max(1, Math.floor(900 / Object.keys(getTableColumns(table)).length));
          for (let offset = 0; offset < rows.length; offset += batchSize) tx.insert(table).values(rows.slice(offset, offset + batchSize) as never).run();
        }
        materializeLegacyPlanVehicles(tx);
        materializeLegacyInsurance(tx);
        materializeLegacyDocumentLinks(tx);
        materializeDocumentIdentity(tx);
      });
      return c.json({ ok: true, vehicles: snapshot.vehicles.length, warnings, backupUrl: `/api/backups/${backupName}` });
    } catch (error) {
      await Promise.all(stored.map((path) => unlink(path).catch(() => undefined)));
      return c.json({ error: error instanceof Error ? error.message : "Restore failed; the existing garage is unchanged." }, 422);
    } finally { await cleanup(); }
  });
  app.get("/api/backups/:name", async (c) => {
    const name = c.req.param("name"); if (!/^pre-restore-[a-f0-9-]{36}\.(json|zip)$/.test(name)) return c.notFound();
    const file = Bun.file(resolve(backups, name)); if (!(await file.exists())) return c.notFound();
    return new Response(file, { headers: { "Content-Type": name.endsWith(".zip") ? "application/zip" : "application/json", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  });
}
