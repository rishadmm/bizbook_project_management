import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, CardSection, EmptyState, LinkButton, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { listIssues } from "@/features/portal/data";

export const metadata = { title: "Issues & RFIs" };

export default async function PortalIssues({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug, "issues");
  const issues = listIssues(s);
  return (
    <>
      <PageHeader title="Issues & RFIs" description="Issues on your scope and the questions you raised."
        actions={portalCan(s.user.role, "issues_raise") ? <LinkButton href={`/p/${slug}/issues/new`} variant="primary"><Plus size={15} />Raise issue / RFI</LinkButton> : undefined} />
      <CardSection flush>
        {issues.length === 0 ? <div className="p-4"><EmptyState title="No issues" description="Raise one when something on site blocks your work." /></div> : (
          <Table>
            <THead><TR><TH>Title</TH><TH>Subcontract</TH><TH>Raised</TH><TH>Status</TH><TH>Waiting for</TH></TR></THead>
            <TBody>
              {issues.map((i) => (
                <TR key={i.id} data-testid="issue-row" className={i.status === "closed" ? "opacity-60" : ""}>
                  <TD><Link href={`/p/${slug}/issues/${i.id}`} className="font-bold text-primary-dark hover:underline">{i.title}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-1">{i.kind === "rfi" && <Badge tone="blue">RFI</Badge>}{i.source === "portal" && <Badge tone="violet">Raised by {i.raised_by_name ?? "you"}</Badge>}</div></TD>
                  <TD>{i.assignment_code} <span className="text-xs text-slate-400">{i.project_code}</span></TD>
                  <TD className="whitespace-nowrap">{formatDate(i.raised_on)}</TD>
                  <TD><Badge tone={i.status === "closed" ? "green" : i.status === "mitigating" ? "amber" : "red"}>{i.status === "mitigating" ? "In progress" : i.status}</Badge></TD>
                  <TD>{i.status === "closed" ? <span className="text-slate-400">—</span> : i.awaiting_party === "portal" ? <Badge tone="violet">You</Badge> : i.awaiting_party === "internal" ? <Badge tone="slate">Project team</Badge> : <span className="text-slate-400">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
