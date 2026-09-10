export function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  // Neutralize spreadsheet formulas while preserving ordinary CSV quoting.
  const safe = /^[=+@\t\r-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
