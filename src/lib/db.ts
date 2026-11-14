import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { migrate } from "./migrate";

export type DB = Database.Database;

/** Bump when schema/migrations change so a hot-reloaded dev server re-runs them. */
const SCHEMA_VERSION = 4;
const g = globalThis as unknown as { __opsDb?: DB; __opsDbV?: number };

/** DB file path (override with OPS_DB_PATH). */
export const DB_PATH = process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db");

/**
 * Singleton better-sqlite3 connection (WAL, foreign keys ON). Applies schema.sql on first use.
 * Synchronous API: `getDb().prepare(sql).all(...)`, `.get(...)`, `.run(...)`; `getDb().transaction(fn)`.
 */
export function getDb(): DB {
  if (g.__opsDb && g.__opsDbV === SCHEMA_VERSION) return g.__opsDb;
  if (g.__opsDb) { try { g.__opsDb.close(); } catch { /* ignore */ } g.__opsDb = undefined; }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
  db.exec(schema);
  migrate(db);
  const ins = db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)");
  ins.run("company_name", "Al Noor Infrastructure LLC");
  ins.run("currency", "AED");
  ins.run("approval_cost_threshold", "50000");
  g.__opsDb = db;
  g.__opsDbV = SCHEMA_VERSION;
  publishCurrency(db);
  return db;
}

function publishCurrency(db: DB) {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'currency'").get() as { value: string } | undefined;
  (globalThis as unknown as { __opsCurrency?: string }).__opsCurrency = r?.value || "AED";
}

/** Upserts a settings value (keeps the formatMoney currency in sync). */
export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  if (key === "currency") publishCurrency(db);
}

/** Reads a settings value. */
export function getSetting(key: string, fallback = ""): string {
  const r = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? fallback;
}
