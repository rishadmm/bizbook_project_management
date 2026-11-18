import Link from "next/link";
import { Pencil, Scissors, Plus, Trash2 } from "lucide-react";
import { CardSection, EmptyState, ModalButton, ProgressBar, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR} from "@/components/ui";
import { formatDate, formatKm, formatMoney, formatNumber, formatRatio, getCurrency, pct, todayISO } from "@/lib/format";
import { getProjectSCurve, type ProjectMetrics } from "@/lib/metrics";
import { statusLabel } from "@/lib/status";
import { formatLocal } from "@/lib/rfx";
import { rfxOfProject, stageTenderChips, type StageTenderChip } from "@/features/procurement/queries";
import { deleteStage } from "../actions";
import { firstLine, lineLengthKm } from "../geo";
import { getAssignments, getBudgetByCategory, getChildren, listUsers, type ProjectRow, type StageRowEx } from "../queries";
import { BudgetActualChart, SCurveChart } from "./Charts";
import ConfirmButton from "./ConfirmButton";
import { IndexChip, RagChip } from "./common";
import { StageForm, SubProjectForm } from "./forms";
import { projectMapFeatures, STAGE_LEGEND } from "./mapfeatures";
import ProjectMapPanel from "./ProjectMapPanel";
import SplitTools from "./SplitTools";

export const barTone = (rag: string) => (rag === "green" ? "green" : rag === "amber" ? "amber" : rag === "red" ? "red" : "blue") as "green" | "amber" | "red" | "blue";

/* ------------------------------------------------------------------ Overview */

export function OverviewTab({ project, stages, metrics }: { project: ProjectRow; stages: StageRowEx[]; metrics: ProjectMetrics }) {
  const m = metrics;
  const cur = getCurrency();
  const scurve = getProjectSCurve(project.id);
  const cats = getBudgetByCategory(project.id);
  const catData = cats.map((c) => ({ label: statusLabel("budgetCategory", c.category), budget: c.budget, actual: c.actual }));
  const spiTone = m.spi === null ? "default" : m.spi >= 0.95 ? "good" : m.spi >= 0.85 ? "warn" : "bad";
  const cpiTone = m.cpi === null ? "default" : m.cpi >= 0.95 ? "good" : m.cpi >= 0.85 ? "warn" : "bad";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Contract value" title={project.contract_value_usd != null ? `≈ USD ${formatNumber(project.contract_value_usd, 2)} (rate ${project.fx_rate_usd?.toFixed(6)}, ${formatDate(project.fx_date)})` : undefined} value={formatMoney(project.contract_value, { compact: true })} hint={`Margin ${formatMoney(project.contract_value - project.budget_cost, { compact: true })}`} />
        <Stat label="Budget (BAC)" value={formatMoney(m.bac, { compact: true })} hint={`EV ${formatMoney(m.ev, { compact: true })} · PV ${formatMoney(m.pv, { compact: true })}`} />
        <Stat label="Actual cost" value={formatMoney(m.ac, { compact: true })} hint={`${m.bac ? pct((m.ac / m.bac) * 100, 0) : "—"} of budget`} tone={m.ac > m.bac ? "bad" : "default"} />
        <Stat label="Committed" value={formatMoney(m.committed, { compact: true })} hint="Subcontract values" />
        <Stat label="% complete" value={pct(m.actualPct, 1)} hint={`Planned ${pct(m.plannedPct, 1)}`} tone={m.actualPct + 0.5 >= m.plannedPct ? "good" : "warn"} />
        <Stat label="SPI" value={formatRatio(m.spi)} hint="Earned / planned value" tone={spiTone} />
        <Stat label="CPI" value={formatRatio(m.cpi)} hint="Earned value / actual cost" tone={cpiTone} />
        <Stat label="EAC" value={formatMoney(m.eac, { compact: true })} hint={`VAC ${formatMoney(m.vac, { compact: true })}`} tone={m.vac < 0 ? "bad" : "default"} />
        <Stat label="Forecast finish" value={formatDate(m.forecastFinish)} hint={`Planned ${formatDate(project.end_date)}`} />
        <Stat label="Delay (forecast)" value={`${m.delayDays} d`} hint={`${formatNumber(m.reportedDelayDays)} d reported`} tone={m.delayDays > 14 ? "bad" : m.delayDays > 0 ? "warn" : "good"} />
        <Stat label="Health" value={<RagChip rag={m.rag} />} hint={project.region ?? undefined} />
        <Stat label="Length / size" value={project.quantity_unit === "km" ? formatKm(project.total_quantity) : `${formatNumber(project.total_quantity)} ${project.quantity_unit ?? ""}`} hint={`${stages.length} stages`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CardSection title="S-curve" subtitle="Cumulative % complete, planned vs actual (weekly)">
          {scurve.length ? <SCurveChart data={scurve} today={todayISO()} /> : <EmptyState title="No schedule" description="Set project start and end dates." />}
        </CardSection>
        <CardSection title="Budget vs actual by category">
          {catData.length ? <BudgetActualChart data={catData} currency={cur} /> : <EmptyState title="No budget or cost data" />}
        </CardSection>
      </div>

      <CardSection title="Stages" subtitle="Progress vs plan" flush>
        <StageTable stages={stages} projectId={project.id} compact />
      </CardSection>
      <ProcurementSection projectId={project.id} />
    </div>
  );
}

