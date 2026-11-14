import type { ReactNode } from "react";
import { cn } from "./cn";

type StatTone = "default" | "good" | "warn" | "bad";
/** KPI tile. `hint` is small grey text under the value. */
export function Stat({ label, value, hint, tone = "default", icon, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: StatTone; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-white p-4 shadow-card", className)}>
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted">
        <span>{label}</span>{icon && <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary-50 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      </div>
      <div className={cn("mt-1.5 text-[22px] font-extrabold tabular-nums",
        tone === "good" && "text-green-600", tone === "warn" && "text-amber-600", tone === "bad" && "text-red-600", tone === "default" && "text-dark")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
