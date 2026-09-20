import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
const thumbnails = new Map<number, string>();

export async function renderPdfThumbnail(id: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const cached = thumbnails.get(id);
  if (cached) return cached;
  const task = getDocument({ url: `/api/documents/${id}/file`, withCredentials: true, useSystemFonts: true, disableFontFace: true });
  const abort = () => { void task.destroy().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  // Password-protected PDFs remain openable via the original-file link.
  task.onPassword = () => abort();
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    signal.throwIfAborted();
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 640 / Math.max(original.width, original.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    signal.throwIfAborted();
    const image = canvas.toDataURL("image/webp", 0.8);
    if (thumbnails.size >= 24) thumbnails.delete(thumbnails.keys().next().value!);
    thumbnails.set(id, image);
    return image;
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}
