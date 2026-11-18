import Link from "next/link";
import { Badge, CardSection, EmptyState, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { REGISTRATION_STATUSES, slaTone } from "@/lib/registration";
import SubcontractorsNav from "@/features/supplier-registration/components/SubcontractorsNav";
import { QUEUE_TABS, listRegistrations, queueCounts, type QueueTab } from "@/features/supplier-registration/queries";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Supplier registrations" };

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage("subcontractors");
  const entity = await getActiveEntity();
  const { tab: rawTab } = await searchParams;
  const counts = queueCounts(entity.id);
  const tab = (QUEUE_TABS.find((t) => t.key === rawTab)?.key ?? (counts.submitted ? "submitted" : counts.under_review ? "under_review" : "submitted")) as QueueTab;
  const rows = listRegistrations(entity.id, tab);
  return (
    <>
      <PageHeader title="Subcontractors" description={`Supplier registrations and prequalification · ${entity.country}.`} />
      <SubcontractorsNav active="registrations" user={me} entityId={entity.id} />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Registration status">
        {QUEUE_TABS.map((t) => (
          <Link key={t.key} href={`/subcontractors/registrations?tab=${t.key}`} role="tab" aria-selected={tab === t.key} data-testid={`queue-tab-${t.key}`}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-bold", tab === t.key ? "bg-primary text-white shadow-brand-sm" : "bg-white text-slate-600 ring-1 ring-line hover:bg-primary-50")}>
            {t.label}<span className={cn("ml-1.5 rounded-full px-1.5 text-[11px]", tab === t.key ? "bg-white/25" : "bg-slate-100 text-slate-500")}>{counts[t.key]}</span>
          </Link>
        ))}
      </div>
      <CardSection flush>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="Nothing here" description="No registrations in this status." /></div> : (
          <Table>
            <THead><TR><TH>Reg no.</TH><TH>Company</TH><TH>Categories</TH><TH>Submitted</TH><TH>Waiting</TH><TH num>Complete</TH><TH>Reviewer</TH><TH>{""}</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} data-testid={`reg-row-${r.id}`}>
                  <TD className="whitespace-nowrap text-slate-500">{r.registration_no ?? "—"}</TD>
                  <TD><Link href={`/subcontractors/${r.id}/registration`} className="font-bold text-primary-dark hover:underline"><span aria-hidden className="mr-1">{r.country_flag}</span>{r.name}</Link>
                    <div className="flex gap-1 pt-0.5">{r.resubmit_count > 0 && <Badge tone="violet">Round {r.resubmit_count + 1}</Badge>}{r.awaiting_approval && <Badge tone="amber">Awaiting approval</Badge>}</div></TD>
                  <TD className="max-w-[240px] text-xs text-slate-600">{r.categories}</TD>
                  <TD className="whitespace-nowrap">{formatDate(r.submitted_at?.slice(0, 10))}</TD>
                  <TD>{r.waiting_days === null ? <span className="text-slate-300">—</span> : <Badge tone={slaTone(r.waiting_days)}>{r.waiting_days} day{r.waiting_days === 1 ? "" : "s"}</Badge>}</TD>
                  <TD num>{r.completeness}%</TD>
                  <TD className="text-sm">{r.reviewer ?? <span className="text-slate-300">—</span>}</TD>
                  <TD><Badge tone={REGISTRATION_STATUSES[r.status as keyof typeof REGISTRATION_STATUSES]?.tone ?? "slate"}>{REGISTRATION_STATUSES[r.status as keyof typeof REGISTRATION_STATUSES]?.label ?? r.status}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
