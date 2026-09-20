import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

/** Render only when near the viewport, including inside a scrolling dialog. */
export function PdfPreview({ id, name }: { id: number; name: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [thumbnail, setThumbnail] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setThumbnail(undefined);
    setFailed(false);
    const load = async () => {
      try {
        const { renderPdfThumbnail } = await import("../pdfThumbnail");
        if (disposed) return;
        const image = await renderPdfThumbnail(id, controller.signal);
        if (!disposed) setThumbnail(image);
      } catch {
        if (!disposed) setFailed(true);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { rootMargin: "160px" });
    if (container.current) observer.observe(container.current);
    return () => { disposed = true; observer.disconnect(); controller.abort(); };
  }, [id]);
  return <div ref={container} className="pdf-preview" aria-label={`PDF preview: ${name}`} aria-busy={!thumbnail && !failed}>
    {thumbnail ? <img src={thumbnail} alt={`First page of ${name}`} decoding="async" /> : <><FileText size={24} /><span>{failed ? "Preview unavailable · Open PDF" : "Loading PDF preview…"}</span></>}
  </div>;
}
