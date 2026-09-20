import { escapeCsv } from "./csv";
import { and, asc, desc, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "hono/bun";
import { installSecurity } from "./security";
import { installBackupRoutes } from "./backup";
import { installReadableExportRoutes } from "./export";
import { mkdir, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { photoBytes, photoResponse } from "./photos";
import { db } from "./db/client";
import {
  documents,
  documentMaintenanceLinks,
  insurancePolicies,
  insurancePolicyVehicles,
  maintenanceAuditLogs,
  maintenanceParts,
  maintenanceRecords,
  ownerCredentials,
  mileageEntries,
  parts,
  projectTasks,
  projects,
  referenceSpecs,
  reminders,
  servicePlanItems,
  servicePlans,
  servicePlanVehicles,
  vehicleParts,
  vehicles,
} from "./db/schema";

class WorkflowConflict extends Error {}
const app = new Hono();
app.onError((error, c) => {
  if (error instanceof WorkflowConflict) return c.json({ error: error.message }, 409);
  console.error(error);
  return c.json({ error: "The request could not be completed. Please try again." }, 500);
});
const uploadDirectory = resolve(process.env.UPLOAD_DIRECTORY || "data/uploads");
const allowedUploadTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.oasis.opendocument.text", ".odt"],
  ["text/csv", ".csv"],
]);

installSecurity(app, process.env.SUMPLOG_PASSWORD ?? "", process.env.NODE_ENV === "production", {
  getHash: () => db.select({ hash: ownerCredentials.passwordHash }).from(ownerCredentials).where(eq(ownerCredentials.id, 1)).get()?.hash ?? null,
  saveHash: (hash) => { db.insert(ownerCredentials).values({ id: 1, passwordHash: hash }).onConflictDoUpdate({ target: ownerCredentials.id, set: { passwordHash: hash, updatedAt: sql`CURRENT_TIMESTAMP` } }).run(); },
});

const vehicleInput = z.object({
  vin: z.string().trim().max(17).optional().or(z.literal("")),
  year: z.coerce.number().int().min(1886).max(new Date().getFullYear() + 1),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  trim: z.string().trim().max(80).optional().or(z.literal("")),
  nickname: z.string().trim().max(80).optional().or(z.literal("")),
  mileage: z.coerce.number().int().min(0).max(10_000_000),
  mileageDate: z.iso.date(),
  annualMileageEstimate: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  color: z.string().trim().max(80).optional().or(z.literal("")),
  bodyStyle: z.string().trim().max(120).optional().or(z.literal("")),
  fuelType: z.string().trim().max(80).optional().or(z.literal("")),
  drivetrain: z.string().trim().max(80).optional().or(z.literal("")),
  engine: z.string().trim().max(120).optional().or(z.literal("")),
  transmission: z.string().trim().max(120).optional().or(z.literal("")),
  licensePlate: z.string().trim().max(40).optional().or(z.literal("")),
  registrationState: z.string().trim().max(80).optional().or(z.literal("")),
  registrationNumber: z.string().trim().max(120).optional().or(z.literal("")),
  purchaseDate: z.union([z.iso.date(), z.literal("")]).optional(),
  purchasePrice: z.union([z.coerce.number().min(0).max(100_000_000), z.null()]).optional(),
  insuranceProvider: z.string().trim().max(160).optional().or(z.literal("")),
  insurancePolicyNumber: z.string().trim().max(160).optional().or(z.literal("")),
  insuranceAgentName: z.string().trim().max(160).optional().or(z.literal("")),
  insuranceAgentPhone: z.string().trim().max(80).optional().or(z.literal("")),
  insuranceEffectiveAt: z.union([z.iso.date(), z.literal("")]).optional(),
  insuranceExpiresAt: z.union([z.iso.date(), z.literal("")]).optional(),
  insurancePremium: z.union([z.coerce.number().min(0).max(10_000_000), z.null()]).optional(),
  insuranceNotes: z.string().trim().max(4000).optional().or(z.literal("")),
  registrationExpiresAt: z.union([z.iso.date(), z.literal("")]).optional(),
  notes: z.string().trim().max(10_000).optional().or(z.literal("")),
});

const insuranceInput = z.object({
  provider: z.string().trim().min(1).max(160),
  policyNumber: z.string().trim().max(160).optional().or(z.literal("")),
  agentName: z.string().trim().max(160).optional().or(z.literal("")),
  agentPhone: z.string().trim().max(80).optional().or(z.literal("")),
  effectiveAt: z.union([z.iso.date(), z.literal("")]).optional(),
  expiresAt: z.union([z.iso.date(), z.literal("")]).optional(),
  premium: z.union([z.coerce.number().min(0).max(10_000_000), z.null()]).optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  vehicleIds: z.array(z.coerce.number().int().positive()).max(100).default([]).refine((ids) => new Set(ids).size === ids.length, "A vehicle can only be linked once."),
});

