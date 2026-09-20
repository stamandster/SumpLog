import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, FileText, GripVertical, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DocumentRecord } from "../api";
import { PhotoPreview } from "./PhotoEditor";
import { PdfPreview } from "./PdfPreview";

/** Shared by record details and the editor so evidence actions stay consistent. */
export function MaintenanceEvidence({ files, onDelete, deletingId, interactiveImages = true, reorderable = false, onReorder }: {
  files: DocumentRecord[];
  onDelete?: (file: DocumentRecord) => void;
  deletingId?: number | null;
  interactiveImages?: boolean;
  reorderable?: boolean;
  onReorder?: (documentIds: number[]) => void;
}) {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const move = (fromId: number, toIndex: number) => {
    if (!onReorder) return;
    const currentIndex = files.findIndex((file) => file.id === fromId);
    if (currentIndex < 0 || toIndex < 0 || toIndex >= files.length || currentIndex === toIndex) return;
    const ordered = [...files];
    const [file] = ordered.splice(currentIndex, 1);
    ordered.splice(toIndex, 0, file);
    onReorder(ordered.map((item) => item.id));
  };
  return <div className="record-preview-grid" data-reorderable={reorderable || undefined}>
    {files.length ? files.map((file, index) => <div className="record-preview-item" key={file.id} data-drop-target={dropTargetId === file.id || undefined} onDragEnter={reorderable ? () => setDropTargetId(file.id) : undefined} onDragOver={reorderable ? (event) => event.preventDefault() : undefined} onDrop={reorderable ? (event) => { event.preventDefault(); if (draggedId != null) move(draggedId, index); setDraggedId(null); setDropTargetId(null); } : undefined}>
      {(reorderable || onDelete) && <div className="record-evidence-header">
        {reorderable && <>
        <button type="button" className="icon-button record-evidence-drag" draggable onDragStart={(event) => { setDraggedId(file.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(file.id)); }} onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }} aria-label={`Drag ${file.name} to reorder`} title="Drag to reorder"><GripVertical size={15} /></button>
        <span aria-label={`Evidence ${index + 1} of ${files.length}`}>{index + 1} / {files.length}</span>
        </>}
        {onDelete && <button type="button" className="icon-button record-preview-delete" disabled={deletingId != null} onClick={() => onDelete(file)} aria-label={`Delete attachment: ${file.name}`} title="Delete attachment"><Trash2 size={16} /></button>}
      </div>}
      {file.mimeType?.startsWith("image/")
        ? interactiveImages ? <PhotoPreview id={file.id} name={file.name} className="record-preview" /> : <div className="record-preview"><img src={`/api/documents/${file.id}/file?preview=1`} alt={file.name} loading="lazy" decoding="async" /></div>
        : <a className="record-preview" href={`/api/documents/${file.id}/file`} target="_blank" rel="noreferrer" aria-label={`Open ${file.kind}: ${file.name}`}>
          {file.mimeType === "application/pdf"
            ? <PdfPreview id={file.id} name={file.name} />
            : <FileText size={24} aria-label={`${file.kind} document`} />}
        </a>}
      {reorderable && <div className="record-evidence-order" role="group" aria-label={`Reorder ${file.name}`}>
        <button type="button" className="icon-button" disabled={index === 0} onClick={() => move(file.id, 0)} aria-label={`Move ${file.name} to first`} title="Move to first"><ChevronsUp size={14} /></button>
        <button type="button" className="icon-button" disabled={index === 0} onClick={() => move(file.id, index - 1)} aria-label={`Move ${file.name} earlier`} title="Move earlier"><ArrowUp size={14} /></button>
        <button type="button" className="icon-button" disabled={index === files.length - 1} onClick={() => move(file.id, index + 1)} aria-label={`Move ${file.name} later`} title="Move later"><ArrowDown size={14} /></button>
        <button type="button" className="icon-button" disabled={index === files.length - 1} onClick={() => move(file.id, files.length - 1)} aria-label={`Move ${file.name} to last`} title="Move to last"><ChevronsDown size={14} /></button>
      </div>}
    </div>) : <p>No evidence attached.</p>}
  </div>;
}
