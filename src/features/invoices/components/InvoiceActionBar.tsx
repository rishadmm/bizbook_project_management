import { ModalButton } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { Button } from "@/components/ui";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { hasOpenRequest } from "@/lib/approvals/engine";
import { can, type AuthUser } from "@/lib/auth";
import type { InvoiceStatus } from "@/lib/types";
import { approveInvoice, startInvoiceReview } from "@/features/projects/actions";
import { CertifyForm, PayForm, RejectForm, type FormInvoice } from "./InvoiceForms";

/**
 * Review / Certify / Request approval / Re-certify / Pay / approval panels / Reject for one invoice. Used by the project Invoices tab rows and
 * the invoice page header. `path` = page to refresh after approval actions. Buttons are hidden without the matching permission (the actions re-check).
 */
export function InvoiceActionBar({ inv, status, me, path }: { inv: FormInvoice; status: InvoiceStatus; me: AuthUser; path: string }) {
  const label = inv.invoice_no ?? String(inv.id);
  const mayCertify = can(me, "invoices", "certify"), mayApprove = can(me, "invoices", "approve"), mayPay = can(me, "invoices", "pay");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {mayCertify && status === "submitted" && <ActionForm action={startInvoiceReview}><input type="hidden" name="id" value={inv.id} /><Button type="submit" size="sm">Review</Button></ActionForm>}
      {mayCertify && ["submitted", "under_review"].includes(status) && <ModalButton label="Certify" title={`Certify ${label}`} variant="primary" size="sm"><CertifyForm i={inv} /></ModalButton>}
      {mayApprove && status === "certified" && !hasOpenRequest("sub_invoice", inv.id) && <ActionForm action={approveInvoice}><input type="hidden" name="id" value={inv.id} /><Button type="submit" variant="success" size="sm">Request approval</Button></ActionForm>}
      {mayCertify && status === "certified" && <ModalButton label="Re-certify" title={`Re-certify ${label}`} variant="ghost" size="sm"><CertifyForm i={inv} /></ModalButton>}
      {mayPay && status === "approved" && !hasOpenRequest("invoice_payment", inv.id) && <ModalButton label="Pay" title={`Pay ${label}`} variant="success" size="sm"><PayForm i={inv} /></ModalButton>}
      <ApprovalPanel compact label="Invoice approval" type="sub_invoice" documentId={inv.id} path={path} user={me} title={`Invoice approval ${label}`} />
      <ApprovalPanel compact label="Payment approval" type="invoice_payment" documentId={inv.id} path={path} user={me} title={`Payment approval ${label}`} />
      {(mayCertify || mayApprove) && !["paid", "rejected"].includes(status) && <ModalButton label="Reject" title={`Reject ${label}`} variant="ghost" size="sm"><RejectForm id={inv.id} /></ModalButton>}
    </div>
  );
}
