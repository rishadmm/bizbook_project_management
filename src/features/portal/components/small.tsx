"use client";
import { Printer } from "lucide-react";
import { useServerForm } from "@/components/useServerForm";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import { requestCertificate, type WorkState } from "../work-actions";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className={buttonClass("secondary")}><Printer size={15} />{label}</button>;
}

export function RequestCertificateForm({ assignments, certTypes }: { assignments: { value: number; label: string; pct: number }[]; certTypes: { value: string; label: string }[] }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(requestCertificate, undefined);
  return (
    <form onSubmit={onSubmit} data-action-form="" className="grid gap-3 sm:grid-cols-2" data-testid="cert-request-form">
      <Field label="Subcontract"><Select name="assignment_id" options={assignments} required /></Field>
      <Field label="Certificate type"><Select name="cert_type" defaultValue="partial" options={certTypes} /></Field>
      <Field label="Completion %"><Input type="number" name="percent" step="0.1" min="0" max="100" required defaultValue={assignments[0]?.pct ?? 0} /></Field>
      <Field label="Supporting file"><Input type="file" name="file" /></Field>
      <Field label="Remarks" className="sm:col-span-2"><Textarea name="remarks" rows={2} /></Field>
      {state?.error && <p role="alert" className="text-sm font-semibold text-red-600 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={pending}>{pending ? "Sending…" : "Request certificate"}</Button></div>
    </form>
  );
}
