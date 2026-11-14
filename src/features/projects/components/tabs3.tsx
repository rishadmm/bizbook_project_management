import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, CardSection, EmptyState, Field, Input, ModalButton, Select, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { hasOpenRequest } from "@/lib/approvals/engine";
import { can, type AuthUser } from "@/lib/auth";
import { formatDate, formatMoney, formatNumber, formatRatio, getCurrency, todayISO } from "@/lib/format";
import { getDelayAttribution, getSubcontractorPerformance } from "@/lib/metrics";
import { statusLabel, statusOptions, statusHex } from "@/lib/status";
import {
  approveInvoice, certifyInvoice, deleteIssue, issueCertificate, payInvoice, rejectCertificate, rejectInvoice, setIssueStatus, startInvoiceReview,
} from "../actions";
import { getAssignments, getCertificates, getInvoices, getIssues, getProjectSubPerformance, type InvoiceRow, type ProjectRow, type StageRowEx } from "../queries";
import { DelayBarChart } from "./Charts";
import ConfirmButton from "./ConfirmButton";
import { CertificateForm, InvoiceForm, IssueForm } from "./forms";

/* ------------------------------------------------------------------ Invoices & certificates */

function CertifyForm({ i }: { i: InvoiceRow }) {
  return (
    <form action={certifyInvoice} className="space-y-3">
      <input type="hidden" name="id" value={i.id} />
      <p className="text-sm text-slate-600">Invoice <b>{i.invoice_no}</b> from {i.subcontractor_name}: claimed <b>{formatMoney(i.claimed_amount)}</b>.</p>
      <Field label="Certified amount" hint={`Retention ${i.retention_pct}% and advance recovery ${i.advance_pct}% (from ${i.assignment_code} terms) are deducted automatically.`}>
        <Input name="certified_amount" type="number" step="any" min="0" defaultValue={i.certified_amount || i.claimed_amount} required />
      </Field>
      <div className="flex justify-end"><Button type="submit" variant="primary">Certify</Button></div>
    </form>
  );
}

function PayForm({ i }: { i: InvoiceRow }) {
  return (
    <form action={payInvoice} className="space-y-3">
      <input type="hidden" name="id" value={i.id} />
      <p className="text-sm text-slate-600">Net payable for <b>{i.invoice_no}</b>: <b>{formatMoney(i.net_payable)}</b></p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid amount"><Input name="paid_amount" type="number" step="any" min="0" defaultValue={i.net_payable} required /></Field>
        <Field label="Paid date"><Input name="paid_date" type="date" defaultValue={todayISO()} /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" variant="success">Record payment</Button></div>
    </form>
  );
}

function RejectForm({ id, kind }: { id: number; kind: "invoice" }) {
  void kind;
  return (
    <form action={rejectInvoice} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field label="Reason"><Input name="reason" /></Field>
      <div className="flex justify-end"><Button type="submit" variant="danger">Reject invoice</Button></div>
    </form>
  );
}

