import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { ModalButton } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatMoney } from "@/lib/format";
import { listClients } from "@/features/clients/queries";
import { ClientForm } from "@/features/clients/ClientForm";
import { can, requirePage } from "@/lib/auth";

export default async function ClientsPage() {
  const me = await requirePage("clients");
  const rows = listClients();
  return (
    <>
      <PageHeader title="Clients" description="Client master: authorities, utilities and private clients."
        actions={can(me, "clients", "create") ? <ModalButton label="New client" title="New client" variant="primary" icon={<Plus size={14} />} wide><ClientForm /></ModalButton> : undefined} />
      <CardSection flush>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No clients yet" /></div> : (
          <Table>
            <THead><TR><TH>Name</TH><TH>Type</TH><TH>Contact</TH><TH>Email / phone</TH><TH num>Tenders</TH><TH num>Won / lost</TH><TH num>Projects</TH><TH num>Won value</TH></TR></THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium"><Link href={`/clients/${c.id}`} className="text-blue-700 hover:underline">{c.name}</Link></TD>
                  <TD><StatusBadge kind="clientType" value={c.type} /></TD>
                  <TD>{c.contact_person ?? "-"}</TD><TD className="text-xs">{c.email ?? "-"}<div className="text-slate-500">{c.phone}</div></TD>
                  <TD num>{c.tender_count}</TD><TD num>{c.won_count} / {c.lost_count}</TD><TD num>{c.project_count}</TD><TD num>{formatMoney(c.won_value)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
