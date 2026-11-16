import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, resolveTab } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { CardSection } from "@/components/ui/Card";
import { ModalButton } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatDate, formatMoney } from "@/lib/format";
import { clientProjects, clientTenders, getClient } from "@/features/clients/queries";
import { ClientForm } from "@/features/clients/ClientForm";
import { deleteClient } from "@/features/clients/actions";
import { can, isAdminUser, requirePage } from "@/lib/auth";
import ClientPortalTab from "@/features/client-portal-admin/components/ClientPortalTab";
import ActionForm from "@/components/ActionForm";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage("clients");
  const { id: s } = await params;
  const id = Number(s);
  const c = Number.isInteger(id) ? getClient(id) : undefined;
  if (!c) notFound();
  const tenders = clientTenders(id); const projects = clientProjects(id);
  const tabs = [{ key: "overview", label: "Overview" }, ...(can(me, "clients", "portal") ? [{ key: "portal", label: "Portal access" }] : [])];
  const tab = resolveTab(await searchParams, tabs);
  return (
    <>
      <PageHeader title={c.name} breadcrumbs={[{ label: "Clients", href: "/clients" }, { label: c.name }]} badges={<StatusBadge kind="clientType" value={c.type} />}
        actions={<>
          {can(me, "clients", "edit") && <ModalButton label="Edit" title="Edit client" wide><ClientForm client={c} /></ModalButton>}
          {can(me, "clients", "delete") && <ActionForm action={deleteClient}><input type="hidden" name="id" value={c.id} /><Button type="submit" variant="danger">Delete</Button></ActionForm>}
        </>} />
      <Tabs tabs={tabs} active={tab} basePath={`/clients/${id}`} />
      {tab === "portal" && <ClientPortalTab client={{ id: c.id, name: c.name, portal_slug: c.portal_slug ?? null, portal_enabled: c.portal_enabled ?? 0, portal_show_subcontractors: c.portal_show_subcontractors ?? 1, portal_show_financials: c.portal_show_financials ?? 1 }}
        canManage={can(me, "clients", "portal")} canViewAs={isAdminUser(me) && can(me, "clients", "portal")} />}
      {tab === "overview" && <>
      <CardSection title="Contact" className="mb-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          {([["Contact person", c.contact_person], ["Email", c.email], ["Phone", c.phone], ["Address", c.address]] as const).map(([k, v]) => <div key={k}><dt className="text-xs font-medium text-slate-500">{k}</dt><dd>{v || "-"}</dd></div>)}
        </dl>
        {c.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{c.notes}</p>}
      </CardSection>
      <div className="space-y-5">
        <CardSection title="Tenders" subtitle={`${tenders.length}`} flush>
          {tenders.length === 0 ? <div className="p-4"><EmptyState title="No tenders for this client" /></div> : (
            <Table>
              <THead><TR><TH>Code</TH><TH>Title</TH><TH>Status</TH><TH>Deadline</TH><TH num>Value</TH></TR></THead>
              <TBody>{tenders.map((t) => (
                <TR key={t.id}><TD><Link href={`/tenders/${t.id}`} className="font-medium text-blue-700 hover:underline">{t.code}</Link></TD><TD>{t.title}</TD><TD><StatusBadge kind="tenderStatus" value={t.status} /></TD>
                  <TD>{formatDate(t.submission_deadline)}</TD><TD num>{formatMoney(t.status === "won" && t.won_value ? t.won_value : t.rev_price || t.estimated_value)}</TD></TR>
              ))}</TBody>
            </Table>
          )}
        </CardSection>
        <CardSection title="Projects" subtitle={`${projects.length}`} flush>
          {projects.length === 0 ? <div className="p-4"><EmptyState title="No projects for this client" /></div> : (
            <Table>
              <THead><TR><TH>Code</TH><TH>Name</TH><TH>Status</TH><TH>Period</TH><TH num>Contract value</TH></TR></THead>
              <TBody>{projects.map((p) => (
                <TR key={p.id}><TD><Link href={`/projects/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.code}</Link></TD><TD>{p.name}</TD><TD><StatusBadge kind="projectStatus" value={p.status} /></TD>
                  <TD>{formatDate(p.start_date)} - {formatDate(p.end_date)}</TD><TD num>{formatMoney(p.contract_value)}</TD></TR>
              ))}</TBody>
            </Table>
          )}
        </CardSection>
      </div>
      </>}
    </>
  );
}
