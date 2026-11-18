import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { CellState } from "../eval-core";

export const errCls = "text-sm font-semibold text-red-600";
export const CELL_TONE: Record<CellState, "green" | "red" | "amber" | "slate" | "blue"> = { pass: "green", fail: "red", pending: "slate", partial: "amber", skipped: "slate", locked: "slate", na: "slate" };
export const CELL_LABEL: Record<CellState, string> = { pass: "Pass", fail: "Fail", pending: "Pending", partial: "Partial", skipped: "n/a", locked: "Locked", na: "-" };
export function CellChip({ state, score, done, total }: { state: CellState; score: number | null; done: number; total: number }) {
  return <Badge tone={CELL_TONE[state]}>{CELL_LABEL[state]}{score !== null ? ` ${score.toFixed(1)}` : ""}{state === "partial" || (state === "pending" && total > 0) ? ` ${done}/${total}` : ""}</Badge>;
}
export function Sealed({ children }: { children?: ReactNode }) {
  return <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600" data-testid="sealed-note"><span aria-hidden>🔒</span><span>{children ?? "Sealed until the opening."}</span></div>;
}
