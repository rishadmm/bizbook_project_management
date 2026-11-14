"use client";
import { useServerForm } from "@/components/useServerForm";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { requestProfileChange, uploadCompanyDocument, type WorkState } from "../work-actions";

const Msg = ({ s }: { s: WorkState }) => (s?.error ? <p role="alert" className="text-sm font-semibold text-red-600">{s.error}</p> : s?.ok ? <p role="status" className="text-sm font-semibold text-emerald-700">{s.ok}</p> : null);

export function DocumentUploadForm({ types }: { types: { value: string; label: string }[] }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(uploadCompanyDocument, undefined);
  return (
    <form onSubmit={onSubmit} data-action-form="" className="grid gap-3 sm:grid-cols-2" data-testid="doc-upload-form">
      <Field label="Document type"><Select name="doc_type" options={types} defaultValue="trade_license" /></Field>
      <Field label="Reference no."><Input name="ref_no" /></Field>
      <Field label="Issue date"><Input type="date" name="issue_date" /></Field>
      <Field label="Expiry date"><Input type="date" name="expiry_date" /></Field>
      <Field label="File" className="sm:col-span-2"><Input type="file" name="file" required accept=".pdf,image/*,.doc,.docx" /></Field>
      <div className="space-y-2 sm:col-span-2"><Msg s={state} /><Button type="submit" variant="primary" disabled={pending}>{pending ? "Uploading…" : "Upload for review"}</Button></div>
    </form>
  );
}

export function ChangeRequestForm({ kind, current }: { kind: "bank" | "contact"; current: Record<string, string> }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(requestProfileChange, undefined);
  return (
    <form onSubmit={onSubmit} data-action-form="" className="grid gap-3 sm:grid-cols-2" data-testid={`change-form-${kind}`}>
      <input type="hidden" name="kind" value={kind} />
      {kind === "bank" ? (
        <>
          <Field label="Bank name"><Input name="bank_name" required defaultValue={current.bank_name} /></Field>
          <Field label="IBAN" hint="Current IBAN ends with the digits shown in the profile."><Input name="iban" required placeholder="AE.." className="font-mono" /></Field>
        </>
      ) : (
        <>
          <Field label="Contact person"><Input name="contact_person" defaultValue={current.contact_person} /></Field>
          <Field label="E-mail"><Input type="email" name="email" defaultValue={current.email} /></Field>
          <Field label="Phone"><Input name="phone" defaultValue={current.phone} /></Field>
          <Field label="Address"><Input name="address" defaultValue={current.address} /></Field>
        </>
      )}
      <Field label="Reason" className="sm:col-span-2"><Textarea name="reason" rows={2} placeholder="Why is this changing?" /></Field>
      <div className="space-y-2 sm:col-span-2"><Msg s={state} /><p className="text-xs text-slate-500">The change only takes effect once the project team approves it.</p><Button type="submit" variant="primary" disabled={pending}>{pending ? "Sending…" : "Send change request"}</Button></div>
    </form>
  );
}
