import { EmptyState, PageHeader } from "@/components/ui";
import { todayISO } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { fromGross, r2 } from "@/features/invoices/calc";
import { getAssignmentBoq } from "@/features/invoices/lines";
import { canWorkOn, getStatement, listAssignments, listInvoices } from "@/features/portal/data";
import SessionInvoiceForm from "@/features/portal/components/SessionInvoiceForm";
import { ReadOnlyNote } from "@/features/portal/components/bits";

export const metadata = { title: "New invoice" };

export default async function NewInvoice({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignment?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "invoices_submit");
  const active = listAssignments(s).filter(canWorkOn);
  const statement = new Map(getStatement(s).map((r) => [r.assignmentId, r]));
  const invoices = listInvoices(s).filter((i) => i.status !== "rejected");
  const asgs = active.map((a) => {
    const boq = getAssignmentBoq(a.id);
    const st = statement.get(a.id);
    const lastPeriodTo = invoices.filter((i) => i.assignment_id === a.id && i.period_to).map((i) => i.period_to as string).sort().pop() ?? null;
    return {
      id: a.id, label: `${a.code ?? `#${a.id}`} · ${a.project_code}${a.stage_name ? ` · ${a.stage_name}` : ""}`, boq,
      code: a.code ?? `#${a.id}`, projectCode: a.project_code, projectName: a.project_name, stageName: a.stage_name,
      contractValue: a.contract_value, retentionPct: a.retention_pct || 0, advancePct: a.advance_pct || 0, paymentDays: a.payment_days || 0,
      billedSubtotal: r2(boq.reduce((t, b) => t + b.prev_qty * b.rate, 0)),
      certifiedSubtotal: fromGross(st?.certified ?? 0, s.entity.vat_rate).subtotal,
      lastPeriodTo,
    };
  });
  return (
    <>
      <PageHeader title="New invoice" breadcrumbs={[{ label: "Invoices", href: `/p/${slug}/invoices` }, { label: "New" }]} description="Enter this period's quantities against your subcontract items. Rates are fixed by the contract; VAT is added automatically." />
      {s.readOnly && <ReadOnlyNote />}
      {asgs.length === 0 ? <EmptyState title="No active subcontract" description="Invoices can only be submitted on active subcontracts." /> : (
        <SessionInvoiceForm assignments={asgs} defaultAssignment={Number(sp.assignment) || undefined} today={todayISO()} vatRate={s.entity.vat_rate} currency={s.entity.currency} defaults={{ name: s.user.name, email: s.user.email }} cancelHref={`/p/${slug}/invoices`} />
      )}
    </>
  );
}
