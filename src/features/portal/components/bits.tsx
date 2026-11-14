import Link from "next/link";
import { AlertTriangle, CalendarClock, FileWarning, MessageSquareWarning, RotateCcw, XCircle, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import type { ActionItem } from "../data";
import type { Rag } from "../ops";

export const RAG_TONE: Record<Rag, "green" | "amber" | "red" | "slate"> = { green: "green", amber: "amber", red: "red", grey: "slate" };
export const RagBadge = ({ rag, label }: { rag: Rag; label?: string }) => <Badge tone={RAG_TONE[rag]}>{label ?? { green: "On track", amber: "At risk", red: "Behind", grey: "No data" }[rag]}</Badge>;

const ICON: Record<ActionItem["type"], LucideIcon> = { report_due: CalendarClock, report_rejected: RotateCcw, invoice_returned: XCircle, doc_expiry: FileWarning, issue_response: MessageSquareWarning };
const TONE: Record<ActionItem["type"], string> = { report_due: "bg-amber-50 text-amber-700", report_rejected: "bg-red-50 text-red-700", invoice_returned: "bg-red-50 text-red-700", doc_expiry: "bg-amber-50 text-amber-700", issue_response: "bg-violet-50 text-violet-700" };

export function ActionList({ items }: { items: ActionItem[] }) {
  if (items.length === 0) return <p className="flex items-center gap-2 text-sm text-slate-500"><AlertTriangle size={15} className="text-green-500" />Nothing needs your attention right now.</p>;
  return (
    <ul className="divide-y divide-slate-100" data-testid="action-items">
      {items.map((a) => {
        const Icon = ICON[a.type];
        return (
          <li key={a.key} data-action-type={a.type}>
            <Link href={a.href} className="flex items-start gap-3 py-2.5 hover:bg-[#f8fafc]">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]", TONE[a.type])}><Icon size={15} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-dark">{a.title}</span><span className="block truncate text-xs text-slate-500">{a.detail}</span></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export const Flash = ({ ok, error }: { ok?: string; error?: string }) => (
  <>
    {ok && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{ok}</p>}
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
  </>
);
export const ReadOnlyNote = () => <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Read-only admin view: submitting is disabled.</p>;
