import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { Badge, CardSection, ProgressBar, Stat, StatusBadge } from "@/components/ui";
import { can, requirePage } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { fromGross } from "@/features/invoices/calc";
import AttachmentsCard from "@/features/invoices/components/AttachmentsCard";
import ErpCard from "@/features/invoices/components/ErpCard";
import HeaderTools from "@/features/invoices/components/HeaderTools";
import { InvoiceActionBar } from "@/features/invoices/components/InvoiceActionBar";
import { InvoicePaper } from "@/features/invoices/components/InvoicePaper";
import { getInvoiceDetail, getInvoiceHeader } from "@/features/invoices/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const h = Number.isInteger(id) ? getInvoiceHeader(id) : undefined;
  return { title: h?.invoice_no ?? "Invoice" };
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePage("invoices", "view");
  const id = Number((await params).id);
  const d = Number.isInteger(id) ? getInvoiceDetail(id) : null;
  if (!d) notFound();
  const i = d.invoice;
  const cur = i.currency || "AED";
  const m = (v: number) => formatMoney(v, { decimals: 2, currency: cur });
  const path = `/invoices/${i.id}`;
  const unit = d.assignment.quantity_unit ?? "";
  // cumulative statement (ex-VAT certified against the contract value)
  const cumCertified = d.statement.reduce((s, r) => s + fromGross(r.certified, i.vat_rate).subtotal, 0);
  const cumClaimed = d.statement.reduce((s, r) => s + r.claimed, 0);
  const cumPaid = d.statement.reduce((s, r) => s + r.paid, 0);
  const cumPct = d.assignment.contract_value > 0 ? (cumCertified / d.assignment.contract_value) * 100 : 0;
  return (
    <>
      <div className="mb-5">
        <div className="no-print mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          <Link href="/projects" className="hover:text-primary">Projects</Link><span>/</span>
          <Link href={`/projects/${d.project.id}`} className="hover:text-primary">{d.project.code}</Link><span>/</span>
          <Link href={`/projects/${d.project.id}?tab=invoices`} className="hover:text-primary">Invoices</Link><span>/</span>
          <span>{i.invoice_no ?? `#${i.id}`}</span>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-dark" data-testid="invoice-title">{i.invoice_no ?? `#${i.id}`}</h1>
                {i.sub_invoice_ref && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">Ref {i.sub_invoice_ref}</span>}
                <StatusBadge kind="invoiceStatus" value={i.status} />
                {i.source === "portal" && <Badge tone="violet">Portal</Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-500">
                <Link href={`/subcontractors/${d.subcontractor.id}`} className="font-semibold text-primary-dark hover:underline">{d.subcontractor.name}</Link>
                {" · "}<Link href={`/projects/${d.project.id}`} className="hover:text-primary">{d.project.code} · {d.project.name}</Link>
                {d.assignment.code && <> · {d.assignment.code}</>}
              </p>
            </div>
            <HeaderTools id={i.id} />
          </div>
          <div className="no-print mt-3 border-t border-line pt-3">
            <InvoiceActionBar inv={{ id: i.id, invoice_no: i.invoice_no, claimed_amount: i.claimed_amount, certified_amount: i.certified_amount, net_payable: i.net_payable, retention_pct: d.assignment.retention_pct, advance_pct: d.assignment.advance_pct, assignment_code: d.assignment.code, subcontractor_name: d.subcontractor.name }} status={i.status} me={me} path={path} />
          </div>
        </div>
      </div>

      <div className="print-grid grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0"><InvoicePaper d={d} /></div>

        <aside className="no-print min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3" data-testid="invoice-kpis">
            <Stat label="Claimed" value={formatMoney(d.kpis.claimed, { compact: true, currency: cur })} hint="incl. VAT" />
            <Stat label="Certified" value={d.certifiedState ? formatMoney(d.kpis.certified, { compact: true, currency: cur }) : "—"} hint={d.certifiedState && d.kpis.claimed ? `${((d.kpis.certified / d.kpis.claimed) * 100).toFixed(0)}% of claim` : "pending"} />
            <Stat label="Net payable" value={d.certifiedState ? formatMoney(d.kpis.netPayable, { compact: true, currency: cur }) : "—"} hint="after deductions" />
            <Stat label="Paid" value={formatMoney(d.kpis.paid, { compact: true, currency: cur })} tone={i.status === "paid" ? "good" : "default"} hint={i.paid_date ? formatDate(i.paid_date) : undefined} />
            <Stat className="col-span-2" label="Outstanding" value={formatMoney(d.kpis.outstanding, { compact: true, currency: cur })} tone={d.kpis.outstanding > 0 ? "warn" : "default"} hint={i.due_date ? `due ${formatDate(i.due_date)}` : undefined} />
          </div>

          <AttachmentsCard invoiceId={i.id} canUpload={can(me, "invoices", "certify")} items={d.attachments.map((a) => ({ id: a.id, filename: a.filename, category: a.category, mime: a.mime, size: a.size, uploader: a.uploader_name, date: formatDate(a.created_at), note: a.note }))} />

          <ApprovalPanel type="sub_invoice" documentId={i.id} path={path} user={me} title="Invoice approval" />
          {d.paymentApproval && <ApprovalPanel type="invoice_payment" documentId={i.id} path={path} user={me} title="Payment approval" />}

          <CardSection title="Cumulative statement" subtitle={`${d.assignment.code ?? "Subcontract"} · contract ${m(d.assignment.contract_value)}`}>
            <div className="mb-3"><ProgressBar value={cumPct} showLabel tone={cumPct > 100 ? "red" : "blue"} /><div className="mt-1 text-[11px] text-slate-500">{cumPct.toFixed(1)}% of the contract value certified (excl. VAT)</div></div>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wide text-muted"><th className="py-1">Invoice</th><th className="py-1 text-right">Claimed</th><th className="py-1 text-right">Certified</th><th className="py-1 text-right">Paid</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.statement.map((r) => (
                  <tr key={r.id} className={r.current ? "bg-primary-50/60 font-semibold" : ""}>
                    <td className="py-1.5"><Link href={`/invoices/${r.id}`} className="text-primary-dark hover:underline">{r.invoice_no}</Link><div className="text-[10px] font-normal text-slate-400">{formatDate(r.invoice_date)} · {r.status.replace("_", " ")}</div></td>
                    <td className="py-1.5 text-right tabular-nums">{formatNumber(r.claimed)}</td><td className="py-1.5 text-right tabular-nums">{r.certified ? formatNumber(r.certified) : "—"}</td><td className="py-1.5 text-right tabular-nums">{r.paid ? formatNumber(r.paid) : "—"}</td>
                  </tr>
                ))}
                <tr className="font-bold"><td className="py-1.5">Total</td><td className="py-1.5 text-right tabular-nums">{formatNumber(cumClaimed)}</td><td className="py-1.5 text-right tabular-nums">{formatNumber(d.statement.reduce((s, r) => s + r.certified, 0))}</td><td className="py-1.5 text-right tabular-nums">{formatNumber(cumPaid)}</td></tr>
              </tbody>
            </table>
          </CardSection>

          <CardSection title="Linked progress reports" subtitle={i.period_from ? `${formatDate(i.period_from)} – ${formatDate(i.period_to)}` : "No invoice period set"}>
            {d.progress.length === 0 ? <p className="text-sm text-slate-500">No progress reports in the invoice period.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {d.progress.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/projects/${d.project.id}?tab=progress`} className="text-primary-dark hover:underline">{formatDate(r.report_date)}</Link>
                    <span className="tabular-nums text-slate-600">{formatNumber(r.quantity_done, 2)} {unit}</span>
                    <span className="flex items-center gap-1"><StatusBadge kind="progressStatus" value={r.status} />{r.source === "portal" && <Badge tone="violet">Portal</Badge>}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardSection>

          <ErpCard invoiceId={i.id} status={i.erp_sync_status} docNo={i.erp_doc_no} syncedAt={i.erp_synced_at ? formatDateTime(i.erp_synced_at) : null} error={i.erp_error} />

          <CardSection title="Activity">
            {d.activity.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : (
              <ol className="relative ml-2 border-l border-slate-200">
                {d.activity.slice(0, 30).map((r) => (
                  <li key={`${r.entity_type}-${r.id}`} className="mb-3 ml-4">
                    <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-primary" />
                    <div className="text-[13px] text-slate-800">{r.message ?? r.action}</div>
                    <div className="text-[11px] text-slate-500">{r.user_name ?? "Portal / system"} · {formatDateTime(r.created_at)}</div>
                  </li>
                ))}
              </ol>
            )}
          </CardSection>
        </aside>
      </div>
    </>
  );
}
