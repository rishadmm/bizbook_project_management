"use client";
import { Layers, Link2, Maximize2, Minimize2, Minus, Moon, Plus, RotateCcw, Satellite, Sun, Target } from "lucide-react";
import type { ColorMode } from "../types";
import type { Basemap } from "./MapCanvas";

const MODES: { key: ColorMode; label: string }[] = [
  { key: "health", label: "Health" }, { key: "sub", label: "Subcontractor" }, { key: "cause", label: "Delay cause" }, { key: "cost", label: "Cost" }, { key: "stale", label: "Staleness" },
];

export function ColorSwitch({ mode, onChange, modes }: { mode: ColorMode; onChange: (m: ColorMode) => void; modes?: ColorMode[] }) {
  return (
    <div className="om-seg om-hscroll" role="group" aria-label="Colour by">
      <span className="om-h flex items-center whitespace-nowrap px-2">Colour by</span>
      {MODES.filter((m) => !modes || modes.includes(m.key)).map((m) => <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => onChange(m.key)}>{m.label}</button>)}
    </div>
  );
}

export interface ToolProps {
  night: boolean; onNight: () => void; basemap: Basemap; onBasemap: () => void; compare: boolean; onCompare: () => void; fullscreen: boolean; onFullscreen: () => void;
  onReset: () => void; onShare: () => void; copied: boolean; onZoom: (d: 1 | -1) => void;
}
export function Tools(p: ToolProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="om-btn" aria-pressed={p.compare} onClick={p.onCompare} title="Plan vs Actual: show planned work-front markers"><Target size={14} />Plan vs Actual</button>
      <button type="button" className="om-btn" aria-pressed={p.basemap === "sat"} onClick={p.onBasemap} title="Toggle satellite imagery" aria-label="Satellite"><Satellite size={14} /></button>
      <button type="button" className="om-btn" aria-pressed={p.night} onClick={p.onNight} title="Night / TV mode" aria-label="Night mode">{p.night ? <Sun size={14} /> : <Moon size={14} />}</button>
      <button type="button" className="om-btn" onClick={p.onReset} title="Reset view" aria-label="Reset view"><RotateCcw size={14} /></button>
      <button type="button" className="om-btn" onClick={p.onShare} title="Copy share link" aria-label="Copy share link"><Link2 size={14} />{p.copied ? "Copied" : ""}</button>
      <button type="button" className="om-btn" onClick={p.onFullscreen} title="Full screen (F)" aria-label="Full screen">{p.fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}<span className="hidden 2xl:inline">{p.fullscreen ? "Exit" : "Full screen"}</span></button>
      <div className="om-glass flex flex-col overflow-hidden" style={{ borderRadius: 10 }}>
        <button type="button" className="om-btn" style={{ height: 17, borderRadius: 0, border: 0, minWidth: 34 }} onClick={() => p.onZoom(1)} aria-label="Zoom in"><Plus size={12} /></button>
        <button type="button" className="om-btn" style={{ height: 17, borderRadius: 0, border: 0, borderTop: "1px solid var(--om-border)", minWidth: 34 }} onClick={() => p.onZoom(-1)} aria-label="Zoom out"><Minus size={12} /></button>
      </div>
    </div>
  );
}
export { Layers };
