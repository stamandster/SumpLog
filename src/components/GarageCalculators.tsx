import { BatteryCharging, Calculator, Droplets, Gauge, Scale, Snowflake, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { calculateFluidUsage, convertPressure, convertTorque, convertVolume, correctedSpecificGravity, estimateCoolantFreezePoint, estimateFloodedBatteryCharge, type CoolantChemistry, type MassUnit, type PressureUnit, type TorqueUnit, type VolumeUnit } from "../calculators";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });
const densities = [
  ["Water", 1], ["Engine oil (typical)", 0.87], ["ATF (typical)", 0.85],
  ["Power steering fluid (typical)", 0.86], ["Brake fluid (typical)", 1.04], ["50/50 coolant (typical)", 1.07],
] as const;

function NumericInput({ id, label, value, onChange, min = 0, max }: { id: string; label: string; value: string; onChange: (value: string) => void; min?: number; max?: number }) {
  return <label htmlFor={id}><span>{label}</span><input id={id} type="number" min={min} max={max} step="any" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Results({ values }: { values: Array<[string, number]> }) {
  return <dl className="calculator-results">{values.map(([unit, value]) => <div key={unit}><dt>{unit}</dt><dd>{Number.isFinite(value) ? number.format(value) : "—"}</dd></div>)}</dl>;
}

export function GarageCalculators() {
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [massUnit, setMassUnit] = useState<MassUnit>("oz");
  const [density, setDensity] = useState("0.86");
  const [densityPreset, setDensityPreset] = useState("Power steering fluid (typical)");
  const usage = useMemo(() => calculateFluidUsage(Number(before), Number(after), massUnit, Number(density)), [before, after, massUnit, density]);
  const usageReady = before !== "" && after !== "";

  const [torque, setTorque] = useState("");
  const [torqueUnit, setTorqueUnit] = useState<TorqueUnit>("N·m");
  const torqueValue = Number(torque);
  const torqueUnits: TorqueUnit[] = ["N·m", "lb-ft", "lb-in", "kgf·m"];

  const [volume, setVolume] = useState("");
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>("fl oz");
  const volumeValue = Number(volume);
  const volumeUnits: VolumeUnit[] = ["mL", "L", "fl oz", "qt", "gal"];

  const [pressure, setPressure] = useState("");
  const [pressureUnit, setPressureUnit] = useState<PressureUnit>("psi");
  const pressureValue = Number(pressure);
  const pressureUnits: PressureUnit[] = ["psi", "kPa", "bar"];

  const [batteryTemperature, setBatteryTemperature] = useState("80");
  const [batteryTemperatureUnit, setBatteryTemperatureUnit] = useState<"°F" | "°C">("°F");
  const [batteryCells, setBatteryCells] = useState(["", "", "", "", "", ""]);
  const temperatureF = batteryTemperatureUnit === "°F" ? Number(batteryTemperature) : Number(batteryTemperature) * 9 / 5 + 32;
  const batteryInputInvalid = batteryTemperature === "" || !Number.isFinite(temperatureF) || batteryCells.some((value) => value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 1 || Number(value) > 1.4));
  const correctedCells = batteryCells.map(Number).filter((value, index) => batteryCells[index] !== "" && Number.isFinite(value) && value >= 1 && value <= 1.4).map((value) => correctedSpecificGravity(value, temperatureF));
  const batteryAverage = correctedCells.length && !batteryInputInvalid ? correctedCells.reduce((sum, value) => sum + value, 0) / correctedCells.length : null;
  const batterySpread = correctedCells.length > 1 && !batteryInputInvalid ? Math.max(...correctedCells) - Math.min(...correctedCells) : null;

  const [coolantReadingType, setCoolantReadingType] = useState<"Concentration" | "Freeze point">("Concentration");
  const [coolantChemistry, setCoolantChemistry] = useState<CoolantChemistry>("Ethylene glycol");
  const [coolantReading, setCoolantReading] = useState("");
  const [coolantTemperatureUnit, setCoolantTemperatureUnit] = useState<"°F" | "°C">("°F");
  const coolantValue = Number(coolantReading);
  const estimatedFreezeF = coolantReadingType === "Concentration" ? estimateCoolantFreezePoint(coolantValue, coolantChemistry) : coolantTemperatureUnit === "°F" ? coolantValue : coolantValue * 9 / 5 + 32;

  return <section className="module-page calculator-page">
    <header className="module-header"><div><span className="eyebrow">GARAGE UTILITIES</span><h1>Calculators</h1><p>Fast conversions for service work. Values are calculated locally and are not saved.</p></div><Calculator size={27} aria-hidden="true" /></header>
    <div className="calculator-grid">
      <article className="panel calculator-card calculator-card--wide">
        <header><Scale size={20} /><div><h2>Fluid used by weight</h2><p>Weigh the same container before and after dispensing. The container weight cancels out.</p></div></header>
        <div className="calculator-inputs">
          <NumericInput id="fluid-before" label="Weight before" value={before} onChange={setBefore} />
          <NumericInput id="fluid-after" label="Weight after" value={after} onChange={setAfter} />
          <label htmlFor="fluid-weight-unit"><span>Scale unit</span><select id="fluid-weight-unit" value={massUnit} onChange={(event) => setMassUnit(event.target.value as MassUnit)}><option value="g">grams</option><option value="oz">ounces</option><option value="lb">pounds</option></select></label>
          <label htmlFor="fluid-density"><span>Fluid density</span><select id="fluid-density" value={densityPreset} onChange={(event) => { const label = event.target.value; setDensityPreset(label); const preset = densities.find(([name]) => name === label); if (preset) setDensity(String(preset[1])); }}><option value="Custom">Custom density</option>{densities.map(([label]) => <option key={label}>{label}</option>)}</select></label>
          <label htmlFor="fluid-density-value"><span>Density (g/mL)</span><input id="fluid-density-value" type="number" min="0.01" step="0.01" inputMode="decimal" value={density} onChange={(event) => { setDensity(event.target.value); setDensityPreset("Custom"); }} /></label>
        </div>
        {usageReady && !usage ? <p className="calculator-error" role="alert">Weight after cannot be greater than weight before.</p> : null}
        <Results values={usageReady && usage ? [["Weight used (g)", usage.massGrams], ["Volume used (mL)", usage.volumeMl ?? Number.NaN], ["Volume used (US fl oz)", usage.volumeMl == null ? Number.NaN : convertVolume(usage.volumeMl, "mL", "fl oz")], ["Volume used (US qt)", usage.volumeMl == null ? Number.NaN : convertVolume(usage.volumeMl, "mL", "qt")]] : []} />
        <p className="calculator-note">Density varies by product and temperature. Use the manufacturer’s safety or technical data sheet when accuracy matters; presets are estimates.</p>
      </article>

      <ConverterCard icon={<Wrench size={20} />} title="Torque" value={torque} onValue={setTorque} unit={torqueUnit} onUnit={(unit) => setTorqueUnit(unit as TorqueUnit)} units={torqueUnits} results={torque === "" ? [] : torqueUnits.map((unit) => [unit, convertTorque(torqueValue, torqueUnit, unit)])} />
      <ConverterCard icon={<Droplets size={20} />} title="Fluid volume" value={volume} onValue={setVolume} unit={volumeUnit} onUnit={(unit) => setVolumeUnit(unit as VolumeUnit)} units={volumeUnits} results={volume === "" ? [] : volumeUnits.map((unit) => [unit, convertVolume(volumeValue, volumeUnit, unit)])} />
      <ConverterCard icon={<Gauge size={20} />} title="Pressure" value={pressure} onValue={setPressure} unit={pressureUnit} onUnit={(unit) => setPressureUnit(unit as PressureUnit)} units={pressureUnits} results={pressure === "" ? [] : pressureUnits.map((unit) => [unit, convertPressure(pressureValue, pressureUnit, unit)])} />

      <article className="panel calculator-card calculator-card--wide testing-card">
        <header><BatteryCharging size={20} /><div><h2>Flooded-battery hydrometer</h2><p>Temperature-correct specific-gravity readings and compare the cells.</p></div></header>
        <div className="calculator-inputs calculator-inputs--battery">
          <NumericInput id="battery-temperature" label="Electrolyte temperature" value={batteryTemperature} onChange={setBatteryTemperature} min={-100} />
          <label htmlFor="battery-temperature-unit"><span>Temperature unit</span><select id="battery-temperature-unit" value={batteryTemperatureUnit} onChange={(event) => setBatteryTemperatureUnit(event.target.value as "°F" | "°C")}><option>°F</option><option>°C</option></select></label>
        </div>
        <fieldset className="battery-cell-readings"><legend>Cell specific gravity</legend><p>Enter the cells you can measure; leave unused fields blank.</p><div>{batteryCells.map((value, index) => <NumericInput key={index} id={`battery-cell-${index + 1}`} label={`Cell ${index + 1}`} value={value} min={1} max={1.4} onChange={(next) => setBatteryCells((current) => current.map((item, cellIndex) => cellIndex === index ? next : item))} />)}</div></fieldset>
        {batteryInputInvalid ? <p className="calculator-error" role="alert">Use specific-gravity readings from 1.000 through 1.400 and enter the electrolyte temperature.</p> : null}
        <Results values={batteryAverage == null ? [] : [["Corrected average SG", batteryAverage], ["Approx. charge (%)", estimateFloodedBatteryCharge(batteryAverage)], ["Cell spread", batterySpread ?? 0]]} />
        {batterySpread != null && batterySpread > 0.03 ? <p className="calculator-error" role="status">Cell spread exceeds 0.030 SG. Retest after charging and follow the battery manufacturer’s diagnostic guidance.</p> : null}
        <p className="calculator-note">For serviceable flooded lead-acid batteries only—not sealed, AGM, or gel batteries. Charge estimates and the 80°F correction are general guidance; use the battery manufacturer’s specification.</p>
      </article>

      <article className="panel calculator-card calculator-card--wide testing-card">
        <header><Snowflake size={20} /><div><h2>Coolant tester</h2><p>Interpret a hydrometer or refractometer’s concentration or freeze-point reading.</p></div></header>
        <div className="calculator-inputs calculator-inputs--coolant">
          <label htmlFor="coolant-reading-type"><span>Tester reports</span><select id="coolant-reading-type" value={coolantReadingType} onChange={(event) => setCoolantReadingType(event.target.value as "Concentration" | "Freeze point")}><option>Concentration</option><option>Freeze point</option></select></label>
          {coolantReadingType === "Concentration" ? <label htmlFor="coolant-chemistry"><span>Coolant chemistry</span><select id="coolant-chemistry" value={coolantChemistry} onChange={(event) => setCoolantChemistry(event.target.value as CoolantChemistry)}><option>Ethylene glycol</option><option>Propylene glycol</option></select></label> : null}
          <NumericInput id="coolant-reading" label={coolantReadingType === "Concentration" ? "Glycol concentration (%)" : "Indicated freeze point"} value={coolantReading} min={coolantReadingType === "Concentration" ? 0 : -200} max={coolantReadingType === "Concentration" ? 70 : 200} onChange={setCoolantReading} />
          {coolantReadingType === "Freeze point" ? <label htmlFor="coolant-temperature-unit"><span>Temperature unit</span><select id="coolant-temperature-unit" value={coolantTemperatureUnit} onChange={(event) => setCoolantTemperatureUnit(event.target.value as "°F" | "°C")}><option>°F</option><option>°C</option></select></label> : null}
        </div>
        {coolantReading !== "" && estimatedFreezeF == null ? <p className="calculator-error" role="alert">Enter a glycol concentration from 0% through 70%.</p> : null}
        <Results values={coolantReading !== "" && estimatedFreezeF != null ? [["Freeze protection (°F)", estimatedFreezeF], ["Freeze protection (°C)", (estimatedFreezeF - 32) * 5 / 9]] : []} />
        <p className="calculator-note">Approximate protection only. Chemistry, additives, contamination, and temperature affect readings. Confirm the coolant type and use the tester and coolant manufacturers’ charts before servicing.</p>
      </article>
    </div>
  </section>;
}

function ConverterCard({ icon, title, value, onValue, unit, onUnit, units, results }: { icon: React.ReactNode; title: string; value: string; onValue: (value: string) => void; unit: string; onUnit: (unit: string) => void; units: readonly string[]; results: Array<[string, number]> }) {
  return <article className="panel calculator-card"><header>{icon}<h2>{title}</h2></header><div className="calculator-converter"><NumericInput id={`calculator-${title.toLowerCase().replace(/\s/g, "-")}`} label="Value" value={value} onChange={onValue} /><label><span>From unit</span><select value={unit} onChange={(event) => onUnit(event.target.value)}>{units.map((option) => <option key={option}>{option}</option>)}</select></label></div><Results values={results} /></article>;
}
