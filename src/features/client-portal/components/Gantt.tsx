import { daysBetween, formatDate } from "@/lib/format";
import { STATUS_COLOR } from "@/features/ops-map/calc";
import type { StageRow } from "../data";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Mini Gantt / line of balance: planned bar, actual fill, projected overrun hatch, today marker. Pure server markup (no JS). */
export default function Gantt({ rows, today }: { rows: StageRow[]; today: string }) {
  const list = rows.filter((r) => r.plannedStart && r.plannedEnd);
  if (!list.length) return <p className="text-sm text-slate-400">No schedule data.</p>;
  let lo = list[0].plannedStart!, hi = list[0].plannedEnd!;
  for (const r of list) { if (r.plannedStart! < lo) lo = r.plannedStart!; for (const x of [r.plannedEnd!, r.projectedEnd ?? r.plannedEnd!]) if (x > hi) hi = x; }
  if (today > hi) hi = today;
  if (today < lo) lo = today;
  const span = Math.max(1, daysBetween(lo, hi));
  const pos = (d: string) => Math.max(0, Math.min(100, (daysBetween(lo, d) / span) * 100));
  const wid = (a: string, b: string) => Math.max(0.5, (daysBetween(a, b) / span) * 100);
  // month ticks
  const ticks: { d: string; label: string }[] = [];
  const first = new Date(`${lo}T00:00:00Z`);
  for (let y = first.getUTCFullYear(), m = first.getUTCMonth() + 1; ; m++) {
    const d = new Date(Date.UTC(y, m, 1)); const iso = d.toISOString().slice(0, 10);
    if (iso > hi) break;
    ticks.push({ d: iso, label: `${MON[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}` });
    if (ticks.length > 60) break;
  }
  const step = Math.ceil(ticks.length / 12) || 1;
  return (
    <div data-testid="gantt" role="img" aria-label="Schedule chart: planned, actual and projected">
      <div className="grid grid-cols-[120px_1fr] gap-x-3 sm:grid-cols-[170px_1fr]">
        <div />
        <div className="relative mb-1 h-4 text-[10px] font-bold text-muted">{ticks.map((t, i) => i % step === 0 && <span key={t.d} className="absolute -translate-x-1/2" style={{ left: `${pos(t.d)}%` }}>{t.label}</span>)}<span className="absolute -translate-x-1/2 rounded bg-primary px-1 text-[9px] font-extrabold text-white" style={{ left: `${pos(today)}%` }}>today</span></div>
        {list.map((r) => {
          const over = r.projectedEnd && r.plannedEnd && r.projectedEnd > r.plannedEnd && r.actualPct < 99.5;
          const color = r.segStatus ? STATUS_COLOR[r.segStatus] : "#635BFF";
          return (
            <div key={r.id} className="contents">
              <div className="truncate py-1.5 text-xs font-bold text-slate-700" title={r.name}><span className="mr-1 text-muted">{r.code}</span>{r.name}</div>
              <div className="relative h-8 border-t border-slate-100">
                {ticks.map((t, i) => i % step === 0 && <span key={t.d} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: `${pos(t.d)}%` }} />)}
                <span className="absolute inset-y-0 w-px bg-primary/70" style={{ left: `${pos(today)}%` }} />
                <div className="absolute top-2.5 h-3 rounded-full bg-slate-200" style={{ left: `${pos(r.plannedStart!)}%`, width: `${wid(r.plannedStart!, r.plannedEnd!)}%` }} title={`Planned ${formatDate(r.plannedStart)} – ${formatDate(r.plannedEnd)}`} />
                <div className="absolute top-2.5 h-3 rounded-full" style={{ left: `${pos(r.plannedStart!)}%`, width: `${wid(r.plannedStart!, r.plannedEnd!) * Math.min(100, r.actualPct) / 100}%`, background: color }} title={`Actual ${r.actualPct.toFixed(0)}%`} />
                {over && <div className="absolute top-2.5 h-3 rounded-r-full" title={`Projected end ${formatDate(r.projectedEnd)}`} style={{ left: `${pos(r.plannedEnd!)}%`, width: `${wid(r.plannedEnd!, r.projectedEnd!)}%`, background: "repeating-linear-gradient(135deg,#EF4444 0 3px,rgba(239,68,68,.25) 3px 6px)" }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] font-semibold text-slate-500">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-5 rounded-full bg-slate-200" />Planned</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-5 rounded-full bg-primary" />Actual (verified)</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-5 rounded-full" style={{ background: "repeating-linear-gradient(135deg,#EF4444 0 3px,rgba(239,68,68,.25) 3px 6px)" }} />Projected overrun</span>
      </div>
    </div>
  );
}
