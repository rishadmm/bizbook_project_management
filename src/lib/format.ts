// Pure formatting helpers (safe in client components). The default currency of formatMoney is REQUEST-scoped, never process-global:
//  - server (RSC): a resolver registered by lib/request-context.ts reads the per-request React cache (active country, or the record's country on a
//    detail page, or the portal tenant's country);
//  - browser: <CurrencyProvider> (components/CurrencyProvider.tsx) sets the module default on the client only; during SSR client components read the
//    provider's context via useCurrency() and pass `currency` explicitly.
// Pass `currency` explicitly whenever the amount belongs to a record whose country may differ from the viewer's active country.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let resolver: (() => string | undefined) | null = null;
let browserDefault: string | undefined;
/** Server only: registers the request-scoped currency resolver. */
export function registerCurrencyResolver(fn: () => string | undefined): void { resolver = fn; }
/** Browser only (ignored during SSR): module default used by client code that has no context. */
export function setBrowserCurrency(code: string): void { if (typeof window !== "undefined") browserDefault = code; }

/** Currency of the current request / browser context (falls back to AED). */
export function getCurrency(): string {
  return resolver?.() || browserDefault || "AED";
}

/** Minor-unit digits of a currency: 3 for OMR, BHD, KWD, JOD, otherwise 2. */
export function currencyDecimals(cur: string | null | undefined): number {
  return ["OMR", "BHD", "KWD", "JOD"].includes((cur ?? "").toUpperCase()) ? 3 : 2;
}

/** "AED 1,234,567" (no decimals unless `decimals`). Pass `currency` explicitly in client components. */
export function formatMoney(value: number | null | undefined, opts: { decimals?: number; currency?: string; compact?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const cur = opts.currency ?? getCurrency();
  if (opts.compact) return `${cur} ${compactNumber(value)}`;
  const d = opts.decimals ?? 0;
  return `${cur} ${value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
/** "≈ USD 35,914.20 (rate 2.600780, 08 Aug 2026)" - the reporting-currency equivalent of a row (amount in USD, the locked rate and its date). */
export function usdEquivalent(usd: number | null | undefined, rate: number | null | undefined, date: string | null | undefined): string | null {
  if (usd === null || usd === undefined || !rate) return null;
  return `≈ USD ${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (rate ${rate.toFixed(6)}, ${formatDate(date)})`;
}
/** 1.2M / 340K style. */
export function compactNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
/** ISO date or datetime -> "DD MMM YYYY". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/** ISO datetime -> "DD MMM YYYY HH:mm". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return m ? `${formatDate(m[1])} ${m[2]}` : formatDate(iso);
}
/** 12.3 -> "12.3%". Value is already a percentage (0-100). */
export function pct(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}
/** Ratio such as SPI/CPI -> "0.92" or "—". */
export function formatRatio(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(2);
}
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b.slice(0, 10) + "T00:00:00Z").getTime() - new Date(a.slice(0, 10) + "T00:00:00Z").getTime()) / 86400000);
}
/** Days until a date (negative = overdue). */
export function daysUntil(iso: string | null | undefined): number | null {
  return iso ? daysBetween(todayISO(), iso) : null;
}
/** "in 5 days", "today", "3 days overdue". */
export function countdownLabel(iso: string | null | undefined): string {
  const d = daysUntil(iso);
  if (d === null) return "—";
  if (d === 0) return "today";
  return d > 0 ? `in ${d} day${d === 1 ? "" : "s"}` : `${-d} day${d === -1 ? "" : "s"} overdue`;
}
export function formatKm(km: number | null | undefined): string {
  return km === null || km === undefined ? "—" : `${km.toFixed(km >= 10 ? 1 : 2)} km`;
}
