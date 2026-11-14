"use client";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { submitPortalInvoice } from "@/features/portal/actions";
import AttachmentRows from "@/features/invoices/components/AttachmentRows";
import LinesEditor from "@/features/invoices/components/LinesEditor";
import type { BoqItem } from "@/features/invoices/calc";
import { SubmitButton } from "./SubmitButton";

/** Portal invoice: the subcontractor enters this-period quantities against the subcontract BOQ (rates are read-only), VAT is automatic, tax invoice copy required. */
export default function PortalInvoiceForm({ token, today, boq, vatRate, currency, defaults }: {
  token: string; today: string; boq: BoqItem[]; vatRate: number; currency: string; defaults: { name: string; email: string };
}) {
  return (
    <form action={submitPortalInvoice} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your invoice number"><Input name="sub_invoice_ref" required placeholder="As printed on your tax invoice" /></Field>
        <Field label="Invoice date"><Input type="date" name="invoice_date" defaultValue={today} required /></Field>
        <Field label="Period from"><Input type="date" name="period_from" /></Field>
        <Field label="Period to"><Input type="date" name="period_to" /></Field>
        <Field label="Submitted by"><Input name="submitted_by_name" defaultValue={defaults.name} required /></Field>
        <Field label="Contact email"><Input type="email" name="submitted_by_email" defaultValue={defaults.email} /></Field>
      </div>
      <LinesEditor boq={boq} vatRate={vatRate} currency={currency} />
      <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
      <AttachmentRows requireTaxInvoice />
      <SubmitButton>Submit invoice</SubmitButton>
    </form>
  );
}
