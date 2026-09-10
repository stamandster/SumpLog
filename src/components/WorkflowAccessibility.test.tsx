import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentRecord, ReferenceSpec, Vehicle, MaintenanceRecord } from "../api";
import { DocumentsView, MaintenanceView, SpecsView } from "./ModuleViews";
import { DocumentDialog } from "./ManagementDialogs";
import { MobileNav } from "./Sidebar";
import { PartsCatalogue } from "./PartsCatalogue";
import { MaintenanceDialog } from "./MaintenanceDialog";

const vehicles: Vehicle[] = [
  { id: 1, year: 1989, make: "BMW", model: "325i", nickname: "E30", mileage: 126420, vin: null, trim: null, color: null, bodyStyle: null, fuelType: null, drivetrain: null, engine: null, transmission: null, licensePlate: null, registrationState: null, registrationNumber: null, purchaseDate: null, purchasePriceCents: null, insuranceProvider: null, insurancePolicyNumber: null, insuranceAgentName: null, insuranceAgentPhone: null, insuranceEffectiveAt: null, insuranceExpiresAt: null, insurancePremiumCents: null, insuranceNotes: null, registrationExpiresAt: null, imageUrl: null, annualMileageEstimate: null, notes: null },
  { id: 2, year: 2005, make: "Toyota", model: "Tacoma", nickname: null, mileage: 98000, vin: null, trim: null, color: null, bodyStyle: null, fuelType: null, drivetrain: null, engine: null, transmission: null, licensePlate: null, registrationState: null, registrationNumber: null, purchaseDate: null, purchasePriceCents: null, insuranceProvider: null, insurancePolicyNumber: null, insuranceAgentName: null, insuranceAgentPhone: null, insuranceEffectiveAt: null, insuranceExpiresAt: null, insurancePremiumCents: null, insuranceNotes: null, registrationExpiresAt: null, imageUrl: null, annualMileageEstimate: null, notes: null },
];

const spec: ReferenceSpec = { id: 1, vehicleId: 1, groupName: "Engine", label: "Oil capacity", value: "5 qt", source: "Manual", notes: null };
const document: DocumentRecord = { id: 1, trackingId: "80ae1b30-d834-43cb-8d20-a62776375c2c", originalName: "warranty-scan.pdf", vehicleId: 1, maintenanceId: 1, kind: "Warranty", name: "Purolator warranty", mimeType: "application/pdf", sizeBytes: 100, createdAt: "2026-09-05", vehicleName: "1989 BMW 325i", maintenanceTitle: "Oil service", maintenanceCategory: "Engine", serviceDate: "2026-09-04", insuranceProvider: null, insurancePolicyNumber: null };

