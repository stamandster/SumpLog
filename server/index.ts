import app from "./app";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { migrateDatabase } from "./db/migrate";
import { ownerCredentials } from "./db/schema";

migrateDatabase();

const password = process.env.SUMPLOG_PASSWORD?.trim();
const hasSavedPassword = Boolean(db.select({ id: ownerCredentials.id }).from(ownerCredentials).where(eq(ownerCredentials.id, 1)).get());
if (process.env.NODE_ENV === "production" && !hasSavedPassword && (!password || password.length < 12)) {
  throw new Error("Production requires a saved owner password or SUMPLOG_PASSWORD with at least 12 characters.");
}

const port = Number(process.env.PORT ?? 3000);

console.info(`SumpLog running at http://localhost:${port}`);

export default {
  port,
  hostname: password || hasSavedPassword ? (process.env.HOST ?? "0.0.0.0") : "127.0.0.1",
  maxRequestBodySize: 128 * 1024 * 1024,
  idleTimeout: 120,
  fetch: app.fetch,
};
