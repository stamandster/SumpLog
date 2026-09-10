import { FileText, Trash2 } from "lucide-react";
import type { DocumentRecord } from "../api";
import { PhotoPreview } from "./PhotoEditor";

/** Shared by the record details and editor so evidence actions stay consistent. */
export function MaintenanceEvidence({ files, onDelete, deletingId, interactiveImages = true }: { files: DocumentRecord[]; onDelete?: (file: DocumentRecord) => void; deletingId?: number | null; interactiveImages?: boolean }) {
  return <div className="record-preview-grid">
    {files.length ? files.map((file) => <div className="record-preview-item" key={file.id}>{file.mimeType?.startsWith("image/")
      ? interactiveImages ? <PhotoPreview id={file.id} name={file.name} className="record-preview" /> : <div className="record-preview"><img src={`/api/documents/${file.id}/file?preview=1`} alt={file.name} loading="lazy" decoding="async" /></div>
      : <a className="record-preview" href={`/api/documents/${file.id}/file`} target="_blank" rel="noreferrer" aria-label={`Open ${file.kind}: ${file.name}`}>
        {file.mimeType === "application/pdf"
          ? <iframe src={`/api/documents/${file.id}/file#page=1&view=FitH`} title={`PDF preview: ${file.name}`} loading="lazy" />
          : <FileText size={24} aria-label={`${file.kind} document`} />}
      </a>}{onDelete && <button type="button" className="icon-button record-preview-delete" disabled={deletingId === file.id} onClick={() => onDelete(file)} aria-label={`Delete attachment: ${file.name}`} title="Delete attachment"><Trash2 size={14} /></button>}</div>) : <p>No evidence attached.</p>}
  </div>;
}
