import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { photoBytes } from "./photos";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import { ZipArchive } from "archiver";
import type { Hono } from "hono";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { db } from "./db/client";
import * as schema from "./db/schema";

export function readExportData() {
  return db.transaction((tx) => ({
    vehicles: tx.select().from(schema.vehicles).all(), maintenance: tx.select().from(schema.maintenanceRecords).all(),
    documents: tx.select().from(schema.documents).all(), documentMaintenanceLinks: tx.select().from(schema.documentMaintenanceLinks).all(), parts: tx.select().from(schema.parts).all(),
    fitments: tx.select().from(schema.vehicleParts).all(), maintenanceParts: tx.select().from(schema.maintenanceParts).all(),
    mileage: tx.select().from(schema.mileageEntries).all(), specs: tx.select().from(schema.referenceSpecs).all(),
    projects: tx.select().from(schema.projects).all(), projectTasks: tx.select().from(schema.projectTasks).all(),
    plans: tx.select().from(schema.servicePlans).all(), planVehicles: tx.select().from(schema.servicePlanVehicles).all(), planItems: tx.select().from(schema.servicePlanItems).all(),
    reminders: tx.select().from(schema.reminders).all(), audit: tx.select().from(schema.maintenanceAuditLogs).all(),
    insurancePolicies: tx.select().from(schema.insurancePolicies).all(), insurancePolicyVehicles: tx.select().from(schema.insurancePolicyVehicles).all(),
  }));
}
export type ExportData = ReturnType<typeof readExportData>;
type Cell = ExcelJS.CellValue;
type FileEntry = { id: string; trackingId: string | null; originalName: string | null; vehicleId: number | null; maintenanceId: number | null; projectId: number | null; insurancePolicyId: number | null; kind: string; name: string; source: string; path: string; status: string; size: number | null; date: string };

function documentBelongsToMaintenance(data: ExportData, documentId: number, maintenanceId: number, legacyMaintenanceId: number | null) {
  return data.documentMaintenanceLinks.some((link) => link.documentId === documentId && link.maintenanceId === maintenanceId) || (!data.documentMaintenanceLinks.some((link) => link.documentId === documentId) && legacyMaintenanceId === maintenanceId);
}

/** Portable Windows-safe path component. IDs separately guarantee unique archive names. */
export function exportName(value: string, maxLength = 48) {
  let name = value.normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "");
  name = [...name].slice(0, maxLength).join("").replace(/[. ]+$/g, "");
  if (!name) name = "Untitled";
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}
export async function safeExportFile(root: string, path: string) {
  const absoluteRoot = resolve(root), absolutePath = resolve(path);
  const inside = (base: string, target: string) => { const rel = relative(base, target); return Boolean(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel); };
  if (!inside(absoluteRoot, absolutePath)) throw new Error("File is outside the uploads directory.");
  const [actualRoot, actualPath] = await Promise.all([realpath(absoluteRoot), realpath(absolutePath)]);
  if (!inside(actualRoot, actualPath) || !(await stat(actualPath)).isFile()) throw new Error("File is not an allowed upload.");
  return actualPath;
}
const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf", "text/plain": ".txt", "text/csv": ".csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx", "application/vnd.oasis.opendocument.text": ".odt" };
const nameOfVehicle = (v: ExportData["vehicles"][number]) => `${v.year} ${v.make} ${v.model}${v.nickname ? ` - ${v.nickname}` : ""}`;
const idName = (id: number, name: string) => `${String(id).padStart(6, "0")}-${exportName(name)}`;
const money = (cents: number | null) => cents == null ? null : cents / 100;
const date = (value: string | null): Cell => {
  if (!value) return null;
  const normalized = value.replace(" ", "T");
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
};
const link = (path: string, text = path): Cell => ({ text, hyperlink: path.split("/").map(encodeURIComponent).join("/") });
const fieldName = (key: string) => key.replace(/Cents$/, " (recorded currency)").replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
function auditChanges(log: ExportData["audit"][number]) {
  try {
    const before = JSON.parse(log.beforeJson ?? "{}") as Record<string, unknown>;
    const after = JSON.parse(log.afterJson) as Record<string, unknown>;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map((key) => {
      const display = (value: unknown) => value == null ? "" : key.endsWith("Cents") && typeof value === "number" ? (value / 100).toFixed(2) : typeof value === "object" ? JSON.stringify(value) : String(value);
      return { field: fieldName(key), before: display(before[key]), after: display(after[key]) };
    });
  } catch { return [{ field: "History detail", before: log.beforeJson ?? "", after: log.afterJson }]; }
}

