export type Preferences = { locale: string; currency: string; distanceUnit: "mi" | "km"; dateFormat: "local" | "iso" };
const defaults: Preferences = { locale: "en-US", currency: "USD", distanceUnit: "mi", dateFormat: "local" };
export function preferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem("sumplog-preferences") ?? "{}");
    return { locale: ["en-US", "en-GB", "en-CA", "de-DE", "fr-FR"].includes(saved.locale) ? saved.locale : defaults.locale, currency: ["USD", "CAD", "GBP", "EUR", "AUD"].includes(saved.currency) ? saved.currency : defaults.currency, distanceUnit: saved.distanceUnit === "km" ? "km" : "mi", dateFormat: saved.dateFormat === "iso" ? "iso" : "local" };
  } catch { return defaults; }
}
export function savePreferences(value: Preferences) { localStorage.setItem("sumplog-preferences", JSON.stringify(value)); window.dispatchEvent(new Event("sumplog:preferences")); }
export const formatNumber = (value: number) => new Intl.NumberFormat(preferences().locale).format(value);
export const formatCurrency = (value: number) => new Intl.NumberFormat(preferences().locale, { style: "currency", currency: preferences().currency }).format(value);
export const distanceUnit = () => preferences().distanceUnit;
export const displayDistance = (miles: number) => Math.round(miles * (distanceUnit() === "km" ? 1.609344 : 1));
export const inputDistance = (miles: number | null | undefined) => miles == null ? "" : String(displayDistance(miles));
export const storedDistance = (value: string | number) => Math.round(Number(value) / (distanceUnit() === "km" ? 1.609344 : 1));
export const formatDistance = (miles: number) => `${formatNumber(displayDistance(miles))} ${distanceUnit()}`;
export function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  if (preferences().dateFormat === "iso") return value.slice(0, 10);
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(preferences().locale);
}
export function formatTimestamp(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(preferences().locale);
}
export function today() { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
