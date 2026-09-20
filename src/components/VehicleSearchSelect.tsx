import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { filterVehicles, vehicleLabel, type VehicleOption } from "../vehicleSearch";

export function VehicleSearchSelect({ id, vehicles, value, onChange, disabled = false, invalid = false, describedBy }: {
  id: string;
  vehicles: VehicleOption[];
  value: number | null;
  onChange: (id: number) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected = vehicles.find((vehicle) => vehicle.id === value);
  const matches = filterVehicles(vehicles, query);
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
  const listId = `${id}-options`;
  const optionId = (vehicleId: number) => `${id}-vehicle-${vehicleId}`;

  useEffect(() => { setOpen(false); }, [value, disabled]);
  useEffect(() => {
    if (open) list.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);

  const openList = () => {
    if (disabled) return;
    setQuery("");
    setActive(Math.max(0, vehicles.findIndex((vehicle) => vehicle.id === value)));
    setOpen(true);
  };
  const choose = (vehicleId: number) => {
    input.current?.focus();
    setOpen(false);
    setQuery("");
    if (vehicleId !== value) onChange(vehicleId);
  };

  return <div className="vehicle-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <input ref={input} id={id} className="vehicle-search__input" type="text" role="combobox" autoComplete="off" spellCheck={false}
      value={open ? query : selected ? `${vehicleLabel(selected)} · #${selected.id}` : ""}
      placeholder={open ? "Search year, make, model, nickname…" : "Choose a vehicle"}
      title={selected ? vehicleLabel(selected) : "Choose a vehicle"} disabled={disabled} aria-disabled={disabled} aria-invalid={invalid || undefined}
      aria-describedby={describedBy} aria-expanded={open} aria-autocomplete="list" aria-controls={listId}
      aria-activedescendant={open && matches[activeIndex] ? optionId(matches[activeIndex].id) : undefined}
      onFocus={() => { if (!open) openList(); }} onClick={() => { if (!open) openList(); }}
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) openList();
          else setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % Math.max(1, matches.length));
        } else if (open && (event.key === "Home" || event.key === "End")) {
          event.preventDefault(); setActive(event.key === "Home" ? 0 : Math.max(0, matches.length - 1));
        } else if (open && event.key === "Enter") {
          event.preventDefault(); if (matches[activeIndex]) choose(matches[activeIndex].id);
        }
      }} />
    <button type="button" className="vehicle-search__toggle" tabIndex={-1} aria-label={open ? "Close vehicle choices" : "Show vehicle choices"} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) setOpen(false); else { input.current?.focus(); openList(); } }}><ChevronDown size={16} aria-hidden="true" /></button>
    <div className="vehicle-search__options" id={listId} ref={list} role="listbox" aria-label="Vehicles" hidden={!open}>
      {open && matches.map((vehicle, index) => <button type="button" role="option" tabIndex={-1} id={optionId(vehicle.id)} key={vehicle.id}
        aria-selected={vehicle.id === value} data-highlighted={index === activeIndex || undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(vehicle.id)}>
        <span>{vehicleLabel(vehicle)} <small>#{vehicle.id}</small></span>{vehicle.id === value && <Check size={16} aria-label="Current vehicle" />}
      </button>)}
      {open && matches.length === 0 && <p>No matching vehicles.</p>}
    </div>
    {open && <span className="sr-only" role="status">{matches.length} matching vehicle{matches.length === 1 ? "" : "s"}</span>}
  </div>;
}
