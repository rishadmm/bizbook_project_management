import { Pencil, Plus } from "lucide-react";
import { Badge, CardSection, ModalButton, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listSupplierCategories } from "@/features/supplier-registration/core";
import SubcontractorsNav from "@/features/supplier-registration/components/SubcontractorsNav";
import { CategoryForm } from "@/features/supplier-registration/components/SetupForms";

export const metadata = { title: "Supplier categories" };

export default async function CategoriesPage() {
  const me = await requirePage("subcontractors", "setup");
  const entity = await getActiveEntity();
  const rows = listSupplierCategories(getDb(), entity.id, true);
  const usage = new Map((getDb().prepare("SELECT category_id, COUNT(*) c FROM subcontractor_categories sc JOIN subcontractors s ON s.id = sc.subcontractor_id WHERE s.entity_id = ? AND sc.status <> 'declined' GROUP BY category_id").all(entity.id) as { category_id: number; c: number }[]).map((r) => [r.category_id, r.c]));
  return (
    <>
      <PageHeader title="Subcontractors" description={`Supplier trade categories · ${entity.country}.`} />
      <SubcontractorsNav active="categories" user={me} entityId={entity.id} />
      <CardSection title="Categories" subtitle="Suppliers pick these when they register; approval can grant a subset" flush
        actions={<ModalButton label="Add category" title="Add a category" variant="primary" size="sm" icon={<Plus size={13} />}><CategoryForm entityId={entity.id} /></ModalButton>}>
        <Table>
          <THead><TR><TH>Name</TH><TH>Group</TH><TH>Code</TH><TH>Scope</TH><TH num>Suppliers</TH><TH>Status</TH><TH>{""}</TH></TR></THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id} data-testid={`cat-row-${c.code}`}>
                <TD className="font-semibold text-dark">{c.name}</TD><TD>{c.group_name}</TD><TD className="text-slate-500">{c.code}</TD><TD>{c.entity_id ? entity.short_name : "All countries"}</TD>
                <TD num>{usage.get(c.id) ?? 0}</TD><TD>{c.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</TD>
                <TD><ModalButton label="" icon={<Pencil size={13} />} title="Edit category" size="sm" variant="ghost"><CategoryForm entityId={entity.id} cat={c} /></ModalButton></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardSection>
    </>
  );
}
