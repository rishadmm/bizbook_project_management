import type { ReactNode } from "react";
import { Badge, StatusBadge } from "@/components/ui";
import { formatRatio } from "@/lib/format";
import type { RagStatus } from "@/lib/types";

export const RagChip = ({ rag }: { rag: RagStatus }) => <StatusBadge kind="rag" value={rag} />;

/** SPI / CPI chip coloured by RAG thresholds (>=0.95 green, >=0.85 amber, else red). */
export function IndexChip({ label, value }: { label: string; value: number | null }) {
  const tone = value === null ? "slate" : value >= 0.95 ? "green" : value >= 0.85 ? "amber" : "red";
  return <Badge tone={tone}>{label} {formatRatio(value)}</Badge>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h4>;
}

export const Muted = ({ children }: { children: ReactNode }) => <span className="text-slate-400">{children}</span>;

export function opt<T extends { id: number }>(rows: T[], label: (r: T) => string): { value: number; label: string }[] {
  return rows.map((r) => ({ value: r.id, label: label(r) }));
}

export function varianceClass(v: number): string {
  return v < 0 ? "text-red-600" : v > 0 ? "text-emerald-600" : "text-slate-500";
}
