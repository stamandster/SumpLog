import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Part } from "../api";
import { initialPartForm, PartDialog } from "./PartDialog";
import { PartsCatalogue } from "./PartsCatalogue";

test("collapsed catalogue rows offer Clone immediately after Edit", () => {
  const html = renderToStaticMarkup(<PartsCatalogue parts={[source]} vehicles={[]} loading={false} onAdd={() => {}} onEdit={() => {}} onClone={() => {}} onDeleteSelected={async () => {}} />);
  expect(html).toContain('aria-label="Clone FLUID-1"');
  expect(html).toMatch(/aria-label="Edit FLUID-1"[\s\S]*?<\/button><button[^>]*aria-label="Clone FLUID-1"/);
});

const source: Part = { id: 31, partNumber: "FLUID-1", name: "Power steering fluid", itemType: "Consumable", category: "Hydraulic fluid", specifications: "Spec A", approvals: "Approval B", manufacturer: "Supplier", supplierName: "Shop", supplierUrl: "https://example.com/fluid", purchasePriceCents: 1499, quantity: 3, volumePerUnit: 32, volumeUnit: "fl oz", minimumQuantity: 1, storageLocation: "Shelf B", notes: "Original notes", vehicleId: 4, fitmentNotes: "Pump", fitments: [{ vehicleId: 4, notes: "Pump" }, { vehicleId: 3, notes: "Reservoir" }], createdAt: "2026-09-01", updatedAt: "2026-09-01" };

test("clone preserves consumable details and fitments without duplicating stock or identity", () => {
  const draft = initialPartForm(null, null, source);
  expect(draft).toMatchObject({ itemType: "Consumable", category: "Hydraulic fluid", specifications: "Spec A", approvals: "Approval B", name: source.name, partNumber: "", quantity: "0", purchasePrice: "14.99", volumePerUnit: "32", volumeUnit: "fl oz", supplierName: "Shop", manufacturer: "Supplier", storageLocation: "Shelf B", fitmentVehicleIds: [4, 3], vehicleNotes: { 4: "Pump", 3: "Reservoir" } });
  expect(source.quantity).toBe(3);
  expect(source.partNumber).toBe("FLUID-1");
  const edit = initialPartForm(source, null);
  expect(edit.partNumber).toBe("FLUID-1");
  expect(edit.quantity).toBe("3");
  expect(initialPartForm(null, null, { ...source, itemType: "Part", fitments: [] }).fitment).toBe("general");
});

test("clone dialog is a new item, explains stock reset, and cannot delete the source", () => {
  const html = renderToStaticMarkup(<PartDialog open part={null} cloneSource={source} vehicle={null} vehicles={[]} storageLocations={[]} manufacturers={[]} suppliers={[]} onClose={() => {}} onSave={async () => {}} onDelete={async () => {}} />);
  expect(html).toContain("Clone consumable");
  expect(html).toContain("Enter a new part number");
  expect(html).toContain("Stock starts at zero");
  expect(html).not.toContain("Delete part</button>");
  expect(html).not.toContain("Save changes</button>");
  expect(html).toContain("Add part</button>");
});