function exportLayout(data: ExportData) {
  const vehicleFolders = new Map(data.vehicles.map((v) => [v.id, `Vehicles/${idName(v.id, nameOfVehicle(v))}`]));
  const vehicleFolder = (id: number | null) => vehicleFolders.get(id ?? -1) ?? "Garage documents";
  const serviceFolders = new Map(data.maintenance.map((r) => [r.id, `${vehicleFolder(r.vehicleId)}/Services/${idName(r.id, `${r.serviceDate}-${r.title}`)}`]));
  const projectFolders = new Map(data.projects.map((r) => [r.id, `${vehicleFolder(r.vehicleId)}/Projects/${idName(r.id, r.title)}`]));
  const insuranceFolders = new Map(data.insurancePolicies.map((policy) => [policy.id, `Insurance/${idName(policy.id, `${policy.provider}-${policy.policyNumber ?? "policy"}`)}`]));
  const files: FileEntry[] = data.documents.map((doc) => {
    const folder = serviceFolders.get(doc.maintenanceId ?? -1) ?? projectFolders.get(doc.projectId ?? -1) ?? insuranceFolders.get(doc.insurancePolicyId ?? -1) ?? `${vehicleFolder(doc.vehicleId)}/Documents`;
    const extension = extensions[doc.mimeType?.split(";")[0] ?? ""] ?? extensions[Bun.file(doc.storagePath).type] ?? ".bin";
    const leaf = basename(doc.name.replaceAll("\\", "/"));
    const label = leaf.toLowerCase().endsWith(extension) ? leaf.slice(0, -extension.length) : leaf;
    return { id: `document-${doc.id}`, trackingId: doc.trackingId, originalName: doc.originalName, vehicleId: doc.vehicleId, maintenanceId: doc.maintenanceId, projectId: doc.projectId, insurancePolicyId: doc.insurancePolicyId, kind: doc.kind, name: doc.name, source: doc.storagePath, path: `${folder}/${doc.kind === "Receipt" ? "Receipts" : doc.kind === "Photo" ? "Images" : "Documents"}/${idName(doc.id, label)}${extension}`, status: "Pending", size: null, date: doc.createdAt };
  });
  for (const vehicle of data.vehicles) if (vehicle.imageUrl) files.push({ id: `vehicle-photo-${vehicle.id}`, trackingId: null, originalName: null, vehicleId: vehicle.id, maintenanceId: null, projectId: null, insurancePolicyId: null, kind: "Vehicle photo", name: `${nameOfVehicle(vehicle)} photo`, source: vehicle.imageUrl, path: `${vehicleFolder(vehicle.id)}/Vehicle photo${extensions[Bun.file(vehicle.imageUrl).type] ?? ".bin"}`, status: "Pending", size: null, date: vehicle.updatedAt });
  return { vehicleFolders, serviceFolders, projectFolders, insuranceFolders, files };
}

type Column = string | { label: string; width?: number; format?: string };
function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], values: Cell[][]) {
  if (values.length > 1_048_573) throw new Error("Too many rows for an Excel worksheet.");
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3, showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const definitions = columns.map((col) => typeof col === "string" ? { label: col } : col);
  sheet.columns = definitions.map((col) => ({ width: col.width ?? (/notes|description|before|after|path|folder/i.test(col.label) ? 48 : /vehicle|title|name|item|detail/i.test(col.label) ? 30 : 20) }));
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = `SumpLog / ${name}`;
  sheet.getRow(1).height = 30;
  sheet.getCell(1, 1).font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF212C36" } };
  sheet.mergeCells(2, 1, 2, columns.length);
  sheet.getCell(2, 1).value = "Distances in miles. Amounts in recorded currency; no currency conversion. Extract the whole ZIP before opening file links.";
  sheet.getCell(2, 1).font = { name: "Calibri", size: 10, color: { argb: "FF526170" } };
  sheet.getRow(2).height = 30;
  sheet.getCell(2, 1).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(3).values = definitions.map((col) => col.label);
  sheet.getRow(3).height = 32;
  sheet.getRow(3).eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF27343F" } }; cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } }; cell.alignment = { wrapText: true, vertical: "middle" }; });
  for (const valuesRow of values) {
    // Only explicit formula objects execute. User-entered strings remain literal text, even starting with '='.
    const row = sheet.addRow(valuesRow.map((value) => value === "" ? null : typeof value === "string" && value.length > 32_700 ? `${value.slice(0, 32_600)}\n[Continued in the service-record text file / JSON backup]` : value));
    let lines = 1;
    row.eachCell({ includeEmpty: true }, (cell, index) => {
      const col = definitions[index - 1];
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF263441" } };
      cell.alignment = { vertical: "top", wrapText: true };
      if (row.number % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F6" } };
      if (cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd";
      else if (typeof cell.value === "number") cell.numFmt = col.format ?? (/cost|price|premium|budget/i.test(col.label) ? "#,##0.00" : /hours/i.test(col.label) ? "0.0" : /(^Year$| ID$|Position)/i.test(col.label) ? "0" : "#,##0");
      if (cell.type === ExcelJS.ValueType.Hyperlink) cell.font = { name: "Calibri", size: 11, underline: true, color: { argb: "FF165D9C" } };
      const displayText = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text;
      lines = Math.max(lines, ...displayText.split("\n").map((line) => Math.ceil(line.length / Math.max(10, (sheet.getColumn(index).width ?? 20) - 2))));
    });
    row.height = Math.min(409, Math.max(30, lines * 15 + 6));
  }
  if (!values.length) { sheet.getCell(4, 1).value = "No records"; sheet.getCell(4, 1).font = { italic: true, color: { argb: "FF526170" } }; }
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, 3 + values.length), column: columns.length } };
  sheet.pageSetup.printTitlesRow = "1:3";
  return sheet;
}

