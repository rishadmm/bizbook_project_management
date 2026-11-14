import { CardSection, EmptyState, PageHeader } from "@/components/ui";
import { getSetting } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { DEFAULT_VAT_RATE } from "@/features/invoices/calc";
import { getAssignmentBoq } from "@/features/invoices/lines";
import { canWorkOn, listAssignments } from "@/features/portal/data";
import SessionInvoiceForm from "@/features/portal/components/SessionInvoiceForm";
import { ReadOnlyNote } from "@/features/portal/components/bits";

export const metadata = { title: "New invoice" };

export default async function NewInvoice({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignment?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "invoices_submit");
  const asgs = listAssignments(s).filter(canWorkOn).map((a) => ({ id: a.id, label: `${a.code ?? `#${a.id}`} · ${a.project_code}${a.stage_name ? ` · ${a.stage_name}` : ""}`, boq: getAssignmentBoq(a.id) }));
  return (
    <>
      <PageHeader title="New invoice" breadcrumbs={[{ label: "Invoices", href: `/p/${slug}/invoices` }, { label: "New" }]} description="Enter this period's quantities against your subcontract items. Rates are fixed by the contract; VAT is added automatically." />
      {s.readOnly && <ReadOnlyNote />}
      {asgs.length === 0 ? <EmptyState title="No active subcontract" description="Invoices can only be submitted on active subcontracts." /> : (
        <CardSection><SessionInvoiceForm assignments={asgs} defaultAssignment={Number(sp.assignment) || undefined} today={todayISO()} vatRate={DEFAULT_VAT_RATE} currency={getSetting("currency", "AED")} defaults={{ name: s.user.name, email: s.user.email }} /></CardSection>
      )}
    </>
  );
}
