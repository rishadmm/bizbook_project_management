import { Button, Field, Input, Select } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { formatMoney, todayISO } from "@/lib/format";
import { certifyInvoice, payInvoice, rejectInvoice } from "@/features/projects/actions";

/** Shared forms of the invoice workflow (project Invoices tab and the invoice page). They post to the existing server actions unchanged. */
export interface FormInvoice {
  id: number; invoice_no: string | null; claimed_amount: number; certified_amount: number; net_payable: number;
  retention_pct: number; advance_pct: number; assignment_code: string | null; subcontractor_name: string;
}

export function CertifyForm({ i }: { i: FormInvoice }) {
  return (
    <ActionForm action={certifyInvoice} className="space-y-3">
      <input type="hidden" name="id" value={i.id} />
      <p className="text-sm text-slate-600">Invoice <b>{i.invoice_no}</b> from {i.subcontractor_name}: claimed <b>{formatMoney(i.claimed_amount)}</b> (incl. VAT).</p>
      <Field label="Certified amount (incl. VAT)" hint={`Retention ${i.retention_pct}% and advance recovery ${i.advance_pct}% (from ${i.assignment_code} terms) are deducted automatically; lines are certified pro rata.`}>
        <Input name="certified_amount" type="number" step="any" min="0" defaultValue={i.certified_amount || i.claimed_amount} required />
      </Field>
      <div className="flex justify-end"><Button type="submit" variant="primary">Certify</Button></div>
    </ActionForm>
  );
}

export function PayForm({ i }: { i: FormInvoice }) {
  return (
    <ActionForm action={payInvoice} className="space-y-3">
      <input type="hidden" name="id" value={i.id} />
      <p className="text-sm text-slate-600">Net payable for <b>{i.invoice_no}</b>: <b>{formatMoney(i.net_payable)}</b></p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid amount"><Input name="paid_amount" type="number" step="any" min="0" defaultValue={i.net_payable} required /></Field>
        <Field label="Paid date"><Input name="paid_date" type="date" defaultValue={todayISO()} /></Field>
        <Field label="Method"><Select name="payment_method" defaultValue="Bank transfer" options={["Bank transfer", "Cheque", "Cash"].map((v) => ({ value: v, label: v }))} /></Field>
        <Field label="Payment reference"><Input name="payment_ref" placeholder="e.g. TRF-2026-0412" /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" variant="success">Record payment</Button></div>
    </ActionForm>
  );
}

export function RejectForm({ id }: { id: number }) {
  return (
    <ActionForm action={rejectInvoice} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field label="Reason"><Input name="reason" /></Field>
      <div className="flex justify-end"><Button type="submit" variant="danger">Reject invoice</Button></div>
    </ActionForm>
  );
}
