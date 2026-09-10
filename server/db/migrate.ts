import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./client";

export function migrateDatabase() {
  migrate(db, { migrationsFolder: "./drizzle" });
}

if (import.meta.main) {
  migrateDatabase();
  console.info("SumpLog database is up to date.");
}