export function buildExportWorkbook(data: ExportData, layout: ReturnType<typeof exportLayout>, exportedAt: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SumpLog"; workbook.created = new Date(exportedAt); workbook.modified = new Date(exportedAt);
  const vehicleNames = new Map(data.vehicles.map((v) => [v.id, nameOfVehicle(v)]));
  const vehicle = (id: number | null) => vehicleNames.get(id ?? -1) ?? "General garage";
  const serviceNames = new Map(data.maintenance.map((r) => [r.id, r.title]));
  const projectNames = new Map(data.projects.map((r) => [r.id, r.title]));
  const planNames = new Map(data.plans.map((r) => [r.id, r.title]));
  const planVehicles = new Map<number, string[]>();
  for (const link of data.planVehicles) planVehicles.set(link.servicePlanId, [...(planVehicles.get(link.servicePlanId) ?? []), vehicle(link.vehicleId)]);
  const partNames = new Map(data.parts.map((r) => [r.id, `${r.partNumber} - ${r.name}`]));
  const problems = layout.files.filter((file) => file.status !== "Included");
  const costTotal = data.maintenance.filter((r) => !r.voidedAt).reduce((sum, r) => sum + r.costCents, 0) / 100;
  addSheet(workbook, "Start here", [{ label: "Item", width: 30 }, { label: "Value", width: 28 }, { label: "Details", width: 84 }], [
    ["Exported (UTC)", exportedAt, "This export includes the entire garage, not just the selected vehicle."],
    ["Vehicles", data.vehicles.length, "Vehicle, ownership and insurance details are on separate sheets."],
    ["Service records", data.maintenance.length, "Includes voided records, clearly labeled; voided costs are excluded from the total."],
    ["Service cost total", data.maintenance.length ? { formula: `SUMIF('Maintenance'!K4:K${data.maintenance.length + 3},"Active",'Maintenance'!G4:G${data.maintenance.length + 3})`, result: costTotal } : 0, "Recorded currency, not converted. Totals are not meaningful if amounts were entered in mixed currencies."],
    ["Files included", layout.files.length - problems.length, "Use the Files sheet to open receipts, images and documents after extracting the whole ZIP."],
    ["Files unavailable", problems.length, problems.length ? "CHECK THE FILES SHEET: missing or unsafe files are listed, not silently omitted." : "All referenced files were included."],
    ["How to open", "Extract all files first", "Open SumpLog.xlsx from the extracted folder. Keep the workbook and folders together so relative file links work."],
    ["Service folders", "Vehicles / vehicle / Services", "Every service has its own dated folder, a Service record.txt summary, and attachment folders."],
    ["Other files", "Vehicle / project / garage folders", "Unlinked documents and vehicle photos are retained separately, not assigned to an unrelated service."],
    ["Long text", "Wrap text / expand formula bar", "Excel cells have a 32,767-character limit. Full service and history text is retained in each Service record.txt. JSON backup retains original database values."],
    ["Restore", "Use Full JSON backup", "The ZIP is a readable export, not the JSON restore format. Keep a JSON backup for a full SumpLog restore."],
    ["Privacy", "Contains private garage records", "Insurance details, receipts and photos are included. Store and share this archive carefully."],
  ]);
  workbook.getWorksheet("Start here")!.getCell("B7").numFmt = "#,##0.00";
  addSheet(workbook, "Vehicles", ["Vehicle ID", "Year", "Make", "Model", "Trim", "Nickname", "VIN", "Mileage (mi)", "Yearly estimate (mi)", "Color", "Body style", "Fuel", "Drivetrain", "Engine", "Transmission", "Folder"], data.vehicles.map((v) => [v.id, v.year, v.make, v.model, v.trim, v.nickname, v.vin, v.mileage, v.annualMileageEstimate, v.color, v.bodyStyle, v.fuelType, v.drivetrain, v.engine, v.transmission, link(`${layout.vehicleFolders.get(v.id)}/Vehicle.txt`, "Open vehicle summary")]));
  addSheet(workbook, "Ownership", ["Vehicle", "License plate", "State or province", "Registration number", "Registration expiry", "Purchase date", "Purchase price", "Notes"], data.vehicles.map((v) => [vehicle(v.id), v.licensePlate, v.registrationState, v.registrationNumber, date(v.registrationExpiresAt), date(v.purchaseDate), money(v.purchasePriceCents), v.notes]));
  addSheet(workbook, "Insurance", ["Policy ID", "Provider", "Policy number", "Linked vehicles", "Agent", "Phone", "Effective date", "Expiry date", "Premium", "Notes", "Folder"], data.insurancePolicies.map((policy) => [policy.id, policy.provider, policy.policyNumber, data.insurancePolicyVehicles.filter((link) => link.insurancePolicyId === policy.id).map((link) => vehicle(link.vehicleId)).join("; "), policy.agentName, policy.agentPhone, date(policy.effectiveAt), date(policy.expiresAt), money(policy.premiumCents), policy.notes, link(`${layout.insuranceFolders.get(policy.id)}/Policy.txt`, "Open policy summary")]));
  addSheet(workbook, "Maintenance", ["Service ID", "Vehicle", "Service date", "Title", "System", "Mileage (mi)", "Cost", "Labor hours", "Difficulty (1-5)", "Shop", "Status", "Next due date", "Next due mileage (mi)", "Notes", "Record and attachments"], data.maintenance.map((r) => [r.id, vehicle(r.vehicleId), date(r.serviceDate), r.title, r.category, r.mileage, money(r.costCents), r.laborHours, r.difficulty, r.shopName, r.voidedAt ? "Voided" : "Active", date(r.nextDueDate), r.nextDueMileage, r.notes, link(`${layout.serviceFolders.get(r.id)}/Service record.txt`, "Open service folder summary")]));
  addSheet(workbook, "Files", ["File ID", "Tracking UUID", "Display name", "Original filename", "Vehicle", "Service ID", "Service title", "Project", "Insurance policy", "Type", "Status", "Size (bytes)", "Uploaded date", "File path"], layout.files.map((f) => [f.id, f.trackingId, f.name, f.originalName, vehicle(f.vehicleId), f.maintenanceId, serviceNames.get(f.maintenanceId ?? -1) ?? "", projectNames.get(f.projectId ?? -1) ?? "", data.insurancePolicies.find((policy) => policy.id === f.insurancePolicyId)?.provider ?? "", f.kind, f.status, f.size, date(f.date), f.status === "Included" ? link(f.path) : f.path]));
  addSheet(workbook, "File service links", ["File ID", "Service ID", "Service title"], data.documentMaintenanceLinks.map((row) => [row.documentId, row.maintenanceId, serviceNames.get(row.maintenanceId) ?? ""]));
  addSheet(workbook, "Mileage", ["Reading ID", "Vehicle", "Date", "Odometer (mi)", "Yearly estimate (mi)", "Notes"], data.mileage.map((r) => [r.id, vehicle(r.vehicleId), date(r.recordedDate), r.mileage, r.annualMileageEstimate, r.notes]));
  addSheet(workbook, "Parts", ["Part ID", "Part number", "Name", "Manufacturer", "Supplier", "Supplier URL", "Unit price", "Quantity", "Volume per unit", "Volume unit", "Minimum quantity", "Storage location", "Notes"], data.parts.map((r) => [r.id, r.partNumber, r.name, r.manufacturer, r.supplierName, r.supplierUrl, money(r.purchasePriceCents), r.quantity, r.volumePerUnit, r.volumeUnit, r.minimumQuantity, r.storageLocation, r.notes]));
  addSheet(workbook, "Vehicle fitments", ["Vehicle", "Part ID", "Part", "Fitment notes"], data.fitments.map((r) => [vehicle(r.vehicleId), r.partId, partNames.get(r.partId) ?? "", r.fitmentNotes]));
  addSheet(workbook, "Service parts", ["Service ID", "Service title", "Part ID", "Part", "Usage", "Amount used", "Amount unit", "Equivalent units", "Unit cost", "Cost used"], data.maintenanceParts.map((r) => [r.maintenanceId, serviceNames.get(r.maintenanceId) ?? "", r.partId, partNames.get(r.partId) ?? "", r.usageMode, r.amountUsed ?? "", r.amountUnit ?? "", r.quantity, money(r.unitCostCents), money(Math.round(r.quantity * r.unitCostCents))]));
  addSheet(workbook, "Specifications", ["Spec ID", "Vehicle", "Group", "Specification", "Value", "Source", "Notes"], data.specs.map((r) => [r.id, vehicle(r.vehicleId), r.groupName, r.label, r.value, r.source, r.notes]));
  addSheet(workbook, "Projects", ["Project ID", "Vehicle", "Title", "Description", "Status", "Estimated budget", "Actual cost", "Target date"], data.projects.map((r) => [r.id, vehicle(r.vehicleId), r.title, r.description, r.status, money(r.estimatedBudgetCents), money(r.actualCostCents), date(r.targetDate)]));
  addSheet(workbook, "Project tasks", ["Task ID", "Project", "Task", "Completed", "Estimated cost", "Position"], data.projectTasks.map((r) => [r.id, projectNames.get(r.projectId) ?? "", r.title, r.completed ? "Yes" : "No", money(r.estimatedCostCents), r.position]));
  addSheet(workbook, "Service schedules", ["Schedule ID", "Vehicle(s)", "Title", "System", "Interval (mi)", "Interval (months)", "Next due mileage (mi)", "Next due date", "Active", "Notes"], data.plans.map((r) => [r.id, planVehicles.get(r.id)?.join("; ") || vehicle(r.vehicleId), r.title, r.category, r.intervalMileage, r.intervalMonths, r.nextDueMileage, date(r.nextDueDate), r.active ? "Yes" : "No", r.notes]));
  addSheet(workbook, "Schedule tasks", ["Task ID", "Schedule", "Task", "Notes", "Position"], data.planItems.map((r) => [r.id, planNames.get(r.servicePlanId) ?? "", r.title, r.notes, r.position]));
  addSheet(workbook, "Reminders", ["Reminder ID", "Vehicle", "Title", "Schedule", "Due date", "Due mileage (mi)", "Status", "Notes"], data.reminders.map((r) => [r.id, vehicle(r.vehicleId), r.title, planNames.get(r.servicePlanId ?? -1) ?? "", date(r.dueDate), r.dueMileage, r.status, r.notes]));
  addSheet(workbook, "Change history", ["Audit ID", "Service ID", "Service title", "Changed at (UTC)", "Operation", "Summary", "Field", "Before", "After"], data.audit.flatMap((r) => {
    const changes = auditChanges(r);
    return (changes.length ? changes : [{ field: "", before: "", after: "" }]).map((change) => [r.id, r.maintenanceId, serviceNames.get(r.maintenanceId) ?? "", r.changedAt, r.operation, r.summary, change.field, change.before, change.after]);
  }));
  return workbook;
}