const mileageInput = z.object({
  recordedDate: z.iso.date(),
  mileage: z.coerce.number().int().min(0).max(10_000_000),
  annualMileageEstimate: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

const servicePlanInput = z.object({
  sourceMaintenanceId: z.number().int().positive().optional(),
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().min(1).max(60),
  intervalMileage: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  intervalMonths: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  nextDueMileage: z.union([z.null(), z.coerce.number().int().min(0)]).optional(),
  nextDueDate: z.union([z.iso.date(), z.null()]).optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  items: z.array(z.string().trim().min(1).max(240)).max(50).default([]),
  createReminder: z.boolean().default(true),
  active: z.boolean().default(true),
  vehicleIds: z.array(z.coerce.number().int().positive()).max(100).optional().refine((ids) => !ids || new Set(ids).size === ids.length, "A vehicle can only be linked once."),
});

async function servicePlanVehicleIds(planId: number) {
  const links = await db.select({ vehicleId: servicePlanVehicles.vehicleId }).from(servicePlanVehicles).where(eq(servicePlanVehicles.servicePlanId, planId));
  return links.map((link) => link.vehicleId);
}

async function selectedVehiclesExist(vehicleIds: number[]) {
  if (!vehicleIds.length) return false;
  const found = await db.select({ id: vehicles.id }).from(vehicles).where(inArray(vehicles.id, vehicleIds));
  return found.length === vehicleIds.length;
}

const vehicleUpdateInput = z.object({
  vin: z.string().trim().max(17).optional().or(z.literal("")),
  year: z.coerce.number().int().min(1886).max(new Date().getFullYear() + 1),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  trim: z.string().trim().max(80).optional().or(z.literal("")),
  nickname: z.string().trim().max(80).optional().or(z.literal("")),
  color: z.string().trim().max(80).optional().or(z.literal("")),
  bodyStyle: z.string().trim().max(120).optional().or(z.literal("")),
  fuelType: z.string().trim().max(80).optional().or(z.literal("")),
  drivetrain: z.string().trim().max(80).optional().or(z.literal("")),
  engine: z.string().trim().max(120).optional().or(z.literal("")),
  transmission: z.string().trim().max(120).optional().or(z.literal("")),
  mileage: z.coerce.number().int().min(0).max(10_000_000),
  mileageDate: z.iso.date(),
  licensePlate: z.string().trim().max(40).optional().or(z.literal("")),
  registrationState: z.string().trim().max(80).optional().or(z.literal("")),
  registrationNumber: z.string().trim().max(120).optional().or(z.literal("")),
  purchaseDate: z.union([z.iso.date(), z.literal("")]).optional(),
  purchasePrice: z.union([z.coerce.number().min(0).max(100_000_000), z.null()]).optional(),
  insuranceProvider: z.string().trim().max(160).optional().or(z.literal("")),
  insurancePolicyNumber: z.string().trim().max(160).optional().or(z.literal("")),
  insuranceAgentName: z.string().trim().max(160).optional().or(z.literal("")),
  insuranceAgentPhone: z.string().trim().max(80).optional().or(z.literal("")),
  insuranceEffectiveAt: z.union([z.iso.date(), z.literal("")]).optional(),
  insuranceExpiresAt: z.union([z.iso.date(), z.literal("")]).optional(),
  insurancePremium: z.union([z.coerce.number().min(0).max(10_000_000), z.null()]).optional(),
  insuranceNotes: z.string().trim().max(4000).optional().or(z.literal("")),
  registrationExpiresAt: z.union([z.iso.date(), z.literal("")]).optional(),
  annualMileageEstimate: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().trim().max(10_000).optional().or(z.literal("")),
});

const specInput = z.object({
  groupName: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(240), source: z.string().trim().max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

const projectInput = z.object({
  title: z.string().trim().min(2).max(160), description: z.string().trim().max(4000).optional().or(z.literal("")),
  status: z.enum(["Backlog", "Planned", "In Progress", "Waiting", "Done"]),
  estimatedBudget: z.coerce.number().min(0).max(10_000_000), actualCost: z.coerce.number().min(0).max(10_000_000),
  targetDate: z.union([z.iso.date(), z.literal("")]).optional(),
  tasks: z.array(z.object({ id: z.number().int().positive().optional(), title: z.string().trim().min(1).max(240), completed: z.boolean().default(false), estimatedCost: z.coerce.number().min(0).max(10_000_000).default(0) })).max(100).default([]),
});

const reminderInput = z.object({
  title: z.string().trim().min(2).max(160), dueDate: z.union([z.iso.date(), z.null()]).optional(),
  dueMileage: z.union([z.null(), z.coerce.number().int().min(0)]).optional(), notes: z.string().trim().max(2000).optional().or(z.literal("")),
  status: z.enum(["Active", "Completed", "Dismissed"]).default("Active"), servicePlanId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
});

function estimatedAnnualMileage(year: number, mileage: number) {
  const yearsOnRoad = Math.max(1, new Date().getFullYear() - year + 1);
  return Math.round(mileage / yearsOnRoad);
}

function publicVehicle<T extends { id: number; imageUrl?: string | null; updatedAt?: string; photoRotation?: number }>(vehicle: T) {
  return { ...vehicle, imageUrl: vehicle.imageUrl ? `/api/vehicles/${vehicle.id}/image?v=${encodeURIComponent(vehicle.updatedAt ?? "")}&r=${vehicle.photoRotation ?? 0}` : null };
}

async function saveUpload(file: File, imageOnly = false) {
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Files must be 15 MB or smaller.");
  const mimeType = file.type.split(";", 1)[0].toLowerCase();
  const extension = allowedUploadTypes.get(mimeType);
  if (!extension || (imageOnly && !mimeType.startsWith("image/"))) throw new Error(imageOnly ? "Choose a JPEG, PNG, or WebP image." : "Use an image, PDF, text, CSV, Word, Excel, or OpenDocument file.");
  await mkdir(uploadDirectory, { recursive: true });
  const storagePath = resolve(uploadDirectory, `${crypto.randomUUID()}${extension}`);
  try { await Bun.write(storagePath, file); } catch (error) { await unlink(storagePath).catch(() => undefined); throw error; }
  return storagePath;
}

async function removeStoredFile(storagePath: string | null | undefined) {
  if (!storagePath) return;
  const absolutePath = resolve(storagePath);
  const uploadRelativePath = relative(uploadDirectory, absolutePath);
  if (uploadRelativePath.startsWith("..") || isAbsolute(uploadRelativePath)) return;
  await unlink(absolutePath).catch(() => undefined);
}

const maintenanceInput = z.object({
  dueSourceId: z.number().int().optional(),
  submissionKey: z.string().min(8).max(120).optional(),
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().min(1).max(80),
  serviceDate: z.iso.date(),
  mileage: z.coerce.number().int().min(0).max(10_000_000),
  cost: z.coerce.number().min(0).max(1_000_000).default(0),
  laborHours: z.coerce.number().min(0).max(1000).default(0),
  difficulty: z.coerce.number().int().min(1).max(5).default(1),
  shopName: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(10_000).optional().or(z.literal("")),
  nextDueDate: z.union([z.iso.date(), z.literal("")]).optional(),
  nextDueMileage: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional(),
  parts: z.array(z.object({
    partId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().positive().max(1000),
    usageMode: z.enum(["Whole", "Partial"]).default("Whole"),
    amountUsed: z.union([z.coerce.number().positive().max(1_000_000), z.null()]).optional(),
    amountUnit: z.string().trim().max(24).optional().nullable(),
  })).max(100).default([]),
});

const partInput = z.object({
  itemType: z.enum(["Part", "Consumable"]).default("Part"),
  category: z.string().trim().max(120).optional(),
  specifications: z.string().trim().max(4000).optional(),
  approvals: z.string().trim().max(4000).optional(),
  partNumber: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(160),
  manufacturer: z.string().trim().max(120).optional().or(z.literal("")),
  supplierName: z.string().trim().max(120).optional().or(z.literal("")),
  supplierUrl: z.union([z.literal(""), z.url().refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS supplier link.")]).optional(),
  purchasePrice: z.coerce.number().min(0).max(1_000_000).default(0),
  quantity: z.coerce.number().min(0).max(1_000_000).default(0),
  volumePerUnit: z.union([z.coerce.number().positive().max(1_000_000), z.literal(""), z.null()]).optional(),
  volumeUnit: z.string().trim().max(24).optional().or(z.literal("")),
  minimumQuantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  storageLocation: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(10_000).optional().or(z.literal("")),
  vehicleId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  previousVehicleId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  fitmentNotes: z.string().trim().max(500).optional().or(z.literal("")),
  fitments: z.array(z.object({ vehicleId: z.coerce.number().int().positive(), notes: z.string().trim().max(500).optional().default("") })).max(100).optional(),
}).refine((input) => input.itemType === "Consumable" || Number.isInteger(input.quantity), { message: "Use a whole stock quantity for parts.", path: ["quantity"] });

async function getPart(partId: number, vehicleId?: number | null) {
  const [row] = await db.select().from(parts).where(eq(parts.id, partId)).limit(1);
  if (!row) return undefined;
  const fitments = await db.select({ vehicleId: vehicleParts.vehicleId, notes: vehicleParts.fitmentNotes })
    .from(vehicleParts).where(eq(vehicleParts.partId, partId)).orderBy(asc(vehicleParts.vehicleId));
  const selected = fitments.find((fitment) => fitment.vehicleId === vehicleId) ?? fitments[0];
  return { ...row, vehicleId: selected?.vehicleId ?? null, fitmentNotes: selected?.notes ?? null, fitments };
}

async function validatePartRequest(c: Context) {
  const parsed = partInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return {
      response: c.json(
        { error: "Check the highlighted fields and try again.", fields: z.flattenError(parsed.error).fieldErrors },
        422,
      ),
    };
  }
  const requestedIds = parsed.data.fitments?.map((fitment) => fitment.vehicleId) ?? (parsed.data.vehicleId ? [parsed.data.vehicleId] : []);
  if (new Set(requestedIds).size !== requestedIds.length) return { response: c.json({ error: "Select each vehicle only once." }, 422) };
  if (requestedIds.length) {
    const matches = await db.select({ id: vehicles.id }).from(vehicles).where(inArray(vehicles.id, [...new Set(requestedIds)]));
    if (matches.length !== new Set(requestedIds).size) return { response: c.json({ error: "One or more selected vehicles were not found." }, 404) };
  }
  return { data: parsed.data };
}

app.get("/api/health", (c) => c.json({ ok: true, service: "sumplog" }));

app.get("/api/vehicles", async (c) => {
  const rows = await db.select().from(vehicles).orderBy(asc(vehicles.year));
  return c.json(rows.map(publicVehicle));
});

app.post("/api/vehicles", async (c) => {
  const parsed = vehicleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the vehicle details and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data;
  const annualMileageEstimate = input.annualMileageEstimate ?? estimatedAnnualMileage(input.year, input.mileage);
  try {
    const vehicle = db.transaction((tx) => {
      const [created] = tx.insert(vehicles).values({
        vin: input.vin || null,
        year: input.year,
        make: input.make,
        model: input.model,
        trim: input.trim || null,
        nickname: input.nickname || null,
        mileage: input.mileage,
        annualMileageEstimate,
        color: input.color || null,
        bodyStyle: input.bodyStyle || null,
        fuelType: input.fuelType || null,
        drivetrain: input.drivetrain || null,
        engine: input.engine || null,
        transmission: input.transmission || null,
        licensePlate: input.licensePlate || null,
        registrationState: input.registrationState || null,
        registrationNumber: input.registrationNumber || null,
        purchaseDate: input.purchaseDate || null,
        purchasePriceCents: input.purchasePrice == null ? null : Math.round(input.purchasePrice * 100),
        insuranceProvider: input.insuranceProvider || null,
        insurancePolicyNumber: input.insurancePolicyNumber || null,
        insuranceAgentName: input.insuranceAgentName || null,
        insuranceAgentPhone: input.insuranceAgentPhone || null,
        insuranceEffectiveAt: input.insuranceEffectiveAt || null,
        insuranceExpiresAt: input.insuranceExpiresAt || null,
        insurancePremiumCents: input.insurancePremium == null ? null : Math.round(input.insurancePremium * 100),
        insuranceNotes: input.insuranceNotes || null,
        registrationExpiresAt: input.registrationExpiresAt || null,
        notes: input.notes || null,
      }).returning().all();
      tx.insert(mileageEntries).values({ vehicleId: created.id, recordedDate: input.mileageDate, mileage: input.mileage, annualMileageEstimate }).run();
      return created;
    });
    return c.json(publicVehicle(vehicle), 201);
  } catch {
    return c.json({ error: "That VIN is already assigned to another vehicle." }, 409);
  }
});

app.put("/api/vehicles/:id", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  if (!Number.isInteger(vehicleId)) return c.json({ error: "Invalid vehicle ID." }, 400);
  const [existing] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!existing) return c.json({ error: "Vehicle not found." }, 404);
  const parsed = vehicleUpdateInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the vehicle details and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data;
  try {
    const updated = db.transaction((tx) => {
      const [row] = tx.update(vehicles).set({
        vin: input.vin || null, year: input.year, make: input.make, model: input.model, trim: input.trim || null,
        nickname: input.nickname || null, mileage: input.mileage, color: input.color || null,
        bodyStyle: input.bodyStyle || null, fuelType: input.fuelType || null, drivetrain: input.drivetrain || null,
        engine: input.engine || null, transmission: input.transmission || null,
        licensePlate: input.licensePlate || null, registrationState: input.registrationState || null,
        registrationNumber: input.registrationNumber || null, registrationExpiresAt: input.registrationExpiresAt || null,
        purchaseDate: input.purchaseDate || null, purchasePriceCents: input.purchasePrice == null ? null : Math.round(input.purchasePrice * 100),
        insuranceProvider: input.insuranceProvider || null, insurancePolicyNumber: input.insurancePolicyNumber || null,
        insuranceAgentName: input.insuranceAgentName || null, insuranceAgentPhone: input.insuranceAgentPhone || null,
        insuranceEffectiveAt: input.insuranceEffectiveAt || null, insuranceExpiresAt: input.insuranceExpiresAt || null,
        insurancePremiumCents: input.insurancePremium == null ? null : Math.round(input.insurancePremium * 100),
        insuranceNotes: input.insuranceNotes || null, annualMileageEstimate: input.annualMileageEstimate ?? null,
        notes: input.notes || null, updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(vehicles.id, vehicleId)).returning().all();
      if (input.mileage !== existing.mileage || input.annualMileageEstimate !== existing.annualMileageEstimate) {
        tx.insert(mileageEntries).values({ vehicleId, recordedDate: input.mileageDate, mileage: input.mileage, annualMileageEstimate: input.annualMileageEstimate ?? existing.annualMileageEstimate, notes: "Updated from vehicle details." })
          .onConflictDoUpdate({ target: [mileageEntries.vehicleId, mileageEntries.recordedDate], set: { mileage: input.mileage, annualMileageEstimate: input.annualMileageEstimate ?? existing.annualMileageEstimate, notes: "Updated from vehicle details.", updatedAt: sql`CURRENT_TIMESTAMP` } }).run();
      }
      const [latest] = tx.select().from(mileageEntries).where(eq(mileageEntries.vehicleId, vehicleId)).orderBy(desc(mileageEntries.recordedDate), desc(mileageEntries.id)).limit(1).all();
      if (latest && latest.mileage !== row.mileage) { tx.update(vehicles).set({ mileage: latest.mileage }).where(eq(vehicles.id, vehicleId)).run(); row.mileage = latest.mileage; }
      return row;
    });
    return c.json(publicVehicle(updated));
  } catch {
    return c.json({ error: "That VIN is already assigned to another vehicle." }, 409);
  }
});

app.delete("/api/vehicles/:id", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  if (!Number.isInteger(vehicleId)) return c.json({ error: "Invalid vehicle ID." }, 400);
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return c.json({ error: "Vehicle not found." }, 404);

  const linkedDocuments = await db.select({ id: documents.id, storagePath: documents.storagePath })
    .from(documents)
    .leftJoin(maintenanceRecords, eq(documents.maintenanceId, maintenanceRecords.id))
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .where(or(eq(documents.vehicleId, vehicleId), eq(maintenanceRecords.vehicleId, vehicleId), eq(projects.vehicleId, vehicleId)));
  const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.vehicleId, vehicleId));
  const maintenanceRows = await db.select({ id: maintenanceRecords.id }).from(maintenanceRecords).where(eq(maintenanceRecords.vehicleId, vehicleId));
  const mileageRows = await db.select({ id: mileageEntries.id }).from(mileageEntries).where(eq(mileageEntries.vehicleId, vehicleId));
  const specRows = await db.select({ id: referenceSpecs.id }).from(referenceSpecs).where(eq(referenceSpecs.vehicleId, vehicleId));
  const planRows = await db.select({ id: servicePlans.id }).from(servicePlans).where(eq(servicePlans.vehicleId, vehicleId));
  const linkedPlanRows = await db.select({ servicePlanId: servicePlanVehicles.servicePlanId, vehicleId: servicePlanVehicles.vehicleId }).from(servicePlanVehicles).where(eq(servicePlanVehicles.vehicleId, vehicleId));
  const reminderRows = await db.select({ id: reminders.id }).from(reminders).where(eq(reminders.vehicleId, vehicleId));
  const fitmentRows = await db.select({ partId: vehicleParts.partId }).from(vehicleParts).where(eq(vehicleParts.vehicleId, vehicleId));

  db.transaction((tx) => {
    if (linkedDocuments.length) tx.delete(documents).where(inArray(documents.id, linkedDocuments.map((document) => document.id))).run();
    if (projectRows.length) tx.delete(projects).where(inArray(projects.id, projectRows.map((project) => project.id))).run();
    // A shared task survives removal of one vehicle. Move its compatibility
    // anchor to another linked vehicle before the vehicle cascade runs.
    for (const linkedPlan of linkedPlanRows) {
      const plan = tx.select().from(servicePlans).where(eq(servicePlans.id, linkedPlan.servicePlanId)).get();
      if (!plan || plan.vehicleId !== vehicleId) continue;
      const replacement = tx.select().from(servicePlanVehicles).where(and(eq(servicePlanVehicles.servicePlanId, plan.id), ne(servicePlanVehicles.vehicleId, vehicleId))).get();
      if (replacement) tx.update(servicePlans).set({ vehicleId: replacement.vehicleId, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(servicePlans.id, plan.id)).run();
    }
    tx.delete(vehicles).where(eq(vehicles.id, vehicleId)).run();
  });

  await Promise.all([removeStoredFile(vehicle.imageUrl), ...linkedDocuments.map((document) => removeStoredFile(document.storagePath))]);
  return c.json({
    ok: true,
    deleted: {
      maintenanceRecords: maintenanceRows.length,
      mileageEntries: mileageRows.length,
      specifications: specRows.length,
      projects: projectRows.length,
      documents: linkedDocuments.length,
      servicePlans: planRows.filter((plan) => !linkedPlanRows.some((link) => link.servicePlanId === plan.id && link.vehicleId !== vehicleId)).length,
      reminders: reminderRows.length,
      partFitments: fitmentRows.length,
    },
  });
});

async function insuranceRows() {
  const [policies, links, vehicleRows, documentRows] = await Promise.all([
    db.select().from(insurancePolicies).orderBy(asc(insurancePolicies.provider), asc(insurancePolicies.policyNumber)),
    db.select().from(insurancePolicyVehicles),
    db.select({ id: vehicles.id, year: vehicles.year, make: vehicles.make, model: vehicles.model, nickname: vehicles.nickname }).from(vehicles),
    db.select({ insurancePolicyId: documents.insurancePolicyId }).from(documents).where(sql`${documents.insurancePolicyId} IS NOT NULL`),
  ]);
  const vehicleById = new Map(vehicleRows.map((vehicle) => [vehicle.id, vehicle]));
  return policies.map((policy) => ({
    ...policy,
    vehicleIds: links.filter((link) => link.insurancePolicyId === policy.id).map((link) => link.vehicleId),
    vehicles: links.filter((link) => link.insurancePolicyId === policy.id).map((link) => vehicleById.get(link.vehicleId)).filter(Boolean),
    documentCount: documentRows.filter((document) => document.insurancePolicyId === policy.id).length,
  }));
}

async function validateInsuranceVehicles(vehicleIds: number[]) {
  if (!vehicleIds.length) return null;
  const rows = await db.select({ id: vehicles.id }).from(vehicles).where(inArray(vehicles.id, vehicleIds));
  return rows.length === vehicleIds.length ? null : "One or more selected vehicles no longer exist.";
}

app.get("/api/insurance", async (c) => c.json(await insuranceRows()));

app.post("/api/insurance", async (c) => {
  const parsed = insuranceInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the insurance policy details and linked vehicles.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data;
  const vehicleError = await validateInsuranceVehicles(input.vehicleIds);
  if (vehicleError) return c.json({ error: vehicleError }, 422);
  const created = db.transaction((tx) => {
    const [policy] = tx.insert(insurancePolicies).values({ provider: input.provider, policyNumber: input.policyNumber || null, agentName: input.agentName || null, agentPhone: input.agentPhone || null, effectiveAt: input.effectiveAt || null, expiresAt: input.expiresAt || null, premiumCents: input.premium == null ? null : Math.round(input.premium * 100), notes: input.notes || null }).returning().all();
    if (input.vehicleIds.length) tx.insert(insurancePolicyVehicles).values(input.vehicleIds.map((vehicleId) => ({ insurancePolicyId: policy.id, vehicleId }))).run();
    return policy;
  });
  return c.json(created, 201);
});

app.put("/api/insurance/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid insurance policy ID." }, 400);
  const parsed = insuranceInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the insurance policy details and linked vehicles.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const [existing] = await db.select({ id: insurancePolicies.id }).from(insurancePolicies).where(eq(insurancePolicies.id, id)).limit(1);
  if (!existing) return c.json({ error: "Insurance policy not found." }, 404);
  const input = parsed.data;
  const vehicleError = await validateInsuranceVehicles(input.vehicleIds);
  if (vehicleError) return c.json({ error: vehicleError }, 422);
  const policy = db.transaction((tx) => {
    const [updated] = tx.update(insurancePolicies).set({ provider: input.provider, policyNumber: input.policyNumber || null, agentName: input.agentName || null, agentPhone: input.agentPhone || null, effectiveAt: input.effectiveAt || null, expiresAt: input.expiresAt || null, premiumCents: input.premium == null ? null : Math.round(input.premium * 100), notes: input.notes || null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(insurancePolicies.id, id)).returning().all();
    tx.delete(insurancePolicyVehicles).where(eq(insurancePolicyVehicles.insurancePolicyId, id)).run();
    if (input.vehicleIds.length) tx.insert(insurancePolicyVehicles).values(input.vehicleIds.map((vehicleId) => ({ insurancePolicyId: id, vehicleId }))).run();
    return updated;
  });
  return c.json(policy);
});

app.delete("/api/insurance/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invalid insurance policy ID." }, 400);
  const [policy] = await db.select({ id: insurancePolicies.id }).from(insurancePolicies).where(eq(insurancePolicies.id, id)).limit(1);
  if (!policy) return c.json({ error: "Insurance policy not found." }, 404);
  const linkedDocuments = await db.select({ id: documents.id, storagePath: documents.storagePath }).from(documents).where(eq(documents.insurancePolicyId, id));
  db.transaction((tx) => { if (linkedDocuments.length) tx.delete(documents).where(inArray(documents.id, linkedDocuments.map((document) => document.id))).run(); tx.delete(insurancePolicies).where(eq(insurancePolicies.id, id)).run(); });
  await Promise.all(linkedDocuments.map((document) => removeStoredFile(document.storagePath)));
  return c.json({ ok: true, deletedDocuments: linkedDocuments.length });
});

