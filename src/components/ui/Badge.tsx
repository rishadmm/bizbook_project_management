import type { ReactNode } from "react";
import { cn } from "./cn";
import { TONE_CLASSES, statusBadgeClass, statusLabel, type EnumKind, type Tone } from "@/lib/status";

/** Generic pill; `tone` from lib/status Tone. */
export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE_CLASSES[tone], className)}>{children}</span>;
}
/** <StatusBadge kind="tenderStatus" value={t.status} /> — label + colour from lib/status. */
export function StatusBadge({ kind, value, className }: { kind: EnumKind; value: string | null | undefined; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", statusBadgeClass(kind, value), className)}>{statusLabel(kind, value)}</span>;
}
