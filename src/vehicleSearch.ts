import type { Vehicle } from "./api";

export type VehicleOption = Pick<Vehicle, "id" | "year" | "make" | "model" | "nickname">;

export function vehicleLabel(vehicle: VehicleOption) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.nickname?.trim() ? ` · ${vehicle.nickname.trim()}` : ""}`;
}

export function filterVehicles(vehicles: VehicleOption[], query: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return vehicles.filter((vehicle) => {
    const text = normalize(`${vehicleLabel(vehicle)} #${vehicle.id}`);
    return terms.every((term) => text.includes(term));
  });
}
