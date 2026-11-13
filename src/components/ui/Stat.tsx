import type { ReactNode } from "react";
import { cn } from "./cn";

type StatTone = "default" | "good" | "warn" | "bad";
/** KPI tile. `hint` is small grey text under the value. */
export function Stat({ label, value, hint, tone = "default", icon, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: StatTone; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{label}</span>{icon}
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums",
        tone === "good" && "text-emerald-600", tone === "warn" && "text-amber-600", tone === "bad" && "text-red-600", tone === "default" && "text-slate-900")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
