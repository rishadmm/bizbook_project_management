"use client";
import { ChevronDown, ChevronUp } from "lucide-react";
import { RESP_COLOR, RESP_LABEL, SELF_COLOR, STATUS_COLOR, STATUS_LABEL, SUB_PALETTE } from "../calc";
import type { ColorMode, SegStatus } from "../types";

export const subColor = (subs: { id: number }[], id: number | null) => {
  if (id === null) return SELF_COLOR;
  const i = subs.findIndex((s) => s.id === id);
  return SUB_PALETTE[(i < 0 ? 0 : i) % SUB_PALETTE.length];
};

const Sw = ({ c, label }: { c: string; label: string }) => <div className="flex items-center gap-2 text-[11px] font-semibold"><span className="h-2 w-5 shrink-0 rounded-full" style={{ background: c }} />{label}</div>;

export default function Legend({ mode, subs, usedSubs, forecast, open, onToggle }: { mode: ColorMode; subs: { id: number; name: string }[]; usedSubs: Set<number>; forecast: boolean; open: boolean; onToggle: () => void }) {
  const stat = (["on_track", "at_risk", "behind", "completed", "not_started", "suspended"] as SegStatus[]).map((s) => <Sw key={s} c={STATUS_COLOR[s]} label={STATUS_LABEL[s]} />);
  return (
    <div className="om-glass om-pop p-3" style={{ width: open ? 232 : 118 }}>
      <button type="button" className="mb-1 flex w-full items-center justify-between" onClick={onToggle} aria-expanded={open}>
        <span className="om-h">Legend</span>{open ? <ChevronDown size={14} className="om-muted" /> : <ChevronUp size={14} className="om-muted" />}
      </button>
      {open && (
        <div className="space-y-2.5">
          <div className="grid gap-1">
            {mode === "health" && stat}
            {mode === "sub" && <>{subs.filter((s) => usedSubs.has(s.id)).map((s) => <Sw key={s.id} c={subColor(subs, s.id)} label={s.name} />)}<Sw c={SELF_COLOR} label="Self-performed" /></>}
            {mode === "cause" && (["subcontractor", "company", "client", "authority", "weather", "utility_clash", "other", "none"] as const).map((r) => <Sw key={r} c={RESP_COLOR[r]} label={r === "none" ? "No recorded delay" : RESP_LABEL[r]} />)}
            {mode === "cost" && <><Sw c="#22C55E" label="CPI ≥ 0.98 (earned ≥ certified)" /><Sw c="#F59E0B" label="CPI 0.90 – 0.98" /><Sw c="#EF4444" label="CPI < 0.90 (over-certified)" /><Sw c="#94A3B8" label="No certified invoices" /></>}
            {mode === "stale" && <><Sw c="#22C55E" label="Reported ≤ 3 days ago" /><Sw c="#84CC16" label="4 – 7 days" /><Sw c="#F59E0B" label="8 – 14 days" /><Sw c="#EF4444" label="> 14 days stale" /><Sw c="#94A3B8" label="No report yet" /></>}
          </div>
          <div className="om-line border-t pt-2">
            <div className="grid gap-1.5 text-[11px] font-semibold">
              <div className="flex items-center gap-2"><span className="relative inline-block h-3 w-5"><i className="absolute left-1/2 top-0 h-3 w-[3px] -translate-x-1/2 rounded-sm" style={{ background: "var(--om-plan)" }} /></span>Planned position today</div>
              <div className="flex items-center gap-2"><span className="inline-flex w-5 justify-center"><span className="h-3 w-3 rounded-full border-2 border-white" style={{ background: "#635BFF", boxShadow: "0 1px 4px rgba(0,0,0,.4)" }} /></span>Actual work front</div>
              <div className="flex items-center gap-2"><span className="h-2.5 w-5 shrink-0" style={{ background: "repeating-linear-gradient(90deg,#EF4444 0 2px,transparent 2px 5px)" }} />Behind-plan band</div>
              <div className="flex items-center gap-2"><span className="h-2.5 w-5 shrink-0" style={{ background: "repeating-linear-gradient(90deg,#22C55E 0 2px,transparent 2px 5px)" }} />Ahead-of-plan band</div>
              <div className="flex items-center gap-2"><span className="h-[3px] w-5 shrink-0 rounded-full" style={{ background: "repeating-linear-gradient(90deg,#fff 0 3px,#635BFF 3px 13px)", boxShadow: "0 0 0 1px #635BFF" }} />Crew reported in last 7 d</div>
              {forecast && <div className="flex items-center gap-2"><span className="h-[3px] w-5 shrink-0" style={{ background: "repeating-linear-gradient(90deg,#635BFF 0 5px,transparent 5px 9px)" }} />Forecast (extrapolated)</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
