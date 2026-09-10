/* Hallmark · component: vehicle context · genre: atmospheric · theme: clean garage counter
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { AlertTriangle, Bell, CarFront, Check, Download, LoaderCircle, Plus, Search } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { Vehicle } from "../api";

export type VehicleOption = Pick<Vehicle, "id" | "year" | "make" | "model" | "nickname">;

export function vehicleLabel(vehicle: VehicleOption) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.nickname?.trim() ? ` · ${vehicle.nickname.trim()}` : ""}`;
}

export function VehicleContext({ vehicles, vehicleId, onSelectVehicle, state = "default", className = "" }: {
  vehicles: VehicleOption[];
  vehicleId: number | null;
  onSelectVehicle: (id: number) => void;
  state?: "default" | "loading" | "error" | "success" | "disabled";
  className?: string;
}) {
  const id = useId();
  const vehicle = vehicles.find((item) => item.id === vehicleId);
  const canSwitch = vehicles.length > 1;
  const Icon = state === "loading" ? LoaderCircle : state === "error" ? AlertTriangle : state === "success" ? Check : CarFront;
  return <div className={`vehicle-context ${className}`} data-state={state} aria-busy={state === "loading"}>
    <Icon size={20} className="vehicle-context__icon" aria-hidden="true" />
    <div className="vehicle-context__details">
      {canSwitch ? <label htmlFor={id}>Selected vehicle</label> : <span className="vehicle-context__label">Selected vehicle</span>}
      {canSwitch ? <select id={id} value={vehicle?.id ?? ""} onChange={(event) => onSelectVehicle(Number(event.target.value))}
        disabled={state === "disabled"} aria-disabled={state === "disabled"} aria-invalid={state === "error" || undefined}
        aria-describedby={`${id}-help`} title={vehicle ? vehicleLabel(vehicle) : "Choose a vehicle"}>
        {!vehicle && <option value="" disabled>Choose a vehicle</option>}
        {vehicles.map((item) => <option key={item.id} value={item.id}>{vehicleLabel(item)} · #{item.id}</option>)}
      </select> : <strong className="vehicle-context__name">{vehicle ? vehicleLabel(vehicle) : "No vehicle selected"}</strong>}
      <span id={`${id}-help`} className={state === "error" ? "vehicle-context__error" : "sr-only"}>
        {state === "error" ? "Vehicle could not load. Retry or select another vehicle." : "Used for vehicle-specific pages and logging maintenance. Documents, fleet and settings are garage-wide."}
      </span>
      <span className="sr-only" role="status">{state === "loading" ? "Loading vehicle" : state === "success" ? "Vehicle selected" : ""}</span>
    </div>
  </div>;
}

export function Topbar({
  query,
  onQueryChange,
  onLogMaintenance,
  alertCount,
  onOpenAlerts,
  canLogMaintenance,
  searchVisible,
  vehicles,
  vehicleId,
  onSelectVehicle,
  showVehicleContext,
  vehicleLoading = false,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onLogMaintenance: () => void;
  alertCount: number;
  onOpenAlerts: () => void;
  canLogMaintenance: boolean;
  searchVisible: boolean;
  vehicles: VehicleOption[];
  vehicleId: number | null;
  onSelectVehicle: (id: number) => void;
  showVehicleContext: boolean;
  vehicleLoading?: boolean;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!searchVisible) return;
    const focusSearch = (event: KeyboardEvent) => { if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !document.querySelector("dialog[open]") && !(event.target instanceof HTMLElement && event.target.isContentEditable) && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", focusSearch); return () => window.removeEventListener("keydown", focusSearch);
  }, [searchVisible]);
  return (
    <header className="topbar" data-vehicle-context={showVehicleContext}>
      {showVehicleContext ? <VehicleContext vehicles={vehicles} vehicleId={vehicleId} onSelectVehicle={onSelectVehicle} state={vehicleLoading ? "loading" : "default"} /> : <div className="mobile-wordmark">SumpLog</div>}
      {searchVisible ? <label className="global-search">
        <span className="sr-only">Search parts</span>
        <Search size={18} aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search parts, numbers, locations…"
        />
        <kbd>/</kbd>
      </label> : null}
      <div className="topbar__actions">
        <a className="icon-button desktop-only" href="/api/export/archive.zip" download title="Export ZIP (Excel + files)">
          <Download size={18} />
          <span className="sr-only">Export ZIP (Excel + files)</span>
        </a>
        <button className="icon-button desktop-only" aria-label={`${alertCount} notifications`} onClick={onOpenAlerts}>
          <Bell size={18} />
          {alertCount > 0 && <span className="notification-dot" />}
        </button>
        <button className="button button--primary" onClick={onLogMaintenance} disabled={!canLogMaintenance} title={canLogMaintenance ? undefined : "Add a vehicle before logging maintenance"}>
          <Plus size={17} />
          <span>Log maintenance</span>
        </button>
      </div>
    </header>
  );
}
