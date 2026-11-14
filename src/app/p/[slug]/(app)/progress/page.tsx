import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, CardSection, EmptyState, LinkButton, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatDate, formatNumber, pct } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { listReports } from "@/features/portal/data";
import { Flash } from "@/features/portal/components/bits";

export const metadata = { title: "Progress updates" };
const SENT: Record<string, string> = { submitted: "Progress update submitted. The project team will verify it.", resubmitted: "Corrected report resubmitted for verification." };

export default async function PortalProgress({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "progress");
  const reports = listReports(s);
  return (
    <>
      <PageHeader title="Progress updates" description="Site progress you reported. Only verified reports count towards progress."
        actions={portalCan(s.user.role, "progress_submit") ? <LinkButton href={`/p/${slug}/progress/new`} variant="primary"><Plus size={15} />New update</LinkButton> : undefined} />
      <Flash ok={sp.sent ? SENT[sp.sent] : undefined} />
      <CardSection flush>
        {reports.length === 0 ? <div className="p-4"><EmptyState title="No progress updates yet" /></div> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Subcontract</TH><TH num>Qty this period</TH><TH num>%</TH><TH>Status</TH><TH>Submitted by</TH></TR></THead>
            <TBody>
              {reports.map((r) => (
                <TR key={r.id} data-testid="report-row" className={r.status === "rejected" ? "bg-red-50/40" : ""}>
                  <TD className="whitespace-nowrap"><Link href={`/p/${slug}/progress/${r.id}`} className="font-bold text-primary-dark hover:underline">{formatDate(r.report_date)}</Link></TD>
                  <TD>{r.assignment_code} <span className="text-xs text-slate-400">{r.project_code}</span></TD>
                  <TD num>{formatNumber(r.quantity_done, 2)} {r.unit ?? ""}</TD>
                  <TD num>{pct(r.percent_complete, 0)}</TD>
                  <TD><StatusBadge kind="progressStatus" value={r.status} />{r.status === "rejected" && <div className="mt-1 max-w-[260px] text-xs text-red-700">{r.reject_reason ?? "Rejected by the project team"}</div>}</TD>
                  <TD className="text-xs text-slate-500">{r.source === "portal" ? (r.submitted_by_name ?? "Portal") : <Badge tone="slate">Project team</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
