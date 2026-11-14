import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { statusOptions } from "@/lib/status";
import type { Assignment, Stage } from "@/lib/types";
import { saveAssignment, saveIssue, saveStage, addManualCost, createSubProject, saveCertificate } from "../actions";
import type { IssueRow } from "../queries";
import RecordInvoiceForm from "@/features/invoices/components/RecordInvoiceForm";
import type { BoqItem } from "@/features/invoices/calc";

type Opt = { value: string | number; label: string };
const units = [{ value: "km", label: "km" }, { value: "m", label: "m" }, { value: "sqm", label: "sqm" }, { value: "nos", label: "nos" }, { value: "lumpsum", label: "lump sum" }];
const submit = (label: string) => <div className="flex justify-end pt-1"><Button type="submit" variant="primary">{label}</Button></div>;

export function StageForm({ projectId, stage }: { projectId: number; stage?: Stage }) {
  return (
    <form action={saveStage} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      {stage && <input type="hidden" name="id" value={stage.id} />}
      <div className="grid grid-cols-[100px_1fr] gap-3">
        <Field label="Code"><Input name="code" defaultValue={stage?.code ?? ""} placeholder="S1" /></Field>
        <Field label="Name"><Input name="name" required defaultValue={stage?.name} /></Field>
      </div>
      <Field label="Description"><Textarea name="description" rows={2} defaultValue={stage?.description ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Planned qty"><Input name="planned_quantity" type="number" step="any" defaultValue={stage?.planned_quantity ?? 0} /></Field>
        <Field label="Unit"><Select name="quantity_unit" options={units} defaultValue={stage?.quantity_unit ?? "km"} placeholder="—" /></Field>
        <Field label="Chainage from (km)"><Input name="chainage_from" type="number" step="any" defaultValue={stage?.chainage_from ?? ""} /></Field>
        <Field label="Chainage to (km)"><Input name="chainage_to" type="number" step="any" defaultValue={stage?.chainage_to ?? ""} /></Field>
        <Field label="Planned start"><Input name="planned_start" type="date" defaultValue={stage?.planned_start ?? ""} /></Field>
        <Field label="Planned end"><Input name="planned_end" type="date" defaultValue={stage?.planned_end ?? ""} /></Field>
        <Field label="Actual start"><Input name="actual_start" type="date" defaultValue={stage?.actual_start ?? ""} /></Field>
        <Field label="Actual end"><Input name="actual_end" type="date" defaultValue={stage?.actual_end ?? ""} /></Field>
        <Field label="Budget"><Input name="budget_amount" type="number" step="any" defaultValue={stage?.budget_amount ?? 0} /></Field>
        <Field label="Weight %" hint="Blank = by budget"><Input name="weight_pct" type="number" step="any" min="0" max="100" defaultValue={stage?.weight_pct ?? ""} /></Field>
        <Field label="Status" className="col-span-2"><Select name="status" options={statusOptions("stageStatus")} defaultValue={stage?.status ?? "not_started"} /></Field>
      </div>
      {submit(stage ? "Save stage" : "Create stage")}
    </form>
  );
}

export function AssignmentForm({ projectId, assignment, stages, subs }: { projectId: number; assignment?: Assignment; stages: Opt[]; subs: Opt[] }) {
  const a = assignment;
  return (
    <form action={saveAssignment} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      {a && <input type="hidden" name="id" value={a.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subcontractor"><Select name="subcontractor_id" required options={subs} defaultValue={a?.subcontractor_id ?? ""} placeholder="Select…" /></Field>
        <Field label="Stage"><Select name="stage_id" options={stages} defaultValue={a?.stage_id ?? ""} placeholder="Whole project" /></Field>
      </div>
      <Field label="Scope"><Textarea name="scope" rows={2} defaultValue={a?.scope ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Quantity"><Input name="quantity" type="number" step="any" defaultValue={a?.quantity ?? ""} /></Field>
        <Field label="Unit"><Select name="quantity_unit" options={units} defaultValue={a?.quantity_unit ?? "km"} placeholder="—" /></Field>
        <Field label="Unit rate"><Input name="unit_rate" type="number" step="any" defaultValue={a?.unit_rate ?? ""} /></Field>
        <Field label="Contract value" hint="Blank = qty × rate"><Input name="contract_value" type="number" step="any" defaultValue={a?.contract_value ?? ""} /></Field>
        <Field label="Start"><Input name="start_date" type="date" defaultValue={a?.start_date ?? ""} /></Field>
        <Field label="End"><Input name="end_date" type="date" defaultValue={a?.end_date ?? ""} /></Field>
        <Field label="Advance %"><Input name="advance_pct" type="number" step="any" min="0" max="100" defaultValue={a?.advance_pct ?? 0} /></Field>
        <Field label="Retention %"><Input name="retention_pct" type="number" step="any" min="0" max="100" defaultValue={a?.retention_pct ?? 5} /></Field>
        <Field label="Payment days"><Input name="payment_days" type="number" defaultValue={a?.payment_days ?? 30} /></Field>
        <Field label="Status" className="col-span-3"><Select name="status" options={statusOptions("assignmentStatus")} defaultValue={a?.status ?? "draft"} /></Field>
      </div>
      <Field label="Payment terms"><Textarea name="payment_terms" rows={2} defaultValue={a?.payment_terms ?? ""} /></Field>
      {submit(a ? "Save subcontract" : "Create subcontract")}
    </form>
  );
}

export function IssueForm({ projectId, issue, stages, assignments, today }: { projectId: number; issue?: IssueRow; stages: Opt[]; assignments: Opt[]; today: string }) {
  return (
    <form action={saveIssue} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      {issue && <input type="hidden" name="id" value={issue.id} />}
      <Field label="Title"><Input name="title" required defaultValue={issue?.title} /></Field>
      <Field label="Description"><Textarea name="description" rows={2} defaultValue={issue?.description ?? ""} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Responsibility"><Select name="responsibility" options={statusOptions("responsibility")} defaultValue={issue?.responsibility ?? "other"} /></Field>
        <Field label="Stage"><Select name="stage_id" options={stages} defaultValue={issue?.stage_id ?? ""} placeholder="—" /></Field>
        <Field label="Subcontract"><Select name="assignment_id" options={assignments} defaultValue={issue?.assignment_id ?? ""} placeholder="—" /></Field>
        <Field label="Impact (days)"><Input name="impact_days" type="number" step="any" min="0" defaultValue={issue?.impact_days ?? 0} /></Field>
        <Field label="Impact cost"><Input name="impact_cost" type="number" step="any" min="0" defaultValue={issue?.impact_cost ?? 0} /></Field>
        <Field label="Status"><Select name="status" options={statusOptions("issueStatus")} defaultValue={issue?.status ?? "open"} /></Field>
        <Field label="Raised on"><Input name="raised_on" type="date" defaultValue={issue?.raised_on ?? today} /></Field>
      </div>
      {submit(issue ? "Save issue" : "Raise issue")}
    </form>
  );
}

export function CostForm({ projectId, stages, today }: { projectId: number; stages: Opt[]; today: string }) {
  return (
    <form action={addManualCost} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <Field label="Description"><Input name="description" required /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category"><Select name="category" options={statusOptions("budgetCategory")} defaultValue="manpower" /></Field>
        <Field label="Stage"><Select name="stage_id" options={stages} placeholder="General / unallocated" /></Field>
        <Field label="Amount"><Input name="amount" type="number" step="any" min="0" required /></Field>
        <Field label="Date"><Input name="cost_date" type="date" defaultValue={today} /></Field>
      </div>
      {submit("Add cost")}
    </form>
  );
}

export function SubProjectForm({ parentId, users, unit, today }: { parentId: number; users: Opt[]; unit: string | null; today: string }) {
  void today;
  return (
    <form action={createSubProject} className="space-y-3">
      <input type="hidden" name="parent_id" value={parentId} />
      <Field label="Name"><Input name="name" required /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Region"><Input name="region" placeholder="inherits from parent" /></Field>
        <Field label="Location"><Input name="location" /></Field>
        <Field label="Contract value"><Input name="contract_value" type="number" step="any" min="0" defaultValue="0" /></Field>
        <Field label="Budget (cost)"><Input name="budget_cost" type="number" step="any" min="0" defaultValue="0" /></Field>
        <Field label="Start"><Input name="start_date" type="date" /></Field>
        <Field label="End"><Input name="end_date" type="date" /></Field>
        <Field label="Manager"><Select name="manager_id" options={users} placeholder="Same as parent" /></Field>
        <Field label={`Quantity (${unit ?? "unit"})`}><Input name="total_quantity" type="number" step="any" min="0" placeholder="auto from route slice" /></Field>
      </div>
      <div className="rounded-md bg-slate-50 p-3">
        <div className="mb-2 text-xs font-medium text-slate-600">Optional: take a slice of the parent route (km chainage)</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From (km)"><Input name="chainage_from" type="number" step="any" min="0" /></Field>
          <Field label="To (km)"><Input name="chainage_to" type="number" step="any" min="0" /></Field>
        </div>
      </div>
      <Field label="Description"><Textarea name="description" rows={2} /></Field>
      {submit("Create sub-project")}
    </form>
  );
}

export function InvoiceForm({ projectId, assignments, today, boq }: { projectId: number; assignments: Opt[]; today: string; boq: Record<number, BoqItem[]> }) {
  return <RecordInvoiceForm projectId={projectId} assignments={assignments.map((a) => ({ value: Number(a.value), label: a.label }))} today={today} boq={boq} />;
}

export function CertificateForm({ projectId, assignments, today }: { projectId: number; assignments: Opt[]; today: string }) {
  return (
    <form action={saveCertificate} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subcontract"><Select name="assignment_id" required options={assignments} placeholder="Select…" /></Field>
        <Field label="Type"><Select name="cert_type" options={statusOptions("certType")} defaultValue="partial" /></Field>
        <Field label="Certificate no." hint="Blank = auto"><Input name="cert_no" /></Field>
        <Field label="Date"><Input name="cert_date" type="date" defaultValue={today} /></Field>
        <Field label="% complete"><Input name="percent" type="number" step="any" min="0" max="100" /></Field>
        <Field label="Quantity"><Input name="quantity" type="number" step="any" min="0" /></Field>
      </div>
      <Field label="Remarks"><Textarea name="remarks" rows={2} /></Field>
      <Field label="Attachment"><input type="file" name="files" multiple className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="issue_now" defaultChecked /> Issue immediately</label>
      {submit("Save certificate")}
    </form>
  );
}
