"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardSection } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { previewWorkflowAction, saveWorkflowAction, type LevelInput, type PreviewRow } from "@/lib/approvals/actions";
import { APPROVAL_MODES, APPROVER_TYPES, DOC_TYPES } from "@/lib/approvals/meta";
import ActionForm from "@/components/ActionForm";

export interface WorkflowInit {
  id: number; name: string; document_type: string; description: string; priority: number; is_active: boolean;
  condition_min_amount: number | null; condition_max_amount: number | null; condition_department_id: number | null; condition_project_category: string | null;
}
type Opt = { id: number; name: string };
const CATEGORIES = ["road", "cable", "pipeline", "telecom", "civil", "other"];

const blankLevel = (): LevelInput => ({
  name: "", approver_type: "role", approver_role_id: null, approver_user_id: null, approver_department_id: null, approval_mode: "any", min_approvals: 1, min_amount: null, sla_hours: 48, allow_self_approval: false,
});

/** Workflow designer: header fields, conditions, levels builder (add / remove / reorder) and a live preview by sample amount. */
export default function WorkflowEditor({ init, initialLevels, roles, users, departments, canEdit }: {
  init: WorkflowInit; initialLevels: LevelInput[]; roles: Opt[]; users: Opt[]; departments: Opt[]; canEdit: boolean;
}) {
  const [levels, setLevels] = useState<LevelInput[]>(initialLevels.length ? initialLevels : [blankLevel()]);
  const [type, setType] = useState(init.document_type || "sub_invoice");
  const [sample, setSample] = useState("100000");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const patch = (i: number, p: Partial<LevelInput>) => setLevels((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const move = (i: number, d: -1 | 1) => setLevels((ls) => { const j = i + d; if (j < 0 || j >= ls.length) return ls; const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const levelsJson = JSON.stringify(levels);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      previewWorkflowAction(levelsJson, Number(sample) || 0, type).then((r) => { if (live) setPreview(r); }).catch(() => { if (live) setPreview([]); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [levelsJson, sample, type]);

  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <ActionForm action={saveWorkflowAction} className="space-y-5">
      <input type="hidden" name="id" value={init.id} />
      <input type="hidden" name="levels_json" value={levelsJson} />
      <CardSection title="Workflow">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name"><Input name="name" defaultValue={init.name} required disabled={!canEdit} /></Field>
          <Field label="Document type">
            <Select name="document_type" value={type} onChange={(e) => setType(e.target.value)} disabled={!canEdit} options={DOC_TYPES.map((d) => ({ value: d.type, label: d.label }))} />
          </Field>
          <Field label="Priority" hint="Highest priority wins when several workflows match"><Input name="priority" type="number" defaultValue={init.priority} disabled={!canEdit} /></Field>
        </div>
        <Field label="Description" className="mt-3"><Textarea name="description" rows={2} defaultValue={init.description} disabled={!canEdit} /></Field>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Minimum amount" hint="Applies when amount is at or above"><Input name="condition_min_amount" type="number" step="any" min="0" defaultValue={init.condition_min_amount ?? ""} disabled={!canEdit} /></Field>
          <Field label="Maximum amount" hint="Applies when amount is below"><Input name="condition_max_amount" type="number" step="any" min="0" defaultValue={init.condition_max_amount ?? ""} disabled={!canEdit} /></Field>
          <Field label="Department"><Select name="condition_department_id" defaultValue={init.condition_department_id ?? ""} placeholder="Any" disabled={!canEdit} options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
          <Field label="Project category"><Select name="condition_project_category" defaultValue={init.condition_project_category ?? ""} placeholder="Any" disabled={!canEdit} options={CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="hidden" name="is_active" value="off" /><input type="checkbox" name="is_active" value="on" defaultChecked={init.is_active} disabled={!canEdit} />Active
        </label>
      </CardSection>

      <CardSection title="Approval levels" subtitle="Levels run in order. A level with a minimum amount is skipped for smaller documents."
        actions={canEdit ? <Button type="button" size="sm" variant="primary" onClick={() => setLevels((l) => [...l, blankLevel()])}><Plus size={13} />Add level</Button> : undefined}>
        <ol className="space-y-3">
          {levels.map((l, i) => {
            const n = i + 1;
            return (
              <li key={i} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3" data-level-row={n}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-800">Level {n}</span>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" aria-label={`Move level ${n} up`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={13} /></Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={`Move level ${n} down`} onClick={() => move(i, 1)} disabled={i === levels.length - 1}><ArrowDown size={13} /></Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={`Remove level ${n}`} onClick={() => setLevels((ls) => ls.filter((_, k) => k !== i))} disabled={levels.length === 1}><Trash2 size={13} /></Button>
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Level name"><Input aria-label={`Level ${n} name`} value={l.name} onChange={(e) => patch(i, { name: e.target.value })} disabled={!canEdit} /></Field>
                  <Field label="Approver type">
                    <Select aria-label={`Level ${n} approver type`} value={l.approver_type} onChange={(e) => patch(i, { approver_type: e.target.value as LevelInput["approver_type"] })} disabled={!canEdit} options={APPROVER_TYPES} />
                  </Field>
                  {l.approver_type === "role" && <Field label="Role"><Select aria-label={`Level ${n} role`} value={l.approver_role_id ?? ""} onChange={(e) => patch(i, { approver_role_id: num(e.target.value) })} placeholder="- select -" disabled={!canEdit} options={roles.map((r) => ({ value: r.id, label: r.name }))} /></Field>}
                  {l.approver_type === "user" && <Field label="User"><Select aria-label={`Level ${n} user`} value={l.approver_user_id ?? ""} onChange={(e) => patch(i, { approver_user_id: num(e.target.value) })} placeholder="- select -" disabled={!canEdit} options={users.map((r) => ({ value: r.id, label: r.name }))} /></Field>}
                  {(l.approver_type === "department" || l.approver_type === "department_head") && (
                    <Field label="Department" hint={l.approver_type === "department_head" ? "Empty = document's department" : undefined}>
                      <Select aria-label={`Level ${n} department`} value={l.approver_department_id ?? ""} onChange={(e) => patch(i, { approver_department_id: num(e.target.value) })} placeholder={l.approver_type === "department_head" ? "Document's department" : "- select -"} disabled={!canEdit} options={departments.map((r) => ({ value: r.id, label: r.name }))} />
                    </Field>
                  )}
                  <Field label="Approval mode"><Select aria-label={`Level ${n} mode`} value={l.approval_mode} onChange={(e) => patch(i, { approval_mode: e.target.value as LevelInput["approval_mode"] })} disabled={!canEdit} options={APPROVAL_MODES} /></Field>
                  {l.approval_mode === "min" && <Field label="Min approvals (N)"><Input aria-label={`Level ${n} min approvals`} type="number" min="1" value={l.min_approvals} onChange={(e) => patch(i, { min_approvals: Math.max(1, Number(e.target.value) || 1) })} disabled={!canEdit} /></Field>}
                  <Field label="Level min amount" hint="Skip level below this amount"><Input aria-label={`Level ${n} minimum amount`} type="number" min="0" step="any" value={l.min_amount ?? ""} onChange={(e) => patch(i, { min_amount: num(e.target.value) })} disabled={!canEdit} /></Field>
                  <Field label="SLA (hours)"><Input aria-label={`Level ${n} SLA hours`} type="number" min="0" value={l.sla_hours} onChange={(e) => patch(i, { sla_hours: Math.max(0, Number(e.target.value) || 0) })} disabled={!canEdit} /></Field>
                  <label className="flex items-end gap-2 pb-2 text-xs text-slate-700"><input type="checkbox" aria-label={`Level ${n} allow self approval`} checked={l.allow_self_approval} onChange={(e) => patch(i, { allow_self_approval: e.target.checked })} disabled={!canEdit} />Allow self-approval</label>
                </div>
              </li>
            );
          })}
        </ol>
      </CardSection>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <h3 className="text-sm font-extrabold tracking-tight text-dark">Live preview</h3>
          <label className="flex items-center gap-2 text-xs text-slate-600">Sample amount
            <input aria-label="Preview sample amount" type="number" min="0" value={sample} onChange={(e) => setSample(e.target.value)} className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
          </label>
        </div>
        <ol className="space-y-1.5 text-sm" data-testid="workflow-preview">
          {preview.map((p) => (
            <li key={p.levelNo} className={`flex flex-wrap items-center gap-2 ${p.applies ? "" : "opacity-50"}`} data-applies={p.applies ? "yes" : "no"}>
              <Badge tone={p.applies ? "green" : "slate"}>{p.applies ? "applies" : "skipped"}</Badge>
              <b>Level {p.levelNo}: {p.name || "(unnamed)"}</b>
              <span className="text-xs text-slate-500">mode: {p.mode}</span>
              <span className="text-slate-700">{p.note ?? (p.approvers.length ? p.approvers.join(", ") : "no approver found today")}</span>
            </li>
          ))}
          {preview.length === 0 && <li className="text-xs text-slate-400">Complete the levels to see a preview.</li>}
        </ol>
      </Card>

      {canEdit && <div className="flex justify-end gap-2"><Button type="submit" variant="primary">Save workflow</Button></div>}
    </ActionForm>
  );
}