export async function createReadableArchive(data: ExportData, uploads: string, signal?: AbortSignal) {
  const temporary = await mkdtemp(join(tmpdir(), "sumplog-export-"));
  const path = join(temporary, "export.zip");
  const cleanup = () => rm(temporary, { recursive: true, force: true });
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = pipeline(archive, createWriteStream(path, { mode: 0o600 }));
  void output.catch(() => undefined);
  archive.on("warning", (error) => archive.destroy(error));
  const add = async (name: string, value: string | Buffer) => {
    signal?.throwIfAborted();
    const done = once(archive, "entry");
    archive.append(value, { name, date: new Date(), mode: 0o600 });
    await done;
  };
  try {
    const layout = exportLayout(data);
    for (const file of layout.files) {
      let bytes: Buffer;
      try { const allowed = await safeExportFile(uploads, file.source); bytes = await readFile(allowed); }
      catch { file.status = "Unavailable (missing or unsafe file)"; continue; }
      await add(file.path, bytes);
      file.size = bytes.length; file.status = "Included";
    }
    for (const v of data.vehicles) {
      const fields = Object.entries(v).filter(([key]) => key !== "imageUrl").map(([key, value]) => `${fieldName(key)}: ${key.endsWith("Cents") ? money(value as number | null) ?? "Not recorded" : value ?? "Not recorded"}`);
      await add(`${layout.vehicleFolders.get(v.id)}/Vehicle.txt`, `SumpLog vehicle summary\n${fields.join("\n")}\n`);
    }
    for (const record of data.maintenance) {
      const fields = Object.entries(record).map(([key, value]) => `${fieldName(key)}: ${key.endsWith("Cents") ? money(value as number | null) : value ?? "Not recorded"}`);
      const files = layout.files.filter((f) => documentBelongsToMaintenance(data, Number(f.id.replace("document-", "")), record.id, f.maintenanceId)).map((f) => `${f.status}: ${f.path}`);
      const history = data.audit.filter((r) => r.maintenanceId === record.id).map((log) => `${log.changedAt} UTC / ${log.operation}\n${log.summary ?? ""}\n${auditChanges(log).map((change) => `${change.field}: ${change.before || "(empty)"} -> ${change.after || "(empty)"}`).join("\n")}`);
      await add(`${layout.serviceFolders.get(record.id)}/Service record.txt`, `SumpLog service record\nVehicle ID: ${record.vehicleId}\nStatus: ${record.voidedAt ? "VOIDED" : "Active"}\nAmounts in recorded currency; distances in miles.\n\n${fields.join("\n")}\n\nATTACHMENTS\n${files.join("\n") || "No attachments"}\n\nCHANGE HISTORY\n${history.join("\n\n") || "No changes recorded"}\n`);
    }
    for (const policy of data.insurancePolicies) {
      const fields = Object.entries(policy).filter(([key]) => key !== "legacySourceVehicleId").map(([key, value]) => `${fieldName(key)}: ${key.endsWith("Cents") ? money(value as number | null) ?? "Not recorded" : value ?? "Not recorded"}`);
      const linkedVehicles = data.insurancePolicyVehicles.filter((link) => link.insurancePolicyId === policy.id).map((link) => data.vehicles.find((vehicle) => vehicle.id === link.vehicleId)).filter((vehicle): vehicle is ExportData["vehicles"][number] => Boolean(vehicle)).map(nameOfVehicle);
      const files = layout.files.filter((file) => file.insurancePolicyId === policy.id).map((file) => `${file.status}: ${file.path.slice(layout.insuranceFolders.get(policy.id)!.length + 1)}`);
      await add(`${layout.insuranceFolders.get(policy.id)}/Policy.txt`, `SumpLog insurance policy\n\n${fields.join("\n")}\n\nLINKED VEHICLES\n${linkedVehicles.join("\n") || "No vehicles currently linked"}\n\nATTACHMENTS\n${files.join("\n") || "No attachments"}\n`);
    }
    const exportedAt = new Date().toISOString();
    const workbook = buildExportWorkbook(data, layout, exportedAt);
    await add("SumpLog.xlsx", Buffer.from(await workbook.xlsx.writeBuffer()));
    const missing = layout.files.filter((f) => f.status !== "Included");
    await add("Read me.txt", `SumpLog readable garage export\nExported: ${exportedAt}\n\nExtract the entire ZIP before opening SumpLog.xlsx. Keep the workbook and folders together for file links.\n\nAll vehicles and service records are included, including voided records and change history. Every service folder contains Service record.txt. Receipts, images and documents live inside the associated service folder. Unlinked files and vehicle photos live in vehicle, project or general garage folders.\n\nDistances are in miles. Monetary values are in the original recorded currency, not converted. No predicted mileage is exported as an actual reading.\n\nFiles included: ${layout.files.length - missing.length}\nFiles unavailable: ${missing.length}\n${missing.map((f) => `${f.id}: ${f.name} - ${f.status}`).join("\n")}\n\nThis ZIP is a human-readable export, not a restorable JSON backup. Use Full JSON backup in Settings for SumpLog restoration. The archive contains private insurance details, receipts and photos; store it securely.\n`);
    await archive.finalize();
    await output;
    return { path, cleanup, missingFiles: missing.length };
  } catch (error) {
    archive.destroy(error instanceof Error ? error : new Error("Export failed"));
    await output.catch(() => undefined);
    await cleanup();
    throw error;
  }
}