app.get("/api/vin/:vin", async (c) => {
  const vin = c.req.param("vin").trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9*]{11,17}$/.test(vin)) return c.json({ error: "Enter an 11–17 character VIN without I, O, or Q." }, 422);
  try {
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`, { headers: { "User-Agent": "SumpLog/0.1" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("VIN service unavailable");
    const payload = await response.json() as { Results?: Array<Record<string, string>> };
    const result = payload.Results?.[0];
    if (!result || result.ErrorCode?.split(",").some((code) => !["0", "1", "6", "10"].includes(code.trim()))) return c.json({ error: result?.ErrorText || "The VIN could not be decoded." }, 422);
    return c.json({ vin, year: Number(result.ModelYear) || null, make: result.Make || null, model: result.Model || null, trim: result.Trim || result.Series || null, engine: [result.DisplacementL && `${result.DisplacementL}L`, result.EngineCylinders && `${result.EngineCylinders}-cyl`, result.EngineModel].filter(Boolean).join(" ") || null, transmission: [result.TransmissionStyle, result.TransmissionSpeeds && `${result.TransmissionSpeeds}-speed`].filter(Boolean).join(" ") || null, bodyClass: result.BodyClass || null, fuelType: result.FuelTypePrimary || null, manufacturer: result.Manufacturer || null, errorText: result.ErrorText || null });
  } catch {
    return c.json({ error: "VIN decoding is temporarily unavailable. Enter the vehicle details manually." }, 503);
  }
});

app.get("/api/vehicles/:id/image", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const [vehicle] = await db.select({ imageUrl: vehicles.imageUrl, photoRotation: vehicles.photoRotation }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle?.imageUrl) return c.json({ error: "Vehicle image not found." }, 404);
  const imagePath = resolve(vehicle.imageUrl); const rel = relative(uploadDirectory, imagePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return c.json({ error: "Invalid vehicle photo path." }, 404);
  const file = Bun.file(imagePath);
  if (!(await file.exists())) return c.json({ error: "Vehicle image file is missing." }, 404);
  const preview = c.req.query("preview") === "1";
  const editor = c.req.query("editor") === "1";
  const normalized = c.req.query("normalized") === "1";
  if (preview || editor || normalized || (vehicle.photoRotation && c.req.query("original") !== "1")) {
    const derivativeSize = preview ? 960 : editor ? 1600 : 0;
    try { return photoResponse(await photoBytes(imagePath, vehicle.photoRotation, derivativeSize), derivativeSize > 0, c.req.header("If-None-Match")); }
    catch { return c.json({ error: "This photo could not be decoded." }, 422); }
  }
  return new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream", "Cache-Control": "private, no-cache" } });
});

for (const kind of ["vehicles", "documents"] as const) app.post(`/api/${kind}/:id/photo-rotation`, async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = z.object({ rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), photoZoom: z.number().min(1).max(3).optional(), photoPositionX: z.number().int().min(0).max(100).optional(), photoPositionY: z.number().int().min(0).max(100).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose a valid rotation and photo framing." }, 422);
  const row = kind === "vehicles" ? db.select().from(vehicles).where(eq(vehicles.id, id)).get() : db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) return c.json({ error: "Photo not found." }, 404);
  const path = "imageUrl" in row ? row.imageUrl : row.mimeType?.startsWith("image/") ? row.storagePath : null;
  if (!path) return c.json({ error: "Only photos can be rotated." }, 422);
  const rel = relative(uploadDirectory, resolve(path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return c.json({ error: "Photo not found." }, 404);
  try { await photoBytes(path, 0, 32); } catch { return c.json({ error: "This photo could not be decoded." }, 422); }
  db.transaction((tx) => {
    if (kind === "vehicles") tx.update(vehicles).set({ photoRotation: sql`(${vehicles.photoRotation} + ${parsed.data.rotation}) % 360`, photoZoom: parsed.data.photoZoom ?? ("photoZoom" in row ? row.photoZoom : 1), photoPositionX: parsed.data.photoPositionX ?? ("photoPositionX" in row ? row.photoPositionX : 50), photoPositionY: parsed.data.photoPositionY ?? ("photoPositionY" in row ? row.photoPositionY : 50), updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(vehicles.id, id)).run();
    else {
      tx.update(documents).set({ photoRotation: sql`(${documents.photoRotation} + ${parsed.data.rotation}) % 360`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(documents.id, id)).run();
      if ("maintenanceId" in row && row.maintenanceId && parsed.data.rotation) tx.insert(maintenanceAuditLogs).values({ maintenanceId: row.maintenanceId, operation: "Updated", afterJson: JSON.stringify({ documentId: id, rotation: (row.photoRotation + parsed.data.rotation) % 360 }), summary: `Rotated photo ${"name" in row ? row.name : ""} by ${parsed.data.rotation}°; original preserved.` }).run();
    }
  });
  return c.json({ ok: true });
});

app.post("/api/vehicles/:id/image", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const [vehicle] = await db.select({ id: vehicles.id, imageUrl: vehicles.imageUrl }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return c.json({ error: "Vehicle not found." }, 404);
  const body = await c.req.parseBody();
  const file = body.file;
  const rotation = Number(body.rotation || 0);
  const photoZoom = Number(body.photoZoom || 1); const photoPositionX = Number(body.photoPositionX ?? 50); const photoPositionY = Number(body.photoPositionY ?? 50);
  if (![0, 90, 180, 270].includes(rotation) || !Number.isFinite(photoZoom) || photoZoom < 1 || photoZoom > 3 || !Number.isInteger(photoPositionX) || photoPositionX < 0 || photoPositionX > 100 || !Number.isInteger(photoPositionY) || photoPositionY < 0 || photoPositionY > 100) return c.json({ error: "Invalid photo rotation or framing." }, 422);
  let storagePath = "";
  try {
    storagePath = await saveUpload(file as File, true);
    await db.update(vehicles).set({ imageUrl: storagePath, photoRotation: rotation, photoZoom, photoPositionX, photoPositionY, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(vehicles.id, vehicleId));
    await removeStoredFile(vehicle.imageUrl);
    return c.json({ imageUrl: `/api/vehicles/${vehicleId}/image?v=${Date.now()}` });
  } catch (error) {
    await removeStoredFile(storagePath);
    return c.json({ error: error instanceof Error ? error.message : "The image could not be uploaded." }, 422);
  }
});

app.delete("/api/vehicles/:id/image", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const [vehicle] = await db.select({ imageUrl: vehicles.imageUrl, photoRotation: vehicles.photoRotation }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return c.json({ error: "Vehicle not found." }, 404);
  await db.update(vehicles).set({ imageUrl: null, photoRotation: 0, photoZoom: 1, photoPositionX: 50, photoPositionY: 50, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(vehicles.id, vehicleId));
  await removeStoredFile(vehicle.imageUrl);
  return c.json({ ok: true });
});

app.get("/api/vehicles/:id/mileage", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  return c.json(await db.select().from(mileageEntries).where(eq(mileageEntries.vehicleId, vehicleId)).orderBy(desc(mileageEntries.recordedDate)));
});

app.post("/api/vehicles/:id/mileage", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return c.json({ error: "Vehicle not found." }, 404);
  const parsed = mileageInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the mileage details and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data;
  const [previous] = await db.select().from(mileageEntries).where(eq(mileageEntries.vehicleId, vehicleId)).orderBy(desc(mileageEntries.recordedDate)).limit(1);
  let annual = input.annualMileageEstimate ?? vehicle.annualMileageEstimate ?? estimatedAnnualMileage(vehicle.year, input.mileage);
  if (input.annualMileageEstimate == null && previous && input.recordedDate > previous.recordedDate && input.mileage >= previous.mileage) {
    const days = (Date.parse(input.recordedDate) - Date.parse(previous.recordedDate)) / 86_400_000;
    if (days >= 7) annual = Math.round(((input.mileage - previous.mileage) / days) * 365.25);
  }
  try {
    const entry = db.transaction((tx) => {
      const [created] = tx.insert(mileageEntries).values({ vehicleId, recordedDate: input.recordedDate, mileage: input.mileage, annualMileageEstimate: annual, notes: input.notes || null }).returning().all();
      const [latest] = tx.select().from(mileageEntries).where(eq(mileageEntries.vehicleId, vehicleId)).orderBy(desc(mileageEntries.recordedDate), desc(mileageEntries.id)).limit(1).all();
      if (latest) tx.update(vehicles).set({ mileage: latest.mileage, annualMileageEstimate: latest.annualMileageEstimate, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(vehicles.id, vehicleId)).run();
      return created;
    });
    return c.json(entry, 201);
  } catch {
    return c.json({ error: "Mileage is already recorded for that date. Edit the date and try again." }, 409);
  }
});

app.put("/api/mileage/:id", async (c) => {
  const id = Number(c.req.param("id")); const existing = db.select().from(mileageEntries).where(eq(mileageEntries.id, id)).get();
  if (!existing) return c.json({ error: "Mileage entry not found." }, 404);
  const parsed = mileageInput.safeParse(await c.req.json().catch(() => null)); if (!parsed.success) return c.json({ error: "Check the mileage entry and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  try {
    const input = parsed.data;
    const updated = db.transaction((tx) => {
      const vehicle = tx.select().from(vehicles).where(eq(vehicles.id, existing.vehicleId)).get()!;
      const previous = tx.select().from(mileageEntries).where(and(eq(mileageEntries.vehicleId, existing.vehicleId), sql`${mileageEntries.id} != ${id}`, sql`${mileageEntries.recordedDate} < ${input.recordedDate}`)).orderBy(desc(mileageEntries.recordedDate)).get();
      const days = previous ? (Date.parse(input.recordedDate) - Date.parse(previous.recordedDate)) / 86400000 : 0;
      const annual = input.annualMileageEstimate ?? (previous && days >= 7 && input.mileage >= previous.mileage ? Math.round((input.mileage - previous.mileage) / days * 365.25) : estimatedAnnualMileage(vehicle.year, input.mileage));
      const row = tx.update(mileageEntries).set({ recordedDate: input.recordedDate, mileage: input.mileage, annualMileageEstimate: annual, notes: input.notes || null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(mileageEntries.id, id)).returning().get();
      const latest = tx.select().from(mileageEntries).where(eq(mileageEntries.vehicleId, existing.vehicleId)).orderBy(desc(mileageEntries.recordedDate), desc(mileageEntries.id)).get();
      if (latest) tx.update(vehicles).set({ mileage: latest.mileage, annualMileageEstimate: latest.annualMileageEstimate, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(vehicles.id, existing.vehicleId)).run();
      return row;
    });
    return c.json(updated);
  } catch { return c.json({ error: "A mileage entry already exists for that date. Edit that entry instead.", }, 409); }
});

app.get("/api/vehicles/:id/dashboard", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  if (!Number.isInteger(vehicleId)) return c.json({ error: "Invalid vehicle ID." }, 400);

  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return c.json({ error: "Vehicle not found." }, 404);

  const dueMaintenance = await db
    .select()
    .from(maintenanceRecords)
    .where(
      and(
        eq(maintenanceRecords.vehicleId, vehicleId), sql`${maintenanceRecords.voidedAt} IS NULL`,
        or(
          sql`${maintenanceRecords.nextDueMileage} IS NOT NULL`,
          sql`${maintenanceRecords.nextDueDate} IS NOT NULL`,
        ),
      ),
    )
    .orderBy(asc(maintenanceRecords.nextDueMileage), asc(maintenanceRecords.nextDueDate));
  const activePlans = (await db.select({ plan: servicePlans }).from(servicePlanVehicles).innerJoin(servicePlans, eq(servicePlanVehicles.servicePlanId, servicePlans.id)).where(and(eq(servicePlanVehicles.vehicleId, vehicleId), eq(servicePlans.active, true)))).map(({ plan }) => plan);
  const activeReminders = await db.select().from(reminders).where(and(eq(reminders.vehicleId, vehicleId), eq(reminders.status, "Active")));
  const dayDistance = (date: string | null) => date ? (Date.parse(`${date}T12:00:00Z`) - Date.now()) / 86_400_000 : Number.POSITIVE_INFINITY;
  const mileageDays = (mileage: number | null) => mileage == null ? Number.POSITIVE_INFINITY : ((mileage - vehicle.mileage) / Math.max(1, vehicle.annualMileageEstimate ?? 12_000)) * 365.25;
  const candidates = [
    ...dueMaintenance.map((record) => ({ rank: Math.min(dayDistance(record.nextDueDate), mileageDays(record.nextDueMileage)), record })),
    ...activePlans.filter((plan) => plan.nextDueDate || plan.nextDueMileage != null).map((plan) => ({ rank: Math.min(dayDistance(plan.nextDueDate), mileageDays(plan.nextDueMileage)), record: { ...plan, id: -plan.id, serviceDate: plan.nextDueDate ?? "", mileage: vehicle.mileage, costCents: 0, laborHours: 0, difficulty: 1, shopName: null, voidedAt: null } })),
    // A service-plan reminder is an automation aid, not a second service.
    // The linked plan above is the canonical Next Service item.
    ...activeReminders.filter((reminder) => !reminder.servicePlanId && !reminder.maintenanceId && (reminder.dueDate || reminder.dueMileage != null)).map((reminder) => ({ rank: Math.min(dayDistance(reminder.dueDate), mileageDays(reminder.dueMileage)), record: { ...reminder, id: -(1_000_000 + reminder.id), category: "Other", serviceDate: reminder.dueDate ?? "", mileage: vehicle.mileage, costCents: 0, laborHours: 0, difficulty: 1, shopName: null, nextDueDate: reminder.dueDate, nextDueMileage: reminder.dueMileage, voidedAt: null } })),
  ].sort((a, b) => a.rank - b.rank);
  const nextService = candidates[0]?.record ?? null;

  const recentMaintenance = await db
    .select()
    .from(maintenanceRecords)
    .where(and(eq(maintenanceRecords.vehicleId, vehicleId), sql`${maintenanceRecords.voidedAt} IS NULL`))
    .orderBy(desc(maintenanceRecords.serviceDate))
    .limit(5);

  const [partStats] = await db
    .select({
      totalParts: sql<number>`coalesce(sum(${parts.quantity}), 0)`,
      inventoryValueCents: sql<number>`coalesce(sum(${parts.quantity} * ${parts.purchasePriceCents}), 0)`,
      lowStock: sql<number>`coalesce(sum(case when ${parts.quantity} < ${parts.minimumQuantity} then 1 else 0 end), 0)`,
    })
    .from(parts);

  const activeProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.vehicleId, vehicleId), sql`${projects.status} != 'Done'`))
    .orderBy(desc(projects.updatedAt));

  const specs = await db
    .select()
    .from(referenceSpecs)
    .where(eq(referenceSpecs.vehicleId, vehicleId))
    .orderBy(asc(referenceSpecs.groupName), asc(referenceSpecs.label));

  return c.json({
      vehicle: publicVehicle(vehicle),
    nextService: nextService ?? null,
    nextServices: candidates.map((candidate) => candidate.record),
    recentMaintenance,
    partStats,
    activeProjects,
    specs,
  });
});

app.get("/api/vehicles/:id/specs", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  return c.json(await db.select().from(referenceSpecs).where(eq(referenceSpecs.vehicleId, vehicleId)).orderBy(asc(referenceSpecs.groupName), asc(referenceSpecs.label)));
});

app.post("/api/vehicles/:id/specs", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const parsed = specInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the specification and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  try {
    const [created] = await db.insert(referenceSpecs).values({ vehicleId, ...parsed.data, source: parsed.data.source || null, notes: parsed.data.notes || null }).returning();
    return c.json(created, 201);
  } catch { return c.json({ error: "That specification already exists for this vehicle." }, 409); }
});

app.put("/api/specs/:id", async (c) => {
  const id = Number(c.req.param("id")); const parsed = specInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the specification and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  try { const [updated] = await db.update(referenceSpecs).set({ ...parsed.data, source: parsed.data.source || null, notes: parsed.data.notes || null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(referenceSpecs.id, id)).returning(); if (!updated) return c.json({ error: "Specification not found." }, 404); return c.json(updated); }
  catch { return c.json({ error: "That specification already exists for this vehicle." }, 409); }
});

app.delete("/api/specs/:id", async (c) => { const [deleted] = await db.delete(referenceSpecs).where(eq(referenceSpecs.id, Number(c.req.param("id")))).returning(); return deleted ? c.json({ ok: true }) : c.json({ error: "Specification not found." }, 404); });

const specVehicleInput = z.object({ vehicleId: z.coerce.number().int().positive() });
async function validateSpecTarget(c: Context) {
  const parsed = specVehicleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return { response: c.json({ error: "Choose a valid target vehicle." }, 422) };
  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, parsed.data.vehicleId)).limit(1);
  return vehicle ? { vehicleId: parsed.data.vehicleId } : { response: c.json({ error: "Target vehicle not found." }, 404) };
}
app.post("/api/specs/:id/clone", async (c) => {
  const sourceId = Number(c.req.param("id")); const target = await validateSpecTarget(c); if (target.response) return target.response;
  const [source] = await db.select().from(referenceSpecs).where(eq(referenceSpecs.id, sourceId)).limit(1); if (!source) return c.json({ error: "Specification not found." }, 404);
  try { const [created] = await db.insert(referenceSpecs).values({ vehicleId: target.vehicleId!, groupName: source.groupName, label: source.label, value: source.value, source: source.source, notes: source.notes }).returning(); return c.json(created, 201); }
  catch { return c.json({ error: "That specification already exists for the target vehicle." }, 409); }
});
app.patch("/api/specs/:id/vehicle", async (c) => {
  const id = Number(c.req.param("id")); const target = await validateSpecTarget(c); if (target.response) return target.response;
  const [existing] = await db.select().from(referenceSpecs).where(eq(referenceSpecs.id, id)).limit(1); if (!existing) return c.json({ error: "Specification not found." }, 404);
  try { const [updated] = await db.update(referenceSpecs).set({ vehicleId: target.vehicleId!, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(referenceSpecs.id, id)).returning(); return c.json(updated); }
  catch { return c.json({ error: "That specification already exists for the target vehicle." }, 409); }
});

async function projectWithTasks(projectId: number) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  return { ...project, tasks: await db.select().from(projectTasks).where(eq(projectTasks.projectId, projectId)).orderBy(asc(projectTasks.position)) };
}

app.get("/api/projects", async (c) => {
  const vehicleId = Number(c.req.query("vehicleId"));
  const rows = await db.select().from(projects).where(Number.isInteger(vehicleId) ? eq(projects.vehicleId, vehicleId) : undefined).orderBy(asc(projects.status), asc(projects.targetDate));
  return c.json(await Promise.all(rows.map((project) => projectWithTasks(project.id))));
});

app.post("/api/vehicles/:id/projects", async (c) => {
  const vehicleId = Number(c.req.param("id")); const parsed = projectInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the project details and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data;
  const created = db.transaction((tx) => { const [project] = tx.insert(projects).values({ vehicleId, title: input.title, description: input.description || null, status: input.status, estimatedBudgetCents: Math.round(input.estimatedBudget * 100), actualCostCents: Math.round(input.actualCost * 100), targetDate: input.targetDate || null }).returning().all(); if (input.tasks.length) tx.insert(projectTasks).values(input.tasks.map((task, position) => ({ projectId: project.id, title: task.title, completed: task.completed, estimatedCostCents: Math.round(task.estimatedCost * 100), position }))).run(); return project; });
  return c.json(await projectWithTasks(created.id), 201);
});

app.put("/api/projects/:id", async (c) => {
  const projectId = Number(c.req.param("id")); const parsed = projectInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the project details and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data; const exists = await projectWithTasks(projectId); if (!exists) return c.json({ error: "Project not found." }, 404);
  db.transaction((tx) => { tx.update(projects).set({ title: input.title, description: input.description || null, status: input.status, estimatedBudgetCents: Math.round(input.estimatedBudget * 100), actualCostCents: Math.round(input.actualCost * 100), targetDate: input.targetDate || null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projects.id, projectId)).run(); tx.delete(projectTasks).where(eq(projectTasks.projectId, projectId)).run(); if (input.tasks.length) tx.insert(projectTasks).values(input.tasks.map((task, position) => ({ projectId, title: task.title, completed: task.completed, estimatedCostCents: Math.round(task.estimatedCost * 100), position }))).run(); });
  return c.json(await projectWithTasks(projectId));
});

app.patch("/api/project-tasks/:id", async (c) => { const id = Number(c.req.param("id")); const parsed = z.object({ completed: z.boolean() }).safeParse(await c.req.json().catch(() => null)); if (!parsed.success) return c.json({ error: "Choose a valid task state." }, 422); const [updated] = await db.update(projectTasks).set({ completed: parsed.data.completed, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projectTasks.id, id)).returning(); return updated ? c.json(updated) : c.json({ error: "Project task not found." }, 404); });
app.delete("/api/projects/:id", async (c) => { const [deleted] = await db.delete(projects).where(eq(projects.id, Number(c.req.param("id")))).returning(); return deleted ? c.json({ ok: true }) : c.json({ error: "Project not found." }, 404); });

app.get("/api/parts", async (c) => {
  const vehicleId = Number(c.req.query("vehicleId"));
  const query = c.req.query("q")?.trim();
  const search = query ? `%${query}%` : undefined;

  const filters = [search
      ? or(
          like(parts.partNumber, search),
          like(parts.name, search),
          like(parts.manufacturer, search),
          like(parts.storageLocation, search),
        )
      : undefined,
  ].filter(Boolean);

  const partRows = await db.select().from(parts)
    .where(filters.length ? and(...(filters as Parameters<typeof and>)) : undefined)
    .orderBy(asc(parts.name));
  if (!partRows.length) return c.json([]);
  const fitmentRows = await db.select({ partId: vehicleParts.partId, vehicleId: vehicleParts.vehicleId, notes: vehicleParts.fitmentNotes })
    .from(vehicleParts).where(inArray(vehicleParts.partId, partRows.map((part) => part.id)));
  const rows = partRows.map((part) => {
    const fitments = fitmentRows.filter((fitment) => fitment.partId === part.id).map(({ vehicleId: id, notes }) => ({ vehicleId: id, notes }));
    const selected = fitments.find((fitment) => fitment.vehicleId === vehicleId) ?? fitments[0];
    return { ...part, vehicleId: selected?.vehicleId ?? null, fitmentNotes: selected?.notes ?? null, fitments };
  }).filter((part) => !Number.isInteger(vehicleId) || part.fitments.length === 0 || part.fitments.some((fitment) => fitment.vehicleId === vehicleId));
  return c.json(rows);
});

app.post("/api/parts", async (c) => {
  const validated = await validatePartRequest(c);
  if (validated.response) return validated.response;
  const input = validated.data!;

  const duplicateFilters = [eq(parts.partNumber, input.partNumber)];
  duplicateFilters.push(
    input.manufacturer ? eq(parts.manufacturer, input.manufacturer) : sql`${parts.manufacturer} IS NULL`,
  );
  const [duplicate] = await db.select({ id: parts.id }).from(parts).where(and(...duplicateFilters)).limit(1);
  if (duplicate) return c.json({ error: "That part number and manufacturer already exist." }, 409);

  const partId = db.transaction((tx) => {
    const [created] = tx.insert(parts).values({
      partNumber: input.partNumber,
      itemType: input.itemType,
      category: input.category || null,
      specifications: input.specifications || null,
      approvals: input.approvals || null,
      name: input.name,
      manufacturer: input.manufacturer || null,
      supplierName: input.supplierName || null,
      supplierUrl: input.supplierUrl || null,
      purchasePriceCents: Math.round(input.purchasePrice * 100),
      quantity: input.quantity,
      volumePerUnit: input.volumePerUnit === "" || input.volumePerUnit == null ? null : input.volumePerUnit,
      volumeUnit: input.volumeUnit || null,
      minimumQuantity: input.minimumQuantity,
      storageLocation: input.storageLocation || null,
      notes: input.notes || null,
    }).returning({ id: parts.id }).all();
    const fitments = input.fitments ?? (input.vehicleId ? [{ vehicleId: input.vehicleId, notes: input.fitmentNotes ?? "" }] : []);
    if (fitments.length) {
      tx.insert(vehicleParts).values(fitments.map((fitment) => ({ vehicleId: fitment.vehicleId, partId: created.id, fitmentNotes: fitment.notes || null }))).run();
    }
    return created.id;
  });

  return c.json(await getPart(partId, input.vehicleId), 201);
});

app.put("/api/parts/:id", async (c) => {
  const partId = Number(c.req.param("id"));
  if (!Number.isInteger(partId)) return c.json({ error: "Invalid part ID." }, 400);
  if (!(await getPart(partId))) return c.json({ error: "Part not found." }, 404);

  const validated = await validatePartRequest(c);
  if (validated.response) return validated.response;
  const input = validated.data!;
  const duplicateFilters = [eq(parts.partNumber, input.partNumber), ne(parts.id, partId)];
  duplicateFilters.push(
    input.manufacturer ? eq(parts.manufacturer, input.manufacturer) : sql`${parts.manufacturer} IS NULL`,
  );
  const [duplicate] = await db.select({ id: parts.id }).from(parts).where(and(...duplicateFilters)).limit(1);
  if (duplicate) return c.json({ error: "That part number and manufacturer already exist." }, 409);

  db.transaction((tx) => {
    tx.update(parts).set({
      itemType: input.itemType,
      category: input.category || null,
      specifications: input.specifications || null,
      approvals: input.approvals || null,
      partNumber: input.partNumber,
      name: input.name,
      manufacturer: input.manufacturer || null,
      supplierName: input.supplierName || null,
      supplierUrl: input.supplierUrl || null,
      purchasePriceCents: Math.round(input.purchasePrice * 100),
      quantity: input.quantity,
      volumePerUnit: input.volumePerUnit === "" || input.volumePerUnit == null ? null : input.volumePerUnit,
      volumeUnit: input.volumeUnit || null,
      minimumQuantity: input.minimumQuantity,
      storageLocation: input.storageLocation || null,
      notes: input.notes || null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(parts.id, partId)).run();

    tx.delete(vehicleParts).where(eq(vehicleParts.partId, partId)).run();
    const fitments = input.fitments ?? (input.vehicleId ? [{ vehicleId: input.vehicleId, notes: input.fitmentNotes ?? "" }] : []);
    if (fitments.length) {
      tx.insert(vehicleParts).values(fitments.map((fitment) => ({ vehicleId: fitment.vehicleId, partId, fitmentNotes: fitment.notes || null }))).run();
    }
  });

  return c.json(await getPart(partId, input.vehicleId));
});

app.delete("/api/parts/:id", async (c) => {
  const partId = Number(c.req.param("id"));
  if (!Number.isInteger(partId)) return c.json({ error: "Invalid part ID." }, 400);
  if (!(await getPart(partId))) return c.json({ error: "Part not found." }, 404);
  try {
    await db.delete(parts).where(eq(parts.id, partId));
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "This part is attached to a maintenance record and cannot be deleted." }, 409);
  }
});

app.get("/api/maintenance/options", (c) => {
  const records = db.select({ category: maintenanceRecords.category, shop: maintenanceRecords.shopName }).from(maintenanceRecords).all();
  const plans = db.select({ category: servicePlans.category }).from(servicePlans).all();
  const choices = (values: Array<string | null>) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
  return c.json({ systems: choices([...records, ...plans].map((row) => row.category)), shops: choices(records.map((row) => row.shop)) });
});

app.get("/api/vehicles/:id/maintenance", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const rows = await db
    .select()
    .from(maintenanceRecords)
    .where(eq(maintenanceRecords.vehicleId, vehicleId))
    .orderBy(desc(maintenanceRecords.serviceDate), desc(maintenanceRecords.mileage));
  const enriched = rows.map((record) => {
    const linked = db.select({ partId: maintenanceParts.partId, quantity: maintenanceParts.quantity, unitCostCents: maintenanceParts.unitCostCents, usageMode: maintenanceParts.usageMode, amountUsed: maintenanceParts.amountUsed, amountUnit: maintenanceParts.amountUnit, name: parts.name, partNumber: parts.partNumber, manufacturer: parts.manufacturer, supplierName: parts.supplierName }).from(maintenanceParts).innerJoin(parts, eq(parts.id, maintenanceParts.partId)).where(eq(maintenanceParts.maintenanceId, record.id)).all();
    return { ...record, parts: linked, partsCostCents: linked.reduce((sum, part) => sum + Math.round(part.quantity * part.unitCostCents), 0) };
  });
  return c.json(enriched);
});

function nextMaintenanceEvidencePosition(tx: any, maintenanceId: number) {
  const row = tx.select({ position: sql<number>`coalesce(max(${documentMaintenanceLinks.position}), -1)` })
    .from(documentMaintenanceLinks)
    .where(eq(documentMaintenanceLinks.maintenanceId, maintenanceId))
    .get();
  return Number(row?.position ?? -1) + 1;
}

function maintenanceSnapshot(tx: any, record: typeof maintenanceRecords.$inferSelect) {
  return JSON.stringify({ ...record, parts: tx.select().from(maintenanceParts).where(eq(maintenanceParts.maintenanceId, record.id)).all().map(({ partId, quantity, unitCostCents, usageMode, amountUsed, amountUnit }: typeof maintenanceParts.$inferSelect) => ({ partId, quantity, unitCostCents, usageMode, amountUsed, amountUnit })) });
}

async function validateMaintenancePartUsage(selections: Array<{ partId: number; quantity: number; usageMode: "Whole" | "Partial"; amountUsed?: number | null; amountUnit?: string | null }>) {
  for (const selection of selections) {
    const part = await getPart(selection.partId);
    if (!part) return "One or more selected parts no longer exists.";
    if (selection.usageMode === "Whole" && !Number.isInteger(selection.quantity)) return `Use a whole number of units for ${part.name}.`;
    if (selection.usageMode === "Partial") {
      if (part.itemType !== "Consumable" || !part.volumePerUnit || !part.volumeUnit) return `${part.name} needs a volume per unit before partial use can be recorded.`;
      if (!selection.amountUsed || selection.amountUsed <= 0) return `Enter the total amount used in ${part.volumeUnit} for ${part.name}.`;
      if (selection.amountUnit && selection.amountUnit !== part.volumeUnit) return `Use ${part.volumeUnit} when recording partial use of ${part.name}.`;
    }
  }
  return null;
}

function adjustMaintenanceStock(tx: any, partId: number, additionalUsed: number) {
  if (Math.abs(additionalUsed) < 1e-8) return;
  const part = tx.select().from(parts).where(eq(parts.id, partId)).get();
  if (!part) throw new WorkflowConflict("A selected inventory item no longer exists.");
  const remaining = Math.round((part.quantity - additionalUsed) * 1e8) / 1e8;
  if (remaining < 0) throw new WorkflowConflict(`Not enough ${part.name} in stock (${part.quantity} units available). Update its stock or reduce the amount used.`);
  tx.update(parts).set({ quantity: remaining, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(parts.id, partId)).run();
}

function attachMaintenanceParts(tx: any, maintenanceId: number, vehicleId: number, selections: Array<{ partId: number; quantity: number; usageMode: "Whole" | "Partial"; amountUsed?: number | null; amountUnit?: string | null }>, baseCostCents: number) {
  const previousParts = tx.select().from(maintenanceParts).where(eq(maintenanceParts.maintenanceId, maintenanceId)).all();
  const record = tx.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).get();
  const nextQuantities = new Map<number, number>();
  tx.delete(maintenanceParts).where(eq(maintenanceParts.maintenanceId, maintenanceId)).run();
  let partsCostCents = 0;
  for (const selection of selections) {
    const part = tx.select().from(parts).where(eq(parts.id, selection.partId)).get();
    if (!part) throw new Error("One or more selected parts no longer exists.");
    let quantity = selection.quantity;
    let amountUsed: number | null = null;
    let amountUnit: string | null = null;
    if (selection.usageMode === "Partial") {
      if (part.itemType !== "Consumable" || !part.volumePerUnit || !part.volumeUnit) throw new Error(`${part.name} needs a volume per unit before partial use can be recorded.`);
      if (!selection.amountUsed || selection.amountUsed <= 0) throw new Error(`Enter the total amount used in ${part.volumeUnit} for ${part.name}.`);
      if (selection.amountUnit && selection.amountUnit !== part.volumeUnit) throw new Error(`Use ${part.volumeUnit} when recording partial use of ${part.name}.`);
      amountUsed = selection.amountUsed;
      amountUnit = part.volumeUnit;
      quantity = amountUsed / part.volumePerUnit;
    } else if (!Number.isInteger(quantity)) {
      throw new Error(`Use a whole number of units for ${part.name}.`);
    }
    const unitCostCents = previousParts.find((entry: { partId: number }) => entry.partId === selection.partId)?.unitCostCents ?? part.purchasePriceCents;
    partsCostCents += Math.round(quantity * unitCostCents);
    nextQuantities.set(selection.partId, quantity);
    tx.insert(maintenanceParts).values({ maintenanceId, partId: selection.partId, quantity, unitCostCents, usageMode: selection.usageMode, amountUsed, amountUnit }).run();
  }
  if (!record?.voidedAt) {
    const previous = new Map<number, number>(previousParts.map((entry: { partId: number; quantity: number }) => [entry.partId, entry.quantity]));
    // Apply only the difference: repeated saves and attachment reordering do not consume stock again.
    for (const partId of new Set([...previous.keys(), ...nextQuantities.keys()])) {
      adjustMaintenanceStock(tx, partId, (nextQuantities.get(partId) ?? 0) - (previous.get(partId) ?? 0));
    }
  }
  tx.update(maintenanceRecords).set({ costCents: baseCostCents + partsCostCents }).where(eq(maintenanceRecords.id, maintenanceId)).run();
  return partsCostCents;
}

function syncMaintenanceReminder(tx: any, record: { id: number; vehicleId: number; title: string; nextDueDate: string | null; nextDueMileage: number | null }) {
  tx.delete(reminders).where(and(eq(reminders.maintenanceId, record.id), eq(reminders.status, "Active"))).run();
  if (record.nextDueDate || record.nextDueMileage != null) tx.insert(reminders).values({ vehicleId: record.vehicleId, maintenanceId: record.id, title: record.title, dueDate: record.nextDueDate, dueMileage: record.nextDueMileage, notes: "Created from maintenance follow-up." }).run();
}

app.post("/api/vehicles/:id/maintenance", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const vehicle = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle[0]) return c.json({ error: "Vehicle not found." }, 404);

  const parsed = maintenanceInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: "Check the highlighted fields and try again.", fields: z.flattenError(parsed.error).fieldErrors },
      422,
    );
  }

  const input = parsed.data;
  const partUsageError = await validateMaintenancePartUsage(input.parts);
  if (partUsageError) return c.json({ error: partUsageError }, 422);
  const duplicate = input.submissionKey ? db.select().from(maintenanceRecords).where(eq(maintenanceRecords.submissionKey, input.submissionKey)).get() : null;
  if (duplicate) return duplicate.vehicleId === vehicleId ? c.json(duplicate) : c.json({ error: "Submission key already used." }, 409);
  const record = db.transaction((tx) => {
    const [created] = tx
      .insert(maintenanceRecords)
      .values({
        vehicleId,
        submissionKey: input.submissionKey,
        title: input.title,
        category: input.category,
        serviceDate: input.serviceDate,
        mileage: input.mileage,
        costCents: Math.round(input.cost * 100),
        laborHours: input.laborHours,
        difficulty: input.difficulty,
        shopName: input.shopName || null,
        notes: input.notes || null,
        nextDueDate: input.nextDueDate || null,
        nextDueMileage: input.nextDueMileage === "" ? null : input.nextDueMileage,
      })
      .returning()
      .all();

    created.costCents += attachMaintenanceParts(tx, created.id, vehicleId, input.parts, Math.round(input.cost * 100));
    completeMaintenanceSource(tx, created, input.dueSourceId);
    syncMaintenanceReminder(tx, created);
    recordServiceOdometer(tx, vehicleId, input.serviceDate, input.mileage);
    tx.insert(maintenanceAuditLogs).values({
      maintenanceId: created.id,
      operation: "Created",
      afterJson: maintenanceSnapshot(tx, created),
      summary: "Maintenance record created.",
    }).run();
    return created;
  });

  return c.json(record, 201);
});

app.put("/api/maintenance/:id", async (c) => {
  const maintenanceId = Number(c.req.param("id"));
  const [existing] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).limit(1);
  if (!existing) return c.json({ error: "Maintenance record not found." }, 404);
  const parsed = maintenanceInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the highlighted fields and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data;
  const partUsageError = await validateMaintenancePartUsage(input.parts);
  if (partUsageError) return c.json({ error: partUsageError }, 422);
  const updated = db.transaction((tx) => {
    const beforeSnapshot = maintenanceSnapshot(tx, existing);
    const [record] = tx.update(maintenanceRecords).set({
      title: input.title,
      category: input.category,
      serviceDate: input.serviceDate,
      mileage: input.mileage,
      costCents: Math.round(input.cost * 100),
      laborHours: input.laborHours,
      difficulty: input.difficulty,
      shopName: input.shopName || null,
      notes: input.notes || null,
      nextDueDate: input.nextDueDate || null,
      nextDueMileage: input.nextDueMileage === "" ? null : input.nextDueMileage,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(maintenanceRecords.id, maintenanceId)).returning().all();
    recordServiceOdometer(tx, existing.vehicleId, input.serviceDate, input.mileage);
    record.costCents += attachMaintenanceParts(tx, maintenanceId, existing.vehicleId, input.parts, Math.round(input.cost * 100));
    syncMaintenanceReminder(tx, record);
    const changedFields = Object.keys(record).filter((key) => JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(record[key as keyof typeof record]) && !["updatedAt", "createdAt"].includes(key));
    tx.insert(maintenanceAuditLogs).values({
      maintenanceId,
      operation: "Updated",
      beforeJson: beforeSnapshot,
      afterJson: maintenanceSnapshot(tx, record),
      summary: changedFields.length ? `Changed ${changedFields.join(", ")}.` : "Record saved without field changes.",
    }).run();
    return record;
  });
  return c.json(updated);
});

// A service can advance the odometer only at or after the latest dated reading.
function recordServiceOdometer(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], vehicleId: number, date: string, mileage: number) {
  const current = tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).get();
  const latest = tx.select().from(mileageEntries).where(eq(mileageEntries.vehicleId, vehicleId)).orderBy(desc(mileageEntries.recordedDate), desc(mileageEntries.id)).get();
  if (!current || mileage <= current.mileage || (latest && date < latest.recordedDate)) return;
  tx.insert(mileageEntries).values({ vehicleId, recordedDate: date, mileage, annualMileageEstimate: current.annualMileageEstimate, notes: "Odometer recorded during maintenance." })
    .onConflictDoUpdate({ target: [mileageEntries.vehicleId, mileageEntries.recordedDate], set: { mileage, updatedAt: sql`CURRENT_TIMESTAMP` } }).run();
  tx.update(vehicles).set({ mileage, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(vehicles.id, vehicleId)).run();
}

async function parseMaintenanceBundle(c: Context) {
  const body = await c.req.parseBody({ all: true });
  let raw: unknown; try { raw = JSON.parse(String(body.record ?? "null")); } catch { return { error: "Invalid maintenance data." }; }
  const parsed = maintenanceInput.safeParse(raw);
  if (!parsed.success) return { error: "Check the maintenance details and try again." };
  const rawFiles = body.files;
  const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []).filter((file): file is File => file instanceof File);
  if (!files.length || files.length > 50) return { error: "Choose between 1 and 50 attachments." };
  if (files.reduce((size, file) => size + file.size, 0) > 120 * 1024 * 1024) return { error: "Attachments together must be 120 MB or smaller." };
  let metadata: Array<{ kind: string; name: string; rotation?: number }>;
  try {
    const rawMetadata = body.attachments ? JSON.parse(String(body.attachments)) : null;
    metadata = rawMetadata == null ? files.map((file) => ({ kind: String(body.kind || "Receipt"), name: file.name })) : z.array(z.object({ rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0), kind: z.string(), name: z.string().trim().max(240).optional().default("") })).max(50).parse(rawMetadata);
  } catch { return { error: "Attachment details are invalid." }; }
  if (metadata.length !== files.length || metadata.some((attachment) => !attachment.kind.trim() || attachment.kind.length > 80)) return { error: "Choose a valid type for every attachment." };
  const stored: Array<{ file: File; path: string; kind: string; name: string; rotation?: number }> = [];
  try {
    for (const [index, file] of files.entries()) stored.push({ file, path: await saveUpload(file), kind: metadata[index].kind, name: metadata[index].name || file.name, rotation: metadata[index].rotation ?? 0 });
    return { input: parsed.data, stored };
  } catch (error) {
    await Promise.all(stored.map((entry) => removeStoredFile(entry.path)));
    return { error: error instanceof Error ? error.message : "The attachments could not be stored." };
  }
}

app.post("/api/vehicles/:id/maintenance-bundle", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return c.json({ error: "Vehicle not found." }, 404);
  const bundle = await parseMaintenanceBundle(c);
  if (bundle.error || !bundle.input || !bundle.stored) return c.json({ error: bundle.error }, 422);
  const input = bundle.input;
  const duplicate = input.submissionKey ? db.select().from(maintenanceRecords).where(eq(maintenanceRecords.submissionKey, input.submissionKey)).get() : null;
  if (duplicate) {
    await Promise.all(bundle.stored.map((entry) => removeStoredFile(entry.path)));
    return duplicate.vehicleId === vehicleId ? c.json(duplicate) : c.json({ error: "Submission key already used." }, 409);
  }
  try {
    const record = db.transaction((tx) => {
      const [created] = tx.insert(maintenanceRecords).values({ vehicleId, submissionKey: input.submissionKey, title: input.title, category: input.category, serviceDate: input.serviceDate, mileage: input.mileage, costCents: Math.round(input.cost * 100), laborHours: input.laborHours, difficulty: input.difficulty, shopName: input.shopName || null, notes: input.notes || null, nextDueDate: input.nextDueDate || null, nextDueMileage: input.nextDueMileage === "" ? null : input.nextDueMileage }).returning().all();
      created.costCents += attachMaintenanceParts(tx, created.id, vehicleId, input.parts, Math.round(input.cost * 100));
      completeMaintenanceSource(tx, created, input.dueSourceId);
    syncMaintenanceReminder(tx, created);
      recordServiceOdometer(tx, vehicleId, input.serviceDate, input.mileage);
      tx.insert(maintenanceAuditLogs).values({ maintenanceId: created.id, operation: "Created", afterJson: maintenanceSnapshot(tx, created), summary: `Maintenance record created with ${bundle.stored.length} attachment${bundle.stored.length === 1 ? "" : "s"}.` }).run();
      let evidencePosition = nextMaintenanceEvidencePosition(tx, created.id);
      for (const { file, path, kind, name, rotation } of bundle.stored) {
        const attached = tx.insert(documents).values({ trackingId: crypto.randomUUID(), originalName: file.name.slice(0, 240), photoRotation: rotation ?? 0, vehicleId, maintenanceId: created.id, kind, name: name.slice(0, 240), storagePath: path, mimeType: file.type.split(";", 1)[0].toLowerCase(), sizeBytes: file.size }).returning({ id: documents.id }).get();
        tx.insert(documentMaintenanceLinks).values({ documentId: attached.id, maintenanceId: created.id, position: evidencePosition++ }).run();
      }
      return created;
    });
    return c.json(record, 201);
  } catch (error) {
    await Promise.all(bundle.stored.map((entry) => removeStoredFile(entry.path)));
    return c.json({ error: error instanceof Error ? error.message : "Maintenance and attachments could not be saved." }, 422);
  }
});

app.put("/api/maintenance/:id/bundle", async (c) => {
  const maintenanceId = Number(c.req.param("id"));
  const [existing] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).limit(1);
  if (!existing) return c.json({ error: "Maintenance record not found." }, 404);
  const bundle = await parseMaintenanceBundle(c);
  if (bundle.error || !bundle.input || !bundle.stored) return c.json({ error: bundle.error }, 422);
  const input = bundle.input;
  try {
    const record = db.transaction((tx) => {
      const beforeSnapshot = maintenanceSnapshot(tx, existing);
      const [updated] = tx.update(maintenanceRecords).set({ title: input.title, category: input.category, serviceDate: input.serviceDate, mileage: input.mileage, costCents: Math.round(input.cost * 100), laborHours: input.laborHours, difficulty: input.difficulty, shopName: input.shopName || null, notes: input.notes || null, nextDueDate: input.nextDueDate || null, nextDueMileage: input.nextDueMileage === "" ? null : input.nextDueMileage, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(maintenanceRecords.id, maintenanceId)).returning().all();
      updated.costCents += attachMaintenanceParts(tx, maintenanceId, existing.vehicleId, input.parts, Math.round(input.cost * 100));
      syncMaintenanceReminder(tx, updated);
      recordServiceOdometer(tx, existing.vehicleId, input.serviceDate, input.mileage);
      const changedFields = Object.keys(updated).filter((key) => JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(updated[key as keyof typeof updated]) && !["updatedAt", "createdAt"].includes(key));
      tx.insert(maintenanceAuditLogs).values({ maintenanceId, operation: "Updated", beforeJson: beforeSnapshot, afterJson: maintenanceSnapshot(tx, updated), summary: `${changedFields.length ? `Changed ${changedFields.join(", ")}. ` : ""}Added ${bundle.stored.length} attachment${bundle.stored.length === 1 ? "" : "s"}.` }).run();
      let evidencePosition = nextMaintenanceEvidencePosition(tx, maintenanceId);
      for (const { file, path, kind, name, rotation } of bundle.stored) {
        const attached = tx.insert(documents).values({ trackingId: crypto.randomUUID(), originalName: file.name.slice(0, 240), photoRotation: rotation ?? 0, vehicleId: existing.vehicleId, maintenanceId, kind, name: name.slice(0, 240), storagePath: path, mimeType: file.type.split(";", 1)[0].toLowerCase(), sizeBytes: file.size }).returning({ id: documents.id }).get();
        tx.insert(documentMaintenanceLinks).values({ documentId: attached.id, maintenanceId, position: evidencePosition++ }).run();
      }
      return updated;
    });
    return c.json(record);
  } catch (error) {
    await Promise.all(bundle.stored.map((entry) => removeStoredFile(entry.path)));
    return c.json({ error: error instanceof Error ? error.message : "Maintenance and attachments could not be saved." }, 422);
  }
});

app.get("/api/maintenance/:id/audit", async (c) => {
  const maintenanceId = Number(c.req.param("id"));
  return c.json(await db.select().from(maintenanceAuditLogs).where(eq(maintenanceAuditLogs.maintenanceId, maintenanceId)).orderBy(desc(maintenanceAuditLogs.changedAt), desc(maintenanceAuditLogs.id)));
});

app.patch("/api/maintenance/:id/status", async (c) => {
  const maintenanceId = Number(c.req.param("id"));
  const parsed = z.object({ voided: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose a valid maintenance status." }, 422);
  const [existing] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).limit(1);
  if (!existing) return c.json({ error: "Maintenance record not found." }, 404);
  const voidedAt = parsed.data.voided ? new Date().toISOString() : null;
  const updated = db.transaction((tx) => {
    if (Boolean(existing.voidedAt) !== parsed.data.voided) {
      const usage = tx.select().from(maintenanceParts).where(eq(maintenanceParts.maintenanceId, maintenanceId)).all();
      for (const entry of usage) adjustMaintenanceStock(tx, entry.partId, parsed.data.voided ? -entry.quantity : entry.quantity);
    }
    const [record] = tx.update(maintenanceRecords).set({ voidedAt, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(maintenanceRecords.id, maintenanceId)).returning().all();
    tx.insert(maintenanceAuditLogs).values({ maintenanceId, operation: parsed.data.voided ? "Voided" : "Restored", beforeJson: JSON.stringify(existing), afterJson: JSON.stringify(record), summary: parsed.data.voided ? "Maintenance record voided." : "Maintenance record restored." }).run();
    return record;
  });
  return c.json(updated);
});

app.patch("/api/maintenance/:id/due", async (c) => {
  const maintenanceId = Number(c.req.param("id"));
  const [existing] = await db.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).limit(1);
  if (!existing) return c.json({ error: "Maintenance record not found." }, 404);
  const updated = db.transaction((tx) => {
    const [record] = tx.update(maintenanceRecords).set({ nextDueDate: null, nextDueMileage: null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(maintenanceRecords.id, maintenanceId)).returning().all();
    tx.delete(reminders).where(and(eq(reminders.maintenanceId, maintenanceId), eq(reminders.status, "Active"))).run();
    return record;
  });
  return c.json(updated);
});

// Shared templates become independent schedules when a vehicle is serviced.
function vehicleSchedule(tx: any, planId: number, vehicleId: number) {
  const plan = tx.select().from(servicePlans).where(eq(servicePlans.id, planId)).get();
  const links = tx.select().from(servicePlanVehicles).where(eq(servicePlanVehicles.servicePlanId, planId)).all();
  if (!plan || !(links.length ? links.some((link: { vehicleId: number }) => link.vehicleId === vehicleId) : plan.vehicleId === vehicleId)) throw new WorkflowConflict("Maintenance task is not assigned to this vehicle.");
  if (links.length < 2) return plan;
  const { id, createdAt, updatedAt, ...values } = plan;
  const copy = tx.insert(servicePlans).values({ ...values, vehicleId }).returning().get();
  tx.insert(servicePlanVehicles).values({ servicePlanId: copy.id, vehicleId }).run();
  for (const item of tx.select().from(servicePlanItems).where(eq(servicePlanItems.servicePlanId, planId)).all()) {
    tx.insert(servicePlanItems).values({ servicePlanId: copy.id, title: item.title, notes: item.notes, position: item.position }).run();
  }
  tx.update(reminders).set({ servicePlanId: copy.id }).where(and(eq(reminders.servicePlanId, planId), eq(reminders.vehicleId, vehicleId))).run();
  tx.delete(servicePlanVehicles).where(and(eq(servicePlanVehicles.servicePlanId, planId), eq(servicePlanVehicles.vehicleId, vehicleId))).run();
  if (plan.vehicleId === vehicleId) tx.update(servicePlans).set({ vehicleId: links.find((link: { vehicleId: number }) => link.vehicleId !== vehicleId).vehicleId }).where(eq(servicePlans.id, planId)).run();
  return copy;
}

function advanceSchedule(tx: any, planId: number, vehicleId: number, serviceDate: string, mileage: number, overrideDate?: string | null, overrideMileage?: number | null) {
  const plan = vehicleSchedule(tx, planId, vehicleId);
  let nextDueDate = overrideDate ?? null;
  if (overrideDate === undefined && plan.intervalMonths) {
    const date = new Date(serviceDate + "T12:00:00Z");
    const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + plan.intervalMonths);
    date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
    nextDueDate = date.toISOString().slice(0, 10);
  }
  const nextDueMileage = overrideMileage === undefined ? (plan.intervalMileage ? mileage + plan.intervalMileage : null) : overrideMileage;
  const active = Boolean(nextDueDate || nextDueMileage != null);
  const updated = tx.update(servicePlans).set({ nextDueDate, nextDueMileage, active, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(servicePlans.id, plan.id)).returning().get();
  tx.update(reminders).set({ status: "Completed" }).where(and(eq(reminders.servicePlanId, plan.id), eq(reminders.status, "Active"))).run();
  if (active) tx.insert(reminders).values({ vehicleId, servicePlanId: plan.id, title: plan.title, dueDate: nextDueDate, dueMileage: nextDueMileage }).run();
  return updated;
}

function completeMaintenanceSource(tx: any, record: typeof maintenanceRecords.$inferSelect, sourceId?: number) {
  if (!sourceId) return;
  if (sourceId > 0) {
    const source = tx.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, sourceId)).get();
    if (!source || source.vehicleId !== record.vehicleId || (!source.nextDueDate && source.nextDueMileage == null)) throw new WorkflowConflict("This follow-up is no longer available. Refresh and try again.");
    tx.update(maintenanceRecords).set({ nextDueDate: null, nextDueMileage: null }).where(eq(maintenanceRecords.id, sourceId)).run();
    tx.update(reminders).set({ status: "Completed" }).where(and(eq(reminders.maintenanceId, sourceId), eq(reminders.status, "Active"))).run();
  } else if (sourceId <= -1000000) {
    const id = -sourceId - 1000000;
    const reminder = tx.select().from(reminders).where(eq(reminders.id, id)).get();
    if (!reminder || reminder.vehicleId !== record.vehicleId || reminder.status !== "Active" || reminder.servicePlanId) throw new WorkflowConflict("This reminder is no longer available. Refresh and try again.");
    tx.update(reminders).set({ status: "Completed" }).where(eq(reminders.id, id)).run();
  } else {
    advanceSchedule(tx, -sourceId, record.vehicleId, record.serviceDate, record.mileage, record.nextDueDate || undefined, record.nextDueMileage ?? undefined);
    record.nextDueDate = null; record.nextDueMileage = null;
    tx.update(maintenanceRecords).set({ nextDueDate: null, nextDueMileage: null }).where(eq(maintenanceRecords.id, record.id)).run();
  }
}

app.post("/api/service-plans/:id/complete", async (c) => {
  const planId = Number(c.req.param("id"));
  const parsed = z.object({ serviceDate: z.iso.date(), mileage: z.coerce.number().int().min(0).max(10_000_000), nextDueDate: z.union([z.iso.date(), z.null()]).optional(), nextDueMileage: z.union([z.null(), z.coerce.number().int().min(0)]).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose a valid completed date and mileage." }, 422);
  const [plan] = await db.select().from(servicePlans).where(eq(servicePlans.id, planId)).limit(1);
  if (!plan) return c.json({ error: "Maintenance task not found." }, 404);
  const links = db.select().from(servicePlanVehicles).where(eq(servicePlanVehicles.servicePlanId, planId)).all();
  const requestedVehicle = Number(c.req.query("vehicleId"));
  const vehicleId = requestedVehicle || (links.length < 2 ? plan.vehicleId : 0);
  if (!vehicleId) return c.json({ error: "Choose the vehicle being serviced." }, 422);
  const completed = db.transaction((tx) => advanceSchedule(tx, planId, vehicleId, parsed.data.serviceDate, parsed.data.mileage, parsed.data.nextDueDate, parsed.data.nextDueMileage));
  return c.json(completed);
});

async function validateDocumentLinks(vehicleId: number | null, maintenanceId: number | null, projectId: number | null = null, insurancePolicyId: number | null = null) {
  if (vehicleId != null) {
    const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
    if (!vehicle) return "Vehicle not found.";
  }
  if (maintenanceId != null) {
    const [record] = await db.select({ vehicleId: maintenanceRecords.vehicleId }).from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).limit(1);
    if (!record) return "Maintenance record not found.";
    if (record.vehicleId !== vehicleId) return "The maintenance record belongs to a different vehicle.";
  }
  if (projectId != null) {
    const [project] = await db.select({ vehicleId: projects.vehicleId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return "Project not found.";
    if (project.vehicleId !== vehicleId) return "The project belongs to a different vehicle.";
  }
  if (insurancePolicyId != null) {
    const [policy] = await db.select({ id: insurancePolicies.id }).from(insurancePolicies).where(eq(insurancePolicies.id, insurancePolicyId)).limit(1);
    if (!policy) return "Insurance policy not found.";
    if (vehicleId != null || maintenanceId != null || projectId != null) return "An insurance document cannot also be attached to a vehicle, maintenance record, or project.";
  }
  return null;
}

function documentMaintenanceIds(value: unknown, fallback: number | null = null): number[] {
  if (value == null || value === "") return fallback ? [fallback] : [];
  let candidate: unknown = value;
  if (typeof value === "string") {
    try { candidate = JSON.parse(value); } catch { candidate = value.split(","); }
  }
  const values: unknown[] = Array.isArray(candidate) ? candidate : [candidate];
  return [...new Set(values.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

async function validateDocumentMaintenanceLinks(vehicleId: number | null, maintenanceIds: number[]) {
  if (!maintenanceIds.length) return null;
  if (vehicleId == null) return "Choose a vehicle before linking maintenance records.";
  const records = await db.select({ id: maintenanceRecords.id, vehicleId: maintenanceRecords.vehicleId }).from(maintenanceRecords).where(inArray(maintenanceRecords.id, maintenanceIds));
  if (records.length !== maintenanceIds.length) return "One or more maintenance records could not be found.";
  if (records.some((record) => record.vehicleId !== vehicleId)) return "Every linked maintenance record must belong to the selected vehicle.";
  return null;
}

function replaceDocumentMaintenanceLinks(tx: any, documentId: number, maintenanceIds: number[]) {
  const existing = new Map(tx.select({ maintenanceId: documentMaintenanceLinks.maintenanceId, position: documentMaintenanceLinks.position }).from(documentMaintenanceLinks).where(eq(documentMaintenanceLinks.documentId, documentId)).all().map((row: { maintenanceId: number; position: number }) => [row.maintenanceId, row.position]));
  tx.delete(documentMaintenanceLinks).where(eq(documentMaintenanceLinks.documentId, documentId)).run();
  const nextByMaintenance = new Map<number, number>();
  if (maintenanceIds.length) tx.insert(documentMaintenanceLinks).values(maintenanceIds.map((maintenanceId) => {
    const currentPosition = existing.get(maintenanceId);
    if (currentPosition != null) return { documentId, maintenanceId, position: currentPosition };
    const next = nextByMaintenance.get(maintenanceId) ?? nextMaintenanceEvidencePosition(tx, maintenanceId);
    nextByMaintenance.set(maintenanceId, next + 1);
    return { documentId, maintenanceId, position: next };
  })).run();
}

app.put("/api/maintenance/:id/evidence-order", async (c) => {
  const maintenanceId = Number(c.req.param("id"));
  const parsed = z.object({ documentIds: z.array(z.coerce.number().int().positive()).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!Number.isInteger(maintenanceId) || !parsed.success || new Set(parsed.data.documentIds).size !== parsed.data.documentIds.length) return c.json({ error: "Choose a valid evidence order." }, 422);
  const [record] = await db.select({ id: maintenanceRecords.id }).from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).limit(1);
  if (!record) return c.json({ error: "Maintenance record not found." }, 404);
  const links = await db.select({ documentId: documentMaintenanceLinks.documentId, position: documentMaintenanceLinks.position }).from(documentMaintenanceLinks).where(eq(documentMaintenanceLinks.maintenanceId, maintenanceId)).orderBy(asc(documentMaintenanceLinks.position), asc(documentMaintenanceLinks.documentId));
  const linkedIds = new Set(links.map((link) => link.documentId));
  if (parsed.data.documentIds.some((documentId) => !linkedIds.has(documentId))) return c.json({ error: "Every file in the new order must be attached to this maintenance record." }, 422);
  const requested = new Set(parsed.data.documentIds);
  const orderedIds = [...parsed.data.documentIds, ...links.filter((link) => !requested.has(link.documentId)).map((link) => link.documentId)];
  db.transaction((tx) => {
    const changed = orderedIds.some((documentId, position) => links[position]?.documentId !== documentId);
    if (!changed) return;
    for (const [position, documentId] of orderedIds.entries()) tx.update(documentMaintenanceLinks).set({ position }).where(and(eq(documentMaintenanceLinks.documentId, documentId), eq(documentMaintenanceLinks.maintenanceId, maintenanceId))).run();
    const current = tx.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, maintenanceId)).get();
    if (current) tx.insert(maintenanceAuditLogs).values({ maintenanceId, operation: "Updated", summary: `Reordered ${orderedIds.length} evidence attachment${orderedIds.length === 1 ? "" : "s"}.`, afterJson: maintenanceSnapshot(tx, current) }).run();
  });
  return c.json({ ok: true, documentIds: orderedIds });
});

app.post("/api/documents", async (c) => {
  const body = await c.req.parseBody();
  const vehicleId = body.vehicleId ? Number(body.vehicleId) : null;
  const maintenanceId = body.maintenanceId ? Number(body.maintenanceId) : null;
  const maintenanceIds = documentMaintenanceIds(body.maintenanceIds, maintenanceId);
  const insurancePolicyId = body.insurancePolicyId ? Number(body.insurancePolicyId) : null;
  const kind = String(body.kind || "Other") as "Manual" | "Receipt" | "Photo" | "Registration" | "Insurance" | "Other";
  const displayName = String(body.name || "").trim();
  const notes = String(body.notes || "").trim();
  if ((vehicleId != null && (!Number.isInteger(vehicleId) || vehicleId < 1)) || (maintenanceId != null && (!Number.isInteger(maintenanceId) || maintenanceId < 1)) || (insurancePolicyId != null && (!Number.isInteger(insurancePolicyId) || insurancePolicyId < 1)) || (vehicleId == null && insurancePolicyId == null)) return c.json({ error: "Choose a valid vehicle or insurance policy for this document." }, 422);
  if (!kind.trim() || kind.length > 80) return c.json({ error: "Choose a valid document type." }, 422);
  if (displayName.length > 240 || notes.length > 10000) return c.json({ error: "Check the document display name and notes." }, 422);
  const relationshipError = await validateDocumentLinks(vehicleId, maintenanceIds[0] ?? null, null, insurancePolicyId) ?? await validateDocumentMaintenanceLinks(vehicleId, maintenanceIds);
  if (relationshipError) return c.json({ error: relationshipError }, 422);
  const file = body.file as File;
  let storagePath = "";
  try {
    storagePath = await saveUpload(file);
    const [created] = db.transaction((tx) => {
      const rows = tx.insert(documents).values({
        trackingId: crypto.randomUUID(),
        originalName: file.name.slice(0, 240),
        vehicleId,
        maintenanceId: maintenanceIds[0] ?? null,
        insurancePolicyId,
        kind,
        name: (displayName || file.name).slice(0, 240),
        notes: notes || null,
        storagePath,
        mimeType: file.type.split(";", 1)[0].toLowerCase(),
        sizeBytes: file.size,
      }).returning().all();
      replaceDocumentMaintenanceLinks(tx, rows[0].id, maintenanceIds);
      return rows;
    });
    return c.json(created, 201);
  } catch (error) {
    await removeStoredFile(storagePath);
    return c.json({ error: error instanceof Error ? error.message : "The document could not be uploaded." }, 422);
  }
});

app.get("/api/documents", async (c) => {
  const vehicleId = Number(c.req.query("vehicleId"));
  const insurancePolicyId = Number(c.req.query("insurancePolicyId"));
  const kind = c.req.query("kind");
  const category = c.req.query("category");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const filters = [
    Number.isInteger(vehicleId) ? eq(documents.vehicleId, vehicleId) : undefined,
    Number.isInteger(insurancePolicyId) ? eq(documents.insurancePolicyId, insurancePolicyId) : undefined,
    kind ? eq(documents.kind, kind) : undefined,
  ].filter(Boolean);
  const rows = await db.select({
    id: documents.id,
    vehicleId: documents.vehicleId,
    maintenanceId: documents.maintenanceId,
    projectId: documents.projectId,
    insurancePolicyId: documents.insurancePolicyId,
    kind: documents.kind,
    notes: documents.notes,
    name: documents.name,
    mimeType: documents.mimeType,
    sizeBytes: documents.sizeBytes,
    createdAt: documents.createdAt,
    vehicleName: sql<string>`${vehicles.year} || ' ' || ${vehicles.make} || ' ' || ${vehicles.model}`,
    maintenanceTitle: maintenanceRecords.title,
    maintenanceCategory: maintenanceRecords.category,
    serviceDate: maintenanceRecords.serviceDate,
    insuranceProvider: insurancePolicies.provider,
    insurancePolicyNumber: insurancePolicies.policyNumber,
  }).from(documents)
    .leftJoin(vehicles, eq(documents.vehicleId, vehicles.id))
    .leftJoin(maintenanceRecords, eq(documents.maintenanceId, maintenanceRecords.id))
    .leftJoin(insurancePolicies, eq(documents.insurancePolicyId, insurancePolicies.id))
    .where(filters.length ? and(...(filters as Parameters<typeof and>)) : undefined)
    .orderBy(desc(documents.createdAt));
  const linkedRows = await db.select({ documentId: documentMaintenanceLinks.documentId, position: documentMaintenanceLinks.position, id: maintenanceRecords.id, vehicleId: maintenanceRecords.vehicleId, title: maintenanceRecords.title, category: maintenanceRecords.category, serviceDate: maintenanceRecords.serviceDate })
    .from(documentMaintenanceLinks)
    .innerJoin(maintenanceRecords, eq(documentMaintenanceLinks.maintenanceId, maintenanceRecords.id))
    .orderBy(desc(maintenanceRecords.serviceDate), desc(maintenanceRecords.id), asc(documentMaintenanceLinks.position));
  const enriched = rows.map((row) => {
    const linked = linkedRows.filter((link) => link.documentId === row.id).map(({ documentId: _documentId, ...link }) => link);
    const primary = linked.find((link) => link.id === row.maintenanceId) ?? linked[0];
    const maintenanceLinks = primary ? [primary, ...linked.filter((link) => link.id !== primary.id)] : linked;
    return {
      ...row,
      maintenanceId: primary?.id ?? row.maintenanceId,
      maintenanceTitle: primary?.title ?? row.maintenanceTitle,
      maintenanceCategory: primary?.category ?? row.maintenanceCategory,
      serviceDate: primary?.serviceDate ?? row.serviceDate,
      maintenanceIds: maintenanceLinks.length ? maintenanceLinks.map((link) => link.id) : row.maintenanceId ? [row.maintenanceId] : [],
      maintenanceRecords: maintenanceLinks.length ? maintenanceLinks : row.maintenanceId ? [{ id: row.maintenanceId, vehicleId: row.vehicleId, title: row.maintenanceTitle ?? "Maintenance record", category: row.maintenanceCategory ?? "Other", serviceDate: row.serviceDate ?? "" }] : [],
    };
  }).filter((row) => {
    const dates = row.maintenanceRecords.map((record) => record.serviceDate).filter(Boolean);
    const effectiveDates = dates.length ? dates : [row.createdAt.slice(0, 10)];
    return (!category || row.maintenanceRecords.some((record) => record.category === category))
      && (!from || effectiveDates.some((date) => date >= from))
      && (!to || effectiveDates.some((date) => date <= to));
  });
  return c.json(enriched);
});

app.get("/api/documents/:id/file", async (c) => {
  const documentId = Number(c.req.param("id"));
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document) return c.json({ error: "Document not found." }, 404);
  const filePath = resolve(document.storagePath); const rel = relative(uploadDirectory, filePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return c.json({ error: "Invalid document path." }, 404);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return c.json({ error: "Document file is missing." }, 404);
  const preview = c.req.query("preview") === "1";
  const editor = c.req.query("editor") === "1";
  const normalized = c.req.query("normalized") === "1";
  if (document.mimeType?.startsWith("image/") && (preview || editor || normalized || (document.photoRotation && c.req.query("original") !== "1"))) {
    const derivativeSize = preview ? 640 : editor ? 1600 : 0;
    try { return photoResponse(await photoBytes(filePath, document.photoRotation, derivativeSize), derivativeSize > 0, c.req.header("If-None-Match")); }
    catch { return c.json({ error: "This photo could not be decoded." }, 422); }
  }
  return new Response(file, { headers: { "Content-Type": document.mimeType || file.type || "application/octet-stream", "Content-Disposition": `inline; filename*=UTF-8\'\'${encodeURIComponent(document.name)}` } });
});

