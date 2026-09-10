import { preferences } from "../format";
import { SelectOrCustom } from "./SelectOrCustom";
/* Hallmark · component: inventory dialog · genre: technical · theme: Parts Counter Clean
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (46–50)
 */
import { AlertTriangle, Check, LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Part, PartInput, Vehicle } from "../api";

type FormState = {
  itemType: "Part" | "Consumable";
  category: string;
  specifications: string;
  approvals: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  supplierName: string;
  supplierUrl: string;
  purchasePrice: string;
  quantity: string;
  volumePerUnit: string;
  volumeUnit: string;
  minimumQuantity: string;
  storageLocation: string;
  notes: string;
  fitment: "vehicle" | "general";
  fitmentVehicleIds: number[];
  fitmentNotes: string;
  vehicleNotes: Record<number, string>;
};

function initialForm(part: Part | null, activeVehicle: Vehicle | null): FormState {
  return {
    itemType: part?.itemType ?? "Part",
    category: part?.category ?? "",
    specifications: part?.specifications ?? "",
    approvals: part?.approvals ?? "",
    partNumber: part?.partNumber ?? "",
    name: part?.name ?? "",
    manufacturer: part?.manufacturer ?? "",
    supplierName: part?.supplierName ?? "",
    supplierUrl: part?.supplierUrl ?? "",
    purchasePrice: part ? (part.purchasePriceCents / 100).toFixed(2) : "",
    quantity: String(part?.quantity ?? 0),
    volumePerUnit: part?.volumePerUnit == null ? "" : String(part.volumePerUnit),
    volumeUnit: part?.volumeUnit ?? "",
    minimumQuantity: String(part?.minimumQuantity ?? 0),
    storageLocation: part?.storageLocation ?? "",
    notes: part?.notes ?? "",
    fitment: part ? (part.fitments.length ? "vehicle" : "general") : activeVehicle ? "vehicle" : "general",
    fitmentVehicleIds: part?.fitments?.map((fitment) => fitment.vehicleId) ?? (activeVehicle ? [activeVehicle.id] : []),
    fitmentNotes: part?.fitmentNotes ?? "",
    vehicleNotes: Object.fromEntries((part?.fitments ?? []).map((fitment) => [fitment.vehicleId, fitment.notes ?? ""])),
  };
}

function needsCustomStorageLocation(part: Part | null, storageLocations: string[]) {
  return Boolean(part?.storageLocation && !storageLocations.includes(part.storageLocation));
}

