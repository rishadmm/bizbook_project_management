import { Pencil, Plus } from "lucide-react";
import { Badge, CardSection, ModalButton, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import SubcontractorsNav from "@/features/supplier-registration/components/SubcontractorsNav";
import { DocTypeForm } from "@/features/supplier-registration/components/SetupForms";

export const metadata = { title: "Registration document types" };

export default async function DocumentTypesPage() {
  const me = await requirePage("subcontractors", "setup");
  const entity = await getActiveEntity();
  const rows = getDb().prepare("SELECT * FROM registration_doc_types WHERE entity_id = ? ORDER BY sort, id").all(entity.id) as { id: number; code: string; name: string; mandatory: number; needs_expiry: number; category_condition: string | null; active: number }[];
  return (
    <>
      <PageHeader title="Subcontractors" description={`Registration document types · ${entity.country}.`} />
      <SubcontractorsNav active="types" user={me} entityId={entity.id} />
      <CardSection title="Document types" subtitle={`What a supplier registering in ${entity.country} has to upload`} flush
        actions={<ModalButton label="Add document type" title="Add a document type" variant="primary" size="sm" icon={<Plus size={13} />}><DocTypeForm entityId={entity.id} /></ModalButton>}>
        <Table>
          <THead><TR><TH>Document</TH><TH>Code</TH><TH>Mandatory</TH><TH>Expiry</TH><TH>Condition</TH><TH>Status</TH><TH>{""}</TH></TR></THead>
          <TBody>
            {rows.map((t) => (
              <TR key={t.id} data-testid={`doctype-row-${t.code}`}>
                <TD className="font-semibold text-dark">{t.name}</TD><TD className="text-slate-500">{t.code}</TD>
                <TD>{t.mandatory ? <Badge tone="red">Mandatory</Badge> : <Badge tone="slate">Optional</Badge>}</TD><TD>{t.needs_expiry ? "Has expiry date" : "—"}</TD>
                <TD className="text-xs text-slate-600">{t.category_condition ? `Only for ${t.category_condition.replace("group:", "")} categories` : "Always"}</TD>
                <TD>{t.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</TD>
                <TD><ModalButton label="" icon={<Pencil size={13} />} title="Edit document type" size="sm" variant="ghost"><DocTypeForm entityId={entity.id} t={t} /></ModalButton></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardSection>
    </>
  );
}
