// Printable / exportable client reports (CLIENT_PORTAL_SPEC section 3). Pure read models on top of data.ts (same client + scope filtering).
import { getDb } from "@/lib/db";
import { addDays, formatDate } from "@/lib/format";
import { getProjectMetrics } from "@/lib/metrics";
import { idsSql, type ClientSession } from "@/lib/client-portal-auth";
import { computeAll } from "@/features/ops-map/calc";
import { CAUSE_LABEL, getClientView, listIssues, listPhotos, projectSCurve, stageRows, type CIssueRow, type CPProject, type Photo, type StageRow } from "./data";

export const isIso = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const isMonth = (v: string | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const r1 = (n: number) => Math.round(n * 10) / 10;
export type Cell = string | number | null;
export interface Table { title: string; columns: string[]; rows: Cell[][] }

export function toCsv(t: Table): string {
  // cells that start like a spreadsheet formula are neutralised (CSV injection)
  const esc = (c: Cell) => { let s = c === null ? "" : String(c); if (typeof c === "string" && /^[=+@]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `﻿${[t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n")}\r\n`;
}

/** Project selection of a report: one visible project id or all visible projects. */
export function pickProjects(s: ClientSession, project: string | undefined): CPProject[] {
  const all = getClientView(s).projects;
  const id = Number(project);
  return project && Number.isInteger(id) ? all.filter((p) => p.id === id) : all;
}

/* ------------------------------------------------------------------ 1. project progress report (as of a date) */
export interface ProgressReport {
  asOf: string; today: string;
  items: { project: CPProject & { asActual: number; asPlanned: number; asSpi: number | null; asRag: string; asProjected: string | null; asSlip: number }; stages: StageRow[]; curve: ReturnType<typeof projectSCurve>; photos: Photo[] }[];
  table: Table;
}
export function progressReport(s: ClientSession, projectParam: string | undefined, dateParam: string | undefined): ProgressReport {
  const v = getClientView(s);
  const asOf = isIso(dateParam) && dateParam < v.today ? dateParam : v.today;
  const derived = asOf === v.today ? v.derived : computeAll(v.data, asOf);
  const items = pickProjects(s, projectParam).map((p) => {
    const pd = derived.proj.get(p.id);
    const m = pd ? null : getProjectMetrics(p.id, asOf);
    const asActual = pd ? pd.actualPct : m!.actualPct, asPlanned = pd ? pd.plannedPct : m!.plannedPct, asSpi = pd ? pd.spi : m!.spi;
    const asProjected = pd ? pd.projectedFinish : m!.forecastFinish, asSlip = pd ? pd.delayDays : m!.delayDays;
    const asRag = pd ? pd.rag : asSpi === null ? "grey" : asSpi >= 0.95 ? "green" : asSpi >= 0.85 ? "amber" : "red";
    return { project: { ...p, asActual, asPlanned, asSpi, asRag, asProjected, asSlip }, stages: stageRows(s, p.id, asOf), curve: projectSCurve(s, p.id).filter((c) => c.date <= addDays(asOf, 7)),
      photos: listPhotos(s, { projectId: p.id, from: addDays(asOf, -30), to: asOf, limit: 6 }) };
  });
  const rows: Cell[][] = [];
  for (const it of items) for (const st of it.stages) rows.push([it.project.code, it.project.name, `${st.code ?? ""} ${st.name}`.trim(), st.plannedStart, st.plannedEnd, r1(st.plannedPct), r1(st.actualPct), r1(st.doneQty), st.qty, st.unit, st.projectedEnd, st.slipDays]);
  return { asOf, today: v.today, items, table: { title: `Project progress report as of ${asOf}`, columns: ["Project", "Name", "Stage", "Planned start", "Planned end", "Plan %", "Actual %", "Quantity done", "Quantity total", "Unit", "Projected end", "Slip (days)"], rows } };
}

/* ------------------------------------------------------------------ 2. schedule & forecast */
export interface ScheduleReport { today: string; items: { project: CPProject; stages: StageRow[] }[]; table: Table }
export function scheduleReport(s: ClientSession, projectParam: string | undefined): ScheduleReport {
  const v = getClientView(s);
  const items = pickProjects(s, projectParam).map((p) => ({ project: p, stages: stageRows(s, p.id) }));
  const rows: Cell[][] = [];
  for (const it of items) for (const st of it.stages) rows.push([it.project.code, `${st.code ?? ""} ${st.name}`.trim(), st.contractors.join("; ") || null, st.plannedStart, st.plannedEnd, st.projectedEnd, st.slipDays, r1(st.plannedPct), r1(st.actualPct)]);
  return { today: v.today, items, table: { title: "Schedule & forecast", columns: ["Project", "Stage", "Contractor", "Planned start", "Planned end", "Projected end", "Slip (days)", "Plan %", "Actual %"], rows } };
}

/* ------------------------------------------------------------------ 3. issues & delays */
export interface IssuesReport { issues: CIssueRow[]; table: Table; filters: { project?: string; status?: string; resp?: string; from?: string; to?: string } }
export function issuesReport(s: ClientSession, q: { project?: string; status?: string; resp?: string; from?: string; to?: string }): IssuesReport {
  const pid = Number(q.project);
  const filters = { project: q.project, status: q.status === "open" || q.status === "closed" ? q.status : undefined, resp: q.resp && q.resp in CAUSE_LABEL ? q.resp : undefined, from: isIso(q.from) ? q.from : undefined, to: isIso(q.to) ? q.to : undefined };
  const issues = listIssues(s, { projectId: q.project && Number.isInteger(pid) ? pid : undefined, status: filters.status, resp: filters.resp, from: filters.from, to: filters.to });
  return { issues, filters, table: { title: "Issues & delays", columns: ["Project", "Issue", "Stage", "Status", "Responsibility", "Impact (days)", "Raised", "Resolved"],
    rows: issues.map((i) => [i.projectCode, i.title, i.stageName, i.status, CAUSE_LABEL[i.resp] ?? i.resp, i.impactDays, i.raisedOn, i.resolvedOn]) } };
}

/* ------------------------------------------------------------------ 4. monthly progress summary */
export interface MonthlyReport {
  month: string; label: string; from: string; to: string;
  items: { project: CPProject; gained: number; startPct: number; endPct: number; manDays: number; reports: number; stageQty: { stage: string; qty: number; unit: string }[]; photos: Photo[] }[];
  table: Table;
}
export function monthlyReport(s: ClientSession, projectParam: string | undefined, monthParam: string | undefined): MonthlyReport {
  const v = getClientView(s);
  const month = isMonth(monthParam) ? monthParam : v.today.slice(0, 7);
  const from = `${month}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  const toRaw = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const to = toRaw > v.today ? v.today : toRaw;
  const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const db = getDb();
  const items = pickProjects(s, projectParam).map((p) => {
    const startPct = from > v.today ? 0 : getProjectMetrics(p.id, addDays(from, -1)).actualPct;
    const endPct = from > v.today ? 0 : getProjectMetrics(p.id, to).actualPct;
    const reps = db.prepare(`SELECT r.quantity_done q, r.manpower_count mp, st.name sname, COALESCE(st.quantity_unit, pr.quantity_unit, '') unit FROM progress_reports r JOIN projects pr ON pr.id = r.project_id
      LEFT JOIN stages st ON st.id = r.stage_id WHERE r.status = 'verified' AND pr.client_id = ? AND r.project_id = ? AND r.report_date >= ? AND r.report_date <= ?`).all(s.client.id, p.id, from, to) as { q: number; mp: number; sname: string | null; unit: string }[];
    const bySt = new Map<string, { stage: string; qty: number; unit: string }>();
    for (const r of reps) { const k = r.sname ?? "General"; const x = bySt.get(k) ?? { stage: k, qty: 0, unit: r.unit === "lumpsum" ? "" : r.unit }; x.qty += r.q || 0; bySt.set(k, x); }
    return { project: p, gained: r1(Math.max(0, endPct - startPct)), startPct: r1(startPct), endPct: r1(endPct), manDays: reps.reduce((t, r) => t + (r.mp || 0), 0), reports: reps.length,
      stageQty: [...bySt.values()].filter((x) => x.qty > 0).map((x) => ({ ...x, qty: r1(x.qty) })), photos: listPhotos(s, { projectId: p.id, from, to, limit: 6 }) };
  });
  const rows: Cell[][] = [];
  for (const it of items) { if (!it.stageQty.length) rows.push([it.project.code, it.project.name, null, null, null, it.gained, it.endPct, it.manDays]); for (const q of it.stageQty) rows.push([it.project.code, it.project.name, q.stage, q.qty, q.unit, it.gained, it.endPct, it.manDays]); }
  return { month, label, from, to, items, table: { title: `Monthly progress summary ${month}`, columns: ["Project", "Name", "Stage", "Quantity done", "Unit", "Progress gained (pts)", "Cumulative %", "Man-days (reported headcount)"], rows } };
}

export const fmtD = formatDate;
void idsSql;