app.put("/api/documents/:id", async (c) => {
  const id = Number(c.req.param("id")); const parsed = z.object({ notes: z.string().max(10000).optional(), name: z.string().trim().min(1).max(240), kind: z.string().trim().min(1).max(80), vehicleId: z.union([z.coerce.number().int().positive(), z.null()]), maintenanceId: z.union([z.coerce.number().int().positive(), z.null()]).optional(), maintenanceIds: z.array(z.coerce.number().int().positive()).max(500).optional(), projectId: z.union([z.coerce.number().int().positive(), z.null()]).optional(), insurancePolicyId: z.union([z.coerce.number().int().positive(), z.null()]).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the document details and try again." }, 422);
  const [existing] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!existing) return c.json({ error: "Document not found." }, 404);
  const existingLinks = db.select({ maintenanceId: documentMaintenanceLinks.maintenanceId }).from(documentMaintenanceLinks).where(eq(documentMaintenanceLinks.documentId, id)).all().map((row) => row.maintenanceId);
  const maintenanceIds = parsed.data.maintenanceIds ?? (parsed.data.maintenanceId !== undefined ? documentMaintenanceIds(parsed.data.maintenanceId) : existingLinks.length ? existingLinks : documentMaintenanceIds(existing.maintenanceId));
  const links = { maintenanceId: maintenanceIds[0] ?? null, projectId: parsed.data.projectId === undefined ? existing.projectId : parsed.data.projectId, insurancePolicyId: parsed.data.insurancePolicyId === undefined ? existing.insurancePolicyId : parsed.data.insurancePolicyId };
  const relationshipError = await validateDocumentLinks(parsed.data.vehicleId, links.maintenanceId, links.projectId, links.insurancePolicyId) ?? await validateDocumentMaintenanceLinks(parsed.data.vehicleId, maintenanceIds);
  if (relationshipError) return c.json({ error: relationshipError }, 422);
  const { maintenanceIds: _maintenanceIds, ...documentChanges } = parsed.data;
  const [updated] = db.transaction((tx) => {
    const rows = tx.update(documents).set({ ...documentChanges, kind: parsed.data.kind, maintenanceId: links.maintenanceId, projectId: links.projectId, insurancePolicyId: links.insurancePolicyId, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(documents.id, id)).returning().all();
    if (rows[0]) replaceDocumentMaintenanceLinks(tx, id, maintenanceIds);
    return rows;
  });
  return updated ? c.json(updated) : c.json({ error: "Document not found." }, 404);
});

app.delete("/api/documents/:id", async (c) => {
  const id = Number(c.req.param("id")); const [document] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!document) return c.json({ error: "Document not found." }, 404);
  await db.delete(documents).where(eq(documents.id, id));
  await removeStoredFile(document.storagePath);
  return c.json({ ok: true });
});

app.get("/api/vehicles/:id/service-plans", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const plans = (await db.select({ plan: servicePlans }).from(servicePlanVehicles).innerJoin(servicePlans, eq(servicePlanVehicles.servicePlanId, servicePlans.id)).where(eq(servicePlanVehicles.vehicleId, vehicleId)).orderBy(asc(servicePlans.nextDueMileage), asc(servicePlans.nextDueDate))).map(({ plan }) => plan);
  return c.json(await Promise.all(plans.map(async (plan) => ({
    ...plan,
    vehicleIds: await servicePlanVehicleIds(plan.id),
    items: await db.select().from(servicePlanItems).where(eq(servicePlanItems.servicePlanId, plan.id)).orderBy(asc(servicePlanItems.position)),
  }))));
});

