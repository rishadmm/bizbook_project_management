import { cn } from "./cn";
/** Progress bar. `value` 0-100; optional `planned` draws a tick marker. tone auto: blue; pass for RAG colouring. */
export function ProgressBar({ value, planned, tone = "blue", showLabel, className }: { value: number; planned?: number | null; tone?: "blue" | "green" | "amber" | "red" | "slate"; showLabel?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const color = { blue: "bg-primary", green: "bg-success", amber: "bg-amber-500", red: "bg-red-500", slate: "bg-slate-400" }[tone];
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${v}%` }} />
        {planned !== undefined && planned !== null && <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: `${Math.max(0, Math.min(100, planned))}%` }} title={`Planned ${planned.toFixed(0)}%`} />}
      </div>
      {showLabel && <span className="w-10 text-right text-xs tabular-nums text-slate-600">{v.toFixed(0)}%</span>}
    </div>
  );
}
