import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { displayDistance, formatCurrency, formatDate, inputDistance, preferences, storedDistance } from "./format";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let settings = "{}";
beforeEach(() => { settings = "{}"; Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => settings } }); });
afterAll(() => { if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });
describe("Display preferences", () => {
  it("converts kilometre entries without changing stored mile readings", () => {
    settings = JSON.stringify({ distanceUnit: "km" });
    expect(displayDistance(100)).toBe(161); expect(inputDistance(null)).toBe("");
    for (const value of [0, 1, 1234, 126420, 1000000]) expect(storedDistance(inputDistance(value))).toBe(value);
  });
  it("formats currency and calendar dates with the selected conventions", () => {
    settings = JSON.stringify({ locale: "en-GB", currency: "GBP", dateFormat: "iso" });
    expect(formatCurrency(12.5)).toBe("£12.50"); expect(formatDate("2026-09-02")).toBe("2026-09-02");
  });
  it("falls back safely from invalid preferences", () => {
    settings = "{";
    expect(preferences().currency).toBe("USD");
    settings = JSON.stringify({ currency: "INVALID", locale: "invalid", distanceUnit: "lightyears" });
    expect(preferences()).toEqual({ locale: "en-US", currency: "USD", distanceUnit: "mi", dateFormat: "local" });
  });
});
