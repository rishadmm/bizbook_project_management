import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { statusOptions } from "@/lib/status";
import type { Client, Tender, User } from "@/lib/types";

/** Shared new/edit tender form (server component). */
export function TenderForm({ action, tender, clients, users, defaultOwner, submitLabel }: {
  action: (form: FormData) => Promise<void>; tender?: Tender; clients: Client[]; users: User[]; defaultOwner?: number; submitLabel: string;
}) {
  return (
    <form action={action} className="space-y-4">
      {tender && <input type="hidden" name="id" value={tender.id} />}
      <Field label="Title"><Input name="title" required defaultValue={tender?.title} placeholder="e.g. Widening of E311 - Section 2" /></Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Type"><Select name="kind" defaultValue={tender?.kind ?? "tender"} options={statusOptions("tenderKind")} /></Field>
        <Field label="Category"><Select name="category" defaultValue={tender?.category ?? "road"} options={statusOptions("category")} /></Field>
        <Field label="Client" className="sm:col-span-2"><Select name="client_id" defaultValue={tender?.client_id ?? ""} placeholder="- none -" options={clients.map((c) => ({ value: c.id, label: c.name }))} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Location" className="sm:col-span-2"><Input name="location" defaultValue={tender?.location ?? ""} /></Field>
        <Field label="Quantity"><Input name="quantity" type="number" step="any" defaultValue={tender?.quantity ?? ""} /></Field>
        <Field label="Unit"><Select name="quantity_unit" defaultValue={tender?.quantity_unit ?? ""} placeholder="-" options={statusOptions("quantityUnit")} /></Field>
      </div>
      <Field label="Scope summary"><Textarea name="scope_summary" rows={3} defaultValue={tender?.scope_summary ?? ""} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Issue date"><Input name="issue_date" type="date" defaultValue={tender?.issue_date ?? ""} /></Field>
        <Field label="Clarification deadline"><Input name="clarification_deadline" type="date" defaultValue={tender?.clarification_deadline ?? ""} /></Field>
        <Field label="Submission deadline"><Input name="submission_deadline" type="date" defaultValue={tender?.submission_deadline ?? ""} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Estimated value"><Input name="estimated_value" type="number" step="any" min="0" defaultValue={tender?.estimated_value ?? ""} /></Field>
        <Field label="Bid bond amount"><Input name="bid_bond_amount" type="number" step="any" min="0" defaultValue={tender?.bid_bond_amount ?? ""} /></Field>
        <Field label="Win probability %"><Input name="probability_pct" type="number" min="0" max="100" defaultValue={tender?.probability_pct ?? ""} /></Field>
        <Field label="Owner"><Select name="owner_id" defaultValue={tender?.owner_id ?? defaultOwner ?? ""} placeholder="-" options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" variant="primary">{submitLabel}</Button></div>
    </form>
  );
}
