import app from "./app";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { migrateDatabase } from "./db/migrate";
import { ownerCredentials } from "./db/schema";
import { maxRequestBodySize } from "./requestLimits";
import { hashPassword } from "./security";

migrateDatabase();

const password = process.env.SUMPLOG_PASSWORD?.trim();
let hasSavedPassword = Boolean(db.select({ id: ownerCredentials.id }).from(ownerCredentials).where(eq(ownerCredentials.id, 1)).get());
if (process.env.NODE_ENV === "production" && !hasSavedPassword && (!password || password.length < 12)) {
  throw new Error("Production requires a saved owner password or SUMPLOG_PASSWORD with at least 12 characters.");
}
// An initial launcher/environment password becomes the durable owner credential.
// Later launches use this hash and do not need the secret in an environment variable.
if (!hasSavedPassword && password) {
  db.insert(ownerCredentials).values({ id: 1, passwordHash: hashPassword(password) }).onConflictDoNothing().run();
  hasSavedPassword = true;
}

const port = Number(process.env.PORT ?? 3000);

console.info(`SumpLog running at http://localhost:${port}`);

export default {
  port,
  hostname: password || hasSavedPassword ? (process.env.HOST ?? "0.0.0.0") : "127.0.0.1",
  maxRequestBodySize,
  idleTimeout: 120,
  fetch: app.fetch,
};
