export type MassUnit = "g" | "oz" | "lb";
export type VolumeUnit = "mL" | "L" | "fl oz" | "qt" | "gal";
export type TorqueUnit = "N·m" | "lb-ft" | "lb-in" | "kgf·m";
export type PressureUnit = "psi" | "kPa" | "bar";
export type CoolantChemistry = "Ethylene glycol" | "Propylene glycol";

const gramsPerMassUnit: Record<MassUnit, number> = { g: 1, oz: 28.349523125, lb: 453.59237 };
const millilitresPerVolumeUnit: Record<VolumeUnit, number> = { mL: 1, L: 1000, "fl oz": 29.5735295625, qt: 946.352946, gal: 3785.411784 };
const newtonMetresPerTorqueUnit: Record<TorqueUnit, number> = { "N·m": 1, "lb-ft": 1.3558179483314, "lb-in": 0.11298482902762, "kgf·m": 9.80665 };
const kilopascalsPerPressureUnit: Record<PressureUnit, number> = { psi: 6.894757293168, kPa: 1, bar: 100 };

export function convertVolume(value: number, from: VolumeUnit, to: VolumeUnit) {
  return value * millilitresPerVolumeUnit[from] / millilitresPerVolumeUnit[to];
}

export function convertTorque(value: number, from: TorqueUnit, to: TorqueUnit) {
  return value * newtonMetresPerTorqueUnit[from] / newtonMetresPerTorqueUnit[to];
}

export function convertPressure(value: number, from: PressureUnit, to: PressureUnit) {
  return value * kilopascalsPerPressureUnit[from] / kilopascalsPerPressureUnit[to];
}

export function calculateFluidUsage(before: number, after: number, unit: MassUnit, densityGramsPerMl?: number | null) {
  if (![before, after].every(Number.isFinite) || before < after || after < 0) return null;
  const massGrams = (before - after) * gramsPerMassUnit[unit];
  const volumeMl = densityGramsPerMl && densityGramsPerMl > 0 ? massGrams / densityGramsPerMl : null;
  return { massGrams, volumeMl };
}

export function correctedSpecificGravity(reading: number, temperatureF: number) {
  return reading + (temperatureF - 80) * 0.0004;
}

export function estimateFloodedBatteryCharge(specificGravity: number) {
  const points: Array<[number, number]> = [[1.265, 100], [1.225, 75], [1.19, 50], [1.155, 25], [1.12, 0]];
  if (specificGravity >= points[0][0]) return 100;
  if (specificGravity <= points.at(-1)![0]) return 0;
  for (let index = 0; index < points.length - 1; index++) {
    const [highGravity, highCharge] = points[index];
    const [lowGravity, lowCharge] = points[index + 1];
    if (specificGravity <= highGravity && specificGravity >= lowGravity) return lowCharge + (specificGravity - lowGravity) / (highGravity - lowGravity) * (highCharge - lowCharge);
  }
  return 0;
}

const coolantCurves: Record<CoolantChemistry, Array<[number, number]>> = {
  "Ethylene glycol": [[0, 32], [10, 26], [20, 18], [30, 7], [40, -12], [50, -34], [60, -62], [70, -84]],
  "Propylene glycol": [[0, 32], [10, 26], [20, 19], [30, 8], [40, -7], [50, -28], [60, -60], [70, -75]],
};

export function estimateCoolantFreezePoint(concentrationPercent: number, chemistry: CoolantChemistry) {
  if (!Number.isFinite(concentrationPercent) || concentrationPercent < 0 || concentrationPercent > 70) return null;
  const points = coolantCurves[chemistry];
  for (let index = 0; index < points.length - 1; index++) {
    const [lowConcentration, lowTemperature] = points[index];
    const [highConcentration, highTemperature] = points[index + 1];
    if (concentrationPercent >= lowConcentration && concentrationPercent <= highConcentration) return lowTemperature + (concentrationPercent - lowConcentration) / (highConcentration - lowConcentration) * (highTemperature - lowTemperature);
  }
  return points.at(-1)![1];
}
