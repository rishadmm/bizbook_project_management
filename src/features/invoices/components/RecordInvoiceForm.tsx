"use client";
import { useCallback, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { createInvoice } from "@/features/projects/actions";
import { DEFAULT_VAT_RATE, type BoqItem } from "../calc";
import AttachmentRows from "./AttachmentRows";
import LinesEditor from "./LinesEditor";

/** Internal "Record invoice" form: subcontract, invoice references, line items (BOQ prefilled), VAT auto, attachments with category. */
export default function RecordInvoiceForm({ projectId, assignments, today, boq, currency = "AED" }: {
  projectId: number; assignments: { value: number; label: string }[]; today: string; boq: Record<number, BoqItem[]>; currency?: string;
}) {
  const [asg, setAsg] = useState("");
  const [claimed, setClaimed] = useState("");
  const [gross, setGross] = useState({ gross: 0, count: 0 });
  const onTotals = useCallback((t: { gross: number; count: number }) => setGross({ gross: t.gross, count: t.count }), []);
  const hasLines = gross.count > 0;
  return (
    <ActionForm action={createInvoice} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subcontract"><Select name="assignment_id" required options={assignments} placeholder="Select…" value={asg} onChange={(e) => setAsg(e.target.value)} /></Field>
        <Field label="Invoice no." hint="Blank = auto"><Input name="invoice_no" /></Field>
        <Field label="Subcontractor's invoice ref."><Input name="sub_invoice_ref" /></Field>
        <Field label="Invoice date"><Input name="invoice_date" type="date" defaultValue={today} /></Field>
        <Field label="Period from"><Input name="period_from" type="date" /></Field>
        <Field label="Period to"><Input name="period_to" type="date" /></Field>
      </div>
      {asg && boq[Number(asg)] && <LinesEditor key={asg} boq={boq[Number(asg)]} vatRate={DEFAULT_VAT_RATE} currency={currency} allowCustom onTotals={onTotals} />}
      <Field label="Claimed amount (incl. VAT)" hint={hasLines ? "Calculated from the line items." : "Enter the line quantities above, or type a lump claim here."}>
        <Input name="claimed_amount" type="number" step="any" min="0" value={hasLines ? gross.gross.toFixed(2) : claimed} readOnly={hasLines} onChange={(e) => setClaimed(e.target.value)} required={!hasLines} />
      </Field>
      <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
      <AttachmentRows />
      <div className="flex justify-end"><Button type="submit" variant="primary">Record invoice</Button></div>
    </ActionForm>
  );
}