export function installReadableExportRoutes(app: Hono) {
  let generating = false;
  app.get("/api/export/archive.zip", async (c) => {
    if (generating) { c.header("Retry-After", "10"); return c.json({ error: "An export is already being prepared. Try again shortly." }, 429); }
    generating = true;
    let result: Awaited<ReturnType<typeof createReadableArchive>>;
    try { result = await createReadableArchive(readExportData(), resolve(process.env.UPLOAD_DIRECTORY ?? "data/uploads"), c.req.raw.signal); }
    catch { return c.json({ error: "The ZIP export could not be prepared. Check server disk space and try again. Your garage is unchanged." }, 500); }
    finally { generating = false; }
    const file = Bun.file(result.path), reader = file.stream().getReader();
    const cleanup = () => result.cleanup().catch(() => undefined);
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) { try { const next = await reader.read(); if (next.done) { controller.close(); await cleanup(); } else controller.enqueue(next.value); } catch (error) { controller.error(error); await reader.cancel().catch(() => undefined); await cleanup(); } },
      async cancel(reason) { await reader.cancel(reason).catch(() => undefined); await cleanup(); },
    });
    return c.newResponse(body, 200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="sumplog-${new Date().toISOString().slice(0, 10)}.zip"`, "Content-Length": String(file.size), "Cache-Control": "no-store", "X-SumpLog-Missing-Files": String(result.missingFiles) });
  });

  app.get("/api/export/maintenance.pdf", async (c) => {
    const rawIds = c.req.query("ids")?.split(",").filter(Boolean) ?? [];
    const ids = rawIds.length ? [...new Set(rawIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : undefined;
    if (rawIds.length && !ids?.length) return c.json({ error: "Choose one or more valid maintenance records." }, 422);
    const data = readExportData();
    const records = data.maintenance.filter((record) => !ids || ids.includes(record.id));
    if (!records.length) return c.json({ error: "No maintenance records were found for this report." }, 404);
    try {
      const bytes = await createMaintenancePdf(data, records.map((record) => record.id), resolve(process.env.UPLOAD_DIRECTORY ?? "data/uploads"));
      return c.newResponse(bytes as unknown as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="sumplog-maintenance-${new Date().toISOString().slice(0, 10)}.pdf"`, "Cache-Control": "no-store" });
    } catch {
      return c.json({ error: "The maintenance report could not be prepared. Your garage is unchanged." }, 500);
    }
  });
}

