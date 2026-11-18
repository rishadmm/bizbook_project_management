import Link from "next/link";
import { CheckCircle2, ExternalLink, FileWarning } from "lucide-react";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatDate } from "@/lib/format";
import { LEGAL_FORMS, TURNOVER_BANDS, regionsOf, sectionLabel } from "@/lib/registration";
import { completeness, itemLabel, type Profile } from "../core";
import { saveCategories, saveCompany, saveContacts, saveExperience, saveHse, submitMyRegistration } from "../actions";
import RegForm from "./RegForm";
import DocUploadRow from "./DocUploadRow";
import { DocExpiryChip, ItemChip, RegistrationSummary } from "./summary";
import { getDb } from "@/lib/db";

const checkRow = "flex items-start gap-2.5 text-sm font-semibold text-slate-700";
const box = "mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#635bff]";
const grid2 = "grid gap-4 sm:grid-cols-2";

/** Reviewer's comment shown next to the field / section it is about. */
function Query({ p, kind, refKey }: { p: Profile; kind: "section" | "document"; refKey: string }) {
  const it = p.items.find((i) => i.item_kind === kind && i.item_ref === refKey);
  if (!it) return null;
  return (
    <div data-testid={`query-${refKey}`} className={cn("mb-4 flex flex-wrap items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm", it.status === "query" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")}>
      <ItemChip item={it} />{it.comment ? <span className="font-semibold">Reviewer: {it.comment}</span> : <span className="font-semibold">{it.status === "fixed" ? "You updated this after the query." : "Accepted by the reviewer."}</span>}
    </div>
  );
}

export function StepCompany({ p, back }: { p: Profile; back?: string }) {
  const s = p.sub, om = p.entityCode === "OM";
  return (
    <RegForm action={saveCompany} backHref={back} testId="step-company">
      <Query p={p} kind="section" refKey="company" />
      <Field label="Company legal name"><Input name="name" defaultValue={s.name} required /></Field>
      <div className={grid2}>
        <Field label="Legal form"><Select name="legal_form" defaultValue={s.legal_form ?? ""} placeholder="Choose…" options={LEGAL_FORMS.map((x) => ({ value: x, label: x }))} /></Field>
        <Field label="Year established"><Input name="year_established" type="number" min={1900} max={new Date().getFullYear()} defaultValue={s.year_established ?? ""} /></Field>
        <Field label={om ? "Commercial registration (CR) number" : "Trade licence number"}><Input name="cr_no" defaultValue={s.cr_no ?? ""} /></Field>
        <Field label={om ? "CR expiry date" : "Licence expiry date"}><Input name="cr_expiry" type="date" defaultValue={s.cr_expiry ?? ""} /></Field>
        <Field label={om ? "VAT number" : "VAT / TRN number"}><Input name="vat_no" defaultValue={s.vat_no ?? ""} /></Field>
        <Field label="Number of employees"><Input name="employees" type="number" min={1} defaultValue={s.employees ?? ""} /></Field>
        <Field label="Annual turnover"><Select name="turnover_band" defaultValue={s.turnover_band ?? ""} placeholder="Choose…" options={TURNOVER_BANDS.map((x) => ({ value: x, label: x }))} /></Field>
        <Field label="Company phone"><Input name="phone" type="tel" defaultValue={s.phone ?? ""} /></Field>
      </div>
      <Field label="Address"><Textarea name="address" rows={2} defaultValue={s.address ?? ""} /></Field>
      <Field label="Website (optional)"><Input name="website" defaultValue={s.website ?? ""} placeholder="https://" /></Field>
    </RegForm>
  );
}

export function StepCategories({ p, all, back }: { p: Profile; all: { id: number; name: string; group_name: string }[]; back: string }) {
  const have = new Set(p.categories.map((c) => c.category_id));
  const groups = [...new Set(all.map((c) => c.group_name))];
  return (
    <RegForm action={saveCategories} backHref={back} testId="step-categories">
      <Query p={p} kind="section" refKey="categories" />
      <div>
        <h3 className="mb-2 text-sm font-extrabold text-dark">Categories you offer</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <fieldset key={g} className="rounded-xl border border-line p-3"><legend className="px-1 text-xs font-extrabold uppercase tracking-wider text-primary">{g}</legend>
              <div className="space-y-1.5">{all.filter((c) => c.group_name === g).map((c) => <label key={c.id} className={checkRow}><input type="checkbox" name="cat" value={c.id} defaultChecked={have.has(c.id)} className={box} />{c.name}</label>)}</div></fieldset>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-extrabold text-dark">Regions you serve</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{regionsOf(p.entityCode).map((r) => <label key={r} className={checkRow}><input type="checkbox" name="region" value={r} defaultChecked={p.regions.includes(r)} className={box} />{r}</label>)}</div>
      </div>
      <Field label="Capacity note (optional)" hint="Crews, equipment and typical monthly output."><Textarea name="capacity_note" rows={3} defaultValue={p.sub.capacity_note ?? ""} /></Field>
    </RegForm>
  );
}

function ContactBlock({ role, title, p, required }: { role: string; title: string; p: Profile; required?: boolean }) {
  const c = p.contacts[role];
  return (
    <fieldset className="rounded-xl border border-line p-3.5"><legend className="px-1 text-xs font-extrabold uppercase tracking-wider text-primary">{title}{required ? " *" : ""}</legend>
      <div className={grid2}>
        <Field label="Name"><Input name={`${role}_name`} defaultValue={c?.name ?? ""} /></Field>
        <Field label="Job title"><Input name={`${role}_title`} defaultValue={c?.title ?? ""} /></Field>
        <Field label="Email"><Input name={`${role}_email`} type="email" defaultValue={c?.email ?? ""} /></Field>
        <Field label="Phone"><Input name={`${role}_phone`} type="tel" defaultValue={c?.phone ?? ""} /></Field>
      </div>
    </fieldset>
  );
}
export function StepContacts({ p, back }: { p: Profile; back: string }) {
  const s = p.sub;
  return (
    <RegForm action={saveContacts} backHref={back} testId="step-contacts">
      <Query p={p} kind="section" refKey="contacts" />
      <ContactBlock role="signatory" title="Authorised signatory" p={p} required />
      <ContactBlock role="finance" title="Finance contact" p={p} required />
      <ContactBlock role="hse" title="HSE contact (optional)" p={p} />
      <fieldset className="rounded-xl border border-line p-3.5"><legend className="px-1 text-xs font-extrabold uppercase tracking-wider text-primary">Bank details *</legend>
        <div className={grid2}>
          <Field label="Bank"><Input name="bank_name" defaultValue={s.bank_name ?? ""} /></Field>
          <Field label="Account name"><Input name="account_name" defaultValue={s.account_name ?? ""} /></Field>
          <Field label="IBAN" hint={`${p.entityCode === "OM" ? "Omani" : "UAE"} IBAN: ${p.entityCode}…, 23 characters`}><Input name="iban" defaultValue={s.iban ?? ""} placeholder={`${p.entityCode}07 0331 2345 6789 0123 456`} /></Field>
          <Field label="SWIFT / BIC"><Input name="swift" defaultValue={s.swift ?? ""} placeholder="EBILAEAD" /></Field>
        </div>
      </fieldset>
    </RegForm>
  );
}

export function StepHse({ p, back }: { p: Profile; back: string }) {
  const s = p.sub;
  return (
    <RegForm action={saveHse} backHref={back} testId="step-hse">
      <Query p={p} kind="section" refKey="hse" />
      <div className={grid2}>
        <Field label="Written HSE policy"><Select name="hse_has_policy" defaultValue={s.hse_has_policy === null || s.hse_has_policy === undefined ? "" : s.hse_has_policy ? "yes" : "no"} placeholder="Choose…" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} /></Field>
        <Field label="Lost-time injury (LTI) rate" hint="Per 200,000 man-hours, last 12 months"><Input name="hse_lti_rate" type="number" step="0.01" min={0} defaultValue={s.hse_lti_rate ?? ""} /></Field>
      </div>
      <fieldset><legend className="mb-2 text-xs font-bold text-slate-600">ISO certificates held</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">{([["iso_9001", "ISO 9001 (quality)"], ["iso_14001", "ISO 14001 (environment)"], ["iso_45001", "ISO 45001 (health & safety)"]] as const).map(([k, l]) => <label key={k} className={checkRow}><input type="checkbox" name={k} defaultChecked={!!s[k]} className={box} />{l}</label>)}</div></fieldset>
      {p.entityCode === "OM" && <Field label="In-Country Value (ICV) score, % (optional)" hint="From your ICV certificate, if you have one."><Input name="icv_score" type="number" step="0.1" min={0} max={100} defaultValue={s.icv_score ?? ""} /></Field>}
    </RegForm>
  );
}

export function StepExperience({ p, back }: { p: Profile; back: string }) {
  const rows = [...p.experience, ...Array.from({ length: Math.max(0, 6 - p.experience.length) }, () => null)];
  return (
    <RegForm action={saveExperience} backHref={back} testId="step-experience">
      <Query p={p} kind="section" refKey="experience" />
      <p className="text-sm text-slate-500">List at least <strong>2</strong> comparable projects you completed in the last five years (up to 6).</p>
      <div className="space-y-3">
        {rows.map((e, i) => (
          <fieldset key={i} className="rounded-xl border border-line p-3.5"><legend className="px-1 text-xs font-extrabold uppercase tracking-wider text-slate-500">Reference {i + 1}{i < 2 ? " *" : ""}</legend>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1.4fr_.8fr_.6fr]">
              <Field label="Client"><Input name={`client_${i}`} defaultValue={e?.client ?? ""} /></Field>
              <Field label="Project"><Input name={`project_${i}`} defaultValue={e?.project ?? ""} /></Field>
              <Field label={`Value (${p.entityCode === "OM" ? "OMR" : "AED"})`}><Input name={`value_${i}`} type="number" min={0} step="any" defaultValue={e?.value ?? ""} /></Field>
              <Field label="Year"><Input name={`year_${i}`} type="number" min={1990} max={new Date().getFullYear()} defaultValue={e?.year ?? ""} /></Field>
            </div>
            <Field label="Description (optional)" className="mt-3"><Input name={`description_${i}`} defaultValue={e?.description ?? ""} /></Field>
          </fieldset>
        ))}
      </div>
    </RegForm>
  );
}

