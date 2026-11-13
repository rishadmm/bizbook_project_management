// Budget & EVM calculations — single source of truth (SPEC section 5).
// Pure functions first, then DB-backed helpers. All percentages are 0-100. Dates ISO YYYY-MM-DD.
import { getDb } from "./db";
import { addDays, daysBetween, todayISO } from "./format";
import type { DelayResponsibility, RagStatus } from "./types";

/* ------------------------------------------------------------------ pure: revision maths */

export interface Totals {
  cost: number;
  price: number;
  /** price - cost */
  margin_value: number;
  /** margin on price: margin_value / price * 100 */
  margin_pct: number;
  /** markup on cost: margin_value / cost * 100 */
  markup_pct: number;
}

/** cost = qty*unit_cost; price = cost*(1+margin/100). */
export function lineAmounts(quantity: number, unitCost: number, marginPct: number): { cost: number; price: number; margin_value: number } {
  const cost = (quantity || 0) * (unitCost || 0);
  const price = cost * (1 + (marginPct || 0) / 100);
  return { cost, price, margin_value: price - cost };
}

/** Totals for any list of lines {quantity, unit_cost, margin_pct}. */
export function computeTotals(lines: { quantity: number; unit_cost: number; margin_pct: number }[]): Totals {
  let cost = 0, price = 0;
  for (const l of lines) {
    const a = lineAmounts(l.quantity, l.unit_cost, l.margin_pct);
    cost += a.cost; price += a.price;
  }
  const margin_value = price - cost;
  return { cost, price, margin_value, margin_pct: price ? (margin_value / price) * 100 : 0, markup_pct: cost ? (margin_value / cost) * 100 : 0 };
}

/* ------------------------------------------------------------------ pure: progress maths */

/** Linear planned % (0-100) at `date` between start and end. */
export function plannedPctAt(start: string | null, end: string | null, date: string): number {
  if (!start || !end) return 0;
  if (date <= start) return 0;
  if (date >= end) return 100;
  const total = daysBetween(start, end);
  return total <= 0 ? 100 : (daysBetween(start, date) / total) * 100;
}

export function ragFromIndices(spi: number | null, cpi: number | null): RagStatus {
  if (spi === null && cpi === null) return "grey";
  const worst = Math.min(spi ?? 1, cpi ?? 1);
  if (worst >= 0.95) return "green";
  if (worst >= 0.85) return "amber";
  return "red";
}

/** Normalised stage weights (sum 1): weight_pct if all set, else budget share, else quantity share, else equal. */
export function stageWeights(stages: { id: number; weight_pct: number | null; budget_amount: number; planned_quantity: number }[]): Map<number, number> {
  const m = new Map<number, number>();
  if (!stages.length) return m;
  const pick = (f: (s: (typeof stages)[number]) => number, requireAll: boolean): boolean => {
    const vals = stages.map(f);
    const ok = requireAll ? vals.every((v) => v > 0) : vals.some((v) => v > 0);
    if (!ok) return false;
    const sum = vals.reduce((a, b) => a + b, 0);
    stages.forEach((s, i) => m.set(s.id, vals[i] / sum));
    return true;
  };
  if (pick((s) => s.weight_pct ?? 0, true)) return m;
  if (pick((s) => s.budget_amount, false)) return m;
  if (pick((s) => s.planned_quantity, false)) return m;
  stages.forEach((s) => m.set(s.id, 1 / stages.length));
  return m;
}

interface StageRow {
  id: number; project_id: number; planned_quantity: number; planned_start: string | null; planned_end: string | null;
  budget_amount: number; weight_pct: number | null; status: string; actual_start: string | null; actual_end: string | null;
}
interface VerifiedReport {
  stage_id: number | null; report_date: string; quantity_done: number; percent_complete: number; delay_days: number;
}

/** Stage actual % as of `asOf` from verified reports (cumulative qty / planned qty, fallback latest percent_complete). */
export function stageActualPct(stage: Pick<StageRow, "planned_quantity" | "status">, reports: VerifiedReport[], asOf?: string): number {
  const rs = asOf ? reports.filter((r) => r.report_date <= asOf) : reports;
  if (!rs.length) return stage.status === "completed" && !asOf ? 100 : 0;
  if (stage.planned_quantity > 0) {
    const qty = rs.reduce((a, r) => a + (r.quantity_done || 0), 0);
    if (qty > 0) return Math.min(100, (qty / stage.planned_quantity) * 100);
  }
  let latest = rs[0];
  for (const r of rs) if (r.report_date >= latest.report_date) latest = r;
  return Math.min(100, Math.max(0, latest.percent_complete || 0));
}

