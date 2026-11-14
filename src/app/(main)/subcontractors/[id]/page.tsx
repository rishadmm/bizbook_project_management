import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, ExternalLink, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import {
  Badge, Button, CardSection, EmptyState, ModalButton, PageHeader, ProgressBar, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR, Tabs, resolveTab, Select,
} from "@/components/ui";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { formatDate, formatDateTime, formatMoney, formatRatio, formatNumber, pct } from "@/lib/format";
import { getAssignmentProgress, getSubcontractorPerformance } from "@/lib/metrics";
import { statusOptions, statusLabel } from "@/lib/status";
import { rejectPortalDocument } from "@/features/portal-admin/actions";
import {
  approveSubcontractor, deleteDocument, setSubcontractorStatus, toggleChecklistItem, updateSubcontractor, verifyDocument,
} from "@/features/subcontractors/actions";
import {
  docWarning, getChecklist, getDocuments, getSubAssignments, getSubCertificates, getSubInvoices, getSubcontractor,
} from "@/features/subcontractors/queries";
import { ProfileForm } from "@/features/subcontractors/components/ProfileForm";
import { DocumentForm } from "@/features/subcontractors/components/DocumentForm";
import { can, isAdminUser, requirePage } from "@/lib/auth";
import PortalAccessTab from "@/features/portal-admin/components/PortalAccessTab";
import { pendingDocumentCount } from "@/features/portal-admin/queries";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { hasOpenRequest } from "@/lib/approvals/engine";

