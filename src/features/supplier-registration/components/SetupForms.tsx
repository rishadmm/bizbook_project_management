import ActionForm from "@/components/ActionForm";
import { Button, Field, Input, Select } from "@/components/ui";
import { CATEGORY_GROUPS } from "@/lib/registration";
import { saveRegDocType, saveSupplierCategory } from "../review-actions";

const group = () => CATEGORY_GROUPS.map((g) => ({ value: g, label: g }));
const chk = "flex items-center gap-2 text-sm font-semibold text-slate-700";

export function CategoryForm({ entityId, cat }: { entityId: number; cat?: { id: number; name: string; code: string; group_name: string; active: number; entity_id: number | null } }) {
  return (
    <ActionForm action={saveSupplierCategory} className="space-y-3" errorClassName="text-xs font-semibold text-red-600">
      {cat && <input type="hidden" name="id" value={cat.id} />}
      <Field label="Name"><Input name="name" defaultValue={cat?.name ?? ""} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code"><Input name="code" defaultValue={cat?.code ?? ""} disabled={!!cat} placeholder="e.g. tel-cable" /></Field>
        <Field label="Group"><Select name="group_name" defaultValue={cat?.group_name ?? "Others"} options={group()} /></Field>
      </div>
      {!cat && <Field label="Applies to"><Select name="scope" defaultValue="all" options={[{ value: "all", label: "Every country" }, { value: String(entityId), label: "This country only" }]} /></Field>}
      <label className={chk}><input type="checkbox" name="active" defaultChecked={cat ? !!cat.active : true} className="h-4 w-4 accent-[#635bff]" />Active (offered in the registration)</label>
      <Button type="submit" variant="primary">{cat ? "Save category" : "Add category"}</Button>
    </ActionForm>
  );
}

export function DocTypeForm({ entityId, t }: { entityId: number; t?: { id: number; code: string; name: string; mandatory: number; needs_expiry: number; category_condition: string | null; active: number } }) {
  return (
    <ActionForm action={saveRegDocType} className="space-y-3" errorClassName="text-xs font-semibold text-red-600">
      <input type="hidden" name="entity_id" value={entityId} />{t && <input type="hidden" name="id" value={t.id} />}
      <Field label="Document name"><Input name="name" defaultValue={t?.name ?? ""} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code"><Input name="code" defaultValue={t?.code ?? ""} disabled={!!t} placeholder="e.g. insurance_car" /></Field>
        <Field label="Only for category group"><Select name="condition_group" defaultValue={t?.category_condition?.replace("group:", "") ?? ""} placeholder="Always required" options={group()} /></Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className={chk}><input type="checkbox" name="mandatory" defaultChecked={!!t?.mandatory} className="h-4 w-4 accent-[#635bff]" />Mandatory</label>
        <label className={chk}><input type="checkbox" name="needs_expiry" defaultChecked={!!t?.needs_expiry} className="h-4 w-4 accent-[#635bff]" />Has an expiry date</label>
        <label className={chk}><input type="checkbox" name="active" defaultChecked={t ? !!t.active : true} className="h-4 w-4 accent-[#635bff]" />Active</label>
      </div>
      <Button type="submit" variant="primary">{t ? "Save document type" : "Add document type"}</Button>
    </ActionForm>
  );
}