/* ------------------------------------------------------------------ DB: revisions */

export interface RevisionTotals extends Totals {
  revisionId: number;
  byCategory: { category: string; cost: number; price: number; margin_value: number }[];
  lineCount: number;
}

/** Totals + per-category breakdown for a tender revision's budget lines. */
export function getRevisionTotals(revisionId: number): RevisionTotals {
  const lines = getDb()
    .prepare("SELECT category, quantity, unit_cost, margin_pct FROM budget_lines WHERE revision_id = ?")
    .all(revisionId) as { category: string; quantity: number; unit_cost: number; margin_pct: number }[];
  const cats = new Map<string, { cost: number; price: number; margin_value: number }>();
  for (const l of lines) {
    const a = lineAmounts(l.quantity, l.unit_cost, l.margin_pct);
    const c = cats.get(l.category) ?? { cost: 0, price: 0, margin_value: 0 };
    c.cost += a.cost; c.price += a.price; c.margin_value += a.margin_value;
    cats.set(l.category, c);
  }
  return {
    revisionId, ...computeTotals(lines), lineCount: lines.length,
    byCategory: [...cats.entries()].map(([category, v]) => ({ category, ...v })),
  };
}

/** Recomputes and stores total_cost/total_price/margin_pct on tender_revisions. Call after any budget line change. */
export function refreshRevisionTotals(revisionId: number): RevisionTotals {
  const t = getRevisionTotals(revisionId);
  getDb().prepare("UPDATE tender_revisions SET total_cost = ?, total_price = ?, margin_pct = ? WHERE id = ?")
    .run(t.cost, t.price, t.margin_pct, revisionId);
  return t;
}

/* ------------------------------------------------------------------ DB: stage / project progress */

function verifiedReportsForProject(projectId: number): VerifiedReport[] {
  return getDb()
    .prepare("SELECT stage_id, report_date, quantity_done, percent_complete, delay_days FROM progress_reports WHERE project_id = ? AND status = 'verified' ORDER BY report_date")
    .all(projectId) as VerifiedReport[];
}

export interface StageProgress {
  stageId: number;
  /** 0-100 */ actualPct: number;
  /** 0-100 */ plannedPct: number;
  cumulativeQty: number;
  plannedQty: number;
  /** SPI at stage level (actual/planned), null if planned 0 */
  spi: number | null;
  lastReportDate: string | null;
  /** Σ delay_days on verified reports of this stage */
  delayDays: number;
  rag: RagStatus;
}

/** Progress of one stage as of `asOf` (default today). */
export function getStageProgress(stageId: number, asOf: string = todayISO()): StageProgress {
  const db = getDb();
  const st = db.prepare("SELECT * FROM stages WHERE id = ?").get(stageId) as StageRow | undefined;
  if (!st) return { stageId, actualPct: 0, plannedPct: 0, cumulativeQty: 0, plannedQty: 0, spi: null, lastReportDate: null, delayDays: 0, rag: "grey" };
  const reports = db
    .prepare("SELECT stage_id, report_date, quantity_done, percent_complete, delay_days FROM progress_reports WHERE stage_id = ? AND status = 'verified' ORDER BY report_date")
    .all(stageId) as VerifiedReport[];
  const actualPct = stageActualPct(st, reports, st.status === "completed" ? undefined : asOf);
  const plannedPct = plannedPctAt(st.planned_start, st.planned_end, asOf);
  const spi = plannedPct > 0 ? actualPct / plannedPct : null;
  return {
    stageId, actualPct, plannedPct,
    cumulativeQty: reports.filter((r) => r.report_date <= asOf).reduce((a, r) => a + (r.quantity_done || 0), 0),
    plannedQty: st.planned_quantity,
    spi, lastReportDate: reports.length ? reports[reports.length - 1].report_date : null,
    delayDays: reports.reduce((a, r) => a + (r.delay_days || 0), 0),
    rag: plannedPct === 0 && actualPct === 0 ? "grey" : ragFromIndices(spi, null),
  };
}

