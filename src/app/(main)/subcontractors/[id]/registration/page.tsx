import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge, CardSection, PageHeader } from "@/components/ui";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import CurrencyProvider from "@/components/CurrencyProvider";
import EntityBar from "@/components/shell/EntityBar";
import { can, requirePage } from "@/lib/auth";
import { assertRecordAccess } from "@/lib/entity-context";
import { hasOpenRequest } from "@/lib/approvals/engine";
import { getDb } from "@/lib/db";
import { daysBetween, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { REGISTRATION_STATUSES, REVIEW_SECTIONS, isRegistrationStatus, slaTone } from "@/lib/registration";
import { completeness, getProfile, itemLabel } from "@/features/supplier-registration/core";
import { ApproveForm, ItemVerdictForm, ReferBackForm, RejectForm, ReopenForm, StartReviewButton } from "@/features/supplier-registration/components/ReviewControls";
import { DocExpiryChip, ItemChip, sectionRows } from "@/features/supplier-registration/components/summary";

export const metadata = { title: "Registration review" };

export default async function RegistrationReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePage("subcontractors");
  const { id: raw } = await params;
  const id = Number(raw);
  const p = Number.isInteger(id) ? getProfile(getDb(), id) : undefined;
  if (!p) notFound();
  const rec = await assertRecordAccess(p.sub.entity_id);
  const db = getDb();
  const canDecide = can(me, "subcontractors", "approve");
  const st = p.sub.registration_status;
  const status = isRegistrationStatus(st) ? REGISTRATION_STATUSES[st] : { label: st, tone: "slate" as const };
  const reviewing = st === "under_review" && canDecide;
  const awaiting = st === "under_review" && hasOpenRequest("subcontractor_onboarding", id);
  const c = completeness(p);
  const waiting = p.sub.submitted_at && ["submitted", "under_review", "referred_back"].includes(st) ? Math.max(0, daysBetween(p.sub.submitted_at.slice(0, 10), todayISO())) : null;
  const queried = p.items.filter((i) => i.status === "query").map((i) => ({ label: itemLabel(db, id, i, p.required), comment: i.comment }));
  const reviewer = p.sub.reviewed_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(p.sub.reviewed_by) as { name: string } | undefined)?.name : null;
  const docs = p.docs.filter((d) => d.doc_type_code);
  const requiredCodes = new Set(p.required.map((r) => r.code));
  const extra = docs.filter((d) => !requiredCodes.has(d.doc_type_code!));
  const rows = [...p.required.map((r) => ({ code: r.code, name: r.name, mandatory: r.mandatory, doc: docs.find((d) => d.doc_type_code === r.code) })), ...extra.map((d) => ({ code: d.doc_type_code!, name: d.doc_type_code!, mandatory: false, doc: d }))];

  const decision = (
    <div id="decision-card" className="space-y-5 xl:sticky xl:top-20" data-testid="decision-card">
      <CardSection title="Decision" subtitle={awaiting ? "Awaiting approval" : status.label}>
        {st === "submitted" && (canDecide ? <div className="space-y-3"><p className="text-sm text-slate-600">This registration is waiting for a reviewer. Start the review to assign yourself and record decisions.</p><StartReviewButton subId={id} /></div> : <p className="text-sm text-slate-500">Waiting for a reviewer.</p>)}
        {st === "under_review" && awaiting && <p className="text-sm text-slate-600" data-testid="awaiting-approval">Approval was requested and the registration stays under review until the approvers decide. Track it in the approval panel below.</p>}
        {reviewing && !awaiting && (
          <div className="space-y-5">
            <section><h4 className="mb-2 text-sm font-extrabold text-dark">Refer back</h4><ReferBackForm subId={id} queried={queried} /></section>
            <section className="border-t border-line pt-4"><h4 className="mb-2 text-sm font-extrabold text-dark">Approve</h4><ApproveForm subId={id} categories={p.categories} gradeHint={p.sub.prequal_grade} /></section>
            <section className="border-t border-line pt-4"><h4 className="mb-2 text-sm font-extrabold text-dark">Reject</h4><RejectForm subId={id} /></section>
          </div>
        )}
        {st === "referred_back" && <p className="text-sm text-slate-600">Referred back to the supplier{p.sub.review_note ? `: “${p.sub.review_note}”` : ""}. {p.pendingQueries.length} queried item{p.pendingQueries.length === 1 ? "" : "s"} outstanding.</p>}
        {st === "approved" && <p className="text-sm text-slate-600">Approved: grade <strong>{p.sub.prequal_grade ?? "—"}</strong> until {formatDate(p.sub.prequal_valid_until)}. Categories: {p.categories.filter((x) => x.status === "approved").map((x) => x.name).join(", ") || "—"}.</p>}
        {st === "rejected" && (
          <div className="space-y-3"><p className="text-sm text-slate-600">Rejected: {p.sub.reject_reason}. The supplier can sign in to see the reason but cannot resubmit unless it is reopened.</p>
            {me.isSuperAdmin || me.roleCode === "admin" ? <ReopenForm subId={id} /> : <p className="text-xs text-slate-400">An administrator can reopen it.</p>}</div>
        )}
        {st === "draft" && <p className="text-sm text-slate-500">The supplier has not submitted yet.</p>}
      </CardSection>
      {(awaiting || hasOpenRequest("subcontractor_onboarding", id) || st === "approved") && <ApprovalPanel type="subcontractor_onboarding" documentId={id} path={`/subcontractors/${id}/registration`} user={me} title="Approval" canSubmit={false} />}
    </div>
  );

  return (
    <CurrencyProvider currency={rec.entity.currency}>
      {rec.foreign && <EntityBar what="supplier" entityCode={rec.entity.code} entityName={rec.entity.country} activeName={rec.active.country} />}
      <PageHeader title={p.sub.name} breadcrumbs={[{ label: "Subcontractors", href: "/subcontractors" }, { label: "Registrations", href: "/subcontractors/registrations" }, { label: p.sub.registration_no ?? p.sub.code ?? `#${id}` }]}
        description={`${p.sub.registration_no ?? "Not yet submitted"} · ${rec.entity.flag ?? ""} ${rec.entity.country}`} badges={<><Badge tone={status.tone}>{status.label}</Badge>{p.sub.resubmit_count > 0 && <Badge tone="violet" className="ml-1">Resubmitted {p.sub.resubmit_count}×</Badge>}</>}
        actions={<Link href={`/subcontractors/${id}`} className="text-sm font-bold text-primary hover:underline">Supplier profile</Link>} />
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-white px-5 py-3 text-sm shadow-card" data-testid="review-meta">
        <span><span className="text-muted">Submitted</span> <strong>{formatDate(p.sub.submitted_at?.slice(0, 10))}</strong></span>
        {waiting !== null && <span><span className="text-muted">Waiting</span> <Badge tone={slaTone(waiting)}>{waiting} day{waiting === 1 ? "" : "s"}</Badge></span>}
        <span><span className="text-muted">Completeness</span> <strong>{c.percent}%</strong></span>
        <span><span className="text-muted">Reviewer</span> <strong>{reviewer ?? "—"}</strong></span>
        <span><span className="text-muted">Round</span> <strong>{p.sub.resubmit_count + 1}</strong></span>
        <a href="#decision-card" className="ml-auto text-xs font-bold text-primary hover:underline xl:hidden">Go to decision</a>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-1">
          {REVIEW_SECTIONS.map((sec) => {
            const item = p.items.find((i) => i.item_kind === "section" && i.item_ref === sec.key);
            return (
              <CardSection key={sec.key} title={<span className="flex items-center gap-2">{sec.label}<ItemChip item={item} /></span>}>
                <div data-testid={`section-${sec.key}`}>
                  {item?.comment && item.status === "query" && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">Your query: {item.comment}</p>}
                  {item?.status === "fixed" && <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">The supplier updated this section after your query.</p>}
                  <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                    {sectionRows(p, sec.key, { fullIban: true }).map(([k, v]) => <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="break-words font-semibold text-dark">{v}</dd></div>)}
                  </dl>
                  <ItemVerdictForm subId={id} kind="section" refKey={sec.key} item={item} enabled={reviewing && !awaiting} />
                </div>
              </CardSection>
            );
          })}
          <CardSection title="Documents" subtitle={`${rows.filter((r) => r.mandatory).length} mandatory`}>
            <ul className="divide-y divide-line" data-testid="review-docs">
              {rows.map((r) => {
                const d = r.doc;
                const item = p.items.find((i) => i.item_kind === "document" && i.item_ref === r.code);
                return (
                  <li key={r.code} className="py-3" data-testid={`review-doc-${r.code}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-dark">{r.name}{r.mandatory && <span className="ml-1 text-red-600">*</span>}</span>
                      {d?.attachment_id ? <Badge tone="green">v{d.version}</Badge> : <Badge tone={r.mandatory ? "red" : "slate"}>{r.mandatory ? "Missing" : "Not provided"}</Badge>}
                      {d && <DocExpiryChip d={d} />}
                      <ItemChip item={item} />
                      {d?.attachment_id && <a href={`/api/files/${d.attachment_id}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Preview<ExternalLink size={11} /></a>}
                    </div>
                    {d?.attachment_id && <p className="mt-0.5 text-xs text-slate-500">{d.filename} · ref {d.ref_no ?? "—"} · issued {formatDate(d.issue_date)} · expires {formatDate(d.expiry_date)}</p>}
                    {item?.status === "query" && item.comment && <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900">Your query: {item.comment}</p>}
                    {d?.attachment_id && <ItemVerdictForm subId={id} kind="document" refKey={r.code} item={item} enabled={reviewing && !awaiting} />}
                  </li>
                );
              })}
            </ul>
          </CardSection>
          <CardSection title="History" subtitle="Review decisions and activity">
            {p.reviews.length > 0 && (
              <ol className="mb-4 space-y-3" data-testid="review-timeline">
                {p.reviews.map((r) => (
                  <li key={r.id} className="border-l-2 border-primary-100 pl-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-extrabold capitalize text-dark">{r.decision.replace("_", " ")}</span><span className="text-xs text-slate-400">{formatDateTime(r.decided_at)} · {r.decided_by_name ?? "Supplier"} · round {r.round}</span></div>
                    {r.note && <p className="text-slate-600">{r.note}</p>}
                    {r.decision === "refer_back" && r.items_json && <ul className="mt-1 list-disc pl-4 text-xs text-slate-500">{(JSON.parse(r.items_json) as { label: string; comment: string | null }[]).map((i, k) => <li key={k}><strong>{i.label}</strong>{i.comment ? ` — ${i.comment}` : ""}</li>)}</ul>}
                  </li>
                ))}
              </ol>
            )}
            <ActivityTimeline entityType="subcontractor" entityId={id} limit={30} title="Activity" />
          </CardSection>
        </div>
        <div className="xl:col-start-2 xl:row-start-1">{decision}</div>
      </div>
    </CurrencyProvider>
  );
}
