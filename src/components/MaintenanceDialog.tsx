import { distanceUnit, formatDistance, inputDistance, storedDistance, preferences, today } from "../format";
import { Check, Download, FileText, LoaderCircle, Trash2, X } from "lucide-react";
import { MaintenanceEvidence } from "./MaintenanceEvidence";
import { PhotoEditor } from "./PhotoEditor";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentRecord, MaintenanceAttachment, MaintenanceInput, MaintenanceRecord, Vehicle, Part } from "../api";
import { SelectOrCustom } from "./SelectOrCustom";
import { availableEvidenceIds } from "../maintenanceEvidenceSelection";
import { maintenanceSystems } from "../maintenanceOptions";
import { describeConsumableUsage } from "../consumableUsage";

type FormState = {
  title: string;
  category: string;
  serviceDate: string;
  mileage: string;
  cost: string;
  laborHours: string;
  difficulty: string;
  shopName: string;
  notes: string;
  nextDueDate: string;
  nextDueMileage: string;
};

type SelectedPartUsage = {
  usageMode: "Whole" | "Partial";
  quantity: string;
  amountUsed: string;
};




function initialForm(vehicle: Vehicle, record: MaintenanceRecord | null, prefill?: Partial<MaintenanceInput> | null): FormState {
  return {
    title: record?.title ?? prefill?.title ?? "",
    category: record?.category ?? prefill?.category ?? "Engine",
    serviceDate: record?.serviceDate ?? today(),
    mileage: inputDistance(record?.mileage ?? prefill?.mileage ?? vehicle.mileage),
    cost: record ? ((record.costCents - (record.partsCostCents ?? 0)) / 100).toFixed(2) : "",
    laborHours: record ? String(record.laborHours) : "",
    difficulty: String(record?.difficulty ?? 1),
    shopName: record?.shopName ?? "",
    notes: record?.notes ?? "",
    nextDueDate: record?.nextDueDate ?? "",
    nextDueMileage: inputDistance(record?.nextDueMileage),
  };
}

function evidenceIdsForRecord(documents: DocumentRecord[], record: MaintenanceRecord | null) {
  if (!record) return [];
  return documents
    .filter((document) => document.maintenanceIds?.includes(record.id) ?? document.maintenanceId === record.id)
    .sort((left, right) => (left.maintenanceRecords?.find((link) => link.id === record.id)?.position ?? Number.MAX_SAFE_INTEGER) - (right.maintenanceRecords?.find((link) => link.id === record.id)?.position ?? Number.MAX_SAFE_INTEGER) || left.id - right.id)
    .map((document) => document.id);
}

