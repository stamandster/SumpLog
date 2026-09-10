// Development-only state gallery; not imported by the application.
import { useState } from "react";
import { VehicleContext, type VehicleOption } from "./Topbar";

const vehicles: VehicleOption[] = [
  { id: 1, year: 1989, make: "BMW", model: "325i", nickname: "Weekend project" },
  { id: 2, year: 2005, make: "Toyota", model: "Tacoma", nickname: "Parts runner" },
];

export default function TopbarPreview() {
  const [vehicleId, setVehicleId] = useState(1);
  return <main className="content">
    <h1>Selected vehicle — eight states</h1>
    {(["default", "hover", "focus", "active", "disabled", "loading", "error", "success"] as const).map((state) => <section className="panel" key={state}>
      <h2>{state}</h2>
      <VehicleContext vehicles={vehicles} vehicleId={vehicleId} onSelectVehicle={setVehicleId}
        className={`is-${state}`} state={state === "hover" || state === "focus" || state === "active" ? "default" : state} />
    </section>)}
  </main>;
}
