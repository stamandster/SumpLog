import {
  BookOpenText,
  Boxes,
  Calculator,
  CarFront,
  ClipboardList,
  FileText,
  Gauge,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Settings,
  Wrench,
} from "lucide-react";

import { useEffect, useRef, useState } from "react";

export type Section = "dashboard" | "maintenance" | "parts" | "specs" | "projects" | "documents" | "insurance" | "calculators" | "vehicles" | "settings";

const primaryItems = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "parts", label: "Parts", icon: Boxes },
  { id: "specs", label: "Specs", icon: BookOpenText },
  { id: "calculators", label: "Calculators", icon: Calculator },
  { id: "projects", label: "Projects", icon: ClipboardList },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "insurance", label: "Insurance", icon: ShieldCheck },
] as const;

const secondaryItems = [
  { id: "vehicles", label: "Vehicles", icon: CarFront },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({ section, onSectionChange, collapsed, onCollapsedChange }: { section: Section; onSectionChange: (section: Section) => void; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void }) {
  return (
    <aside className="sidebar" data-collapsed={collapsed || undefined}>
      <div className="sidebar__brand">
        <button className="wordmark" onClick={() => onSectionChange("dashboard")} aria-label="SumpLog dashboard" title="SumpLog dashboard">
          <span className="wordmark__full">SumpLog</span><span className="wordmark__short" aria-hidden="true">S</span>
        </button>
        <button className="sidebar__collapse icon-button" type="button" onClick={() => onCollapsedChange(!collapsed)} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-pressed={collapsed} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        {primaryItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className="nav-item"
            data-active={section === id}
            aria-current={section === id ? "page" : undefined}
            onClick={() => onSectionChange(id)}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__secondary">
        {secondaryItems.map(({ id, label, icon: Icon }) => (
          <button key={id} className="nav-item" data-active={section === id} aria-current={section === id ? "page" : undefined} onClick={() => onSectionChange(id)} title={collapsed ? label : undefined}>
            <Icon size={18} /><span>{label}</span>
          </button>
        ))}
        <p className="sidebar__storage">Stored on this server</p>
      </div>
    </aside>
  );
}

export function MobileNav({ section, onSectionChange }: { section: Section; onSectionChange: (section: Section) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (moreOpen) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [moreOpen]);
  const closeMore = () => { setMoreOpen(false); moreRef.current?.focus(); };
  const visible = primaryItems.slice(0, 4);
  const moreItems = [...primaryItems.slice(4), ...secondaryItems];
  return (
    <>
      {moreOpen && <div ref={menuRef} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeMore(); } }} className="mobile-more" id="mobile-more-menu" aria-label="More destinations">
        {moreItems.map(({ id, label, icon: Icon }) => <button key={id} data-active={section === id} aria-current={section === id ? "page" : undefined} onClick={() => { onSectionChange(id); closeMore(); }}><Icon size={18} /><span>{label}</span></button>)}
      </div>}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {visible.map(({ id, label, icon: Icon }) => (
          <button key={id} data-active={section === id} aria-current={section === id ? "page" : undefined} onClick={() => { onSectionChange(id); setMoreOpen(false); }}>
            <Icon size={19} strokeWidth={1.8} />
            <span>{label === "Maintenance" ? "Maint." : label}</span>
          </button>
        ))}
        <button ref={moreRef} data-active={moreItems.some((item) => item.id === section)} aria-expanded={moreOpen} aria-controls="mobile-more-menu" onClick={() => setMoreOpen((current) => !current)}>
          <MoreHorizontal size={19} /><span>More</span>
        </button>
      </nav>
    </>
  );
}
