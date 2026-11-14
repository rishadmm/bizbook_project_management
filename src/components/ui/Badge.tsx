import type { ReactNode } from "react";
import { cn } from "./cn";
import { TONE_CLASSES, TONE_DOT, statusBadgeClass, statusLabel, statusTone, type EnumKind, type Tone } from "@/lib/status";

const base = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset";
/** Generic soft pill with a status dot; `tone` from lib/status Tone. */
export function Badge({ tone = "slate", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn(base, TONE_CLASSES[tone], className)}><span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />{children}</span>;
}
/** <StatusBadge kind="tenderStatus" value={t.status} /> — label + colour from lib/status. */
export function StatusBadge({ kind, value, className }: { kind: EnumKind; value: string | null | undefined; className?: string }) {
  return <span className={cn(base, statusBadgeClass(kind, value), className)}><span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[statusTone(kind, value)])} />{statusLabel(kind, value)}</span>;
}