export function PartDialog({
  open,
  part,
  vehicle,
  vehicles,
  storageLocations,
  manufacturers,
  suppliers,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  part: Part | null;
  vehicle: Vehicle | null;
  vehicles: Vehicle[];
  storageLocations: string[];
  manufacturers: string[];
  suppliers: string[];
  onClose: () => void;
  onSave: (input: PartInput) => Promise<void>;
  onDelete: (part: Part) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState(() => initialForm(part, vehicle));
  const [customStorageLocation, setCustomStorageLocation] = useState(() => needsCustomStorageLocation(part, storageLocations));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [operation, setOperation] = useState<"save" | "delete">("save");
  const [submitError, setSubmitError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setForm(initialForm(part, vehicle));
      setCustomStorageLocation(needsCustomStorageLocation(part, storageLocations));
      setTouched({});
      setStatus("idle");
      setOperation("save");
      setSubmitError("");
      setDeleteConfirm(false);
      dialog.showModal();
      requestAnimationFrame(() => dialog.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), select, textarea")?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, part]);

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (!form.partNumber.trim()) next.partNumber = "Enter a part number.";
    if (form.name.trim().length < 2) next.name = "Enter a description with at least 2 characters.";
    if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 0) next.quantity = "Use a whole number of zero or more.";
    if (form.volumePerUnit && (!Number.isFinite(Number(form.volumePerUnit)) || Number(form.volumePerUnit) <= 0)) next.volumePerUnit = "Use a positive volume.";
    if (form.volumePerUnit && !form.volumeUnit.trim()) next.volumeUnit = "Choose or enter a unit.";
    if (!form.volumePerUnit && form.volumeUnit.trim()) next.volumePerUnit = "Enter the volume for each unit.";
    if (!Number.isInteger(Number(form.minimumQuantity)) || Number(form.minimumQuantity) < 0) next.minimumQuantity = "Use a whole number of zero or more.";
    if (form.purchasePrice && (!Number.isFinite(Number(form.purchasePrice)) || Number(form.purchasePrice) < 0)) next.purchasePrice = "Enter a valid non-negative price.";
    if (form.supplierUrl) {
      try { if (!["http:", "https:"].includes(new URL(form.supplierUrl).protocol)) throw new Error(); } catch { next.supplierUrl = "Enter a complete URL, including https://"; }
    }
    if (form.fitment === "vehicle" && form.fitmentVehicleIds.length === 0) next.fitment = "Choose at least one compatible vehicle.";
    return next;
  }, [form]);

  const savedStorageLocations = useMemo(() => [...new Set([...storageLocations, ...(part?.storageLocation ? [part.storageLocation] : [])].map((location) => location.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [storageLocations, part?.storageLocation]);

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value } as FormState));
    setDeleteConfirm(false);
    if (status === "error") setStatus("idle");
  };

  const close = () => {
    if (status === "loading") return;
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "loading" || status === "success") return;
    setTouched({ partNumber: true, name: true, quantity: true, volumePerUnit: true, volumeUnit: true, minimumQuantity: true, purchasePrice: true, supplierUrl: true, fitment: true });
    if (Object.keys(errors).length) return;
    setStatus("loading");
    setOperation("save");
    setSubmitError("");
    try {
      await onSave({
        itemType: form.itemType,
        category: form.category,
        specifications: form.specifications,
        approvals: form.approvals,
        partNumber: form.partNumber.trim(),
        name: form.name.trim(),
        manufacturer: form.manufacturer.trim(),
        supplierName: form.supplierName.trim(),
        supplierUrl: form.supplierUrl.trim(),
        purchasePrice: Number(form.purchasePrice || 0),
        quantity: Number(form.quantity),
        volumePerUnit: form.volumePerUnit ? Number(form.volumePerUnit) : null,
        volumeUnit: form.volumeUnit.trim(),
        minimumQuantity: Number(form.minimumQuantity),
        storageLocation: form.storageLocation.trim(),
        notes: form.notes.trim(),
        vehicleId: null,
        fitments: form.fitment === "vehicle" ? form.fitmentVehicleIds.map((vehicleId) => ({ vehicleId, notes: (form.vehicleNotes[vehicleId] ?? "").trim() })) : [],
      });
      setStatus("success");
      window.setTimeout(onClose, 500);
    } catch (error) {
      setStatus("error");
      setSubmitError(error instanceof Error ? error.message : "The part could not be saved. Try again.");
    }
  };

  const remove = async () => {
    if (!part) return;
    setStatus("loading");
    setOperation("delete");
    setSubmitError("");
    try {
      await onDelete(part);
      setStatus("success");
      window.setTimeout(onClose, 400);
    } catch (error) {
      setStatus("error");
      setDeleteConfirm(false);
      setSubmitError(error instanceof Error ? error.message : "The part could not be deleted. Try again.");
    }
  };

  const fieldError = (name: string) => touched[name] ? errors[name] : undefined;

  return (
    <dialog ref={dialogRef} aria-label={part ? "Edit inventory part" : "Add inventory part"} className="maintenance-dialog part-dialog" onCancel={(event) => { event.preventDefault(); close(); }} onClose={onClose}>
      <form method="dialog" onSubmit={submit} noValidate>
        <header className="dialog__header">
          <div>
            <span className="panel__kicker">Garage-wide inventory</span>
            <h2>{part ? "Edit inventory part" : "Add inventory part"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close part form"><X size={19} /></button>
        </header>

        <div className="form-grid">
          <Field label="Item type" name="itemType"><select id="itemType" value={form.itemType} onChange={(event) => update("itemType", event.target.value)}><option>Part</option><option>Consumable</option></select></Field>
          <Field label="Category" name="category"><SelectOrCustom label="Category" value={form.category} options={["Engine oil", "Transmission fluid", "Coolant", "Brake fluid", "Gear oil", "Grease", "Cleaner", "Lubricant", "Filter", "Ignition", "Brakes"]} onChange={(value) => update("category", value)} emptyLabel="No category" /></Field>
          <Field label="Claimed standards / specifications" name="specifications" help="Enter one per line, as stated on the product label."><textarea id="specifications" value={form.specifications} onChange={(event) => update("specifications", event.target.value)} /></Field>
          <Field label="Manufacturer approvals" name="approvals" help="Record verified approvals separately from compatibility claims. Check vehicle Specs before use."><textarea id="approvals" value={form.approvals} onChange={(event) => update("approvals", event.target.value)} /></Field>
          <Field label="Part number" name="partNumber" error={fieldError("partNumber")}>
            <input id="partNumber" autoFocus value={form.partNumber} onChange={(e) => update("partNumber", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, partNumber: true }))} placeholder="11 42 1 711 252" aria-invalid={Boolean(fieldError("partNumber"))} />
          </Field>
          <Field label="Description" name="partName" error={fieldError("name")}>
            <input id="partName" value={form.name} onChange={(e) => update("name", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, name: true }))} placeholder="Oil filter" aria-invalid={Boolean(fieldError("name"))} />
          </Field>
          <Field label="Manufacturer" name="manufacturer">
            <SelectOrCustom label="Manufacturer" value={form.manufacturer} options={manufacturers} onChange={(value) => update("manufacturer", value)} placeholder="e.g. MANN-FILTER" emptyLabel="No manufacturer recorded" />
          </Field>
          <Field label="Storage location" name="storageLocation" help="Where the part physically lives, such as a shelf, bin, toolbox, or cabinet.">
            <select id="storageLocation" value={customStorageLocation ? "__custom__" : form.storageLocation} onChange={(event) => { const value = event.target.value; setCustomStorageLocation(value === "__custom__"); if (value !== "__custom__") update("storageLocation", value); }}>
              <option value="">No location recorded</option>
              {savedStorageLocations.map((location) => <option key={location} value={location}>{location}</option>)}
              <option value="__custom__">Add a custom location…</option>
            </select>
            {customStorageLocation && <input id="customStorageLocation" value={form.storageLocation} onChange={(event) => update("storageLocation", event.target.value)} placeholder="e.g. Shelf B-2" aria-label="Custom storage location" />}
          </Field>
          <Field label="Quantity" name="quantity" error={fieldError("quantity")}>
            <input id="quantity" type="number" min="0" step="1" inputMode="numeric" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, quantity: true }))} aria-invalid={Boolean(fieldError("quantity"))} />
          </Field>
          <Field label="Volume per unit" name="volumePerUnit" error={fieldError("volumePerUnit")} help="Optional, for fluids such as oil, coolant, or brake fluid.">
            <input id="volumePerUnit" type="number" min="0" step="any" inputMode="decimal" value={form.volumePerUnit} onChange={(e) => update("volumePerUnit", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, volumePerUnit: true }))} placeholder="e.g. 5" aria-invalid={Boolean(fieldError("volumePerUnit"))} />
          </Field>
          <Field label="Volume unit" name="volumeUnit" error={fieldError("volumeUnit")}>
            <SelectOrCustom label="Volume unit" value={form.volumeUnit} options={["mL", "L", "fl oz", "qt", "gal"]} onChange={(value) => update("volumeUnit", value)} placeholder="e.g. qt" emptyLabel="No volume recorded" />
          </Field>
          <Field label="Low-stock threshold" name="minimumQuantity" error={fieldError("minimumQuantity")}>
            <input id="minimumQuantity" type="number" min="0" step="1" inputMode="numeric" value={form.minimumQuantity} onChange={(e) => update("minimumQuantity", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, minimumQuantity: true }))} aria-invalid={Boolean(fieldError("minimumQuantity"))} />
          </Field>
          <Field label="Unit price" name="purchasePrice" error={fieldError("purchasePrice")}>
            <div className="input-unit input-unit--prefix"><span>{preferences().currency}</span><input id="purchasePrice" inputMode="decimal" value={form.purchasePrice} onChange={(e) => update("purchasePrice", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, purchasePrice: true }))} placeholder="0.00" aria-invalid={Boolean(fieldError("purchasePrice"))} /></div>
          </Field>
          <Field label="Supplier" name="supplierName">
            <SelectOrCustom label="Supplier" value={form.supplierName} options={suppliers} onChange={(value) => update("supplierName", value)} placeholder="e.g. Local parts counter" emptyLabel="No supplier recorded" />
          </Field>
          <Field label="Supplier link" name="supplierUrl" error={fieldError("supplierUrl")} span="wide">
            <input id="supplierUrl" type="url" value={form.supplierUrl} onChange={(e) => update("supplierUrl", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, supplierUrl: true }))} placeholder="https://supplier.example/part" aria-invalid={Boolean(fieldError("supplierUrl"))} />
          </Field>
          <Field label="Stock type" name="fitment" error={fieldError("fitment")}>
            <select id="fitment" value={form.fitment} onChange={(e) => update("fitment", e.target.value)}>
              <option value="vehicle">Vehicle-specific stock</option>
              <option value="general">General garage stock</option>
            </select>
          </Field>
          {form.fitment === "vehicle" && <fieldset className="fitment-picker"><legend>Compatible vehicles</legend>{vehicles.map((item) => <div key={item.id}><label className="check-row"><input type="checkbox" checked={form.fitmentVehicleIds.includes(item.id)} onChange={(event) => setForm((current) => ({ ...current, fitmentVehicleIds: event.target.checked ? [...current.fitmentVehicleIds, item.id] : current.fitmentVehicleIds.filter((id) => id !== item.id) }))} />{item.year} {item.make} {item.model}</label>{form.fitmentVehicleIds.includes(item.id) && <input aria-label={`Fitment note for ${item.year} ${item.make} ${item.model}`} value={form.vehicleNotes[item.id] ?? ""} placeholder="Fitment note (optional)" onChange={(event) => { const note = event.target.value; setForm((current) => ({ ...current, vehicleNotes: { ...current.vehicleNotes, [item.id]: note } })); }} />}</div>)}</fieldset>}
          <Field label="Notes" name="partNotes" span="wide">
            <textarea id="partNotes" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Cross references, return window, or install notes…" />
          </Field>
        </div>

        {deleteConfirm && part && (
          <div className="delete-confirm" role="alert">
            <AlertTriangle size={18} />
            <span>Delete <strong>{part.partNumber}</strong>? This cannot be undone.</span>
            <button type="button" className="button button--quiet" onClick={() => setDeleteConfirm(false)} disabled={status === "loading"}>Keep part</button>
            <button type="button" className="button button--danger" onClick={remove} disabled={status === "loading"}>{status === "loading" && operation === "delete" ? <><LoaderCircle className="spin" size={17} />Deleting…</> : "Confirm delete"}</button>
          </div>
        )}
        <div className="dialog__status" aria-live="polite">{submitError || (status === "success" ? (part && deleteConfirm ? "Part deleted." : "Part saved.") : "")}</div>
        <footer className="dialog__footer dialog__footer--split">
          <div>{part && <button type="button" className="button button--quiet button--destructive-quiet" onClick={() => setDeleteConfirm(true)} disabled={status === "loading"}><Trash2 size={16} />Delete part</button>}</div>
          <div className="dialog__footer-actions">
            <button type="button" className="button button--quiet" onClick={close} disabled={status === "loading"}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={status === "loading" || status === "success"} data-state={status}>
              {status === "loading" ? <><LoaderCircle className="spin" size={17} />{operation === "delete" ? "Deleting…" : "Saving…"}</> : status === "success" ? <><Check size={17} />{operation === "delete" ? "Deleted" : "Saved"}</> : part ? "Save changes" : "Add part"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function Field({ label, name, error, help, span, children }: { label: string; name: string; error?: string; help?: string; span?: "wide"; children: React.ReactNode }) {
  return <div className="field" data-span={span}><label htmlFor={name}>{label}</label>{children}<span className="field__help">{error ?? help ?? "\u00a0"}</span></div>;
}
