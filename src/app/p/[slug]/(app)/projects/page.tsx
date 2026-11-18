import Link from "next/link";
import { Badge, CardSection, EmptyState, PageHeader, ProgressBar, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatDate, formatMoney, formatNumber, pct } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { portalCan } from "@/lib/portal-core";
import { listAssignments } from "@/features/portal/data";
import { companySegments, scheduleHealth } from "@/features/portal/ops";
import { RagBadge, TenderSource } from "@/features/portal/components/bits";

export const metadata = { title: "Projects" };

export default async function PortalProjects({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug, "projects");
  const asgs = listAssignments(s);
  const health = new Map(scheduleHealth(asgs, companySegments(s)).map((h) => [h.assignmentId, h]));
  return (
    <>
      <PageHeader title="Projects" description={`Your subcontracts with ${s.entity.legal_name}`} />
      <CardSection flush>
        {asgs.length === 0 ? <div className="p-4"><EmptyState title="No subcontracts yet" /></div> : (
          <Table>
            <THead><TR><TH>Subcontract</TH><TH>Project / stage</TH><TH>Status</TH><TH num>Contract value</TH><TH>Dates</TH><TH className="w-44">Progress</TH><TH>Health</TH></TR></THead>
            <TBody>
              {asgs.map((a) => {
                const h = health.get(a.id);
                return (
                  <TR key={a.id} data-testid="project-row">
                    <TD><Link href={`/p/${slug}/projects/${a.id}`} className="font-bold text-primary-dark hover:underline">{a.code ?? `#${a.id}`}</Link><div><TenderSource slug={slug} a={a} link={portalCan(s.user.role, "tenders")} /></div></TD>
                    <TD><div className="font-semibold text-dark">{a.project_code} · {a.project_name}</div><div className="text-xs text-slate-500">{a.stage_name ?? "—"}</div></TD>
                    <TD><StatusBadge kind="assignmentStatus" value={a.status} /></TD>
                    <TD num>{formatMoney(a.contract_value)}{a.quantity ? <div className="text-xs text-slate-400">{formatNumber(a.quantity, 2)} {a.quantity_unit}</div> : null}</TD>
                    <TD className="whitespace-nowrap text-xs">{formatDate(a.start_date)} → {formatDate(a.end_date)}</TD>
                    <TD>{h ? <ProgressBar value={h.actualPct} planned={h.plannedPct} showLabel tone={h.rag === "grey" ? "slate" : h.rag === "green" ? "green" : h.rag === "amber" ? "amber" : "red"} /> : <span className="text-xs text-slate-400">—</span>}{h && <div className="text-[10px] text-slate-400">plan {pct(h.plannedPct, 0)}</div>}</TD>
                    <TD>{h ? <RagBadge rag={h.rag} /> : <Badge tone="slate">—</Badge>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
