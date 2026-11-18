import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import ActionForm from "@/components/ActionForm";
import type { Entity } from "@/lib/entities";
import { saveEntity } from "../actions";

/** Country (entity) editor: legal details, currency, tax label / number, VAT, map centre, document prefix, approval threshold, status. */
export default function EntityForm({ entity, currencies, locked }: { entity: Entity; currencies: { code: string; name: string }[]; locked: boolean }) {
  return (
    <ActionForm action={saveEntity} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={entity.id} />
      <Field label="Country"><Input name="country" required defaultValue={entity.country} /></Field>
      <div className="grid grid-cols-[1fr_72px] gap-3">
        <Field label="Short name"><Input name="short_name" required maxLength={12} defaultValue={entity.short_name} /></Field>
        <Field label="Flag"><Input name="flag" maxLength={8} defaultValue={entity.flag ?? ""} /></Field>
      </div>
      <Field label="Legal name" className="sm:col-span-2"><Input name="legal_name" required defaultValue={entity.legal_name} /></Field>
      <Field label="Currency" hint={locked ? "Locked: the country already has documents." : undefined}>
        <Select name="currency" defaultValue={entity.currency} disabled={locked} options={currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
        {locked && <input type="hidden" name="currency" value={entity.currency} />}
      </Field>
      <Field label="VAT rate (%)"><Input name="vat_rate" type="number" step="any" min={0} max={100} required defaultValue={entity.vat_rate} /></Field>
      <Field label="Tax registration label" hint="TRN, VATIN, GSTIN …"><Input name="tax_label" required maxLength={12} defaultValue={entity.tax_label} /></Field>
      <Field label="Tax registration no."><Input name="tax_no" defaultValue={entity.tax_no ?? ""} /></Field>
      <Field label="Commercial registration (CR) no."><Input name="cr_no" defaultValue={entity.cr_no ?? ""} /></Field>
      <Field label="Document prefix" hint={locked ? "Locked: part of every issued code." : 'Added to every code, e.g. "OM-" gives OM-PRJ-2026-001.'}>
        <Input name="doc_prefix" maxLength={6} defaultValue={entity.doc_prefix} readOnly={locked} />
      </Field>
      <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={entity.address ?? ""} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={entity.phone ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={entity.email ?? ""} /></Field>
      <Field label="Map centre" hint='"lat,lng", for example 23.588,58.383'><Input name="map_center" defaultValue={entity.map_center ?? ""} /></Field>
      <Field label="Time zone"><Input name="timezone" defaultValue={entity.timezone ?? ""} placeholder="Asia/Muscat" /></Field>
      <Field label={`Approval threshold (${entity.currency})`} hint="Manual project costs above this amount need approval."><Input name="approval_cost_threshold" type="number" step="any" min={0} required defaultValue={entity.approval_cost_threshold} /></Field>
      <Field label="Status"><Select name="status" defaultValue={entity.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /></Field>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary">Save country</Button></div>
    </ActionForm>
  );
}