export interface ProjectMetrics {
  projectId: number;
  /** Budget at completion (projects.budget_cost) */ bac: number;
  /** Earned value = bac * actualPct/100 */ ev: number;
  /** Planned value = bac * plannedPct/100 */ pv: number;
  /** Actual cost = Σ project_costs */ ac: number;
  spi: number | null;
  cpi: number | null;
  /** Estimate at completion = bac / cpi (bac if cpi unknown) */ eac: number;
  /** bac - eac */ vac: number;
  actualPct: number;
  plannedPct: number;
  /** Σ assignment contract values (active/completed/suspended) */ committed: number;
  /** Forecast slip vs planned end (days, >=0): forecastFinish - end_date, or days overdue if not finished */ delayDays: number;
  /** Σ delay_days reported on verified progress reports */ reportedDelayDays: number;
  forecastFinish: string | null;
  rag: RagStatus;
  stages: (StageProgress & { weight: number })[];
}

/** Full EVM metrics for a project as of `asOf` (default today). */
export function getProjectMetrics(projectId: number, asOf: string = todayISO()): ProjectMetrics {
  const db = getDb();
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | { budget_cost: number; start_date: string | null; end_date: string | null; status: string } | undefined;
  const empty: ProjectMetrics = {
    projectId, bac: 0, ev: 0, pv: 0, ac: 0, spi: null, cpi: null, eac: 0, vac: 0, actualPct: 0, plannedPct: 0, committed: 0,
    delayDays: 0, reportedDelayDays: 0, forecastFinish: null, rag: "grey", stages: [],
  };
  if (!p) return empty;
  const stages = db.prepare("SELECT * FROM stages WHERE project_id = ? ORDER BY sort, id").all(projectId) as StageRow[];
  const reports = verifiedReportsForProject(projectId);
  const weights = stageWeights(stages);
  let actualPct = 0, plannedPct = 0;
  const stageOut = stages.map((s) => {
    const w = weights.get(s.id) ?? 0;
    const sr = reports.filter((r) => r.stage_id === s.id);
    const a = stageActualPct(s, sr, s.status === "completed" ? undefined : asOf);
    const pl = plannedPctAt(s.planned_start, s.planned_end, asOf);
    actualPct += a * w; plannedPct += pl * w;
    const spi = pl > 0 ? a / pl : null;
    return {
      stageId: s.id, actualPct: a, plannedPct: pl,
      cumulativeQty: sr.filter((r) => r.report_date <= asOf).reduce((x, r) => x + (r.quantity_done || 0), 0),
      plannedQty: s.planned_quantity, spi, lastReportDate: sr.length ? sr[sr.length - 1].report_date : null,
      delayDays: sr.reduce((x, r) => x + (r.delay_days || 0), 0),
      rag: pl === 0 && a === 0 ? ("grey" as RagStatus) : ragFromIndices(spi, null), weight: w,
    };
  });
  if (!stages.length) plannedPct = plannedPctAt(p.start_date, p.end_date, asOf);
  if (p.status === "completed" || p.status === "closed") actualPct = 100;
  const bac = p.budget_cost || 0;
  const ev = bac * (actualPct / 100);
  const pv = bac * (plannedPct / 100);
  const ac = (db.prepare("SELECT COALESCE(SUM(amount),0) v FROM project_costs WHERE project_id = ?").get(projectId) as { v: number }).v;
  const committed = (db.prepare("SELECT COALESCE(SUM(contract_value),0) v FROM assignments WHERE project_id = ? AND status IN ('active','completed','suspended')").get(projectId) as { v: number }).v;
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const eac = cpi && cpi > 0 ? bac / cpi : bac;

  let forecastFinish: string | null = null;
  let delayDays = 0;
  if (p.start_date && p.end_date) {
    if (actualPct >= 100) {
      const last = reports.length ? reports[reports.length - 1].report_date : p.end_date;
      forecastFinish = last;
    } else if (actualPct > 0 && asOf > p.start_date) {
      const elapsed = daysBetween(p.start_date, asOf);
      forecastFinish = addDays(p.start_date, Math.round(elapsed / (actualPct / 100)));
    }
    if (forecastFinish) delayDays = Math.max(0, daysBetween(p.end_date, forecastFinish));
    else if (asOf > p.end_date) delayDays = daysBetween(p.end_date, asOf);
  }
  return {
    projectId, bac, ev, pv, ac, spi, cpi, eac, vac: bac - eac, actualPct, plannedPct, committed, delayDays,
    reportedDelayDays: reports.reduce((a, r) => a + (r.delay_days || 0), 0), forecastFinish,
    rag: bac === 0 && !stages.length ? "grey" : ragFromIndices(spi, cpi), stages: stageOut,
  };
}

