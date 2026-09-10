import { useEffect, useId, useRef, useState } from "react";
import type { MileageEntry, Vehicle } from "../api";
import { buildMileageProjection, type MileagePoint } from "../mileageProjection";
import { displayDistance, distanceUnit, formatDate, formatDistance, preferences, today } from "../format";

export function MileageChart({ vehicle, entries }: { vehicle: Vehicle; entries: MileageEntry[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [asOf, setAsOf] = useState(today);
  const id = useId();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [vehicle.id, entries]);
  useEffect(() => {
    const update = () => setAsOf(today());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);

  // Derive from every refreshed reading, including historical corrections and maintenance odometer updates.
  const data = buildMileageProjection(vehicle, entries, asOf);
  if (!data.readings.length && data.ignoredCount > 0) {
    return <figure className="mileage-chart" aria-labelledby={`${id}-heading`}><figcaption><h3 id={`${id}-heading`}>Mileage history & projection</h3></figcaption><p>There are no valid readings on or before today. Correct a future-dated reading or record the current mileage to calculate a projection.</p></figure>;
  }
  const dateLabel = (time: number) => formatDate(new Date(time).toISOString().slice(0, 10));
  const height = 280, left = 64, right = width - 14, top = 32, bottom = height - 40;
  const allPoints = [...data.lifetime, ...data.usage, ...data.saved, ...data.readings];
  const maximum = allPoints.reduce((max, point) => Math.max(max, displayDistance(point.mileage)), 1);
  const rawStep = maximum / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= rawStep) ?? 10) * power;
  const ceiling = step * 4;
  const x = (time: number) => left + (time - data.origin) / (data.end - data.origin) * Math.max(1, right - left);
  const y = (mileage: number) => bottom - displayDistance(mileage) / ceiling * (bottom - top);
  const path = (points: MileagePoint[]) => points.map((point, index) => `${index ? "L" : "M"}${x(point.time).toFixed(2)},${y(point.mileage).toFixed(2)}`).join(" ");
  const axisNumber = new Intl.NumberFormat(preferences().locale, { notation: "compact", maximumFractionDigits: 1 });
  const startYear = data.originYear, endYear = new Date(data.end).getUTCFullYear();
  const middleYear = Math.floor((startYear + endYear) / 2);
  const sourceText = data.source === "readings"
    ? `Measured from ${dateLabel(data.previous!.time)} to ${dateLabel(data.anchor.time)}.`
    : data.source === "saved" ? "Using the saved yearly estimate until enough readings are available."
      : "Using the lifetime average until enough readings are available.";

  return <figure className="mileage-chart" aria-labelledby={`${id}-heading`}>
    <figcaption><h3 id={`${id}-heading`}>Mileage history & projection</h3><p>{vehicle.year} {vehicle.make} {vehicle.model} · from new through five years ahead</p></figcaption>
    <dl className="mileage-chart__summary" aria-live="polite">
      <div><dt>{data.readings.length ? "Last recorded" : "Stored odometer"}</dt><dd>{formatDistance(data.anchor.mileage)}</dd><small>{data.readings.length ? dateLabel(data.anchor.time) : "No dated readings"}</small></div>
      <div><dt>Estimated today</dt><dd>{formatDistance(data.estimatedNow)}</dd><small>Not a recorded reading</small></div>
      <div><dt>{data.source === "readings" ? "Measured usage" : "Estimated usage"}</dt><dd>{formatDistance(data.usageAnnual)}/year</dd><small>{data.source === "readings" ? "Latest usable interval" : "More readings needed"}</small></div>
      <div><dt>Projected in five years</dt><dd>{formatDistance(data.projectedMileage)}</dd><small>{dateLabel(data.end)}</small></div>
    </dl>
    <div ref={container} className="mileage-chart__plot">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>Odometer history and five-year mileage projection</title>
        <desc id={`${id}-description`}>{data.readings.length} recorded readings. Estimated today: {formatDistance(data.estimatedNow)}. Five-year projection: {formatDistance(data.projectedMileage)} using {formatDistance(data.usageAnnual)} per year. Lifetime average: {formatDistance(data.lifetimeAnnual)} per year. {sourceText} Dots are recorded values; lines between readings and dashed lines are estimates.</desc>
        <rect x={x(data.now)} y={top} width={Math.max(0, right - x(data.now))} height={bottom - top} className="mileage-chart__future" />
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = step * tick, position = bottom - value / ceiling * (bottom - top);
          return <g key={tick}><line x1={left} x2={right} y1={position} y2={position} className="mileage-chart__grid" /><text x={left - 10} y={position + 4} textAnchor="end">{axisNumber.format(value)}</text></g>;
        })}
        <text x={left} y={16}>Odometer ({distanceUnit()})</text>
        <line x1={x(data.now)} x2={x(data.now)} y1={top} y2={bottom} className="mileage-chart__today" />
        <text x={Math.min(right - 4, x(data.now))} y={top + 16} textAnchor="end">Now</text>
        <path d={path(data.lifetime)} className="mileage-chart__line mileage-chart__lifetime" />
        {data.readings.length > 0 && <>
          <path d={path([{ time: data.origin, mileage: 0 }, data.readings[0]])} className="mileage-chart__line mileage-chart__inferred" />
          <path d={path(data.readings)} className="mileage-chart__line mileage-chart__recorded" />
        </>}
        {data.saved.length > 0 && <path d={path(data.saved)} className="mileage-chart__line mileage-chart__saved" />}
        <path d={path(data.usage)} className="mileage-chart__line mileage-chart__usage" />
        {data.readings.map((entry) => <circle key={entry.id} cx={x(entry.time)} cy={y(entry.mileage)} r={3.5} className="mileage-chart__reading"><title>{dateLabel(entry.time)}: {formatDistance(entry.mileage)}</title></circle>)}
        {[...new Set([startYear, middleYear, endYear])].map((year, index, years) => <text key={year} x={index === years.length - 1 ? right : x(Date.UTC(year, 0, 1))} y={bottom + 20} textAnchor={index === 0 ? "start" : index === years.length - 1 ? "end" : "middle"}>{year}</text>)}
        <text x={(left + right) / 2} y={height - 2} textAnchor="middle">Calendar year</text>
      </svg>
    </div>
    <ul className="mileage-chart__legend" aria-label="Chart legend">
      <li><span className="mileage-chart__key mileage-chart__key--recorded" />Recorded readings</li>
      <li><span className="mileage-chart__key mileage-chart__key--inferred" />Estimated early history</li>
      <li><span className="mileage-chart__key mileage-chart__key--lifetime" />Lifetime average</li>
      <li><span className="mileage-chart__key mileage-chart__key--usage" />Usage projection</li>
      {data.saved.length > 0 && <li><span className="mileage-chart__key mileage-chart__key--saved" />Saved yearly estimate</li>}
    </ul>
    <div className="mileage-chart__notes">
      <p>{sourceText} A usage interval needs at least two readings seven days apart.</p>
      <p>“New” assumes January 1, {data.originYear}, at zero mileage; the exact in-service date is unknown. Lifetime average: {formatDistance(data.lifetimeAnnual)}/year (minimum age: one year). Early history and gaps between readings are estimated, not service records.</p>
      {data.saved.length > 0 && <p>Saved yearly estimate: {formatDistance(data.savedAnnual!)}/year, shown separately from measured usage. Adjust it using Record mileage or Edit details.</p>}
      {!data.readings.length && <p>Record a dated odometer reading to begin the measured history.</p>}
      {data.odometerDecreased && <p role="status">An odometer decrease was recorded. Usage is calculated only from readings after the most recent decrease.</p>}
      {data.ignoredCount > 0 && <p role="status">{data.ignoredCount} future-dated or invalid reading(s) excluded from this estimate.</p>}
    </div>
  </figure>;
}
