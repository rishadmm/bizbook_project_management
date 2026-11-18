import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import ActionForm from "@/components/ActionForm";
import { Badge, Button, CardSection, EmptyState, Field, Input, LinkButton, PageHeader, StatusBadge, Textarea } from "@/components/ui";
import { getDb } from "@/lib/db";
import { requirePortalUser } from "@/lib/portal-auth";
import { portalCan } from "@/lib/portal-core";
import { countdown, formatLocal, decimalsOf } from "@/lib/rfx";
import { formatMoney } from "@/lib/format";
import { addendaFor, myBidContent, myQuestions, myRequests, portalTender, publicClarifications, tenderDocuments } from "@/features/procurement/portal-queries";
import { ackAddendumAction, askQuestionAction, setIntentAction } from "@/features/procurement/portal-actions";
import { RequestAnswer } from "@/features/procurement/components/PortalForms";
import { bidBlockers } from "@/features/supplier-registration/core";
import { boqOf } from "@/features/procurement/rfx-core";

export const metadata = { title: "Supplier tender" };
const err = "text-sm font-semibold text-red-600";

export default async function PortalTender({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const s = await requirePortalUser(slug, "tenders");
  const t = portalTender(Number(id), s.sub.id, s.entity.id);
  if (!t) notFound();
  const { rfx, bid } = t;
  const db = getDb();
  const canBid = portalCan(s.user.role, "tenders_bid") && !s.readOnly;
  // viewing marks the invitation as viewed (never in the read-only admin view)
  if (!s.readOnly && t.eligible) db.prepare(`INSERT INTO rfx_invitations(rfx_id, subcontractor_id, invited_at, viewed_at, intent, source) VALUES (?,?,?,?, 'pending', 'eligible') ON CONFLICT(rfx_id, subcontractor_id) DO UPDATE SET viewed_at = COALESCE(viewed_at, excluded.viewed_at)`).run(rfx.id, s.sub.id, new Date().toISOString().slice(0, 19).replace("T", " "), new Date().toISOString().slice(0, 19).replace("T", " "));
  const inv = db.prepare("SELECT intent, decline_reason FROM rfx_invitations WHERE rfx_id = ? AND subcontractor_id = ?").get(rfx.id, s.sub.id) as { intent: string; decline_reason: string | null } | undefined;
  const open = rfx.status === "published" && !!rfx.closing_at && Date.parse(rfx.closing_at) > Date.now();
  const docs = t.eligible ? tenderDocuments(rfx.id) : [];
  const addenda = addendaFor(rfx.id, s.sub.id);
  const qa = publicClarifications(rfx.id);
  const mine = myQuestions(rfx.id, s.sub.id);
  const askOpen = open && (!rfx.clarification_deadline || Date.parse(rfx.clarification_deadline) > Date.now());
  const requests = bid ? myRequests(bid.id).filter((r) => r.status === "open") : [];
  const blockers = bidBlockers(db, s.sub.id);
  const dec = decimalsOf(s.entity.currency);
  const lines = bid && requests.some((r) => r.kind === "bafo") ? (() => { const c = myBidContent(bid.id); return boqOf(db, rfx.id).map((l) => ({ id: l.id, item_no: l.item_no, description: l.description, unit: l.unit, quantity: l.quantity, rate: c.prices.filter((p) => p.boq_line_id === l.id).sort((a, b) => b.version - a.version)[0]?.unit_rate ?? null })); })() : [];
  const awarded = rfx.status === "awarded";
  const won = awarded && bid?.status === "awarded";
  const lost = awarded && bid && bid.status !== "awarded";
  const asg = won && rfx.assignment_id ? (db.prepare("SELECT id, code FROM assignments WHERE id = ? AND subcontractor_id = ?").get(rfx.assignment_id, s.sub.id) as { id: number; code: string } | undefined) : undefined;
  return (
    <>
      <PageHeader title={rfx.code} description={rfx.title} breadcrumbs={[{ label: "Tenders", href: `/p/${slug}/tenders` }, { label: rfx.code }]} badges={<StatusBadge kind="rfxStatus" value={rfx.status === "published" ? "published" : awarded ? "awarded" : "closed"} />}
        actions={canBid && t.eligible && (open || bid) ? <LinkButton href={`/p/${slug}/tenders/${rfx.id}/bid`} variant="primary" data-testid="open-bid">{bid?.status === "submitted" ? "View / revise my bid" : bid?.status === "draft" ? "Continue my bid" : bid && !open ? "View my bid" : "Start bid"}</LinkButton> : undefined} />
      {won && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" data-testid="award-banner">
          <div className="text-lg font-extrabold text-emerald-800">Awarded</div>
          <p className="text-sm text-emerald-900">Your bid was accepted at <b>{formatMoney(rfx.award_value, { currency: s.entity.currency, decimals: dec })}</b>. {asg && <>The subcontract <Link href={`/p/${slug}/projects/${asg.id}`} className="font-bold underline">{asg.code}</Link> is active in your portal.</>}</p>
          <a href={`/p/${slug}/tenders/${rfx.id}/loa`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-800 underline"><Download size={14} />Letter of Award (PDF)</a>
        </div>)}
      {lost && <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-5" data-testid="result-banner"><div className="text-lg font-extrabold text-slate-700">Not successful</div><p className="text-sm text-slate-600">Thank you for bidding. The tender was awarded to another bidder. Details of other bids are not shared.</p></div>}
      {rfx.status === "cancelled" && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">This tender was cancelled.</div>}
      {requests.map((rq) => <div key={rq.id} className="mb-5"><RequestAnswer rfxId={rfx.id} req={rq} lines={lines} currency={s.entity.currency} dec={dec} /></div>)}
      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <CardSection title="Scope and dates">
          <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Category</dt><dd>{t.category ?? "—"}</dd><dt className="text-slate-500">Procedure</dt><dd>{rfx.procedure === "open" ? "Open tender" : "Selective (invited suppliers)"}</dd>
            <dt className="text-slate-500">Published</dt><dd>{formatLocal(rfx.published_at ?? rfx.publish_at)}</dd><dt className="text-slate-500">Questions until</dt><dd>{formatLocal(rfx.clarification_deadline)}</dd>
            <dt className="text-slate-500">Site visit</dt><dd>{formatLocal(rfx.site_visit_at)}{rfx.site_visit_note ? ` · ${rfx.site_visit_note}` : ""}</dd>
            <dt className="text-slate-500">Closing</dt><dd className="font-bold" data-testid="closing">{formatLocal(rfx.closing_at)} <span className="font-semibold text-primary">{open ? countdown(rfx.closing_at) : rfx.status === "published" ? "" : "closed"}</span></dd>
            <dt className="text-slate-500">Bid validity</dt><dd>{rfx.validity_days} days</dd><dt className="text-slate-500">Bonds</dt><dd>bid {rfx.bid_bond_pct}% · performance {rfx.performance_bond_pct}%</dd>
            <dt className="text-slate-500">Payment</dt><dd>advance {rfx.advance_pct}% · retention {rfx.retention_pct}% · {rfx.payment_days} days</dd>
          </dl>
          {rfx.description && <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{rfx.description}</p>}
        </CardSection>
        <CardSection title="Tender documents">
          {docs.length === 0 ? <EmptyState title="No documents" /> : <ul className="divide-y divide-slate-100">{docs.map((d) => (<li key={d.id} className="flex items-center gap-3 py-2"><FileText size={16} className="text-slate-400" /><a href={`/api/files/${d.id}`} target="_blank" className="flex-1 truncate text-sm font-medium text-primary-dark hover:underline">{d.filename}</a>{d.category && <Badge>{d.category}</Badge>}<a href={`/api/files/${d.id}?download=1`} aria-label="Download" className="text-slate-500"><Download size={14} /></a></li>))}</ul>}
          {blockers.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800" data-testid="bid-blockers">You cannot bid until this is resolved: {blockers.join(" ")}</p>}
        </CardSection>
      </div>
      {open && canBid && t.eligible && (
        <CardSection title="Your interest" className="mb-5">
          <div className="flex flex-wrap items-end gap-3">
            <ActionForm action={setIntentAction} errorClassName={err}><input type="hidden" name="rfx_id" value={rfx.id} /><input type="hidden" name="intent" value="interested" /><Button type="submit" variant={inv?.intent === "interested" ? "primary" : "secondary"} size="sm" data-testid="intent-interested">Interested</Button></ActionForm>
            <ActionForm action={setIntentAction} className="flex items-end gap-2" errorClassName={err}><input type="hidden" name="rfx_id" value={rfx.id} /><input type="hidden" name="intent" value="declined" /><Input name="reason" placeholder="Reason for declining" className="!w-64" /><Button type="submit" variant="danger" size="sm">Decline</Button></ActionForm>
            {inv && inv.intent !== "pending" && <Badge tone={inv.intent === "interested" ? "green" : "red"}>{inv.intent}{inv.decline_reason ? `: ${inv.decline_reason}` : ""}</Badge>}
          </div>
        </CardSection>)}
      <CardSection title="Addenda" className="mb-5">
        {addenda.length === 0 ? <p className="text-sm text-slate-400">No addenda issued.</p> : (
          <ul className="space-y-3">{addenda.map((a) => (
            <li key={a.id} className="rounded-xl border border-line p-3" data-testid="addendum">
              <div className="flex flex-wrap items-center gap-2"><b className="text-sm">Addendum {a.no}: {a.title}</b>{a.new_closing_at && <Badge tone="amber">New closing {formatLocal(a.new_closing_at)}</Badge>}{a.acked_at ? <Badge tone="green">Acknowledged</Badge> : <Badge tone="red">Not acknowledged</Badge>}</div>
              {a.description && <p className="mt-1 text-sm text-slate-600">{a.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3">{a.attachment_id && <a href={`/api/files/${a.attachment_id}`} target="_blank" className="text-xs font-bold text-primary-dark hover:underline">Open addendum file</a>}
                {!a.acked_at && canBid && open && <ActionForm action={ackAddendumAction} errorClassName={err}><input type="hidden" name="rfx_id" value={rfx.id} /><input type="hidden" name="addendum_id" value={a.id} /><Button type="submit" size="sm" variant="primary" data-testid="ack-addendum">Acknowledge</Button></ActionForm>}</div>
            </li>))}</ul>)}
      </CardSection>
      <CardSection title="Questions and answers" subtitle="Answers are shared anonymously with all bidders.">
        {qa.length === 0 ? <p className="text-sm text-slate-400">No published answers yet.</p> : <ul className="space-y-3">{qa.map((c, i) => <li key={c.id} className="text-sm"><b>Q{i + 1}.</b> {c.question}<div className="mt-1 rounded-lg bg-emerald-50 p-2 text-emerald-900"><b>A:</b> {c.answer}</div></li>)}</ul>}
        {mine.filter((m) => !m.answer).length > 0 && <p className="mt-3 text-xs text-slate-500">Your pending question{mine.filter((m) => !m.answer).length === 1 ? "" : "s"}: {mine.filter((m) => !m.answer).map((m) => `"${m.question}"`).join("; ")}</p>}
        {canBid && t.eligible && (askOpen ? (
          <ActionForm action={askQuestionAction} className="mt-4 space-y-2" errorClassName={err}><input type="hidden" name="rfx_id" value={rfx.id} />
            <Field label="Ask a question (until the clarification deadline)"><Textarea name="question" rows={2} data-testid="question" /></Field><Button type="submit" variant="secondary" size="sm" data-testid="ask-question">Send question</Button></ActionForm>) : <p className="mt-3 text-xs text-slate-400">The clarification period has ended.</p>)}
      </CardSection>
    </>
  );
}
