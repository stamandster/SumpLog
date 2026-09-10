import { describe, expect, test } from "bun:test";
import type { MileageEntry } from "./api";
import { buildMileageProjection } from "./mileageProjection";

const vehicle = { id: 1, year: 2020, mileage: 60_000, annualMileageEstimate: null };
const reading = (id: number, recordedDate: string, mileage: number, vehicleId = 1): MileageEntry => ({ id, vehicleId, recordedDate, mileage, annualMileageEstimate: null, notes: null });
const asOf = "2026-09-02";

describe("mileage history and projection", () => {
  test("estimates from new, anchors to recorded mileage, and projects five calendar years", () => {
    const result = buildMileageProjection(vehicle, [reading(1, asOf, 60_000)], asOf);
    expect(new Date(result.origin).toISOString().slice(0, 10)).toBe("2020-01-01");
    expect(new Date(result.end).toISOString().slice(0, 10)).toBe("2031-09-02");
    expect(result.lifetime[0].mileage).toBe(0);
    expect(result.estimatedNow).toBe(60_000);
    expect(result.source).toBe("lifetime");
    expect(result.projectedMileage).toBeGreaterThan(60_000);
  });
  test("calculates measured usage from unsorted readings, not cached annual estimates", () => {
    const rows = [reading(2, "2026-08-01", 61_000), reading(1, "2026-07-01", 60_000)];
    const result = buildMileageProjection({ ...vehicle, annualMileageEstimate: 8_000 }, rows, asOf);
    expect(result.source).toBe("readings");
    expect(result.usageAnnual).toBeCloseTo(1_000 / 31 * 365.25);
    expect(result.estimatedNow).toBeCloseTo(61_000 + 1_000 / 31 * 32);
    expect(result.saved).toHaveLength(3);
    expect(result.savedAnnual).toBe(8_000);
    expect(rows[0].id).toBe(2);
  });
  test("recalculates after historical mileage and date edits, and newly added readings", () => {
    const rows = [reading(1, "2026-07-01", 60_000), reading(2, "2026-08-01", 61_000)];
    const original = buildMileageProjection(vehicle, rows, asOf);
    const mileageEdit = buildMileageProjection(vehicle, [{ ...rows[0], mileage: 60_500 }, rows[1]], asOf);
    const dateEdit = buildMileageProjection(vehicle, [{ ...rows[0], recordedDate: "2026-06-01" }, rows[1]], asOf);
    const addition = buildMileageProjection(vehicle, [...rows, reading(3, asOf, 63_000)], asOf);
    expect(mileageEdit.usageAnnual).toBeCloseTo(original.usageAnnual / 2);
    expect(dateEdit.usageAnnual).toBeLessThan(original.usageAnnual);
    expect(addition.estimatedNow).toBe(63_000);
    expect(addition.usageAnnual).toBeCloseTo(2_000 / 32 * 365.25);
    expect(addition.projectedMileage).not.toBe(original.projectedMileage);
  });
  test("uses a seven-day minimum interval, including older usable readings", () => {
    const rows = [reading(1, "2026-08-01", 60_000), reading(2, "2026-08-30", 60_900), reading(3, asOf, 61_000)];
    const result = buildMileageProjection(vehicle, rows, asOf);
    expect(result.previous?.id).toBe(1);
    expect(result.usageAnnual).toBeCloseTo(1_000 / 32 * 365.25);
    expect(buildMileageProjection({ ...vehicle, annualMileageEstimate: 12_000 }, rows.slice(1), asOf).source).toBe("saved");
  });
  test("preserves zero usage and zero manual estimates", () => {
    const result = buildMileageProjection(vehicle, [reading(1, "2026-08-01", 60_000), reading(2, asOf, 60_000)], asOf);
    expect(result.usageAnnual).toBe(0);
    expect(result.projectedMileage).toBe(60_000);
    const manual = buildMileageProjection({ ...vehicle, annualMileageEstimate: 0 }, [reading(1, asOf, 60_000)], asOf);
    expect(manual.source).toBe("saved");
    expect(manual.projectedMileage).toBe(60_000);
  });
  test("separates vehicles and excludes future or invalid dates", () => {
    const result = buildMileageProjection(vehicle, [reading(1, asOf, 60_000), reading(2, "2027-01-01", 70_000), reading(3, "invalid", 1), reading(4, asOf, 900_000, 2), reading(5, "2026-02-30", 2)], asOf);
    expect(result.readings).toHaveLength(1);
    expect(result.ignoredCount).toBe(3);
    expect(result.estimatedNow).toBe(60_000);
  });
  test("chooses newest ID for duplicate dates without a zero-day division", () => {
    const result = buildMileageProjection(vehicle, [reading(2, asOf, 60_000), reading(1, asOf, 59_000)], asOf);
    expect(result.readings).toHaveLength(1);
    expect(result.anchor.mileage).toBe(60_000);
    expect(Number.isFinite(result.projectedMileage)).toBe(true);
  });
  test("does not infer negative usage or bridge an odometer reset", () => {
    const rows = [reading(1, "2026-06-01", 90_000), reading(2, "2026-07-01", 100), reading(3, asOf, 500)];
    const result = buildMileageProjection(vehicle, rows, asOf);
    expect(result.odometerDecreased).toBe(true);
    expect(result.previous?.id).toBe(2);
    expect(result.usageAnnual).toBeGreaterThan(0);
    expect(buildMileageProjection(vehicle, rows.slice(0, 2), asOf).source).toBe("lifetime");
  });
  test("handles a new model year, an empty history and zero odometer safely", () => {
    const result = buildMileageProjection({ ...vehicle, year: 2027, mileage: 0 }, [], asOf);
    expect(result.originYear).toBe(2026);
    expect(result.readings).toHaveLength(0);
    expect(result.projectedMileage).toBe(0);
    const firstDay = buildMileageProjection({ ...vehicle, year: 2026 }, [reading(1, "2026-01-01", 10)], "2026-01-01");
    expect(Number.isFinite(firstDay.usageAnnual)).toBe(true);
  });
});
