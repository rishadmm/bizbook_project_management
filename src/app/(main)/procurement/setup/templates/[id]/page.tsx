import { notFound } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { Button, CardSection, Field, Input, PageHeader, Select, Table, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { EVAL_METHODS, STEP_KIND_LABEL } from "@/lib/rfx";
import { saveTemplateAction } from "@/features/procurement/actions";

export const metadata = { title: "Edit template" };
const err = "text-sm font-semibold text-red-600";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("procurement", "setup");
  const id = Number((await params).id);
  const db = getDb();
  const t = db.prepare("SELECT * FROM rfx_templates WHERE id = ?").get(id) as Record<string, number | string | null> | undefined;
  if (!t) notFound();
  const steps = db.prepare("SELECT * FROM rfx_template_steps WHERE template_id = ? ORDER BY sort").all(id) as { id: number; name: string; kind: string; gate: string; weight: number | null; pass_mark: number | null }[];
  const crit = db.prepare("SELECT c.* FROM rfx_template_criteria c JOIN rfx_template_steps s ON s.id = c.step_id WHERE s.template_id = ? ORDER BY s.sort, c.sort").all(id) as { id: number; step_id: number; criterion: string; max_score: number }[];
  const reqs = db.prepare("SELECT * FROM rfx_template_requirements WHERE template_id = ? ORDER BY sort, id").all(id) as { id: number; name: string; kind: string; mandatory: number; envelope: string; step_id: number | null }[];
  return (
    <>
      <PageHeader title={String(t.name)} description="Edits apply to tenders floated from now on. The last step (Commercial) is fixed." breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: "Templates", href: "/procurement/setup/templates" }, { label: String(t.name) }]} />
      <ActionForm action={saveTemplateAction} className="space-y-5" errorClassName={err}>
        <input type="hidden" name="id" value={id} />
        <CardSection title="General">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Name" className="md:col-span-2"><Input name="name" defaultValue={String(t.name)} required /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input type="checkbox" name="active" defaultChecked={!!t.active} />Active</label>
            <Field label="Description" className="md:col-span-3"><Textarea name="description" rows={2} defaultValue={String(t.description ?? "")} /></Field>
            <Field label="Evaluation method" className="md:col-span-3"><Select name="evaluation_method" defaultValue={String(t.evaluation_method)} options={EVAL_METHODS.map((m) => ({ value: m.value, label: m.label }))} /></Field>
            <Field label="Technical weight"><Input type="number" name="tech_weight" defaultValue={Number(t.tech_weight)} /></Field><Field label="Commercial weight"><Input type="number" name="commercial_weight" defaultValue={Number(t.commercial_weight)} /></Field>
            <Field label="Technical pass mark"><Input type="number" name="tech_pass_mark" defaultValue={Number(t.tech_pass_mark)} /></Field>
            <Field label="Bid bond %"><Input type="number" step="any" name="bid_bond_pct" defaultValue={Number(t.bid_bond_pct)} /></Field><Field label="Performance bond %"><Input type="number" step="any" name="performance_bond_pct" defaultValue={Number(t.performance_bond_pct)} /></Field>
            <Field label="Default validity (days)"><Input type="number" name="default_validity_days" defaultValue={Number(t.default_validity_days)} /></Field>
            <Field label="Minimum bidders (warn below)"><Input type="number" name="min_bidders" defaultValue={Number(t.min_bidders)} /></Field><Field label="Clarification closes N days before closing"><Input type="number" name="clarification_days_before_close" defaultValue={Number(t.clarification_days_before_close)} /></Field>
          </div>
        </CardSection>
        <CardSection title="Evaluation steps" flush>
          <Table><THead><TR><TH>#</TH><TH>Step</TH><TH>Kind</TH><TH>Gate</TH><TH>Pass mark</TH><TH>Weight</TH><TH>Criteria (max score)</TH></TR></THead>
            <TBody>{steps.map((s, i) => (<TR key={s.id}><TD>{i + 1}</TD><TD className="font-semibold">{s.name}</TD><TD>{STEP_KIND_LABEL[s.kind]}</TD><TD>{s.gate === "scored" ? "Scored" : "Pass / fail"}</TD>
              <TD>{s.gate === "scored" && s.kind !== "commercial" ? <Input name={`spass_${s.id}`} type="number" defaultValue={s.pass_mark ?? ""} className="!w-20" /> : "—"}</TD><TD>{s.gate === "scored" && s.kind !== "commercial" ? <Input name={`sweight_${s.id}`} type="number" defaultValue={s.weight ?? ""} className="!w-20" /> : "—"}</TD>
              <TD>{crit.filter((c) => c.step_id === s.id).map((c) => <label key={c.id} className="mr-3 inline-flex items-center gap-1 text-xs">{c.criterion} <Input name={`cmax_${c.id}`} type="number" defaultValue={c.max_score} className="!w-16" /></label>)}</TD></TR>))}</TBody></Table>
        </CardSection>
        <CardSection title="Requirements bidders must submit" flush>
          <Table><THead><TR><TH>Requirement</TH><TH>Kind</TH><TH>Envelope</TH><TH>Mandatory</TH><TH>Remove</TH></TR></THead>
            <TBody>{reqs.map((q) => (<TR key={q.id}><TD><Input name={`rname_${q.id}`} defaultValue={q.name} className="!min-w-[260px]" /></TD><TD className="text-xs">{q.kind}</TD>
              <TD><Select name={`renv_${q.id}`} defaultValue={q.envelope} options={[{ value: "technical", label: "Technical" }, { value: "commercial", label: "Commercial" }]} className="!w-32" /></TD>
              <TD><input type="checkbox" name={`rmand_${q.id}`} value="1" defaultChecked={!!q.mandatory} /></TD><TD><input type="checkbox" name={`rdel_${q.id}`} value="1" /></TD></TR>))}
              <TR><TD><Input name="new_req_name" placeholder="Add a requirement" /></TD><TD><Select name="new_req_kind" options={[{ value: "document", label: "Document" }, { value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "yes_no", label: "Yes / No" }]} className="!w-28" /></TD>
                <TD><Select name="new_req_env" options={[{ value: "technical", label: "Technical" }, { value: "commercial", label: "Commercial" }]} className="!w-32" /></TD><TD><input type="checkbox" name="new_req_mand" value="1" defaultChecked /></TD><TD>
                <Select name="new_req_step" placeholder="Step" options={steps.filter((s) => s.kind !== "commercial").map((s) => ({ value: s.id, label: s.name }))} className="!w-28" /></TD></TR></TBody></Table>
        </CardSection>
        <div><Button type="submit" variant="primary">Save template</Button></div>
      </ActionForm>
    </>
  );
}
