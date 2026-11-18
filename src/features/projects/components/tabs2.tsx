import Link from "next/link";
import { ExternalLink, Gavel, Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import { Badge, Button, CardSection, EmptyState, ModalButton, ProgressBar, Select, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { can, type AuthUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDate, formatMoney, formatNumber, pct, todayISO, getCurrency } from "@/lib/format";
import { statusLabel, statusOptions } from "@/lib/status";
import { deleteAssignment, deleteManualCost, regeneratePortalToken, rejectProgressReport, setPortalEnabled, verifyProgressReport } from "../actions";
import {
  getAssignments, getBudgetByCategory, getBudgetByStage, getBudgetLines, getCosts, getReports, listSubcontractors,
  type ProjectRow, type ReportFilters, type StageRowEx,
} from "../queries";
import { BudgetActualChart } from "./Charts";
import ConfirmButton from "./ConfirmButton";
import CopyLinkButton from "./CopyLinkButton";
import { varianceClass } from "./common";
import { AssignmentForm, CostForm } from "./forms";
import ProgressForm from "./ProgressForm";
import { barTone } from "./tabs1";

const stageOpts = (stages: StageRowEx[]) => stages.map((s) => ({ value: s.id, label: `${s.code ?? ""} ${s.name}`.trim() }));

const rfxCode = (id: number) => (getDb().prepare("SELECT code FROM rfx_tenders WHERE id = ?").get(id) as { code: string } | undefined)?.code ?? `#${id}`;

/* ------------------------------------------------------------------ Subcontracts */

export function SubcontractsTab({ project, stages, me }: { project: ProjectRow; stages: StageRowEx[]; me: AuthUser }) {
  const rows = getAssignments(project.id);
  const subs = listSubcontractors(project.entity_id).map((s) => ({ value: s.id, label: `${s.name}${s.trade ? ` (${s.trade})` : ""}${s.status !== "approved" ? ` – ${s.status}` : ""}` }));
  const so = stageOpts(stages);
  const total = rows.reduce((a, r) => a + r.contract_value, 0);
  return (
    <CardSection title="Subcontracts" subtitle={`${rows.length} assignments · ${formatMoney(total, { compact: true })} committed`} flush
      actions={<>
        <ModalButton label="Assign directly" title="New subcontract (direct assignment)" variant="primary" size="sm" wide icon={<Plus size={14} className="mr-1" />}><AssignmentForm projectId={project.id} stages={so} subs={subs} /></ModalButton>
        {can(me, "procurement", "create") && <Link href={`/procurement/new?project=${project.id}`} data-testid="float-tender" className={buttonClass("primary", "sm")}><Gavel size={14} />Float a tender</Link>}</>}>
      {rows.length === 0 ? <div className="p-4"><EmptyState title="No subcontracts" description="Assign a subcontractor to a stage to start tracking work, invoices and portal submissions." /></div> : (
        <Table>
          <THead><TR><TH>Code</TH><TH>Subcontractor</TH><TH>Stage / scope</TH><TH num>Value</TH><TH>Dates</TH><TH>Terms</TH><TH className="w-40">Progress</TH><TH num>Certified / Paid</TH><TH>Status</TH><TH>Portal</TH><TH className="w-20" /></TR></THead>
          <TBody>
            {rows.map((a) => (
              <TR key={a.id}>
                <TD className="whitespace-nowrap font-medium">{a.code}<div className="whitespace-nowrap text-xs font-normal" data-testid="asg-source">{a.source === "tender" && a.rfx_id ? <Link href={`/procurement/${a.rfx_id}`} className="font-semibold text-indigo-700 hover:underline">Tender {rfxCode(a.rfx_id)}</Link> : <span className="text-slate-400">Direct</span>}</div></TD>
                <TD><Link href={`/subcontractors/${a.subcontractor_id}`} className="text-blue-700 hover:underline">{a.subcontractor_name}</Link></TD>
                <TD className="max-w-[240px]"><div className="text-xs font-medium text-slate-700">{a.stage_code ?? "Whole project"}</div><div className="truncate text-xs text-slate-500" title={a.scope ?? ""}>{a.scope ?? "—"}</div></TD>
                <TD num>{formatMoney(a.contract_value, { compact: true })}<div className="text-xs text-slate-400">{a.quantity ? `${formatNumber(a.quantity, 2)} ${a.quantity_unit ?? ""}` : ""}</div></TD>
                <TD className="whitespace-nowrap text-xs">{formatDate(a.start_date)} → {formatDate(a.end_date)}</TD>
                <TD className="whitespace-nowrap text-xs">Adv {a.advance_pct}% · Ret {a.retention_pct}% · {a.payment_days}d</TD>
                <TD><ProgressBar value={a.progress.actualPct} planned={a.progress.plannedPct} tone={barTone(a.progress.spi === null ? "grey" : a.progress.spi >= 0.95 ? "green" : a.progress.spi >= 0.85 ? "amber" : "red")} showLabel /></TD>
                <TD num className="text-xs">{formatMoney(a.progress.certified, { compact: true })}<div className="text-slate-400">{formatMoney(a.progress.paid, { compact: true })}</div></TD>
                <TD><div className="flex flex-col items-start gap-1"><StatusBadge kind="assignmentStatus" value={a.status} /><ApprovalPanel compact label="Award" type="subcontract_award" documentId={a.id} path={`/projects/${project.id}?tab=subcontracts`} user={me} canSubmit={can(me, "subcontractors", "edit") && a.status === "draft"} title={`Award approval ${a.code ?? ""}`} /></div></TD>
                <TD>
                  <div className="flex flex-col items-start gap-1">
                    <form action={setPortalEnabled}>
                      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="enable" value={a.portal_enabled ? "0" : "1"} />
                      <button className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${a.portal_enabled ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`} title="Click to toggle">{a.portal_enabled ? "Enabled" : "Disabled"}</button>
                    </form>
                    {a.portal_token && (
                      <div className="flex items-center gap-1">
                        <CopyLinkButton token={a.portal_token} label="Copy" />
                        <a href={`/portal/${a.portal_token}`} target="_blank" className="rounded p-1 text-slate-500 hover:bg-slate-100" title="Open portal"><ExternalLink size={14} /></a>
                        <form action={regeneratePortalToken}><input type="hidden" name="id" value={a.id} /><ConfirmButton message="Regenerate the portal link? The old link stops working." variant="ghost" size="sm" title="Regenerate link">↻</ConfirmButton></form>
                      </div>
                    )}
                  </div>
                </TD>
                <TD>
                  <div className="flex items-center gap-1">
                    <ModalButton label="" title={`Edit ${a.code}`} variant="ghost" size="sm" wide icon={<Pencil size={14} />}><AssignmentForm projectId={project.id} assignment={a} stages={so} subs={subs} /></ModalButton>
                    <form action={deleteAssignment}><input type="hidden" name="id" value={a.id} /><ConfirmButton message={`Delete ${a.code}?`}><Trash2 size={14} className="text-slate-400" /></ConfirmButton></form>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </CardSection>
  );
}

/* ------------------------------------------------------------------ Progress */

export function ProgressTab({ project, stages, filters }: { project: ProjectRow; stages: StageRowEx[]; filters: ReportFilters }) {
  const reports = getReports(project.id, filters);
  const asg = getAssignments(project.id);
  const subs = [...new Map(asg.map((a) => [a.subcontractor_id, a.subcontractor_name])).entries()].map(([value, label]) => ({ value, label }));
  const so = stageOpts(stages);
  const pending = reports.filter((r) => r.status === "submitted").length;
  return (
    <div className="space-y-4">
      {pending > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{pending} submission{pending > 1 ? "s" : ""} awaiting verification. Only verified reports count toward progress.</div>}
      <CardSection title="Progress reports" subtitle={`${reports.length} shown`} flush
        actions={
          <>
            <form className="flex items-center gap-2" method="get">
              <input type="hidden" name="tab" value="progress" />
              <Select name="stage" defaultValue={filters.stageId ?? ""} options={so} placeholder="All stages" className="!w-36 !py-1" />
              <Select name="sub" defaultValue={filters.subcontractorId ?? ""} options={subs} placeholder="All subcontractors" className="!w-44 !py-1" />
              <Select name="status" defaultValue={filters.status ?? ""} options={statusOptions("progressStatus")} placeholder="All statuses" className="!w-32 !py-1" />
              <Button type="submit" size="sm">Filter</Button>
              <Link href={`/projects/${project.id}?tab=progress`} className="text-xs text-slate-500 hover:underline">Clear</Link>
            </form>
            <ModalButton label="Add report" title="Add progress report" variant="primary" size="sm" wide icon={<Plus size={14} className="mr-1" />}>
              <ProgressForm projectId={project.id} stages={so} assignments={asg.map((a) => ({ value: a.id, label: `${a.code} · ${a.subcontractor_name}` }))} responsibilities={statusOptions("responsibility")} today={todayISO()} />
            </ModalButton>
          </>
        }>
        {reports.length === 0 ? <div className="p-4"><EmptyState title="No progress reports" /></div> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Stage</TH><TH>Subcontract</TH><TH num>Qty (period / cum.)</TH><TH num>%</TH><TH num>Crew / hrs</TH><TH num>Delay</TH><TH>Source</TH><TH>Status</TH><TH className="w-64" /></TR></THead>
            <TBody>
              {reports.map((r) => (
                <TR key={r.id} className={r.status === "submitted" ? "bg-amber-50/40" : ""}>
                  <TD className="whitespace-nowrap">{formatDate(r.report_date)}</TD>
                  <TD>{r.stage_code ?? "—"}</TD>
                  <TD className="max-w-[200px]"><div className="truncate text-xs">{r.assignment_code ?? "Direct"}{r.subcontractor_name ? ` · ${r.subcontractor_name}` : ""}</div>
                    {(r.work_done || r.issues || r.materials.length > 0 || r.manpower.length > 0) && (
                      <details className="text-xs text-slate-500"><summary className="cursor-pointer text-blue-600">Details</summary>
                        {r.work_done && <p className="mt-1"><b>Work:</b> {r.work_done}</p>}
                        {r.issues && <p><b>Issues:</b> {r.issues}</p>}
                        {r.equipment_used && <p><b>Equipment:</b> {r.equipment_used}</p>}
                        {r.manpower.length > 0 && <p><b>Manpower:</b> {r.manpower.map((m) => `${m.trade} ${m.headcount}`).join(", ")}</p>}
                        {r.materials.length > 0 && <p><b>Materials:</b> {r.materials.map((m) => `${m.material} ${m.quantity}${m.unit ?? ""}`).join(", ")}</p>}
                        {r.delay_cause && <p><b>Delay cause:</b> {r.delay_cause} ({statusLabel("responsibility", r.delay_responsibility)})</p>}
                        {r.photoCount > 0 && <p>{r.photoCount} photo(s)</p>}
                      </details>)}
                  </TD>
                  <TD num>{formatNumber(r.quantity_done, 2)} <span className="text-slate-400">/ {formatNumber(r.cumulative_quantity, 2)}</span></TD>
                  <TD num>{pct(r.percent_complete, 0)}</TD>
                  <TD num>{r.manpower_count} / {formatNumber(r.man_hours)}</TD>
                  <TD num>{r.delay_days > 0 ? <span className="text-red-600">{r.delay_days} d<div className="text-xs text-slate-500">{statusLabel("responsibility", r.delay_responsibility)}</div></span> : "—"}</TD>
                  <TD><StatusBadge kind="progressSource" value={r.source} /></TD>
                  <TD><StatusBadge kind="progressStatus" value={r.status} /></TD>
                  <TD>
                    {r.status === "submitted" ? (
                      <div className="flex gap-1">
                        <form action={verifyProgressReport}><input type="hidden" name="id" value={r.id} /><Button type="submit" variant="success" size="sm"><Check size={13} className="mr-1" />Verify</Button></form>
                        <form action={rejectProgressReport} className="flex items-center gap-1"><input type="hidden" name="id" value={r.id} /><input name="reason" placeholder="Reason (shown to subcontractor)" aria-label="Rejection reason" className="w-28 rounded-lg border border-line px-2 py-1 text-xs" /><Button type="submit" variant="danger" size="sm"><X size={13} className="mr-1" />Reject</Button></form>
                      </div>
                    ) : r.status === "rejected" ? (
                      <form action={verifyProgressReport}><input type="hidden" name="id" value={r.id} /><Button type="submit" variant="ghost" size="sm">Verify anyway</Button></form>
                    ) : null}
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

/* ------------------------------------------------------------------ Budget & cost */

export function BudgetTab({ project, stages, me }: { project: ProjectRow; stages: StageRowEx[]; me: AuthUser }) {
  const cats = getBudgetByCategory(project.id);
  const byStage = getBudgetByStage(project.id);
  const lines = getBudgetLines(project.id);
  const costs = getCosts(project.id);
  const cur = getCurrency();
  const budgetLines = cats.reduce((a, c) => a + c.budget, 0);
  const actual = cats.reduce((a, c) => a + c.actual, 0);
  const so = stageOpts(stages);
  const data = cats.map((c) => ({ label: statusLabel("budgetCategory", c.category), budget: c.budget, actual: c.actual }));
  const pendingCosts = getDb().prepare("SELECT * FROM project_cost_requests WHERE project_id = ? AND status = 'pending' ORDER BY id DESC").all(project.id) as { id: number; category: string; description: string | null; amount: number; cost_date: string | null }[];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Project budget (BAC)" value={formatMoney(project.budget_cost, { compact: true })} />
        <Stat label="Budget lines" value={formatMoney(budgetLines, { compact: true })} />
        <Stat label="Actual cost" value={formatMoney(actual, { compact: true })} tone={actual > project.budget_cost ? "bad" : "default"} />
        <Stat label="Variance (BAC − actual)" value={formatMoney(project.budget_cost - actual, { compact: true })} tone={project.budget_cost - actual < 0 ? "bad" : "good"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <CardSection title="By category" flush>
          <Table>
            <THead><TR><TH>Category</TH><TH num>Budget</TH><TH num>Actual</TH><TH num>Variance</TH><TH num>Used</TH></TR></THead>
            <TBody>
              {cats.map((c) => (
                <TR key={c.category}><TD><StatusBadge kind="budgetCategory" value={c.category} /></TD><TD num>{formatMoney(c.budget)}</TD><TD num>{formatMoney(c.actual)}</TD>
                  <TD num className={varianceClass(c.variance)}>{formatMoney(c.variance)}</TD><TD num>{c.budget ? pct((c.actual / c.budget) * 100, 0) : "—"}</TD></TR>
              ))}
              <TR className="bg-slate-50 font-medium"><TD>Total</TD><TD num>{formatMoney(budgetLines)}</TD><TD num>{formatMoney(actual)}</TD><TD num className={varianceClass(budgetLines - actual)}>{formatMoney(budgetLines - actual)}</TD><TD num>{budgetLines ? pct((actual / budgetLines) * 100, 0) : "—"}</TD></TR>
            </TBody>
          </Table>
        </CardSection>
        <CardSection title="Chart">{data.length ? <BudgetActualChart data={data} currency={cur} /> : <EmptyState title="No data" />}</CardSection>
      </div>

      <CardSection title="By stage" subtitle="Stage budget (planned allocation) vs cost ledger" flush>
        <Table>
          <THead><TR><TH>Stage</TH><TH num>Stage budget</TH><TH num>Budget lines</TH><TH num>Actual</TH><TH num>Variance</TH><TH className="w-40">Used</TH></TR></THead>
          <TBody>
            {byStage.map((s) => (
              <TR key={s.stageId ?? "gen"}><TD>{s.code} {s.name}</TD><TD num>{formatMoney(s.budget)}</TD><TD num>{formatMoney(s.lineBudget)}</TD><TD num>{formatMoney(s.actual)}</TD>
                <TD num className={varianceClass(s.variance)}>{formatMoney(s.variance)}</TD>
                <TD>{s.budget ? <ProgressBar value={(s.actual / s.budget) * 100} tone={s.actual > s.budget ? "red" : "blue"} showLabel /> : "—"}</TD></TR>
            ))}
          </TBody>
        </Table>
      </CardSection>

      <CardSection title="Cost ledger" subtitle="Subcontract and material costs post automatically; add manual costs here" flush
        actions={<ModalButton label="Add manual cost" title="Add manual cost" variant="primary" size="sm" icon={<Plus size={14} className="mr-1" />}><CostForm projectId={project.id} stages={so} today={todayISO()} /></ModalButton>}>
        {costs.length === 0 ? <div className="p-4"><EmptyState title="No costs posted" /></div> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Category</TH><TH>Description</TH><TH>Stage</TH><TH>Source</TH><TH num>Amount</TH><TH className="w-10" /></TR></THead>
            <TBody>
              {costs.map((c) => (
                <TR key={c.id}><TD className="whitespace-nowrap">{formatDate(c.cost_date)}</TD><TD><StatusBadge kind="budgetCategory" value={c.category} /></TD><TD>{c.description}</TD><TD>{c.stage_code ?? "—"}</TD>
                  <TD><Badge tone={c.source_type === "manual" || !c.source_type ? "slate" : "violet"}>{c.source_type === "sub_invoice" ? "Invoice" : c.source_type === "progress_material" ? "Progress" : "Manual"}</Badge></TD>
                  <TD num>{formatMoney(c.amount)}</TD>
                  <TD>{(c.source_type === "manual" || !c.source_type) && <form action={deleteManualCost}><input type="hidden" name="id" value={c.id} /><ConfirmButton message="Delete this cost?"><Trash2 size={14} className="text-slate-400" /></ConfirmButton></form>}</TD></TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>

      {pendingCosts.length > 0 && (
        <CardSection title="Costs awaiting approval" subtitle="Manual costs above the approval threshold are posted to the ledger once approved" flush>
          <Table>
            <THead><TR><TH>Date</TH><TH>Category</TH><TH>Description</TH><TH num>Amount</TH><TH>Approval</TH></TR></THead>
            <TBody>
              {pendingCosts.map((c) => (
                <TR key={c.id}><TD className="whitespace-nowrap">{formatDate(c.cost_date)}</TD><TD><StatusBadge kind="budgetCategory" value={c.category} /></TD><TD>{c.description}</TD><TD num>{formatMoney(c.amount)}</TD>
                  <TD><ApprovalPanel compact label="Cost approval" type="project_cost" documentId={c.id} path={`/projects/${project.id}?tab=budget`} user={me} title={`Cost approval: ${c.description ?? ""}`} /></TD></TR>
              ))}
            </TBody>
          </Table>
        </CardSection>
      )}

      <CardSection title="Budget lines" subtitle={`${lines.length} lines converted from the tender`} flush>
        {lines.length === 0 ? <div className="p-4"><EmptyState title="No budget lines" /></div> : (
          <Table>
            <THead><TR><TH>Category</TH><TH>Description</TH><TH>Stage</TH><TH>Unit</TH><TH num>Qty</TH><TH num>Unit cost</TH><TH num>Budget</TH></TR></THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.id}><TD><StatusBadge kind="budgetCategory" value={l.category} /></TD><TD>{l.description}</TD><TD>{l.stage_code ?? "General"}</TD><TD>{l.unit}</TD>
                  <TD num>{formatNumber(l.quantity, 2)}</TD><TD num>{formatMoney(l.unit_cost)}</TD><TD num>{formatMoney(l.budget_amount)}</TD></TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </div>
  );
}