export function MaintenanceDialog({
  open,
  record,
  vehicle,
  parts,
  documents,
  onDeleteDocument,
  prefill,
  shopNames,
  systemNames = [],
  onClose,
  onSubmit,
}: {
  open: boolean;
  record: MaintenanceRecord | null;
  vehicle: Vehicle;
  parts: Part[];
  documents: DocumentRecord[];
  onDeleteDocument: (document: DocumentRecord) => Promise<void>;
  prefill?: Partial<MaintenanceInput> | null;
  shopNames: string[];
  systemNames?: string[];
  onClose: () => void;
  onSubmit: (input: MaintenanceInput, attachments: MaintenanceAttachment[], documentIds: number[]) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submissionKey = useRef("");
  const [form, setForm] = useState(() => initialForm(vehicle, record, prefill));
  const [attachments, setAttachments] = useState<MaintenanceAttachment[]>([]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState("");
  const [selectedParts, setSelectedParts] = useState<Record<number, SelectedPartUsage>>({});
  const [partQuery, setPartQuery] = useState("");
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null);
  const [documentQuery, setDocumentQuery] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>(() => evidenceIdsForRecord(documents, record));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      submissionKey.current = `${Date.now()}-${Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-")}`;
      setForm(initialForm(vehicle, record, prefill));
      setAttachments([]);
      setTouched({});
      setStatus("idle");
      setSubmitError("");
      setSelectedParts(Object.fromEntries((record?.parts ?? []).map((part) => [part.partId, {
        usageMode: part.usageMode ?? "Whole",
        quantity: String(part.usageMode === "Partial" ? 1 : part.quantity),
        amountUsed: part.amountUsed == null ? "" : String(part.amountUsed),
      }])));
      setPartQuery("");
      setDeletingAttachmentId(null);
      setDocumentQuery("");
      setSelectedDocumentIds(evidenceIdsForRecord(documents, record));
      dialog.showModal();
      requestAnimationFrame(() => dialog.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), select, textarea")?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, vehicle, record, prefill]);

  const partsCost = useMemo(() => parts.reduce((sum, part) => {
    const usage = selectedParts[part.id];
    if (!usage) return sum;
    const quantity = usage.usageMode === "Partial" && part.volumePerUnit
      ? Number(usage.amountUsed || 0) / part.volumePerUnit
      : Number(usage.quantity || 0);
    return sum + Math.round(quantity * (record?.parts?.find((entry) => entry.partId === part.id)?.unitCostCents ?? part.purchasePriceCents));
  }, 0), [parts, selectedParts, record]);
  const matchingParts = useMemo(() => {
    const query = partQuery.trim().toLowerCase();
    return parts.filter((part) => !selectedParts[part.id] && (!query || [part.name, part.partNumber, part.manufacturer].filter(Boolean).join(" ").toLowerCase().includes(query))).slice(0, 8);
  }, [parts, partQuery, selectedParts]);
  const eligibleDocuments = useMemo(() => documents.filter((document) => document.vehicleId === vehicle.id && !document.insurancePolicyId), [documents, vehicle.id]);
  const availableSelectedIds = availableEvidenceIds(selectedDocumentIds, eligibleDocuments, vehicle.id);
  const matchingDocuments = useMemo(() => { const query = documentQuery.trim().toLowerCase(); return eligibleDocuments.filter((document) => !selectedDocumentIds.includes(document.id) && (!query || [document.name, document.originalName, document.trackingId, document.kind, document.notes].filter(Boolean).join(" ").toLowerCase().includes(query))).slice(0, 8); }, [eligibleDocuments, selectedDocumentIds, documentQuery]);

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (form.title.trim().length < 2) next.title = "Enter a service title with at least 2 characters.";
    if (!form.serviceDate) next.serviceDate = "Choose the date the work was completed.";
    if (!form.mileage.trim() || !Number.isFinite(Number(form.mileage)) || Number(form.mileage) < 0) next.mileage = "Enter a valid non-negative mileage.";
    if (form.cost && Number(form.cost) < 0) next.cost = "Cost cannot be negative.";
    if (form.laborHours && Number(form.laborHours) < 0) next.laborHours = "Labor time cannot be negative.";
    for (const [id, usage] of Object.entries(selectedParts)) {
      const part = parts.find((item) => item.id === Number(id));
      if (!part) continue;
      if (usage.usageMode === "Partial" && (!Number.isFinite(Number(usage.amountUsed)) || Number(usage.amountUsed) <= 0 || Number(usage.amountUsed) > 1_000_000 || !part.volumePerUnit || Number(usage.amountUsed) / part.volumePerUnit > 1000)) next.parts = `Enter a positive total volume for ${part.name} (up to 1,000 items).`;
      if (usage.usageMode === "Whole" && (!Number.isInteger(Number(usage.quantity)) || Number(usage.quantity) < 1)) next.parts = `Enter a whole-unit quantity for ${part.name}.`;
    }
    return next;
  }, [form, parts, selectedParts]);

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (status === "error") setStatus("idle");
  };

  const close = () => {
    if (status === "loading" || deletingAttachmentId != null) return;
    onClose();
  };

  const addAttachments = (files: File[]) => {
    setAttachments((current) => [
      ...current,
      ...files.slice(0, Math.max(0, 50 - current.length)).map((file) => ({ file, name: file.name.replace(/\.[^.]+$/, ""), kind: file.type.startsWith("image/") ? "Photo" : file.type === "application/pdf" ? "Receipt" : "Other" })),
    ]);
  };
  const updateAttachment = (index: number, changes: Partial<Pick<MaintenanceAttachment, "kind" | "name" | "rotation">>) => setAttachments((current) => current.map((attachment, attachmentIndex) => attachmentIndex === index ? { ...attachment, ...changes } : attachment));
  const removeAttachment = (index: number) => setAttachments((current) => current.filter((_, attachmentIndex) => attachmentIndex !== index));
  const deleteSavedAttachment = async (file: DocumentRecord) => {
    if (status === "loading" || status === "success" || deletingAttachmentId != null) return;
    if (!window.confirm(`Delete ${file.name}? This permanently removes the attached file.`)) return;
    setDeletingAttachmentId(file.id);
    setSubmitError("");
    try {
      await onDeleteDocument(file);
      setSelectedDocumentIds((current) => current.filter((id) => id !== file.id));
    }
    catch (error) { setSubmitError(error instanceof Error ? error.message : "The attachment could not be deleted."); }
    finally { setDeletingAttachmentId(null); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "loading" || status === "success" || deletingAttachmentId != null) return;
    setTouched({ title: true, serviceDate: true, mileage: true, cost: true, laborHours: true, parts: true });
    if (Object.keys(errors).length) return;
    setStatus("loading");
    setSubmitError("");
    try {
      let nextDueDate = form.nextDueDate;
      if (!nextDueDate && form.nextDueMileage && vehicle.annualMileageEstimate && Number(form.nextDueMileage) > vehicle.mileage) {
        const days = Math.round(((Number(form.nextDueMileage) - vehicle.mileage) / vehicle.annualMileageEstimate) * 365);
        const due = new Date(`${form.serviceDate}T12:00:00`); due.setDate(due.getDate() + days); nextDueDate = due.toISOString().slice(0, 10);
      }
      await onSubmit({
        ...(!record ? { submissionKey: submissionKey.current } : {}),
        title: form.title.trim(),
        category: form.category,
        serviceDate: form.serviceDate,
        mileage: storedDistance(form.mileage),
        cost: Number(form.cost || 0),
        laborHours: Number(form.laborHours || 0),
        difficulty: Number(form.difficulty),
        shopName: form.shopName.trim(),
        notes: form.notes.trim(),
        nextDueDate,
        nextDueMileage: form.nextDueMileage ? storedDistance(form.nextDueMileage) : "",
        parts: Object.entries(selectedParts).map(([partId, usage]) => {
          const part = parts.find((item) => item.id === Number(partId));
          return {
            partId: Number(partId),
            quantity: usage.usageMode === "Partial" && part?.volumePerUnit ? Number(usage.amountUsed) / part.volumePerUnit : Number(usage.quantity),
            usageMode: usage.usageMode,
            amountUsed: usage.usageMode === "Partial" ? Number(usage.amountUsed) : null,
            amountUnit: usage.usageMode === "Partial" ? part?.volumeUnit : null,
          };
        }),
      }, attachments, availableSelectedIds);
      setStatus("success");
      window.setTimeout(onClose, 650);
    } catch (error) {
      setStatus("error");
      setSubmitError(error instanceof Error ? error.message : "Maintenance could not be saved. Try again.");
    }
  };

  const fieldError = (name: string) => (touched[name] ? errors[name] : undefined);

  return (
    <dialog ref={dialogRef} aria-label={record ? "Edit maintenance" : "Log maintenance"} className="maintenance-dialog" onCancel={(event) => { event.preventDefault(); close(); }} onClose={onClose}>
      <form method="dialog" onSubmit={submit} noValidate>
        <header className="dialog__header">
          <div>
            <span className="dialog__context">{vehicle.nickname ?? vehicle.model} · {formatDistance(vehicle.mileage)}</span>
            <h2>{record ? "Edit maintenance" : "Log maintenance"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close maintenance form"><X size={19} /></button>
        </header>

        <div className="form-grid">
          <Field label="Service or repair" name="title" error={fieldError("title")} span="wide">
            <input id="title" name="title" autoFocus value={form.title} onChange={(e) => update("title", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, title: true }))} placeholder="Oil and filter change" aria-invalid={Boolean(fieldError("title"))} aria-describedby="title-help" />
          </Field>
          <Field label="System" name="category">
            <SelectOrCustom label="System" value={form.category} options={[...maintenanceSystems, ...systemNames]} onChange={(value) => update("category", value)} />
          </Field>
          <Field label="Completed on" name="serviceDate" error={fieldError("serviceDate")}>
            <input id="serviceDate" type="date" value={form.serviceDate} onChange={(e) => update("serviceDate", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, serviceDate: true }))} aria-invalid={Boolean(fieldError("serviceDate"))} />
          </Field>
          <Field label="Mileage" name="mileage" error={fieldError("mileage")}>
            <div className="input-unit"><input id="mileage" inputMode="numeric" value={form.mileage} onChange={(e) => update("mileage", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, mileage: true }))} aria-invalid={Boolean(fieldError("mileage"))} /><span>{distanceUnit()}</span></div>
          </Field>
          <Field label="Other / labor cost" name="cost" error={fieldError("cost")}>
            <div className="input-unit input-unit--prefix"><span>{preferences().currency}</span><input id="cost" inputMode="decimal" value={form.cost} onChange={(e) => update("cost", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, cost: true }))} placeholder="0.00" aria-invalid={Boolean(fieldError("cost"))} /></div>
          </Field>
          <Field label="Parts used" name="parts" span="wide" error={fieldError("parts")}>
            <div className="maintenance-parts-field">
            <div className="maintenance-parts-picker">{Object.entries(selectedParts).length ? Object.entries(selectedParts).map(([id, usage]) => {
              const part = parts.find((item) => item.id === Number(id));
              if (!part) return null;
              const supportsPartial = part.itemType === "Consumable" && Boolean(part.volumePerUnit && part.volumeUnit);
              const unitCost = record?.parts?.find((entry) => entry.partId === part.id)?.unitCostCents ?? part.purchasePriceCents;
              const lineQuantity = usage.usageMode === "Partial" && part.volumePerUnit ? Number(usage.amountUsed || 0) / part.volumePerUnit : Number(usage.quantity || 0);
              return <div className="maintenance-part-selected" key={part.id}>
                <div className="maintenance-part-selected__identity"><strong>{part.name}</strong><small>{part.partNumber} · {preferences().currency}{(unitCost / 100).toFixed(2)} per unit{supportsPartial ? ` · ${part.volumePerUnit} ${part.volumeUnit} each` : ""}</small>{usage.usageMode === "Partial" && supportsPartial && <small aria-live="polite">{describeConsumableUsage(Number(usage.amountUsed), part.volumePerUnit!, part.volumeUnit!)}</small>}</div>
                {supportsPartial && <label className="maintenance-part-usage-mode"><span>Use</span><select value={usage.usageMode} onChange={(event) => setSelectedParts((current) => ({ ...current, [part.id]: { ...current[part.id], usageMode: event.target.value as "Whole" | "Partial" } }))}><option value="Whole">Whole item</option><option value="Partial">Amount by volume</option></select></label>}
                {usage.usageMode === "Partial" && supportsPartial
                  ? <label className="maintenance-part-amount"><span>Amount used</span><div className="input-unit"><input type="number" min="0" max={Math.min(1_000_000, (part.volumePerUnit ?? 1) * 1000)} step="any" inputMode="decimal" value={usage.amountUsed} onChange={(event) => setSelectedParts((current) => ({ ...current, [part.id]: { ...current[part.id], amountUsed: event.target.value } }))} aria-label={`Amount of ${part.name} used`} /><span>{part.volumeUnit}</span></div></label>
                  : <label className="maintenance-part-amount"><span>Quantity</span><input className="part-quantity" type="number" min="1" max="1000" step="1" value={usage.quantity} onChange={(event) => setSelectedParts((current) => ({ ...current, [part.id]: { ...current[part.id], quantity: event.target.value } }))} aria-label={`Quantity of ${part.name}`} /></label>}
                <span className="maintenance-part-line-cost">{preferences().currency}{(Math.round(lineQuantity * unitCost) / 100).toFixed(2)}</span>
                <button type="button" className="icon-button maintenance-part-remove" aria-label={`Remove ${part.name} from parts used`} title="Remove part" onClick={() => setSelectedParts((current) => { const next = { ...current }; delete next[part.id]; return next; })}><X size={16} /></button>
              </div>;
            }) : <small className="field-note">No parts added to this record.</small>}</div>
            <input value={partQuery} onChange={(event) => setPartQuery(event.target.value)} placeholder="Search catalogue by name, part number, or manufacturer" aria-label="Search parts catalogue" />
            {partQuery && <div className="part-search-results">{matchingParts.length ? matchingParts.map((part) => <button type="button" key={part.id} onClick={() => { setSelectedParts((current) => ({ ...current, [part.id]: { usageMode: "Whole", quantity: "1", amountUsed: "" } })); setPartQuery(""); }}><span>{part.name} · {part.partNumber}</span><small>{part.manufacturer ?? "Unbranded"} · {preferences().currency}{(part.purchasePriceCents / 100).toFixed(2)}{part.itemType === "Consumable" ? ` · Consumable${part.volumePerUnit ? ` (${part.volumePerUnit} ${part.volumeUnit ?? ""})` : ""}` : ""}</small><b>Add</b></button>) : <small className="field-note">No available parts match that search.</small>}</div>}
            <strong>Parts subtotal: {preferences().currency}{(partsCost / 100).toFixed(2)} · Total: {preferences().currency}{((Number(form.cost || 0) * 100 + partsCost) / 100).toFixed(2)}</strong>
            </div>
          </Field>
          <Field label="Labor" name="laborHours" error={fieldError("laborHours")}>
            <div className="input-unit"><input id="laborHours" inputMode="decimal" value={form.laborHours} onChange={(e) => update("laborHours", e.target.value)} onBlur={() => setTouched((t) => ({ ...t, laborHours: true }))} placeholder="0.0" aria-invalid={Boolean(fieldError("laborHours"))} /><span>hr</span></div>
          </Field>
          <Field label="Difficulty" name="difficulty">
            <select id="difficulty" value={form.difficulty} onChange={(e) => update("difficulty", e.target.value)}>
              <option value="1">1 · Simple</option><option value="2">2 · Easy</option><option value="3">3 · Moderate</option><option value="4">4 · Difficult</option><option value="5">5 · Advanced</option>
            </select>
          </Field>
          <Field label="Shop or helper" name="shopName">
            <SelectOrCustom label="Shop or helper" value={form.shopName} options={shopNames} onChange={(value) => update("shopName", value)} placeholder="e.g. DIY or a shop name" emptyLabel="Not recorded" />
          </Field>
          <Field label={`Next due mileage (${distanceUnit()})`} name="nextDueMileage">
            <div className="input-unit"><input id="nextDueMileage" inputMode="numeric" value={form.nextDueMileage} onChange={(e) => update("nextDueMileage", e.target.value)} placeholder="130000" /><span>{distanceUnit()}</span></div>
          </Field>
          <Field label="Next due date" name="nextDueDate">
            <input id="nextDueDate" type="date" value={form.nextDueDate} onChange={(e) => update("nextDueDate", e.target.value)} />
            {!form.nextDueDate && form.nextDueMileage && vehicle.annualMileageEstimate ? <small className="field-note">Estimated from {vehicle.annualMileageEstimate.toLocaleString()} {distanceUnit()}/year; you can adjust this date.</small> : null}
          </Field>
          <Field label="Notes" name="notes" span="wide">
            <textarea id="notes" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Parts used, torque values, anything to check next time…" />
          </Field>
          <Field label="Existing documents" name="existingDocuments" span="wide">
            <div className="maintenance-link-picker"><input id="existingDocuments" type="search" value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Search display name, original filename, tracking ID, type, or notes" />
              <small className="field-note">Attach files already stored in Documents. Each file keeps its UUID and can remain linked to other maintenance records.</small>
              {selectedDocumentIds.length > 0 && <div className="selected-document-list" aria-label="Documents selected for this maintenance">{selectedDocumentIds.map((id) => { const document = eligibleDocuments.find((candidate) => candidate.id === id); return document ? <div key={id}><span><strong>{document.name}</strong><small>{document.kind}{document.originalName && document.originalName !== document.name ? ` · ${document.originalName}` : ""}</small></span><button type="button" className="icon-button" aria-label={`Remove ${document.name} from this maintenance selection`} onClick={() => setSelectedDocumentIds((current) => current.filter((value) => value !== id))}><X size={15} /></button></div> : null; })}</div>}
              {documentQuery.trim() && <div className="maintenance-link-picker__results" role="list" aria-label="Matching stored documents">{matchingDocuments.length ? matchingDocuments.map((document) => <button type="button" key={document.id} role="listitem" onClick={() => { setSelectedDocumentIds((current) => [...current, document.id]); setDocumentQuery(""); }}><span><strong>{document.name}</strong><small>{document.kind}{document.originalName && document.originalName !== document.name ? ` · original: ${document.originalName}` : ""}</small></span><span>Add</span></button>) : <p className="field-note">No matching stored documents.</p>}</div>}
            </div>
          </Field>
          {open && record && <section className="field maintenance-saved-evidence" data-span="wide" aria-label="Saved evidence and attachments">
            <strong>Saved evidence & attachments</strong>
            <p className="field-note">Drag the grip to set the order used in this service record. The arrow controls provide a keyboard and touch alternative. The saved order applies only to this record, even for shared files.</p>
            <MaintenanceEvidence files={selectedDocumentIds.map((id) => eligibleDocuments.find((document) => document.id === id)).filter((document): document is DocumentRecord => Boolean(document))} onDelete={(file) => void deleteSavedAttachment(file)} deletingId={deletingAttachmentId} reorderable onReorder={setSelectedDocumentIds} />
            <a className="button button--quiet button--small" href={`/api/export/maintenance.pdf?ids=${record.id}`} download><Download size={15} />Export saved record PDF</a>
          </section>}
          <Field label="Receipts, photos, or documents" name="maintenanceFiles" span="wide">
            <input id="maintenanceFiles" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,text/csv,.docx,.xlsx,.odt" onChange={(event) => { addAttachments(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
            <small className="field-note">Add files before saving, then set each type and optional name. Up to 50 files, 15 MB each, 120 MB total.</small>
            {attachments.length > 0 && <div className="attachment-drafts" aria-label="Attachment drafts">{attachments.map((attachment, index) => <AttachmentDraft key={`${attachment.file.name}-${attachment.file.lastModified}-${index}`} attachment={attachment} onChange={(changes) => updateAttachment(index, changes)} onRemove={() => removeAttachment(index)} />)}</div>}
          </Field>
        </div>

        <div className="dialog__status" aria-live="polite">
          {submitError || (status === "success" ? "Maintenance saved." : "")}
        </div>
        <footer className="dialog__footer">
          <button type="button" className="button button--quiet" onClick={close} disabled={status === "loading" || deletingAttachmentId != null}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={status === "loading" || status === "success" || deletingAttachmentId != null} data-state={status}>
            {status === "loading" ? <><LoaderCircle className="spin" size={17} />Saving…</> : status === "success" ? <><Check size={17} />Saved</> : record ? "Save changes" : "Save record"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function AttachmentDraft({ attachment, onChange, onRemove }: { attachment: MaintenanceAttachment; onChange: (changes: Partial<Pick<MaintenanceAttachment, "kind" | "name" | "rotation">>) => void; onRemove: () => void }) {
  const [editingPhoto, setEditingPhoto] = useState(false);
  const previewUrl = useMemo(() => URL.createObjectURL(attachment.file), [attachment.file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  const isImage = attachment.file.type.startsWith("image/");
  const isPdf = attachment.file.type === "application/pdf";
  return <article className="attachment-draft">{editingPhoto && <PhotoEditor kind="documents" id={0} src={previewUrl} file={attachment.file} initialRotation={attachment.rotation ?? 0} onApply={(rotation) => onChange({ rotation })} onClose={() => setEditingPhoto(false)} onSaved={() => {}} />}<div className="attachment-draft__preview">{isImage ? <button type="button" className="photo-preview-button" aria-label={`Rotate ${attachment.file.name}`} onClick={() => setEditingPhoto(true)}><img src={previewUrl} style={{ transform: `rotate(${attachment.rotation ?? 0}deg)` }} alt={`Preview of ${attachment.name || attachment.file.name}`} /></button> : isPdf ? <a href={previewUrl} target="_blank" rel="noreferrer" title={`Preview ${attachment.file.name}`}><FileText size={24} /><span>Preview PDF</span></a> : <><FileText size={24} /><span>{attachment.file.name.split(".").pop()?.toUpperCase() || "FILE"}</span></>}</div><div className="attachment-draft__fields"><label>Type<select value={attachment.kind} onChange={(event) => onChange({ kind: event.target.value })}><option>Receipt</option><option>Photo</option><option>Manual</option><option>Registration</option><option>Insurance</option><option>Other</option></select></label><label>Display name <span className="visually-hidden">for {attachment.file.name}</span><input value={attachment.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={attachment.file.name} maxLength={240} /></label><small>Original file: {attachment.file.name} · {Math.ceil(attachment.file.size / 1024)} KB · stored with a tracking UUID</small></div><button type="button" className="icon-button" onClick={onRemove} aria-label={`Remove ${attachment.file.name}`}><Trash2 size={16} /></button></article>;
}

function Field({ label, name, error, span, children }: { label: string; name: string; error?: string; span?: "wide"; children: React.ReactNode }) {
  return (
    <div className="field" data-span={span}>
      <label htmlFor={name}>{label}</label>
      {children}
      <span id={`${name}-help`} className="field__help">{error ?? "\u00a0"}</span>
    </div>
  );
}
