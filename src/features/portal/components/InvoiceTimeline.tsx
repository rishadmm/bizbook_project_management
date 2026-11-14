import { Check, X } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { formatDate } from "@/lib/format";
import type { SubInvoice } from "@/lib/types";

const STEPS: { key: string; label: string; rank: number }[] = [
  { key: "submitted", label: "Submitted", rank: 0 }, { key: "under_review", label: "Under review", rank: 1 }, { key: "certified", label: "Certified", rank: 2 },
  { key: "approved", label: "Approved", rank: 3 }, { key: "paid", label: "Paid", rank: 4 },
];
const RANK: Record<string, number> = { submitted: 0, under_review: 1, certified: 2, approved: 3, paid: 4 };

/** Status chips: Submitted -> Under review -> Certified -> Approved -> Paid; a rejected invoice shows a red end chip with the reason. */
export default function InvoiceTimeline({ inv, rejectReason, compact }: { inv: Pick<SubInvoice, "status" | "submitted_at" | "invoice_date" | "certified_at" | "paid_date" | "notes">; rejectReason?: string | null; compact?: boolean }) {
  const rejected = inv.status === "rejected";
  const at = rejected ? -1 : RANK[inv.status] ?? 0;
  const dates: Record<string, string | null> = { submitted: inv.submitted_at ?? inv.invoice_date, certified: inv.certified_at, paid: inv.paid_date };
  return (
    <div data-testid="invoice-timeline" data-status={inv.status}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((s) => {
          const done = !rejected && s.rank <= at, current = !rejected && s.rank === at;
          return (
            <li key={s.key} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset",
              current ? "bg-primary text-white ring-primary" : done ? "bg-green-50 text-green-700 ring-green-200" : "bg-slate-50 text-slate-400 ring-slate-200")}>
              {done && !current && <Check size={11} strokeWidth={3} />}{s.label}{!compact && dates[s.key] && done ? <span className="font-medium opacity-75"> · {formatDate(dates[s.key])}</span> : null}
            </li>
          );
        })}
        {rejected && <li className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700 ring-1 ring-inset ring-red-200"><X size={11} strokeWidth={3} />Rejected</li>}
      </ol>
      {rejected && rejectReason && !compact && <p className="mt-2 text-sm font-semibold text-red-700">{rejectReason}</p>}
    </div>
  );
}
export const rejectReasonOf = (notes: string | null | undefined): string | null => notes?.split("\n").reverse().find((l) => l.startsWith("Rejected:"))?.replace(/^Rejected:\s*/, "") || null;
