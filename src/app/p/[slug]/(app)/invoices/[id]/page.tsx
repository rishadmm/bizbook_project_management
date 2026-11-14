import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Badge, CardSection, PageHeader, Stat } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import { formatDate, formatMoney, formatDateTime } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { getInvoiceDetail } from "@/features/invoices/queries";
import { InvoicePaper } from "@/features/invoices/components/InvoicePaper";
import AttachmentsCard from "@/features/invoices/components/AttachmentsCard";
import { ownedInvoiceId } from "@/features/portal/data";
import InvoiceTimeline, { rejectReasonOf } from "@/features/portal/components/InvoiceTimeline";
import { Flash } from "@/features/portal/components/bits";

export const metadata = { title: "Invoice" };

export default async function PortalInvoicePage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "invoices");
  const invId = ownedInvoiceId(s, Number(id));
  if (!invId) notFound();
  const d0 = getInvoiceDetail(invId);
  if (!d0) notFound();
  // The subcontractor sees the document and its certification, never the internal activity feed or approval comments.
  const d = { ...d0, activity: [], trail: d0.trail.map((t) => ({ ...t, comment: null })) };
  const i = d.invoice;
  const remarks = d.lines.filter((l) => l.remarks && d.certifiedState);
  return (
    <>
      <PageHeader title={i.invoice_no ?? `Invoice #${i.id}`} breadcrumbs={[{ label: "Invoices", href: `/p/${slug}/invoices` }, { label: i.invoice_no ?? `#${i.id}` }]}
        description={`${d.project.code} · ${d.project.name}${i.sub_invoice_ref ? ` · your ref ${i.sub_invoice_ref}` : ""}`}
        actions={<a href={`/p/${slug}/invoices/${i.id}/pdf?download=1`} className={buttonClass("secondary")} data-testid="download-pdf"><Download size={15} />Download PDF</a>} />
      <Flash ok={sp.sent ? "Invoice submitted for review." : undefined} />
      <CardSection title="Status" className="mb-5"><InvoiceTimeline inv={i} rejectReason={rejectReasonOf(i.notes)} />
        {i.certified_at && <p className="mt-3 text-xs text-slate-400">Certified {formatDateTime(i.certified_at)}{i.due_date ? ` · payment due ${formatDate(i.due_date)}` : ""}</p>}</CardSection>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0"><InvoicePaper d={d} /></div>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Claimed" value={formatMoney(d.kpis.claimed, { compact: true })} /><Stat label="Certified" value={formatMoney(d.kpis.certified, { compact: true })} />
            <Stat label="Net payable" value={formatMoney(d.kpis.netPayable, { compact: true })} /><Stat label="Paid" value={formatMoney(d.kpis.paid, { compact: true })} tone="good" />
          </div>
          {remarks.length > 0 && (
            <CardSection title="Certification remarks"><ul className="space-y-2 text-sm">{remarks.map((l) => <li key={l.id}><Badge tone="amber">{l.item_code}</Badge> <span className="text-slate-700">{l.remarks}</span></li>)}</ul></CardSection>
          )}
          <AttachmentsCard invoiceId={i.id} canUpload={false} items={d.attachments.map((a) => ({ id: a.id, filename: a.filename, category: a.category, mime: a.mime, size: a.size, uploader: a.uploader_name, date: formatDate(a.created_at), note: a.note }))} />
        </div>
      </div>
    </>
  );
}
