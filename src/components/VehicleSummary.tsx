import { CarFront, Circle, Clock3, Wrench, X } from "lucide-react";
import type { DashboardData, MaintenanceRecord } from "../api";
import { VehicleArt } from "./VehicleArt";

import { formatDistance, formatDate, today } from "../format";

export function VehicleSummary({ data, onOpenVehicle, onOpenMaintenance, onLogService, onRemoveService }: { data: DashboardData; onOpenVehicle: () => void; onOpenMaintenance: (record: MaintenanceRecord) => void; onLogService: (service: MaintenanceRecord) => void; onRemoveService: (service: MaintenanceRecord) => Promise<void> }) {
  const { vehicle, nextServices } = data;

  return (
    <section className="vehicle-summary" aria-labelledby="vehicle-title">
      <a className="vehicle-summary__open" href={`/vehicles?vehicle=${vehicle.id}&details=mileage`} onClick={(event) => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenVehicle(); }} aria-label={`Open ${vehicle.year} ${vehicle.make} ${vehicle.model} in Vehicles`}>
        <div className="vehicle-summary__art">
          {vehicle.imageUrl ? <img className="vehicle-summary__photo" src={`${vehicle.imageUrl}${vehicle.imageUrl.includes("?") ? "&" : "?"}preview=1`} alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} loading="eager" fetchPriority="high" style={{ objectPosition: `${vehicle.photoPositionX ?? 50}% ${vehicle.photoPositionY ?? 50}%`, transformOrigin: `${vehicle.photoPositionX ?? 50}% ${vehicle.photoPositionY ?? 50}%`, transform: `scale(${vehicle.photoZoom ?? 1})` }} /> : <VehicleArt />}
        </div>
        <div className="vehicle-summary__identity">
          <div className="eyeline"><CarFront size={15} /> Current vehicle</div>
          <h1 id="vehicle-title">{vehicle.year} {vehicle.make} {vehicle.model}</h1>
          <div className="vehicle-meta">
            {vehicle.nickname && <span className="tag">{vehicle.nickname}</span>}
            <span>{formatDistance(vehicle.mileage)}</span>
            {vehicle.engine && <span>{vehicle.engine}</span>}
          </div>
        </div>
      </a>
      <section className="panel compact-panel next-services" aria-labelledby="next-services-title">
        <header className="panel__header"><div><h2 id="next-services-title">Next services</h2></div><span className="count-badge">{nextServices.length}</span></header>
        {nextServices.length ? <ul>{nextServices.map((service) => { const miles = service.nextDueMileage != null ? service.nextDueMileage - vehicle.mileage : null; const days = service.nextDueDate ? Math.ceil((Date.parse(`${service.nextDueDate}T12:00:00`) - Date.parse(`${today()}T12:00:00`)) / 86_400_000) : null; const level = (miles != null && miles <= 500) || (days != null && days <= 21) ? "red" : (miles != null && miles <= 2_000) || (days != null && days <= 60) ? "yellow" : "green"; const datePast = Boolean(days != null && days < 0); const timing = miles == null ? (service.nextDueDate ? `${datePast ? "Overdue since" : "Due"} ${formatDate(service.nextDueDate)}` : "Due point not set") : miles <= 0 ? `${formatDistance(Math.abs(miles))} overdue` : `In ${formatDistance(miles)}`; return <li key={service.id} data-level={level}><button type="button" className="next-services__open" onClick={() => onLogService(service)} aria-label={`Log service: ${service.title}`}><Circle className="next-services__status" size={12} fill="currentColor" aria-label={`${level} urgency`} /><span><strong>{service.title}</strong><small>{timing}{service.nextDueDate ? ` · ${datePast ? "Overdue since" : "Due"} ${formatDate(service.nextDueDate)}` : ""}</small></span><span className="tag">{service.category}</span></button>{service.id > 0 && <button className="icon-button next-services__remove" title="Remove from next services" aria-label={`Remove ${service.title} from next services`} onClick={() => void onRemoveService(service)}><X size={15} /></button>}</li>; })}</ul> : <p className="dashboard-service-empty">No upcoming services, tasks, or reminders have a due date or mileage yet.</p>}
      </section>
      <section className="panel compact-panel recent-maintenance" aria-labelledby="activity-title">
        <header className="panel__header">
          <div><h2 id="activity-title">Recent maintenance</h2></div>
          <Wrench size={18} />
        </header>
        <ul className="compact-list activity-list">
          {!data.recentMaintenance.length && <li className="activity-list__empty dashboard-service-empty">No maintenance recorded yet.</li>}
          {data.recentMaintenance.map((record) => (
            <li key={record.id}>
              <a className="compact-list__action" href={`/maintenance?vehicle=${vehicle.id}&record=${record.id}`} onClick={(event) => { event.preventDefault(); onOpenMaintenance(record); }} aria-label={`Open maintenance record: ${record.title}`}>
                <Clock3 size={16} />
                <span><strong>{record.title}</strong><small>{formatDate(record.serviceDate)}</small></span>
                <span className="list-value">{formatDistance(record.mileage)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
