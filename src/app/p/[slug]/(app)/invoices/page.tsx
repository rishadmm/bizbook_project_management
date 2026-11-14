import Link from "next/link";
import { Plus } from "lucide-react";
import { CardSection, EmptyState, LinkButton, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { listInvoices } from "@/features/portal/data";
import InvoiceTimeline, { rejectReasonOf } from "@/features/portal/components/InvoiceTimeline";

export const metadata = { title: "Invoices" };

export default async function PortalInvoices({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug, "invoices");
  const invoices = listInvoices(s);
  return (
    <>
      <PageHeader title="Invoices" description="Track every invoice from submission to payment."
        actions={portalCan(s.user.role, "invoices_submit") ? <LinkButton href={`/p/${slug}/invoices/new`} variant="primary"><Plus size={15} />New invoice</LinkButton> : undefined} />
      <CardSection flush>
        {invoices.length === 0 ? <div className="p-4"><EmptyState title="No invoices yet" /></div> : (
          <Table>
            <THead><TR><TH>Invoice</TH><TH>Subcontract</TH><TH>Date</TH><TH num>Claimed</TH><TH num>Certified</TH><TH num>Paid</TH><TH>Progress</TH></TR></THead>
            <TBody>
              {invoices.map((i) => (
                <TR key={i.id} data-testid="invoice-row">
                  <TD><Link href={`/p/${slug}/invoices/${i.id}`} className="font-bold text-primary-dark hover:underline">{i.invoice_no ?? `#${i.id}`}</Link>{i.sub_invoice_ref && <div className="text-xs text-slate-400">your ref {i.sub_invoice_ref}</div>}</TD>
                  <TD>{i.assignment_code} <span className="text-xs text-slate-400">{i.project_code}</span></TD>
                  <TD className="whitespace-nowrap">{formatDate(i.invoice_date)}</TD>
                  <TD num>{formatMoney(i.claimed_amount)}</TD>
                  <TD num>{["certified", "approved", "paid"].includes(i.status) ? formatMoney(i.certified_amount) : "—"}</TD>
                  <TD num>{i.paid_amount ? formatMoney(i.paid_amount) : "—"}</TD>
                  <TD><InvoiceTimeline inv={i} rejectReason={rejectReasonOf(i.notes)} compact /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
