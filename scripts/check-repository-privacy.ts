import { spawnSync } from "node:child_process";

export function privatePath(path: string): boolean {
  const name = path.replaceAll("\\", "/").toLowerCase();
  return /(^|\/)(data|uploads|backups|tmp|output|\.codex-remote-attachments)(\/|$)/.test(name)
    || /(^|\/)\.env($|\.)/.test(name) && !name.endsWith("/.env.example") && name !== ".env.example"
    || /\.(db(?:-wal|-shm)?|sqlite3?|pem|key|p12|pfx|bundle|log|pdf|zip)$/.test(name)
    || /\.(png|jpe?g|webp|heic|gif)$/.test(name) && !/^(public|design-concepts)\//.test(name);
}

export function credentialText(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|gsk_[A-Za-z0-9]{30,}|sk-or-v1-[A-Za-z0-9]{30,})\b/.test(text)
    || /\bAKIA[A-Z0-9]{16}\b/.test(text);
}

function git(...args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Git privacy scan failed: git ${args[0]}`);
  return result.stdout;
}

if (import.meta.main) {
  try {
    const revisions = process.argv.includes("--history") ? git("rev-list", "--branches", "--tags", "HEAD").trim().split(/\s+/).filter(Boolean) : [null];
    const problems = new Set<string>();
    const inspected = new Set<string>();
    for (const revision of revisions) {
      const entries = revision ? git("ls-tree", "-r", "-z", revision) : git("ls-files", "--stage", "-z");
      for (const entry of entries.split("\0").filter(Boolean)) {
        const [header, ...tail] = entry.split("\t");
        const path = tail.join("\t");
        const fields = header.split(" ");
        const object = fields[revision ? 2 : 1];
        if (privatePath(path)) { problems.add(`Private/generated file: ${path}`); continue; }
        if (fields[0] === "160000") { problems.add(`Unreviewed submodule: ${path}`); continue; }
        if (inspected.has(object)) continue;
        inspected.add(object);
        const contents = git("cat-file", "blob", object);
        if (!contents.includes("\0") && credentialText(contents)) problems.add(`Possible credential in: ${path}`);
      }
    }
    if (problems.size) {
      console.error("Repository privacy check FAILED. Keep these files locally, but out of Git:");
      for (const problem of problems) console.error(`- ${problem}`);
      process.exitCode = 1;
    } else console.log(`Repository privacy check passed (${revisions.length} ${revisions[0] ? "commits" : "staged tree"}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Repository privacy check failed.");
    process.exitCode = 1;
  }
}
