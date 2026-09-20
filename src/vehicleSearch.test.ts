import { expect, test } from "bun:test";
import { filterVehicles, type VehicleOption } from "./vehicleSearch";

const vehicles: VehicleOption[] = [
  { id: 3, year: 2024, make: "JEEP", model: "Wrangler", nickname: "Papa Earl" },
  { id: 4, year: 2006, make: "NISSAN", model: "Pathfinder", nickname: "Ole Betty" },
  { id: 5, year: 2024, make: "JEEP", model: "Wrangler", nickname: "René" },
];

test("searches vehicle year, make, model, nickname and ID without case sensitivity", () => {
  for (const query of ["nissan", "pathFINDER", "2006", "ole betty", "#4"]) expect(filterVehicles(vehicles, query).map((vehicle) => vehicle.id)).toEqual([4]);
});
test("matches terms in any order, normalizes accents, and distinguishes similar cars", () => {
  expect(filterVehicles(vehicles, " Wrangler   2024 ").map((vehicle) => vehicle.id)).toEqual([3, 5]);
  expect(filterVehicles(vehicles, "rene jeep").map((vehicle) => vehicle.id)).toEqual([5]);
  expect(filterVehicles(vehicles, "2006 jeep")).toEqual([]);
});
test("clearing the search restores all choices and no match never picks a car", () => {
  expect(filterVehicles(vehicles, "  ")).toEqual(vehicles);
  expect(filterVehicles(vehicles, "missing")).toEqual([]);
  expect(filterVehicles([], "jeep")).toEqual([]);
});
