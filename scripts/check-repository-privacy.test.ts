import { expect, test } from "bun:test";
import { credentialText, privatePath } from "./check-repository-privacy";

test("blocks private runtime files and export artifacts, including forced additions", () => {
  for (const path of ["data/sumplog.db", "data/uploads/receipt.jpg", ".codex-remote-attachments/photo.jpg", "tmp/report.png", "output/report.pdf", ".env", ".env.production", "server/.env.local", "garage.sqlite3", "owner.key", "backup.bundle", "receipt.pdf", "personal-photo.jpg"]) expect(privatePath(path)).toBe(true);
  for (const path of [".env.example", "server/db/schema.ts", "server/backup.ts", "public/sumplog-mark.svg", "design-concepts/10-parts-counter-clean.png"]) expect(privatePath(path)).toBe(false);
});

test("detects common credential formats without printing their values", () => {
  expect(credentialText("ghp_" + "a".repeat(36))).toBe(true);
  expect(credentialText("gsk_" + "a".repeat(40))).toBe(true);
  expect(credentialText("-----BEGIN " + "PRIVATE KEY-----")).toBe(true);
  expect(credentialText("SUMPLOG_PASSWORD=replace-with-a-long-password")).toBe(false);
});
