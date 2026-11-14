"use client";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface RowCol { name: string; label: string; type?: "text" | "number"; width?: string; placeholder?: string }
export interface RowPreset { label: string; values: Record<string, string> }
type Row = { k: number; v: Record<string, string> };
const ctl = "block w-full rounded-lg border-[1.5px] border-[#e2e8f0] bg-white px-2.5 py-2 text-sm text-dark placeholder:text-[#94a3b8] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";
const isEmpty = (v: Record<string, string>) => Object.values(v).every((x) => !x?.trim());
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Repeating rows of inputs (parallel arrays by field name) with optional initial rows (correcting a rejected report), preset chips,
 * a header shown once (table layout from `sm`, compact cards on phones) and optional totals of numeric columns.
 */
export default function RowsEditor({ cols, addLabel, initial, presets, totals, onRowsChange }: {
  cols: RowCol[]; addLabel: string; initial?: Record<string, string>[]; presets?: RowPreset[];
  totals?: { name: string; label: string }[]; onRowsChange?: (rows: Record<string, string>[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => (initial && initial.length ? initial.map((v, k) => ({ k, v })) : [{ k: 0, v: {} }]));
  const nextK = useRef(rows.length);
  const cb = useRef(onRowsChange);
  cb.current = onRowsChange;
  useEffect(() => { cb.current?.(rows.map((r) => r.v)); }, [rows]);

  const setCell = (k: number, name: string, value: string) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, v: { ...r.v, [name]: value } } : r)));
  const add = (values: Record<string, string> = {}) => setRows((rs) => (rs.length > 0 && isEmpty(rs[0].v) && Object.keys(values).length > 0 ? [{ ...rs[0], v: values }, ...rs.slice(1)] : [...rs, { k: nextK.current++, v: values }]));
  const remove = (k: number) => setRows((rs) => (rs.length === 1 ? [{ k: nextK.current++, v: {} }] : rs.filter((r) => r.k !== k)));
  const template = `${cols.map((c) => `minmax(0,${c.width ?? "1"}fr)`).join(" ")} 2rem`;

  return (
    <div>
      {presets && presets.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Quick add">
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={() => add(p.values)} className="inline-flex items-center gap-1 rounded-full border border-line bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-primary hover:bg-primary-50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><Plus size={11} />{p.label}</button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="hidden gap-2 border-b border-line bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-(--cols)" style={{ "--cols": template } as React.CSSProperties}>
          {cols.map((c) => <div key={c.name}>{c.label}</div>)}<div className="sr-only">Remove</div>
        </div>
        <div className="divide-y divide-line">
          {rows.map(({ k, v }) => (
            <div key={k} className="relative grid grid-cols-2 gap-2 p-3 even:bg-slate-50/50 hover:bg-primary-50/40 sm:grid-cols-(--cols) sm:items-center sm:py-2" style={{ "--cols": template } as React.CSSProperties}>
              {cols.map((c, i) => (
                <label key={c.name} className={`min-w-0 ${i === 0 ? "col-span-2 pr-8 sm:col-span-1 sm:pr-0" : ""}`}>
                  <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:sr-only">{c.label}</span>
                  <input name={c.name} type={c.type ?? "text"} step={c.type === "number" ? "any" : undefined} min={c.type === "number" ? 0 : undefined} inputMode={c.type === "number" ? "decimal" : undefined}
                    value={v[c.name] ?? ""} onChange={(e) => setCell(k, c.name, e.target.value)} placeholder={c.placeholder} className={ctl} />
                </label>
              ))}
              <button type="button" aria-label="Remove row" onClick={() => remove(k)} className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:static sm:justify-self-end"><X size={16} /></button>
            </div>
          ))}
        </div>
        {totals && totals.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line bg-primary-50/60 px-3 py-2 text-xs font-bold text-primary-dark" aria-live="polite">
            <span className="uppercase tracking-wide text-slate-500">Total</span>
            {totals.map((t) => <span key={t.name} className="tabular-nums">{t.label}: {fmt(rows.reduce((a, r) => a + (Number(r.v[t.name]) || 0), 0))}</span>)}
          </div>
        )}
      </div>
      <button type="button" onClick={() => add()} className="mt-2.5 inline-flex items-center gap-1 rounded-lg px-1 py-1 text-xs font-bold text-primary hover:text-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><Plus size={13} />{addLabel}</button>
    </div>
  );
}
