import { describe, expect, it } from "bun:test";
import { calculateFluidUsage, convertPressure, convertTorque, convertVolume, correctedSpecificGravity, estimateCoolantFreezePoint, estimateFloodedBatteryCharge } from "./calculators";

describe("garage calculators", () => {
  it("calculates fluid used from a scale difference and density", () => {
    const result = calculateFluidUsage(40, 36, "oz", 1);
    expect(result?.massGrams).toBeCloseTo(113.398, 3);
    expect(result?.volumeMl).toBeCloseTo(113.398, 3);
    expect(calculateFluidUsage(10, 11, "oz", 1)).toBeNull();
  });

  it("converts shop units bidirectionally", () => {
    expect(convertTorque(100, "N·m", "lb-ft")).toBeCloseTo(73.756, 3);
    expect(convertTorque(convertTorque(100, "N·m", "lb-in"), "lb-in", "N·m")).toBeCloseTo(100, 8);
    expect(convertVolume(1, "qt", "fl oz")).toBeCloseTo(32, 8);
    expect(convertPressure(32, "psi", "kPa")).toBeCloseTo(220.632, 3);
  });

  it("corrects flooded-battery hydrometer readings for temperature", () => {
    expect(correctedSpecificGravity(1.245, 100)).toBeCloseTo(1.253, 6);
    expect(correctedSpecificGravity(1.245, 60)).toBeCloseTo(1.237, 6);
    expect(estimateFloodedBatteryCharge(1.225)).toBe(75);
    expect(estimateFloodedBatteryCharge(1.12)).toBe(0);
  });

  it("estimates coolant protection only within the supported concentration range", () => {
    expect(estimateCoolantFreezePoint(50, "Ethylene glycol")).toBe(-34);
    expect(estimateCoolantFreezePoint(45, "Ethylene glycol")).toBe(-23);
    expect(estimateCoolantFreezePoint(75, "Ethylene glycol")).toBeNull();
  });
});
