import Link from "next/link";
import { Check, Download, FileText } from "lucide-react";
import ActionForm from "@/components/ActionForm";
import { Badge, Button, CardSection, EmptyState, Field, Input, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { can, isAdminUser, type AuthUser } from "@/lib/auth";
import type { DB } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/format";
import { COMMITTEE_ROLE_LABEL, REQ_KIND_LABEL, STEP_KIND_LABEL, arithmeticCheck, countdown, formatLocal, isoToLocalInput, isTwoEnvelope } from "@/lib/rfx";
import {
  answerClarificationAction, closeBiddingAction, declareCoiAction, inviteMoreAction, issueAddendumAction, markComplianceAction, recommendAction, recordOpeningAction, requestFromBidderAction,
  saveScoresAction, signOffAction, startEvaluationAction, submitAwardAction, uploadRfxDocument, withdrawRecommendationAction, cancelRfxAction,
} from "../actions";
import { internalBids, internalPrices, internalResponses, registerNotes, sealOf, type SealedBid } from "../bid-core";
import { commercialGate, evaluate, type MatrixRow } from "../eval-core";
import { timelineOf, type rfxHeader } from "../queries";
import { boqOf, committeeOf, criteriaOf, evaluatorsOf, requirementsOf, stepsOf, tenderParticipants, type StepRow } from "../rfx-core";
import { CellChip, Sealed, errCls } from "./shared";

type H = NonNullable<ReturnType<typeof rfxHeader>>;
export interface TabCtx { r: H; me: AuthUser; db: DB }
const money = (v: number | null | undefined, c: string, dec = 2) => formatMoney(v, { currency: c, decimals: dec });
const dec = (c: string) => (c === "OMR" ? 3 : 2);
const LIFECYCLE = ["draft", "pending_approval", "published", "closed", "opening", "evaluation", "recommended", "award_pending", "awarded"] as const;

/* ------------------------------------------------------------------ Overview */
export function OverviewTab({ r, me, db }: TabCtx) {
  const steps = stepsOf(db, r.id);
  const idx = r.status === "scheduled" ? 2 : r.status === "cancelled" ? -1 : LIFECYCLE.indexOf(r.status as never);
  const invited = (db.prepare("SELECT COUNT(*) c FROM rfx_invitations WHERE rfx_id = ?").get(r.id) as { c: number }).c;
  const bidCount = internalBids(db, r.id).length;
  const stages = db.prepare("SELECT s.code, s.name FROM rfx_scope sc JOIN stages s ON s.id = sc.stage_id WHERE sc.rfx_id = ? ORDER BY s.sort", ).all(r.id) as { code: string | null; name: string }[];
  const asg = r.assignment_id ? (db.prepare("SELECT id, code FROM assignments WHERE id = ?").get(r.assignment_id) as { id: number; code: string }) : null;
  return (
    <div className="space-y-5">
      <CardSection title="Progress">
        <ol className="flex flex-wrap gap-2" data-testid="rfx-stepper">
          {LIFECYCLE.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1", i < idx ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : i === idx ? "bg-primary text-white ring-primary" : "bg-white text-slate-400 ring-line")}>
              {i < idx && <Check size={12} />}{s === "pending_approval" ? "Approval" : s === "award_pending" ? "Award approval" : s[0].toUpperCase() + s.slice(1)}</li>))}
          {r.status === "cancelled" && <li className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700 ring-1 ring-red-200">Cancelled</li>}
        </ol>
        <p className="mt-3 text-xs text-slate-500">Evaluation steps: {steps.map((s) => `${s.name} (${s.gate === "scored" ? "scored" : "pass / fail"})`).join(" → ")}</p>
        {r.cancel_reason && <p className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">Cancelled: {r.cancel_reason}</p>}
      </CardSection>
      <div className="grid gap-5 xl:grid-cols-2">
        <CardSection title="Scope">
          <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Project</dt><dd><Link href={`/projects/${r.project_id}`} className="font-semibold text-primary-dark hover:underline">{r.project_code} · {r.project_name}</Link></dd>
            <dt className="text-slate-500">Scope</dt><dd>{r.scope_kind === "stages" ? stages.map((s) => s.code ?? s.name).join(", ") : r.scope_kind === "subproject" ? "Whole sub-project" : "Whole project"}</dd>
            <dt className="text-slate-500">Category</dt><dd>{r.category_name ?? "—"}</dd>
            <dt className="text-slate-500">Procedure</dt><dd><StatusBadge kind="rfxProcedure" value={r.procedure} /></dd>
            <dt className="text-slate-500">Method</dt><dd><StatusBadge kind="rfxMethod" value={r.evaluation_method} />{r.evaluation_method !== "lowest_compliant" && <span className="ml-2 text-xs text-slate-500">{r.tech_weight}/{r.commercial_weight}, pass mark {r.tech_pass_mark}</span>}</dd>
            <dt className="text-slate-500">Owner</dt><dd>{r.owner_name ?? "—"}</dd>
            <dt className="text-slate-500">Estimate</dt><dd className="font-semibold">{money(r.estimate, r.currency, dec(r.currency))} <span className="text-xs font-normal text-slate-400">internal, never shown to bidders</span></dd>
            <dt className="text-slate-500">Suppliers</dt><dd>{invited} invited / eligible · {bidCount} bid{bidCount === 1 ? "" : "s"} received</dd>
            {asg && <><dt className="text-slate-500">Subcontract</dt><dd><Link href={`/projects/${r.project_id}?tab=subcontracts`} className="font-semibold text-primary-dark hover:underline">{asg.code}</Link> (source: tender)</dd></>}
          </dl>
          {r.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{r.description}</p>}
        </CardSection>
        <CardSection title="Key dates and terms">
          <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Publish</dt><dd>{formatLocal(r.publish_at)}</dd>
            <dt className="text-slate-500">Clarifications until</dt><dd>{formatLocal(r.clarification_deadline)}</dd>
            <dt className="text-slate-500">Site visit</dt><dd>{formatLocal(r.site_visit_at)}{r.site_visit_note ? ` · ${r.site_visit_note}` : ""}</dd>
            <dt className="text-slate-500">Closing</dt><dd className="font-semibold">{formatLocal(r.closing_at)} <span className="text-xs font-normal text-slate-400">{["published", "scheduled"].includes(r.status) ? countdown(r.closing_at) : ""}</span></dd>
            <dt className="text-slate-500">Opening</dt><dd>{formatLocal(r.opening_at)}</dd>
            <dt className="text-slate-500">Bid validity</dt><dd>{r.validity_days} days</dd>
            <dt className="text-slate-500">Bonds</dt><dd>bid {r.bid_bond_pct}% · performance {r.performance_bond_pct}%</dd>
            <dt className="text-slate-500">Payment</dt><dd>advance {r.advance_pct}% · retention {r.retention_pct}% · {r.payment_days} days</dd>
            <dt className="text-slate-500">Contract</dt><dd>{r.contract_start ?? "—"} → {r.contract_end ?? "—"}</dd>
          </dl>
        </CardSection>
      </div>
      <div className="flex flex-wrap gap-2">
        {r.status === "draft" && can(me, "procurement", "edit") && <Link href={`/procurement/${r.id}/edit`} className="rounded-[10px] bg-primary px-4 py-2 text-sm font-bold text-white">Edit draft</Link>}
        {r.status === "published" && can(me, "procurement", "open") && (isAdminUser(me) || r.owner_id === me.id) && (
          <ActionForm action={closeBiddingAction} errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><Button type="submit" variant="secondary" data-testid="close-bidding">Close bidding now</Button></ActionForm>)}
        {r.status === "awarded" && <a href={`/procurement/${r.id}/award-letter`} className="inline-flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-primary px-4 py-2 text-sm font-bold text-primary"><Download size={14} />Letter of Award (PDF)</a>}
        {!["awarded", "cancelled"].includes(r.status) && can(me, "procurement", "cancel") && (
          <ActionForm action={cancelRfxAction} className="flex items-end gap-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} />
            <Input name="reason" placeholder="Cancellation reason" className="!w-72" required /><Button type="submit" variant="danger" size="sm">Cancel tender</Button></ActionForm>)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Requirements & BOQ */
export function RequirementsTab({ r, db }: TabCtx) {
  const steps = stepsOf(db, r.id), crit = criteriaOf(db, r.id), reqs = requirementsOf(db, r.id), boq = boqOf(db, r.id);
  const total = boq.reduce((a, l) => a + l.quantity * l.estimate_rate, 0);
  return (
    <div className="space-y-5">
      <CardSection title="Evaluation steps" flush>
        <Table><THead><TR><TH>#</TH><TH>Step</TH><TH>Kind</TH><TH>Gate</TH><TH num>Pass mark</TH><TH num>Weight</TH><TH>Criteria</TH></TR></THead>
          <TBody>{steps.map((s) => (<TR key={s.id}><TD>{s.sort}</TD><TD className="font-semibold">{s.name}</TD><TD>{STEP_KIND_LABEL[s.kind]}</TD><TD>{s.gate === "scored" ? "Scored" : "Pass / fail"}</TD><TD num>{s.pass_mark ?? "—"}</TD><TD num>{s.weight ?? "—"}</TD>
            <TD className="text-xs">{crit.filter((c) => c.step_id === s.id).map((c) => `${c.criterion} (${c.max_score})`).join(" · ") || "—"}</TD></TR>))}</TBody></Table>
      </CardSection>
      <CardSection title="Bidder requirements" flush>
        <Table><THead><TR><TH>Requirement</TH><TH>Kind</TH><TH>Envelope</TH><TH>Feeds step</TH><TH>Mandatory</TH></TR></THead>
          <TBody>{reqs.map((q) => (<TR key={q.id}><TD className="font-semibold">{q.name}{q.instructions && <div className="text-xs font-normal text-slate-500">{q.instructions}</div>}</TD><TD>{REQ_KIND_LABEL[q.kind]}</TD><TD>{q.envelope}</TD><TD>{steps.find((s) => s.id === q.step_id)?.name ?? "—"}</TD><TD>{q.mandatory ? "Yes" : "No"}</TD></TR>))}</TBody></Table>
      </CardSection>
      <CardSection title="Bill of quantities" subtitle={`Internal estimate rates (never shown to bidders) · ${boq.length} lines`} flush>
        <Table><THead><TR><TH>Item</TH><TH>Description</TH><TH>Unit</TH><TH num>Quantity</TH><TH num>Estimate rate</TH><TH num>Estimate amount</TH></TR></THead>
          <TBody>{boq.map((l) => (<TR key={l.id}><TD>{l.item_no}</TD><TD>{l.description}</TD><TD>{l.unit}</TD><TD num>{formatNumber(l.quantity, 2)}</TD><TD num>{formatNumber(l.estimate_rate, dec(r.currency))}</TD><TD num>{formatNumber(l.quantity * l.estimate_rate, dec(r.currency))}</TD></TR>))}
            <TR className="bg-slate-50 font-bold"><TD colSpan={5}>Estimate total</TD><TD num>{formatNumber(total, dec(r.currency))}</TD></TR></TBody></Table>
      </CardSection>
    </div>
  );
}

/* ------------------------------------------------------------------ Suppliers */
export function SuppliersTab({ r, me, db }: TabCtx) {
  const rows = db.prepare(`SELECT i.subcontractor_id id, s.name, i.invited_at, i.viewed_at, i.intent, i.decline_reason, i.source FROM rfx_invitations i JOIN subcontractors s ON s.id = i.subcontractor_id WHERE i.rfx_id = ? ORDER BY s.name`).all(r.id) as
    { id: number; name: string; invited_at: string | null; viewed_at: string | null; intent: string; decline_reason: string | null; source: string }[];
  const seal = sealOf(db, r);
  const bidders = new Set(internalBids(db, r.id).filter((b) => b.subcontractor_id).map((b) => b.subcontractor_id));
  const more = db.prepare("SELECT id, name FROM subcontractors WHERE entity_id = ? AND registration_status = 'approved' AND status = 'approved' ORDER BY name").all(r.entity_id) as { id: number; name: string }[];
  return (
    <div className="space-y-5">
      <CardSection title="Invited / eligible suppliers" subtitle={seal.techOpen ? `${rows.length} suppliers` : `${rows.length} suppliers · who submitted a bid stays sealed until the opening`} flush>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="No invitations yet" description={r.status === "draft" ? "Invitations are created when the tender is published." : "Nobody was eligible."} /></div> : (
          <Table><THead><TR><TH>Supplier</TH><TH>Invited</TH><TH>Viewed</TH><TH>Intent</TH><TH>Bid</TH></TR></THead>
            <TBody>{rows.map((s) => (<TR key={s.id}><TD className="font-semibold"><Link href={`/subcontractors/${s.id}`} className="text-primary-dark hover:underline">{s.name}</Link>{s.source === "invited" && <Badge tone="violet" className="ml-2">Invited</Badge>}</TD>
              <TD className="text-xs">{s.invited_at?.slice(0, 10) ?? "—"}</TD><TD className="text-xs">{s.viewed_at ? s.viewed_at.slice(0, 10) : "—"}</TD>
              <TD><Badge tone={s.intent === "interested" ? "green" : s.intent === "declined" ? "red" : "slate"}>{s.intent}</Badge>{s.decline_reason && <div className="text-xs text-slate-500">{s.decline_reason}</div>}</TD>
              <TD>{seal.techOpen ? (bidders.has(s.id) ? <Badge tone="blue">Bid received</Badge> : "—") : <span className="text-xs text-slate-400">sealed</span>}</TD></TR>))}</TBody></Table>)}
      </CardSection>
      {r.status === "published" && can(me, "procurement", "edit") && (
        <CardSection title="Invite another supplier">
          <ActionForm action={inviteMoreAction} className="flex flex-wrap items-end gap-3" errorClassName={errCls}><input type="hidden" name="id" value={r.id} />
            <Field label="Supplier"><Select name="sub_id" placeholder="Choose" options={more.filter((m) => !rows.some((x) => x.id === m.id)).map((m) => ({ value: m.id, label: m.name }))} className="!w-72" /></Field>
            <Button type="submit" variant="secondary" size="sm">Send invitation</Button></ActionForm>
        </CardSection>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Clarifications + addenda */
export function ClarificationsTab({ r, me, db }: TabCtx) {
  const rows = db.prepare("SELECT id, question, asked_at, answer, published_at FROM rfx_clarifications WHERE rfx_id = ? ORDER BY id").all(r.id) as { id: number; question: string; asked_at: string; answer: string | null; published_at: string | null }[];
  return (
    <CardSection title="Questions and answers" subtitle="Answers are published anonymously to all bidders; the asker is never named.">
      {rows.length === 0 ? <EmptyState title="No questions yet" /> : (
        <ul className="space-y-4">{rows.map((c, i) => (
          <li key={c.id} className="rounded-xl border border-line p-4" data-testid="clarification">
            <div className="text-xs font-bold uppercase text-slate-400">Question {i + 1} · {c.asked_at.slice(0, 10)}</div>
            <p className="text-sm font-semibold text-slate-800">{c.question}</p>
            {c.answer ? <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><b>Answer</b> ({c.published_at?.slice(0, 10)}): {c.answer}</p>
              : can(me, "procurement", "edit") && !["awarded", "cancelled"].includes(r.status) ? (
                <ActionForm action={answerClarificationAction} className="mt-2 flex flex-wrap items-end gap-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="clarification_id" value={c.id} />
                  <Textarea name="answer" rows={2} placeholder="Answer (published to all bidders)" className="min-w-[300px] flex-1" required /><Button type="submit" variant="primary" size="sm">Publish answer</Button></ActionForm>) : <p className="mt-2 text-xs text-amber-600">Not answered yet.</p>}
          </li>))}</ul>)}
    </CardSection>
  );
}
export function AddendaTab({ r, me, db }: TabCtx) {
  const rows = db.prepare("SELECT a.*, (SELECT COUNT(*) FROM rfx_addendum_acks k WHERE k.addendum_id = a.id) acks FROM rfx_addenda a WHERE a.rfx_id = ? ORDER BY a.no").all(r.id) as { id: number; no: number; title: string; description: string | null; new_closing_at: string | null; issued_at: string; attachment_id: number | null; acks: number }[];
  const participants = tenderParticipants(db, r.id).length;
  return (
    <div className="space-y-5">
      <CardSection title="Addenda" subtitle="Each addendum notifies every bidder and invitee; bidders must acknowledge it before they can submit. Extending the closing date is always an addendum." flush>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="No addenda" /></div> : (
          <Table><THead><TR><TH>No.</TH><TH>Title</TH><TH>Issued</TH><TH>New closing</TH><TH>Acknowledged</TH><TH>File</TH></TR></THead>
            <TBody>{rows.map((a) => (<TR key={a.id}><TD>{a.no}</TD><TD className="font-semibold">{a.title}{a.description && <div className="text-xs font-normal text-slate-500">{a.description}</div>}</TD><TD className="text-xs">{a.issued_at.slice(0, 10)}</TD><TD className="text-xs">{a.new_closing_at ? formatLocal(a.new_closing_at) : "—"}</TD>
              <TD>{a.acks} / {participants}</TD><TD>{a.attachment_id ? <a href={`/api/files/${a.attachment_id}`} target="_blank" className="text-primary-dark hover:underline"><FileText size={14} className="inline" /> open</a> : "—"}</TD></TR>))}</TBody></Table>)}
      </CardSection>
      {r.status === "published" && can(me, "procurement", "edit") && (
        <CardSection title="Issue an addendum">
          <ActionForm action={issueAddendumAction} className="grid gap-3 md:grid-cols-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} />
            <Field label="Title"><Input name="title" required /></Field><Field label="New closing date (optional)"><Input type="datetime-local" name="new_closing_at" defaultValue="" /></Field>
            <Field label="Description" className="md:col-span-2"><Textarea name="description" rows={2} /></Field><Field label="Attachment (optional)"><input type="file" name="file" className="text-sm" /></Field>
            <div className="md:col-span-2"><Button type="submit" variant="primary" size="sm">Issue addendum</Button></div></ActionForm>
        </CardSection>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Opening */
export function OpeningTab({ r, me, db }: TabCtx) {
  const seal = sealOf(db, r);
  const two = isTwoEnvelope(r.evaluation_method);
  const bids = internalBids(db, r.id);
  const events = timelineOf(r.id).filter((e) => ["opening", "tech_opening", "commercial_opening"].includes(e.kind));
  const board = committeeOf(db, r.id);
  const canOpen = can(me, "procurement", "open");
  const nextKind = r.status === "closed" ? (two ? "tech_opening" : "opening") : r.status === "evaluation" && two && !seal.priceOpen ? "commercial_opening" : null;
  const gate = nextKind === "commercial_opening" ? commercialGate(db, r.id) : null;
  const notes = registerNotes(db, r.id);
  const minBid = (db.prepare("SELECT min_bidders m FROM rfx_tenders WHERE id = ?").get(r.id) as { m: number }).m;
  return (
    <div className="space-y-5">
      {!seal.techOpen && <Sealed>{bids.length} bid{bids.length === 1 ? "" : "s"} received and sealed. Until the tender board opening only the number, the submission time and the receipt hash are visible: no bidder, no content, no price.</Sealed>}
      <CardSection title="Bid register" subtitle={seal.techOpen ? "As recorded at the opening" : "Sealed"} flush
        actions={seal.techOpen && events.length > 0 ? <a href={`/procurement/${r.id}/opening-register`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-dark hover:underline"><Download size={13} />Opening register (PDF)</a> : undefined}>
        {bids.length === 0 ? <div className="p-5"><EmptyState title="No bids" /></div> : (
          <Table><THead><TR><TH>Bid</TH><TH>Bidder</TH><TH>Received at</TH><TH>Receipt hash</TH><TH>Bond</TH><TH>Status</TH></TR></THead>
            <TBody>{bids.map((b) => (<TR key={b.id} data-testid="bid-register-row"><TD className="font-semibold">{b.label}</TD><TD>{b.supplier_name ?? <span className="text-slate-400">sealed</span>}</TD><TD className="whitespace-nowrap text-xs">{formatLocal(b.submitted_at)}</TD>
              <TD className="font-mono text-[11px] text-slate-500" title={b.receipt_hash ?? ""}>{b.receipt_hash?.slice(0, 20)}…</TD><TD>{b.bid_bond_received === null ? "—" : b.bid_bond_received ? "Yes" : "No"}</TD><TD>{seal.techOpen ? <StatusBadge kind="rfxBidStatus" value={b.status} /> : <Badge tone="blue">Sealed</Badge>}</TD></TR>))}</TBody></Table>)}
        {notes.length > 0 && <div className="border-t border-line p-4 text-xs text-slate-600">{notes.map((n, i) => <div key={i}>{n.label}: {n.status.replace("_", " ")}{n.note ? ` - ${n.note}` : ""}</div>)}</div>}
        {bids.length > 0 && bids.length < minBid && <div className="border-t border-line bg-amber-50 p-3 text-xs font-semibold text-amber-700">Fewer bids than the minimum of {minBid}: the board should record why it proceeds.</div>}
      </CardSection>
      {events.map((e, i) => { const a = e.attendees_json ? JSON.parse(e.attendees_json) as { names: string[]; observers: string } : null; return (
        <CardSection key={i} title={e.kind === "commercial_opening" ? "Commercial opening" : e.kind === "tech_opening" ? "Technical opening" : "Opening"} subtitle={formatLocal(e.at)}>
          <p className="text-sm"><b>Attendees:</b> {a?.names.join(", ") || "—"}{a?.observers ? `; observer: ${a.observers}` : ""}</p>{e.minutes && <p className="mt-2 text-sm text-slate-600">{e.minutes}</p>}</CardSection>); })}
      {r.status === "opening" && canOpen && (
        <CardSection title="Start the evaluation"><ActionForm action={startEvaluationAction} errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><Button type="submit" variant="primary" data-testid="start-evaluation">Start evaluation</Button></ActionForm></CardSection>)}
      {nextKind && canOpen && (
        <CardSection title={nextKind === "commercial_opening" ? "Record the commercial opening" : two ? "Record the technical opening" : "Record the opening"}
          subtitle={nextKind === "commercial_opening" ? "Unseals the prices of the technically qualified bids only." : two ? "Only the technical envelopes open; prices stay sealed." : "All envelopes open."}>
          {gate ? <p className="text-sm font-semibold text-amber-700">{gate}</p> : (
            <ActionForm action={recordOpeningAction} className="space-y-3" errorClassName={errCls} >
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value={nextKind} />
              <div className="grid gap-3 md:grid-cols-2"><Field label="Opened at"><Input type="datetime-local" name="at" defaultValue={isoToLocalInput(new Date().toISOString())} /></Field><Field label="Observers (free text)"><Input name="observers" /></Field></div>
              <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-1 text-xs font-bold text-slate-600">Attendees (board members present)</legend>
                {board.map((m) => <label key={m.id} className="flex items-center gap-1.5"><input type="checkbox" name="attendee" value={m.user_id} defaultChecked />{m.name} <span className="text-xs text-slate-400">({COMMITTEE_ROLE_LABEL[m.role]})</span></label>)}</fieldset>
              {nextKind !== "commercial_opening" && bids.length > 0 && <div><div className="mb-1 text-xs font-bold text-slate-600">Bid register</div><ul className="space-y-1.5">{bids.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 text-sm"><span className="w-14 font-semibold">{b.label}</span><label className="flex items-center gap-1 text-xs"><input type="checkbox" name={`bond_${b.id}`} defaultChecked={r.bid_bond_pct > 0} />bid bond received</label><Input name={`note_${b.id}`} placeholder="Note (late, withdrawn …)" className="!w-64" /></li>))}</ul></div>}
              <Field label="Minutes"><Textarea name="minutes" rows={3} /></Field>
              <Button type="submit" variant="primary" data-testid="record-opening">Record opening</Button>
            </ActionForm>)}
        </CardSection>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Evaluation */
export function EvaluationTab({ r, me, db }: TabCtx) {
  const seal = sealOf(db, r);
  if (!seal.techOpen) return <Sealed>The bids are sealed. Record the opening first; evaluation starts after it.</Sealed>;
  const { steps, rows } = evaluate(db, r.id);
  const bids = new Map(internalBids(db, r.id).map((b) => [b.id, b]));
  const board = committeeOf(db, r.id);
  const mine = board.find((m) => m.user_id === me.id);
  const technical = steps.filter((s) => s.kind !== "commercial");
  const crit = criteriaOf(db, r.id);
  const evaluating = r.status === "evaluation";
  const myScores = db.prepare("SELECT bid_id, criterion_id, score, comment FROM rfx_scores WHERE evaluator_id = ? AND bid_id IN (SELECT id FROM rfx_bids WHERE rfx_id = ?)").all(me.id, r.id) as { bid_id: number; criterion_id: number; score: number; comment: string | null }[];
  const reqRequests = db.prepare("SELECT q.*, b.id bid FROM rfx_bid_requests q JOIN rfx_bids b ON b.id = q.bid_id WHERE q.rfx_id = ? ORDER BY q.id DESC").all(r.id) as { id: number; bid: number; kind: string; message: string; due_at: string | null; status: string; response: string | null }[];
  const label = (id: number) => bids.get(id)?.supplier_name ?? bids.get(id)?.label ?? `Bid ${id}`;
  return (
    <div className="space-y-5">
      <CardSection title="Evaluation matrix" subtitle="Bids x steps. A bid that fails a gate or scores below the pass mark is disqualified from the next steps." flush>
        <Table><THead><TR><TH>Bidder</TH>{technical.map((s) => <TH key={s.id}>{s.name}{s.pass_mark ? <span className="ml-1 font-normal normal-case text-slate-400">≥{s.pass_mark}</span> : ""}</TH>)}<TH num>Tech</TH><TH>Outcome</TH></TR></THead>
          <TBody>{rows.map((m: MatrixRow) => (<TR key={m.bidId} data-testid="matrix-row"><TD className="font-semibold">{label(m.bidId)}</TD>
            {technical.map((s, i) => { const c = m.cells[i]; return <TD key={s.id}>{c ? <CellChip state={c.state} score={c.score} done={c.done} total={c.total} /> : "—"}</TD>; })}
            <TD num>{m.tech === null ? "—" : m.tech.toFixed(1)}</TD>
            <TD className="max-w-[260px] text-xs">{m.dq ? <span className="text-red-600" data-testid="dq-reason">Disqualified: {m.dq.reason}</span> : m.qualified ? <Badge tone="teal">Qualified</Badge> : <span className="text-slate-400">in progress</span>}</TD></TR>))}</TBody></Table>
      </CardSection>
      {evaluating && mine && ["chair", "member", "secretary"].includes(mine.role) && !mine.coi_declared_at && (
        <CardSection title="Conflict of interest declaration" subtitle="Required before you can score. A declared conflict excludes you from scoring this tender.">
          <ActionForm action={declareCoiAction} className="flex flex-wrap items-end gap-3" errorClassName={errCls}><input type="hidden" name="id" value={r.id} />
            <Field label="Are you linked to any bidder?"><Select name="conflict" defaultValue="no" options={[{ value: "no", label: "No conflict" }, { value: "yes", label: "Yes, I have a conflict" }]} className="!w-48" /></Field>
            <Field label="Details (if yes)"><Input name="note" className="!w-72" /></Field><Button type="submit" variant="primary" size="sm" data-testid="declare-coi">Declare</Button></ActionForm>
        </CardSection>)}
      {evaluating && mine?.coi_conflict ? <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-700">You declared a conflict of interest: you cannot score this tender.</p> : null}
      {evaluating && mine && mine.coi_declared_at && !mine.coi_conflict && technical.map((s) => evaluatorsOf(db, r.id, s.id).some((e) => e.user_id === me.id) && (
        <CardSection key={s.id} title={`Your evaluation: ${s.name}`} subtitle={s.gate === "scored" ? `Score each criterion 0 to its maximum (pass mark ${s.pass_mark ?? r.tech_pass_mark}).` : "Mark each requirement compliant or non-compliant."}>
          <div className="space-y-4">{rows.filter((m) => { const c = m.cells.find((x) => x.stepId === s.id); return c && !["skipped", "locked"].includes(c.state); }).map((m) => (
            <div key={m.bidId} className="rounded-xl border border-line p-3" data-testid={`eval-${s.step_key}`}>
              <div className="mb-2 text-sm font-bold text-slate-800">{label(m.bidId)}</div>
              {s.gate === "scored" ? (
                <ActionForm action={saveScoresAction} className="space-y-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="bid_id" value={m.bidId} /><input type="hidden" name="step_id" value={s.id} />
                  {crit.filter((c) => c.step_id === s.id).map((c) => { const mineS = myScores.find((x) => x.bid_id === m.bidId && x.criterion_id === c.id); return (
                    <div key={c.id} className="grid items-center gap-2 md:grid-cols-[1fr_90px_1fr]"><div className="text-sm">{c.criterion} <span className="text-xs text-slate-400">max {c.max_score}</span></div>
                      <Input type="number" step="0.5" min={0} max={c.max_score} name={`score_${c.id}`} defaultValue={mineS?.score ?? ""} data-testid={`score-${c.id}`} /><Input name={`comment_${c.id}`} placeholder="Comment" defaultValue={mineS?.comment ?? ""} /></div>); })}
                  <Button type="submit" variant="primary" size="sm">Save scores</Button></ActionForm>
              ) : (
                <ul className="space-y-2">{internalResponses(db, m.bidId).filter((q) => q.step_id === s.id && q.envelope === "technical").map((q) => (
                  <li key={q.requirement_id} className="flex flex-wrap items-center gap-3 text-sm"><span className="min-w-[200px] flex-1">{q.name}{q.attachment_id ? <a href={`/api/files/${q.attachment_id}`} target="_blank" className="ml-2 text-xs text-primary-dark hover:underline">open file</a> : q.value_text ? <span className="ml-2 text-xs text-slate-500">&ldquo;{q.value_text}&rdquo;</span> : null}</span>
                    {q.compliant !== null && <Badge tone={q.compliant ? "green" : "red"}>{q.compliant ? "Compliant" : "Non-compliant"}</Badge>}
                    <ActionForm action={markComplianceAction} className="flex items-center gap-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="bid_id" value={m.bidId} /><input type="hidden" name="requirement_id" value={q.requirement_id} /><input type="hidden" name="decision" value="compliant" />
                      <Button type="submit" variant="success" size="sm" data-testid="mark-compliant">Compliant</Button></ActionForm>
                    <ActionForm action={markComplianceAction} className="flex items-center gap-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="bid_id" value={m.bidId} /><input type="hidden" name="requirement_id" value={q.requirement_id} /><input type="hidden" name="decision" value="noncompliant" />
                      <Input name="comment" placeholder="Reason (required)" defaultValue={q.compliant === 0 ? q.eval_comment ?? "" : ""} className="!w-44" /><Button type="submit" variant="danger" size="sm">Non-compliant</Button></ActionForm></li>))}</ul>)}
            </div>))}{rows.every((m) => { const c = m.cells.find((x) => x.stepId === s.id); return !c || ["skipped", "locked"].includes(c.state); }) && <p className="text-sm text-slate-400">No bid has reached this step.</p>}</div>
        </CardSection>))}
      {evaluating && can(me, "procurement", "evaluate") && rows.some((m) => !m.dq) && (
        <CardSection title="Request from a bidder" subtitle="Clarification during evaluation, or a negotiation (BAFO) round once the price envelope is open. The bidder answers in the portal.">
          <ActionForm action={requestFromBidderAction} className="grid gap-3 md:grid-cols-4" errorClassName={errCls}><input type="hidden" name="id" value={r.id} />
            <Field label="Bidder"><Select name="bid_id" options={rows.filter((m) => !m.dq).map((m) => ({ value: m.bidId, label: label(m.bidId) }))} /></Field>
            <Field label="Kind"><Select name="kind" options={[{ value: "clarification", label: "Clarification" }, { value: "bafo", label: "Negotiation / BAFO (revised price)" }]} /></Field>
            <Field label="Answer by"><Input type="datetime-local" name="due_at" defaultValue={isoToLocalInput(new Date(Date.now() + 3 * 86_400_000).toISOString())} /></Field>
            <Field label="Message" className="md:col-span-4"><Textarea name="message" rows={2} required /></Field><div className="md:col-span-4"><Button type="submit" variant="secondary" size="sm">Send request</Button></div></ActionForm>
          {reqRequests.length > 0 && <ul className="mt-4 space-y-1 text-sm">{reqRequests.map((q) => <li key={q.id}><Badge tone={q.status === "open" ? "amber" : "green"}>{q.kind} · {q.status}</Badge> <b>{label(q.bid)}</b>: {q.message}{q.response && <span className="text-slate-500"> → {q.response}</span>}</li>)}</ul>}
        </CardSection>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Comparison */
export function ComparisonTab({ r, db }: TabCtx) {
  const seal = sealOf(db, r);
  if (!seal.priceOpen) return <Sealed>{seal.twoEnvelope ? "The price envelopes stay sealed until the commercial opening (after the technical evaluation)." : "Prices stay sealed until the opening."}</Sealed>;
  const { rows } = evaluate(db, r.id);
  const bids = internalBids(db, r.id).filter((b) => b.price_visible);
  const boq = boqOf(db, r.id);
  const d = dec(r.currency);
  const prices = new Map(bids.map((b) => [b.id, new Map((internalPrices(db, b.id) ?? []).map((p) => [p.boq_line_id, p]))]));
  const totals = bids.map((b) => b.total_amount ?? 0);
  const est = boq.reduce((a, l) => a + l.quantity * l.estimate_rate, 0);
  const sorted = [...bids].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return (
    <div className="space-y-5">
      <CardSection title="Ranking" subtitle={r.evaluation_method === "lowest_compliant" ? "Lowest compliant price" : `Final score = technical x ${r.tech_weight}% + commercial x ${r.commercial_weight}%`} flush>
        <Table><THead><TR><TH>Rank</TH><TH>Bidder</TH><TH num>Technical</TH><TH num>Commercial</TH><TH num>Final</TH><TH num>Price (excl. VAT)</TH><TH num>vs estimate</TH></TR></THead>
          <TBody>{sorted.map((b) => (<TR key={b.id} data-testid="rank-row"><TD className="font-bold">{b.rank ?? "—"}</TD><TD className="font-semibold">{b.supplier_name}{b.price_version && b.price_version > 1 && <Badge tone="violet" className="ml-2">BAFO v{b.price_version}</Badge>}</TD>
            <TD num>{b.tech_score?.toFixed(1) ?? "—"}</TD><TD num>{b.commercial_score?.toFixed(1) ?? "—"}</TD><TD num className="font-bold">{b.final_score?.toFixed(1) ?? "—"}</TD><TD num>{formatNumber(b.total_amount, d)}</TD>
            <TD num className={cn((b.total_amount ?? 0) > est ? "text-red-600" : "text-emerald-700")}>{est ? `${(((b.total_amount ?? 0) - est) / est * 100).toFixed(1)}%` : "—"}</TD></TR>))}</TBody></Table>
      </CardSection>
      <CardSection title="Comparison sheet" subtitle={`BOQ lines x bidders · lowest rate per line highlighted · ${r.currency}, VAT shown separately`} flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm" data-testid="comparison-sheet">
            <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr><th className="px-3 py-2.5">Item</th><th className="px-3 py-2.5">Description</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5 text-right">Estimate</th>
              {bids.map((b) => <th key={b.id} className="px-3 py-2.5 text-right">{b.supplier_name}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#f1f5f9]">{boq.map((l) => {
              const rates = bids.map((b) => prices.get(b.id)?.get(l.id)?.unit_rate ?? null);
              const low = Math.min(...rates.filter((x): x is number => x !== null));
              return (<tr key={l.id}><td className="px-3 py-2">{l.item_no}</td><td className="max-w-[240px] px-3 py-2">{l.description}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.quantity, 2)} {l.unit}</td><td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatNumber(l.estimate_rate, dec(r.currency))}</td>
                {bids.map((b, i) => { const p = prices.get(b.id)?.get(l.id); return <td key={b.id} className={cn("px-3 py-2 text-right tabular-nums", rates[i] === low && "bg-emerald-50 font-bold text-emerald-700")}>{p ? <>{formatNumber(p.unit_rate, d)}<div className="text-[11px] font-normal text-slate-400">{formatNumber(p.amount, d)}</div></> : "—"}</td>; })}</tr>);
            })}
              <tr className="bg-slate-50 font-bold"><td colSpan={3} className="px-3 py-2">Total excl. VAT</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(est, d)}</td>{bids.map((b) => <td key={b.id} className={cn("px-3 py-2 text-right tabular-nums", b.total_amount === Math.min(...totals) && "text-emerald-700")}>{formatNumber(b.total_amount, d)}</td>)}</tr>
              <tr className="text-xs text-slate-500"><td colSpan={4} className="px-3 py-2">Variance vs estimate</td>{bids.map((b) => <td key={b.id} className="px-3 py-2 text-right tabular-nums">{est ? `${(((b.total_amount ?? 0) - est) / est * 100).toFixed(1)}%` : "—"}</td>)}</tr>
              <tr className="text-xs text-slate-500"><td colSpan={4} className="px-3 py-2">VAT ({(db.prepare("SELECT vat_rate v FROM entities WHERE id = ?").get(r.entity_id) as { v: number }).v}%)</td>{bids.map((b) => <td key={b.id} className="px-3 py-2 text-right tabular-nums">{formatNumber(b.vat_amount, d)}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </CardSection>
      <CardSection title="Arithmetic check" subtitle="Quantity x rate recomputed for every priced line.">
        {bids.map((b) => {
          const lines = (internalPrices(db, b.id) ?? []).map((p) => { const l = boq.find((x) => x.id === p.boq_line_id)!; return { item_no: l.item_no, quantity: l.quantity, unit_rate: p.unit_rate, amount: p.amount }; });
          const diffs = arithmeticCheck(lines, d);
          return <div key={b.id} className="mb-1 text-sm" data-testid="arith-row">{diffs.length ? <><Badge tone="red">Differences</Badge> <b>{b.supplier_name}</b>: {diffs.map((x) => `item ${x.item_no}: entered ${formatNumber(x.entered, d)}, computed ${formatNumber(x.computed, d)} (${x.diff > 0 ? "+" : ""}${formatNumber(x.diff, d)})`).join("; ")}</> : <><Badge tone="green">OK</Badge> <b>{b.supplier_name}</b>: all lines agree</>}</div>;
        })}
        {rows.length === 0 && <p className="text-sm text-slate-400">No bids.</p>}
      </CardSection>
    </div>
  );
}

/* ------------------------------------------------------------------ Recommendation & award */
export function AwardTab({ r, me, db }: TabCtx) {
  const seal = sealOf(db, r);
  const bids = internalBids(db, r.id);
  const ranked = bids.filter((b) => b.price_visible && b.rank).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const signoffs = db.prepare("SELECT s.*, u.name FROM rfx_signoffs s JOIN users u ON u.id = s.user_id WHERE s.rfx_id = ?").all(r.id) as { user_id: number; name: string; decision: string; comment: string | null; decided_at: string }[];
  const board = committeeOf(db, r.id).filter((m) => ["chair", "member"].includes(m.role));
  const d = dec(r.currency);
  const rec = r.recommended_bid_id ? bids.find((b) => b.id === r.recommended_bid_id) : undefined;
  const asg = r.assignment_id ? (db.prepare("SELECT id, code FROM assignments WHERE id = ?").get(r.assignment_id) as { id: number; code: string }) : null;
  const gate = r.status === "evaluation" && seal.priceOpen ? ranked.length === 0 : false;
  return (
    <div className="space-y-5">
      {!seal.priceOpen && <Sealed>A recommendation needs the price envelopes to be open and the evaluation to be complete.</Sealed>}
      {rec && (
        <CardSection title="Recommendation" actions={<a href={`/procurement/${r.id}/recommendation`} className="inline-flex items-center gap-1 text-xs font-bold text-primary-dark hover:underline"><Download size={13} />Recommendation report (PDF)</a>}>
          <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm" data-testid="recommendation">
            <dt className="text-slate-500">Recommended bidder</dt><dd className="font-bold">{rec.supplier_name} <span className="font-normal text-slate-500">(rank {rec.rank})</span></dd>
            <dt className="text-slate-500">Justification</dt><dd>{r.recommendation_note ?? "—"}</dd>
            <dt className="text-slate-500">Award value</dt><dd className="font-bold">{money(r.award_value, r.currency, d)} <span className="font-normal text-slate-500">(bid {money(rec.total_amount, r.currency, d)})</span></dd>
            <dt className="text-slate-500">Budget vs award</dt><dd>{r.estimate ? <span className={cn("font-semibold", (r.award_value ?? 0) > r.estimate ? "text-red-600" : "text-emerald-700")}>{money((r.award_value ?? 0) - r.estimate, r.currency, d)} ({((((r.award_value ?? 0) - r.estimate) / r.estimate) * 100).toFixed(1)}%) vs estimate {money(r.estimate, r.currency, d)}</span> : "—"}</dd>
          </dl>
          <h4 className="mb-1 mt-4 text-xs font-bold uppercase text-slate-400">Committee sign-off</h4>
          <ul className="space-y-1 text-sm">{board.map((m) => { const s = signoffs.find((x) => x.user_id === m.user_id); return <li key={m.id}><b>{m.name}</b> ({COMMITTEE_ROLE_LABEL[m.role]}): {s ? <Badge tone={s.decision === "concur" ? "green" : "red"}>{s.decision}</Badge> : <span className="text-slate-400">pending</span>}{s?.comment && <span className="text-slate-500"> - {s.comment}</span>}</li>; })}</ul>
          {["recommended", "award_pending"].includes(r.status) && board.some((m) => m.user_id === me.id) && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <ActionForm action={signOffAction} className="flex items-end gap-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="concur" /><Input name="comment" placeholder="Comment (optional)" className="!w-56" /><Button type="submit" variant="success" size="sm" data-testid="signoff-concur">Concur</Button></ActionForm>
              <ActionForm action={signOffAction} className="flex items-end gap-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="dissent" /><Input name="comment" placeholder="Reason (required to dissent)" className="!w-56" /><Button type="submit" variant="danger" size="sm">Dissent</Button></ActionForm>
            </div>)}
          {r.status === "recommended" && (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              {can(me, "procurement", "recommend") && <ActionForm action={submitAwardAction} className="flex flex-wrap items-end gap-2" errorClassName={errCls}><input type="hidden" name="id" value={r.id} /><Input name="note" placeholder="Note for approvers" className="!w-64" /><Button type="submit" variant="primary" data-testid="submit-award">Submit award for approval</Button></ActionForm>}
              {can(me, "procurement", "recommend") && <ActionForm action={withdrawRecommendationAction}><input type="hidden" name="id" value={r.id} /><Button type="submit" variant="ghost" size="sm">Withdraw recommendation</Button></ActionForm>}
            </div>)}
        </CardSection>)}
      {r.status === "awarded" && asg && (
        <CardSection title="Award"><p className="text-sm">Awarded on {r.awarded_at?.slice(0, 10)} at <b>{money(r.award_value, r.currency, d)}</b>. Subcontract <Link href={`/projects/${r.project_id}?tab=subcontracts`} className="font-bold text-primary-dark hover:underline" data-testid="award-assignment">{asg.code}</Link> was created automatically (source: tender).</p>
          <a href={`/procurement/${r.id}/award-letter`} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-primary-dark hover:underline"><Download size={14} />Letter of Award (PDF)</a></CardSection>)}
      {r.status === "evaluation" && seal.priceOpen && can(me, "procurement", "recommend") && (
        <CardSection title="Recommend a bidder" subtitle="Rank 1 needs no justification; recommending a lower-ranked bid requires one.">
          {gate ? <p className="text-sm text-amber-700">Finish the evaluation of every bid first.</p> : (
            <ActionForm action={recommendAction} className="space-y-3" errorClassName={errCls}><input type="hidden" name="id" value={r.id} />
              <Table><THead><TR><TH /><TH>Rank</TH><TH>Bidder</TH><TH num>Final score</TH><TH num>Price</TH></TR></THead><TBody>{ranked.map((b) => (
                <TR key={b.id}><TD><input type="radio" name="bid_id" value={b.id} defaultChecked={b.rank === 1} data-testid={`pick-${b.rank}`} /></TD><TD>{b.rank}</TD><TD className="font-semibold">{b.supplier_name}</TD><TD num>{b.final_score?.toFixed(1)}</TD><TD num>{formatNumber(b.total_amount, d)}</TD></TR>))}</TBody></Table>
              <div className="grid gap-3 md:grid-cols-2"><Field label="Justification"><Textarea name="justification" rows={2} data-testid="justification" /></Field><Field label={`Final contract value (${r.currency}, optional negotiated value)`}><Input name="value" type="number" step="any" /></Field></div>
              <Button type="submit" variant="primary" data-testid="recommend">Recommend</Button></ActionForm>)}
        </CardSection>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Approvals / documents / activity */
export function ApprovalsTab({ r, me }: TabCtx) {
  return (
    <div className="space-y-5">
      <ApprovalPanel type="rfx_publish" documentId={r.id} path={`/procurement/${r.id}?tab=approvals`} user={me} canSubmit={false} />
      {["recommended", "award_pending", "awarded"].includes(r.status) && <ApprovalPanel type="rfx_award" documentId={r.id} path={`/procurement/${r.id}?tab=approvals`} user={me} canSubmit={false} />}
    </div>
  );
}
export function DocumentsTab({ r, me }: TabCtx) {
  return (
    <div className="space-y-5">
      <AttachmentsPanel entityType="rfx" entityId={r.id} revalidate={`/procurement/${r.id}?tab=documents`} readOnly={!can(me, "procurement", "edit") || ["awarded", "cancelled"].includes(r.status)} title="Tender documents (visible to eligible bidders once published)" />
      <p className="text-xs text-slate-500">Bid attachments are not listed here: they stay sealed until the opening and are only reachable through the evaluation.</p>
      {false && <ActionForm action={uploadRfxDocument}><span /></ActionForm>}
    </div>
  );
}
export function ActivityTab({ r }: TabCtx) { return <ActivityTimeline entityType="rfx" entityId={r.id} />; }
export type { SealedBid, StepRow };