export function InvoicesTab({ project, me }: { project: ProjectRow; me: AuthUser }) {
  const invoices = getInvoices(project.id);
  const certs = getCertificates(project.id);
  const asg = getAssignments(project.id).map((a) => ({ value: a.id, label: `${a.code} · ${a.subcontractor_name}` }));
  const tot = invoices.reduce((a, i) => ({ claimed: a.claimed + i.claimed_amount, cert: a.cert + (["certified", "approved", "paid"].includes(i.status) ? i.certified_amount : 0), paid: a.paid + i.paid_amount }), { claimed: 0, cert: 0, paid: 0 });
  return (
    <div className="space-y-5">
      <CardSection title="Subcontractor invoices" subtitle={`Claimed ${formatMoney(tot.claimed, { compact: true })} · certified ${formatMoney(tot.cert, { compact: true })} · paid ${formatMoney(tot.paid, { compact: true })}`} flush
        actions={<ModalButton label="Record invoice" title="Record invoice" variant="primary" size="sm" wide icon={<Plus size={14} className="mr-1" />}><InvoiceForm projectId={project.id} assignments={asg} today={todayISO()} /></ModalButton>}>
        {invoices.length === 0 ? <div className="p-4"><EmptyState title="No invoices" /></div> : (
          <Table>
            <THead><TR><TH>Invoice</TH><TH>Subcontractor</TH><TH>Date / period</TH><TH num>Claimed</TH><TH num>Certified</TH><TH num>Retention</TH><TH num>Adv. recovery</TH><TH num>Net payable</TH><TH num>Paid</TH><TH>Status</TH><TH>Actions</TH></TR></THead>
            <TBody>
              {invoices.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap font-medium">{i.invoice_no}{i.source === "portal" && <Badge tone="violet" className="ml-1">Portal</Badge>}</TD>
                  <TD><div className="text-xs">{i.subcontractor_name}</div><div className="text-xs text-slate-400">{i.assignment_code}</div></TD>
                  <TD className="whitespace-nowrap text-xs">{formatDate(i.invoice_date)}{i.period_from && <div className="text-slate-400">{formatDate(i.period_from)} → {formatDate(i.period_to)}</div>}</TD>
                  <TD num>{formatMoney(i.claimed_amount)}</TD>
                  <TD num>{i.certified_amount ? formatMoney(i.certified_amount) : "—"}</TD>
                  <TD num>{i.retention_amount ? formatMoney(i.retention_amount) : "—"}</TD>
                  <TD num>{i.advance_recovery ? formatMoney(i.advance_recovery) : "—"}</TD>
                  <TD num>{i.net_payable ? formatMoney(i.net_payable) : "—"}</TD>
                  <TD num>{i.paid_amount ? <>{formatMoney(i.paid_amount)}<div className="text-xs text-slate-400">{formatDate(i.paid_date)}</div></> : "—"}</TD>
                  <TD><StatusBadge kind="invoiceStatus" value={i.status} /></TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1">
                      {i.status === "submitted" && <form action={startInvoiceReview}><input type="hidden" name="id" value={i.id} /><Button type="submit" size="sm">Review</Button></form>}
                      {["submitted", "under_review"].includes(i.status) && <ModalButton label="Certify" title={`Certify ${i.invoice_no}`} variant="primary" size="sm"><CertifyForm i={i} /></ModalButton>}
                      {i.status === "certified" && !hasOpenRequest("sub_invoice", i.id) && can(me, "invoices", "approve") && <form action={approveInvoice}><input type="hidden" name="id" value={i.id} /><Button type="submit" variant="success" size="sm">Request approval</Button></form>}
                      {i.status === "certified" && <ModalButton label="Re-certify" title={`Re-certify ${i.invoice_no}`} variant="ghost" size="sm"><CertifyForm i={i} /></ModalButton>}
                      {i.status === "approved" && !hasOpenRequest("invoice_payment", i.id) && <ModalButton label="Pay" title={`Pay ${i.invoice_no}`} variant="success" size="sm"><PayForm i={i} /></ModalButton>}
                      <ApprovalPanel compact label="Invoice approval" type="sub_invoice" documentId={i.id} path={`/projects/${project.id}?tab=invoices`} user={me} title={`Invoice approval ${i.invoice_no ?? i.id}`} />
                      <ApprovalPanel compact label="Payment approval" type="invoice_payment" documentId={i.id} path={`/projects/${project.id}?tab=invoices`} user={me} title={`Payment approval ${i.invoice_no ?? i.id}`} />
                      {!["paid", "rejected"].includes(i.status) && <ModalButton label="Reject" title={`Reject ${i.invoice_no}`} variant="ghost" size="sm"><RejectForm id={i.id} kind="invoice" /></ModalButton>}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>

      <CardSection title="Completion certificates" subtitle={`${certs.length} certificates`} flush
        actions={<ModalButton label="New certificate" title="New completion certificate" variant="primary" size="sm" wide icon={<Plus size={14} className="mr-1" />}><CertificateForm projectId={project.id} assignments={asg} today={todayISO()} /></ModalButton>}>
        {certs.length === 0 ? <div className="p-4"><EmptyState title="No certificates" /></div> : (
          <Table>
            <THead><TR><TH>No.</TH><TH>Subcontractor</TH><TH>Stage</TH><TH>Type</TH><TH>Date</TH><TH num>%</TH><TH num>Qty</TH><TH>Remarks</TH><TH>Status</TH><TH>Actions</TH></TR></THead>
            <TBody>
              {certs.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap font-medium">{c.cert_no}{c.source === "portal" && <Badge tone="violet" className="ml-1">Portal</Badge>}</TD>
                  <TD><div className="text-xs">{c.subcontractor_name}</div><div className="text-xs text-slate-400">{c.assignment_code}</div></TD>
                  <TD>{c.stage_code ?? "—"}</TD>
                  <TD><StatusBadge kind="certType" value={c.cert_type} /></TD>
                  <TD className="whitespace-nowrap">{formatDate(c.cert_date)}</TD>
                  <TD num>{c.percent !== null ? `${c.percent}%` : "—"}</TD>
                  <TD num>{c.quantity !== null ? formatNumber(c.quantity, 2) : "—"}</TD>
                  <TD className="max-w-[220px] truncate text-xs" title={c.remarks ?? ""}>{c.remarks ?? "—"}</TD>
                  <TD><StatusBadge kind="certStatus" value={c.status} />{c.issuer_name && c.status === "issued" && <div className="text-xs text-slate-400">{c.issuer_name}</div>}</TD>
                  <TD>
                    <div className="flex gap-1">
                      <ApprovalPanel compact label="Issue approval" type="completion_certificate" documentId={c.id} path={`/projects/${project.id}?tab=invoices`} user={me} title={`Certificate approval ${c.cert_no ?? c.id}`} />
                      {["draft", "requested", "rejected"].includes(c.status) && !hasOpenRequest("completion_certificate", c.id) && <form action={issueCertificate}><input type="hidden" name="id" value={c.id} /><Button type="submit" variant="success" size="sm">Issue</Button></form>}
                      {["draft", "requested"].includes(c.status) && <form action={rejectCertificate}><input type="hidden" name="id" value={c.id} /><ConfirmButton message="Reject this certificate?" variant="ghost">Reject</ConfirmButton></form>}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </div>
  );
}

/* ------------------------------------------------------------------ Delays & issues */

export function DelaysTab({ project, stages }: { project: ProjectRow; stages: StageRowEx[] }) {
  const att = getDelayAttribution(project.id);
  const issues = getIssues(project.id);
  const asg = getAssignments(project.id);
  const perf = getProjectSubPerformance(project.id);
  const overall = new Map(getSubcontractorPerformance().map((p) => [p.subcontractorId, p]));
  const cur = getCurrency();
  const so = stages.map((s) => ({ value: s.id, label: `${s.code ?? ""} ${s.name}`.trim() }));
  const ao = asg.map((a) => ({ value: a.id, label: `${a.code} · ${a.subcontractor_name}` }));
  const byDays = att.byResponsibility.filter((r) => r.days > 0).map((r) => ({ label: statusLabel("responsibility", r.responsibility), value: r.days }));
  const byCost = att.byResponsibility.filter((r) => r.cost > 0).map((r) => ({ label: statusLabel("responsibility", r.responsibility), value: r.cost }));
  const bySub = att.bySubcontractor.filter((r) => r.days > 0).map((r) => ({ label: r.name, value: r.days }));
  void statusHex;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <CardSection title="Delay days by responsibility" subtitle={`${formatNumber(att.total.days, 1)} days total`}>
          {byDays.length ? <DelayBarChart data={byDays} valueLabel="days" /> : <EmptyState title="No attributed delays" />}
        </CardSection>
        <CardSection title="Cost impact by responsibility" subtitle={formatMoney(att.total.cost, { compact: true })}>
          {byCost.length ? <DelayBarChart data={byCost} valueLabel="cost" color="#d97706" currency={cur} /> : <EmptyState title="No cost impact recorded" />}
        </CardSection>
        <CardSection title="Delay days by subcontractor">
          {bySub.length ? <DelayBarChart data={bySub} valueLabel="days" color="#7c3aed" /> : <EmptyState title="No subcontractor-caused delays" />}
        </CardSection>
      </div>

      <CardSection title="Who is failing" subtitle="Subcontractors on this project ranked by schedule performance (worst SPI first)" flush>
        {perf.length === 0 ? <div className="p-4"><EmptyState title="No active subcontracts" /></div> : (
          <Table>
            <THead><TR><TH>#</TH><TH>Subcontractor</TH><TH>Trade</TH><TH num>Assignments</TH><TH num>Contract value</TH><TH num>Actual %</TH><TH num>Planned %</TH><TH num>SPI</TH><TH num>Late days</TH><TH num>Overall SPI</TH></TR></THead>
            <TBody>
              {perf.map((p, idx) => {
                const tone = p.spi === null ? "slate" : p.spi >= 0.95 ? "green" : p.spi >= 0.85 ? "amber" : "red";
                return (
                  <TR key={p.subcontractorId}>
                    <TD>{idx + 1}</TD>
                    <TD><Link href={`/subcontractors/${p.subcontractorId}`} className="font-medium text-blue-700 hover:underline">{p.name}</Link></TD>
                    <TD>{p.trade ?? "—"}</TD><TD num>{p.assignments}</TD><TD num>{formatMoney(p.contractValue, { compact: true })}</TD>
                    <TD num>{p.progressPct.toFixed(1)}%</TD><TD num>{p.plannedPct.toFixed(1)}%</TD>
                    <TD num><Badge tone={tone}>{formatRatio(p.spi)}</Badge></TD>
                    <TD num className={p.delayDays > 0 ? "font-medium text-red-600" : ""}>{formatNumber(p.delayDays, 1)}</TD>
                    <TD num>{formatRatio(overall.get(p.subcontractorId)?.spi ?? null)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardSection>

      <CardSection title="Issues & risks" subtitle={`${issues.filter((i) => i.status !== "closed").length} open`} flush
        actions={<ModalButton label="Raise issue" title="Raise issue" variant="primary" size="sm" wide icon={<Plus size={14} className="mr-1" />}><IssueForm projectId={project.id} stages={so} assignments={ao} today={todayISO()} /></ModalButton>}>
        {issues.length === 0 ? <div className="p-4"><EmptyState title="No issues raised" /></div> : (
          <Table>
            <THead><TR><TH>Issue</TH><TH>Responsibility</TH><TH>Stage / subcontract</TH><TH num>Days</TH><TH num>Cost</TH><TH>Raised</TH><TH>Status</TH><TH className="w-28" /></TR></THead>
            <TBody>
              {issues.map((i) => (
                <TR key={i.id} className={i.status === "closed" ? "opacity-60" : ""}>
                  <TD className="max-w-[300px]"><div className="font-medium text-slate-800">{i.title}</div>{i.description && <div className="truncate text-xs text-slate-500" title={i.description}>{i.description}</div>}</TD>
                  <TD><StatusBadge kind="responsibility" value={i.responsibility} /></TD>
                  <TD className="text-xs">{i.stage_code ?? "—"}{i.assignment_code ? ` · ${i.assignment_code}` : ""}</TD>
                  <TD num>{i.impact_days || "—"}</TD><TD num>{i.impact_cost ? formatMoney(i.impact_cost) : "—"}</TD>
                  <TD className="whitespace-nowrap text-xs">{formatDate(i.raised_on)}</TD>
                  <TD>
                    <form action={setIssueStatus} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={i.id} />
                      <Select name="status" defaultValue={i.status} options={statusOptions("issueStatus")} className="!w-28 !py-1 !text-xs" />
                      <Button type="submit" size="sm" variant="ghost">Set</Button>
                    </form>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1">
                      <ModalButton label="" title="Edit issue" variant="ghost" size="sm" wide icon={<Pencil size={14} />}><IssueForm projectId={project.id} issue={i} stages={so} assignments={ao} today={todayISO()} /></ModalButton>
                      <form action={deleteIssue}><input type="hidden" name="id" value={i.id} /><ConfirmButton message="Delete this issue?"><Trash2 size={14} className="text-slate-400" /></ConfirmButton></form>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </div>
  );
}

