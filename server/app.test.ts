import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

// Each Bun invocation owns its fixture directory. This avoids SQLite WAL locks and
// uploaded fixtures leaking between a running dev server and parallel test runs.
const testRoot = mkdtempSync(join(tmpdir(), "sumplog-test-"));
const testDb = `${testRoot}/sumplog-test.db`;
process.env.UPLOAD_DIRECTORY = `${testRoot}/uploads`;
process.env.SUMPLOG_PASSWORD = "";
process.env.DATABASE_URL = testDb;

let app: typeof import("./app").default;
let sqlite: typeof import("./db/client").sqlite;

beforeAll(async () => {
  rmSync(testDb, { force: true });
  rmSync(`${testDb}-shm`, { force: true });
  rmSync(`${testDb}-wal`, { force: true });
  const migration = await import("./db/migrate");
  sqlite = (await import("./db/client")).sqlite;
  migration.migrateDatabase();
  const seed = await import("./db/seed");
  await seed.seedDatabase();
  app = (await import("./app")).default;
}, 30000);

afterAll(async () => {
  sqlite?.close();
  // Windows may still hold a just-closed SQLite sidecar briefly. Isolation is the
  // correctness guarantee; cleanup is best-effort so a transient OS lock cannot
  // turn a passing suite into a failed one.
  await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
});

