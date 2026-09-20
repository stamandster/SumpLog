import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

/** Single-owner credentials for self-hosted garages. Future multi-user plans use a separate identity model. */
export const ownerCredentials = sqliteTable("owner_credentials", {
  id: integer("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const vehicles = sqliteTable(
  "vehicles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vin: text("vin").unique(),
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim"),
    nickname: text("nickname"),
    mileage: integer("mileage").notNull().default(0),
    color: text("color"),
    bodyStyle: text("body_style"),
    fuelType: text("fuel_type"),
    drivetrain: text("drivetrain"),
    engine: text("engine"),
    transmission: text("transmission"),
    licensePlate: text("license_plate"),
    registrationState: text("registration_state"),
    registrationNumber: text("registration_number"),
    purchaseDate: text("purchase_date"),
    purchasePriceCents: integer("purchase_price_cents"),
    insuranceProvider: text("insurance_provider"),
    insurancePolicyNumber: text("insurance_policy_number"),
    insuranceAgentName: text("insurance_agent_name"),
    insuranceAgentPhone: text("insurance_agent_phone"),
    insuranceEffectiveAt: text("insurance_effective_at"),
    insuranceExpiresAt: text("insurance_expires_at"),
    insurancePremiumCents: integer("insurance_premium_cents"),
    insuranceNotes: text("insurance_notes"),
    registrationExpiresAt: text("registration_expires_at"),
    imageUrl: text("image_url"),
    photoRotation: integer("photo_rotation").notNull().default(0),
    photoZoom: real("photo_zoom").notNull().default(1),
    photoPositionX: integer("photo_position_x").notNull().default(50),
    photoPositionY: integer("photo_position_y").notNull().default(50),
    annualMileageEstimate: integer("annual_mileage_estimate"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [index("vehicles_make_model_idx").on(table.make, table.model)],
);

export const maintenanceRecords = sqliteTable(
  "maintenance_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    serviceDate: text("service_date").notNull(),
    mileage: integer("mileage").notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    laborHours: real("labor_hours").notNull().default(0),
    difficulty: integer("difficulty").notNull().default(1),
    shopName: text("shop_name"),
    notes: text("notes"),
    nextDueDate: text("next_due_date"),
    nextDueMileage: integer("next_due_mileage"),
    voidedAt: text("voided_at"),
    submissionKey: text("submission_key").unique(),
    ...timestamps,
  },
  (table) => [
    index("maintenance_vehicle_date_idx").on(table.vehicleId, table.serviceDate),
    index("maintenance_vehicle_mileage_idx").on(table.vehicleId, table.mileage),
  ],
);

export const parts = sqliteTable(
  "parts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    partNumber: text("part_number").notNull(),
    itemType: text("item_type").notNull().default("Part"),
    category: text("category"),
    specifications: text("specifications"),
    approvals: text("approvals"),
    name: text("name").notNull(),
    manufacturer: text("manufacturer"),
    supplierName: text("supplier_name"),
    supplierUrl: text("supplier_url"),
    purchasePriceCents: integer("purchase_price_cents").notNull().default(0),
    // SQLite's INTEGER affinity preserves fractional values for partially used consumables.
    quantity: integer("quantity").notNull().default(0),
    volumePerUnit: real("volume_per_unit"),
    volumeUnit: text("volume_unit"),
    minimumQuantity: integer("minimum_quantity").notNull().default(0),
    storageLocation: text("storage_location"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("parts_number_manufacturer_idx").on(table.partNumber, table.manufacturer),
    index("parts_name_idx").on(table.name),
  ],
);

export const vehicleParts = sqliteTable(
  "vehicle_parts",
  {
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    fitmentNotes: text("fitment_notes"),
  },
  (table) => [primaryKey({ columns: [table.vehicleId, table.partId] })],
);

export const maintenanceParts = sqliteTable(
  "maintenance_parts",
  {
    maintenanceId: integer("maintenance_id")
      .notNull()
      .references(() => maintenanceRecords.id, { onDelete: "cascade" }),
    partId: integer("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "restrict" }),
    quantity: real("quantity").notNull().default(1),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    usageMode: text("usage_mode").notNull().default("Whole"),
    amountUsed: real("amount_used"),
    amountUnit: text("amount_unit"),
  },
  (table) => [primaryKey({ columns: [table.maintenanceId, table.partId] })],
);

export const referenceSpecs = sqliteTable(
  "reference_specs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    groupName: text("group_name").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    source: text("source"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("specs_vehicle_label_idx").on(table.vehicleId, table.groupName, table.label),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["Backlog", "Planned", "In Progress", "Waiting", "Done"],
    })
      .notNull()
      .default("Backlog"),
    estimatedBudgetCents: integer("estimated_budget_cents").notNull().default(0),
    actualCostCents: integer("actual_cost_cents").notNull().default(0),
    targetDate: text("target_date"),
    ...timestamps,
  },
  (table) => [index("projects_vehicle_status_idx").on(table.vehicleId, table.status)],
);

export const projectTasks = sqliteTable(
  "project_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (table) => [index("project_tasks_project_position_idx").on(table.projectId, table.position)],
);

