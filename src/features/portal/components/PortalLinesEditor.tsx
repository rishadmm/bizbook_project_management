"use client";
import { AlertTriangle, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fromSubtotal, lineAmount, r4, type BoqItem } from "@/features/invoices/calc";

export interface LineTotals { subtotal: number; vat: number; gross: number; count: number; overCount: number }
interface Row { key: number; item_code: string; description: string; unit: string; contract_qty: number; prev_qty: number; rate: number; qty: string }

const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${on ? "border-primary bg-primary text-white shadow-brand-sm" : "border-line bg-white text-slate-600 hover:border-primary hover:text-primary"}`;
const GRID = "@2xl:grid-cols-[72px_minmax(200px,1fr)_170px_120px]";

/**
 * Portal invoice lines. Same posted fields as the shared LinesEditor (parallel line_item_code / line_description / line_unit / line_rate /
 * line_this_qty / line_remarks): only the this-period quantity is entered, the server recomputes every amount. One DOM layout that is a table row
 * from md up and a card on phones. Filtered-out rows stay in the DOM (hidden) so their quantities are still submitted.
 */
export default function PortalLinesEditor({ boq, vatRate, currency, onTotals }: { boq: BoqItem[]; vatRate: number; currency: string; onTotals?: (t: LineTotals) => void }) {
  const [rows, setRows] = useState<Row[]>(() => boq.map((b, i) => ({ key: i, item_code: b.item_code, description: b.description, unit: b.unit, contract_qty: b.contract_qty, prev_qty: b.prev_qty, rate: b.rate, qty: "" })));
  const [query, setQuery] = useState("");
  const [onlyQty, setOnlyQty] = useState(false);
  const money = (n: number) => `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const totals = useMemo<LineTotals>(() => {
    const subtotal = rows.reduce((s, r) => s + lineAmount(Number(r.qty) || 0, r.rate), 0);
    const overCount = rows.filter((r) => r.contract_qty > 0 && r.prev_qty + (Number(r.qty) || 0) > r.contract_qty * 1.0001 && Number(r.qty) > 0).length;
    return { ...fromSubtotal(subtotal, vatRate), count: rows.filter((r) => Number(r.qty) > 0).length, overCount };
  }, [rows, vatRate]);
  useEffect(() => { onTotals?.(totals); }, [totals, onTotals]);
  const set = (key: number, qty: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, qty } : r)));
  const q = query.trim().toLowerCase();
  const visible = (r: Row) => (!q || r.item_code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)) && (!onlyQty || Number(r.qty) > 0);
  const shown = rows.filter(visible).length;
  const searchable = rows.length > 8;

  return (
    <div className="@container">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items…" aria-label="Search line items" className="block w-full rounded-xl border-[1.5px] border-[#e2e8f0] bg-white py-2 pl-8 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15" />
          </div>
        )}
        <button type="button" aria-pressed={onlyQty} onClick={() => setOnlyQty(!onlyQty)} className={chip(onlyQty)}>Show only lines with quantity</button>
        <span className="text-xs tabular-nums text-slate-500" aria-live="polite">{totals.count} of {rows.length} lines have quantity{shown !== rows.length ? ` · showing ${shown}` : ""}</span>
        <button type="button" disabled={totals.count === 0} onClick={() => setRows((rs) => rs.map((r) => ({ ...r, qty: "" })))} className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"><Trash2 size={13} />Clear all</button>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        <div className={`hidden gap-3 bg-[#f8fafc] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted @2xl:grid ${GRID}`} aria-hidden>
          <span>Item</span><span>Description</span><span>This period</span><span className="text-right">Amount</span>
        </div>
        <div className="divide-y divide-[#f1f5f9]">
          {rows.map((r) => {
            const n = Number(r.qty) || 0;
            const cum = r.prev_qty + n;
            const total = r.contract_qty;
            const remaining = Math.max(0, r4(total - r.prev_qty));
            const over = total > 0 && n > 0 && cum > total * 1.0001;
            const prevPct = total ? Math.min(100, (r.prev_qty / total) * 100) : 0;
            const thisPct = total ? (over ? Math.max(0, 100 - prevPct) : Math.min(100 - prevPct, (n / total) * 100)) : 0;
            const id = `ln-${r.key}`;
            return (
              <div key={r.key} data-line-row className={`grid gap-x-3 gap-y-2 px-3 py-3 transition-colors ${GRID} @2xl:items-start ${visible(r) ? "" : "hidden"} ${over ? "bg-red-50/70" : n > 0 ? "bg-primary-50/50" : ""}`}>
                <input type="hidden" name="line_item_code" value={r.item_code} /><input type="hidden" name="line_description" value={r.description} />
                <input type="hidden" name="line_unit" value={r.unit} /><input type="hidden" name="line_rate" value={r.rate} /><input type="hidden" name="line_remarks" value="" />
                <span className="text-xs font-extrabold text-primary @2xl:pt-0.5">{r.item_code}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug text-dark">{r.description}</div>
                  <div className="mt-1.5 flex min-w-0 items-center gap-2">
                    <div className="relative h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`Previous ${qtyFmt(r.prev_qty)}, this period ${qtyFmt(n)}, contract ${qtyFmt(total)} ${r.unit}`}>
                      <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${prevPct}%` }} />
                      <div className={`absolute inset-y-0 ${over ? "bg-red-500" : "bg-[repeating-linear-gradient(45deg,#a5a0ff_0_4px,#c7c4ff_4px_8px)]"}`} style={{ left: `${prevPct}%`, width: `${thisPct}%` }} />
                    </div>
                    <span className="min-w-0 truncate text-[11px] tabular-nums text-slate-500">Prev {qtyFmt(r.prev_qty)} · Contract {qtyFmt(total)} {r.unit}{total > 0 && <span className={over ? "font-bold text-red-600" : ""}> · {Math.round((cum / total) * 100)}%</span>} · Rate {money(r.rate)}{r.unit ? `/${r.unit}` : ""}</span>
                  </div>
                </div>
                <div>
                  <label htmlFor={id} className="sr-only">This period quantity {r.item_code}</label>
                  <div className="relative">
                    <input id={id} name="line_this_qty" type="number" step="any" min="0" inputMode="decimal" placeholder="0" value={r.qty} onChange={(e) => set(r.key, e.target.value)} aria-invalid={over}
                      className={`block w-full rounded-lg border-[1.5px] bg-white py-1.5 pl-2.5 text-right text-sm font-bold tabular-nums text-dark placeholder:text-slate-300 focus:outline-none focus:ring-2 ${r.unit ? "pr-12" : "pr-2.5"} ${over ? "border-red-400 focus:border-red-500 focus:ring-red-200" : "border-[#e2e8f0] focus:border-primary focus:ring-primary/15"}`} />
                    {r.unit && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] font-bold text-slate-400">{r.unit}</span>}
                  </div>
                  {total > 0 && (
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span className="tabular-nums">Max {qtyFmt(remaining)}</span>
                      <button type="button" disabled={remaining <= 0} onClick={() => set(r.key, String(remaining))} className="font-bold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:text-slate-300 disabled:no-underline">Fill to contract</button>
                    </div>
                  )}
                </div>
                <div className="flex items-baseline justify-between @2xl:block @2xl:pt-1.5 @2xl:text-right">
                  <span className="text-[11px] text-slate-400 @2xl:hidden">Amount</span>
                  <span className={`whitespace-nowrap text-sm font-extrabold tabular-nums ${n > 0 ? "text-dark" : "text-slate-300"}`}>{money(lineAmount(n, r.rate))}</span>
                </div>
                {over && (
                  <p className="flex items-start gap-1.5 text-xs font-semibold text-red-700 min-w-0 @2xl:col-span-4"><AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
                    <span>Cumulative {qtyFmt(cum)} would exceed the contract quantity of {qtyFmt(total)} {r.unit} by {qtyFmt(r4(cum - total))}. Check the figure before submitting.</span></p>
                )}
              </div>
            );
          })}
          {shown === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">No lines match. Clear the search or the quantity filter.</p>}
        </div>
        <dl className="space-y-1 border-t border-line bg-[#f8fafc] px-3 py-3 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-xs text-slate-500">Subtotal</dt><dd className="tabular-nums">{money(totals.subtotal)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-xs text-slate-500">VAT {vatRate}%</dt><dd className="tabular-nums">{money(totals.vat)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-xs font-bold text-slate-700">Total claimed (incl. VAT)</dt><dd className="font-extrabold tabular-nums text-dark" data-testid="lines-gross">{money(totals.gross)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