export default async function SubcontractorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage("subcontractors");
  const { id: rawId } = await params;
  const id = Number(rawId);
  const sub = Number.isInteger(id) ? getSubcontractor(id) : undefined;
  if (!sub) notFound();
  const checklist = getChecklist(id);
  const docs = getDocuments(id);
  const assignments = getSubAssignments(id);
  const invoices = getSubInvoices(id);
  const certs = getSubCertificates(id);
  const tabs = [
    { key: "profile", label: "Profile" },
    { key: "onboarding", label: "Onboarding", count: checklist.filter((c) => !c.done).length || undefined },
    { key: "documents", label: "Documents", count: docs.length },
    { key: "assignments", label: "Assignments", count: assignments.length },
    { key: "invoices", label: "Invoices", count: invoices.length },
    { key: "certificates", label: "Certificates", count: certs.length },
    ...(can(me, "subcontractors", "portal") ? [{ key: "portal", label: "Portal access", count: pendingDocumentCount(id) || undefined }] : []),
    { key: "activity", label: "Activity" },
  ];
  const tab = resolveTab(await searchParams, tabs);
  const base = `/subcontractors/${id}`;
  const allDone = checklist.length > 0 && checklist.every((c) => c.done);
  const perf = getSubcontractorPerformance(id)[0];

  return (
    <>
      <PageHeader title={sub.name} breadcrumbs={[{ label: "Subcontractors", href: "/subcontractors" }, { label: sub.code ?? `#${id}` }]}
        description={[sub.code, sub.trade].filter(Boolean).join(" · ")}
        badges={<StatusBadge kind="subcontractorStatus" value={sub.status} />}
        actions={sub.status === "approved" || sub.status === "suspended" ? (
          <form action={setSubcontractorStatus} className="flex gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={sub.status === "approved" ? "suspended" : "approved"} />
            <Button type="submit" variant={sub.status === "approved" ? "danger" : "success"}>{sub.status === "approved" ? "Suspend" : "Reinstate"}</Button>
          </form>
        ) : undefined} />
      {perf && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Contract value" value={formatMoney(perf.contractValue, { compact: true })} hint={`${perf.activeAssignments} active / ${perf.assignmentCount}`} />
          <Stat label="Progress" value={pct(perf.progressPct, 0)} hint={`planned ${pct(perf.plannedPct, 0)}`} />
          <Stat label="SPI" value={formatRatio(perf.spi)} tone={perf.spi === null ? "default" : perf.spi >= 0.95 ? "good" : perf.spi >= 0.85 ? "warn" : "bad"} />
          <Stat label="Delay days caused" value={formatNumber(perf.delayDays)} tone={perf.delayDays > 0 ? "warn" : "default"} />
          <Stat label="Certified / paid" value={formatMoney(perf.certified, { compact: true })} hint={`paid ${formatMoney(perf.paid, { compact: true })}`} />
        </div>
      )}
      <Tabs tabs={tabs} active={tab} basePath={base} />

      {tab === "profile" && <CardSection title="Profile"><ProfileForm action={updateSubcontractor} sub={sub} submitLabel="Save profile" /></CardSection>}

      {tab === "onboarding" && (
        <CardSection title="Onboarding checklist" subtitle={`${checklist.filter((c) => c.done).length} of ${checklist.length} completed`}
          actions={sub.status === "onboarding" || sub.status === "prospect" ? (hasOpenRequest("subcontractor_onboarding", id) ? <Badge tone="amber">Approval pending</Badge> : can(me, "subcontractors", "approve") ? (
            <form action={approveSubcontractor}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="success" disabled={!allDone} title={allDone ? "" : "Complete all items first"}><ShieldCheck size={14} />Approve subcontractor</Button>
            </form>
          ) : undefined) : <StatusBadge kind="subcontractorStatus" value={sub.status} />}>
          <ul className="divide-y divide-slate-100">
            {checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <form action={toggleChecklistItem}>
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="item_id" value={c.id} />
                  <button className="text-slate-400 hover:text-blue-600" title="Toggle">
                    {c.done ? <CheckCircle2 className="text-emerald-600" size={20} /> : <Circle size={20} />}
                  </button>
                </form>
                <span className={c.done ? "text-sm text-slate-500 line-through" : "text-sm text-slate-800"}>{c.item}</span>
                {c.done_at && <span className="ml-auto text-xs text-slate-400">{formatDateTime(c.done_at)}</span>}
              </li>
            ))}
          </ul>
          {sub.status !== "onboarding" && sub.status !== "prospect" && (
            <form action={setSubcontractorStatus} className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4">
              <input type="hidden" name="id" value={id} />
              <div className="w-48"><Select name="status" defaultValue={sub.status} options={statusOptions("subcontractorStatus")} /></div>
              <Button type="submit">Change status</Button>
            </form>
          )}
        </CardSection>
      )}

      {tab === "onboarding" && <div className="mt-5"><ApprovalPanel type="subcontractor_onboarding" documentId={id} path={`/subcontractors/${id}?tab=onboarding`} user={me} title="Onboarding approval" canSubmit={false} /></div>}

      {tab === "documents" && (
        <CardSection title="Documents" flush actions={<ModalButton label="Add document" title="Add document" variant="primary" size="sm" wide><DocumentForm subcontractorId={id} /></ModalButton>}>
          {docs.length === 0 ? <div className="p-4"><EmptyState title="No documents" description="Add trade license, insurance, HSE certificates…" /></div> : (
            <Table>
              <THead><TR><TH>Type</TH><TH>Ref</TH><TH>Issued</TH><TH>Expiry</TH><TH>Status</TH><TH>File</TH><TH>{""}</TH></TR></THead>
              <TBody>
                {docs.map((d) => {
                  const w = docWarning(d.expiry_date, d.status);
                  return (
                    <TR key={d.id}>
                      <TD>{statusLabel("docType", d.doc_type)}{d.source === "portal" && <Badge tone="violet" className="ml-1.5">Portal</Badge>}{d.uploaded_by_name && <div className="text-[11px] text-slate-400">by {d.uploaded_by_name}</div>}</TD>
                      <TD>{d.ref_no ?? "—"}</TD>
                      <TD>{formatDate(d.issue_date)}</TD>
                      <TD>{formatDate(d.expiry_date)} {w === "expired" && <Badge tone="red">expired</Badge>}{w === "expiring" && <Badge tone="amber">expiring</Badge>}</TD>
                      <TD><StatusBadge kind="docStatus" value={d.status} /></TD>
                      <TD>{d.attachment_id ? <a className="inline-flex items-center gap-1 text-blue-700 hover:underline" target="_blank" href={`/api/files/${d.attachment_id}`}>{d.filename}<ExternalLink size={11} /></a> : <span className="text-slate-400">—</span>}</TD>
                      <TD>
                        <div className="flex items-center justify-end gap-1">
                          {d.status !== "verified" && (
                            <form action={verifyDocument}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="subcontractor_id" value={id} /><Button type="submit" size="sm" variant="success">Verify</Button></form>
                          )}
                          {d.status === "pending_review" && (
                            <form action={rejectPortalDocument} className="flex items-center gap-1"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="subcontractor_id" value={id} />
                              <input name="note" placeholder="Reason" aria-label="Rejection reason" className="w-24 rounded-lg border border-line px-2 py-1 text-xs" /><Button type="submit" size="sm" variant="danger">Reject</Button></form>
                          )}
                          <ModalButton label="" icon={<Pencil size={13} />} title="Edit document" size="sm" variant="ghost" wide><DocumentForm subcontractorId={id} doc={d} /></ModalButton>
                          <form action={deleteDocument}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="subcontractor_id" value={id} /><Button type="submit" size="sm" variant="ghost" title="Delete"><Trash2 size={13} /></Button></form>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardSection>
      )}

      {tab === "assignments" && (
        <CardSection title="Assignments across projects" flush>
          {assignments.length === 0 ? <div className="p-4"><EmptyState title="No assignments yet" description="Assignments are created from a project's Subcontracts tab." /></div> : (
            <Table>
              <THead><TR><TH>Code</TH><TH>Project / stage</TH><TH>Status</TH><TH num>Value</TH><TH className="w-44">Progress</TH><TH num>SPI</TH><TH num>Delay days</TH></TR></THead>
              <TBody>
                {assignments.map((a) => {
                  const p = getAssignmentProgress(a.id);
                  return (
                    <TR key={a.id}>
                      <TD>{a.code}</TD>
                      <TD><Link className="text-blue-700 hover:underline" href={`/projects/${a.project_id}`}>{a.project_code} · {a.project_name}</Link><div className="text-xs text-slate-500">{a.stage_name ?? "—"}</div></TD>
                      <TD><StatusBadge kind="assignmentStatus" value={a.status} /></TD>
                      <TD num>{formatMoney(a.contract_value)}</TD>
                      <TD><ProgressBar value={p.actualPct} planned={p.plannedPct} showLabel tone={p.spi === null ? "blue" : p.spi >= 0.95 ? "green" : p.spi >= 0.85 ? "amber" : "red"} /></TD>
                      <TD num>{formatRatio(p.spi)}</TD>
                      <TD num>{formatNumber(p.delayDays)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardSection>
      )}

      {tab === "invoices" && (
        <CardSection title="Invoices" flush>
          {invoices.length === 0 ? <div className="p-4"><EmptyState title="No invoices" /></div> : (
            <Table>
              <THead><TR><TH>Invoice</TH><TH>Assignment</TH><TH>Date</TH><TH num>Claimed</TH><TH num>Certified</TH><TH num>Net payable</TH><TH>Status</TH></TR></THead>
              <TBody>
                {invoices.map((i) => (
                  <TR key={i.id}>
                    <TD>{i.invoice_no ?? `#${i.id}`}</TD><TD>{i.assignment_code} <span className="text-xs text-slate-400">{i.project_code}</span></TD>
                    <TD>{formatDate(i.invoice_date)}</TD><TD num>{formatMoney(i.claimed_amount)}</TD>
                    <TD num>{i.certified_amount ? formatMoney(i.certified_amount) : "—"}</TD><TD num>{i.net_payable ? formatMoney(i.net_payable) : "—"}</TD>
                    <TD><StatusBadge kind="invoiceStatus" value={i.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardSection>
      )}

      {tab === "certificates" && (
        <CardSection title="Completion certificates" flush>
          {certs.length === 0 ? <div className="p-4"><EmptyState title="No certificates" /></div> : (
            <Table>
              <THead><TR><TH>No.</TH><TH>Assignment</TH><TH>Type</TH><TH>Date</TH><TH num>%</TH><TH>Status</TH><TH>Source</TH></TR></THead>
              <TBody>
                {certs.map((c) => (
                  <TR key={c.id}>
                    <TD>{c.cert_no ?? `#${c.id}`}</TD><TD>{c.assignment_code} <span className="text-xs text-slate-400">{c.project_code}</span></TD>
                    <TD>{statusLabel("certType", c.cert_type)}</TD><TD>{formatDate(c.cert_date)}</TD><TD num>{c.percent ?? "—"}</TD>
                    <TD><StatusBadge kind="certStatus" value={c.status} /></TD><TD><StatusBadge kind="progressSource" value={c.source} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardSection>
      )}

      {tab === "portal" && (
        <PortalAccessTab sub={sub} canManage={can(me, "subcontractors", "portal")} canViewAs={isAdminUser(me)} />
      )}

      {tab === "activity" && <ActivityTimeline entityType="subcontractor" entityId={id} />}
    </>
  );
}
