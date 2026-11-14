"use client";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fromSubtotal, lineAmount, type BoqItem } from "../calc";

const cell = "block w-full rounded-lg border-[1.5px] border-[#e2e8f0] bg-white px-2 py-1.5 text-sm text-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

interface Row { key: number; custom: boolean; item_code: string; description: string; unit: string; contract_qty: number; prev_qty: number; rate: string; qty: string }

/**
 * Invoice line items. BOQ rows come from the subcontract (description, unit, rate and previous quantity are read-only; only the quantity of this
 * period is entered). `allowCustom` adds free rows (internal form). Posts parallel fields line_item_code / line_description / line_unit / line_rate /
 * line_this_qty / line_remarks; the server recomputes every amount. `onTotals` reports the gross (incl. VAT) so the parent can show it.
 */
export default function LinesEditor({ boq, vatRate, currency, allowCustom, onTotals }: {
  boq: BoqItem[]; vatRate: number; currency: string; allowCustom?: boolean; onTotals?: (t: { gross: number; subtotal: number; vat: number; count: number }) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => boq.map((b, i) => ({ key: i, custom: false, item_code: b.item_code, description: b.description, unit: b.unit, contract_qty: b.contract_qty, prev_qty: b.prev_qty, rate: String(b.rate), qty: "" })));
  const [next, setNext] = useState(boq.length);
  const totals = useMemo(() => {
    const subtotal = rows.reduce((s, r) => s + lineAmount(Number(r.qty) || 0, Number(r.rate) || 0), 0);
    return { ...fromSubtotal(subtotal, vatRate), count: rows.filter((r) => Number(r.qty) > 0).length };
  }, [rows, vatRate]);
  useEffect(() => { onTotals?.(totals); }, [totals, onTotals]);
  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div>
      <div className="mb-1 text-xs font-bold text-slate-600">Line items</div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[#f8fafc] text-left text-[11px] font-bold uppercase tracking-wide text-muted">
            <tr><th className="px-2 py-2">Item</th><th className="px-2 py-2">Description</th><th className="px-2 py-2">Unit</th><th className="px-2 py-2 text-right">Contract</th><th className="px-2 py-2 text-right">Previous</th>
              <th className="w-28 px-2 py-2 text-right">This period</th><th className="px-2 py-2 text-right">Cumulative</th><th className="px-2 py-2 text-right">Rate</th><th className="px-2 py-2 text-right">Amount</th>{allowCustom && <th className="w-8" />}</tr>
          </thead>
          <tbody className="divide-y divide-[#f1f5f9]">
            {rows.map((r) => {
              const q = Number(r.qty) || 0;
              return (
                <tr key={r.key} data-line-row>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs font-semibold text-slate-600">
                    {r.custom ? <input name="line_item_code" aria-label="Item code" value={r.item_code} onChange={(e) => set(r.key, { item_code: e.target.value })} className={cell} style={{ width: 90 }} /> : <>{r.item_code}<input type="hidden" name="line_item_code" value={r.item_code} /></>}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.custom ? <input name="line_description" aria-label="Description" value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} className={cell} /> : <>{r.description}<input type="hidden" name="line_description" value={r.description} /></>}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.custom ? <input name="line_unit" aria-label="Unit" value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value })} className={cell} style={{ width: 70 }} /> : <>{r.unit}<input type="hidden" name="line_unit" value={r.unit} /></>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.custom ? "—" : qtyFmt(r.contract_qty)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{qtyFmt(r.prev_qty)}</td>
                  <td className="px-2 py-1.5"><input name="line_this_qty" type="number" step="any" min="0" inputMode="decimal" aria-label={`This period quantity ${r.item_code}`} value={r.qty} onChange={(e) => set(r.key, { qty: e.target.value })} className={`${cell} text-right`} /></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{qtyFmt(r.prev_qty + q)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.custom ? <input name="line_rate" type="number" step="any" min="0" aria-label="Rate" value={r.rate} onChange={(e) => set(r.key, { rate: e.target.value })} className={`${cell} text-right`} style={{ width: 90 }} /> : <>{money(Number(r.rate))}<input type="hidden" name="line_rate" value={r.rate} /></>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{money(lineAmount(q, Number(r.rate) || 0))}<input type="hidden" name="line_remarks" value="" /></td>
                  {allowCustom && <td className="px-1">{r.custom && <button type="button" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={14} /></button>}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="text-sm">
            <tr><td colSpan={8} className="px-2 pt-2 text-right text-xs text-slate-500">Subtotal ({currency})</td><td className="px-2 pt-2 text-right tabular-nums">{money(totals.subtotal)}</td>{allowCustom && <td />}</tr>
            <tr><td colSpan={8} className="px-2 text-right text-xs text-slate-500">VAT {vatRate}%</td><td className="px-2 text-right tabular-nums">{money(totals.vat)}</td>{allowCustom && <td />}</tr>
            <tr><td colSpan={8} className="px-2 pb-2 text-right text-xs font-bold text-slate-700">Total claimed (incl. VAT)</td><td className="px-2 pb-2 text-right font-extrabold tabular-nums text-dark" data-testid="lines-gross">{money(totals.gross)}</td>{allowCustom && <td />}</tr>
          </tfoot>
        </table>
      </div>
      {allowCustom && (
        <button type="button" onClick={() => { setRows((rs) => [...rs, { key: next, custom: true, item_code: "", description: "", unit: "", contract_qty: 0, prev_qty: 0, rate: "", qty: "" }]); setNext(next + 1); }} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary"><Plus size={13} />Add other item</button>
      )}
    </div>
  );
}
