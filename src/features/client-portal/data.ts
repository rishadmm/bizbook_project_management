// Read models of the client portal. EVERY function takes the ClientSession and filters by the session's client id + project scope (never a URL/form client id);
// they return only client-safe fields (no costs / CPI / budgets / subcontract values / invoices / internal notes / unverified reports).
import { cache } from "react";
import { getDb } from "@/lib/db";
import { addDays, daysBetween, todayISO } from "@/lib/format";
import { getProjectMetrics, getProjectSCurve, type SCurvePoint } from "@/lib/metrics";
import { idsSql, visibleProjectIds, type ClientSession } from "@/lib/client-portal-auth";
import { computeAll, computeParties, RESP_COLOR } from "@/features/ops-map/calc";
import type { OpsMapData, OpsSegment, Rag, SegDerived, SegStatus } from "@/features/ops-map/types";
import { clientMapFor } from "./map-server";

export type { Rag };

/* ------------------------------------------------------------------ projects */
export interface CPProject {
  id: number; code: string; name: string; status: string; category: string | null; region: string | null; location: string | null;
  parentId: number | null; parentCode: string | null; managerName: string | null; managerPhone: string | null; managerEmail: string | null;
  startDate: string | null; endDate: string | null; projectedFinish: string | null; slipDays: number;
  actualPct: number; plannedPct: number; spi: number | null; rag: Rag;
  lengthKm: number; doneKm: number; totalQty: number | null; unit: string | null; completedQty: number;
  openIssues: number; segments: number; hasMap: boolean;
  /** null when the client may not see financials */ contractValue: number | null; valueDone: number | null;
}

interface PRow {
  id: number; code: string; name: string; status: string; category: string | null; region: string | null; location: string | null; parent_id: number | null; parent_code: string | null;
  manager_name: string | null; manager_phone: string | null; manager_email: string | null; start_date: string | null; end_date: string | null; contract_value: number; total_quantity: number | null; quantity_unit: string | null;
}

const ragFromSpi = (spi: number | null, delay: number): Rag => {
  if (spi === null) return delay > 30 ? "red" : delay > 0 ? "amber" : "grey";
  const w = spi >= 0.95 ? "green" : spi >= 0.85 ? "amber" : "red";
  return delay > 90 ? "red" : delay > 30 && w === "green" ? "amber" : w;
};

const buildProjects = cache((clientId: number, ids: string, showFin: boolean, key: string): CPProject[] => {
  void key;
  const list = ids ? ids.split(",").map(Number) : [];
  if (!list.length) return [];
  const db = getDb();
  const rows = db.prepare(`SELECT p.id, p.code, p.name, p.status, p.category, p.region, p.location, p.parent_id, pp.code AS parent_code, u.name AS manager_name, u.phone AS manager_phone, u.email AS manager_email,
      p.start_date, p.end_date, p.contract_value, p.total_quantity, p.quantity_unit FROM projects p LEFT JOIN users u ON u.id = p.manager_id LEFT JOIN projects pp ON pp.id = p.parent_id
    WHERE p.client_id = ? AND p.id IN (${idsSql(list)}) ORDER BY p.code`).all(clientId) as PRow[];
  return rows.map((r) => baseProject(r, showFin));
});

function baseProject(r: PRow, showFin: boolean): CPProject {
  return {
    id: r.id, code: r.code, name: r.name, status: r.status, category: r.category, region: r.region, location: r.location, parentId: r.parent_id, parentCode: r.parent_code,
    managerName: r.manager_name, managerPhone: r.manager_phone, managerEmail: r.manager_email, startDate: r.start_date, endDate: r.end_date, projectedFinish: null, slipDays: 0,
    actualPct: 0, plannedPct: 0, spi: null, rag: "grey", lengthKm: 0, doneKm: 0, totalQty: r.total_quantity, unit: r.quantity_unit, completedQty: 0, openIssues: 0, segments: 0, hasMap: false,
    contractValue: showFin ? r.contract_value || 0 : null, valueDone: showFin ? 0 : null,
  };
}

export interface ClientView { projects: CPProject[]; data: OpsMapData; derived: ReturnType<typeof computeAll>; today: string; showSubs: boolean; showFin: boolean; base: string }

