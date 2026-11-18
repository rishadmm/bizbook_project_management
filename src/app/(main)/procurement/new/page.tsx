import Link from "next/link";
import { Button, CardSection, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createRfxAction } from "@/features/procurement/actions";
import { listTemplates, projectOptions } from "@/features/procurement/queries";
import { stageAvailability } from "@/features/procurement/rfx-core";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "New supplier tender" };

export default async function NewRfx({ searchParams }: { searchParams: Promise<{ project?: string; stages?: string }> }) {
  await requirePage("procurement", "create");
  const entity = await getActiveEntity();
  const sp = await searchParams;
  const projects = projectOptions(entity.id);
  const projectId = Number(sp.project) || 0;
  const project = projects.find((p) => p.id === projectId);
  const stages = project ? stageAvailability(getDb(), project.id) : [];
  const preset = new Set((sp.stages ?? "").split(",").map(Number).filter(Boolean));
  const cats = getDb().prepare("SELECT id, name, group_name FROM supplier_categories WHERE active = 1 AND (entity_id IS NULL OR entity_id = ?) ORDER BY sort").all(entity.id) as { id: number; name: string; group_name: string }[];
  const tpls = listTemplates(entity.id).filter((t) => t.active);
  return (
    <>
      <PageHeader title="New supplier tender" description="Float a tender for a project, a sub-project or a set of stages. Tendering is optional: direct assignment stays available on the project." breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "New" }]} />
      <div className="mx-auto max-w-4xl space-y-5">
        <CardSection title="1. Project">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field label="Project" className="min-w-[260px] flex-1"><Select name="project" defaultValue={projectId || ""} placeholder="Choose a project" options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}${p.parent_id ? " (sub-project)" : ""}` }))} data-testid="project-select" /></Field>
            <Button type="submit" variant="secondary">Load stages</Button>
          </form>
        </CardSection>
        {project && (
          <ActionForm action={createRfxAction} className="space-y-5" errorClassName="text-sm font-semibold text-red-600">
            <input type="hidden" name="project_id" value={project.id} />
            <CardSection title="2. Scope" subtitle="Stages that are already assigned or already out to tender are disabled.">
              <div className="mb-3 flex flex-wrap gap-4 text-sm font-semibold text-slate-700">
                <label className="flex items-center gap-1.5"><input type="radio" name="scope_kind" value="stages" defaultChecked />Selected stages</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="scope_kind" value="subproject" disabled={!project.parent_id} />Whole sub-project</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="scope_kind" value="project" />Whole project</label>
              </div>
              <ul className="divide-y divide-slate-100 rounded-xl border border-line">
                {stages.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" name="stage" value={s.id} disabled={!!s.blocked} defaultChecked={!s.blocked && preset.has(s.id)} data-testid={`stage-${s.id}`} />
                    <span className="font-semibold text-slate-800">{s.code} · {s.name}</span>
                    <span className="text-xs text-slate-500">{formatMoney(s.budget_amount, { compact: true })} budget</span>
                    {s.blocked && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">{s.blocked}</span>}
                  </li>
                ))}
              </ul>
            </CardSection>
            <CardSection title="3. Tender">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Title" className="md:col-span-2"><Input name="title" required placeholder="e.g. Fibre duct works - Link B section A" /></Field>
                <Field label="Scope of work" className="md:col-span-2"><Textarea name="description" rows={3} /></Field>
                <Field label="Supplier category"><Select name="category_id" required placeholder="Choose" options={cats.map((c) => ({ value: c.id, label: `${c.group_name} · ${c.name}` }))} /></Field>
                <Field label="Template"><Select name="template_id" required placeholder="Choose" options={tpls.map((t) => ({ value: t.id, label: t.name }))} /></Field>
                <Field label="Procedure"><Select name="procedure" defaultValue="open" options={[{ value: "open", label: "Open (all approved suppliers of the category)" }, { value: "selective", label: "Selective (invited suppliers only)" }]} /></Field>
              </div>
            </CardSection>
            <div className="flex justify-end gap-2"><Link href="/procurement" className="px-3 py-2 text-sm font-bold text-slate-500">Cancel</Link><Button type="submit" variant="primary">Create draft</Button></div>
          </ActionForm>
        )}
      </div>
    </>
  );
}
