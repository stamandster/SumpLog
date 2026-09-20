import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Topbar, VehicleContext, vehicleLabel, type VehicleOption } from "./Topbar";

const vehicles: VehicleOption[] = [
  { id: 1, year: 1989, make: "BMW", model: "325i", nickname: "E30" },
  { id: 2, year: 2005, make: "Toyota", model: "Tacoma", nickname: null },
];
const props = { query: "", onQueryChange() {}, onLogMaintenance() {}, alertCount: 0, onOpenAlerts() {}, canLogMaintenance: true, searchVisible: false, vehicles, vehicleId: 1, onSelectVehicle() {} };

describe("top navigation vehicle context", () => {
  test("names the single selected car without a nonfunctional switcher", () => {
    const html = renderToStaticMarkup(<VehicleContext vehicles={[vehicles[0]]} vehicleId={1} onSelectVehicle={() => {}} />);
    expect(html).toContain("Selected vehicle");
    expect(html).toContain("1989 BMW 325i · E30");
    expect(html).not.toContain("<select");
  });
  test("offers a labeled switcher with the current car selected", () => {
    const html = renderToStaticMarkup(<VehicleContext vehicles={vehicles} vehicleId={2} onSelectVehicle={() => {}} />);
    expect(html).toContain("<label");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('value="2005 Toyota Tacoma · #2"');
    expect(html).toContain("Documents, fleet and settings are garage-wide");
  });
  test("shows context on module pages but leaves the dashboard heading alone", () => {
    expect(renderToStaticMarkup(<Topbar {...props} showVehicleContext />)).toContain("Selected vehicle");
    expect(renderToStaticMarkup(<Topbar {...props} showVehicleContext={false} />)).not.toContain("Selected vehicle");
  });
  test("does not guess a selected vehicle for empty or stale selections", () => {
    expect(renderToStaticMarkup(<VehicleContext vehicles={[]} vehicleId={null} onSelectVehicle={() => {}} />)).toContain("No vehicle selected");
    const html = renderToStaticMarkup(<VehicleContext vehicles={vehicles} vehicleId={99} onSelectVehicle={() => {}} />);
    expect(html).toContain('placeholder="Choose a vehicle"');
    expect(html).toContain('value=""');
  });
  test("preserves search and maintenance actions alongside the selected car", () => {
    const html = renderToStaticMarkup(<Topbar {...props} showVehicleContext searchVisible />);
    expect(html).toContain("Search parts");
    expect(html).toContain("Log maintenance");
  });
  test("provides readable loading, error, success and disabled states", () => {
    for (const state of ["loading", "error", "success", "disabled"] as const) {
      const html = renderToStaticMarkup(<VehicleContext vehicles={vehicles} vehicleId={1} onSelectVehicle={() => {}} state={state} />);
      expect(html).toContain(`data-state="${state}"`);
      expect(html).toContain("1989 BMW 325i · E30");
      if (state === "loading") expect(html).toContain('aria-busy="true"');
      if (state === "error") expect(html).toContain('aria-invalid="true"');
      if (state === "disabled") expect(html).toContain('disabled=""');
    }
    expect(vehicleLabel({ ...vehicles[0], nickname: "  " })).toBe("1989 BMW 325i");
  });
});