export interface SCurvePoint { date: string; planned: number; /** null in the future */ actual: number | null }

/** Weekly S-curve (planned vs actual cumulative %) from project start to max(end, today). */
export function getProjectSCurve(projectId: number): SCurvePoint[] {
  const db = getDb();
  const p = db.prepare("SELECT start_date, end_date FROM projects WHERE id = ?").get(projectId) as { start_date: string | null; end_date: string | null } | undefined;
  if (!p?.start_date) return [];
  const today = todayISO();
  const stages = db.prepare("SELECT * FROM stages WHERE project_id = ? ORDER BY sort, id").all(projectId) as StageRow[];
  const reports = verifiedReportsForProject(projectId);
  const weights = stageWeights(stages);
  const endDate = p.end_date && p.end_date > today ? p.end_date : today;
  const dates: string[] = [];
  for (let d = p.start_date; d < endDate; d = addDays(d, 7)) dates.push(d);
  dates.push(endDate);
  return dates.map((d) => {
    let planned = 0, actual = 0;
    if (!stages.length) planned = plannedPctAt(p.start_date, p.end_date, d);
    for (const s of stages) {
      const w = weights.get(s.id) ?? 0;
      planned += plannedPctAt(s.planned_start, s.planned_end, d) * w;
      if (d <= today) actual += stageActualPct({ planned_quantity: s.planned_quantity, status: "in_progress" }, reports.filter((r) => r.stage_id === s.id), d) * w;
    }
    return { date: d, planned: Math.round(planned * 10) / 10, actual: d <= today ? Math.round(actual * 10) / 10 : null };
  });
}

/* ------------------------------------------------------------------ DB: delay attribution */

export interface DelayAttribution {
  total: { days: number; cost: number };
  byResponsibility: { responsibility: DelayResponsibility; days: number; cost: number; count: number }[];
  bySubcontractor: { subcontractorId: number; name: string; days: number; cost: number }[];
}

/**
 * Σ verified progress-report delay_days + issue impact_days (and issue impact_cost) grouped by responsibility,
 * plus by subcontractor where responsibility = 'subcontractor'. `projectId` null = whole portfolio.
 * Rows with responsibility 'none' and no days are ignored.
 */
export function getDelayAttribution(projectId: number | null = null): DelayAttribution {
  const db = getDb();
  const pf = projectId === null ? "" : " AND project_id = ?";
  const args = projectId === null ? [] : [projectId];
  const reps = db.prepare(`SELECT assignment_id, delay_responsibility r, delay_days d FROM progress_reports WHERE status='verified' AND delay_days > 0${pf}`).all(...args) as { assignment_id: number | null; r: DelayResponsibility; d: number }[];
  const iss = db.prepare(`SELECT assignment_id, responsibility r, impact_days d, impact_cost c FROM issues WHERE (impact_days > 0 OR impact_cost > 0)${pf}`).all(...args) as { assignment_id: number | null; r: DelayResponsibility; d: number; c: number }[];
  const byR = new Map<DelayResponsibility, { days: number; cost: number; count: number }>();
  const byS = new Map<number, { days: number; cost: number }>();
  const add = (r: DelayResponsibility | null, asg: number | null, d: number, c: number) => {
    const key = (r ?? "other") as DelayResponsibility;
    const x = byR.get(key) ?? { days: 0, cost: 0, count: 0 };
    x.days += d || 0; x.cost += c || 0; x.count += 1; byR.set(key, x);
    if (key === "subcontractor" && asg) {
      const sub = db.prepare("SELECT subcontractor_id s FROM assignments WHERE id = ?").get(asg) as { s: number } | undefined;
      if (sub) { const y = byS.get(sub.s) ?? { days: 0, cost: 0 }; y.days += d || 0; y.cost += c || 0; byS.set(sub.s, y); }
    }
  };
  reps.forEach((r) => add(r.r, r.assignment_id, r.d, 0));
  iss.forEach((i) => add(i.r, i.assignment_id, i.d, i.c));
  const names = new Map((db.prepare("SELECT id, name FROM subcontractors").all() as { id: number; name: string }[]).map((s) => [s.id, s.name]));
  const byResponsibility = [...byR.entries()].map(([responsibility, v]) => ({ responsibility, ...v })).sort((a, b) => b.days - a.days);
  return {
    total: { days: byResponsibility.reduce((a, x) => a + x.days, 0), cost: byResponsibility.reduce((a, x) => a + x.cost, 0) },
    byResponsibility,
    bySubcontractor: [...byS.entries()].map(([subcontractorId, v]) => ({ subcontractorId, name: names.get(subcontractorId) ?? `#${subcontractorId}`, ...v })).sort((a, b) => b.days - a.days),
  };
}

