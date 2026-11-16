"use client";
import { ExternalLink, X } from "lucide-react";
import { Bar as RBar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import { RESP_COLOR, RESP_LABEL, STATUS_COLOR, STATUS_LABEL } from "../calc";
import type { ClientMode, Derived, OpsIssue, OpsMapData, OpsProject, OpsSegment, Party, SegStatus } from "../types";
import { Dot, RAG_COLOR, RagPill, Ring, Section, daysBetween, shortDate, slipColor, slipText } from "./bits";

/* ---------------------------------------------------------------- line of balance */

function LineOfBalance({ segs, derived, project, colorOf, selectedKey, onSelect, dimKeys }: {
  segs: OpsSegment[]; derived: Derived; project: OpsProject; colorOf: (s: OpsSegment) => string; selectedKey: string | null; onSelect: (k: string) => void; dimKeys: Set<string> | null;
}) {
  const rows = segs.filter((s) => s.plannedStart && s.plannedEnd);
  if (!rows.length) return <div className="om-muted text-xs font-semibold">No schedule data.</div>;
  let lo = rows[0].plannedStart!, hi = rows[0].plannedEnd!;
  for (const s of rows) {
    const d = derived.seg.get(s.key)!;
    if (s.plannedStart! < lo) lo = s.plannedStart!;
    for (const x of [s.plannedEnd!, d.projectedEnd]) if (x > hi) hi = x;
  }
  const span = Math.max(1, daysBetween(lo, hi));
  const pos = (d: string) => `${Math.max(0, Math.min(100, (daysBetween(lo, d) / span) * 100))}%`;
  const wid = (a: string, b: string) => `${Math.max(0.4, (daysBetween(a, b) / span) * 100)}%`;
  const asOfPos = Math.max(0, Math.min(100, (daysBetween(lo, derived.asOf) / span) * 100));
  void project;
  return (
    <div>
      <div className="om-muted om-num mb-1 flex justify-between pl-[104px] text-[9.5px] font-bold"><span>{shortDate(lo)}</span><span>{shortDate(hi)}</span></div>
      <div className="relative space-y-1">
        <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px" style={{ left: `calc(104px + (100% - 104px) * ${asOfPos / 100})`, background: "#635BFF" }}>
          <span className="absolute -top-3.5 -translate-x-1/2 rounded px-1 text-[8.5px] font-extrabold text-white" style={{ background: "#635BFF" }}>{derived.forecast ? "date" : derived.asOf === "" ? "" : "now"}</span>
        </div>
        {rows.map((s) => {
          const d = derived.seg.get(s.key)!;
          const c = colorOf(s);
          const sel = selectedKey === s.key;
          const over = d.projectedEnd > s.plannedEnd!;
          const faded = dimKeys && !dimKeys.has(s.key);
          return (
            <button key={s.key} type="button" onClick={() => onSelect(s.key)} className="om-row !p-1" aria-current={sel} style={{ opacity: faded ? 0.35 : 1 }} title={`${s.sub?.name ?? "Self-performed"} · ${s.stageName}`}>
              <div className="flex w-full items-center gap-2">
              <div className="w-[96px] shrink-0 truncate text-[10.5px] font-extrabold leading-tight">
                <span className="om-muted mr-1">{s.stageCode}</span>{(s.sub?.name ?? "Self").split(" ").slice(0, 2).join(" ")}
              </div>
              <div className="relative h-4 flex-1">
                <div className="om-track absolute top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ left: pos(s.plannedStart!), width: wid(s.plannedStart!, s.plannedEnd!), opacity: 0.9 }} />
                <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full transition-[width] duration-300" style={{ left: pos(s.plannedStart!), width: `calc(${wid(s.plannedStart!, s.plannedEnd!)} * ${Math.min(100, d.actualPct) / 100})`, background: c }} />
                {over && d.status !== "completed" && (
                  <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-r-full" style={{ left: pos(s.plannedEnd!), width: wid(s.plannedEnd!, d.projectedEnd), background: "repeating-linear-gradient(135deg,#EF4444 0 3px,rgba(239,68,68,.25) 3px 6px)" }} />
                )}
                {!over && d.status !== "completed" && d.status !== "not_started" && <div className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded bg-emerald-500" style={{ left: pos(d.projectedEnd) }} />}
                <div className="absolute top-0 h-4 w-[2px] rounded" style={{ left: pos(s.plannedEnd!), background: "var(--om-plan)", opacity: 0.55 }} />
              </div>
              <div className="om-num w-9 shrink-0 text-right text-[10.5px] font-extrabold" style={{ color: d.status === "completed" ? "#8B5CF6" : slipColor(d.slipDays) }}>{d.status === "completed" ? "done" : d.status === "not_started" ? "–" : slipText(d.slipDays).replace(" d", "d")}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- delay chart */

export function DelayChart({ parties, highlight, onHighlight }: { parties: Party[]; highlight: string | null; onHighlight: (k: string | null) => void }) {
  if (!parties.length) return <div className="om-muted py-3 text-center text-xs font-semibold">No delay recorded up to this date.</div>;
  const rows = parties.filter((p) => p.days > 0).slice(0, 8).map((p) => ({ ...p, v: Math.round(p.days * 10) / 10 }));
  if (!rows.length) return <div className="om-muted py-3 text-center text-xs font-semibold">No delay days recorded up to this date.</div>;
  const h = rows.length * 30 + 8;
  return (
    <div style={{ height: h }} role="list" aria-label="Delay days by responsible party">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 46, bottom: 0, left: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="label" width={132} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fontWeight: 700, fill: "currentColor" }} tickFormatter={(v: string) => (v.length > 19 ? `${v.slice(0, 18)}…` : v)} />
          <RBar dataKey="v" radius={[0, 8, 8, 0]} isAnimationActive={false} cursor="pointer" onClick={(d) => onHighlight(highlight === (d as unknown as Party).key ? null : (d as unknown as Party).key)}>
            {rows.map((r) => <Cell key={r.key} fill={RESP_COLOR[r.resp]} fillOpacity={highlight && highlight !== r.key ? 0.25 : 1} stroke={highlight === r.key ? "var(--om-fg)" : "none"} strokeWidth={2} />)}
            <LabelList dataKey="v" position="right" formatter={(v: unknown) => `${v} d`} style={{ fontSize: 11, fontWeight: 800, fill: "currentColor", whiteSpace: "nowrap" }} />
          </RBar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- drawer */

export default function ProjectDrawer({ project, data, segs, derived, parties, highlight, onHighlight, colorOf, selectedKey, onSelectSeg, onClose, bare, onPickSub, client }: {
  project: OpsProject; data: OpsMapData; segs: OpsSegment[]; derived: Derived; parties: Party[]; highlight: string | null; onHighlight: (k: string | null) => void;
  colorOf: (s: OpsSegment) => string; selectedKey: string | null; onSelectSeg: (k: string) => void; onClose: () => void; bare?: boolean; onPickSub: (subId: number) => void; client?: ClientMode;
}) {
  const d = derived.proj.get(project.id)!;
  const rc = RAG_COLOR[d.rag];
  const hl = highlight ? new Set(parties.find((p) => p.key === highlight)?.segKeys ?? []) : null;
  const issues: OpsIssue[] = data.issues.filter((i) => i.projectId === project.id && i.status !== "closed" && i.raisedOn && i.raisedOn <= derived.asOf && (!i.resolvedOn || i.resolvedOn > derived.asOf)).sort((a, b) => b.impactDays - a.impactDays);

  // scorecard grouped by subcontractor
  const bySub = new Map<string, { name: string; id: number | null; segs: OpsSegment[] }>();
  for (const s of segs) { const k = String(s.sub?.id ?? "self"); const x = bySub.get(k) ?? { name: s.sub?.name ?? "Self-performed", id: s.sub?.id ?? null, segs: [] }; x.segs.push(s); bySub.set(k, x); }
  const score = [...bySub.values()].map((g) => {
    const ds = g.segs.map((s) => derived.seg.get(s.key)!);
    const w = g.segs.reduce((a, s) => a + s.weight, 0) || 1;
    const act = g.segs.reduce((a, s, i) => a + s.weight * ds[i].actualPct, 0) / w;
    const pl = g.segs.reduce((a, s, i) => a + s.weight * ds[i].plannedPct, 0) / w;
    const slip = Math.max(...ds.map((x) => (x.status === "completed" || x.status === "not_started" ? 0 : x.slipDays)));
    const stale = ds.reduce<number | null>((a, x) => (x.staleDays === null ? a : a === null ? x.staleDays : Math.min(a, x.staleDays)), null);
    return { ...g, act, pl, spi: pl > 0 ? act / pl : null, slip, open: ds.reduce((a, x) => a + x.openIssues.length, 0), stale, done: ds.every((x) => x.status === "completed") };
  }).sort((a, b) => (a.spi ?? 9) - (b.spi ?? 9));

  const unit = project.unit === "sqm" ? "sqm" : (project.unit ?? "");
  const q = (v: number) => (project.unit === "sqm" ? `${(v / 10000).toFixed(1)} ha` : `${v.toFixed(1)} ${unit}`);

  return (
    <div className={`${bare ? "" : "om-glass om-slide"} flex h-full flex-col overflow-hidden`}>
      <div className="px-4 pb-3 pt-3.5" style={bare ? undefined : { borderTop: `3px solid ${rc}`, borderRadius: "16px 16px 0 0" }}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="om-muted text-[11px] font-extrabold tracking-wide">{project.code}</span><RagPill rag={d.rag} /></div>
            <h2 className="mt-1 text-[17px] font-extrabold leading-tight">{project.name}</h2>
            <div className="om-muted mt-0.5 text-[11.5px] font-semibold">{project.client ?? "—"}{project.managerName ? ` · PM ${project.managerName}` : ""}{!client && project.contractValue ? ` · ${formatMoney(project.contractValue, { compact: true })}` : ""}</div>
          </div>
          {!bare && <button type="button" className="om-btn !h-8 !w-8 !px-0" onClick={onClose} aria-label="Close project panel"><X size={15} /></button>}
        </div>
        <a href={client ? `${client.base}/projects/${project.id}` : `/projects/${project.id}`} className="mt-2 inline-flex items-center gap-1 text-[12px] font-extrabold" style={{ color: "var(--om-primary)" }}>{client ? "Open project report" : "Open project"} <ExternalLink size={12} /></a>
      </div>
      <div className="om-scroll om-line min-h-0 flex-1 divide-y border-t" style={{ borderColor: "var(--om-border)" }}>
        <Section title={derived.forecast ? "Completion forecast" : "Completion forecast"}>
          <div className="flex items-center gap-4">
            <Ring actual={d.actualPct} planned={d.plannedPct} color={rc === "#94A3B8" ? "#635BFF" : rc} />
            <div className="min-w-0 flex-1 space-y-2">
              <div><div className="om-h">Planned finish</div><div className="om-num text-[14px] font-extrabold">{shortDate(project.endDate)}</div></div>
              <div><div className="om-h">Projected finish</div><div className="om-num text-[14px] font-extrabold">{shortDate(d.projectedFinish)}</div></div>
              <div className="inline-flex items-center rounded-lg px-2 py-1 text-[12.5px] font-extrabold" style={{ background: `${slipColor(d.delayDays)}22`, color: slipColor(d.delayDays) }}>{d.delayDays > 0 ? `${d.delayDays} days late` : "On plan"}</div>
            </div>
          </div>
          <div className={`mt-3 grid ${client ? "grid-cols-3" : "grid-cols-4"} gap-1.5 text-center`}>
            {([["SPI", d.spi], ["CPI", d.cpi]] as const).filter(([l]) => !client || l !== "CPI").map(([l, v]) => (
              <div key={l} className="om-soft rounded-xl py-1.5"><div className="om-h">{l}</div><div className="om-num text-[14px] font-extrabold" style={{ color: v === null ? undefined : v >= 0.95 ? "#22C55E" : v >= 0.85 ? "#F59E0B" : "#EF4444" }}>{v === null ? "—" : v.toFixed(2)}</div></div>
            ))}
            <div className="om-soft rounded-xl py-1.5"><div className="om-h">Done</div><div className="om-num text-[12px] font-extrabold">{project.totalQty ? q(d.completedQty) : "—"}</div></div>
            <div className="om-soft rounded-xl py-1.5"><div className="om-h">Behind</div><div className="om-num text-[12px] font-extrabold" style={{ color: d.behindQty > 0.01 ? "#EF4444" : "#22C55E" }}>{project.totalQty ? q(d.behindQty) : "—"}</div></div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1">
            {(Object.keys(d.counts) as SegStatus[]).filter((k) => d.counts[k] > 0).map((k) => <span key={k} className="om-chip"><Dot c={STATUS_COLOR[k]} size={6} />{d.counts[k]} {STATUS_LABEL[k].toLowerCase()}</span>)}
          </div>
        </Section>

        <Section title="Line of balance" right={<span className="om-muted text-[10px] font-bold">planned · actual · projected</span>}>
          <LineOfBalance segs={segs} derived={derived} project={project} colorOf={colorOf} selectedKey={selectedKey} onSelect={onSelectSeg} dimKeys={hl} />
        </Section>

        <Section title="Who's causing the delay?" right={highlight ? <button type="button" className="text-[11px] font-extrabold" style={{ color: "var(--om-primary)" }} onClick={() => onHighlight(null)}>Clear highlight</button> : <span className="om-muted text-[10px] font-bold">click a bar</span>}>
          <DelayChart parties={parties} highlight={highlight} onHighlight={onHighlight} />
        </Section>

        <Section title={client ? "Contractor progress" : "Subcontractor scorecard"}>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-[11px] font-semibold">
              <thead><tr className="om-muted text-left text-[9.5px] font-extrabold uppercase tracking-wide"><th className="px-1 pb-1">Sub</th><th className="px-1 pb-1 text-right">Seg</th><th className="px-1 pb-1 text-right">Done</th><th className="px-1 pb-1 text-right">SPI</th><th className="px-1 pb-1 text-right">Slip</th><th className="px-1 pb-1 text-right">Iss</th><th className="px-1 pb-1 text-right">Rep</th></tr></thead>
              <tbody>
                {score.map((r) => (
                  <tr key={r.name} className="om-line cursor-pointer border-t hover:bg-white/5" onClick={() => r.id !== null && onPickSub(r.id)}>
                    <td className="max-w-[120px] truncate px-1 py-1.5 font-extrabold">{r.name}</td>
                    <td className="om-num px-1 text-right">{r.segs.length}</td>
                    <td className="om-num px-1 text-right">{r.act.toFixed(0)}%</td>
                    <td className="om-num px-1 text-right font-extrabold" style={{ color: r.spi === null ? undefined : r.spi >= 0.95 ? "#22C55E" : r.spi >= 0.85 ? "#F59E0B" : "#EF4444" }}>{r.spi === null ? "—" : r.spi.toFixed(2)}</td>
                    <td className="om-num px-1 text-right font-extrabold" style={{ color: slipColor(r.slip) }}>{r.done ? "—" : r.slip > 0 ? `+${r.slip}d` : "0"}</td>
                    <td className="om-num px-1 text-right">{r.open || "–"}</td>
                    <td className="om-num px-1 text-right font-extrabold" style={{ color: r.stale === null ? "var(--om-muted)" : r.stale > 14 ? "#EF4444" : r.stale > 10 ? "#F59E0B" : undefined }}>{r.stale === null ? "–" : `${r.stale}d`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`Open issues (${issues.length})`}>
          {issues.length === 0 ? <div className="om-muted text-xs font-semibold">No open issues at this date.</div> : (
            <div className="space-y-2">{issues.slice(0, 5).map((i) => (
              <div key={i.id} className="flex items-start gap-2">
                <span className="om-chip mt-0.5 shrink-0" style={{ background: `${RESP_COLOR[i.resp]}22`, color: RESP_COLOR[i.resp] }}>{RESP_LABEL[i.resp]}</span>
                <div className="min-w-0 flex-1 text-[12px] font-bold leading-snug">{i.title}<div className="om-muted text-[10.5px] font-semibold">Raised {shortDate(i.raisedOn)}{i.impactDays ? ` · ${i.impactDays} d impact` : ""}{!client && i.impactCost ? ` · ${formatMoney(i.impactCost, { compact: true })}` : ""}</div></div>
              </div>
            ))}</div>
          )}
        </Section>
        <div className="h-3" />
      </div>
    </div>
  );
}
