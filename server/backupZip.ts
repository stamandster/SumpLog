import { ZipArchive } from "archiver";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { open, type ZipFile } from "yauzl";

export type StoredAsset = { path: string; sha256: string; sizeBytes: number };
export async function stageAsset(source: NodeJS.ReadableStream, destination: string): Promise<StoredAsset> {
  const hash = new Bun.CryptoHasher("sha256"); let sizeBytes = 0;
  await pipeline(source, new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); sizeBytes += chunk.length; done(null, chunk); } }), createWriteStream(destination, { flags: "wx" }));
  return { path: destination, sha256: hash.digest("hex"), sizeBytes };
}

export async function temporaryBackup() {
  const root = await mkdtemp(join(tmpdir(), "sumplog-backup-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

/** Streams originals from disk into a ZIP64-capable archive, never through Base64. */
export async function writeBackupZip(destination: string, manifest: unknown, assets: Map<string, StoredAsset>) {
  const archive = new ZipArchive({ forceZip64: true, store: true });
  const completion = pipeline(archive, createWriteStream(destination, { flags: "wx" }));
  // Attach the rejection handler immediately, including failures during finalize.
  void completion.catch(() => undefined);
  archive.on("warning", (error) => archive.destroy(error));
  try {
    archive.append(JSON.stringify(manifest), { name: "backup.json", store: false });
    for (const [name, asset] of assets) archive.file(asset.path, { name });
    await archive.finalize(); await completion;
  } catch (error) { archive.destroy(); await completion.catch(() => undefined); throw error; }
}

/** Never extract using archive paths; every entry gets a generated staging filename. */
export async function readBackupZip(file: File) {
  const temp = await temporaryBackup();
  let zip: ZipFile | undefined;
  try {
    const path = join(temp.root, "upload.zip"); await Bun.write(path, file);
    zip = await new Promise<ZipFile>((resolve, reject) => open(path, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (error, result) => error ? reject(error) : resolve(result!)));
    const files = new Map<string, StoredAsset>();
    await new Promise<void>((resolve, reject) => {
      zip!.on("error", reject); zip!.on("end", resolve);
      zip!.on("entry", async (entry) => {
        try {
          const name = entry.fileName;
          if (name !== "backup.json" && !/^assets\/(vehicles|documents)-[1-9]\d*\.[a-z]+$/.test(name)) throw new Error("Not a restorable SumpLog ZIP, or unsafe archive entry.");
          if (files.has(name) || (entry.generalPurposeBitFlag & 1) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error("Duplicate, encrypted or symbolic-link archive entry.");
          const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip!.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream!)));
          files.set(name, await stageAsset(stream, join(temp.root, crypto.randomUUID())));
          zip!.readEntry();
        } catch (error) { zip!.close(); reject(error); }
      });
      zip!.readEntry();
    });
    const manifest = files.get("backup.json");
    if (!manifest) throw new Error("This ZIP has no backup.json. Excel exports cannot be restored.");
    const raw: unknown = JSON.parse(await Bun.file(manifest.path).text()); files.delete("backup.json");
    return { raw, files, cleanup: temp.cleanup };
  } catch (error) { zip?.close(); await temp.cleanup(); throw error; }
}

export { createReadStream };
