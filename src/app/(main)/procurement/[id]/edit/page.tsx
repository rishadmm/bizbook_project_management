import { notFound, redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import ActionForm from "@/components/ActionForm";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { Badge, Button, CardSection, Field, Input, PageHeader, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { can, requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertRecordAccess } from "@/lib/entity-context";
import { decimalsOf, isoToLocalInput, COMMITTEE_ROLE_LABEL, LOCAL_TZ_LABEL } from "@/lib/rfx";
import {
  deleteRfxDraft, saveRfxBoq, saveRfxCommittee, saveRfxDates, saveRfxDetails, saveRfxInvitees, saveRfxRequirements, saveRfxTerms, submitPublish,
} from "@/features/procurement/actions";
import { procurementUsers, rfxHeader, listTemplates } from "@/features/procurement/queries";
import { boqOf, committeeOf, criteriaOf, publishBlockers, requirementsOf, stageAvailability, stepsOf } from "@/features/procurement/rfx-core";

export const metadata = { title: "Edit supplier tender" };
const err = "text-sm font-semibold text-red-600";

export default async function EditRfx({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePage("procurement", "edit");
  const { id: sid } = await params;
  const id = Number(sid);
  const r = rfxHeader(id);
  if (!r) notFound();
  await assertRecordAccess(r.entity_id);
  if (r.status !== "draft") redirect(`/procurement/${id}`);
  const db = getDb();
  const dec = decimalsOf(r.currency);
  const steps = stepsOf(db, id), criteria = criteriaOf(db, id), reqs = requirementsOf(db, id), boq = boqOf(db, id), board = committeeOf(db, id);
  const cats = db.prepare("SELECT id, name, group_name FROM supplier_categories WHERE active = 1 AND (entity_id IS NULL OR entity_id = ?) ORDER BY sort").all(r.entity_id) as { id: number; name: string; group_name: string }[];
  const tpls = listTemplates(r.entity_id).filter((t) => t.active || t.id === r.template_id);
  const users = procurementUsers(r.entity_id);
  const invitees = db.prepare("SELECT i.subcontractor_id id, s.name FROM rfx_invitations i JOIN subcontractors s ON s.id = i.subcontractor_id WHERE i.rfx_id = ? ORDER BY i.id").all(id) as { id: number; name: string }[];
  const approved = db.prepare("SELECT id, name FROM subcontractors WHERE entity_id = ? AND registration_status = 'approved' AND status = 'approved' ORDER BY name").all(r.entity_id) as { id: number; name: string }[];
  const blockers = publishBlockers(db, rfx(r));
  const stages = stageAvailability(db, r.project_id, id).filter((s) => boq.some((l) => l.stage_id === s.id) || true);
  const boqRows = [...boq.map((l) => ({ ...l })), ...Array.from({ length: 3 }, (_, i) => ({ id: 0, item_no: String(boq.length + i + 1), description: "", unit: "", quantity: 0, estimate_rate: 0, stage_id: null as number | null }))];
  const two = r.evaluation_method !== "lowest_compliant";
  return (
    <>
      <PageHeader title={`${r.code} · Draft`} description={r.title} breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: r.code, href: `/procurement/${id}` }, { label: "Edit" }]} badges={<StatusBadge kind="rfxStatus" value={r.status} />} />
      <div className="space-y-5">
        <CardSection title="1-2. Scope, procedure and template" subtitle={`${r.project_code} · ${r.project_name} · scope: ${r.scope_kind}`}>
          <ActionForm action={saveRfxDetails} className="grid gap-4 md:grid-cols-2" errorClassName={err}>
            <input type="hidden" name="id" value={id} />
            <Field label="Title" className="md:col-span-2"><Input name="title" defaultValue={r.title} required /></Field>
            <Field label="Scope of work" className="md:col-span-2"><Textarea name="description" rows={3} defaultValue={r.description ?? ""} /></Field>
            <Field label="Supplier category"><Select name="category_id" defaultValue={r.category_id ?? ""} placeholder="Choose" options={cats.map((c) => ({ value: c.id, label: `${c.group_name} · ${c.name}` }))} /></Field>
            <Field label="Procedure"><Select name="procedure" defaultValue={r.procedure} options={[{ value: "open", label: "Open (all approved suppliers of the category)" }, { value: "selective", label: "Selective (invited suppliers only)" }]} /></Field>
            <Field label="Template" hint="Changing the template replaces the steps and requirements below."><Select name="template_id" defaultValue={r.template_id ?? ""} options={tpls.map((t) => ({ value: t.id, label: t.name }))} /></Field>
            <Field label="Owner (procurement officer)"><Select name="owner_id" defaultValue={r.owner_id ?? ""} options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
            <div className="md:col-span-2"><Button type="submit" variant="primary" size="sm">Save</Button></div>
          </ActionForm>
        </CardSection>

        <CardSection title="3. Dates" subtitle={`Publish < clarification deadline < closing <= opening. Times are ${LOCAL_TZ_LABEL}.`}>
          <ActionForm action={saveRfxDates} className="grid gap-4 md:grid-cols-3" errorClassName={err}>
            <input type="hidden" name="id" value={id} />
            <Field label="Publish at"><Input type="datetime-local" name="publish_at" defaultValue={isoToLocalInput(r.publish_at)} /></Field>
            <Field label="Clarification deadline"><Input type="datetime-local" name="clarification_deadline" defaultValue={isoToLocalInput(r.clarification_deadline)} /></Field>
            <Field label="Closing (required)"><Input type="datetime-local" name="closing_at" defaultValue={isoToLocalInput(r.closing_at)} data-testid="closing-at" /></Field>
            <Field label="Opening"><Input type="datetime-local" name="opening_at" defaultValue={isoToLocalInput(r.opening_at)} /></Field>
            <Field label="Site visit"><Input type="datetime-local" name="site_visit_at" defaultValue={isoToLocalInput(r.site_visit_at)} /></Field>
            <Field label="Bid validity (days)"><Input type="number" name="validity_days" defaultValue={r.validity_days} min={1} /></Field>
            <Field label="Site visit note" className="md:col-span-3"><Input name="site_visit_note" defaultValue={r.site_visit_note ?? ""} /></Field>
            <div className="md:col-span-3"><Button type="submit" variant="primary" size="sm">Save dates</Button></div>
          </ActionForm>
        </CardSection>

        <CardSection title="4. Terms" subtitle="Copied to the subcontract on award.">
          <ActionForm action={saveRfxTerms} className="grid gap-4 md:grid-cols-4" errorClassName={err}>
            <input type="hidden" name="id" value={id} />
            <Field label={`Estimate (${r.currency}, internal)`} hint="Never shown to bidders."><Input type="number" step="any" name="estimate" defaultValue={r.estimate ?? ""} /></Field>
            <Field label="Bid bond %"><Input type="number" step="any" name="bid_bond_pct" defaultValue={r.bid_bond_pct} /></Field>
            <Field label="Performance bond %"><Input type="number" step="any" name="performance_bond_pct" defaultValue={r.performance_bond_pct} /></Field>
            <Field label="Advance %"><Input type="number" step="any" name="advance_pct" defaultValue={r.advance_pct} /></Field>
            <Field label="Retention %"><Input type="number" step="any" name="retention_pct" defaultValue={r.retention_pct} /></Field>
            <Field label="Payment days"><Input type="number" name="payment_days" defaultValue={r.payment_days} /></Field>
            <Field label="Contract start"><Input type="date" name="contract_start" defaultValue={r.contract_start ?? ""} /></Field>
            <Field label="Contract end"><Input type="date" name="contract_end" defaultValue={r.contract_end ?? ""} /></Field>
            <Field label="Payment terms" className="md:col-span-4"><Textarea name="payment_terms" rows={2} defaultValue={r.payment_terms ?? ""} /></Field>
            <div className="md:col-span-4"><Button type="submit" variant="primary" size="sm">Save terms</Button></div>
          </ActionForm>
        </CardSection>

        <CardSection title="5. Bill of quantities" subtitle="Prefilled from the project budget lines of the scope (rates = unit cost x the subcontract share). Bidders price every line.">
          <ActionForm action={saveRfxBoq} className="space-y-3" errorClassName={err}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="rows" value={boqRows.length} />
            <Table>
              <THead><TR><TH>Item</TH><TH>Description</TH><TH>Unit</TH><TH num>Quantity</TH><TH num>Estimate rate</TH><TH>Stage</TH></TR></THead>
              <TBody>
                {boqRows.map((l, i) => (
                  <TR key={i}>
                    <TD><Input name={`item_${i}`} defaultValue={l.item_no} className="!w-16" /></TD>
                    <TD><Input name={`desc_${i}`} defaultValue={l.description} className="!min-w-[220px]" /></TD>
                    <TD><Input name={`unit_${i}`} defaultValue={l.unit ?? ""} className="!w-20" /></TD>
                    <TD><Input name={`qty_${i}`} type="number" step="any" defaultValue={l.quantity || ""} className="!w-28 text-right" /></TD>
                    <TD><Input name={`rate_${i}`} type="number" step="any" defaultValue={l.estimate_rate || ""} className="!w-28 text-right" /></TD>
                    <TD><Select name={`stage_${i}`} defaultValue={l.stage_id ?? ""} placeholder="-" options={stages.map((s) => ({ value: s.id, label: s.code ?? s.name }))} className="!w-24" /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" name="set_estimate" value="1" defaultChecked />Set the estimate to the BOQ total ({dec} decimals)</label>
              <Button type="submit" variant="primary" size="sm">Save BOQ</Button>
            </div>
          </ActionForm>
          <ActionForm action={saveRfxBoq} className="mt-2" errorClassName={err}><input type="hidden" name="id" value={id} /><input type="hidden" name="mode" value="reprefill" /><Button type="submit" variant="secondary" size="sm">Rebuild from budget lines</Button></ActionForm>
        </CardSection>

        <CardSection title="6. Evaluation steps and requirements" subtitle="Copied from the template; edit freely while the tender is a draft.">
          <ActionForm action={saveRfxRequirements} className="space-y-4" errorClassName={err}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="rows" value={reqs.length + 2} />
            {two && <div className="grid gap-3 md:grid-cols-3">
              <Field label="Technical weight %"><Input type="number" name="tech_weight" defaultValue={r.tech_weight} /></Field>
              <Field label="Commercial weight %"><Input type="number" name="commercial_weight" defaultValue={r.commercial_weight} /></Field>
              <Field label="Technical pass mark"><Input type="number" name="tech_pass_mark" defaultValue={r.tech_pass_mark} /></Field></div>}
            <div className="space-y-2">
              {steps.map((s) => (
                <div key={s.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm"><span className="font-bold text-slate-800">{s.sort}. {s.name}</span><Badge tone={s.gate === "scored" ? "violet" : "slate"}>{s.gate === "scored" ? "scored" : "pass / fail"}</Badge>
                    {s.kind !== "commercial" && s.gate === "scored" && <><label className="flex items-center gap-1 text-xs">Pass mark <Input name={`spass_${s.id}`} type="number" defaultValue={s.pass_mark ?? ""} className="!w-20" /></label>
                      <label className="flex items-center gap-1 text-xs">Weight <Input name={`sweight_${s.id}`} type="number" defaultValue={s.weight ?? ""} className="!w-20" /></label></>}</div>
                  {criteria.filter((c) => c.step_id === s.id).length > 0 && <div className="mt-2 grid gap-2 md:grid-cols-2">{criteria.filter((c) => c.step_id === s.id).map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-slate-600"><span className="flex-1">{c.criterion}</span>max <Input name={`cmax_${c.id}`} type="number" defaultValue={c.max_score} className="!w-20" /></label>))}</div>}
                </div>
              ))}
            </div>
            <Table>
              <THead><TR><TH>Requirement</TH><TH>Kind</TH><TH>Envelope</TH><TH>Step</TH><TH>Mandatory</TH></TR></THead>
              <TBody>
                {[...reqs, ...Array.from({ length: 2 }, () => null)].map((q, i) => (
                  <TR key={i}>
                    <TD><input type="hidden" name={`rid_${i}`} value={q?.id ?? 0} /><Input name={`rname_${i}`} defaultValue={q?.name ?? ""} placeholder={q ? "" : "Add a requirement"} className="!min-w-[220px]" /><input type="hidden" name={`rhint_${i}`} value={q?.instructions ?? ""} /></TD>
                    <TD><Select name={`rkind_${i}`} defaultValue={q?.kind ?? "document"} options={[{ value: "document", label: "Document" }, { value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "yes_no", label: "Yes / No" }, { value: "date", label: "Date" }]} className="!w-28" /></TD>
                    <TD><Select name={`renv_${i}`} defaultValue={q?.envelope ?? "technical"} options={[{ value: "technical", label: "Technical" }, { value: "commercial", label: "Commercial" }]} className="!w-32" /></TD>
                    <TD><Select name={`rstep_${i}`} defaultValue={q?.step_id ?? ""} placeholder="-" options={steps.filter((s) => s.kind !== "commercial").map((s) => ({ value: s.id, label: s.name }))} className="!w-32" /></TD>
                    <TD><input type="checkbox" name={`rmand_${i}`} value="1" defaultChecked={q ? !!q.mandatory : true} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Button type="submit" variant="primary" size="sm">Save steps and requirements</Button>
          </ActionForm>
        </CardSection>

        <CardSection title="7. Tender board (committee)" subtitle="The board evaluates; scoring is limited to its members (chair, members and the secretary for their steps).">
          <Table>
            <THead><TR><TH>Member</TH><TH>Role</TH><TH>Evaluates</TH><TH className="w-12" /></TR></THead>
            <TBody>
              {board.map((m) => (
                <TR key={m.id}><TD className="font-semibold">{m.name}</TD><TD>{COMMITTEE_ROLE_LABEL[m.role]}</TD>
                  <TD className="text-xs">{m.steps ? (JSON.parse(m.steps) as number[]).map((x) => steps.find((s) => s.id === x)?.name).filter(Boolean).join(", ") || "none" : "all steps"}</TD>
                  <TD><ActionForm action={saveRfxCommittee}><input type="hidden" name="id" value={id} /><input type="hidden" name="op" value="remove" /><input type="hidden" name="member_id" value={m.id} /><button className="text-slate-400 hover:text-red-600" aria-label="Remove member"><Trash2 size={14} /></button></ActionForm></TD></TR>
              ))}
            </TBody>
          </Table>
          <ActionForm action={saveRfxCommittee} className="mt-3 flex flex-wrap items-end gap-3" errorClassName={err}>
            <input type="hidden" name="id" value={id} />
            <Field label="User"><Select name="user_id" placeholder="Choose" options={users.map((u) => ({ value: u.id, label: u.name }))} className="!w-52" /></Field>
            <Field label="Role"><Select name="role" defaultValue="member" options={Object.entries(COMMITTEE_ROLE_LABEL).map(([value, label]) => ({ value, label }))} className="!w-36" /></Field>
            <fieldset className="flex flex-wrap gap-3 text-xs font-semibold text-slate-600"><legend className="mb-1.5 text-xs font-bold text-slate-600">Steps evaluated (none ticked = all)</legend>
              {steps.filter((s) => s.kind !== "commercial").map((s) => <label key={s.id} className="flex items-center gap-1"><input type="checkbox" name="step" value={s.id} />{s.name}</label>)}</fieldset>
            <Button type="submit" variant="secondary" size="sm">Add / update member</Button>
          </ActionForm>
        </CardSection>

        {r.procedure === "selective" && (
          <CardSection title="9. Invited suppliers" subtitle="Only these suppliers receive the invitation and can bid.">
            <ul className="mb-3 flex flex-wrap gap-2">{invitees.map((i) => (
              <li key={i.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{i.name}
                <ActionForm action={saveRfxInvitees} className="inline"><input type="hidden" name="id" value={id} /><input type="hidden" name="op" value="remove" /><input type="hidden" name="sub_id" value={i.id} /><button aria-label={`Remove ${i.name}`} className="ml-1 text-slate-400 hover:text-red-600">×</button></ActionForm></li>))}
              {invitees.length === 0 && <li className="text-sm text-slate-400">No supplier invited yet.</li>}</ul>
            <ActionForm action={saveRfxInvitees} className="flex flex-wrap items-end gap-3" errorClassName={err}>
              <input type="hidden" name="id" value={id} />
              <Field label="Add supplier"><Select name="sub_id" placeholder="Choose" options={approved.filter((a) => !invitees.some((i) => i.id === a.id)).map((a) => ({ value: a.id, label: a.name }))} className="!w-72" /></Field>
              <Button type="submit" variant="secondary" size="sm">Invite</Button>
            </ActionForm>
          </CardSection>
        )}

        <AttachmentsPanel entityType="rfx" entityId={id} revalidate={`/procurement/${id}/edit`} title="8. Tender documents (visible to bidders)" />

        <CardSection title="Submit for approval" subtitle="Publication goes through the rfx_publish approval workflow (thresholds on the estimate).">
          {blockers.length > 0 ? <ul className="mb-3 list-disc pl-5 text-sm text-amber-700" data-testid="publish-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : <p className="mb-3 text-sm text-emerald-700">Ready to submit.</p>}
          <div className="flex flex-wrap items-end gap-3">
            {can(me, "procurement", "publish") && (
              <ActionForm action={submitPublish} className="flex flex-wrap items-end gap-3" errorClassName={err}>
                <input type="hidden" name="id" value={id} />
                <Field label="Note for approvers"><Input name="note" className="!w-72" /></Field>
                <Button type="submit" variant="primary" data-testid="submit-publish">Submit for approval</Button>
              </ActionForm>
            )}
            <ActionForm action={deleteRfxDraft}><input type="hidden" name="id" value={id} /><Button type="submit" variant="danger" size="sm">Delete draft</Button></ActionForm>
          </div>
        </CardSection>
        <ApprovalPanel type="rfx_publish" documentId={id} path={`/procurement/${id}/edit`} user={me} />
      </div>
    </>
  );
}
const rfx = (r: ReturnType<typeof rfxHeader>) => r as NonNullable<typeof r>;
