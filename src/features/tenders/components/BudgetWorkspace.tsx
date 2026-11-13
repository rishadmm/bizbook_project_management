"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, Percent, Trash2, Upload } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { formatMoney, formatNumber, pct } from "@/lib/format";
import { ENUMS, statusHex } from "@/lib/status";
import type { BudgetCategory, BudgetLine } from "@/lib/types";
import { addBudgetLine, bulkSetMargin, deleteBudgetLine, importBudgetLines, updateBudgetLine, type ImportRow, type LinePatch } from "../actions";
import { BUDGET_CATEGORIES, calcLine, calcTotals } from "../calc";

const CSV_COLS = ["category", "item_code", "description", "unit", "quantity", "unit_cost", "margin_pct", "wbs_stage", "notes"] as const;

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** Text/number cell: edits locally, commits on blur / Enter (Enter then moves to the cell below). */
function EditCell({ value, onCommit, col, numeric, disabled, className = "", list }: {
  value: string | number | null; onCommit: (v: string) => void; col: string; numeric?: boolean; disabled?: boolean; className?: string; list?: string;
}) {
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => setV(value === null ? "" : String(value)), [value]);
  const commit = () => { if (v !== (value === null ? "" : String(value))) onCommit(v); };
  if (disabled) {
    const shown = numeric ? formatNumber(Number(value), 2).replace(/\.00$/, "") : value;
    return <span className={`block truncate px-1.5 py-1 ${numeric ? "text-right tabular-nums" : ""} ${className}`}>{shown}</span>;
  }
  return (
    <input
      value={v} list={list} data-col={col} inputMode={numeric ? "decimal" : undefined}
      onChange={(e) => setV(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setV(value === null ? "" : String(value)); e.currentTarget.blur(); }
        if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const cells = Array.from(e.currentTarget.closest("[data-grid]")?.querySelectorAll<HTMLInputElement>(`input[data-col="${col}"]`) ?? []);
          const i = cells.indexOf(e.currentTarget);
          const next = cells[e.key === "ArrowUp" ? i - 1 : i + 1];
          if (e.key === "Enter") commit();
          next?.focus();
        }
      }}
      className={`w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-none ${numeric ? "text-right tabular-nums" : ""} ${className}`}
    />
  );
}