/** "Out to tender · RFX-… · closes 12 Dec" / "Awarded via RFX-…" chip of a stage (+ a "Float tender" row action). */
export function TenderChip({ chip, floatHref }: { chip?: StageTenderChip; floatHref?: string }) {
  if (!chip && !floatHref) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {chip && <Link href={`/procurement/${chip.rfxId}`} data-testid="stage-tender-chip" className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${chip.status === "awarded" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-indigo-50 text-indigo-700 ring-indigo-200"}`}>
        {chip.status === "awarded" ? `Awarded via ${chip.code}` : `Out to tender · ${chip.code}${chip.closing_at && ["published", "scheduled"].includes(chip.status) ? ` · closes ${formatLocalDay(chip.closing_at)}` : ""}`}</Link>}
      {floatHref && <Link href={floatHref} className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-primary ring-1 ring-inset ring-primary/30 hover:bg-primary-50">Float tender</Link>}
    </div>
  );
}
const formatLocalDay = (iso: string) => formatLocal(iso, false).slice(0, 6);

export function StageTable({ stages, projectId, compact, editable }: { stages: StageRowEx[]; projectId: number; compact?: boolean; editable?: boolean }) {
  if (!stages.length) return <div className="p-4"><EmptyState title="No stages yet" description="Create stages manually or split the project route." /></div>;
  const chips = stageTenderChips(projectId);
  const assigned = new Set(getAssignments(projectId).filter((a) => a.stage_id && a.status !== "terminated").map((a) => a.stage_id as number));
  const tot = stages.reduce((a, s) => ({ qty: a.qty + (s.planned_quantity || 0), bud: a.bud + (s.budget_amount || 0) }), { qty: 0, bud: 0 });
  return (
    <Table>
      <THead><TR>
        <TH>Stage</TH>{!compact && <TH>Chainage</TH>}<TH num>Qty</TH><TH>Planned</TH>{!compact && <TH num>Budget</TH>}<TH num>Weight</TH><TH>Status</TH>
        <TH className="w-56">Progress (actual | planned tick)</TH><TH num>SPI</TH><TH>RAG</TH>{editable && <TH className="w-24" />}
      </TR></THead>
      <TBody>
        {stages.map((s) => (
          <TR key={s.id}>
            <TD><Link href={`/projects/${projectId}/stages/${s.id}`} className="font-medium text-blue-700 hover:underline">{s.code ? `${s.code} · ` : ""}{s.name}</Link>
              <TenderChip chip={chips.get(s.id)} floatHref={editable && !chips.has(s.id) && !assigned.has(s.id) ? `/procurement/new?project=${projectId}&stages=${s.id}` : undefined} /></TD>
            {!compact && <TD className="whitespace-nowrap text-xs">{s.chainage_from !== null ? `${formatNumber(s.chainage_from, 1)} – ${formatNumber(s.chainage_to, 1)} km` : "—"}</TD>}
            <TD num>{formatNumber(s.planned_quantity, 2)} <span className="text-xs text-slate-400">{s.quantity_unit}</span></TD>
            <TD className="whitespace-nowrap text-xs">{formatDate(s.planned_start)} → {formatDate(s.planned_end)}</TD>
            {!compact && <TD num>{formatMoney(s.budget_amount, { compact: true })}</TD>}
            <TD num>{s.weight_pct !== null ? `${s.weight_pct}%` : pct(s.weight * 100, 1)}</TD>
            <TD><StatusBadge kind="stageStatus" value={s.status} /></TD>
            <TD><ProgressBar value={s.progress.actualPct} planned={s.progress.plannedPct} tone={barTone(s.progress.rag)} showLabel /></TD>
            <TD num>{formatRatio(s.progress.spi)}</TD>
            <TD><RagChip rag={s.progress.rag} /></TD>
            {editable && (
              <TD>
                <div className="flex items-center justify-end gap-1">
                  <ModalButton label="" title={`Edit ${s.name}`} variant="ghost" size="sm" wide icon={<Pencil size={14} />}><StageForm projectId={projectId} stage={s} /></ModalButton>
                  <form action={deleteStage}><input type="hidden" name="id" value={s.id} /><ConfirmButton message={`Delete stage ${s.name}?`}><Trash2 size={14} className="text-slate-400" /></ConfirmButton></form>
                </div>
              </TD>
            )}
          </TR>
        ))}
        <TR className="bg-slate-50 font-medium"><TD>Total</TD>{!compact && <TD />}<TD num>{formatNumber(tot.qty, 2)}</TD><TD />{!compact && <TD num>{formatMoney(tot.bud, { compact: true })}</TD>}<TD /><TD /><TD /><TD /><TD />{editable && <TD />}</TR>
      </TBody>
    </Table>
  );
}

/* ------------------------------------------------------------------ Map */

/** Supplier tenders of the project (Overview). */
export function ProcurementSection({ projectId }: { projectId: number }) {
  const rows = rfxOfProject(projectId);
  if (!rows.length) return null;
  return (
    <CardSection title="Procurement" subtitle={`${rows.length} supplier tender${rows.length === 1 ? "" : "s"}`} flush>
      <Table><THead><TR><TH>Tender</TH><TH>Status</TH><TH>Closing</TH><TH num>Estimate / award</TH></TR></THead>
        <TBody>{rows.map((t) => (<TR key={t.id}><TD><Link href={`/procurement/${t.id}`} className="font-bold text-primary-dark hover:underline">{t.code}</Link><div className="max-w-[320px] truncate text-xs text-slate-500">{t.title}</div></TD><TD><StatusBadge kind="rfxStatus" value={t.status} /></TD>
          <TD className="whitespace-nowrap text-xs">{formatLocal(t.closing_at)}</TD><TD num>{formatMoney(t.status === "awarded" ? t.award_value : t.estimate, { compact: true })}</TD></TR>))}</TBody></Table>
    </CardSection>
  );
}

export async function MapTab({ project, stages, edit }: { project: ProjectRow; stages: StageRowEx[]; edit: boolean }) {
  const asg = getAssignments(project.id);
  const subsByStage = new Map<number, string[]>();
  asg.filter((a) => a.stage_id && a.status !== "terminated").forEach((a) => subsByStage.set(a.stage_id!, [...(subsByStage.get(a.stage_id!) ?? []), a.subcontractor_name]));
  const features = projectMapFeatures(project, stages, subsByStage, edit, stageTenderChips(project.id));
  const line = firstLine(project.geometry);
  return (
    <div className="space-y-4">
      <ProjectMapPanel projectId={project.id} features={features} legend={STAGE_LEGEND} editable={edit} />
      {features.length === 0 && !edit && <p className="text-sm text-slate-500">No geometry yet. Use <b>Edit map</b> to draw the project route or area.</p>}
      <CardSection title="Stage helpers" subtitle="Create stages from the project route"><SplitTools projectId={project.id} routeKm={line ? lineLengthKm(line) : null} hasStages={stages.length > 0} /></CardSection>
    </div>
  );
}

/* ------------------------------------------------------------------ Stages */

export function StagesTab({ project, stages }: { project: ProjectRow; stages: StageRowEx[] }) {
  const line = firstLine(project.geometry);
  return (
    <CardSection title="Stages" subtitle={`${stages.length} stages`} flush actions={
      <>
        <ModalButton label="Split route" title="Split route into stages" size="sm" icon={<Scissors size={14} className="mr-1" />} wide>
          <SplitTools projectId={project.id} routeKm={line ? lineLengthKm(line) : null} hasStages={stages.length > 0} />
        </ModalButton>
        <ModalButton label="Add stage" title="Add stage" variant="primary" size="sm" wide icon={<Plus size={14} className="mr-1" />}><StageForm projectId={project.id} /></ModalButton>
      </>
    }>
      <StageTable stages={stages} projectId={project.id} editable />
    </CardSection>
  );
}

/* ------------------------------------------------------------------ Sub-projects */

export function SubProjectsTab({ project }: { project: ProjectRow }) {
  const kids = getChildren(project.id);
  const users = listUsers(project.entity_id).map((u) => ({ value: u.id, label: u.name }));
  return (
    <CardSection title="Sub-projects" subtitle={project.parent_id ? `This is itself a sub-project of ${project.parent_code}` : `${kids.length} sub-projects`} flush
      actions={<ModalButton label="New sub-project" title={`New sub-project of ${project.code}`} variant="primary" size="sm" wide icon={<Plus size={14} className="mr-1" />}><SubProjectForm parentId={project.id} users={users} unit={project.quantity_unit} today={todayISO()} /></ModalButton>}>
      {kids.length === 0 ? <div className="p-4"><EmptyState title="No sub-projects" description="Sub-projects inherit client and category, and can take a slice of this project's route." /></div> : (
        <Table>
          <THead><TR><TH>Project</TH><TH>Status</TH><TH>Region</TH><TH num>Length</TH><TH>Dates</TH><TH num>Budget</TH><TH className="w-48">Progress</TH><TH>Health</TH></TR></THead>
          <TBody>
            {kids.map((k) => (
              <TR key={k.id}>
                <TD><Link href={`/projects/${k.id}`} className="font-medium text-blue-700 hover:underline">{k.code}</Link><div className="text-xs text-slate-500">{k.name}</div></TD>
                <TD><StatusBadge kind="projectStatus" value={k.status} /></TD>
                <TD>{k.region ?? "—"}</TD>
                <TD num>{k.lengthKm !== null ? formatKm(k.lengthKm) : `${formatNumber(k.total_quantity)} ${k.quantity_unit ?? ""}`}</TD>
                <TD className="whitespace-nowrap text-xs">{formatDate(k.start_date)} → {formatDate(k.end_date)}</TD>
                <TD num>{formatMoney(k.budget_cost, { compact: true })}</TD>
                <TD><ProgressBar value={k.metrics.actualPct} planned={k.metrics.plannedPct} tone={barTone(k.metrics.rag)} showLabel /></TD>
                <TD><div className="flex gap-1"><RagChip rag={k.metrics.rag} /><IndexChip label="SPI" value={k.metrics.spi} /></div></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </CardSection>
  );
}

