import Link from "next/link";
import { AlertTriangle, Plus, Star } from "lucide-react";
import { Badge, CardSection, EmptyState, Input, LinkButton, PageHeader, Select, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR, Button } from "@/components/ui";
import { statusOptions } from "@/lib/status";
import { listSubcontractors } from "@/features/subcontractors/queries";
import { can, requirePage } from "@/lib/auth";

type SP = { status?: string; q?: string };

export default async function SubcontractorsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePage("subcontractors");
  const sp = await searchParams;
  const all = listSubcontractors();
  const q = (sp.q ?? "").toLowerCase();
  const rows = all.filter((s) => (!sp.status || s.status === sp.status) &&
    (!q || `${s.name} ${s.code ?? ""} ${s.trade ?? ""}`.toLowerCase().includes(q)));
  const warn = all.filter((s) => s.expired_docs + s.expiring_docs > 0).length;
  return (
    <>
      <PageHeader title="Subcontractors" description="Directory, onboarding and performance of subcontractors."
        actions={can(me, "subcontractors", "create") ? <LinkButton href="/subcontractors/new" variant="primary"><Plus size={15} />New subcontractor</LinkButton> : undefined} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Subcontractors" value={all.length} />
        <Stat label="Approved" value={all.filter((s) => s.status === "approved").length} tone="good" />
        <Stat label="Onboarding" value={all.filter((s) => s.status === "onboarding" || s.status === "prospect").length} />
        <Stat label="Document warnings" value={warn} tone={warn ? "warn" : "default"} hint="expired or expiring within 30 days" />
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <div className="w-64"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, code, trade" /></div>
        <div className="w-44"><Select name="status" defaultValue={sp.status ?? ""} options={statusOptions("subcontractorStatus")} placeholder="All statuses" /></div>
        <Button type="submit">Filter</Button>
        {(sp.q || sp.status) && <LinkButton href="/subcontractors" variant="ghost">Clear</LinkButton>}
      </form>
      <CardSection flush>
        {rows.length === 0 ? <EmptyState title="No subcontractors found" /> : (
          <Table>
            <THead><TR><TH>Code</TH><TH>Name</TH><TH>Trade</TH><TH>Status</TH><TH num>Rating</TH><TH num>Active assignments</TH><TH>Portal</TH><TH>Documents</TH></TR></THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.id}>
                  <TD className="text-slate-500">{s.code}</TD>
                  <TD><Link href={`/subcontractors/${s.id}`} className="font-medium text-blue-700 hover:underline">{s.name}</Link></TD>
                  <TD>{s.trade ?? "—"}</TD>
                  <TD><StatusBadge kind="subcontractorStatus" value={s.status} /></TD>
                  <TD num>{s.rating ? <span className="inline-flex items-center gap-1"><Star size={12} className="fill-amber-400 text-amber-400" />{s.rating.toFixed(1)}</span> : "—"}</TD>
                  <TD num>{s.active_assignments} <span className="text-slate-400">/ {s.total_assignments}</span></TD>
                  <TD>{s.portal_enabled && s.portal_users > 0 ? <Badge tone="green">Active ({s.portal_users} user{s.portal_users === 1 ? "" : "s"})</Badge> : <Badge tone="slate">Off</Badge>}</TD>
                  <TD>
                    {s.expired_docs > 0 && <Badge tone="red"><AlertTriangle size={11} className="mr-1" />{s.expired_docs} expired</Badge>}
                    {s.expiring_docs > 0 && <Badge tone="amber" className="ml-1">{s.expiring_docs} expiring</Badge>}
                    {s.expired_docs + s.expiring_docs === 0 && <span className="text-xs text-slate-400">OK</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
