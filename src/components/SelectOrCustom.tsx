import { useEffect, useMemo, useState } from "react";

const customOption = "__sumplog_custom__";

export function SelectOrCustom({ value, options, onChange, label, placeholder, emptyLabel = "Not recorded" }: { value: string; options: string[]; onChange: (value: string) => void; label: string; placeholder?: string; emptyLabel?: string }) {
  const choices = useMemo(() => [...new Set(options.map((option) => option.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [options]);
  const [custom, setCustom] = useState(() => Boolean(value) && !choices.includes(value));

  useEffect(() => { setCustom(Boolean(value) && !choices.includes(value)); }, [value, choices]);

  return <div className="select-or-custom"><select aria-label={label} value={custom ? customOption : value} onChange={(event) => { const next = event.target.value; setCustom(next === customOption); if (next !== customOption) onChange(next); }}><option value="">{emptyLabel}</option>{choices.map((option) => <option key={option} value={option}>{option}</option>)}<option value={customOption}>Add custom…</option></select>{custom && <input aria-label={`Custom ${label.toLowerCase()}`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</div>;
}