describe("workflow accessibility regression coverage", () => {
  test("shows saved evidence actions in maintenance edit, scoped to the record", () => {
    const record = { id: 1, title: "Oil service", category: "Engine", serviceDate: "2026-09-07", mileage: 100, costCents: 1000, laborHours: 1, difficulty: 2 } as MaintenanceRecord;
    const props = { open: true, record, vehicle: vehicles[0], parts: [], shopNames: [], onClose: () => {}, onSubmit: async () => {}, onDeleteDocument: async () => {}, documents: [document, { ...document, id: 2, name: "Oil photo", mimeType: "image/jpeg" }, { ...document, id: 3, maintenanceId: 99, name: "Unrelated photo", mimeType: "image/jpeg" }] };
    const html = renderToStaticMarkup(<MaintenanceDialog {...props} />);
    expect(html).toContain('aria-label="Edit photo: Oil photo"');
    expect(html).toContain('aria-label="Delete attachment: Oil photo"');
    expect(html).toContain('/api/documents/2/file?preview=1');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('PDF preview: Purolator warranty');
    expect(html).toContain('/api/export/maintenance.pdf?ids=1');
    expect(html).not.toContain("Unrelated photo");
    const newRecord = renderToStaticMarkup(<MaintenanceDialog {...props} record={null} />);
    expect(newRecord).not.toContain("Edit photo: Oil photo");
    const closed = renderToStaticMarkup(<MaintenanceDialog {...props} open={false} />);
    expect(closed).not.toContain("Edit photo: Oil photo");
  });

  test("exposes mobile sorting and filtered select-all independently of table headers", () => {
    const html = renderToStaticMarkup(<PartsCatalogue parts={[]} vehicles={vehicles} loading={false} onAdd={() => {}} onEdit={() => {}} onDeleteSelected={async () => {}} />);
    expect(html).toContain('class="mobile-list-sort"');
    expect(html).toContain("Sort by Quantity");
    expect(html).toContain('class="mobile-select-all check-row"');
    expect(html).toContain("Select all filtered parts");
  });

  test("makes maintenance title a keyboard toggle and scopes PDF export to filtered records", () => {
    const record = { id: 44, title: "Keyboard service", category: "Engine", serviceDate: "2026-09-07", mileage: 100, costCents: 1000, laborHours: 1, difficulty: 2, voidedAt: null } as MaintenanceRecord;
    const html = renderToStaticMarkup(<MaintenanceView records={[record]} plans={[]} reminders={[]} documents={[]} onAdd={() => {}} onEdit={() => {}} onAddPlan={() => {}} onEditPlan={() => {}} onConvertFollowUp={() => {}} onAddReminder={() => {}} onEditReminder={() => {}} onReminderStatus={async () => {}} onMaintenanceVoided={async () => {}} />);
    expect(html).toContain('aria-controls="maintenance-details-44"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('/api/export/maintenance.pdf?ids=44');
    expect(html).not.toContain('href="/api/export/maintenance.pdf"');
    expect(html).toContain('class="maintenance-detail-controls"');
    expect(html).toContain(">Expand all</button>");
    expect(html).toContain(">Collapse all</button>");
  });

  test("uses a compact copy-or-move entry point and exposes table sort state", () => {
    const html = renderToStaticMarkup(<SpecsView specs={[spec]} vehicles={vehicles} activeVehicleId={1} onAdd={() => {}} onEdit={() => {}} onClone={async () => {}} onAssign={async () => {}} onAddVehicle={() => {}} />);
    expect(html).toContain("Copy or move");
    expect(html).not.toContain(">Assign<");
    expect(html).toContain('aria-sort="ascending"');
  });

  test("makes document discovery searchable and derives filter choices from stored records", () => {
    const html = renderToStaticMarkup(<DocumentsView documents={[document]} vehicles={vehicles} onAdd={() => {}} onEdit={() => {}} />);
    expect(html).toContain("Search documents");
    expect(html).toContain(">Warranty<");
    expect(html).toContain(">Engine<");
    expect(html).toContain("1 matching document");
    expect(html).toContain("record-preview-grid");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("PDF preview: Purolator warranty");
    const dialog = renderToStaticMarkup(<DocumentDialog open document={document} vehicles={vehicles} activeVehicleId={1} onClose={() => {}} onUpload={async () => {}} onSave={async () => {}} onDelete={async () => {}} />);
    expect(dialog).toContain("Display name");
    expect(dialog).toContain("Tracking ID");
    expect(dialog).toContain("80ae1b30-d834-43cb-8d20-a62776375c2c");
    expect(dialog).toContain("Original filename");
    expect(dialog).toContain("warranty-scan.pdf");
  });

  test("makes document images open the editor and every linked maintenance record independently discoverable", () => {
    const shared: DocumentRecord = { ...document, mimeType: "image/jpeg", maintenanceIds: [1, 2], maintenanceRecords: [{ id: 1, vehicleId: 1, title: "Oil service", category: "Engine", serviceDate: "2026-09-04" }, { id: 2, vehicleId: 1, title: "Brake inspection", category: "Brakes", serviceDate: "2026-09-03" }] };
    const html = renderToStaticMarkup(<DocumentsView documents={[shared]} vehicles={vehicles} onAdd={() => {}} onEdit={() => {}} />);
    expect(html).toContain('aria-label="Edit photo: Purolator warranty"');
    expect(html).toContain("Maintenance: Oil service · Engine");
    expect(html).toContain("Maintenance: Brake inspection · Brakes");
    expect(html).toContain("records=2");
  });

  test("keeps the maintenance planner collapsed by default and the mobile more list as normal buttons", () => {
    const maintenance = renderToStaticMarkup(<MaintenanceView records={[]} plans={[]} reminders={[]} documents={[]} onAdd={() => {}} onEdit={() => {}} onAddPlan={() => {}} onEditPlan={() => {}} onConvertFollowUp={() => {}} onAddReminder={() => {}} onEditReminder={() => {}} onReminderStatus={async () => {}} onMaintenanceVoided={async () => {}} />);
    expect(maintenance).toContain("Planner");
    expect(maintenance).not.toContain("Service tasks");
    const navigation = renderToStaticMarkup(<MobileNav section="dashboard" onSectionChange={() => {}} />);
    expect(navigation).not.toContain('role="menu"');
    expect(navigation).not.toContain('role="menuitem"');
  });
});
