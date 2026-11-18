import Link from "next/link";
import { Download } from "lucide-react";
import { formatDate, todayISO } from "@/lib/format";
import { buttonClass } from "@/components/ui/Button";
import { PrintButton } from "./Controls";

/** Common frame of the printable reports: print header, filter controls (hidden when printing), Print / CSV buttons. */
export default function ReportFrame({ slug, title, subtitle, clientName, tenant, csvHref, controls, children }: {
  slug: string; title: string; subtitle?: string; clientName: string; /** legal name of the client's country operation */ tenant: string; csvHref: string; controls?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <article data-testid="report">
      <div className="no-print mb-1 text-xs text-slate-500"><Link href={`/c/${slug}/reports`} className="hover:text-primary">Reports</Link> / {title}</div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-dark">{title}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{[clientName, subtitle].filter(Boolean).join(" · ")}</p>
          <p className="hidden text-xs text-slate-500 print:block">Prepared by {tenant} · generated {formatDate(todayISO())} · only progress verified by the project team is included</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2"><a href={csvHref} className={buttonClass("secondary")} data-testid="csv-link"><Download size={15} />Export CSV</a><PrintButton /></div>
      </div>
      {controls && <div className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-3 shadow-card">{controls}</div>}
      <div className="space-y-5">{children}</div>
    </article>
  );
}
