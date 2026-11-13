"use client";
import { Plus, X } from "lucide-react";
import { useState } from "react";

export interface LineCol { name: string; label: string; type?: "text" | "number"; width?: string; placeholder?: string }

const ctl = "block w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

/** Repeating rows of inputs (parallel arrays by field name). */
export function LineRows({ title, cols, addLabel }: { title: string; cols: LineCol[]; addLabel: string }) {
  const [rows, setRows] = useState<number[]>([0]);
  const [next, setNext] = useState(1);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-600">{title}</div>
      <div className="space-y-2">
        {rows.map((k) => (
          <div key={k} className="flex items-end gap-2">
            {cols.map((c) => (
              <label key={c.name} className="min-w-0" style={{ flex: c.width ?? "1" }}>
                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{c.label}</span>
                <input name={c.name} type={c.type ?? "text"} step={c.type === "number" ? "any" : undefined} min={c.type === "number" ? 0 : undefined} placeholder={c.placeholder} className={ctl} />
              </label>
            ))}
            <button type="button" aria-label="Remove" disabled={rows.length === 1} onClick={() => setRows(rows.filter((r) => r !== k))} className="mb-1 rounded p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><X size={16} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => { setRows([...rows, next]); setNext(next + 1); }} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600"><Plus size={13} />{addLabel}</button>
    </div>
  );
}
