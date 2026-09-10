import { formatCurrency, formatNumber, formatDistance, formatDate } from "../format";
import type { DashboardData } from "../api";

const currency = { format: formatCurrency };

export function StatusStrip({ stats, onOpenParts }: { stats: DashboardData["partStats"]; onOpenParts: () => void }) {
  const items = [
    { label: "Parts in stock", value: formatNumber(stats.totalParts) },
    { label: "Inventory value", value: currency.format(stats.inventoryValueCents / 100) },
  ];

  return (
    <section className="status-strip" aria-label="Inventory status">
      {items.map((item) => (
        <button key={item.label} type="button" className="status-stat" onClick={onOpenParts} title="Open parts catalogue">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </button>
      ))}
    </section>
  );
}