export function BudgetWorkspace({ initialLines, revisionId, revisionLabel, editable, readOnlyReason, tenderCode, currency }: {
  initialLines: BudgetLine[]; revisionId: number; revisionLabel: string; editable: boolean; readOnlyReason?: string; tenderCode: string; currency: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [marginPrompt, setMarginPrompt] = useState<{ id: number; value: number } | null>(null);
  const [reason, setReason] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const money = useCallback((n: number) => formatMoney(n, { currency }), [currency]);
  const linesRef = useRef(lines);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  useEffect(() => setLines(initialLines), [initialLines]);

  const grouped = useMemo(() => BUDGET_CATEGORIES.map((c) => ({ category: c, lines: lines.filter((l) => l.category === c) })), [lines]);
  const totals = useMemo(() => calcTotals(lines), [lines]);
  const byCat = useMemo(() => grouped.filter((g) => g.lines.length).map((g) => ({ name: ENUMS.budgetCategory[g.category].label, category: g.category, value: calcTotals(g.lines).cost })), [grouped]);
  const contingency = grouped.find((g) => g.category === "contingency");
  const contingencyCost = contingency ? calcTotals(contingency.lines).cost : 0;
  const stages = useMemo(() => Array.from(new Set(lines.map((l) => l.wbs_stage).filter(Boolean))) as string[], [lines]);

  const apply = (id: number, patch: LinePatch, why?: string) => {
    const old = linesRef.current.find((l) => l.id === id); if (!old) return;
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setError(null);
    startTransition(async () => {
      const r = await updateBudgetLine(id, patch, why);
      if (!r.ok) { setError(r.error); setLines((ls) => ls.map((l) => (l.id === id ? old : l))); }
    });
  };
  const num = (v: string): number | null => { const n = Number(v.replace(/,/g, "")); return v.trim() === "" || Number.isNaN(n) ? null : n; };
  const bad = () => { setError("Enter a valid number"); setLines((ls) => [...ls]); };
  const commitNum = (l: BudgetLine, key: "quantity" | "unit_cost", v: string) => { const n = num(v); if (n === null) return bad(); if (n !== l[key]) apply(l.id, { [key]: n }); };
  const commitMargin = (l: BudgetLine, v: string) => { const n = num(v); if (n === null) return bad(); if (n !== l.margin_pct) { setReason(""); setMarginPrompt({ id: l.id, value: n }); } };

  const add = (category: BudgetCategory) => startTransition(async () => {
    const r = await addBudgetLine(revisionId, category);
    if (r.ok && r.data) {
      const nl = r.data;
      setLines((ls) => [...ls, nl]);
      setTimeout(() => document.querySelector<HTMLInputElement>(`[data-line="${nl.id}"] input[data-col="description"]`)?.focus(), 50);
    } else if (!r.ok) setError(r.error);
  });
  const remove = (l: BudgetLine) => {
    if (!window.confirm(`Delete line "${l.description}"?`)) return;
    const prev = lines; setLines((ls) => ls.filter((x) => x.id !== l.id));
    startTransition(async () => { const r = await deleteBudgetLine(l.id); if (!r.ok) { setError(r.error); setLines(prev); } });
  };

  const exportCsv = () => {
    const out = [CSV_COLS.join(","), ...lines.map((l) => CSV_COLS.map((c) => csvEscape(l[c as keyof BudgetLine])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out], { type: "text/csv" }));
    a.download = `${tenderCode}-${revisionLabel}-budget.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const th = "px-1.5 py-2 font-semibold";
  return (
    <div className="space-y-4">
      {!editable && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Read-only: {readOnlyReason ?? "this revision is locked"}. Create a new revision from the Commercial tab to change prices.</div>}
      {error && <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><span>{error}</span><button className="text-xs underline" onClick={() => setError(null)}>dismiss</button></div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
          <Box label="Total cost" value={money(totals.cost)} />
          <Box label="Total price" value={money(totals.price)} strong />
          <Box label="Margin value" value={money(totals.margin_value)} />
          <Box label="Margin on price" value={pct(totals.margin_pct)} hint="margin value / price" />
          <Box label="Markup on cost" value={pct(totals.markup_pct)} hint="margin value / cost" />
          <Box label="Contingency (cost)" value={money(contingencyCost)} hint={totals.cost ? `${pct((contingencyCost / totals.cost) * 100)} of cost` : undefined} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cost by category</div>
          {byCat.length === 0 ? <div className="py-10 text-center text-xs text-slate-400">No lines yet</div> : (
            <div className="flex items-center gap-2">
              <div className="h-[130px] w-[130px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie isAnimationActive={false} data={byCat} dataKey="value" nameKey="name" innerRadius={34} outerRadius={60} paddingAngle={1} stroke="none">
                      {byCat.map((c) => <Cell key={c.category} fill={statusHex("budgetCategory", c.category)} />)}
                    </Pie>
                    <Tooltip formatter={(v) => money(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-0.5 text-xs">
                {byCat.map((c) => (
                  <li key={c.category} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate"><span className="h-2 w-2 rounded-full" style={{ background: statusHex("budgetCategory", c.category) }} />{c.name}</span>
                    <span className="tabular-nums text-slate-500">{pct(totals.cost ? (c.value / totals.cost) * 100 : 0, 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">{lines.length} lines {busy && <span className="ml-2 text-xs text-blue-600">saving...</span>}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable && <Button size="sm" onClick={() => { setReason(""); setBulkOpen(true); }}><Percent size={14} />Bulk markup</Button>}
          {editable && <Button size="sm" onClick={() => setImportOpen(true)}><Upload size={14} />Import CSV</Button>}
          <Button size="sm" onClick={exportCsv}><Download size={14} />Export CSV</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm" data-grid>
        <table className="w-full min-w-[1200px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className={`${th} w-24`}>Code</th><th className={`${th} min-w-[260px]`}>Description</th><th className={`${th} w-16`}>Unit</th>
              <th className={`${th} w-24 text-right`}>Qty</th><th className={`${th} w-28 text-right`}>Unit cost</th><th className={`${th} w-28 text-right`}>Cost</th>
              <th className={`${th} w-24 text-right`} title="Input: price = cost x (1 + markup%)">Markup % <span className="normal-case text-slate-400">on cost</span></th>
              <th className={`${th} w-28 text-right`}>Price</th><th className={`${th} w-28 text-right`}>Margin value</th>
              <th className={`${th} w-24 text-right`}>Margin % <span className="normal-case text-slate-400">on price</span></th>
              <th className={`${th} w-36`}>WBS stage</th><th className={`${th} w-8`} />
            </tr>
          </thead>
          {grouped.map(({ category, lines: cl }) => {
            if (!cl.length && !editable) return null;
            const t = calcTotals(cl);
            return (
              <tbody key={category} className="border-t border-slate-200">
                <tr className="bg-slate-50/80">
                  <td colSpan={12} className="px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: statusHex("budgetCategory", category) }} />{ENUMS.budgetCategory[category].label}
                        <span className="rounded-full bg-white px-1.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">{cl.length}</span>
                      </span>
                      {editable && <button type="button" onClick={() => add(category)} className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50"><Plus size={13} />Add line</button>}
                    </div>
                  </td>
                </tr>
                {cl.map((l) => {
                  const a = calcLine(l);
                  return (
                    <tr key={l.id} data-line={l.id} className="border-t border-slate-100 hover:bg-blue-50/30">
                      <td><EditCell col="item_code" value={l.item_code} disabled={!editable} onCommit={(v) => apply(l.id, { item_code: v.trim() || null })} className="text-xs text-slate-500" /></td>
                      <td><EditCell col="description" value={l.description} disabled={!editable} onCommit={(v) => (v.trim() ? apply(l.id, { description: v.trim() }) : setLines((ls) => [...ls]))} /></td>
                      <td><EditCell col="unit" value={l.unit} disabled={!editable} onCommit={(v) => apply(l.id, { unit: v.trim() || null })} className="text-slate-500" /></td>
                      <td><EditCell col="quantity" numeric value={l.quantity} disabled={!editable} onCommit={(v) => commitNum(l, "quantity", v)} /></td>
                      <td><EditCell col="unit_cost" numeric value={l.unit_cost} disabled={!editable} onCommit={(v) => commitNum(l, "unit_cost", v)} /></td>
                      <td className="px-1.5 text-right tabular-nums text-slate-700">{money(a.cost)}</td>
                      <td><EditCell col="margin_pct" numeric value={l.margin_pct} disabled={!editable} onCommit={(v) => commitMargin(l, v)} className="font-medium text-blue-800" /></td>
                      <td className="px-1.5 text-right font-medium tabular-nums text-slate-900">{money(a.price)}</td>
                      <td className="px-1.5 text-right tabular-nums text-slate-600">{money(a.margin_value)}</td>
                      <td className="px-1.5 text-right tabular-nums text-slate-600">{pct(a.margin_on_price)}</td>
                      <td><EditCell col="wbs_stage" list="wbs-stages" value={l.wbs_stage} disabled={!editable} onCommit={(v) => apply(l.id, { wbs_stage: v.trim() || null })} className="text-xs text-slate-500" /></td>
                      <td className="px-1 text-center">{editable && <button type="button" onClick={() => remove(l)} className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600" title="Delete line"><Trash2 size={14} /></button>}</td>
                    </tr>
                  );
                })}
                {cl.length > 0 && (
                  <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                    <td colSpan={5} className="px-2 py-1.5 text-right">Subtotal {ENUMS.budgetCategory[category].label}</td>
                    <td className="px-1.5 text-right tabular-nums">{money(t.cost)}</td>
                    <td className="px-1.5 text-right tabular-nums">{pct(t.markup_pct)}</td>
                    <td className="px-1.5 text-right tabular-nums">{money(t.price)}</td>
                    <td className="px-1.5 text-right tabular-nums">{money(t.margin_value)}</td>
                    <td className="px-1.5 text-right tabular-nums">{pct(t.margin_pct)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
              </tbody>
            );
          })}
          <tfoot className="border-t-2 border-slate-300 bg-slate-100 text-sm font-semibold text-slate-900">
            <tr>
              <td colSpan={5} className="px-2 py-2 text-right">Grand total</td>
              <td className="px-1.5 text-right tabular-nums">{money(totals.cost)}</td>
              <td className="px-1.5 text-right tabular-nums">{pct(totals.markup_pct)}</td>
              <td className="px-1.5 text-right tabular-nums">{money(totals.price)}</td>
              <td className="px-1.5 text-right tabular-nums">{money(totals.margin_value)}</td>
              <td className="px-1.5 text-right tabular-nums">{pct(totals.margin_pct)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        <datalist id="wbs-stages">{stages.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      <p className="text-xs text-slate-400">Tab / Enter / arrow keys move between cells; changes save on leaving a cell. Markup % is the editable input (price = cost x (1 + markup%)); margin % on price is derived.</p>

      <Modal open={!!marginPrompt} onClose={() => { setMarginPrompt(null); setLines((ls) => [...ls]); }} title="Reason for margin change">
        {marginPrompt && (() => {
          const l = lines.find((x) => x.id === marginPrompt.id);
          return (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!reason.trim()) return; apply(marginPrompt.id, { margin_pct: marginPrompt.value }, reason); setMarginPrompt(null); }}>
              <p className="text-sm text-slate-600">{l?.description}: markup {l?.margin_pct}% to <b>{marginPrompt.value}%</b>. Logged in the negotiation trail.</p>
              <Field label="Reason"><Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. client price pressure, competitive rate" /></Field>
              <div className="flex justify-end gap-2"><Button onClick={() => { setMarginPrompt(null); setLines((ls) => [...ls]); }}>Cancel</Button><Button type="submit" variant="primary">Apply</Button></div>
            </form>
          );
        })()}
      </Modal>

      <BulkModal open={bulkOpen} onClose={() => setBulkOpen(false)} revisionId={revisionId} onDone={() => router.refresh()} onError={setError} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} revisionId={revisionId} onDone={() => router.refresh()} onError={setError} />
    </div>
  );
}

function Box({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`tabular-nums ${strong ? "text-xl font-bold text-slate-900" : "text-lg font-semibold text-slate-800"}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function BulkModal({ open, onClose, revisionId, onDone, onError }: { open: boolean; onClose: () => void; revisionId: number; onDone: () => void; onError: (m: string) => void }) {
  const [scope, setScope] = useState("all"); const [margin, setMargin] = useState("10"); const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Modal open={open} onClose={onClose} title="Set markup for multiple lines">
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        start(async () => { const r = await bulkSetMargin(revisionId, scope, Number(margin), reason); if (!r.ok) onError(r.error); else { onClose(); onDone(); } });
      }}>
        <Field label="Apply to">
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">All lines</option>
            {BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{ENUMS.budgetCategory[c].label} lines only</option>)}
          </Select>
        </Field>
        <Field label="Markup % on cost" hint="price = cost x (1 + markup%)"><Input type="number" step="0.1" value={margin} onChange={(e) => setMargin(e.target.value)} required /></Field>
        <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={pending}>{pending ? "Applying..." : "Apply"}</Button></div>
      </form>
    </Modal>
  );
}