/* ------------------------------------------------------------------ DB: assignments & subcontractors */

export interface AssignmentProgress {
  assignmentId: number;
  actualPct: number;
  plannedPct: number;
  spi: number | null;
  cumulativeQty: number;
  delayDays: number;
  lastReportDate: string | null;
  invoiced: number;
  certified: number;
  paid: number;
  /** certified/contract value */ certifiedPct: number;
}

/** Progress of one assignment from its verified reports (qty vs assignment quantity, fallback latest percent). */
export function getAssignmentProgress(assignmentId: number, asOf: string = todayISO()): AssignmentProgress {
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(assignmentId) as
    | { quantity: number | null; start_date: string | null; end_date: string | null; contract_value: number; status: string } | undefined;
  const base: AssignmentProgress = { assignmentId, actualPct: 0, plannedPct: 0, spi: null, cumulativeQty: 0, delayDays: 0, lastReportDate: null, invoiced: 0, certified: 0, paid: 0, certifiedPct: 0 };
  if (!a) return base;
  const reps = db.prepare("SELECT stage_id, report_date, quantity_done, percent_complete, delay_days, delay_responsibility FROM progress_reports WHERE assignment_id = ? AND status='verified' AND report_date <= ? ORDER BY report_date").all(assignmentId, asOf) as (VerifiedReport & { delay_responsibility: string })[];
  const qty = reps.reduce((x, r) => x + (r.quantity_done || 0), 0);
  let actual = 0;
  if (a.quantity && a.quantity > 0 && qty > 0) actual = Math.min(100, (qty / a.quantity) * 100);
  else if (reps.length) actual = reps[reps.length - 1].percent_complete || 0;
  if (a.status === "completed") actual = 100;
  const planned = plannedPctAt(a.start_date, a.end_date, asOf);
  const inv = db.prepare("SELECT COALESCE(SUM(claimed_amount),0) c, COALESCE(SUM(CASE WHEN status IN ('certified','approved','paid') THEN certified_amount ELSE 0 END),0) cert, COALESCE(SUM(paid_amount),0) p FROM sub_invoices WHERE assignment_id = ?").get(assignmentId) as { c: number; cert: number; p: number };
  return {
    assignmentId, actualPct: actual, plannedPct: planned, spi: planned > 0 ? actual / planned : null, cumulativeQty: qty,
    delayDays: reps.filter((r) => r.delay_responsibility === "subcontractor").reduce((x, r) => x + (r.delay_days || 0), 0),
    lastReportDate: reps.length ? reps[reps.length - 1].report_date : null,
    invoiced: inv.c, certified: inv.cert, paid: inv.p, certifiedPct: a.contract_value ? (inv.cert / a.contract_value) * 100 : 0,
  };
}

export interface SubcontractorPerformance {
  subcontractorId: number;
  name: string;
  trade: string | null;
  status: string;
  rating: number | null;
  assignmentCount: number;
  activeAssignments: number;
  contractValue: number;
  /** contract-value weighted actual % across assignments */ progressPct: number;
  plannedPct: number;
  spi: number | null;
  /** days of delay attributed to this subcontractor (verified reports + issues) */ delayDays: number;
  invoiced: number;
  certified: number;
  paid: number;
}

