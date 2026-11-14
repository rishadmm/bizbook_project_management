// Pure invoice arithmetic (safe for client components). Convention (docs/FOUNDATION.md, "Subcontractor invoices"):
//   claimed (GROSS incl. VAT) -> certified (gross) -> less retention -> less advance recovery -> net payable.
// `claimed_amount` = gross_amount = subtotal + vat_amount; line amounts are ex-VAT.

export const DEFAULT_VAT_RATE = 5;
export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const r3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const r4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

export const lineAmount = (qty: number, rate: number): number => r2(qty * rate);

/** Totals from an ex-VAT subtotal. */
export function fromSubtotal(subtotal: number, vatRate = DEFAULT_VAT_RATE): { subtotal: number; vat: number; gross: number } {
  const s = r2(subtotal);
  const vat = r2((s * vatRate) / 100);
  return { subtotal: s, vat, gross: r2(s + vat) };
}
/** Splits a gross (incl. VAT) amount into subtotal + VAT. */
export function fromGross(gross: number, vatRate = DEFAULT_VAT_RATE): { subtotal: number; vat: number; gross: number } {
  const subtotal = r2(gross / (1 + vatRate / 100));
  return { subtotal, vat: r2(gross - subtotal), gross: r2(gross) };
}
/** Retention / advance recovery are taken on the certified gross amount. */
export function deductions(certifiedGross: number, retentionPct: number, advancePct: number): { retention: number; advance: number; net: number } {
  const retention = r2((certifiedGross * (retentionPct || 0)) / 100);
  const advance = r2((certifiedGross * (advancePct || 0)) / 100);
  return { retention, advance, net: r2(certifiedGross - retention - advance) };
}

export interface BoqItem {
  item_code: string; description: string; unit: string; contract_qty: number; rate: number; prev_qty: number; stage_id: number | null;
}
