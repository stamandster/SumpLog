import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const databasePath = resolve(process.env.DATABASE_URL ?? "./data/sumplog.db");
mkdirSync(dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath, { create: true });
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle({ client: sqlite, schema });
