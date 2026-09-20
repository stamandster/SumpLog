import { expect, test } from "bun:test";
import { readMaintenanceDetails, saveMaintenanceDetails } from "./maintenanceDetailsState";

const deepLink = new URL("http://localhost/maintenance?vehicle=3&record=9");
test("area navigation retains closed and open choices despite a carried record parameter", () => {
  for (const ids of [[], [7, 9]]) {
    let state = saveMaintenanceDetails(deepLink, null, ids);
    for (const area of ["parts", "documents", "specs", "projects", "vehicles", "", "maintenance"]) {
      const destination = new URL(deepLink);
      destination.pathname = `/${area}`;
      // Ordinary navigation passes the current history state to the next entry.
      state = structuredClone(state);
      expect(readMaintenanceDetails(destination, state)).toEqual(ids);
    }
  }
});
test("fresh deep links open their record but a saved close survives refresh", () => {
  expect(readMaintenanceDetails(deepLink, null)).toEqual([9]);
  const closed = saveMaintenanceDetails(deepLink, null, []);
  expect(readMaintenanceDetails(deepLink, structuredClone(closed))).toEqual([]);
});
test("multiple open records and filtered collapse survive refresh without losing unrelated history", () => {
  const opened = saveMaintenanceDetails(deepLink, { other: "preserved" }, [7, 8, 9]);
  expect(readMaintenanceDetails(deepLink, structuredClone(opened))).toEqual([7, 8, 9]);
  const filteredCollapse = saveMaintenanceDetails(deepLink, opened, [7]);
  expect(filteredCollapse).toMatchObject({ other: "preserved" });
  expect(readMaintenanceDetails(deepLink, filteredCollapse)).toEqual([7]);
  expect(readMaintenanceDetails(deepLink, saveMaintenanceDetails(deepLink, opened, []))).toEqual([]);
});
test("new deep links and different vehicles do not inherit old expansion overrides", () => {
  const closed = saveMaintenanceDetails(deepLink, null, []);
  expect(readMaintenanceDetails(deepLink, {})).toEqual([9]);
  expect(readMaintenanceDetails(new URL("http://localhost/maintenance?vehicle=4&record=10"), closed)).toEqual([10]);
  expect(readMaintenanceDetails(new URL("http://localhost/maintenance?vehicle=3"), null)).toEqual([]);
  expect(readMaintenanceDetails(deepLink, saveMaintenanceDetails(deepLink, null, [9, 9, -1, NaN, 1.5]))).toEqual([9]);
});
