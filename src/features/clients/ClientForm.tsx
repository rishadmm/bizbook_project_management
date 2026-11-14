import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { statusOptions } from "@/lib/status";
import type { Client } from "@/lib/types";
import { saveClient } from "./actions";
import ActionForm from "@/components/ActionForm";

export function ClientForm({ client }: { client?: Client }) {
  return (
    <ActionForm action={saveClient} className="space-y-3">
      {client && <input type="hidden" name="id" value={client.id} />}
      <div className="grid grid-cols-[1fr_160px] gap-3">
        <Field label="Name"><Input name="name" required defaultValue={client?.name} /></Field>
        <Field label="Type"><Select name="type" defaultValue={client?.type ?? "government"} options={statusOptions("clientType")} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Contact person"><Input name="contact_person" defaultValue={client?.contact_person ?? ""} /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={client?.email ?? ""} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={client?.phone ?? ""} /></Field>
      </div>
      <Field label="Address"><Input name="address" defaultValue={client?.address ?? ""} /></Field>
      <Field label="Notes"><Textarea name="notes" rows={3} defaultValue={client?.notes ?? ""} /></Field>
      <div className="flex justify-end"><Button type="submit" variant="primary">Save client</Button></div>
    </ActionForm>
  );
}
