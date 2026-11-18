import Link from "next/link";
import ActionForm from "@/components/ActionForm";
import { Badge, Button, CardSection, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { duplicateTemplateAction } from "@/features/procurement/actions";
import { listTemplates } from "@/features/procurement/queries";

export const metadata = { title: "Tender templates" };

export default async function Templates() {
  await requirePage("procurement", "setup");
  const entity = await getActiveEntity();
  const rows = listTemplates(entity.id);
  return (
    <>
      <PageHeader title="Tender templates" description="A template defines how a type of supplier tender runs: evaluation steps, scoring, bonds and what bidders must submit. A floated tender copies its template, so later edits never change a live tender." breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Templates" }]} />
      <CardSection flush>
        <Table><THead><TR><TH>Template</TH><TH>Method</TH><TH num>Weights</TH><TH num>Steps</TH><TH num>Requirements</TH><TH num>Used</TH><TH>Status</TH><TH className="w-24" /></TR></THead>
          <TBody>{rows.map((t) => (<TR key={t.id} data-testid="template-row"><TD className="min-w-[240px]"><Link href={`/procurement/setup/templates/${t.id}`} className="font-bold text-primary-dark hover:underline">{t.name}</Link><div className="max-w-[360px] truncate text-xs text-slate-500">{t.description}</div></TD>
            <TD><StatusBadge kind="rfxMethod" value={t.evaluation_method} /></TD><TD num>{t.evaluation_method === "lowest_compliant" ? "—" : `${t.tech_weight}/${t.commercial_weight}`}</TD><TD num>{t.steps}</TD><TD num>{t.reqs}</TD><TD num>{t.used}</TD>
            <TD>{t.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</TD>
            <TD><ActionForm action={duplicateTemplateAction}><input type="hidden" name="id" value={t.id} /><Button type="submit" variant="ghost" size="sm">Duplicate</Button></ActionForm></TD></TR>))}</TBody></Table>
      </CardSection>
    </>
  );
}
