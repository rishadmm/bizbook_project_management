"use client";
import { useState } from "react";
import { useServerForm } from "@/components/useServerForm";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import AttachmentRows from "@/features/invoices/components/AttachmentRows";
import LinesEditor from "@/features/invoices/components/LinesEditor";
import type { BoqItem } from "@/features/invoices/calc";
import { submitInvoice, type WorkState } from "../work-actions";

/** Invoice submission of the login portal: same editor pieces as PortalInvoiceForm (BOQ lines, VAT, attachments) plus the subcontract selector. */
export default function SessionInvoiceForm({ assignments, defaultAssignment, today, vatRate, currency, defaults }: {
  assignments: { id: number; label: string; boq: BoqItem[] }[]; defaultAssignment?: number; today: string; vatRate: number; currency: string; defaults: { name: string; email: string };
}) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(submitInvoice, undefined);
  const [asg, setAsg] = useState(defaultAssignment ?? assignments[0]?.id);
  const cur = assignments.find((a) => a.id === asg);
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-4" data-testid="invoice-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subcontract" className="sm:col-span-2"><Select name="assignment_id" value={asg} onChange={(e) => setAsg(Number(e.target.value))} options={assignments.map((a) => ({ value: a.id, label: a.label }))} required /></Field>
        <Field label="Your invoice number"><Input name="sub_invoice_ref" required placeholder="As printed on your tax invoice" /></Field>
        <Field label="Invoice date"><Input type="date" name="invoice_date" defaultValue={today} required /></Field>
        <Field label="Period from"><Input type="date" name="period_from" /></Field>
        <Field label="Period to"><Input type="date" name="period_to" /></Field>
        <Field label="Submitted by"><Input name="submitted_by_name" defaultValue={defaults.name} required /></Field>
        <Field label="Contact email"><Input type="email" name="submitted_by_email" defaultValue={defaults.email} /></Field>
      </div>
      {cur && <LinesEditor key={cur.id} boq={cur.boq} vatRate={vatRate} currency={currency} />}
      <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
      <AttachmentRows requireTaxInvoice />
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Submitting…" : "Submit invoice"}</Button>
    </form>
  );
}