const viewCache = cache((clientId: number, ids: string, showSubs: boolean, showFin: boolean, slug: string): ClientView => {
  const bundle = clientMapFor(clientId, ids, showSubs, showFin, `/c/${slug}`);
  const today = bundle.data.today;
  const derived = computeAll(bundle.data, today);
  const base = buildProjects(clientId, ids, showFin, slug);
  const projects = base.map((p) => {
    const pd = derived.proj.get(p.id);
    const op = bundle.data.projects.find((x) => x.id === p.id);
    if (pd && op) {
      const slip = pd.delayDays;
      return { ...p, projectedFinish: pd.projectedFinish, slipDays: slip, actualPct: pd.actualPct, plannedPct: pd.plannedPct, spi: pd.spi, rag: pd.rag, lengthKm: op.lengthKm, doneKm: pd.doneKm,
        completedQty: pd.completedQty, openIssues: pd.openIssues, segments: bundle.data.segments.filter((s) => s.projectId === p.id).length, hasMap: true,
        valueDone: p.contractValue === null ? null : (p.contractValue * pd.actualPct) / 100 };
    }
    // no mapped geometry: fall back to the stage based metrics (verified reports), still without any cost index
    const m = getProjectMetrics(p.id, today);
    const open = (getDb().prepare("SELECT COUNT(*) c FROM issues WHERE project_id = ? AND kind = 'issue' AND status <> 'closed'").get(p.id) as { c: number }).c;
    return { ...p, projectedFinish: m.forecastFinish, slipDays: m.delayDays, actualPct: m.actualPct, plannedPct: m.plannedPct, spi: m.spi, rag: ragFromSpi(m.spi, m.delayDays),
      openIssues: open, valueDone: p.contractValue === null ? null : (p.contractValue * m.actualPct) / 100 };
  });
  return { projects, data: bundle.data, derived, today, showSubs, showFin, base: `/c/${slug}` };
});
/** Everything the portal pages need for this session (cached per request). */
export function getClientView(s: ClientSession): ClientView {
  const ids = visibleProjectIds(s);
  return viewCache(s.client.id, ids.join(","), !!s.client.portal_show_subcontractors, !!s.client.portal_show_financials, s.client.portal_slug ?? "");
}
export function getClientProject(s: ClientSession, id: number): CPProject | undefined {
  return getClientView(s).projects.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ dashboard */
export interface Kpis {
  activeProjects: number; totalProjects: number; overallPct: number; onTrack: number; atRisk: number; behind: number; totalKm: number; doneKm: number; openIssues: number;
  worstSlip: number; worstProject: string | null; contractValue: number | null; valueDone: number | null;
}
export function dashboardKpis(s: ClientSession): Kpis {
  const v = getClientView(s);
  const ps = v.projects;
  const w = (p: CPProject) => (p.contractValue ?? 0);
  // weighting uses the contract value server-side even when the client may not see it (only the resulting % is shown)
  const wts = getDb().prepare(`SELECT id, contract_value FROM projects WHERE client_id = ? AND id IN (${idsSql(ps.map((p) => p.id))})`).all(s.client.id) as { id: number; contract_value: number }[];
  const weight = new Map(wts.map((x) => [x.id, x.contract_value || 0]));
  const total = ps.reduce((t, p) => t + (weight.get(p.id) ?? 0), 0);
  const overall = ps.length === 0 ? 0 : total > 0 ? ps.reduce((t, p) => t + p.actualPct * (weight.get(p.id) ?? 0), 0) / total : ps.reduce((t, p) => t + p.actualPct, 0) / ps.length;
  let worst = 0, worstP: string | null = null;
  for (const p of ps) if (p.slipDays > worst) { worst = p.slipDays; worstP = p.code; }
  void w;
  return {
    activeProjects: ps.filter((p) => p.status === "active" || p.status === "mobilizing").length, totalProjects: ps.length, overallPct: overall,
    onTrack: ps.filter((p) => p.rag === "green").length, atRisk: ps.filter((p) => p.rag === "amber").length, behind: ps.filter((p) => p.rag === "red").length,
    totalKm: ps.reduce((t, p) => t + p.lengthKm, 0), doneKm: ps.reduce((t, p) => t + p.doneKm, 0), openIssues: ps.reduce((t, p) => t + p.openIssues, 0), worstSlip: worst, worstProject: worstP,
    contractValue: v.showFin ? ps.reduce((t, p) => t + (p.contractValue ?? 0), 0) : null, valueDone: v.showFin ? ps.reduce((t, p) => t + (p.valueDone ?? 0), 0) : null,
  };
}

const at = (curve: SCurvePoint[], date: string, key: "planned" | "actual"): number | null => {
  let v: number | null = null;
  for (const p of curve) { if (p.date <= date) v = p[key]; else break; }
  return v;
};
/** Portfolio S-curve: contract-value weighted planned vs actual across the visible projects. */
export function portfolioSCurve(s: ClientSession): { date: string; planned: number; actual: number | null }[] {
  const v = getClientView(s);
  const wts = new Map((getDb().prepare(`SELECT id, contract_value FROM projects WHERE client_id = ? AND id IN (${idsSql(v.projects.map((p) => p.id))})`).all(s.client.id) as { id: number; contract_value: number }[]).map((x) => [x.id, x.contract_value || 1]));
  const curves = v.projects.map((p) => ({ w: wts.get(p.id) ?? 1, c: getProjectSCurve(p.id) })).filter((x) => x.c.length);
  if (!curves.length) return [];
  const from = curves.reduce((m, x) => (x.c[0].date < m ? x.c[0].date : m), curves[0].c[0].date);
  const to = curves.reduce((m, x) => (x.c[x.c.length - 1].date > m ? x.c[x.c.length - 1].date : m), curves[0].c[curves[0].c.length - 1].date);
  const total = curves.reduce((t, x) => t + x.w, 0);
  const out: { date: string; planned: number; actual: number | null }[] = [];
  const dates: string[] = [];
  for (let d = from; d < to; d = addDays(d, 7)) dates.push(d);
  dates.push(to);
  const step = Math.max(1, Math.ceil(dates.length / 120));
  for (let i = 0; i < dates.length; i += step) {
    const date = dates[i];
    let planned = 0, actual = 0;
    for (const x of curves) { planned += (x.w / total) * (at(x.c, date, "planned") ?? 0); actual += (x.w / total) * (at(x.c, date, "actual") ?? 0); }
    out.push({ date, planned: Math.round(planned * 10) / 10, actual: date <= v.today ? Math.round(actual * 10) / 10 : null });
  }
  return out;
}

/** Client-safe delay categories (names of contractors never appear here). */
export const CAUSE_LABEL: Record<string, string> = {
  subcontractor: "Contractor crews", company: "Main contractor", client: "Client", authority: "Authority / permits", weather: "Weather", utility_clash: "Utility clash", other: "Other", none: "Other",
};
export function delaysByCause(s: ClientSession): { key: string; label: string; days: number; color: string }[] {
  const v = getClientView(s);
  const parties = computeParties(v.data, new Set(v.projects.map((p) => p.id)), v.today);
  const m = new Map<string, number>();
  for (const p of parties) m.set(p.resp, (m.get(p.resp) ?? 0) + p.days);
  return [...m.entries()].filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]).map(([k, days]) => ({ key: k, label: CAUSE_LABEL[k] ?? k, days: Math.round(days * 10) / 10, color: RESP_COLOR[k] ?? "#64748b" }));
}

