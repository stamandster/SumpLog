import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Vehicle } from "../api";
import { VehicleDeleteDialog, vehicleDeleteConfirmation } from "./ManagementDialogs";
import { VehiclesView } from "./ModuleViews";

const vehicle: Vehicle = {
  id: 1, year: 1989, make: "BMW", model: "325i", nickname: "E30", mileage: 126420,
  vin: null, trim: null, color: null, bodyStyle: null, fuelType: null, drivetrain: null,
  engine: null, transmission: null, licensePlate: null, registrationState: null,
  registrationNumber: null, purchaseDate: null, purchasePriceCents: null,
  insuranceProvider: null, insurancePolicyNumber: null, insuranceAgentName: null,
  insuranceAgentPhone: null, insuranceEffectiveAt: null, insuranceExpiresAt: null,
  insurancePremiumCents: null, insuranceNotes: null, registrationExpiresAt: null,
  imageUrl: null, annualMileageEstimate: null, notes: null,
};

describe("vehicle deletion entry points", () => {
  test("every vehicle card has a delete action, including unselected vehicles", () => {
    const html = renderToStaticMarkup(<VehiclesView vehicles={[vehicle, { ...vehicle, id: 2, nickname: "Daily" }]} policies={[]} activeVehicleId={1} mileage={[]} alerts={[]}
      onSelect={() => {}} onAdd={() => {}} onEdit={() => {}} onDelete={() => {}}
      onAddMileage={() => {}} onEditMileage={() => {}} onChangePhoto={async () => {}} onRemovePhoto={async () => {}} />);
    expect(html).toContain('aria-label="Delete vehicle: 1989 BMW 325i · E30"');
    expect(html).toContain('aria-label="Delete vehicle: 1989 BMW 325i · Daily"');
    expect(html.match(/>Delete vehicle<\/button>/g)?.length).toBe(2);
    expect(html).not.toContain("Delete permanently?");
  });
  test("standalone deletion opens directly to typed confirmation, not the edit form", () => {
    const html = renderToStaticMarkup(<VehicleDeleteDialog vehicle={vehicle} onClose={() => {}} onDelete={async () => {}} />);
    expect(html).toContain('aria-label="Delete vehicle"');
    expect(html).toContain("1989 BMW 325i · E30");
    expect(html).toContain("Delete permanently?");
    expect(html).toContain("<code>E30</code>");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Confirm delete<\/button>/);
    expect(html).toContain("Keep vehicle");
    expect(html).not.toContain("Save changes");
    expect(html).not.toContain("Keep record");
  });
  test("uses the same deletion warning and name fallback for both entry points", () => {
    const confirmation = vehicleDeleteConfirmation({ ...vehicle, nickname: "  " });
    expect(confirmation.phrase).toBe("1989 BMW 325i");
    expect(confirmation.message).toContain("maintenance history and audit trail");
    expect(confirmation.message).toContain("Inventory parts remain");
  });
});