const reportTheme = {
  canvas: "#ffffff",
  surface: "#f2f4f6",
  ink: "#1d2730",
  inkSoft: "#35424e",
  muted: "#66737f",
  rule: "#d4dbe1",
  accent: "#bd7807",
  accentSoft: "#fff1d1",
  danger: "#b42318",
};

function reportPage(document: PDFKit.PDFDocument) {
  document.rect(0, 0, 612, 792).fill(reportTheme.canvas);
  document.rect(0, 0, 612, 7).fill(reportTheme.accent);
  document.fillColor(reportTheme.ink);
}

function reportSection(document: PDFKit.PDFDocument, title: string) {
  document.moveDown(0.75);
  const top = document.y;
  document.roundedRect(48, top - 4, 516, 22, 4).fill(reportTheme.surface);
  document.fillColor(reportTheme.accent).font("Helvetica-Bold").fontSize(8).text(title.toUpperCase(), 60, top + 2);
  document.y = top + 27;
  document.fillColor(reportTheme.ink).font("Helvetica").fontSize(10);
}

function pdfText(document: PDFKit.PDFDocument, label: string, value: unknown) {
  document.fillColor(reportTheme.muted).font("Helvetica-Bold").text(`${label}: `, { continued: true }).fillColor(reportTheme.ink).font("Helvetica").text(String(value ?? "Not recorded"));
}

