"use client";
import { PanelLeftClose, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { RESP_LABEL } from "../calc";
import type { Derived, OpsMapData, OpsProject, Rag } from "../types";
import { Bar, Dot, RAG_COLOR, RAG_TEXT, shortDate, slipColor, slipText } from "./bits";

export interface Filters { q: string; rag: Rag[]; category: string; status: string; subs: number[]; resp: string }
export const EMPTY_FILTERS: Filters = { q: "", rag: [], category: "", status: "", subs: [], resp: "" };
export const filtersActive = (f: Filters) => !!(f.q || f.rag.length || f.category || f.status || f.subs.length || f.resp);

export default function ProjectsRail({ hideSubs, data, derived, projects, filters, setFilters, selected, onSelect, onCollapse }: {
  hideSubs?: boolean; data: OpsMapData; derived: Derived; projects: OpsProject[]; filters: Filters; setFilters: (f: Filters) => void; selected: number | null; onSelect: (id: number) => void; onCollapse: () => void;
}) {
  const [subsOpen, setSubsOpen] = useState(false);
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  const tree = useMemo(() => {
    const top = projects.filter((p) => !p.parentId || !projects.some((x) => x.id === p.parentId));
    return top.map((p) => ({ p, kids: projects.filter((k) => k.parentId === p.id) }));
  }, [projects]);
  const statuses = useMemo(() => [...new Set(data.projects.map((p) => p.status))], [data.projects]);

  const Item = ({ p, child }: { p: OpsProject; child?: boolean }) => {
    const d = derived.proj.get(p.id)!;
    const sel = selected === p.id;
    return (
      <button type="button" className="om-row" aria-current={sel} onClick={() => onSelect(p.id)} style={child ? { marginLeft: 14, width: "calc(100% - 14px)", borderLeft: "2px solid var(--om-border)", borderRadius: "4px 12px 12px 4px" } : undefined}>
        <div className="flex items-center gap-2">
          <Dot c={RAG_COLOR[d.rag]} size={9} />
          <span className="om-muted text-[10.5px] font-extrabold tracking-wide">{p.code}</span>
          <span className="ml-auto text-[11px] font-extrabold" style={{ color: slipColor(d.delayDays) }}>{d.delayDays > 0 ? slipText(d.delayDays) : "on plan"}</span>
        </div>
        <div className="mt-0.5 truncate text-[13px] font-extrabold leading-snug">{p.name}</div>
        <div className="om-muted truncate text-[11px] font-semibold">{p.client ?? "—"}{p.lengthKm ? ` · ${p.lengthKm.toFixed(1)} km` : p.totalQty ? ` · ${(p.totalQty / 10000).toFixed(0)} ha` : ""}</div>
        <div className="mt-2"><Bar actual={d.actualPct} planned={d.plannedPct} color={RAG_COLOR[d.rag === "grey" ? "grey" : d.rag]} /></div>
        <div className="om-muted om-num mt-1.5 flex justify-between text-[10.5px] font-bold">
          <span>Actual {d.actualPct.toFixed(0)}% · Plan {d.plannedPct.toFixed(0)}%</span>
          <span>{shortDate(p.endDate)} → <b style={{ color: "var(--om-fg)" }}>{shortDate(d.projectedFinish)}</b></span>
        </div>
      </button>
    );
  };

  return (
    <div className="om-glass flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <div><h2 className="text-[15px] font-extrabold leading-tight">Projects</h2><div className="om-muted text-[11px] font-semibold">{projects.length} of {data.projects.length} shown</div></div>
        <button type="button" className="om-btn !h-8 !w-8 !px-0" onClick={onCollapse} aria-label="Collapse projects panel"><PanelLeftClose size={15} /></button>
      </div>
      <div className="space-y-2 px-3 pb-2">
        <div className="relative">
          <Search size={14} className="om-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input className="om-input" placeholder="Search projects, clients…" value={filters.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search projects" />
        </div>
        <div className="flex gap-1">
          {(["green", "amber", "red"] as Rag[]).map((r) => {
            const on = filters.rag.includes(r);
            return <button key={r} type="button" aria-pressed={on} onClick={() => set({ rag: on ? filters.rag.filter((x) => x !== r) : [...filters.rag, r] })} className="om-btn !h-7 flex-1 !px-1 !text-[11px]" style={on ? { background: RAG_COLOR[r], borderColor: RAG_COLOR[r] } : undefined}><Dot c={on ? "#fff" : RAG_COLOR[r]} size={6} />{RAG_TEXT[r]}</button>;
          })}
        </div>
        <div className="flex gap-1">
          <select className="om-select" aria-label="Category" value={filters.category} onChange={(e) => set({ category: e.target.value })}><option value="">All categories</option>{data.categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
          <select className="om-select" aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{statuses.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select>
        </div>
        <div className="flex gap-1">
          {!hideSubs && <button type="button" className="om-select flex items-center justify-between text-left" aria-expanded={subsOpen} onClick={() => setSubsOpen(!subsOpen)}>{filters.subs.length ? `${filters.subs.length} subcontractor${filters.subs.length > 1 ? "s" : ""}` : "All subcontractors"}<span className="om-muted">▾</span></button>}
          <select className="om-select" aria-label="Delay responsibility" value={filters.resp} onChange={(e) => set({ resp: e.target.value })}><option value="">Any delay cause</option>{["subcontractor", "company", "client", "authority", "weather", "utility_clash", "other"].map((r) => <option key={r} value={r}>{RESP_LABEL[r]}</option>)}</select>
        </div>
        {subsOpen && !hideSubs && (
          <div className="om-soft om-scroll max-h-40 space-y-0.5 rounded-xl p-1.5">
            {data.subs.map((s) => {
              const on = filters.subs.includes(s.id);
              return <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-semibold hover:bg-white/10"><input type="checkbox" checked={on} onChange={() => set({ subs: on ? filters.subs.filter((x) => x !== s.id) : [...filters.subs, s.id] })} />{s.name}</label>;
            })}
          </div>
        )}
        {filtersActive(filters) && <button type="button" className="text-[11px] font-extrabold" style={{ color: "var(--om-primary)" }} onClick={() => setFilters(EMPTY_FILTERS)}><X size={11} className="mr-0.5 inline" />Clear filters</button>}
      </div>
      <div className="om-scroll min-h-0 flex-1 space-y-0.5 px-2 pb-3">
        {tree.map(({ p, kids }) => <div key={p.id}><Item p={p} />{kids.map((k) => <Item key={k.id} p={k} child />)}</div>)}
        {!tree.length && <div className="om-muted p-6 text-center text-xs font-semibold">No projects match these filters.</div>}
      </div>
    </div>
  );
}
