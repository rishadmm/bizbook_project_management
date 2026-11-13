import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import { CardSection, EmptyState, ModalButton, PageHeader, ProgressBar, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate, formatMoney, formatNumber, formatRatio, pct } from "@/lib/format";
import { getStageProgress } from "@/lib/metrics";
import { statusHex } from "@/lib/status";
import type { Stage } from "@/lib/types";
import { StageHistoryChart } from "@/features/projects/components/Charts";
import { RagChip } from "@/features/projects/components/common";
import { StageForm } from "@/features/projects/components/forms";
import { barTone } from "@/features/projects/components/tabs1";
import { getAssignments, getInvoices, getProjectRow, getReports } from "@/features/projects/queries";
import { esc, parseFeatures } from "@/features/projects/geo";
import type { MapFeature } from "@/components/map/types";
import { requirePage } from "@/lib/auth";

export default async function StagePage({ params }: { params: Promise<{ id: string; stageId: string }> }) {
  await requirePage("projects");
  const { id: idStr, stageId: sidStr } = await params;
  const id = Number(idStr), sid = Number(sidStr);
  const project = Number.isInteger(id) ? getProjectRow(id) : undefined;
  const db = getDb();
  const stage = Number.isInteger(sid) ? (db.prepare("SELECT * FROM stages WHERE id = ? AND project_id = ?").get(sid, id) as Stage | undefined) : undefined;
  if (!project || !stage) notFound();

  const prog = getStageProgress(sid);
  const assignments = getAssignments(id).filter((a) => a.stage_id === sid);
  const reports = getReports(id, { stageId: sid }, 500);
  const verified = reports.filter((r) => r.status === "verified").sort((a, b) => a.report_date.localeCompare(b.report_date));
  let cum = 0;
  const history = verified.map((r) => { cum += r.quantity_done || 0; return { date: r.report_date, percent: stage.planned_quantity ? Math.min(100, Math.round((cum / stage.planned_quantity) * 1000) / 10) : r.percent_complete, quantity: Math.round(cum * 100) / 100 }; });
  const actualCost = (db.prepare("SELECT COALESCE(SUM(amount),0) v FROM project_costs WHERE stage_id = ?").get(sid) as { v: number }).v;
  const invoices = getInvoices(id, "AND a.stage_id = ?", [sid]);

  // consumed resources (verified reports)
  const mats = new Map<string, { unit: string | null; qty: number; cost: number }>();
  const crews = new Map<string, { head: number; hours: number }>();
  for (const r of verified) {
    for (const m of r.materials) { const x = mats.get(m.material) ?? { unit: m.unit, qty: 0, cost: 0 }; x.qty += m.quantity; x.cost += m.quantity * m.unit_cost; mats.set(m.material, x); }
    for (const m of r.manpower) { const x = crews.get(m.trade) ?? { head: 0, hours: 0 }; x.head += m.headcount; x.hours += m.hours; crews.set(m.trade, x); }
  }

  const features: MapFeature[] = [];
  parseFeatures(project.geometry).forEach((f, i) => features.push({ id: `p${i}`, kind: "project", geometry: f.geometry, color: "#cbd5e1", label: project.name, editable: false }));
  const g = parseFeatures(stage.geometry)[0];
  if (g) features.push({ id: stage.id, kind: "stage", geometry: g.geometry, color: statusHex("stageStatus", stage.status), progressPct: prog.actualPct, label: stage.name, editable: false,
    popupHtml: `<div>Actual <b>${pct(prog.actualPct, 0)}</b> vs planned ${pct(prog.plannedPct, 0)}</div><div>${esc(assignments.map((a) => a.subcontractor_name).join(", "))}</div>` });

  const so = [{ value: stage.id, label: stage.name }];
  void so;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: project.code, href: `/projects/${id}` }, { label: "Stages", href: `/projects/${id}?tab=stages` }, { label: stage.code ?? stage.name }]}
        title={`${stage.code ? stage.code + " · " : ""}${stage.name}`}
        description={stage.description ?? undefined}
        badges={<><StatusBadge kind="stageStatus" value={stage.status} /><RagChip rag={prog.rag} /></>}
        actions={<ModalButton label="Edit stage" title="Edit stage" size="sm" wide icon={<Pencil size={14} className="mr-1" />}><StageForm projectId={id} stage={stage} /></ModalButton>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Actual" value={pct(prog.actualPct, 1)} hint={`Planned ${pct(prog.plannedPct, 1)}`} />
        <Stat label="SPI" value={formatRatio(prog.spi)} tone={prog.spi === null ? "default" : prog.spi >= 0.95 ? "good" : prog.spi >= 0.85 ? "warn" : "bad"} />
        <Stat label="Quantity" value={formatNumber(prog.cumulativeQty, 2)} hint={`of ${formatNumber(stage.planned_quantity, 2)} ${stage.quantity_unit ?? ""}`} />
        <Stat label="Delay reported" value={`${formatNumber(prog.delayDays, 1)} d`} tone={prog.delayDays > 0 ? "warn" : "good"} />
        <Stat label="Budget" value={formatMoney(stage.budget_amount, { compact: true })} hint={`Actual ${formatMoney(actualCost, { compact: true })}`} tone={actualCost > stage.budget_amount && stage.budget_amount > 0 ? "bad" : "default"} />
        <Stat label="Schedule" value={formatDate(stage.planned_end)} hint={`Start ${formatDate(stage.planned_start)}`} />
      </div>

      <div className="space-y-5">
        <CardSection title="Stage map" subtitle={stage.chainage_from !== null ? `Chainage ${formatNumber(stage.chainage_from, 2)} – ${formatNumber(stage.chainage_to, 2)} km` : undefined}>
          {g ? <ProjectMapLazy features={features} height={380} /> : <EmptyState title="No geometry for this stage" description="Draw or generate it from the project's Map tab." />}
        </CardSection>

        <div className="grid gap-5 lg:grid-cols-2">
          <CardSection title="Progress history" subtitle="Cumulative verified quantity">
            {history.length ? <StageHistoryChart data={history} /> : <EmptyState title="No verified progress yet" />}
          </CardSection>
          <CardSection title="Subcontracts" flush>
            {assignments.length === 0 ? <div className="p-4"><EmptyState title="No subcontractor assigned" /></div> : (
              <Table>
                <THead><TR><TH>Code</TH><TH>Subcontractor</TH><TH num>Value</TH><TH className="w-36">Progress</TH><TH>Status</TH></TR></THead>
                <TBody>{assignments.map((a) => (
                  <TR key={a.id}><TD className="font-medium">{a.code}</TD><TD><Link href={`/subcontractors/${a.subcontractor_id}`} className="text-blue-700 hover:underline">{a.subcontractor_name}</Link></TD>
                    <TD num>{formatMoney(a.contract_value, { compact: true })}</TD>
                    <TD><ProgressBar value={a.progress.actualPct} planned={a.progress.plannedPct} tone={barTone(a.progress.spi === null ? "grey" : a.progress.spi >= 0.95 ? "green" : a.progress.spi >= 0.85 ? "amber" : "red")} showLabel /></TD>
                    <TD><StatusBadge kind="assignmentStatus" value={a.status} /></TD></TR>
                ))}</TBody>
              </Table>
            )}
          </CardSection>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <CardSection title="Materials consumed" subtitle="Verified reports" flush>
            {mats.size === 0 ? <div className="p-4"><EmptyState title="No materials recorded" /></div> : (
              <Table><THead><TR><TH>Material</TH><TH num>Quantity</TH><TH num>Cost</TH></TR></THead>
                <TBody>{[...mats.entries()].map(([k, v]) => <TR key={k}><TD>{k}</TD><TD num>{formatNumber(v.qty, 1)} {v.unit}</TD><TD num>{formatMoney(v.cost)}</TD></TR>)}</TBody></Table>
            )}
          </CardSection>
          <CardSection title="Manpower deployed" subtitle="Verified reports (head-days and hours)" flush>
            {crews.size === 0 ? <div className="p-4"><EmptyState title="No manpower recorded" /></div> : (
              <Table><THead><TR><TH>Trade</TH><TH num>Head-days</TH><TH num>Hours</TH></TR></THead>
                <TBody>{[...crews.entries()].map(([k, v]) => <TR key={k}><TD>{k}</TD><TD num>{formatNumber(v.head)}</TD><TD num>{formatNumber(v.hours)}</TD></TR>)}</TBody></Table>
            )}
          </CardSection>
        </div>

        <CardSection title="Progress reports" subtitle={`${reports.length} reports`} flush>
          {reports.length === 0 ? <div className="p-4"><EmptyState title="No reports" /></div> : (
            <Table>
              <THead><TR><TH>Date</TH><TH>Subcontract</TH><TH num>Qty</TH><TH num>Cumulative</TH><TH num>%</TH><TH num>Delay</TH><TH>Source</TH><TH>Status</TH></TR></THead>
              <TBody>{reports.slice(0, 40).map((r) => (
                <TR key={r.id}><TD className="whitespace-nowrap">{formatDate(r.report_date)}</TD><TD className="text-xs">{r.assignment_code ?? "Direct"}</TD><TD num>{formatNumber(r.quantity_done, 2)}</TD><TD num>{formatNumber(r.cumulative_quantity, 2)}</TD>
                  <TD num>{pct(r.percent_complete, 0)}</TD><TD num>{r.delay_days ? `${r.delay_days} d` : "—"}</TD><TD><StatusBadge kind="progressSource" value={r.source} /></TD><TD><StatusBadge kind="progressStatus" value={r.status} /></TD></TR>
              ))}</TBody>
            </Table>
          )}
        </CardSection>

        <CardSection title="Invoices" subtitle="For subcontracts on this stage" flush>
          {invoices.length === 0 ? <div className="p-4"><EmptyState title="No invoices" /></div> : (
            <Table>
              <THead><TR><TH>Invoice</TH><TH>Subcontractor</TH><TH>Date</TH><TH num>Claimed</TH><TH num>Certified</TH><TH num>Net payable</TH><TH num>Paid</TH><TH>Status</TH></TR></THead>
              <TBody>{invoices.map((i) => (
                <TR key={i.id}><TD className="font-medium">{i.invoice_no}</TD><TD className="text-xs">{i.subcontractor_name}</TD><TD>{formatDate(i.invoice_date)}</TD><TD num>{formatMoney(i.claimed_amount)}</TD>
                  <TD num>{i.certified_amount ? formatMoney(i.certified_amount) : "—"}</TD><TD num>{i.net_payable ? formatMoney(i.net_payable) : "—"}</TD><TD num>{i.paid_amount ? formatMoney(i.paid_amount) : "—"}</TD><TD><StatusBadge kind="invoiceStatus" value={i.status} /></TD></TR>
              ))}</TBody>
            </Table>
          )}
        </CardSection>

        <AttachmentsPanel entityType="stage" entityId={sid} revalidate={`/projects/${id}/stages/${sid}`} />
        <ActivityTimeline entityType="stage" entityId={sid} />
      </div>
    </>
  );
}