async function createMaintenancePdf(data: ExportData, recordIds: number[], uploadRoot: string) {
  const document = new PDFDocument({ size: "LETTER", margin: 48, bufferPages: true, info: { Title: "SumpLog maintenance report", Author: "SumpLog" } });
  const pdfReceipts: Array<{ record: ExportData["maintenance"][number]; file: ExportData["documents"][number] }> = [];
  const evidenceImages: Array<{ record: ExportData["maintenance"][number]; file: ExportData["documents"][number] }> = [];
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolvePromise, reject) => { document.on("data", (chunk: Buffer) => chunks.push(chunk)); document.on("end", () => resolvePromise(Buffer.concat(chunks))); document.on("error", reject); });
  const selected = data.maintenance.filter((record) => recordIds.includes(record.id)).sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || b.id - a.id);
  const sections: Array<{ recordId: number; start: number; end: number }> = [];
  reportPage(document);
  document.fillColor(reportTheme.accent).font("Helvetica-Bold").fontSize(9).text("SUMPLOG / SERVICE LEDGER");
  document.moveDown(0.55).fillColor(reportTheme.ink).font("Helvetica-Bold").fontSize(25).text("Maintenance report");
  document.moveDown(0.3).fillColor(reportTheme.muted).font("Helvetica").fontSize(9).text(`Generated ${new Date().toLocaleString()} · ${selected.length} record${selected.length === 1 ? "" : "s"}`);
  document.moveDown(2).strokeColor(reportTheme.rule).lineWidth(1).moveTo(48, document.y).lineTo(564, document.y).stroke();
  document.moveDown(0.8).fillColor(reportTheme.inkSoft).font("Helvetica").fontSize(11).text("A complete service ledger with record details, attached receipt PDFs, and photo evidence grouped in service order.", { width: 420 });
  for (const record of selected) {
    sections.push({ recordId: record.id, start: document.bufferedPageRange().count, end: 0 });
    document.addPage();
    reportPage(document);
    const vehicle = data.vehicles.find((item) => item.id === record.vehicleId);
    const recordParts = data.maintenanceParts.filter((item) => item.maintenanceId === record.id);
    const evidence = data.documents.filter((item) => documentBelongsToMaintenance(data, item.id, record.id, item.maintenanceId));
    document.fillColor(reportTheme.accent).font("Helvetica-Bold").fontSize(8).text("MAINTENANCE RECORD");
    document.moveDown(0.3).fillColor(reportTheme.ink).font("Helvetica-Bold").fontSize(19).text(record.title);
    document.moveDown(0.25).fillColor(reportTheme.muted).font("Helvetica").fontSize(10).text(`${vehicle ? nameOfVehicle(vehicle) : "Unknown vehicle"} · ${record.serviceDate}`);
    const contentStart = document.y;
    const status = record.voidedAt ? "VOIDED" : "ACTIVE";
    const statusColor = record.voidedAt ? reportTheme.danger : reportTheme.accent;
    const statusWidth = record.voidedAt ? 52 : 48;
    const statusX = 516 - statusWidth;
    document.roundedRect(statusX, 48, statusWidth, 18, 3).fill(record.voidedAt ? "#fdecea" : reportTheme.accentSoft);
    document.fillColor(statusColor).font("Helvetica-Bold").fontSize(7).text(status, statusX + 4, 54, { width: statusWidth - 8, align: "center" });
    document.y = contentStart;
    reportSection(document, "Service details");
    pdfText(document, "System", record.category); pdfText(document, "Mileage", `${record.mileage.toLocaleString()} mi`); pdfText(document, "Recorded cost", `$${(record.costCents / 100).toFixed(2)}`); pdfText(document, "Labor", `${record.laborHours} hr`); pdfText(document, "Difficulty", `${record.difficulty}/5`); pdfText(document, "Shop / helper", record.shopName);
    if (record.nextDueMileage != null || record.nextDueDate) pdfText(document, "Next due", [record.nextDueMileage != null ? `${record.nextDueMileage.toLocaleString()} mi` : "", record.nextDueDate].filter(Boolean).join(" · "));
    if (record.notes) { reportSection(document, "Notes"); document.fillColor(reportTheme.inkSoft).font("Helvetica").text(record.notes); }
    if (recordParts.length) { reportSection(document, "Parts used"); for (const part of recordParts) { const source = data.parts.find((item) => item.id === part.partId); const usage = part.usageMode === "Partial" && part.amountUsed != null ? `${part.amountUsed} ${part.amountUnit ?? ""} used from` : `${part.quantity} ×`; document.fillColor(reportTheme.ink).text(`${usage} ${source?.name ?? `Part #${part.partId}`} (${source?.partNumber ?? "part number not recorded"}) · $${(Math.round(part.quantity * part.unitCostCents) / 100).toFixed(2)} used`); } }
    const history = data.audit.filter((item) => item.maintenanceId === record.id);
    if (history.length) { reportSection(document, "Change history"); for (const entry of history) document.fillColor(reportTheme.inkSoft).text(`${entry.changedAt} · ${entry.operation}${entry.summary ? ` · ${entry.summary}` : ""}`); }
    reportSection(document, `Evidence & attachments (${evidence.length})`);
    for (const file of evidence.sort((a, b) => Number(b.kind === "Receipt" && a.mimeType === "application/pdf") - Number(a.kind === "Receipt" && b.mimeType === "application/pdf"))) {
      document.fillColor(reportTheme.inkSoft).text(`${file.kind}: ${file.name}${file.sizeBytes != null ? ` (${Math.ceil(file.sizeBytes / 1024)} KB)` : ""}`);
      try { await safeExportFile(uploadRoot, file.storagePath); if (file.kind === "Receipt" && file.mimeType === "application/pdf") pdfReceipts.push({ record, file }); if (/^image\/(jpeg|png|webp)$/i.test(file.mimeType ?? "")) evidenceImages.push({ record, file }); } catch { document.fillColor(reportTheme.danger).text("  File unavailable when report was generated.").fillColor(reportTheme.ink); }
    }
  }
  const totalPages = document.bufferedPageRange().count;
  sections.forEach((section, index) => { section.end = sections[index + 1]?.start ?? totalPages; });
  document.end();
  return mergeMaintenanceEvidence(await complete, data, recordIds, sections, pdfReceipts, evidenceImages, uploadRoot);
}

async function imageEvidencePage(record: ExportData["maintenance"][number], file: ExportData["documents"][number], uploadRoot: string) {
  const document = new PDFDocument({ size: "LETTER", margin: 48 }); const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolvePromise, reject) => { document.on("data", (chunk: Buffer) => chunks.push(chunk)); document.on("end", () => resolvePromise(Buffer.concat(chunks))); document.on("error", reject); });
  const source = await safeExportFile(uploadRoot, file.storagePath);
  reportPage(document);
  document.fillColor(reportTheme.accent).font("Helvetica-Bold").fontSize(8).text("PHOTO EVIDENCE");
  document.moveDown(0.35).fillColor(reportTheme.ink).font("Helvetica-Bold").fontSize(14).text(record.title);
  document.moveDown(0.2).fillColor(reportTheme.muted).font("Helvetica").fontSize(9).text(file.name);
  document.roundedRect(40, 94, 532, 622, 5).fill(reportTheme.surface);
  document.image(await photoBytes(source, file.photoRotation ?? 0), 52, 106, { fit: [508, 590], align: "center", valign: "center" });
  document.font("Helvetica").fontSize(8).fillColor(reportTheme.muted).text("Evidence image embedded in this SumpLog maintenance report.", 48, 738); document.end();
  return complete;
}

