"use client";
import { ChevronLeft, ChevronRight, History, Pause, Play, Sparkles } from "lucide-react";
import { addDays, daysBetween, shortDate } from "./bits";

export interface TMProps {
  date: string; min: string; max: string; today: string; playing: boolean; speed: 1 | 2 | 4; compact?: boolean; attribution?: string;
  onDate: (d: string) => void; onPlay: () => void; onSpeed: (s: 1 | 2 | 4) => void;
}

export default function TimeMachine({ date, min, max, today, playing, speed, compact, attribution, onDate, onPlay, onSpeed }: TMProps) {
  const total = Math.max(1, daysBetween(min, max));
  const pos = daysBetween(min, date);
  const todayPct = Math.min(100, Math.max(0, (daysBetween(min, today) / total) * 100));
  const mode = date < today ? "replay" : date > today ? "forecast" : "live";
  const mc = mode === "live" ? "#22C55E" : mode === "replay" ? "#F59E0B" : "#635BFF";
  return (
    <div className="om-glass om-pop px-3 pb-2.5 pt-2" role="group" aria-label="Time machine">
      <div className="flex items-center gap-2">
        <button type="button" className="om-btn !h-9 !w-9 !px-0" aria-pressed={playing} onClick={onPlay} aria-label={playing ? "Pause" : "Play replay"} title="Play / pause (Space)">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        {!compact && <button type="button" className="om-btn !h-9 !px-1.5" onClick={() => onDate(addDays(date, -7) < min ? min : addDays(date, -7))} aria-label="Back one week" title="Back 1 week (←)"><ChevronLeft size={15} /></button>}
        {!compact && <button type="button" className="om-btn !h-9 !px-1.5" onClick={() => onDate(addDays(date, 7) > max ? max : addDays(date, 7))} aria-label="Forward one week" title="Forward 1 week (→)"><ChevronRight size={15} /></button>}
        <div className="mx-1 min-w-0 flex-1">
          <div className="om-num whitespace-nowrap text-[15px] font-extrabold leading-tight">{shortDate(date)}</div>
          <div className="flex items-center gap-1 whitespace-nowrap text-[10.5px] font-extrabold" style={{ color: mc }}>
            {mode === "live" ? <><span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />LIVE · TODAY</> : mode === "replay" ? <><History size={11} />TIME MACHINE · REPLAY</> : <><Sparkles size={11} />FORECAST MODE</>}
          </div>
        </div>
        {!compact && <div className="om-seg !p-0.5" role="group" aria-label="Speed">
          {([1, 2, 4] as const).map((s) => <button key={s} type="button" aria-pressed={speed === s} style={{ padding: "4px 8px" }} onClick={() => onSpeed(s)}>{s}×</button>)}
        </div>}
        <button type="button" className="om-btn !h-9" onClick={() => onDate(today)} disabled={date === today} style={date === today ? { opacity: 0.45 } : undefined}>Today</button>
      </div>
      <div className="relative mt-1 pt-3.5">
        <span className="om-muted absolute left-0 top-0 text-[9.5px] font-bold">{shortDate(min)}</span>
        <span className="om-muted absolute right-0 top-0 text-[9.5px] font-bold">{shortDate(max)}</span>
        <span className="absolute top-0 -translate-x-1/2 text-[9.5px] font-extrabold" style={{ left: `${todayPct}%`, color: "#22C55E", display: todayPct > 12 && todayPct < 88 ? "block" : "none" }}>today</span>
        <input type="range" className="om-range" min={0} max={total} value={Math.min(total, Math.max(0, pos))} aria-label="Date" aria-valuetext={shortDate(date)}
          style={{ background: `linear-gradient(90deg, rgba(99,91,255,.55) 0 ${todayPct}%, transparent ${todayPct}% 100%), var(--om-track)` }}
          onChange={(e) => onDate(addDays(min, Number(e.target.value)))} />
        <span className="pointer-events-none absolute bottom-[-2px] h-[10px] w-[2px] rounded" style={{ left: `${todayPct}%`, background: "#22C55E" }} />
      </div>
      {compact && attribution && <div className="om-muted mt-1 text-[9px] font-semibold">{attribution} · Leaflet</div>}
    </div>
  );
}
