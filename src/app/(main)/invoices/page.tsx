import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Button, CardSection, ClickRow, EmptyState, Field, Input, LinkButton, ModalButton, PageHeader, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import type { InvoiceStatus } from "@/lib/types";
import { approveInvoice, certifyInvoice, payInvoice, rejectInvoice, startInvoiceReview } from "@/features/invoices/actions";
import { invoiceTotals, listInvoices, type InvoiceQueueRow } from "@/features/invoices/queries";
import { canMap, requirePage, type AuthUser } from "@/lib/auth";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { hasOpenRequest } from "@/lib/approvals/engine";
import ActionForm from "@/components/ActionForm";

const STATUSES: InvoiceStatus[] = ["submitted", "under_review", "certified", "approved", "paid", "rejected"];

function Hidden({ id }: { id: number }) { return <input type="hidden" name="id" value={id} />; }

type Can = { certify: boolean; approve: boolean; pay: boolean };
function Actions({ i, c, me }: { i: InvoiceQueueRow; c: Can; me: AuthUser }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {c.certify && i.status === "submitted" && <ActionForm action={startInvoiceReview}><Hidden id={i.id} /><Button type="submit" size="sm">Start review</Button></ActionForm>}
      {c.certify && (i.status === "submitted" || i.status === "under_review") && (
        <ModalButton label="Certify" title={`Certify invoice ${i.invoice_no ?? i.id}`} size="sm" variant="primary">
          <ActionForm action={certifyInvoice} className="space-y-3">
            <Hidden id={i.id} />
            <p className="text-sm text-slate-600">Claimed {formatMoney(i.claimed_amount)}. Retention {i.retention_pct}% and advance recovery {i.advance_pct}% are deducted automatically.</p>
            <Field label="Certified amount"><Input type="number" step="0.01" min="0" name="certified_amount" defaultValue={i.claimed_amount} required /></Field>
            <Button type="submit" variant="primary">Certify</Button>
          </ActionForm>
        </ModalButton>
      )}
      {c.approve && i.status === "certified" && !hasOpenRequest("sub_invoice", i.id) && <ActionForm action={approveInvoice}><Hidden id={i.id} /><Button type="submit" size="sm" variant="success">Request approval</Button></ActionForm>}
      <ApprovalPanel compact label="Invoice approval" type="sub_invoice" documentId={i.id} path="/invoices" user={me} title={`Invoice approval ${i.invoice_no ?? i.id}`} />
      <ApprovalPanel compact label="Payment approval" type="invoice_payment" documentId={i.id} path="/invoices" user={me} title={`Payment approval ${i.invoice_no ?? i.id}`} />
      {c.pay && i.status === "approved" && !hasOpenRequest("invoice_payment", i.id) && (
        <ModalButton label="Mark paid" title={`Pay invoice ${i.invoice_no ?? i.id}`} size="sm" variant="success">
          <ActionForm action={payInvoice} className="space-y-3">
            <Hidden id={i.id} />
            <Field label="Paid amount"><Input type="number" step="0.01" min="0" name="paid_amount" defaultValue={i.net_payable} required /></Field>
            <Field label="Paid date"><Input type="date" name="paid_date" defaultValue={todayISO()} required /></Field>
            <Button type="submit" variant="success">Record payment</Button>
          </ActionForm>
        </ModalButton>
      )}
      {(c.certify || c.approve) && i.status !== "paid" && i.status !== "rejected" && (
        <ModalButton label="Reject" title={`Reject invoice ${i.invoice_no ?? i.id}`} size="sm" variant="danger">
          <ActionForm action={rejectInvoice} className="space-y-3">
            <Hidden id={i.id} />
            <Field label="Reason"><Textarea name="reason" rows={3} /></Field>
            <Button type="submit" variant="danger">Reject invoice</Button>
          </ActionForm>
        </ModalButton>
      )}
    </div>
  );
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const me = await requirePage("invoices");
  const c = canMap(me, "invoices", ["certify", "approve", "pay"] as const);
  const { status } = await searchParams;
  const active = STATUSES.includes(status as InvoiceStatus) ? status : undefined;
  const totals = invoiceTotals();
  const rows = listInvoices(active);
  const pipeline = totals.submitted.count + totals.under_review.count;
  return (
    <>
      <PageHeader title="Invoices" description="Subcontractor invoices across all projects: review, certify, approve and pay." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="To certify" value={pipeline} tone={pipeline ? "warn" : "default"} hint={formatMoney(totals.submitted.amount + totals.under_review.amount, { compact: true })} />
        <Stat label="Certified" value={totals.certified.count} hint={formatMoney(totals.certified.amount, { compact: true })} />
        <Stat label="To pay" value={totals.approved.count} hint={formatMoney(totals.approved.amount, { compact: true })} />
        <Stat label="Paid" value={totals.paid.count} tone="good" hint={formatMoney(totals.paid.amount, { compact: true })} />
        <Stat label="Rejected" value={totals.rejected.count} hint={formatMoney(totals.rejected.amount, { compact: true })} />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <LinkButton href="/invoices" variant={active ? "secondary" : "primary"} size="sm">All</LinkButton>
        {STATUSES.map((s) => (
          <Link key={s} href={`/invoices?status=${s}`} className={cn("rounded-md border px-2.5 py-1 text-xs font-medium", active === s ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
            {statusLabel("invoiceStatus", s)} ({totals[s].count})
          </Link>
        ))}
      </div>
      <CardSection flush>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No invoices" /></div> : (
          <Table>
            <THead><TR><TH>Invoice</TH><TH>Subcontractor / project</TH><TH>Date</TH><TH num>Claimed</TH><TH num>Certified</TH><TH num>Retention</TH><TH num>Advance rec.</TH><TH num>Net payable</TH><TH>Status</TH><TH>{""}</TH></TR></THead>
            <TBody>
              {rows.map((i) => (
                <ClickRow key={i.id} href={`/invoices/${i.id}`}>
                  <TD>
                    <Link href={`/invoices/${i.id}`} className="font-medium text-primary-dark hover:underline">{i.invoice_no ?? `#${i.id}`}</Link>
                    <div className="text-xs text-slate-500">{i.assignment_code}{i.source === "portal" ? " · portal" : ""}</div>
                    {i.files.length > 0 && <span className="inline-flex items-center gap-0.5 text-xs text-slate-500"><Paperclip size={10} />{i.files.length} file{i.files.length === 1 ? "" : "s"}</span>}
                  </TD>
                  <TD><Link href={`/subcontractors/${i.subcontractor_id}`} className="text-blue-700 hover:underline">{i.subcontractor_name}</Link>
                    <div className="text-xs"><Link href={`/projects/${i.project_id}`} className="text-slate-500 hover:text-blue-700">{i.project_code} · {i.project_name}</Link></div></TD>
                  <TD>{formatDate(i.invoice_date)}</TD>
                  <TD num>{formatMoney(i.claimed_amount)}</TD>
                  <TD num>{i.certified_amount ? formatMoney(i.certified_amount) : "—"}</TD>
                  <TD num>{i.retention_amount ? formatMoney(i.retention_amount) : "—"}</TD>
                  <TD num>{i.advance_recovery ? formatMoney(i.advance_recovery) : "—"}</TD>
                  <TD num className="font-medium">{i.net_payable ? formatMoney(i.net_payable) : "—"}</TD>
                  <TD><StatusBadge kind="invoiceStatus" value={i.status} />{i.paid_date && <div className="text-xs text-slate-400">{formatDate(i.paid_date)}</div>}</TD>
                  <TD><Actions i={i} c={c} me={me} /></TD>
                </ClickRow>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
