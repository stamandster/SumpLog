import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { Part } from "../api";

export function SecondaryPanels({ parts, onOpenLowStock }: { parts: Part[]; onOpenLowStock: () => void }) {
  const lowStock = parts.filter((part) => part.quantity < part.minimumQuantity).slice(0, 5);
  return (
      <section className="panel compact-panel low-stock-panel" aria-labelledby="low-stock-title">
        <header className="panel__header">
          <div>
            
            <h2 id="low-stock-title">Low stock</h2>
          </div>
          <span className="count-badge">{lowStock.length}</span>
        </header>
        <ul className="compact-list">
          {lowStock.length ? lowStock.map((part) => (
            <li key={part.id}><button type="button" className="compact-list__action" onClick={onOpenLowStock} title="Show all low-stock parts">
              <AlertCircle size={16} />
              <span><strong>{part.name}</strong><small>{part.partNumber}</small></span>
              <span className="list-value">{part.quantity} / {part.minimumQuantity}</span>
            </button></li>
          )) : (
            <li className="all-good"><CheckCircle2 size={16} />Stock levels look good.</li>
          )}
        </ul>
      </section>
  );
}