describe("SumpLog API", () => {
  it("serves small previews, saves rotation and preserves original photo bytes", async () => {
    const sharp = (await import("sharp")).default;
    const original = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#dc8614" } }).png().toBuffer();
    const vehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2020, make: "Photo", model: "Test", mileage: 100, mileageDate: "2026-09-08" }))).json();
    const body = new FormData(); body.set("vehicleId", String(vehicle.id)); body.set("kind", "Photo"); body.set("file", new File([original], "test.png", { type: "image/png" }));
    const doc = await (await app.request("/api/documents", { method: "POST", body })).json();
    const preview = await app.request(`/api/documents/${doc.id}/file?preview=1`);
    expect(preview.headers.get("Content-Type")).toBe("image/webp");
    const cached = await app.request(`/api/documents/${doc.id}/file?preview=1`, { headers: { "If-None-Match": preview.headers.get("ETag")! } });
    expect(cached.status).toBe(304);
    const previewBytes = Buffer.from(await preview.arrayBuffer());
    expect(previewBytes.length).toBeLessThan(original.length);
    expect((await sharp(previewBytes).metadata()).width).toBe(640);
    const orientedOriginal = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#f4efe5" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const orientedBody = new FormData(); orientedBody.set("vehicleId", String(vehicle.id)); orientedBody.set("kind", "Receipt"); orientedBody.set("file", new File([orientedOriginal], "portrait-receipt.jpg", { type: "image/jpeg" }));
    const orientedDocument = await (await app.request("/api/documents", { method: "POST", body: orientedBody })).json();
    const editorResponse = await app.request(`/api/documents/${orientedDocument.id}/file?editor=1`);
    const editorBytes = Buffer.from(await editorResponse.arrayBuffer());
    expect(editorResponse.headers.get("Content-Type")).toBe("image/webp");
    expect(await sharp(editorBytes).metadata()).toMatchObject({ width: 800, height: 1600 });
    const normalizedBytes = Buffer.from(await (await app.request(`/api/documents/${orientedDocument.id}/file?normalized=1`)).arrayBuffer());
    const normalizedMetadata = await sharp(normalizedBytes).metadata();
    expect(normalizedMetadata).toMatchObject({ width: 800, height: 1600 });
    expect(normalizedMetadata.orientation).toBeUndefined();
    expect(Buffer.from(await (await app.request(`/api/documents/${orientedDocument.id}/file?original=1`)).arrayBuffer()).equals(orientedOriginal)).toBe(true);
    expect((await app.request(`/api/documents/${doc.id}/photo-rotation`, jsonRequest("POST", { rotation: 45 }))).status).toBe(422);
    expect((await app.request(`/api/documents/${doc.id}/photo-rotation`, jsonRequest("POST", { rotation: 90 }))).status).toBe(200);
    const rotated = Buffer.from(await (await app.request(`/api/documents/${doc.id}/file?preview=1`)).arrayBuffer());
    expect((await sharp(rotated).metadata()).height).toBe(640);
    expect((await sharp(rotated).metadata()).width).toBe(320);
    const full = Buffer.from(await (await app.request(`/api/documents/${doc.id}/file`)).arrayBuffer());
    expect((await sharp(full).metadata()).height).toBe(1600);
    expect(Buffer.from(await (await app.request(`/api/documents/${doc.id}/file?original=1`)).arrayBuffer()).equals(original)).toBe(true);
    const vehicleBody = new FormData(); vehicleBody.set("file", new File([original], "car.png", { type: "image/png" })); vehicleBody.set("rotation", "90");
    expect((await app.request(`/api/vehicles/${vehicle.id}/image`, { method: "POST", body: vehicleBody })).status).toBe(200);
    expect((await app.request(`/api/vehicles/${vehicle.id}/photo-rotation`, jsonRequest("POST", { rotation: 0, photoZoom: 1.8, photoPositionX: 35, photoPositionY: 72 }))).status).toBe(200);
    const framedVehicle = (await (await app.request("/api/vehicles")).json()).find((row: { id: number }) => row.id === vehicle.id);
    expect({ zoom: framedVehicle.photoZoom, x: framedVehicle.photoPositionX, y: framedVehicle.photoPositionY }).toEqual({ zoom: 1.8, x: 35, y: 72 });
    const car = Buffer.from(await (await app.request(`/api/vehicles/${vehicle.id}/image?preview=1`)).arrayBuffer());
    expect((await sharp(car).metadata()).height).toBe(960);
    const bundle = new FormData();
    bundle.set("record", JSON.stringify({ title: "Photo staging", category: "Engine", serviceDate: "2026-09-08", mileage: 100, cost: 0 }));
    bundle.set("attachments", JSON.stringify([{ name: "Rotated staged photo", kind: "Photo", rotation: 270 }]));
    bundle.set("files", new File([original], "staged.png", { type: "image/png" }));
    const savedBundle = await app.request(`/api/vehicles/${vehicle.id}/maintenance-bundle`, { method: "POST", body: bundle });
    expect(savedBundle.status).toBe(201);
    const savedRecord = await savedBundle.json();
    const attached = (await (await app.request("/api/documents")).json()).find((row: { maintenanceId: number }) => row.maintenanceId === savedRecord.id);
    const stagedBytes = Buffer.from(await (await app.request(`/api/documents/${attached.id}/file?preview=1`)).arrayBuffer());
    expect((await sharp(stagedBytes).metadata()).height).toBe(640);
    expect((await sharp(stagedBytes).metadata()).width).toBe(320);
    await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
  });

  it("preserves absent deadlines and atomically completes standalone reminders without duplicate retries", async () => {
    const vehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2020, make: "Test", model: "Audit", mileage: 20000, mileageDate: "2026-09-07" }))).json();
    const payload = { title: "Inspection", category: "Interior", serviceDate: "2026-09-07", mileage: 20000, cost: 5, nextDueMileage: "", parts: [] };
    const plain = await (await app.request(`/api/vehicles/${vehicle.id}/maintenance`, jsonRequest("POST", payload))).json();
    expect(plain.nextDueMileage).toBeNull();
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/reminders`)).json()).length).toBe(0);
    const reminder = await (await app.request(`/api/vehicles/${vehicle.id}/reminders`, jsonRequest("POST", { title: "Inspection due", dueDate: "2026-09-10", dueMileage: null }))).json();
    expect(reminder.dueMileage).toBeNull();
    const scheduled = { ...payload, dueSourceId: -(1000000 + reminder.id), submissionKey: "test-reminder-retry-key" };
    const saved = await (await app.request(`/api/vehicles/${vehicle.id}/maintenance`, jsonRequest("POST", scheduled))).json();
    const retried = await (await app.request(`/api/vehicles/${vehicle.id}/maintenance`, jsonRequest("POST", scheduled))).json();
    expect(retried.id).toBe(saved.id);
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/reminders`)).json()).find((row: { id: number }) => row.id === reminder.id).status).toBe("Completed");
    const before = (await (await app.request(`/api/vehicles/${vehicle.id}/maintenance`)).json()).length;
    const invalid = await app.request(`/api/vehicles/${vehicle.id}/maintenance`, jsonRequest("POST", { ...payload, dueSourceId: -1999999 }));
    expect(invalid.ok).toBe(false);
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/maintenance`)).json()).length).toBe(before);
    await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
  });

  it("saves custom document types and searchable notes on policy documents without a vehicle", async () => {
    const policy = await (await app.request("/api/insurance", jsonRequest("POST", { provider: "Audit Mutual", vehicleIds: [] }))).json();
    const body = new FormData();
    body.set("insurancePolicyId", String(policy.id)); body.set("kind", "Warranty");
    body.set("file", new File(["coverage terms"], "coverage.txt", { type: "text/plain" }));
    const response = await app.request("/api/documents", { method: "POST", body });
    expect(response.status).toBe(201);
    const doc = await response.json();
    const updated = await app.request(`/api/documents/${doc.id}`, jsonRequest("PUT", { name: "Coverage", kind: "Custom coverage", vehicleId: null, notes: "Roadside assistance" }));
    expect(updated.status).toBe(200);
    expect((await updated.json()).vehicleId).toBeNull();
    const rows = await (await app.request("/api/documents")).json();
    expect(rows.find((row: { id: number }) => row.id === doc.id).notes).toBe("Roadside assistance");
    await app.request(`/api/documents/${doc.id}`, { method: "DELETE" });
    await app.request(`/api/insurance/${policy.id}`, { method: "DELETE" });
  });

  it("keeps historical unit prices and records final totals in audit history", async () => {
    const vehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2020, make: "Test", model: "Costs", mileage: 20000, mileageDate: "2026-09-07" }))).json();
    const partInput = { partNumber: "AUDIT-COST", name: "Audit filter", purchasePrice: 10, quantity: 3, minimumQuantity: 1 };
    const part = await (await app.request("/api/parts", jsonRequest("POST", partInput))).json();
    const payload = { title: "Filter service", category: "Engine", serviceDate: "2026-09-07", mileage: 20000, cost: 5, parts: [{ partId: part.id, quantity: 1 }] };
    const record = await (await app.request(`/api/vehicles/${vehicle.id}/maintenance`, jsonRequest("POST", payload))).json();
    expect(record.costCents).toBe(1500);
    await app.request(`/api/parts/${part.id}`, jsonRequest("PUT", { ...partInput, purchasePrice: 20 }));
    const updated = await (await app.request(`/api/maintenance/${record.id}`, jsonRequest("PUT", { ...payload, notes: "Notes only" }))).json();
    expect(updated.costCents).toBe(1500);
    const history = await (await app.request(`/api/maintenance/${record.id}/audit`)).json();
    expect(JSON.parse(history[0].afterJson).costCents).toBe(1500);
    await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
    await app.request(`/api/parts/${part.id}`, { method: "DELETE" });
  });

  it("records partial consumable use and charges only the used portion", async () => {
    const vehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2021, make: "Test", model: "Consumables", mileage: 21000, mileageDate: "2026-09-10" }))).json();
    const consumableInput = { itemType: "Consumable", category: "Power steering fluid", partNumber: "PARTIAL-FLUID", name: "32 oz steering fluid", purchasePrice: 16, quantity: 2, volumePerUnit: 32, volumeUnit: "fl oz", minimumQuantity: 0 };
    const part = await (await app.request("/api/parts", jsonRequest("POST", consumableInput))).json();
    const payload = { title: "Power steering top-up", category: "Fluids", serviceDate: "2026-09-10", mileage: 21000, cost: 0, parts: [{ partId: part.id, quantity: 0.125, usageMode: "Partial", amountUsed: 4, amountUnit: "fl oz" }] };
    const response = await app.request(`/api/vehicles/${vehicle.id}/maintenance`, jsonRequest("POST", payload));
    expect(response.status).toBe(201);
    expect((await response.json()).costCents).toBe(200);
    const records = await (await app.request(`/api/vehicles/${vehicle.id}/maintenance`)).json();
    const usage = records.find((record: { title: string }) => record.title === payload.title).parts[0];
    expect(usage).toMatchObject({ usageMode: "Partial", amountUsed: 4, amountUnit: "fl oz", quantity: 0.125 });
    expect(records.find((record: { title: string }) => record.title === payload.title).partsCostCents).toBe(200);
    const invalid = await app.request(`/api/maintenance/${records[0].id}`, jsonRequest("PUT", { ...payload, parts: [{ ...payload.parts[0], amountUsed: 40 }] }));
    expect(invalid.status).toBe(422);
    await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
    await app.request(`/api/parts/${part.id}`, { method: "DELETE" });
  });

  it("returns a seeded vehicle dashboard", async () => {
    const response = await app.request("/api/vehicles/1/dashboard");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.vehicle.nickname).toBe("E30");
    expect(body.recentMaintenance.length).toBeGreaterThan(0);
  });

  it("does not present an orphan expiration date as configured insurance", async () => {
    const createdResponse = await app.request("/api/vehicles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: 2008, make: "Honda", model: "Civic", mileage: 145000, mileageDate: "2026-09-02", insuranceExpiresAt: "2020-01-01" }) });
    expect(createdResponse.status).toBe(201);
    const vehicle = await createdResponse.json();
    const alerts = await (await app.request(`/api/alerts?vehicleId=${vehicle.id}`)).json();
    expect(alerts.some((alert: { kind: string }) => alert.kind === "Insurance")).toBe(false);
    expect((await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("creates a maintenance record", async () => {
    const response = await app.request("/api/vehicles/1/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Coolant inspection",
        category: "Fluids",
        serviceDate: "2026-09-01",
        mileage: 126420,
        cost: 0,
        laborHours: 0.25,
        difficulty: 1,
        notes: "Level and freeze protection checked.",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.title).toBe("Coolant inspection");
  });

  it("rejects malformed maintenance data", async () => {
    const response = await app.request("/api/vehicles/1/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(response.status).toBe(422);
  });

  it("creates, updates, lists, and deletes an inventory part", async () => {
    const createdResponse = await app.request("/api/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partNumber: "TEST-INV-001",
        name: "Inventory test part",
        manufacturer: "SumpLog Test",
        purchasePrice: 12.5,
        quantity: 2,
        volumePerUnit: 5,
        volumeUnit: "qt",
        minimumQuantity: 1,
        storageLocation: "Test shelf",
        vehicleId: null,
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.purchasePriceCents).toBe(1250);
    expect(created.volumePerUnit).toBe(5);
    expect(created.volumeUnit).toBe("qt");
    expect(created.vehicleId).toBeNull();

    const updatedResponse = await app.request(`/api/parts/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partNumber: "TEST-INV-001",
        name: "Updated inventory test part",
        manufacturer: "SumpLog Test",
        supplierUrl: "https://example.com/test-part",
        purchasePrice: 13.25,
        quantity: 1,
        minimumQuantity: 2,
        storageLocation: "Shelf T-1",
        vehicleId: 1,
        fitmentNotes: "Test fitment",
      }),
    });
    expect(updatedResponse.status).toBe(200);
    const updated = await updatedResponse.json();
    expect(updated.quantity).toBe(1);
    expect(updated.vehicleId).toBe(1);

    const listResponse = await app.request("/api/parts?vehicleId=1&q=TEST-INV-001");
    const listed = await listResponse.json();
    expect(listed).toHaveLength(1);
    expect(listed[0].fitmentNotes).toBe("Test fitment");

    const deletedResponse = await app.request(`/api/parts/${created.id}`, { method: "DELETE" });
    expect(deletedResponse.status).toBe(200);
    const afterDelete = await app.request("/api/parts?vehicleId=1&q=TEST-INV-001");
    expect(await afterDelete.json()).toHaveLength(0);
  });

  it("saves the part dialog payload with blank optional fields and vehicle fitment", async () => {
    const response = await app.request("/api/parts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partNumber: "MOBILE-PAYLOAD", name: "Mobile test part", manufacturer: "", supplierName: "", supplierUrl: "", purchasePrice: 0, quantity: 1, volumePerUnit: null, volumeUnit: "", minimumQuantity: 0, storageLocation: "", notes: "", vehicleId: null, fitments: [{ vehicleId: 1, notes: "" }] }),
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.supplierUrl).toBeNull();
    expect(created.fitments).toHaveLength(1);
    for (const supplierUrl of ["", "https://example.com/part", "not a URL", "javascript:alert(1)"]) {
      const updated = await app.request(`/api/parts/${created.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partNumber: "MOBILE-PAYLOAD", name: "Mobile test part", supplierUrl }),
      });
      expect(updated.status).toBe(supplierUrl === "" || supplierUrl.startsWith("https://") ? 200 : 422);
    }
  });

  it("persists consumable classification and separates specifications from approvals", async () => {
    const input = { partNumber: "CONSUMABLE-TEST", name: "Test engine oil", itemType: "Consumable", category: "Engine oil", specifications: "Label specification", approvals: "Recorded manufacturer approval", volumePerUnit: 5, volumeUnit: "qt", quantity: 2, supplierUrl: "" };
    const response = await app.request("/api/parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    expect(response.status).toBe(201);
    const part = await response.json();
    expect(part.itemType).toBe("Consumable");
    expect(part.category).toBe("Engine oil");
    expect(part.specifications).toBe(input.specifications);
    expect(part.approvals).toBe(input.approvals);
    const saved = await (await app.request(`/api/parts/${part.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, category: "Custom fluid" }) })).json();
    expect(saved.category).toBe("Custom fluid");
    expect(saved.itemType).toBe("Consumable");
  });

  it("rejects malformed inventory data", async () => {
    const response = await app.request("/api/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partNumber: "", name: "x", quantity: -1 }),
    });
    expect(response.status).toBe(422);
  });

  it("keeps an audit trail when maintenance is edited", async () => {
    const createdResponse = await app.request("/api/vehicles/1/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Brake inspection", category: "Brakes", serviceDate: "2026-08-30", mileage: 126400, cost: 20, laborHours: 1, difficulty: 2, notes: "Initial inspection" }) });
    const created = await createdResponse.json();
    const updatedResponse = await app.request(`/api/maintenance/${created.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Brake inspection and bleed", category: "Brakes", serviceDate: "2026-08-30", mileage: 126400, cost: 28, laborHours: 1.5, difficulty: 2, notes: "Flushed old fluid" }) });
    expect(updatedResponse.status).toBe(200);
    const historyResponse = await app.request(`/api/maintenance/${created.id}/audit`);
    const history = await historyResponse.json();
    expect(history).toHaveLength(2);
    expect(history[0].operation).toBe("Updated");
    expect(history[0].summary).toContain("title");
  });

  it("estimates yearly mileage and records dated odometer updates", async () => {
    const createdResponse = await app.request("/api/vehicles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: 2020, make: "Mazda", model: "MX-5", mileage: 48000, mileageDate: "2026-09-01" }) });
    expect(createdResponse.status).toBe(201);
    const vehicle = await createdResponse.json();
    expect(vehicle.annualMileageEstimate).toBeGreaterThan(0);
    const mileageResponse = await app.request(`/api/vehicles/${vehicle.id}/mileage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordedDate: "2026-10-01", mileage: 49000, annualMileageEstimate: 12000, notes: "Monthly reading" }) });
    expect(mileageResponse.status).toBe(201);
    const mileageEntry = await mileageResponse.json();
    const editedResponse = await app.request(`/api/mileage/${mileageEntry.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordedDate: "2026-10-02", mileage: 49200, annualMileageEstimate: 12500, notes: "Corrected reading" }) });
    expect(editedResponse.status).toBe(200);
    expect((await editedResponse.json()).mileage).toBe(49200);
    const listResponse = await app.request(`/api/vehicles/${vehicle.id}/mileage`);
    const mileageHistory = await listResponse.json();
    expect(mileageHistory).toHaveLength(2);
    expect(mileageHistory[0].notes).toBe("Corrected reading");
  });

  it("treats blank annual mileage as automatic while preserving an explicit zero", async () => {
    const headers = { "Content-Type": "application/json" };
    const created = await app.request("/api/vehicles", { method: "POST", headers, body: JSON.stringify({ year: 2020, make: "Test", model: "Automatic estimate", mileage: 60_000, mileageDate: "2026-07-01", annualMileageEstimate: null }) });
    expect(created.status).toBe(201);
    const vehicle = await created.json();
    expect(vehicle.annualMileageEstimate).toBeGreaterThan(0);
    const added = await app.request(`/api/vehicles/${vehicle.id}/mileage`, { method: "POST", headers, body: JSON.stringify({ recordedDate: "2026-08-01", mileage: 61_000, annualMileageEstimate: null }) });
    expect(added.status).toBe(201);
    const entry = await added.json();
    expect(entry.annualMileageEstimate).toBe(Math.round(1_000 / 31 * 365.25));
    const changed = await app.request(`/api/mileage/${entry.id}`, { method: "PUT", headers, body: JSON.stringify({ recordedDate: "2026-08-01", mileage: 62_000, annualMileageEstimate: null }) });
    expect(changed.status).toBe(200);
    expect((await changed.json()).annualMileageEstimate).toBe(Math.round(2_000 / 31 * 365.25));
    const zero = await app.request(`/api/mileage/${entry.id}`, { method: "PUT", headers, body: JSON.stringify({ recordedDate: "2026-08-01", mileage: 62_000, annualMileageEstimate: 0 }) });
    expect((await zero.json()).annualMileageEstimate).toBe(0);
    await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
  });

  it("creates a service plan, checklist, and reminder", async () => {
    const secondVehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2020, make: "Ford", model: "Ranger", mileage: 40000, mileageDate: "2026-09-02" }))).json();
    const response = await app.request("/api/vehicles/1/service-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Shared 30,000-mile service", category: "Engine", intervalMileage: 30000, intervalMonths: null, nextDueMileage: 150000, nextDueDate: null, items: ["Change oil", "Inspect belts"], createReminder: true, vehicleIds: [1, secondVehicle.id] }) });
    expect(response.status).toBe(201);
    const plan = await response.json();
    expect(plan.items).toHaveLength(2);
    expect(plan.vehicleIds).toEqual([1, secondVehicle.id]);
    const remindersResponse = await app.request("/api/vehicles/1/reminders");
    const reminders = await remindersResponse.json();
    expect(reminders.some((reminder: { servicePlanId: number }) => reminder.servicePlanId === plan.id)).toBe(true);
    expect((await (await app.request(`/api/vehicles/${secondVehicle.id}/service-plans`)).json())[0].vehicleIds).toEqual([1, secondVehicle.id]);
    for (const vehicleId of [1, secondVehicle.id]) {
      const dashboard = await (await app.request(`/api/vehicles/${vehicleId}/dashboard`)).json();
      const matching = dashboard.nextServices.filter((item: { title: string }) => item.title === plan.title);
      expect(matching).toHaveLength(1);
      expect(matching[0].category).toBe("Engine");
    }
    const completed = await app.request(`/api/service-plans/${plan.id}/complete?vehicleId=1`, jsonRequest("POST", { serviceDate: "2026-09-05", mileage: 130000 }));
    expect(completed.status).toBe(200); expect((await completed.json()).nextDueMileage).toBe(160000);
    const advanced = (await (await app.request("/api/vehicles/1/dashboard")).json()).nextServices.find((item: { title: string }) => item.title === plan.title);
    expect(advanced.nextDueMileage).toBe(160000);
    const untouched = (await (await app.request(`/api/vehicles/${secondVehicle.id}/service-plans`)).json()).find((item: { id: number }) => item.id === plan.id);
    expect(untouched.nextDueMileage).toBe(150000);
    await app.request(`/api/vehicles/${secondVehicle.id}`, { method: "DELETE" });
  });

  it("updates vehicle metadata and derives expiry alerts", async () => {
    const response = await app.request("/api/vehicles/1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vin: "WBAAA1308K4201746", year: 1989, make: "BMW", model: "325i", trim: "2-door", nickname: "E30", mileage: 126500, mileageDate: "2026-09-02", color: "Alpine White", bodyStyle: "Coupe", fuelType: "Gasoline", drivetrain: "RWD", engine: "M20B25 2.5L I6", transmission: "5-speed manual", licensePlate: "E30-TEST", registrationState: "VA", registrationNumber: "REG-123", registrationExpiresAt: "2020-02-01", purchaseDate: "2020-06-01", purchasePrice: 8500, insuranceProvider: "Test Mutual", insurancePolicyNumber: "POL-123", insuranceAgentName: "Alex Rivera", insuranceAgentPhone: "555-0100", insuranceEffectiveAt: "2019-01-01", insuranceExpiresAt: "2020-01-01", insurancePremium: 625.50, insuranceNotes: "Agreed value", annualMileageEstimate: 3400, notes: "Weekend car" }) });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.purchasePriceCents).toBe(850000);
    expect(updated.mileage).toBe(126500);
    const policyResponse = await app.request("/api/insurance", jsonRequest("POST", { provider: "Test Mutual", policyNumber: "POL-123", agentName: "Alex Rivera", agentPhone: "555-0100", effectiveAt: "2019-01-01", expiresAt: "2020-01-01", premium: 625.50, notes: "Agreed value", vehicleIds: [1] }));
    expect(policyResponse.status).toBe(201);
    const policy = await policyResponse.json(); expect(policy.provider).toBe("Test Mutual");
    const alerts = await (await app.request("/api/alerts?vehicleId=1")).json();
    expect(alerts.some((alert: { kind: string; severity: string }) => alert.kind === "Insurance" && alert.severity === "overdue")).toBe(true);
  });

  it("keeps insurance policies and their documents when a linked vehicle is deleted", async () => {
    const vehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2021, make: "Test", model: "Insured", mileage: 100, mileageDate: "2026-09-03" }))).json();
    const policy = await (await app.request("/api/insurance", jsonRequest("POST", { provider: "Garage Mutual", policyNumber: "POL-KEEP", expiresAt: "2027-01-01", vehicleIds: [vehicle.id] }))).json();
    const body = new FormData(); body.append("insurancePolicyId", String(policy.id)); body.append("kind", "Insurance"); body.append("file", new File(["policy document"], "policy.txt", { type: "text/plain" }));
    const document = await (await app.request("/api/documents", { method: "POST", body })).json();
    expect(document.insurancePolicyId).toBe(policy.id); expect(document.vehicleId).toBeNull(); expect(await Bun.file(document.storagePath).exists()).toBe(true);
    expect((await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" })).status).toBe(200);
    const policies = await (await app.request("/api/insurance")).json(); const kept = policies.find((item: { id: number }) => item.id === policy.id);
    expect(kept.vehicleIds).toEqual([]); expect(kept.documentCount).toBe(1);
    const policyDocuments = await (await app.request(`/api/documents?insurancePolicyId=${policy.id}`)).json(); expect(policyDocuments).toHaveLength(1); expect(await (await app.request(`/api/documents/${document.id}/file`)).text()).toBe("policy document");
  });

  it("creates, edits, and deletes reference specifications", async () => {
    const createdResponse = await app.request("/api/vehicles/1/specs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupName: "Brakes", label: "Bleeder torque", value: "8 Nm", source: "Workshop manual" }) });
    expect(createdResponse.status).toBe(201); const created = await createdResponse.json();
    const updatedResponse = await app.request(`/api/specs/${created.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupName: "Brakes", label: "Bleeder torque", value: "9 Nm", source: "Workshop manual" }) });
    expect((await updatedResponse.json()).value).toBe("9 Nm");
    expect((await app.request(`/api/specs/${created.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("creates, edits, checks, and deletes project plans", async () => {
    const createdResponse = await app.request("/api/vehicles/1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Clutch replacement", description: "Replace worn clutch", status: "Planned", estimatedBudget: 800, actualCost: 0, targetDate: "2026-12-01", tasks: [{ title: "Order clutch kit", completed: false, estimatedCost: 450 }] }) });
    expect(createdResponse.status).toBe(201); const created = await createdResponse.json(); expect(created.tasks).toHaveLength(1);
    const toggled = await app.request(`/api/project-tasks/${created.tasks[0].id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }) }); expect((await toggled.json()).completed).toBe(true);
    const updated = await app.request(`/api/projects/${created.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Clutch replacement", description: "Replace worn clutch", status: "In Progress", estimatedBudget: 800, actualCost: 450, targetDate: "2026-12-01", tasks: [{ title: "Order clutch kit", completed: true, estimatedCost: 450 }] }) }); expect((await updated.json()).status).toBe("In Progress");
    expect((await app.request(`/api/projects/${created.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("uploads, edits, lists, and deletes documents", async () => {
    const body = new FormData(); body.append("vehicleId", "1"); body.append("kind", "Manual"); body.append("name", "E30 workshop notes"); body.append("notes", "Searchable archive note"); body.append("file", new File(["test manual"], "manual.txt", { type: "text/plain" }));
    const createdResponse = await app.request("/api/documents", { method: "POST", body }); expect(createdResponse.status).toBe(201); const created = await createdResponse.json();
    expect(created).toMatchObject({ name: "E30 workshop notes", originalName: "manual.txt", notes: "Searchable archive note" });
    expect(created.trackingId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(basename(created.storagePath)).toMatch(/^[0-9a-f-]{36}\.txt$/);
    const updatedResponse = await app.request(`/api/documents/${created.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Workshop notes.txt", kind: "Other", vehicleId: 1 }) }); const updated = await updatedResponse.json(); expect(updated.name).toBe("Workshop notes.txt");
    expect(updated).toMatchObject({ trackingId: created.trackingId, originalName: "manual.txt" });
    const list = await (await app.request("/api/documents?vehicleId=1&kind=Other")).json(); expect(list.some((document: { id: number }) => document.id === created.id)).toBe(true);
    expect((await app.request(`/api/documents/${created.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("provides comprehensive CSV export and validates VIN input", async () => {
    const exportResponse = await app.request("/api/export/all.csv"); expect(exportResponse.status).toBe(200); expect(await exportResponse.text()).toContain("record_type");
    expect((await app.request("/api/vin/INVALID")).status).toBe(422);
  });

  it("keeps the latest dated odometer when adding or editing historical readings", async () => {
    const vehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2000, make: "Test", model: "Mileage", mileage: 80000, mileageDate: "2026-08-01" }))).json();
    const older = await (await app.request(`/api/vehicles/${vehicle.id}/mileage`, jsonRequest("POST", { recordedDate: "2025-08-01", mileage: 60000 }))).json();
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/dashboard`)).json()).vehicle.mileage).toBe(80000);
    expect((await app.request(`/api/mileage/${older.id}`, jsonRequest("PUT", { recordedDate: "2025-07-01", mileage: 58000 }))).status).toBe(200);
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/dashboard`)).json()).vehicle.mileage).toBe(80000);
    const edit = await app.request(`/api/vehicles/${vehicle.id}`, jsonRequest("PUT", { year: 2000, make: "Test", model: "Mileage", mileage: 62000, mileageDate: "2025-09-01" }));
    expect(edit.status).toBe(200); expect((await edit.json()).mileage).toBe(80000);
    await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
  });

  it("saves maintenance and attachments atomically and validates document ownership", async () => {
    const recordInput = { title: "Atomic attachment test", category: "Engine", serviceDate: "2026-08-01", mileage: 100, cost: 10, laborHours: 1, difficulty: 2 };
    const count = (await (await app.request("/api/vehicles/1/maintenance")).json()).length;
    mkdirSync(process.env.UPLOAD_DIRECTORY!, { recursive: true });
    const filesBefore = readdirSync(process.env.UPLOAD_DIRECTORY!).length;
    const invalid = new FormData(); invalid.append("record", JSON.stringify(recordInput)); invalid.append("files", new File(["valid"], "receipt.txt", { type: "text/plain" })); invalid.append("files", new File(["bad"], "unsafe.html", { type: "text/html" }));
    expect((await app.request("/api/vehicles/1/maintenance-bundle", { method: "POST", body: invalid })).status).toBe(422);
    expect((await (await app.request("/api/vehicles/1/maintenance")).json()).length).toBe(count);
    expect(readdirSync(process.env.UPLOAD_DIRECTORY!).length).toBe(filesBefore);
    const malformed = new FormData(); malformed.append("record", "{");
    expect((await app.request("/api/vehicles/1/maintenance-bundle", { method: "POST", body: malformed })).status).toBe(422);
    const valid = new FormData(); valid.append("record", JSON.stringify(recordInput)); valid.append("attachments", JSON.stringify([{ kind: "Receipt", name: "Store receipt" }, { kind: "Photo", name: "Before photo" }])); valid.append("files", new File(["receipt contents"], "receipt.txt", { type: "text/plain" })); valid.append("files", new File(["image contents"], "before.jpg", { type: "image/jpeg" }));
    const saved = await app.request("/api/vehicles/1/maintenance-bundle", { method: "POST", body: valid });
    expect(saved.status).toBe(201); const record = await saved.json();
    const docs = await (await app.request("/api/documents")).json();
    const document = docs.find((row: { maintenanceId: number; name: string }) => row.maintenanceId === record.id && row.name === "Store receipt");
    expect(document).toBeDefined();
    expect(docs.find((row: { maintenanceId: number; name: string; kind: string }) => row.maintenanceId === record.id && row.name === "Before photo" && row.kind === "Photo")).toBeDefined();
    expect(await (await app.request(`/api/documents/${document.id}/file`)).text()).toBe("receipt contents");
    const secondRecord = await (await app.request("/api/vehicles/1/maintenance", jsonRequest("POST", { title: "Second linked service", category: "Brakes", serviceDate: "2026-08-02", mileage: 110, cost: 0, laborHours: 0, difficulty: 1 }))).json();
    const shared = await app.request(`/api/documents/${document.id}`, jsonRequest("PUT", { name: "Shared receipt", kind: "Receipt", vehicleId: 1, maintenanceIds: [record.id, secondRecord.id] }));
    expect(shared.status).toBe(200);
    const sharedDocument = (await (await app.request("/api/documents")).json()).find((row: { id: number }) => row.id === document.id);
    expect(sharedDocument.maintenanceIds.sort((a: number, b: number) => a - b)).toEqual([record.id, secondRecord.id].sort((a, b) => a - b));
    expect(sharedDocument.maintenanceRecords.map((row: { title: string }) => row.title)).toContain("Second linked service");
    const other = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2020, make: "Test", model: "Other", mileage: 100, mileageDate: "2026-09-01" }))).json();
    expect((await app.request(`/api/documents/${document.id}`, jsonRequest("PUT", { name: "Invalid cross-link", kind: "Receipt", vehicleId: other.id, maintenanceId: record.id }))).status).toBe(422);
    expect((await app.request(`/api/documents/${document.id}`, jsonRequest("PUT", { name: "Rename keeps link", kind: "Receipt", vehicleId: 1 }))).status).toBe(200);
    expect((await (await app.request("/api/documents")).json()).find((row: { id: number }) => row.id === document.id).maintenanceId).toBe(record.id);
    await app.request(`/api/vehicles/${other.id}`, { method: "DELETE" });
  });

  it("supports multiple fitments without duplicate inventory rows", async () => {
    const other = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2020, make: "Test", model: "Fitment", mileage: 100, mileageDate: "2026-09-01" }))).json();
    const input = { partNumber: "MULTI-TEST", name: "Shared filter", purchasePrice: 5, quantity: 2, minimumQuantity: 1, vehicleId: null, fitments: [{ vehicleId: 1, notes: "Engine" }, { vehicleId: other.id, notes: "Alternate" }] };
    const created = await app.request("/api/parts", jsonRequest("POST", input)); expect(created.status).toBe(201);
    const part = await created.json(); expect(part.fitments).toHaveLength(2);
    for (const vehicleId of [1, other.id]) {
      const list = await (await app.request(`/api/parts?vehicleId=${vehicleId}&q=MULTI-TEST`)).json();
      expect(list).toHaveLength(1); expect(list[0].fitments).toHaveLength(2);
    }
    expect((await app.request(`/api/parts/${part.id}`, jsonRequest("PUT", { ...input, fitments: [input.fitments[0], input.fitments[0]] }))).status).toBe(422);
    await app.request(`/api/vehicles/${other.id}`, { method: "DELETE" });
    expect((await (await app.request("/api/parts?q=MULTI-TEST")).json())[0].fitments).toHaveLength(1);
  });

  it("voids and restores records with audited status changes", async () => {
    const record = await (await app.request("/api/vehicles/1/maintenance", jsonRequest("POST", { title: "Void test", category: "Engine", serviceDate: "2026-09-02", mileage: 100, cost: 1, laborHours: 0, difficulty: 1 }))).json();
    const response = await app.request(`/api/maintenance/${record.id}/status`, jsonRequest("PATCH", { voided: true }));
    expect(response.status).toBe(200); expect((await response.json()).voidedAt).toBeTruthy();
    expect((await (await app.request("/api/vehicles/1/dashboard")).json()).recentMaintenance.some((row: { id: number }) => row.id === record.id)).toBe(false);
    expect((await app.request(`/api/maintenance/${record.id}/status`, jsonRequest("PATCH", { voided: false }))).status).toBe(200);
    const audit = await (await app.request(`/api/maintenance/${record.id}/audit`)).json();
    expect(audit.map((row: { operation: string }) => row.operation)).toContain("Voided"); expect(audit.map((row: { operation: string }) => row.operation)).toContain("Restored");
  });

  it("pauses plan reminders and prioritizes date-only service deadlines", async () => {
    const vehicle = await (await app.request("/api/vehicles", jsonRequest("POST", { year: 2020, make: "Test", model: "Schedules", mileage: 100, mileageDate: "2026-09-01" }))).json();
    const input = { title: "Old urgent plan", category: "Engine", intervalMonths: 12, nextDueDate: "2020-01-01", items: ["Inspect"], createReminder: true, active: true };
    const plan = await (await app.request(`/api/vehicles/${vehicle.id}/service-plans`, jsonRequest("POST", input))).json();
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/dashboard`)).json()).nextService.title).toBe(input.title);
    expect((await app.request(`/api/service-plans/${plan.id}`, jsonRequest("PUT", { ...input, active: false }))).status).toBe(200);
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/dashboard`)).json()).nextService).toBeNull();
    expect(await (await app.request(`/api/alerts?vehicleId=${vehicle.id}`)).json()).toHaveLength(0);
    expect((await app.request("/api/vehicles/1/reminders", jsonRequest("POST", { title: "Wrong plan", servicePlanId: plan.id }))).status).toBe(422);
    await app.request(`/api/service-plans/${plan.id}`, jsonRequest("PUT", { ...input, active: true, intervalMileage: 5000 }));
    const reminder = (await (await app.request(`/api/vehicles/${vehicle.id}/reminders`)).json()).find((row: { status: string }) => row.status === "Active");
    expect((await app.request(`/api/reminders/${reminder.id}`, jsonRequest("PATCH", { status: "Completed" }))).status).toBe(200);
    const next = (await (await app.request(`/api/vehicles/${vehicle.id}/service-plans`)).json())[0];
    expect(next.nextDueMileage).toBe(5100); expect(next.nextDueDate > "2026-09-01").toBe(true);
    await app.request(`/api/reminders/${reminder.id}`, jsonRequest("PATCH", { status: "Completed" }));
    expect((await (await app.request(`/api/vehicles/${vehicle.id}/reminders`)).json()).filter((row: { status: string }) => row.status === "Active")).toHaveLength(1);
    await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
  });

  it("round-trips portable backups including file bytes and preserves data on invalid restore", async () => {
    const snapshot = await (await app.request("/api/export/json")).json();
    expect(snapshot.formatVersion).toBe(3); expect(Object.keys(snapshot.assets).length).toBeGreaterThan(0);
    const form = (data: unknown, confirmation = "REPLACE") => { const body = new FormData(); body.append("file", new File([JSON.stringify(data)], "backup.json", { type: "application/json" })); body.append("confirmation", confirmation); return body; };
    const preview = await app.request("/api/import/preview", { method: "POST", body: form(snapshot) });
    expect({ status: preview.status, error: preview.status === 200 ? undefined : await preview.clone().text() }).toEqual({ status: 200, error: undefined }); expect((await preview.json()).counts.vehicles).toBe(snapshot.vehicles.length);
    expect((await app.request("/api/import/json", { method: "POST", body: form(snapshot, "") })).status).toBe(422);
    const broken = structuredClone(snapshot); broken.vehicleParts.push({ ...broken.vehicleParts[0], id: 98765, partId: 999999 });
    expect((await app.request("/api/import/json", { method: "POST", body: form(broken) })).status).toBe(422);
    expect((await (await app.request("/api/vehicles")).json()).length).toBe(snapshot.vehicles.length);
    const duplicateVin = structuredClone(snapshot); duplicateVin.vehicles.push({ ...duplicateVin.vehicles[0], id: 987654 });
    const uploadsBefore = readdirSync(process.env.UPLOAD_DIRECTORY!).length;
    expect((await app.request("/api/import/json", { method: "POST", body: form(duplicateVin) })).status).toBe(422);
    expect(readdirSync(process.env.UPLOAD_DIRECTORY!).length).toBe(uploadsBefore);
    expect((await (await app.request("/api/vehicles")).json()).length).toBe(snapshot.vehicles.length);
    const restored = await app.request("/api/import/json", { method: "POST", body: form(snapshot) });
    expect(restored.status).toBe(200); const result = await restored.json(); expect(result.backupUrl).toStartWith("/api/backups/");
    expect((await app.request(result.backupUrl)).status).toBe(200);
    const document = snapshot.documents.find((row: { name: string }) => row.name === "Rename keeps link");
    expect(await (await app.request(`/api/documents/${document.id}/file`)).text()).toBe("receipt contents");
    const unsafe = structuredClone(snapshot); unsafe.documents[0].storagePath = "C:/Windows/win.ini";
    expect((await app.request("/api/import/preview", { method: "POST", body: form(unsafe) })).status).toBe(422);
  });

  it("downloads a readable whole-garage ZIP with an Excel index and working attachment links", async () => {
    const { default: JSZip } = await import("jszip");
    const { default: ExcelJS } = await import("exceljs");
    const response = await app.request("/api/export/archive.zip?vehicleId=999999");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="sumplog-\d{4}-\d{2}-\d{2}\.zip"/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = await response.arrayBuffer();
    expect(Number(response.headers.get("content-length"))).toBe(bytes.byteLength);
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await archive.file("SumpLog.xlsx")!.async("arraybuffer"));
    expect(workbook.worksheets).toHaveLength(18);
    const { readExportData } = await import("./export");
    const data = readExportData();
    expect(workbook.getWorksheet("Vehicles")!.getCell("A4").value).toBe(1);
    expect(workbook.getWorksheet("Maintenance")!.rowCount).toBe(data.maintenance.length + 3);
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        if (cell.hyperlink) expect(archive.file(decodeURIComponent(cell.hyperlink))).not.toBeNull();
      }));
    }
    const receiptPath = Object.keys(archive.files).find((path) => path.includes("/Services/") && path.includes("Rename keeps link"))!;
    expect(await archive.file(receiptPath)!.async("string")).toBe("receipt contents");
    const missing = Number(response.headers.get("x-sumplog-missing-files"));
    expect(await archive.file("Read me.txt")!.async("string")).toContain(`Files unavailable: ${missing}`);
    expect((await (await app.request("/api/export/json")).json()).formatVersion).toBe(3);
  }, 30000);

  it("preserves file bytes, portable folders, literal text, typed amounts, history and unavailable-file warnings", async () => {
    const { createReadableArchive, readExportData } = await import("./export");
    const { default: JSZip } = await import("jszip");
    const { default: ExcelJS } = await import("exceljs");
    const { mkdtemp, rm, mkdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = await mkdtemp(join(tmpdir(), "sumplog-export-test-"));
    const uploads = join(root, "uploads"); await mkdir(uploads);
    const binary = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
    await Bun.write(join(uploads, "photo.png"), binary);
    await Bun.write(join(root, "private.txt"), "outside upload root must not leak");
    const data = readExportData();
    data.vehicles = [{ ...data.vehicles[0], id: 70, nickname: '../CON: 車', imageUrl: join(uploads, "photo.png"), purchasePriceCents: 123456, insuranceProvider: "Test insurer" }];
    data.maintenance = [{ ...data.maintenance[0], id: 80, vehicleId: 70, title: '=HYPERLINK("https://example.com")', serviceDate: "2026-09-02", costCents: 12345, laborHours: 1.5, voidedAt: null, notes: "First line\nSecond line" }];
    data.maintenance.push({ ...data.maintenance[0], id: 81, costCents: 5000, voidedAt: "2026-09-02 12:00:00" });
    data.projects = [{ id: 90, vehicleId: 70, title: "Project", description: null, status: "Planned", estimatedBudgetCents: 0, actualCostCents: 0, targetDate: null, createdAt: "2026-09-02", updatedAt: "2026-09-02" }];
    const doc = { trackingId: "80ae1b30-d834-43cb-8d20-a62776375c2c", originalName: "receipt-original.txt", photoRotation: 0, notes: null, id: 100, vehicleId: 70, maintenanceId: 80, projectId: null, insurancePolicyId: null, kind: "Receipt" as const, name: "../CON: receipt.txt", storagePath: join(uploads, "photo.png"), mimeType: "text/plain", sizeBytes: 7, createdAt: "2026-09-02", updatedAt: "2026-09-02" };
    data.documents = [doc, { ...doc, id: 101 }, { ...doc, id: 102, kind: "Photo", name: "car.png", mimeType: "image/png" }, { ...doc, id: 103, kind: "Manual" }, { ...doc, id: 104, maintenanceId: null, projectId: 90 }, { ...doc, id: 105, maintenanceId: null }, { ...doc, id: 106, maintenanceId: null, vehicleId: null }, { ...doc, id: 107, storagePath: join(uploads, "missing.txt") }, { ...doc, id: 108, storagePath: join(root, "private.txt") }];
    data.audit = [{ id: 110, maintenanceId: 80, operation: "Updated", beforeJson: '{"costCents":10000}', afterJson: '{"costCents":12345}', summary: "Adjusted receipt total", changedAt: "2026-09-02 14:15:16" }];
    let archiveResult: Awaited<ReturnType<typeof createReadableArchive>> | undefined;
    try {
      archiveResult = await createReadableArchive(data, uploads);
      expect(archiveResult.missingFiles).toBe(2);
      const archive = await JSZip.loadAsync(await Bun.file(archiveResult.path).arrayBuffer(), { checkCRC32: true });
      const paths = Object.keys(archive.files);
      expect(paths.every((path) => !path.split("/").some((segment) => segment === ".." || /[<>:"\\|?*]/.test(segment)))).toBe(true);
      for (const id of [100, 101, 102, 103, 104, 105, 106]) {
        const path = paths.find((p) => p.includes(`/000${id}-`))!;
        expect(await archive.file(path)!.async("nodebuffer")).toEqual(binary);
        if (id <= 103) expect(path).toContain("/Services/000080-");
        if (id === 100 || id === 101) expect(path).toContain("/Receipts/");
        if (id === 102) expect(path).toContain("/Images/");
        if (id === 103) expect(path).toContain("/Documents/");
        if (id === 104) expect(path).toContain("/Projects/000090-");
        if (id === 105) expect(path).not.toContain("/Services/");
        if (id === 106) expect(path).toStartWith("Garage documents/");
      }
      expect(paths.some((path) => path.includes("000107-") || path.includes("000108-"))).toBe(false);
      expect(await archive.file(paths.find((path) => path.endsWith("Vehicle photo.png"))!)!.async("nodebuffer")).toEqual(binary);
      const summary = await archive.file(paths.find((path) => path.includes("/000080-") && path.endsWith("Service record.txt"))!)!.async("string");
      expect(summary).toContain("First line\nSecond line"); expect(summary).toContain("100.00 -> 123.45");
      expect(summary).toContain("Unavailable (missing or unsafe file)");
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await archive.file("SumpLog.xlsx")!.async("arraybuffer"));
      const sheet = workbook.getWorksheet("Maintenance")!;
      expect(sheet.getCell("D4").value).toBe(data.maintenance[0].title);
      expect(sheet.getCell("D4").type).toBe(ExcelJS.ValueType.String);
      expect(sheet.getCell("G4").value).toBe(123.45); expect(sheet.getCell("G4").numFmt).toBe("#,##0.00");
      expect(sheet.getCell("H4").value).toBe(1.5);
      expect((sheet.getCell("C4").value as Date).toISOString()).toBe("2026-09-02T00:00:00.000Z");
      expect(sheet.getCell("K5").value).toBe("Voided");
      expect(workbook.getWorksheet("Start here")!.getCell("B7").result).toBe(123.45);
      expect(workbook.getWorksheet("Start here")!.getCell("B9").value).toBe(2);
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
      expect(sheet.getCell("A3").font.bold).toBe(true);
      expect(workbook.getWorksheet("Ownership")!.getCell("G4").value).toBe(1234.56);
    } finally { await archiveResult?.cleanup(); await rm(root, { recursive: true, force: true }); }
  }, 30000);

  it("exports an empty garage and rejects unsafe upload paths and reserved names", async () => {
    const { createReadableArchive, readExportData, exportName, safeExportFile } = await import("./export");
    const { default: JSZip } = await import("jszip");
    const data = readExportData();
    for (const key of Object.keys(data) as (keyof typeof data)[]) data[key] = [];
    const result = await createReadableArchive(data, process.env.UPLOAD_DIRECTORY!);
    try {
      const archive = await JSZip.loadAsync(await Bun.file(result.path).arrayBuffer(), { checkCRC32: true });
      expect(archive.file("SumpLog.xlsx")).not.toBeNull(); expect(result.missingFiles).toBe(0);
    } finally { await result.cleanup(); }
    expect(await Bun.file(result.path).exists()).toBe(false);
    expect(exportName("CON")).toBe("_CON"); expect(exportName("LPT1.txt")).toBe("_LPT1.txt");
    expect(exportName(".. ")).toBe("Untitled"); expect(exportName("a".repeat(100))).toHaveLength(48);
    await expect(safeExportFile(process.env.UPLOAD_DIRECTORY!, testDb)).rejects.toThrow();
    await expect(safeExportFile(process.env.UPLOAD_DIRECTORY!, process.env.UPLOAD_DIRECTORY!)).rejects.toThrow();
    const abort = new AbortController(); abort.abort();
    await expect(createReadableArchive(data, process.env.UPLOAD_DIRECTORY!, abort.signal)).rejects.toThrow();
  }, 30000);

  it("protects ZIP exports with owner authentication", async () => {
    const { Hono } = await import("hono");
    const { installSecurity } = await import("./security");
    const { installReadableExportRoutes } = await import("./export");
    const protectedApp = new Hono(); installSecurity(protectedApp, "export-test-password"); installReadableExportRoutes(protectedApp);
    expect((await protectedApp.request("/api/export/archive.zip")).status).toBe(401);
  });

  it("requires an explicit vehicle delete and removes every owned record and stored file", async () => {
    const createdResponse = await app.request("/api/vehicles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: 2014, make: "Subaru", model: "BRZ", mileage: 71000, mileageDate: "2026-09-02", insuranceProvider: "Garage Mutual", insurancePolicyNumber: "BRZ-42" }) });
    expect(createdResponse.status).toBe(201);
    const vehicle = await createdResponse.json();
    const maintenanceResponse = await app.request(`/api/vehicles/${vehicle.id}/maintenance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Delete test service", category: "Engine", serviceDate: "2026-08-01", mileage: 70000, cost: 20, laborHours: 1, difficulty: 2 }) });
    const maintenance = await maintenanceResponse.json();
    await app.request(`/api/vehicles/${vehicle.id}/specs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupName: "Engine", label: "Delete test torque", value: "20 Nm" }) });
    await app.request(`/api/vehicles/${vehicle.id}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Delete test project", status: "Planned", estimatedBudget: 50, actualCost: 0, tasks: [{ title: "Delete task", completed: false, estimatedCost: 10 }] }) });
    await app.request(`/api/vehicles/${vehicle.id}/service-plans`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Delete test plan", category: "Engine", intervalMileage: 5000, nextDueMileage: 76000, items: ["Inspect"], createReminder: true }) });
    const documentBody = new FormData(); documentBody.append("vehicleId", String(vehicle.id)); documentBody.append("maintenanceId", String(maintenance.id)); documentBody.append("kind", "Receipt"); documentBody.append("file", new File(["delete me"], "delete-test.txt", { type: "text/plain" }));
    const document = await (await app.request("/api/documents", { method: "POST", body: documentBody })).json();
    expect(await Bun.file(document.storagePath).exists()).toBe(true);
    const partResponse = await app.request("/api/parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partNumber: "DELETE-FITMENT-1", name: "Retained inventory part", purchasePrice: 5, quantity: 1, minimumQuantity: 0, vehicleId: vehicle.id }) });
    const part = await partResponse.json();

    const deletedResponse = await app.request(`/api/vehicles/${vehicle.id}`, { method: "DELETE" });
    expect(deletedResponse.status).toBe(200);
    const deleted = await deletedResponse.json();
    expect(deleted.deleted.maintenanceRecords).toBe(1);
    expect(deleted.deleted.documents).toBe(1);
    expect(deleted.deleted.projects).toBe(1);
    expect(deleted.deleted.specifications).toBe(1);
    expect(deleted.deleted.servicePlans).toBe(1);
    expect(deleted.deleted.reminders).toBe(1);
    expect(deleted.deleted.partFitments).toBe(1);
    expect((await app.request(`/api/vehicles/${vehicle.id}/dashboard`)).status).toBe(404);
    expect(await Bun.file(document.storagePath).exists()).toBe(false);
    const retainedPart = await (await app.request(`/api/parts?q=${part.partNumber}`)).json();
    expect(retainedPart).toHaveLength(1);
    expect(retainedPart[0].vehicleId).toBeNull();
  });
});
function jsonRequest(method: string, body: unknown) { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
