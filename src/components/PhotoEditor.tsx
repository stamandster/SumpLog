import { useEffect, useRef, useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";

export function PhotoEditor({ kind, id, src, file, onClose, onSaved, onApply, initialRotation = 0, initialZoom = 1, initialPositionX = 50, initialPositionY = 50 }: { kind: "vehicles" | "documents"; id: number; src: string; file?: File; initialRotation?: number; initialZoom?: number; initialPositionX?: number; initialPositionY?: number; onApply?: (rotation: number) => void; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rotation, setRotation] = useState(initialRotation);
  const [zoom, setZoom] = useState(initialZoom);
  const [positionX, setPositionX] = useState(initialPositionX);
  const [positionY, setPositionY] = useState(initialPositionY);
  const [url, setUrl] = useState(src);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const sourcePath = src.split("?")[0];
  useEffect(() => {
    const objectUrl = file ? URL.createObjectURL(file) : null;
    if (objectUrl) setUrl(objectUrl);
    dialog.current?.showModal();
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file]);
  const save = async () => {
    if (pending) return;
    if (onApply) { onApply(rotation); onClose(); return; }
    setPending(true); setError("");
    try {
      let response: Response;
      if (file) {
        const body = new FormData(); body.set("file", file); body.set("rotation", String(rotation)); if (kind === "vehicles") { body.set("photoZoom", String(zoom)); body.set("photoPositionX", String(positionX)); body.set("photoPositionY", String(positionY)); }
        response = await fetch(`/api/vehicles/${id}/image`, { method: "POST", body });
      } else response = await fetch(`/api/${kind}/${id}/photo-rotation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotation, ...(kind === "vehicles" ? { photoZoom: zoom, photoPositionX: positionX, photoPositionY: positionY } : {}) }) });
      if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error || "The photo could not be saved."); }
      window.dispatchEvent(new Event("sumplog:photos-changed")); onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The photo could not be saved."); setPending(false); }
  };
  return <dialog ref={dialog} className="maintenance-dialog photo-editor" aria-labelledby="photo-editor-title" onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <header className="dialog__header"><h2 id="photo-editor-title">{kind === "vehicles" ? "Frame vehicle photo" : "Edit photo"}</h2></header>
    <div className="photo-editor__stage" data-vehicle={kind === "vehicles" || undefined}><img src={url} alt="Photo editing preview" onLoad={() => setLoaded(true)} onError={() => setError("The image could not be loaded.")} style={{ transform: `rotate(${rotation}deg) scale(${kind === "vehicles" ? zoom : 1})`, transformOrigin: `${positionX}% ${positionY}%`, objectPosition: `${positionX}% ${positionY}%` }} /></div>
    <div className="photo-editor__controls"><button type="button" className="button button--quiet" disabled={pending} onClick={() => setRotation((value) => (value + 270) % 360)}><RotateCcw size={18} />Rotate left</button><button type="button" className="button button--quiet" disabled={pending} onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw size={18} />Rotate right</button><span role="status">{rotation}°</span></div>
    {kind === "vehicles" && <div className="vehicle-photo-framing"><label><span>Magnification <output>{zoom.toFixed(1)}×</output></span><input type="range" min="1" max="3" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><label><span>Horizontal position <output>{positionX}%</output></span><input type="range" min="0" max="100" step="1" value={positionX} onChange={(event) => setPositionX(Number(event.target.value))} /></label><label><span>Vertical position <output>{positionY}%</output></span><input type="range" min="0" max="100" step="1" value={positionY} onChange={(event) => setPositionY(Number(event.target.value))} /></label><button type="button" className="button button--quiet button--small" onClick={() => { setZoom(1); setPositionX(50); setPositionY(50); }}>Reset framing</button></div>}
    <p className="field-note">Changes apply only when saved. The original file is preserved.</p>{!file && <p className="field-note"><a href={`${sourcePath}?normalized=1`} target="_blank" rel="noreferrer">Open full resolution</a> · <a href={`${sourcePath}?original=1`} target="_blank" rel="noreferrer">Open original</a></p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer className="dialog__footer"><button type="button" className="button button--quiet" disabled={pending} onClick={onClose}>Cancel</button><button type="button" className="button button--primary" disabled={pending || !loaded} onClick={() => void save()}>{pending ? "Saving…" : "Save photo"}</button></footer>
  </dialog>;
}

export function PhotoPreview({ id, name, className }: { id: number; name: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const previewSrc = `/api/documents/${id}/file?preview=1&v=${version}`;
  const editorSrc = `/api/documents/${id}/file?editor=1&v=${version}`;
  return <div className={className}>
    <button className="photo-preview-button" type="button" onClick={() => setEditing(true)} aria-label={`Edit photo: ${name}`}><img src={previewSrc} alt={name} loading="lazy" decoding="async" /></button>
    {editing && <PhotoEditor kind="documents" id={id} src={editorSrc} onClose={() => setEditing(false)} onSaved={() => setVersion((value) => value + 1)} />}
  </div>;
}
