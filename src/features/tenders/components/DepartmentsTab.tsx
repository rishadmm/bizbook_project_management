import { Button } from "@/components/ui/Button";
import { CardSection, Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ModalButton } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusBadge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import { statusOptions } from "@/lib/status";
import type { Department, User } from "@/lib/types";
import { addSection, deleteSection, saveSection } from "../actions";
import type { SectionRow } from "../queries";

export function DepartmentsTab({ tenderId, sections, users, departments, locked }: { tenderId: number; sections: SectionRow[]; users: User[]; departments: Department[]; locked: boolean }) {
  const done = sections.filter((s) => s.status === "completed").length;
  const progress = sections.length ? (done / sections.length) * 100 : 0;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-[220px] flex-1"><div className="mb-1 text-sm font-medium text-slate-700">Overall completion: {done} of {sections.length} sections ({progress.toFixed(0)}%)</div><ProgressBar value={progress} tone={progress === 100 ? "green" : "blue"} /></div>
        {!locked && <ModalButton label="Add section" title="Add section" size="sm">
          <form action={addSection} className="space-y-3">
            <input type="hidden" name="tender_id" value={tenderId} />
            <Field label="Title"><Input name="title" required /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Department"><Select name="department_id" placeholder="-" options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Field>
              <Field label="Assignee"><Select name="assignee_id" placeholder="-" options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
              <Field label="Due"><Input name="due_date" type="date" /></Field>
            </div>
            <div className="flex justify-end"><Button type="submit" variant="primary">Add</Button></div>
          </form>
        </ModalButton>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((s) => (
          <CardSection key={s.id} title={<span className="flex items-center gap-2">{s.title}<StatusBadge kind="sectionStatus" value={s.status} /></span>} subtitle={`${s.department_name ?? "No department"}${s.assignee_name ? ` · ${s.assignee_name}` : ""}${s.due_date ? ` · due ${formatDate(s.due_date)}` : ""}`}>
            <form action={saveSection} className="space-y-3">
              <input type="hidden" name="id" value={s.id} />
              <Textarea name="content" rows={6} defaultValue={s.content ?? ""} placeholder={`${s.department_name ?? "Department"} contribution...`} disabled={locked} />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Status"><Select name="status" defaultValue={s.status} options={statusOptions("sectionStatus")} disabled={locked} /></Field>
                <Field label="Assignee"><Select name="assignee_id" defaultValue={s.assignee_id ?? ""} placeholder="-" options={users.map((u) => ({ value: u.id, label: u.name }))} disabled={locked} /></Field>
                <Field label="Due date"><Input name="due_date" type="date" defaultValue={s.due_date ?? ""} disabled={locked} /></Field>
              </div>
              {!locked && <div className="flex justify-between">
                <Button type="submit" variant="primary" size="sm">Save section</Button>
                <button formAction={deleteSection} className="text-xs text-slate-400 hover:text-red-600" formNoValidate>Remove</button>
              </div>}
            </form>
          </CardSection>
        ))}
      </div>
    </div>
  );
}
