"use client";
import { Activity, AlertTriangle, CheckCircle2, Gauge, Route, TimerReset, TrendingDown } from "lucide-react";
import type { ReactNode } from "react";
import type { Kpis } from "../types";
import { slipColor } from "./bits";

export type Emphasis = null | "completed" | "lag" | "risk";

function Tile({ icon, label, value, sub, color, pressed, onClick, title }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; color?: string; pressed?: boolean; onClick?: () => void; title?: string }) {
  return (
    <button type="button" className="om-tile" aria-pressed={pressed} onClick={onClick} title={title}>
      <div className="l flex items-center gap-1.5"><span style={{ color: color ?? "var(--om-primary)" }}>{icon}</span>{label}</div>
      <div className="v" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="l" style={{ fontWeight: 600 }}>{sub}</div>}
    </button>
  );
}

const km = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
const idx = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const idxColor = (v: number | null) => (v === null ? undefined : v >= 0.95 ? "#22C55E" : v >= 0.85 ? "#F59E0B" : "#EF4444");

export default function KpiStrip({ k, emphasis, setEmphasis, onWorst, hideCost }: { k: Kpis; emphasis: Emphasis; setEmphasis: (e: Emphasis) => void; onWorst: () => void; hideCost?: boolean }) {
  const tog = (e: Emphasis) => setEmphasis(emphasis === e ? null : e);
  return (
    <div className="om-glass om-hscroll flex items-stretch gap-0.5 p-1.5" role="group" aria-label="Portfolio KPIs">
      <Tile icon={<Activity size={12} />} label="Active projects" value={k.activeProjects} sub={`${k.segments} segments`} onClick={() => setEmphasis(null)} title="Clear emphasis" />
      <Tile icon={<Route size={12} />} label="Total length" value={<>{km(k.totalKm)}<small className="om-muted ml-0.5 text-[11px] font-bold">km</small></>} sub="linear works" />
      <Tile icon={<CheckCircle2 size={12} />} label="Completed" value={<>{km(k.doneKm)}<small className="om-muted ml-0.5 text-[11px] font-bold">km</small></>} sub={`${k.totalKm ? ((k.doneKm / k.totalKm) * 100).toFixed(0) : 0}% of length`} color="#8B5CF6" pressed={emphasis === "completed"} onClick={() => tog("completed")} />
      <Tile icon={<TrendingDown size={12} />} label="Behind plan" value={<>{km(k.behindKm)}<small className="om-muted ml-0.5 text-[11px] font-bold">km</small></>} sub="plan minus actual" color={k.behindKm > 0.05 ? "#EF4444" : "#22C55E"} pressed={emphasis === "lag"} onClick={() => tog("lag")} />
      <Tile icon={<AlertTriangle size={12} />} label="At risk · Behind" value={<><span style={{ color: "#F59E0B" }}>{k.atRisk}</span><span className="om-muted mx-1 font-normal">·</span><span style={{ color: "#EF4444" }}>{k.behind}</span></>} sub="segments" pressed={emphasis === "risk"} onClick={() => tog("risk")} />
      {hideCost
        ? <Tile icon={<Gauge size={12} />} label="Schedule index (SPI)" value={<span style={{ color: idxColor(k.spi) }}>{idx(k.spi)}</span>} sub="portfolio" />
        : <Tile icon={<Gauge size={12} />} label="SPI · CPI" value={<><span style={{ color: idxColor(k.spi) }}>{idx(k.spi)}</span><span className="om-muted mx-1 font-normal">·</span><span style={{ color: idxColor(k.cpi) }}>{idx(k.cpi)}</span></>} sub="portfolio" />}
      <Tile icon={<TimerReset size={12} />} label="Worst slip" value={<span style={{ color: slipColor(k.worstSlip) }}>{k.worstSlip > 0 ? `+${k.worstSlip}` : "0"}<small className="ml-0.5 text-[11px] font-bold">d</small></span>} sub={k.worstProject ?? "all on plan"} onClick={k.worstProject ? onWorst : undefined} />
    </div>
  );
}
