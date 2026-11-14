import { Button, Field, Input, Textarea } from "@/components/ui";
import type { Subcontractor } from "@/lib/types";
import ActionForm from "@/components/ActionForm";
import type { ActionResult } from "@/lib/action-result";

/** Profile fields form (create or edit). `action` is a server action. */
export function ProfileForm({ action, sub, submitLabel }: { action: (f: FormData) => Promise<ActionResult | void>; sub?: Subcontractor; submitLabel: string }) {
  const v = (k: keyof Subcontractor) => (sub?.[k] as string | number | null | undefined) ?? "";
  return (
    <ActionForm action={action} className="space-y-5">
      {sub && <input type="hidden" name="id" value={sub.id} />}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Company name *"><Input name="name" required defaultValue={v("name")} /></Field>
        <Field label="Trade"><Input name="trade" defaultValue={v("trade")} placeholder="e.g. Asphalt paving" /></Field>
        <Field label="Categories" hint="Comma separated"><Input name="categories" defaultValue={v("categories")} placeholder="road, civil" /></Field>
        <Field label="Contact person"><Input name="contact_person" defaultValue={v("contact_person")} /></Field>
        <Field label="Email"><Input type="email" name="email" defaultValue={v("email")} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={v("phone")} /></Field>
        <Field label="Address" className="md:col-span-3"><Input name="address" defaultValue={v("address")} /></Field>
        <Field label="Trade license no."><Input name="trade_license_no" defaultValue={v("trade_license_no")} /></Field>
        <Field label="Trade license expiry"><Input type="date" name="trade_license_expiry" defaultValue={v("trade_license_expiry")} /></Field>
        <Field label="Tax no."><Input name="tax_no" defaultValue={v("tax_no")} /></Field>
        <Field label="Bank"><Input name="bank_name" defaultValue={v("bank_name")} /></Field>
        <Field label="IBAN"><Input name="iban" defaultValue={v("iban")} /></Field>
        <Field label="Rating (0-5)"><Input type="number" step="0.1" min="0" max="5" name="rating" defaultValue={v("rating")} /></Field>
      </div>
      <Field label="Notes"><Textarea name="notes" rows={3} defaultValue={v("notes")} /></Field>
      <Button type="submit" variant="primary">{submitLabel}</Button>
    </ActionForm>
  );
}
