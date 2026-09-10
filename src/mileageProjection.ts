import type { MileageEntry, Vehicle } from "./api";

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;
export type MileagePoint = { time: number; mileage: number };
type ProjectionVehicle = Pick<Vehicle, "id" | "year" | "mileage" | "annualMileageEstimate">;

function dateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}

/** Read-only derived data: projected odometers must never be persisted as readings. */
export function buildMileageProjection(vehicle: ProjectionVehicle, entries: MileageEntry[], asOf: string, yearsAhead = 5) {
  const now = dateTime(asOf);
  if (!Number.isFinite(now)) throw new Error("A valid as-of date is required.");
  const endDate = new Date(now);
  endDate.setUTCFullYear(endDate.getUTCFullYear() + yearsAhead);
  const end = endDate.getTime();
  const ownEntries = entries.filter((entry) => entry.vehicleId === vehicle.id);
  // The database permits one reading per day. For imported/legacy duplicates, the newest ID wins.
  const byDate = new Map<number, MileageEntry>();
  let ignoredCount = 0;
  for (const entry of ownEntries) {
    const time = dateTime(entry.recordedDate);
    if (!Number.isFinite(time) || time > now || !Number.isFinite(entry.mileage) || entry.mileage < 0) { ignoredCount++; continue; }
    if (!byDate.has(time) || byDate.get(time)!.id < entry.id) byDate.set(time, entry);
  }
  const readings = [...byDate].sort(([a], [b]) => a - b).map(([time, entry]) => ({ ...entry, time }));
  const last = readings.at(-1);
  const anchor: MileagePoint = last ?? { time: now, mileage: Math.max(0, vehicle.mileage) };
  const firstYear = new Date(readings[0]?.time ?? now).getUTCFullYear();
  const originYear = Math.min(vehicle.year, firstYear, new Date(now).getUTCFullYear());
  const origin = Date.UTC(originYear, 0, 1);
  // Under a year old, use a one-year minimum to avoid an inflated first-day lifetime rate.
  const lifetimeAnnual = anchor.mileage / Math.max(1, (anchor.time - origin) / YEAR);
  const savedAnnual = vehicle.annualMileageEstimate != null && Number.isFinite(vehicle.annualMileageEstimate) && vehicle.annualMileageEstimate >= 0 ? vehicle.annualMileageEstimate : null;

  // Use the newest usable interval. An odometer drop starts a new segment; never project negative use.
  let segmentStart = 0;
  for (let index = 1; index < readings.length; index++) {
    if (readings[index].mileage < readings[index - 1].mileage) segmentStart = index;
  }
  let previous: typeof last;
  if (last) {
    for (let index = readings.length - 2; index >= segmentStart; index--) {
      if (last.time - readings[index].time >= 7 * DAY) { previous = readings[index]; break; }
    }
  }
  const measuredAnnual = last && previous ? (last.mileage - previous.mileage) / (last.time - previous.time) * YEAR : null;
  const usageAnnual = measuredAnnual ?? savedAnnual ?? lifetimeAnnual;
  const source = measuredAnnual != null ? "readings" : savedAnnual != null ? "saved" : "lifetime";
  const project = (annual: number, time: number): MileagePoint => ({ time, mileage: anchor.mileage + annual * Math.max(0, time - anchor.time) / YEAR });
  const usage = [anchor, project(usageAnnual, now), project(usageAnnual, end)];
  const lifetime = [{ time: origin, mileage: 0 }, anchor, project(lifetimeAnnual, now), project(lifetimeAnnual, end)];
  const saved = savedAnnual != null && measuredAnnual != null && Math.abs(savedAnnual - measuredAnnual) >= 1
    ? [anchor, project(savedAnnual, now), project(savedAnnual, end)] : [];
  return {
    now, end, origin, originYear, readings, anchor, lifetime, usage, saved,
    lifetimeAnnual, usageAnnual, savedAnnual, source, previous,
    estimatedNow: usage[1].mileage, projectedMileage: usage[2].mileage,
    ignoredCount, odometerDecreased: segmentStart > 0,
  };
}
