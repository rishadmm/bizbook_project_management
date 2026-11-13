"use client";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { addProgressReport } from "../actions";

type Opt = { value: string | number; label: string };
let seq = 0;
const nid = () => ++seq;

/** Add-progress-report form with dynamic manpower and material lines. */
export default function ProgressForm({ projectId, stages, assignments, responsibilities, today }: {
  projectId: number; stages: Opt[]; assignments: Opt[]; responsibilities: Opt[]; today: string;
}) {
  const [mp, setMp] = useState<number[]>([nid()]);
  const [mat, setMat] = useState<number[]>([]);
  return (
    <form action={addProgressReport} className="space-y-4">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Subcontract"><Select name="assignment_id" options={assignments} placeholder="— none (direct works) —" /></Field>
        <Field label="Stage" hint="Optional if the subcontract is tied to a stage"><Select name="stage_id" options={stages} placeholder="— from subcontract —" /></Field>
        <Field label="Report date"><Input type="date" name="report_date" defaultValue={today} required /></Field>
        <Field label="Quantity done (this period)"><Input type="number" step="any" min="0" name="quantity_done" required defaultValue="0" /></Field>
        <Field label="Equipment used"><Input name="equipment_used" placeholder="e.g. 2 excavators, 1 paver" /></Field>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manpower</span>
          <Button size="sm" variant="ghost" onClick={() => setMp((l) => [...l, nid()])}><Plus size={13} className="mr-1" />Add trade</Button></div>
        <div className="space-y-2">
          {mp.map((k) => (
            <div key={k} className="grid grid-cols-[1fr_90px_100px_32px] gap-2">
              <Input name="mp_trade" placeholder="Trade (e.g. Foreman)" /><Input name="mp_headcount" type="number" min="0" placeholder="Heads" /><Input name="mp_hours" type="number" min="0" step="any" placeholder="Hours" />
              <button type="button" className="rounded text-slate-400 hover:text-red-600" onClick={() => setMp((l) => l.filter((x) => x !== k))} aria-label="Remove"><X size={16} /></button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Materials consumed</span>
          <Button size="sm" variant="ghost" onClick={() => setMat((l) => [...l, nid()])}><Plus size={13} className="mr-1" />Add material</Button></div>
        {mat.length === 0 && <p className="text-xs text-slate-400">No materials. Verified material lines post to the cost ledger automatically.</p>}
        <div className="space-y-2">
          {mat.map((k) => (
            <div key={k} className="grid grid-cols-[1fr_70px_90px_100px_32px] gap-2">
              <Input name="mat_name" placeholder="Material" /><Input name="mat_unit" placeholder="Unit" /><Input name="mat_qty" type="number" step="any" min="0" placeholder="Qty" /><Input name="mat_cost" type="number" step="any" min="0" placeholder="Unit cost" />
              <button type="button" className="rounded text-slate-400 hover:text-red-600" onClick={() => setMat((l) => l.filter((x) => x !== k))} aria-label="Remove"><X size={16} /></button>
            </div>
          ))}
        </div>
      </div>

      <Field label="Work done"><Textarea name="work_done" rows={2} /></Field>
      <Field label="Issues / constraints"><Textarea name="issues" rows={2} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Delay (days)"><Input name="delay_days" type="number" step="any" min="0" defaultValue="0" /></Field>
        <Field label="Delay responsibility"><Select name="delay_responsibility" options={responsibilities} defaultValue="none" /></Field>
        <Field label="Delay cause"><Input name="delay_cause" /></Field>
      </div>
      <Field label="Photos"><input type="file" name="photos" multiple accept="image/*" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" /></Field>
      <div className="flex justify-end"><Button type="submit" variant="primary">Save report (auto-verified)</Button></div>
    </form>
  );
}
