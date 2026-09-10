import sharp from "sharp";
import { stat } from "node:fs/promises";

export function photoResponse(bytes: Buffer, preview: boolean, ifNoneMatch?: string) {
  const etag = `"${Bun.hash(bytes).toString(16)}"`;
  const headers = { "Content-Type": preview ? "image/webp" : "image/png", "Cache-Control": "private, no-cache", ETag: etag };
  return ifNoneMatch === etag ? new Response(null, { status: 304, headers }) : new Response(new Uint8Array(bytes), { headers });
}

// Bounded, in-memory derivative cache. Originals are never overwritten.
const previews = new Map<string, Buffer>();
let cacheBytes = 0;
export async function photoBytes(path: string, rotation = 0, size = 0): Promise<Buffer> {
  const info = await stat(path);
  const key = `${path}:${info.mtimeMs}:${info.size}:${rotation}:${size}`;
  if (size && previews.has(key)) return previews.get(key)!;
  let pipeline = sharp(path, { limitInputPixels: 50_000_000 }).autoOrient().rotate(rotation);
  if (size) pipeline = pipeline.resize({ width: size, height: size, fit: "inside", withoutEnlargement: true });
  const bytes = await (size ? pipeline.webp({ quality: 72, effort: 3 }) : pipeline.png()).toBuffer();
  if (size && bytes.length < 20_000_000) {
    while ((cacheBytes + bytes.length > 20_000_000 || previews.size >= 128) && previews.size) {
      const oldest = previews.keys().next().value!;
      cacheBytes -= previews.get(oldest)!.length; previews.delete(oldest);
    }
    if (!previews.has(key)) { previews.set(key, bytes); cacheBytes += bytes.length; }
  }
  return bytes;
}