app.post("/api/vehicles/:id/service-plans", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  if (!vehicle) return c.json({ error: "Vehicle not found." }, 404);
  const parsed = servicePlanInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the maintenance task and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const input = parsed.data;
  const vehicleIds = input.vehicleIds?.length ? input.vehicleIds : [vehicleId];
  if (!await selectedVehiclesExist(vehicleIds)) return c.json({ error: "Choose at least one vehicle that is still in your garage." }, 422);
  const plan = db.transaction((tx) => {
    const [created] = tx.insert(servicePlans).values({
      vehicleId: vehicleIds[0],
      title: input.title,
      category: input.category,
      intervalMileage: input.intervalMileage ?? null,
      intervalMonths: input.intervalMonths ?? null,
      nextDueMileage: input.nextDueMileage ?? null,
      nextDueDate: input.nextDueDate ?? null,
      notes: input.notes || null,
      active: input.active,
    }).returning().all();
    if (input.sourceMaintenanceId) {
      const source = tx.select().from(maintenanceRecords).where(eq(maintenanceRecords.id, input.sourceMaintenanceId)).get();
      if (!source || source.vehicleId !== vehicleId || (!source.nextDueDate && source.nextDueMileage == null)) throw new WorkflowConflict("This follow-up is no longer available. Refresh before converting.");
      tx.update(maintenanceRecords).set({ nextDueDate: null, nextDueMileage: null }).where(eq(maintenanceRecords.id, source.id)).run();
      tx.delete(reminders).where(and(eq(reminders.maintenanceId, source.id), eq(reminders.status, "Active"))).run();
    }
    tx.insert(servicePlanVehicles).values(vehicleIds.map((linkedVehicleId) => ({ servicePlanId: created.id, vehicleId: linkedVehicleId }))).run();
    if (input.items.length) tx.insert(servicePlanItems).values(input.items.map((title, position) => ({ servicePlanId: created.id, title, position }))).run();
    if (input.createReminder && (input.nextDueDate || input.nextDueMileage != null)) tx.insert(reminders).values(vehicleIds.map((linkedVehicleId) => ({ vehicleId: linkedVehicleId, servicePlanId: created.id, title: input.title, dueDate: input.nextDueDate ?? null, dueMileage: input.nextDueMileage ?? null }))).run();
    return created;
  });
  return c.json({ ...plan, vehicleIds, items: await db.select().from(servicePlanItems).where(eq(servicePlanItems.servicePlanId, plan.id)).orderBy(asc(servicePlanItems.position)) }, 201);
});