/** Performance rollup per subcontractor (one id, or all subcontractors that have assignments). Sorted worst SPI first. */
export function getSubcontractorPerformance(subcontractorId?: number): SubcontractorPerformance[] {
  const db = getDb();
  const subs = db.prepare(`SELECT * FROM subcontractors ${subcontractorId ? "WHERE id = ?" : ""} ORDER BY name`).all(...(subcontractorId ? [subcontractorId] : [])) as
    { id: number; name: string; trade: string | null; status: string; rating: number | null }[];
  const out: SubcontractorPerformance[] = [];
  for (const s of subs) {
    const asg = db.prepare("SELECT id, contract_value, status FROM assignments WHERE subcontractor_id = ? AND status <> 'draft'").all(s.id) as { id: number; contract_value: number; status: string }[];
    if (!asg.length && !subcontractorId) continue;
    let cv = 0, wa = 0, wp = 0, inv = 0, cert = 0, paid = 0;
    for (const a of asg) {
      const pr = getAssignmentProgress(a.id);
      const w = a.contract_value || 0;
      cv += w; wa += pr.actualPct * w; wp += pr.plannedPct * w; inv += pr.invoiced; cert += pr.certified; paid += pr.paid;
    }
    const issueDays = (db.prepare("SELECT COALESCE(SUM(i.impact_days),0) v FROM issues i JOIN assignments a ON a.id = i.assignment_id WHERE a.subcontractor_id = ? AND i.responsibility = 'subcontractor'").get(s.id) as { v: number }).v;
    const repDays = (db.prepare("SELECT COALESCE(SUM(r.delay_days),0) v FROM progress_reports r JOIN assignments a ON a.id = r.assignment_id WHERE a.subcontractor_id = ? AND r.status='verified' AND r.delay_responsibility = 'subcontractor'").get(s.id) as { v: number }).v;
    const progressPct = cv ? wa / cv : 0, plannedPct = cv ? wp / cv : 0;
    out.push({
      subcontractorId: s.id, name: s.name, trade: s.trade, status: s.status, rating: s.rating, assignmentCount: asg.length,
      activeAssignments: asg.filter((a) => a.status === "active").length, contractValue: cv, progressPct, plannedPct,
      spi: plannedPct > 0 ? progressPct / plannedPct : null, delayDays: issueDays + repDays, invoiced: inv, certified: cert, paid,
    });
  }
  return out.sort((a, b) => (a.spi ?? 9) - (b.spi ?? 9));
}

/* ------------------------------------------------------------------ DB: cost ledger auto-posting */

/** Idempotently (re)posts the subcontract cost for an invoice: present when status approved/paid, removed otherwise. */
export function syncInvoiceCost(invoiceId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM project_costs WHERE source_type = 'sub_invoice' AND source_id = ?").run(invoiceId);
  const i = db.prepare("SELECT i.*, a.stage_id, a.code acode FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id WHERE i.id = ?").get(invoiceId) as
    | { project_id: number; stage_id: number | null; status: string; certified_amount: number; invoice_no: string | null; acode: string | null; invoice_date: string | null } | undefined;
  if (!i || !["approved", "paid"].includes(i.status) || !i.certified_amount) return;
  db.prepare("INSERT INTO project_costs(project_id, stage_id, category, description, amount, cost_date, source_type, source_id) VALUES (?,?,?,?,?,?,?,?)")
    .run(i.project_id, i.stage_id, "subcontract", `Invoice ${i.invoice_no ?? "#" + invoiceId} (${i.acode ?? "subcontract"})`, i.certified_amount, i.invoice_date ?? todayISO(), "sub_invoice", invoiceId);
}

/** Idempotently (re)posts material costs of a progress report: present only when the report is verified. */
export function syncProgressMaterialCosts(reportId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM project_costs WHERE source_type = 'progress_material' AND source_id IN (SELECT id FROM progress_materials WHERE progress_report_id = ?)").run(reportId);
  const r = db.prepare("SELECT project_id, stage_id, report_date, status FROM progress_reports WHERE id = ?").get(reportId) as { project_id: number; stage_id: number | null; report_date: string; status: string } | undefined;
  if (!r || r.status !== "verified") return;
  const mats = db.prepare("SELECT * FROM progress_materials WHERE progress_report_id = ?").all(reportId) as { id: number; material: string; unit: string | null; quantity: number; unit_cost: number }[];
  const ins = db.prepare("INSERT INTO project_costs(project_id, stage_id, category, description, amount, cost_date, source_type, source_id) VALUES (?,?,?,?,?,?,?,?)");
  for (const m of mats) {
    const amt = (m.quantity || 0) * (m.unit_cost || 0);
    if (amt > 0) ins.run(r.project_id, r.stage_id, "material", `${m.material} (${m.quantity} ${m.unit ?? ""})`.trim(), amt, r.report_date, "progress_material", m.id);
  }
}