function ImportModal({ open, onClose, revisionId, onDone, onError }: { open: boolean; onClose: () => void; revisionId: number; onDone: () => void; onError: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null); const [replace, setReplace] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Modal open={open} onClose={onClose} title="Import budget lines from CSV">
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault(); if (!file) return;
        start(async () => {
          const rows = parseCsv(await file.text());
          const header = rows.shift()?.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_")) ?? [];
          const idx = (n: string) => header.indexOf(n);
          if (idx("category") < 0 || idx("description") < 0) { onError("CSV needs at least 'category' and 'description' columns (see Export CSV for the format)"); onClose(); return; }
          const get = (r: string[], n: string) => (idx(n) >= 0 ? (r[idx(n)] ?? "").trim() : "");
          const numv = (r: string[], n: string, d: number) => (get(r, n) === "" ? d : Number(get(r, n).replace(/,/g, "")));
          const parsed: ImportRow[] = rows.map((r) => ({
            category: get(r, "category").toLowerCase(), item_code: get(r, "item_code"), description: get(r, "description"), unit: get(r, "unit"),
            quantity: numv(r, "quantity", 0), unit_cost: numv(r, "unit_cost", 0), margin_pct: numv(r, "margin_pct", 10), wbs_stage: get(r, "wbs_stage"), notes: get(r, "notes"),
          }));
          const res = await importBudgetLines(revisionId, parsed, replace);
          onClose();
          if (!res.ok) onError(res.error); else { setFile(null); onDone(); }
        });
      }}>
        <p className="text-xs text-slate-500">Columns: {CSV_COLS.join(", ")}. Category must be one of {BUDGET_CATEGORIES.join(", ")}. Margin % is markup on cost.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" required />
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace all existing lines (otherwise append)</label>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={pending || !file}>{pending ? "Importing..." : "Import"}</Button></div>
      </form>
    </Modal>
  );
}