export interface Milestone { projectId: number; projectCode: string; stageName: string; stageCode: string | null; date: string; inDays: number; kind: "stage" | "project" }
export function upcomingMilestones(s: ClientSession, days = 60): Milestone[] {
  const v = getClientView(s);
  const ids = v.projects.map((p) => p.id);
  const to = addDays(v.today, days);
  const rows = getDb().prepare(`SELECT st.project_id, p.code, st.name, st.code AS scode, st.planned_end FROM stages st JOIN projects p ON p.id = st.project_id
    WHERE p.client_id = ? AND st.project_id IN (${idsSql(ids)}) AND st.status <> 'completed' AND st.planned_end >= ? AND st.planned_end <= ? ORDER BY st.planned_end, st.id`).all(s.client.id, v.today, to) as
    { project_id: number; code: string; name: string; scode: string | null; planned_end: string }[];
  const out: Milestone[] = rows.map((r) => ({ projectId: r.project_id, projectCode: r.code, stageName: r.name, stageCode: r.scode, date: r.planned_end, inDays: daysBetween(v.today, r.planned_end), kind: "stage" }));
  for (const p of v.projects) if (p.endDate && p.endDate >= v.today && p.endDate <= to && !["completed", "closed"].includes(p.status)) {
    out.push({ projectId: p.id, projectCode: p.code, stageName: "Project completion", stageCode: null, date: p.endDate, inDays: daysBetween(v.today, p.endDate), kind: "project" });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ verified progress + photos */
export interface FeedItem { id: number; projectId: number; projectCode: string; stageName: string | null; date: string; qty: number; unit: string; pct: number; photos: number[] }
export function recentProgress(s: ClientSession, limit = 8, projectId?: number): FeedItem[] {
  const ids = projectId ? visibleProjectIds(s).filter((i) => i === projectId) : visibleProjectIds(s);
  const db = getDb();
  const rows = db.prepare(`SELECT r.id, r.project_id, p.code, st.name AS stage_name, r.report_date, r.quantity_done, r.percent_complete, COALESCE(st.quantity_unit, p.quantity_unit, '') AS unit
    FROM progress_reports r JOIN projects p ON p.id = r.project_id LEFT JOIN stages st ON st.id = r.stage_id
    WHERE r.status = 'verified' AND p.client_id = ? AND r.project_id IN (${idsSql(ids)}) AND r.quantity_done > 0 ORDER BY r.report_date DESC, r.id DESC LIMIT ?`).all(s.client.id, limit) as
    { id: number; project_id: number; code: string; stage_name: string | null; report_date: string; quantity_done: number; percent_complete: number; unit: string }[];
  const ph = db.prepare("SELECT id FROM attachments WHERE entity_type = 'progress' AND entity_id = ? AND mime LIKE 'image/%' ORDER BY id LIMIT 3");
  return rows.map((r) => ({ id: r.id, projectId: r.project_id, projectCode: r.code, stageName: r.stage_name, date: r.report_date, qty: r.quantity_done, unit: r.unit === "lumpsum" ? "" : r.unit, pct: r.percent_complete,
    photos: (ph.all(r.id) as { id: number }[]).map((x) => x.id) }));
}

export interface Photo { id: number; projectId: number; projectCode: string; stageId: number | null; stageName: string | null; date: string; filename: string }
export function listPhotos(s: ClientSession, f: { projectId?: number; stageId?: number; from?: string; to?: string; limit?: number } = {}): Photo[] {
  const ids = f.projectId ? visibleProjectIds(s).filter((i) => i === f.projectId) : visibleProjectIds(s);
  const db = getDb();
  const where: string[] = []; const args: (string | number)[] = [s.client.id];
  if (f.stageId) { where.push("r.stage_id = ?"); args.push(f.stageId); }
  if (f.from) { where.push("r.report_date >= ?"); args.push(f.from); }
  if (f.to) { where.push("r.report_date <= ?"); args.push(f.to); }
  const verified = db.prepare(`SELECT a.id, r.project_id, p.code, r.stage_id, st.name AS stage_name, r.report_date AS d, a.filename FROM attachments a
    JOIN progress_reports r ON r.id = a.entity_id JOIN projects p ON p.id = r.project_id LEFT JOIN stages st ON st.id = r.stage_id
    WHERE a.entity_type = 'progress' AND a.mime LIKE 'image/%' AND r.status = 'verified' AND p.client_id = ? AND r.project_id IN (${idsSql(ids)}) ${where.map((w) => `AND ${w}`).join(" ")}
    ORDER BY r.report_date DESC, a.id DESC LIMIT ?`).all(...args, f.limit ?? 200) as { id: number; project_id: number; code: string; stage_id: number | null; stage_name: string | null; d: string; filename: string }[];
  const out: Photo[] = verified.map((r) => ({ id: r.id, projectId: r.project_id, projectCode: r.code, stageId: r.stage_id, stageName: r.stage_name, date: r.d, filename: r.filename }));
  if (!f.stageId) {
    const pw: string[] = []; const pa: (string | number)[] = [s.client.id];
    if (f.from) { pw.push("substr(a.created_at,1,10) >= ?"); pa.push(f.from); }
    if (f.to) { pw.push("substr(a.created_at,1,10) <= ?"); pa.push(f.to); }
    const proj = db.prepare(`SELECT a.id, a.entity_id AS project_id, p.code, substr(a.created_at,1,10) AS d, a.filename FROM attachments a JOIN projects p ON p.id = a.entity_id
      WHERE a.entity_type = 'project' AND a.category = 'Photos' AND a.mime LIKE 'image/%' AND p.client_id = ? AND a.entity_id IN (${idsSql(ids)}) ${pw.map((w) => `AND ${w}`).join(" ")} ORDER BY a.id DESC`).all(...pa) as
      { id: number; project_id: number; code: string; d: string; filename: string }[];
    for (const r of proj) out.push({ id: r.id, projectId: r.project_id, projectCode: r.code, stageId: null, stageName: null, date: r.d, filename: r.filename });
    out.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }
  return out.slice(0, f.limit ?? 200);
}

/* ------------------------------------------------------------------ issues */
export interface CIssueRow { id: number; projectId: number; projectCode: string; title: string; status: string; resp: string; impactDays: number; raisedOn: string | null; resolvedOn: string | null; stageName: string | null }
export function listIssues(s: ClientSession, f: { projectId?: number; status?: string; resp?: string; from?: string; to?: string } = {}): CIssueRow[] {
  const ids = f.projectId ? visibleProjectIds(s).filter((i) => i === f.projectId) : visibleProjectIds(s);
  const where: string[] = []; const args: (string | number)[] = [s.client.id];
  if (f.status === "open") where.push("i.status <> 'closed'"); else if (f.status === "closed") where.push("i.status = 'closed'");
  if (f.resp) { where.push("i.responsibility = ?"); args.push(f.resp); }
  if (f.from) { where.push("i.raised_on >= ?"); args.push(f.from); }
  if (f.to) { where.push("i.raised_on <= ?"); args.push(f.to); }
  // internal RFIs (design clarifications between the company and its subcontractors) are not part of the client view
  return (getDb().prepare(`SELECT i.id, i.project_id, p.code, i.title, i.status, COALESCE(i.responsibility,'other') AS resp, COALESCE(i.impact_days,0) AS impact_days, i.raised_on, i.resolved_on, st.name AS stage_name
    FROM issues i JOIN projects p ON p.id = i.project_id LEFT JOIN stages st ON st.id = i.stage_id
    WHERE i.kind = 'issue' AND p.client_id = ? AND i.project_id IN (${idsSql(ids)}) ${where.map((w) => `AND ${w}`).join(" ")}
    ORDER BY CASE i.status WHEN 'closed' THEN 1 ELSE 0 END, i.raised_on DESC, i.id DESC`).all(...args) as { id: number; project_id: number; code: string; title: string; status: string; resp: string; impact_days: number; raised_on: string | null; resolved_on: string | null; stage_name: string | null }[])
    .map((r) => ({ id: r.id, projectId: r.project_id, projectCode: r.code, title: r.title, status: r.status, resp: r.resp, impactDays: r.impact_days, raisedOn: r.raised_on, resolvedOn: r.resolved_on, stageName: r.stage_name }));
}
export function getIssue(s: ClientSession, id: number): CIssueRow | undefined {
  return listIssues(s).find((i) => i.id === id);
}

/* ------------------------------------------------------------------ schedule + progress */
export interface StageRow {
  id: number; code: string | null; name: string; status: string; plannedStart: string | null; plannedEnd: string | null; projectedEnd: string | null; slipDays: number;
  plannedPct: number; actualPct: number; contractors: string[]; qty: number; doneQty: number; unit: string; segStatus: SegStatus | null;
}
type SegPair = { seg: OpsSegment; d: SegDerived };
export function stageRows(s: ClientSession, projectId: number, asOf?: string): StageRow[] {
  const v = getClientView(s);
  if (!v.projects.some((p) => p.id === projectId)) return [];
  const date = asOf && asOf < v.today ? asOf : v.today;
  const derived = date === v.today ? v.derived : computeAll(v.data, date);
  const db = getDb();
  const stages = db.prepare("SELECT * FROM stages WHERE project_id = ? ORDER BY sort, id").all(projectId) as { id: number; code: string | null; name: string; status: string; planned_start: string | null; planned_end: string | null; planned_quantity: number; quantity_unit: string | null }[];
  const done = new Map((db.prepare("SELECT stage_id, SUM(quantity_done) q FROM progress_reports WHERE project_id = ? AND status = 'verified' AND report_date <= ? GROUP BY stage_id").all(projectId, date) as { stage_id: number | null; q: number }[]).map((r) => [r.stage_id, r.q]));
  const proj = db.prepare("SELECT quantity_unit FROM projects WHERE id = ?").get(projectId) as { quantity_unit: string | null };
  return stages.map((st): StageRow => {
    const pairs: SegPair[] = v.data.segments.filter((x) => x.stageId === st.id).map((seg) => ({ seg, d: derived.seg.get(seg.key)! })).filter((x) => x.d);
    const wsum = pairs.reduce((t, x) => t + x.seg.weight, 0);
    const avg = (f: (x: SegPair) => number) => (wsum > 0 ? pairs.reduce((t, x) => t + x.seg.weight * f(x), 0) / wsum : pairs.length ? pairs.reduce((t, x) => t + f(x), 0) / pairs.length : 0);
    const unit = st.quantity_unit ?? proj.quantity_unit ?? "";
    const worst: SegStatus | null = pairs.length ? (["behind", "at_risk", "suspended", "on_track", "not_started", "completed"] as SegStatus[]).find((k) => pairs.some((x) => x.d.status === k)) ?? null : null;
    const projectedEnd = pairs.length ? pairs.map((x) => x.d.projectedEnd).sort().at(-1) ?? null : null;
    return {
      id: st.id, code: st.code, name: st.name, status: st.status, plannedStart: st.planned_start, plannedEnd: st.planned_end, projectedEnd,
      slipDays: pairs.length && st.planned_end && projectedEnd ? Math.max(0, daysBetween(st.planned_end, projectedEnd)) : 0,
      plannedPct: pairs.length ? avg((x) => x.d.plannedPct) : 0, actualPct: pairs.length ? avg((x) => x.d.actualPct) : st.status === "completed" ? 100 : 0,
      contractors: [...new Set(pairs.flatMap((x) => (x.seg.sub ? [x.seg.sub.name] : [])))], qty: st.planned_quantity || 0, doneQty: done.get(st.id) ?? 0, unit: unit === "lumpsum" ? "" : unit, segStatus: worst,
    };
  });
}

export interface WeekRow { weekEnd: string; reports: number; qty: number; unit: string | null; gained: number; cumulative: number; avgManpower: number }
/** Weekly progress table from VERIFIED reports only (the weeks of the planned-vs-actual S-curve), newest first. */
export function weeklyProgress(s: ClientSession, projectId: number, weeks = 16): WeekRow[] {
  const v = getClientView(s);
  if (!v.projects.some((p) => p.id === projectId)) return [];
  const curve = getProjectSCurve(projectId).filter((p) => p.actual !== null);
  if (!curve.length) return [];
  const reps = getDb().prepare(`SELECT r.report_date, r.quantity_done, r.manpower_count, COALESCE(st.quantity_unit, p.quantity_unit) AS unit FROM progress_reports r JOIN projects p ON p.id = r.project_id LEFT JOIN stages st ON st.id = r.stage_id
    WHERE r.project_id = ? AND p.client_id = ? AND r.status = 'verified' ORDER BY r.report_date`).all(projectId, s.client.id) as { report_date: string; quantity_done: number; manpower_count: number; unit: string | null }[];
  const out: WeekRow[] = [];
  for (let i = 0; i < curve.length; i++) {
    const end = curve[i].date, start = i ? curve[i - 1].date : addDays(end, -7);
    const inWeek = reps.filter((r) => r.report_date > start && r.report_date <= end);
    const units = [...new Set(inWeek.map((r) => r.unit ?? ""))];
    const mp = inWeek.filter((r) => r.manpower_count > 0);
    out.push({ weekEnd: end, reports: inWeek.length, qty: inWeek.reduce((t, r) => t + (r.quantity_done || 0), 0), unit: units.length === 1 ? units[0] : null,
      gained: Math.round(((curve[i].actual ?? 0) - (i ? curve[i - 1].actual ?? 0 : 0)) * 10) / 10, cumulative: curve[i].actual ?? 0, avgManpower: mp.length ? Math.round(mp.reduce((t, r) => t + r.manpower_count, 0) / mp.length) : 0 });
  }
  return out.reverse().slice(0, weeks);
}

export function projectSCurve(s: ClientSession, projectId: number): SCurvePoint[] {
  return getClientView(s).projects.some((p) => p.id === projectId) ? getProjectSCurve(projectId) : [];
}

export const todayStr = todayISO;
