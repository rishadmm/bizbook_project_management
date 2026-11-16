import Link from "next/link";
import { Badge } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { daysBetween } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABEL } from "@/features/ops-map/calc";
import type { Rag, SegStatus } from "@/features/ops-map/types";
import type { CPProject } from "../data";

export const RAG_TONE: Record<Rag, "green" | "amber" | "red" | "slate"> = { green: "green", amber: "amber", red: "red", grey: "slate" };
export const RAG_LABEL: Record<Rag, string> = { green: "On track", amber: "At risk", red: "Behind", grey: "Not started" };
export const RAG_HEX: Record<Rag, string> = { green: "#22C55E", amber: "#F59E0B", red: "#EF4444", grey: "#94A3B8" };
export const RagBadge = ({ rag, label }: { rag: Rag | string; label?: string }) => <Badge tone={RAG_TONE[rag as Rag] ?? "slate"}>{label ?? RAG_LABEL[rag as Rag] ?? rag}</Badge>;
export const SegBadge = ({ status }: { status: SegStatus | null }) => status ? (
  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: `${STATUS_COLOR[status]}22`, color: status === "not_started" || status === "suspended" ? "#475569" : STATUS_COLOR[status] }}>
    <i className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />{STATUS_LABEL[status]}</span>) : <span className="text-slate-400">—</span>;

export const slipText = (d: number) => (d > 0 ? `${d} d late` : "on plan");
export const slipClass = (d: number) => (d > 14 ? "text-red-600" : d > 0 ? "text-amber-600" : "text-green-600");
export const unitLabel = (u: string | null | undefined) => (!u || u === "lumpsum" ? "" : u === "sqm" ? "m²" : u);
export const fmtQty = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 });

/** Actual vs planned bar (planned = marker). */
export function ActualPlanBar({ actual, planned, rag }: { actual: number; planned: number; rag: Rag }) {
  const a = Math.max(0, Math.min(100, actual)), p = Math.max(0, Math.min(100, planned));
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`Actual ${a.toFixed(0)} percent, planned ${p.toFixed(0)} percent`}>
      <div className="h-full rounded-full" style={{ width: `${a}%`, background: RAG_HEX[rag] === "#94A3B8" ? "#635BFF" : RAG_HEX[rag] }} />
      <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: `${p}%` }} />
    </div>
  );
}

/** Progress ring (actual, with a planned tick). */
export function Ring({ actual, planned, color = "#635BFF", size = 112 }: { actual: number; planned: number; color?: string; size?: number }) {
  const r = (size - 14) / 2, c = 2 * Math.PI * r, a = Math.max(0, Math.min(100, actual)) / 100, p = Math.max(0, Math.min(100, planned)) / 100;
  const ang = p * 2 * Math.PI - Math.PI / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${actual.toFixed(0)} percent complete, plan ${planned.toFixed(0)} percent`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={10} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${a * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {p > 0 && <line x1={size / 2 + (r - 9) * Math.cos(ang)} y1={size / 2 + (r - 9) * Math.sin(ang)} x2={size / 2 + (r + 9) * Math.cos(ang)} y2={size / 2 + (r + 9) * Math.sin(ang)} stroke="#0f172a" strokeWidth={2.5} />}
      <text x="50%" y="48%" textAnchor="middle" className="fill-dark text-[22px] font-extrabold">{actual.toFixed(0)}%</text>
      <text x="50%" y="64%" textAnchor="middle" className="fill-slate-500 text-[10px] font-bold">plan {planned.toFixed(0)}%</text>
    </svg>
  );
}

/** One project health card of the dashboard / projects list. */
export function ProjectCard({ p, base, showFin }: { p: CPProject; base: string; showFin: boolean }) {
  return (
    <Link href={`${base}/projects/${p.id}`} data-testid="project-card" data-project-code={p.code} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-card transition hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="text-[11px] font-extrabold tracking-wide text-muted">{p.code}</div><div className="truncate text-[15px] font-extrabold leading-snug text-dark">{p.name}</div>
          <div className="truncate text-xs text-slate-500">{[p.region, p.category?.replace(/_/g, " ")].filter(Boolean).join(" · ") || " "}</div></div>
        <RagBadge rag={p.rag} />
      </div>
      <div>
        <div className="mb-1 flex items-end justify-between"><span className="text-2xl font-extrabold tabular-nums text-dark">{p.actualPct.toFixed(0)}%</span><span className="text-xs font-bold text-slate-500">plan {p.plannedPct.toFixed(0)}%</span></div>
        <ActualPlanBar actual={p.actualPct} planned={p.plannedPct} rag={p.rag} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><div className="font-bold uppercase tracking-wider text-muted">Planned finish</div><div className="font-bold text-slate-700">{fmt(p.endDate)}</div></div>
        <div><div className="font-bold uppercase tracking-wider text-muted">Projected finish</div><div className="font-bold text-slate-700">{fmt(p.projectedFinish)}</div></div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className={cn("font-extrabold", slipClass(p.slipDays))}>{slipText(p.slipDays)}</span>
        {showFin && p.contractValue !== null && <span className="font-semibold text-slate-500">{money(p.contractValue)}</span>}
      </div>
    </Link>
  );
}
import { formatDate, formatMoney } from "@/lib/format";
const fmt = (d: string | null) => formatDate(d);
const money = (v: number) => formatMoney(v, { compact: true });
export { daysBetween };