/** Insurance is independent of a vehicle: deleting a vehicle only removes its link. */
export const insurancePolicies = sqliteTable(
  "insurance_policies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    policyNumber: text("policy_number"),
    agentName: text("agent_name"),
    agentPhone: text("agent_phone"),
    effectiveAt: text("effective_at"),
    expiresAt: text("expires_at"),
    premiumCents: integer("premium_cents"),
    notes: text("notes"),
    // Used only to make the one-time migration of old vehicle-owned policies unambiguous.
    legacySourceVehicleId: integer("legacy_source_vehicle_id").unique(),
    ...timestamps,
  },
  (table) => [index("insurance_policies_provider_idx").on(table.provider)],
);

export const insurancePolicyVehicles = sqliteTable(
  "insurance_policy_vehicles",
  {
    insurancePolicyId: integer("insurance_policy_id").notNull().references(() => insurancePolicies.id, { onDelete: "cascade" }),
    vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.insurancePolicyId, table.vehicleId] })],
);

export const documents = sqliteTable(
  "documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    maintenanceId: integer("maintenance_id").references(() => maintenanceRecords.id, {
      onDelete: "set null",
    }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    insurancePolicyId: integer("insurance_policy_id").references(() => insurancePolicies.id, { onDelete: "set null" }),
    kind: text("kind")
      .notNull()
      .default("Other"),
    trackingId: text("tracking_id"),
    originalName: text("original_name"),
    name: text("name").notNull(),
    storagePath: text("storage_path").notNull(),
    photoRotation: integer("photo_rotation").notNull().default(0),
    notes: text("notes"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    ...timestamps,
  },
  (table) => [index("documents_vehicle_kind_idx").on(table.vehicleId, table.kind), index("documents_insurance_policy_idx").on(table.insurancePolicyId), uniqueIndex("documents_tracking_id_unique").on(table.trackingId)],
);

/** A document is stored once and may be evidence for several maintenance records. */
export const documentMaintenanceLinks = sqliteTable(
  "document_maintenance_links",
  {
    documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    maintenanceId: integer("maintenance_id").notNull().references(() => maintenanceRecords.id, { onDelete: "cascade" }),
    /** Display/export order is scoped to this maintenance record. */
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.maintenanceId] }),
    index("document_maintenance_links_record_idx").on(table.maintenanceId, table.position, table.documentId),
  ],
);

export const mileageEntries = sqliteTable(
  "mileage_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
    recordedDate: text("recorded_date").notNull(),
    mileage: integer("mileage").notNull(),
    annualMileageEstimate: integer("annual_mileage_estimate"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    index("mileage_vehicle_date_idx").on(table.vehicleId, table.recordedDate),
    uniqueIndex("mileage_vehicle_date_unique").on(table.vehicleId, table.recordedDate),
  ],
);

export const maintenanceAuditLogs = sqliteTable(
  "maintenance_audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    maintenanceId: integer("maintenance_id").notNull().references(() => maintenanceRecords.id, { onDelete: "cascade" }),
    operation: text("operation", { enum: ["Created", "Updated", "Voided", "Restored"] }).notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    summary: text("summary"),
    changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("maintenance_audit_record_idx").on(table.maintenanceId, table.changedAt)],
);

export const servicePlans = sqliteTable(
  "service_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull().default("Other"),
    intervalMileage: integer("interval_mileage"),
    intervalMonths: integer("interval_months"),
    nextDueMileage: integer("next_due_mileage"),
    nextDueDate: text("next_due_date"),
    notes: text("notes"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [index("service_plans_vehicle_due_idx").on(table.vehicleId, table.nextDueDate, table.nextDueMileage)],
);

// `vehicleId` on the plan remains the primary/legacy vehicle for compatibility.
// This link table is the source of truth for every vehicle a shared task applies to.
export const servicePlanVehicles = sqliteTable(
  "service_plan_vehicles",
  {
    servicePlanId: integer("service_plan_id").notNull().references(() => servicePlans.id, { onDelete: "cascade" }),
    vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.servicePlanId, table.vehicleId] }),
    index("service_plan_vehicles_vehicle_idx").on(table.vehicleId),
  ],
);

export const servicePlanItems = sqliteTable(
  "service_plan_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    servicePlanId: integer("service_plan_id").notNull().references(() => servicePlans.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("service_plan_items_plan_idx").on(table.servicePlanId, table.position)],
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vehicleId: integer("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
    servicePlanId: integer("service_plan_id").references(() => servicePlans.id, { onDelete: "set null" }),
    maintenanceId: integer("maintenance_id").references(() => maintenanceRecords.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    dueDate: text("due_date"),
    dueMileage: integer("due_mileage"),
    status: text("status", { enum: ["Active", "Completed", "Dismissed"] }).notNull().default("Active"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [index("reminders_vehicle_status_idx").on(table.vehicleId, table.status, table.dueDate)],
);

export type Vehicle = typeof vehicles.$inferSelect;
export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;
export type Part = typeof parts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type InsurancePolicy = typeof insurancePolicies.$inferSelect;
export type ServicePlan = typeof servicePlans.$inferSelect;