async function mergeMaintenanceEvidence(base: Buffer, data: ExportData, recordIds: number[], sections: Array<{ recordId: number; start: number; end: number }>, receipts: Array<{ record: ExportData["maintenance"][number]; file: ExportData["documents"][number] }>, images: Array<{ record: ExportData["maintenance"][number]; file: ExportData["documents"][number] }>, uploadRoot: string) {
  const output = await PdfLibDocument.create(); const report = await PdfLibDocument.load(base);
  const addPages = async (source: PdfLibDocument, indices: number[]) => { const pages = await output.copyPages(source, indices); pages.forEach((page) => output.addPage(page)); };
  if (sections[0]?.start) await addPages(report, Array.from({ length: sections[0].start }, (_, index) => index));
  for (const section of sections) {
    await addPages(report, Array.from({ length: section.end - section.start }, (_, index) => section.start + index));
    for (const { file } of receipts.filter((entry) => entry.record.id === section.recordId)) { try { const receipt = await PdfLibDocument.load(await readFile(await safeExportFile(uploadRoot, file.storagePath))); await addPages(receipt, receipt.getPageIndices()); } catch { /* The generated evidence list identifies unavailable or unreadable receipts. */ } }
    for (const { record, file } of images.filter((entry) => entry.record.id === section.recordId)) { try { const image = await PdfLibDocument.load(await imageEvidencePage(record, file, uploadRoot)); await addPages(image, [0]); } catch { /* The generated evidence list identifies unavailable images. */ } }
  }
  for (const file of data.documents.filter((item) => recordIds.some((recordId) => documentBelongsToMaintenance(data, item.id, recordId, item.maintenanceId)))) { try { const bytes = await readFile(await safeExportFile(uploadRoot, file.storagePath)); await output.attach(bytes, exportName(file.name, 100), { mimeType: file.mimeType ?? "application/octet-stream", description: `${file.kind} evidence from SumpLog` }); } catch { /* Missing files remain listed in the report. */ } }
  return Buffer.from(await output.save());
}
