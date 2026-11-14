"use client";
import type { ReactNode } from "react";
import { addDays, daysBetween } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABEL } from "../calc";
import type { Rag, SegStatus } from "../types";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "13 Nov 26" */
export function shortDate(iso: string | null | undefined, year = true): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]}${year ? ` ${String(y).slice(2)}` : ""}`;
}
export const slipText = (d: number) => (d > 0 ? `+${d} d` : d < 0 ? `−${Math.abs(d)} d` : "on plan");
export const slipColor = (d: number) => (d > 14 ? "#EF4444" : d > 0 ? "#F59E0B" : "#22C55E");
export const RAG_COLOR: Record<Rag, string> = { green: "#22C55E", amber: "#F59E0B", red: "#EF4444", grey: "#94A3B8" };
export const RAG_TEXT: Record<Rag, string> = { green: "On track", amber: "At risk", red: "Critical", grey: "No data" };
export { addDays, daysBetween };

export function Dot({ c, size = 8 }: { c: string; size?: number }) {
  return <span style={{ width: size, height: size, background: c }} className="inline-block shrink-0 rounded-full" />;
}

export function RagPill({ rag }: { rag: Rag }) {
  const c = RAG_COLOR[rag];
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: `${c}22`, color: c }}><Dot c={c} size={6} />{RAG_TEXT[rag]}</span>;
}
export function StatusPill({ s }: { s: SegStatus }) {
  const c = STATUS_COLOR[s];
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: `${c}22`, color: s === "not_started" || s === "suspended" ? "var(--om-muted)" : c }}><Dot c={c} size={6} />{STATUS_LABEL[s]}</span>;
}

/** Progress bar: actual fill + planned tick. */
export function Bar({ actual, planned, color, h = 6 }: { actual: number; planned?: number; color: string; h?: number }) {
  return (
    <div className="om-track relative w-full rounded-full" style={{ height: h }}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, actual))}%`, background: color }} />
      {planned !== undefined && <div className="absolute rounded-sm" style={{ left: `calc(${Math.min(100, planned)}% - 1px)`, top: -2, width: 2.5, height: h + 4, background: "var(--om-plan)" }} />}
    </div>
  );
}

export function Sparkline({ values, color = "#635BFF", w = 84, h = 26 }: { values: number[]; color?: string; w?: number; h?: number }) {
  const max = Math.max(1, ...values);
  const bw = w / values.length;
  return (
    <svg width={w} height={h} role="img" aria-label={`Manpower last ${values.length} weeks: ${values.join(", ")}`}>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * (h - 2));
        return <rect key={i} x={i * bw + 2} y={h - bh} width={bw - 4} height={bh} rx={2} fill={color} opacity={0.35 + (0.65 * (i + 1)) / values.length} />;
      })}
    </svg>
  );
}

/** Big ring: actual arc with planned arc overlay (thin, outer). */
export function Ring({ actual, planned, color, size = 112 }: { actual: number; planned: number; color: string; size?: number }) {
  const sw = 11, r = (size - sw) / 2 - 5, c = 2 * Math.PI * r;
  const r2 = r + 9, c2 = 2 * Math.PI * r2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Actual ${actual.toFixed(0)} percent, planned ${planned.toFixed(0)} percent`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--om-track)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${(c * Math.min(100, actual)) / 100} ${c}`} style={{ transition: "stroke-dasharray .4s" }} />
        <circle cx={size / 2} cy={size / 2} r={r2} fill="none" stroke="var(--om-plan)" strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${(c2 * Math.min(100, planned)) / 100} ${c2}`} />
      </g>
      <text x="50%" y="48%" textAnchor="middle" fontSize={size * 0.22} fontWeight={800} fill="var(--om-fg)" className="om-num">{actual.toFixed(0)}%</text>
      <text x="50%" y="63%" textAnchor="middle" fontSize={size * 0.1} fontWeight={700} fill="var(--om-muted)">plan {planned.toFixed(0)}%</text>
    </svg>
  );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`px-4 py-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="om-h">{title}</h3>{right}</div>
      {children}
    </section>
  );
}
