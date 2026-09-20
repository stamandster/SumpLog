/** Explain total volume in container units without limiting usage to one container. */
export function describeConsumableUsage(amount: number, volumePerUnit: number, unit: string): string {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(volumePerUnit) || volumePerUnit <= 0) return "Enter total volume used, including full and partial items.";
  const quantity = Math.round(amount / volumePerUnit * 1e8) / 1e8;
  const whole = Math.floor(quantity);
  const remainder = Math.round((quantity - whole) * volumePerUnit * 1e8) / 1e8;
  if (!whole) return `${remainder} ${unit} from one item`;
  return `${whole} full item${whole === 1 ? "" : "s"}${remainder ? ` + ${remainder} ${unit} from another` : ""}`;
}