app.put("/api/service-plans/:id", async (c) => {
  const planId = Number(c.req.param("id")); const parsed = servicePlanInput.extend({ active: z.boolean().default(true) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the maintenance task and try again.", fields: z.flattenError(parsed.error).fieldErrors }, 422);
  const [existing] = await db.select().from(servicePlans).where(eq(servicePlans.id, planId)).limit(1); if (!existing) return c.json({ error: "Maintenance task not found." }, 404);
  const input = parsed.data;
  const existingVehicleIds = await servicePlanVehicleIds(planId);
  const vehicleIds = input.vehicleIds?.length ? input.vehicleIds : (existingVehicleIds.length ? existingVehicleIds : [existing.vehicleId]);
  if (!await selectedVehiclesExist(vehicleIds)) return c.json({ error: "Choose at least one vehicle that is still in your garage." }, 422);
  db.transaction((tx) => { const hadLinkedReminder = Boolean(tx.select({ id: reminders.id }).from(reminders).where(and(eq(reminders.servicePlanId, planId), eq(reminders.status, "Active"))).get());
    tx.update(servicePlans).set({ vehicleId: vehicleIds[0], title: input.title, category: input.category, intervalMileage: input.intervalMileage ?? null, intervalMonths: input.intervalMonths ?? null, nextDueMileage: input.nextDueMileage ?? null, nextDueDate: input.nextDueDate ?? null, notes: input.notes || null, active: input.active, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(servicePlans.id, planId)).run();
    tx.delete(servicePlanVehicles).where(eq(servicePlanVehicles.servicePlanId, planId)).run(); tx.insert(servicePlanVehicles).values(vehicleIds.map((linkedVehicleId) => ({ servicePlanId: planId, vehicleId: linkedVehicleId }))).run();
    tx.delete(servicePlanItems).where(eq(servicePlanItems.servicePlanId, planId)).run(); if (input.items.length) tx.insert(servicePlanItems).values(input.items.map((title, position) => ({ servicePlanId: planId, title, position }))).run();
    tx.delete(reminders).where(and(eq(reminders.servicePlanId, planId), eq(reminders.status, "Active"))).run();
    if ((input.createReminder || hadLinkedReminder) && input.active && (input.nextDueDate || input.nextDueMileage != null)) tx.insert(reminders).values(vehicleIds.map((linkedVehicleId) => ({ vehicleId: linkedVehicleId, servicePlanId: planId, title: input.title, dueDate: input.nextDueDate ?? null, dueMileage: input.nextDueMileage ?? null }))).run();
  });
  return c.json({ ...(await db.select().from(servicePlans).where(eq(servicePlans.id, planId)).limit(1))[0], vehicleIds, items: await db.select().from(servicePlanItems).where(eq(servicePlanItems.servicePlanId, planId)).orderBy(asc(servicePlanItems.position)) });
});

app.delete("/api/service-plans/:id", async (c) => { const planId = Number(c.req.param("id")); const deleted = db.transaction((tx) => { tx.delete(reminders).where(eq(reminders.servicePlanId, planId)).run(); return tx.delete(servicePlans).where(eq(servicePlans.id, planId)).returning().get(); }); return deleted ? c.json({ ok: true }) : c.json({ error: "Maintenance task not found." }, 404); });

app.get("/api/vehicles/:id/reminders", async (c) => {
  const vehicleId = Number(c.req.param("id"));
  return c.json(await db.select().from(reminders).where(eq(reminders.vehicleId, vehicleId)).orderBy(asc(reminders.status), asc(reminders.dueDate), asc(reminders.dueMileage)));
});

app.patch("/api/reminders/:id", async (c) => {
  const reminderId = Number(c.req.param("id"));
  const parsed = z.object({ status: z.enum(["Active", "Completed", "Dismissed"]) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose a valid reminder status." }, 422);
  const existing = db.select().from(reminders).where(eq(reminders.id, reminderId)).get();
  if (!existing) return c.json({ error: "Reminder not found." }, 404);
  const updated = db.transaction((tx) => {
    const row = tx.update(reminders).set({ status: parsed.data.status, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(reminders.id, reminderId)).returning().get();
    if (parsed.data.status !== "Active" && existing.maintenanceId) {
      tx.update(maintenanceRecords).set({ nextDueDate: null, nextDueMileage: null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(maintenanceRecords.id, existing.maintenanceId), eq(maintenanceRecords.vehicleId, existing.vehicleId))).run();
    }
    if (parsed.data.status === "Completed" && existing.status === "Active" && existing.servicePlanId) {
      const plan = vehicleSchedule(tx, existing.servicePlanId, existing.vehicleId);
      const vehicle = tx.select().from(vehicles).where(eq(vehicles.id, existing.vehicleId)).get();
      if (plan?.active && vehicle) {
        let nextDueDate: string | null = null;
        if (plan.intervalMonths) {
          const date = new Date(); const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + plan.intervalMonths);
          const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
          date.setUTCDate(Math.min(day, last)); nextDueDate = date.toISOString().slice(0, 10);
        }
        const nextDueMileage = plan.intervalMileage ? vehicle.mileage + plan.intervalMileage : null;
        tx.update(servicePlans).set({ nextDueDate, nextDueMileage, active: Boolean(nextDueDate || nextDueMileage != null), updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(servicePlans.id, plan.id)).run();
        if (nextDueDate || nextDueMileage != null) tx.insert(reminders).values({ vehicleId: vehicle.id, servicePlanId: plan.id, title: plan.title, dueDate: nextDueDate, dueMileage: nextDueMileage }).run();
      }
    }
    return row;
  });
  return c.json(updated);
});

async function validReminderPlan(vehicleId: number, servicePlanId: number | null | undefined) {
  if (!db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).get()) return false;
  return servicePlanId == null || Boolean(db.select().from(servicePlanVehicles).where(and(eq(servicePlanVehicles.servicePlanId, servicePlanId), eq(servicePlanVehicles.vehicleId, vehicleId))).get());
}
app.post("/api/vehicles/:id/reminders", async (c) => {
  const vehicleId = Number(c.req.param("id")); const parsed = reminderInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the reminder details and try again." }, 422);
  if (!(await validReminderPlan(vehicleId, parsed.data.servicePlanId))) return c.json({ error: "Choose a service plan belonging to this vehicle." }, 422);
  const [created] = await db.insert(reminders).values({ vehicleId, ...parsed.data, dueDate: parsed.data.dueDate ?? null, dueMileage: parsed.data.dueMileage ?? null, servicePlanId: parsed.data.servicePlanId ?? null, notes: parsed.data.notes || null }).returning(); return c.json(created, 201);
});
app.put("/api/reminders/:id", async (c) => {
  const id = Number(c.req.param("id")); const parsed = reminderInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the reminder details and try again." }, 422);
  const existing = db.select().from(reminders).where(eq(reminders.id, id)).get(); if (!existing) return c.json({ error: "Reminder not found." }, 404);
  if (!(await validReminderPlan(existing.vehicleId, parsed.data.servicePlanId))) return c.json({ error: "Choose a service plan belonging to this vehicle." }, 422);
  const [updated] = await db.update(reminders).set({ ...parsed.data, dueDate: parsed.data.dueDate ?? null, dueMileage: parsed.data.dueMileage ?? null, servicePlanId: parsed.data.servicePlanId ?? null, notes: parsed.data.notes || null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(reminders.id, id)).returning(); return c.json(updated);
});
app.delete("/api/reminders/:id", async (c) => { const [deleted] = await db.delete(reminders).where(eq(reminders.id, Number(c.req.param("id")))).returning(); return deleted ? c.json({ ok: true }) : c.json({ error: "Reminder not found." }, 404); });

app.get("/api/alerts", async (c) => {
  const vehicleId = Number(c.req.query("vehicleId")); const today = new Date(); const inDays = (date: string) => Math.ceil((new Date(`${date}T12:00:00Z`).getTime() - today.getTime()) / 86_400_000);
  const vehicleRows = await db.select().from(vehicles).where(Number.isInteger(vehicleId) ? eq(vehicles.id, vehicleId) : undefined);
  const result: Array<{ id: string; vehicleId: number; kind: string; title: string; detail: string; severity: "overdue" | "due" | "info" }> = [];
  const insuranceLinks = await db.select().from(insurancePolicyVehicles).where(Number.isInteger(vehicleId) ? eq(insurancePolicyVehicles.vehicleId, vehicleId) : undefined);
  const policyIds = [...new Set(insuranceLinks.map((link) => link.insurancePolicyId))];
  const policyRows = policyIds.length ? await db.select().from(insurancePolicies).where(inArray(insurancePolicies.id, policyIds)) : [];
  for (const vehicle of vehicleRows) {
    for (const policy of policyRows.filter((policy) => insuranceLinks.some((link) => link.vehicleId === vehicle.id && link.insurancePolicyId === policy.id))) if (policy.expiresAt) { const days = inDays(policy.expiresAt); if (days <= 90) result.push({ id: `Insurance-${policy.id}-${vehicle.id}`, vehicleId: vehicle.id, kind: "Insurance", title: `Insurance ${days < 0 ? "expired" : "expires soon"}`, detail: `${vehicle.year} ${vehicle.make} ${vehicle.model} · ${policy.provider}${policy.policyNumber ? ` · ${policy.policyNumber}` : ""} · ${policy.expiresAt}${days >= 0 ? ` · ${days} days` : ` · ${Math.abs(days)} days overdue`}`, severity: days < 0 ? "overdue" : "due" }); }
    if (vehicle.registrationExpiresAt) { const days = inDays(vehicle.registrationExpiresAt); if (days <= 90) result.push({ id: `Registration-${vehicle.id}`, vehicleId: vehicle.id, kind: "Registration", title: `Registration ${days < 0 ? "expired" : "expires soon"}`, detail: `${vehicle.year} ${vehicle.make} ${vehicle.model} · ${vehicle.registrationExpiresAt}${days >= 0 ? ` · ${days} days` : ` · ${Math.abs(days)} days overdue`}`, severity: days < 0 ? "overdue" : "due" }); }
  }
  const reminderRows = await db.select().from(reminders).where(and(Number.isInteger(vehicleId) ? eq(reminders.vehicleId, vehicleId) : undefined, eq(reminders.status, "Active")));
  const pausedPlanIds = new Set((await db.select({ id: servicePlans.id }).from(servicePlans).where(eq(servicePlans.active, false))).map((plan) => plan.id));
  for (const reminder of reminderRows) { if (reminder.servicePlanId && pausedPlanIds.has(reminder.servicePlanId)) continue; const vehicle = vehicleRows.find((row) => row.id === reminder.vehicleId); if (!vehicle) continue; const dateOver = reminder.dueDate ? inDays(reminder.dueDate) < 0 : false; const mileageOver = reminder.dueMileage != null ? vehicle.mileage >= reminder.dueMileage : false; result.push({ id: `Reminder-${reminder.id}`, vehicleId: reminder.vehicleId, kind: "Maintenance", title: reminder.title, detail: [reminder.dueDate && `Due ${reminder.dueDate}`, reminder.dueMileage != null && `Due at ${reminder.dueMileage.toLocaleString()} mi`].filter(Boolean).join(" · ") || "No due point", severity: dateOver || mileageOver ? "overdue" : "info" }); }
  return c.json(result);
});

installBackupRoutes(app);
installReadableExportRoutes(app);

app.get("/api/export/maintenance.csv", async (c) => {
  const rows = await db
    .select({
      vehicle: sql<string>`${vehicles.year} || ' ' || ${vehicles.make} || ' ' || ${vehicles.model}`,
      title: maintenanceRecords.title,
      category: maintenanceRecords.category,
      serviceDate: maintenanceRecords.serviceDate,
      mileage: maintenanceRecords.mileage,
      costCents: maintenanceRecords.costCents,
      laborHours: maintenanceRecords.laborHours,
      difficulty: maintenanceRecords.difficulty,
      notes: maintenanceRecords.notes,
    })
    .from(maintenanceRecords)
    .innerJoin(vehicles, eq(maintenanceRecords.vehicleId, vehicles.id))
    .orderBy(desc(maintenanceRecords.serviceDate));

  const escape = escapeCsv;
  const header = ["vehicle", "title", "category", "service_date", "mileage", "cost", "labor_hours", "difficulty", "notes"];
  const csv = [
    header.join(","),
    ...rows.map((row) =>
      [row.vehicle, row.title, row.category, row.serviceDate, row.mileage, (row.costCents / 100).toFixed(2), row.laborHours, row.difficulty, row.notes]
        .map(escape)
        .join(","),
    ),
  ].join("\n");

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="sumplog-maintenance-${new Date().toISOString().slice(0, 10)}.csv"`);
  return c.body(csv);
});

app.get("/api/export/all.csv", async (c) => {
  const vehicleRows = await db.select().from(vehicles); const vehicleName = (id: number | null) => { const row = vehicleRows.find((vehicle) => vehicle.id === id); return row ? `${row.year} ${row.make} ${row.model}` : "General"; };
  const [maintenanceRows, partRows, mileageRows, specRows, projectRows, documentRows, reminderRows] = await Promise.all([db.select().from(maintenanceRecords), db.select().from(parts), db.select().from(mileageEntries), db.select().from(referenceSpecs), db.select().from(projects), db.select().from(documents), db.select().from(reminders)]);
  const records: unknown[][] = [];
  for (const row of vehicleRows) records.push(["vehicle", vehicleName(row.id), row.purchaseDate, "Fleet", row.nickname || vehicleName(row.id), row.mileage, [
    `VIN: ${row.vin || ""}`, `trim: ${row.trim || ""}`, `color: ${row.color || ""}`, `body: ${row.bodyStyle || ""}`,
    `fuel: ${row.fuelType || ""}`, `drivetrain: ${row.drivetrain || ""}`, `engine: ${row.engine || ""}`, `transmission: ${row.transmission || ""}`,
    `annual mileage: ${row.annualMileageEstimate ?? ""}`, `plate: ${row.licensePlate || ""}`, `registration state: ${row.registrationState || ""}`,
    `registration number: ${row.registrationNumber || ""}`, `registration expires: ${row.registrationExpiresAt || ""}`, `purchase price: ${row.purchasePriceCents == null ? "" : (row.purchasePriceCents / 100).toFixed(2)}`,
    `insurance provider: ${row.insuranceProvider || ""}`, `policy: ${row.insurancePolicyNumber || ""}`, `agent: ${row.insuranceAgentName || ""}`,
    `agent phone: ${row.insuranceAgentPhone || ""}`, `policy effective: ${row.insuranceEffectiveAt || ""}`, `policy expires: ${row.insuranceExpiresAt || ""}`,
    `premium: ${row.insurancePremiumCents == null ? "" : (row.insurancePremiumCents / 100).toFixed(2)}`, `insurance notes: ${row.insuranceNotes || ""}`, `vehicle notes: ${row.notes || ""}`,
  ].join("; ")]);
  for (const row of maintenanceRows) records.push(["maintenance", vehicleName(row.vehicleId), row.serviceDate, row.category, row.title, (row.costCents / 100).toFixed(2), row.notes]);
  for (const row of partRows) records.push(["part", "General", "", row.manufacturer || "Parts", `${row.partNumber} · ${row.name}`, row.quantity, row.storageLocation]);
  for (const row of mileageRows) records.push(["mileage", vehicleName(row.vehicleId), row.recordedDate, "Odometer", "Mileage reading", row.mileage, row.notes]);
  for (const row of specRows) records.push(["specification", vehicleName(row.vehicleId), "", row.groupName, row.label, row.value, row.source]);
  for (const row of projectRows) records.push(["project", vehicleName(row.vehicleId), row.targetDate, row.status, row.title, (row.actualCostCents / 100).toFixed(2), row.description]);
  for (const row of documentRows) records.push(["document", vehicleName(row.vehicleId), row.createdAt.slice(0, 10), row.kind, row.name, row.sizeBytes, ""]);
  for (const row of reminderRows) records.push(["reminder", vehicleName(row.vehicleId), row.dueDate, row.status, row.title, row.dueMileage, row.notes]);
  const escape = escapeCsv;
  const csv = [["record_type", "vehicle", "date", "category", "name", "value", "notes"], ...records].map((row) => row.map(escape).join(",")).join("\n");
  c.header("Content-Type", "text/csv; charset=utf-8"); c.header("Content-Disposition", `attachment; filename="sumplog-full-${new Date().toISOString().slice(0, 10)}.csv"`); return c.body(csv);
});

app.use("/assets/*", serveStatic({ root: "./dist" }));
app.use("/sumplog-mark.svg", serveStatic({ path: "./dist/sumplog-mark.svg" }));
app.all("/api/*", (c) => c.json({ error: "API route not found." }, 404));
app.get("*", serveStatic({ path: "./dist/index.html" }));

export default app;
