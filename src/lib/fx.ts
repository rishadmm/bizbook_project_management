// Reporting-currency helpers (MULTI_COUNTRY_SPEC section 2). Rates are USD per 1 unit of currency; a row's rate is LOCKED when it is created
// (table triggers, see fx-tables.ts). Changing fx_rates later never rewrites history unless an admin runs revalueFrom().
import { getDb } from "./db";
import { FX_TABLES, fxRevalueSql } from "./fx-tables";
import { getEntityById, type Entity } from "./entities";

export const reportingCurrency = (): string =>
  (getDb().prepare("SELECT value FROM settings WHERE key = 'reporting_currency'").get() as { value: string } | undefined)?.value || "USD";

/** USD per 1 unit of `currency` on `date` (latest rate effective on or before the date; before the first known rate: the earliest one). */
export function getRateToUsd(currency: string, date?: string | null): number {
  const db = getDb();
  const day = (date ?? new Date().toISOString()).slice(0, 10);
  const r = (db.prepare("SELECT rate_to_usd r FROM fx_rates WHERE currency = ? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1").get(currency, day)
    ?? db.prepare("SELECT rate_to_usd r FROM fx_rates WHERE currency = ? ORDER BY effective_date ASC LIMIT 1").get(currency)) as { r: number } | undefined;
  return r?.r ?? (currency === "USD" ? 1 : 1);
}
export const toUsd = (amount: number, currency: string, date?: string | null): number =>
  Math.round(amount * getRateToUsd(currency, date) * 100) / 100;

export interface FxSnapshot { currency: string; fx_rate_usd: number; fx_date: string }
/** Currency + locked USD rate for a row of `entityId` dated `date` (default today). Application code may pass the three columns explicitly on insert. */
export function fxSnapshot(entityId: number | Entity, date?: string | null): FxSnapshot {
  const e = typeof entityId === "number" ? getEntityById(entityId) : entityId;
  const currency = e?.currency ?? "AED";
  const fx_date = (date ?? new Date().toISOString()).slice(0, 10);
  return { currency, fx_rate_usd: getRateToUsd(currency, fx_date), fx_date };
}

export interface FxRateRow { id: number; currency: string; rate_to_usd: number; effective_date: string; source: string | null; created_at: string | null }
export function listFxRates(): FxRateRow[] {
  return getDb().prepare("SELECT * FROM fx_rates ORDER BY currency, effective_date DESC").all() as FxRateRow[];
}

/** Explicit admin action: re-values every money row dated on or after `from` with the rates effective on each row's own date. Returns the number of rows touched. */
export function revalueFrom(from: string): number {
  const db = getDb();
  let n = 0;
  db.transaction(() => { for (const t of FX_TABLES) n += db.prepare(fxRevalueSql(t)).run(from).changes; })();
  return n;
}
