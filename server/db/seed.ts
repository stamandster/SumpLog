import { eq } from "drizzle-orm";
import { db } from "./client";
import { migrateDatabase } from "./migrate";
import {
  maintenanceRecords,
  maintenanceAuditLogs,
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
} from "./schema";

export async function seedDatabase() {
  migrateDatabase();

  const existing = await db.select({ id: vehicles.id }).from(vehicles).limit(1);
  if (existing.length > 0) return;

  const [vehicle] = await db
    .insert(vehicles)
    .values({
      vin: "WBAAA1308K4201746",
      year: 1989,
      make: "BMW",
      model: "325i",
      trim: "2-door",
      nickname: "E30",
      mileage: 126420,
      color: "Alpine White",
      engine: "M20B25 2.5L I6",
      transmission: "5-speed manual",
      registrationExpiresAt: "2027-02-28",
      annualMileageEstimate: 3400,
    })
    .returning();

  await db.insert(mileageEntries).values({ vehicleId: vehicle.id, recordedDate: "2026-09-01", mileage: 126420, annualMileageEstimate: 3400, notes: "Initial SumpLog mileage." });

  const seededMaintenance = await db.insert(maintenanceRecords).values([
    {
      vehicleId: vehicle.id,
      title: "Engine oil and filter",
      category: "Fluids",
      serviceDate: "2026-05-12",
      mileage: 125340,
      costCents: 6842,
      laborHours: 0.7,
      difficulty: 1,
      notes: "Liqui Moly 10W-40 and MANN filter.",
      nextDueMileage: 127500,
      nextDueDate: "2026-11-12",
    },
    {
      vehicleId: vehicle.id,
      title: "Brake fluid flush",
      category: "Brakes",
      serviceDate: "2026-03-28",
      mileage: 124118,
      costCents: 2417,
      laborHours: 1.2,
      difficulty: 2,
      notes: "ATE Type 200; pressure bled.",
    },
    {
      vehicleId: vehicle.id,
      title: "Air filter",
      category: "Engine",
      serviceDate: "2026-02-15",
      mileage: 123801,
      costCents: 1824,
      laborHours: 0.2,
      difficulty: 1,
      notes: "MANN C 31 145.",
    },
  ]).returning();

  await db.insert(maintenanceAuditLogs).values(seededMaintenance.map((record) => ({ maintenanceId: record.id, operation: "Created" as const, afterJson: JSON.stringify(record), summary: "Imported seed maintenance record." })));

  const seededParts = await db
    .insert(parts)
    .values([
      { partNumber: "11 42 1 730 000", name: "Oil filter", manufacturer: "MANN-FILTER", supplierName: "FCP Euro", purchasePriceCents: 875, quantity: 6, minimumQuantity: 8, storageLocation: "A1-01-02" },
      { partNumber: "11 42 1 437 307", name: "Air filter", manufacturer: "MANN-FILTER", supplierName: "FCP Euro", purchasePriceCents: 1250, quantity: 4, minimumQuantity: 2, storageLocation: "A1-01-03" },
      { partNumber: "12 12 1 709 907", name: "Spark plug BKR6EK", manufacturer: "NGK", supplierName: "RockAuto", purchasePriceCents: 245, quantity: 12, minimumQuantity: 6, storageLocation: "A1-02-01" },
      { partNumber: "12 31 1 272 315", name: "Distributor cap", manufacturer: "Bosch", supplierName: "Pelican Parts", purchasePriceCents: 1820, quantity: 2, minimumQuantity: 1, storageLocation: "A2-02-02" },
      { partNumber: "34 11 1 157 189", name: "Front brake pad set", manufacturer: "ATE", supplierName: "FCP Euro", purchasePriceCents: 3695, quantity: 3, minimumQuantity: 4, storageLocation: "A2-01-01" },
      { partNumber: "34 21 1 162 946", name: "Rear brake pad set", manufacturer: "ATE", supplierName: "FCP Euro", purchasePriceCents: 3120, quantity: 2, minimumQuantity: 2, storageLocation: "A2-01-02" },
      { partNumber: "24 11 1 176 319", name: "Radiator", manufacturer: "Behr", supplierName: "AutohausAZ", purchasePriceCents: 12480, quantity: 1, minimumQuantity: 1, storageLocation: "A4-02-01" },
      { partNumber: "11 53 1 250 422", name: "Valve cover gasket", manufacturer: "Elring", supplierName: "FCP Euro", purchasePriceCents: 735, quantity: 2, minimumQuantity: 2, storageLocation: "A3-01-01" },
      { partNumber: "83212465854", name: "5W-30 engine oil (5L)", manufacturer: "Liqui Moly", supplierName: "Local", purchasePriceCents: 3690, quantity: 5, minimumQuantity: 3, storageLocation: "B1-01-01" },
      { partNumber: "83 22 2 152 426", name: "DOT 4 brake fluid (1L)", manufacturer: "ATE", supplierName: "Local", purchasePriceCents: 980, quantity: 4, minimumQuantity: 2, storageLocation: "B1-01-02" },
    ])
    .returning();

  await db.insert(vehicleParts).values(
    seededParts.map((part) => ({
      vehicleId: vehicle.id,
      partId: part.id,
      fitmentNotes: "Verified for E30 325i",
    })),
  );

  await db.insert(referenceSpecs).values([
    { vehicleId: vehicle.id, groupName: "Engine", label: "Oil capacity", value: "4.25 L with filter" },
    { vehicleId: vehicle.id, groupName: "Engine", label: "Spark plug gap", value: "0.7 mm" },
    { vehicleId: vehicle.id, groupName: "Wheels", label: "Lug torque", value: "100 Nm / 74 lb-ft" },
    { vehicleId: vehicle.id, groupName: "Fluids", label: "Coolant", value: "BMW blue, phosphate-free" },
  ]);

  const [project] = await db
    .insert(projects)
    .values({
      vehicleId: vehicle.id,
      title: "Cooling system refresh",
      description: "Replace age-sensitive cooling components.",
      status: "In Progress",
      estimatedBudgetCents: 65000,
      actualCostCents: 28900,
      targetDate: "2026-10-15",
    })
    .returning();

  await db.insert(projectTasks).values([
    { projectId: project.id, title: "Order radiator and hoses", completed: true, position: 1 },
    { projectId: project.id, title: "Replace water pump", completed: false, position: 2 },
    { projectId: project.id, title: "Bleed and pressure test", completed: false, position: 3 },
  ]);

  const [servicePlan] = await db.insert(servicePlans).values({
    vehicleId: vehicle.id,
    title: "30,000-mile service",
    category: "Engine",
    intervalMileage: 30000,
    nextDueMileage: 150000,
    notes: "Baseline inspection and wear-item service.",
  }).returning();
  await db.insert(servicePlanVehicles).values({ servicePlanId: servicePlan.id, vehicleId: vehicle.id });
  await db.insert(servicePlanItems).values([
    { servicePlanId: servicePlan.id, title: "Change engine oil and filter", position: 1 },
    { servicePlanId: servicePlan.id, title: "Inspect belts, hoses, and cooling system", position: 2 },
    { servicePlanId: servicePlan.id, title: "Inspect brakes, steering, and suspension", position: 3 },
    { servicePlanId: servicePlan.id, title: "Replace air filter and inspect ignition components", position: 4 },
  ]);
  await db.insert(reminders).values({ vehicleId: vehicle.id, servicePlanId: servicePlan.id, title: servicePlan.title, dueMileage: 150000 });

  const seeded = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id));
  console.info(`Seeded ${seeded[0]?.year} ${seeded[0]?.make} ${seeded[0]?.model}.`);
}

if (import.meta.main) {
  await seedDatabase();
}
