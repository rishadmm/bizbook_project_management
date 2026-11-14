"use client";
import { useActionState } from "react";
import { Field, Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { saveApprovalSettings, type ActionState } from "./actions";

export default function ApprovalSettingsForm({ threshold, currency, types, canEdit }: {
  threshold: string; currency: string; types: { type: string; label: string; required: boolean }[]; canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveApprovalSettings, null);
  return (
    <form action={action} className="space-y-4">
      <Field label={`Project cost approval threshold (${currency})`} hint="Manual project costs at or above this amount are routed through the approval workflow." className="max-w-sm">
        <Input name="approval_cost_threshold" type="number" min={0} step="any" required defaultValue={threshold} disabled={!canEdit} />
      </Field>
      <fieldset disabled={!canEdit}>
        <legend className="mb-1 text-sm font-semibold text-slate-800">Approval required by document type</legend>
        <p className="mb-2 text-xs text-slate-500">When on, a document cannot be auto-approved: if no approval workflow matches it, submitting is refused until a workflow is configured.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => (
            <label key={t.type} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" name={`approval_required_${t.type}`} defaultChecked={t.required} className="h-4 w-4 accent-primary" />{t.label}
            </label>
          ))}
        </div>
      </fieldset>
      {state?.error && <p role="alert" className="text-sm font-medium text-red-600">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm font-medium text-emerald-700">{state.message}</p>}
      {canEdit && <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save approval settings"}</Button>}
    </form>
  );
}