export function StepDocuments({ p, back, next, canEdit }: { p: Profile; back: string; next: string; canEdit: boolean }) {
  const byCode = new Map(p.docs.filter((d) => d.doc_type_code).map((d) => [d.doc_type_code!, d]));
  const all = getDb().prepare("SELECT d.id, d.doc_type_code, d.version, d.created_at, d.review_status, d.review_comment, a.filename, d.attachment_id FROM subcontractor_documents d LEFT JOIN attachments a ON a.id = d.attachment_id WHERE d.subcontractor_id = ? AND d.doc_type_code IS NOT NULL AND d.is_current = 0 ORDER BY d.version DESC").all(p.sub.id) as
    { id: number; doc_type_code: string; version: number; created_at: string; review_status: string; review_comment: string | null; filename: string | null; attachment_id: number | null }[];
  const mandatoryMissing = p.required.filter((r) => r.mandatory && !byCode.get(r.code)?.attachment_id).length;
  return (
    <div className="space-y-4" data-testid="step-documents">
      <p className="text-sm text-slate-500">Upload each document as a PDF or image (max 10 MB). <strong>*</strong> marks mandatory documents. If a document is queried you upload a new version: the old one stays on file.</p>
      {p.required.map((r) => {
        const d = byCode.get(r.code);
        const olds = all.filter((x) => x.doc_type_code === r.code);
        return (
          <div key={r.code} id={`doc-${r.code}`} data-testid={`doc-${r.code}`} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-extrabold text-dark">{r.name}{r.mandatory && <span className="ml-1 text-red-600" title="Mandatory">*</span>}</h4>
              {d?.attachment_id ? <Badge tone="green"><CheckCircle2 size={11} className="mr-1" />Uploaded · v{d.version}</Badge> : <Badge tone={r.mandatory ? "red" : "slate"}>{r.mandatory ? "Missing" : "Optional"}</Badge>}
              {d && <DocStatus d={d} />}
              {d && <DocExpiryChip d={d} />}
              {d?.attachment_id && <a href={`/api/files/${d.attachment_id}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">{d.filename}<ExternalLink size={11} /></a>}
            </div>
            {r.condition && <p className="mt-1 text-xs text-slate-400">Required when you offer {r.condition.replace("group:", "").toLowerCase()} categories.</p>}
            {d?.review_status === "query" && d.review_comment && <p data-testid={`doc-query-${r.code}`} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"><FileWarning size={12} className="mr-1 inline" />Reviewer: {d.review_comment}</p>}
            {d?.attachment_id && d.expiry_date && <p className="mt-1 text-xs text-slate-500">Expires {formatDate(d.expiry_date)}{d.ref_no ? ` · ref ${d.ref_no}` : ""}</p>}
            {canEdit && <DocUploadRow code={r.code} needsExpiry={r.needs_expiry} hasFile={!!d?.attachment_id} current={d ? { ref_no: d.ref_no, issue_date: d.issue_date, expiry_date: d.expiry_date } : null} />}
            {olds.length > 0 && <p className="mt-2 text-xs text-slate-400">Earlier versions: {olds.map((o) => <a key={o.id} href={o.attachment_id ? `/api/files/${o.attachment_id}` : "#"} target="_blank" rel="noreferrer" className="mr-2 font-semibold text-slate-500 hover:text-primary">v{o.version} ({formatDate(o.created_at.slice(0, 10))})</a>)}</p>}
          </div>
        );
      })}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Link href={back} className="inline-flex h-11 items-center rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-5 text-sm font-bold text-slate-700 hover:border-primary hover:text-primary">Back</Link>
          <span className="text-xs font-semibold text-slate-500">{mandatoryMissing ? `${mandatoryMissing} mandatory document${mandatoryMissing === 1 ? "" : "s"} still missing` : "All mandatory documents uploaded"}</span>
          <Link href={next} data-testid="docs-continue" className="ml-auto inline-flex h-11 items-center rounded-xl bg-primary px-6 text-sm font-bold text-white shadow-brand-sm hover:bg-primary-dark">Continue to review</Link>
        </div>
      )}
    </div>
  );
}
function DocStatus({ d }: { d: Profile["docs"][number] }) {
  if (d.review_status === "accepted") return <Badge tone="green">Accepted</Badge>;
  if (d.review_status === "query") return <Badge tone="amber">Queried</Badge>;
  return d.attachment_id ? <Badge tone="blue">Pending review</Badge> : null;
}

export function StepReview({ p, back }: { p: Profile; back: string }) {
  const c = completeness(p);
  const resubmit = p.sub.registration_status === "referred_back";
  const open = p.pendingQueries;
  const blocked = !c.ok || (resubmit && open.length > 0);
  return (
    <div className="space-y-5" data-testid="step-review">
      <div className="rounded-xl border border-line p-4">
        <div className="mb-2 flex items-center justify-between text-sm font-bold"><span className="text-dark">Completeness</span><span data-testid="completeness-pct" className={c.ok ? "text-emerald-700" : "text-primary"}>{c.percent}%</span></div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", c.ok ? "bg-emerald-500" : "bg-primary")} style={{ width: `${c.percent}%` }} /></div>
        {!c.ok && (
          <ul className="mt-3 space-y-1 text-sm" data-testid="missing-list">{c.missing.map((m) => <li key={m.key}><Link href={`?step=${m.step}`} className="font-semibold text-red-700 hover:underline">{m.label}</Link><span className="text-slate-500"> · {sectionLabel(m.section) === m.section ? "Documents" : sectionLabel(m.section)}{m.detail ? ` · ${m.detail}` : ""}</span></li>)}</ul>
        )}
      </div>
      <RegistrationSummary p={p} editHref={(n) => `?step=${n}`} />
      {resubmit && open.length > 0 && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" data-testid="unfixed-note">{open.length} queried item{open.length === 1 ? "" : "s"} still need{open.length === 1 ? "s" : ""} to be changed: {open.map((i) => itemLabel(getDb(), p.sub.id, i, p.required)).join(", ")}.</p>}
      <RegForm action={submitMyRegistration} backHref={back} submitLabel={resubmit ? "Resubmit registration" : "Submit registration"} testId="submit-form" danger disabled={blocked}>
        <fieldset className="space-y-2.5 rounded-xl border border-line p-4"><legend className="px-1 text-sm font-extrabold text-dark">Declaration</legend>
          <label className={checkRow}><input type="checkbox" name="decl_accuracy" className={box} data-testid="decl-accuracy" />I confirm that all information and documents provided are accurate and complete.</label>
          <label className={checkRow}><input type="checkbox" name="decl_coi" className={box} data-testid="decl-coi" />I declare that I have no undisclosed conflict of interest with the company&apos;s staff or its clients.</label>
          <label className={checkRow}><input type="checkbox" name="decl_conduct" className={box} data-testid="decl-conduct" />I have read and will comply with the supplier code of conduct (ethics, anti-bribery, HSE and labour standards).</label>
        </fieldset>
        {blocked && <p className="text-xs font-semibold text-slate-500" data-testid="submit-blocked">Submit is enabled once every mandatory field and document is present{resubmit ? " and every queried item has been changed" : ""}.</p>}
      </RegForm>
    </div>
  );
}
