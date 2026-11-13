import { getDb } from "@/lib/db";
import { getAssignmentProgress, getProjectMetrics, getStageProgress, type AssignmentProgress, type ProjectMetrics, type StageProgress } from "@/lib/metrics";
import type {
  Assignment, CompletionCertificate, Issue, ProgressManpower, ProgressMaterial, ProgressReport, Project, ProjectBudgetLine, ProjectCost, Stage, SubInvoice,
} from "@/lib/types";

export type ProjectRow = Project & { client_name: string | null; manager_name: string | null; parent_code: string | null; tender_code: string | null };

const PROJECT_SQL = `SELECT p.*, c.name AS client_name, u.name AS manager_name, pp.code AS parent_code, t.code AS tender_code
  FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.manager_id
  LEFT JOIN projects pp ON pp.id = p.parent_id LEFT JOIN tenders t ON t.id = p.tender_id`;

export function getProjectRow(id: number): ProjectRow | undefined {
  return getDb().prepare(`${PROJECT_SQL} WHERE p.id = ?`).get(id) as ProjectRow | undefined;
}

export interface ProjectListItem extends ProjectRow { metrics: ProjectMetrics; lengthKm: number | null; childCount: number }

export function listProjects(): ProjectListItem[] {
  const db = getDb();
  const rows = db.prepare(`${PROJECT_SQL} ORDER BY p.code`).all() as ProjectRow[];
  const counts = new Map<number, number>();
  rows.forEach((r) => { if (r.parent_id) counts.set(r.parent_id, (counts.get(r.parent_id) ?? 0) + 1); });
  return rows.map((r) => ({
    ...r, metrics: getProjectMetrics(r.id), childCount: counts.get(r.id) ?? 0,
    lengthKm: r.quantity_unit === "km" ? r.total_quantity : r.quantity_unit === "m" && r.total_quantity ? r.total_quantity / 1000 : null,
  }));
}

export function listUsers(): { id: number; name: string }[] {
  return getDb().prepare("SELECT id, name FROM users ORDER BY name").all() as { id: number; name: string }[];
}
export function listClients(): { id: number; name: string }[] {
  return getDb().prepare("SELECT id, name FROM clients ORDER BY name").all() as { id: number; name: string }[];
}
export function listSubcontractors(): { id: number; name: string; trade: string | null; status: string }[] {
  return getDb().prepare("SELECT id, name, trade, status FROM subcontractors ORDER BY name").all() as { id: number; name: string; trade: string | null; status: string }[];
}

export function listRegions(): string[] {
  return (getDb().prepare("SELECT DISTINCT region FROM projects WHERE region IS NOT NULL AND region <> '' ORDER BY region").all() as { region: string }[]).map((r) => r.region);
}

export function getChildren(projectId: number): ProjectListItem[] {
  return listProjects().filter((p) => p.parent_id === projectId);
}

export type StageRowEx = Stage & { progress: StageProgress; weight: number; assignmentCount: number };

export function getStages(projectId: number, metrics?: ProjectMetrics): StageRowEx[] {
  const db = getDb();
  const stages = db.prepare("SELECT * FROM stages WHERE project_id = ? ORDER BY sort, id").all(projectId) as Stage[];
  const m = metrics ?? getProjectMetrics(projectId);
  const counts = new Map((db.prepare("SELECT stage_id, COUNT(*) c FROM assignments WHERE project_id = ? AND stage_id IS NOT NULL GROUP BY stage_id").all(projectId) as { stage_id: number; c: number }[]).map((r) => [r.stage_id, r.c]));
  return stages.map((s) => {
    const sp = m.stages.find((x) => x.stageId === s.id);
    return { ...s, progress: sp ?? getStageProgress(s.id), weight: sp?.weight ?? 0, assignmentCount: counts.get(s.id) ?? 0 };
  });
}

export type AssignmentRow = Assignment & { subcontractor_name: string; stage_code: string | null; stage_name: string | null; progress: AssignmentProgress };

export function getAssignments(projectId: number): AssignmentRow[] {
  const rows = getDb().prepare(
    `SELECT a.*, s.name AS subcontractor_name, st.code AS stage_code, st.name AS stage_name
     FROM assignments a JOIN subcontractors s ON s.id = a.subcontractor_id LEFT JOIN stages st ON st.id = a.stage_id
     WHERE a.project_id = ? ORDER BY a.code, a.id`).all(projectId) as Omit<AssignmentRow, "progress">[];
  return rows.map((r) => ({ ...r, progress: getAssignmentProgress(r.id) }));
}

export interface ReportFilters { stageId?: number; subcontractorId?: number; status?: string }
export type ReportRow = ProgressReport & {
  stage_code: string | null; assignment_code: string | null; subcontractor_name: string | null;
  materials: ProgressMaterial[]; manpower: ProgressManpower[]; photoCount: number;
};

export function getReports(projectId: number, f: ReportFilters = {}, limit = 200): ReportRow[] {
  const db = getDb();
  const where = ["r.project_id = ?"]; const args: (number | string)[] = [projectId];
  if (f.stageId) { where.push("r.stage_id = ?"); args.push(f.stageId); }
  if (f.subcontractorId) { where.push("a.subcontractor_id = ?"); args.push(f.subcontractorId); }
  if (f.status) { where.push("r.status = ?"); args.push(f.status); }
  const rows = db.prepare(
    `SELECT r.*, st.code AS stage_code, a.code AS assignment_code, s.name AS subcontractor_name
     FROM progress_reports r LEFT JOIN stages st ON st.id = r.stage_id LEFT JOIN assignments a ON a.id = r.assignment_id
     LEFT JOIN subcontractors s ON s.id = a.subcontractor_id WHERE ${where.join(" AND ")}
     ORDER BY CASE r.status WHEN 'submitted' THEN 0 ELSE 1 END, r.report_date DESC, r.id DESC LIMIT ?`).all(...args, limit) as Omit<ReportRow, "materials" | "manpower" | "photoCount">[];
  return attachReportDetails(rows);
}

export function attachReportDetails<T extends { id: number }>(rows: T[]): (T & { materials: ProgressMaterial[]; manpower: ProgressManpower[]; photoCount: number })[] {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const mats = db.prepare(`SELECT * FROM progress_materials WHERE progress_report_id IN (${ph})`).all(...ids) as ProgressMaterial[];
  const mp = db.prepare(`SELECT * FROM progress_manpower WHERE progress_report_id IN (${ph})`).all(...ids) as ProgressManpower[];
  const ph2 = (db.prepare(`SELECT entity_id, COUNT(*) c FROM attachments WHERE entity_type='progress' AND entity_id IN (${ph}) GROUP BY entity_id`).all(...ids) as { entity_id: number; c: number }[]);
  return rows.map((r) => ({
    ...r,
    materials: mats.filter((m) => m.progress_report_id === r.id), manpower: mp.filter((m) => m.progress_report_id === r.id),
    photoCount: ph2.find((x) => x.entity_id === r.id)?.c ?? 0,
  }));
}

export interface CategoryCost { category: string; budget: number; actual: number; variance: number }

export function getBudgetByCategory(projectId: number): CategoryCost[] {
  const db = getDb();
  const b = db.prepare("SELECT category, SUM(budget_amount) v FROM project_budget_lines WHERE project_id = ? GROUP BY category").all(projectId) as { category: string; v: number }[];
  const a = db.prepare("SELECT category, SUM(amount) v FROM project_costs WHERE project_id = ? GROUP BY category").all(projectId) as { category: string; v: number }[];
  const cats = [...new Set([...b.map((x) => x.category), ...a.map((x) => x.category)])];
  const order = ["manpower", "material", "equipment", "services", "subcontract", "overhead", "contingency"];
  cats.sort((x, y) => (order.indexOf(x) + 99) % 99 - (order.indexOf(y) + 99) % 99);
  return cats.map((category) => {
    const budget = b.find((x) => x.category === category)?.v ?? 0;
    const actual = a.find((x) => x.category === category)?.v ?? 0;
    return { category, budget, actual, variance: budget - actual };
  });
}

export interface StageCost { stageId: number | null; code: string; name: string; budget: number; lineBudget: number; actual: number; variance: number }

export function getBudgetByStage(projectId: number): StageCost[] {
  const db = getDb();
  const stages = db.prepare("SELECT id, code, name, budget_amount FROM stages WHERE project_id = ? ORDER BY sort, id").all(projectId) as { id: number; code: string | null; name: string; budget_amount: number }[];
  const lb = db.prepare("SELECT stage_id, SUM(budget_amount) v FROM project_budget_lines WHERE project_id = ? GROUP BY stage_id").all(projectId) as { stage_id: number | null; v: number }[];
  const ac = db.prepare("SELECT stage_id, SUM(amount) v FROM project_costs WHERE project_id = ? GROUP BY stage_id").all(projectId) as { stage_id: number | null; v: number }[];
  const out: StageCost[] = stages.map((s) => {
    const budget = s.budget_amount || 0; const actual = ac.find((x) => x.stage_id === s.id)?.v ?? 0;
    return { stageId: s.id, code: s.code ?? "", name: s.name, budget, lineBudget: lb.find((x) => x.stage_id === s.id)?.v ?? 0, actual, variance: budget - actual };
  });
  const gb = lb.find((x) => x.stage_id === null)?.v ?? 0; const ga = ac.find((x) => x.stage_id === null)?.v ?? 0;
  if (gb || ga) out.push({ stageId: null, code: "—", name: "General / unallocated", budget: gb, lineBudget: gb, actual: ga, variance: gb - ga });
  return out;
}

export type BudgetLineRow = ProjectBudgetLine & { stage_code: string | null };
export function getBudgetLines(projectId: number): BudgetLineRow[] {
  return getDb().prepare("SELECT l.*, s.code AS stage_code FROM project_budget_lines l LEFT JOIN stages s ON s.id = l.stage_id WHERE l.project_id = ? ORDER BY l.category, l.id").all(projectId) as BudgetLineRow[];
}

export type CostRow = ProjectCost & { stage_code: string | null };
export function getCosts(projectId: number, limit = 300): CostRow[] {
  return getDb().prepare("SELECT c.*, s.code AS stage_code FROM project_costs c LEFT JOIN stages s ON s.id = c.stage_id WHERE c.project_id = ? ORDER BY c.cost_date DESC, c.id DESC LIMIT ?").all(projectId, limit) as CostRow[];
}

export type InvoiceRow = SubInvoice & { assignment_code: string | null; subcontractor_name: string; retention_pct: number; advance_pct: number; contract_value: number; stage_id: number | null };
export function getInvoices(projectId: number, where = "", args: (string | number)[] = []): InvoiceRow[] {
  return getDb().prepare(
    `SELECT i.*, a.code AS assignment_code, s.name AS subcontractor_name, a.retention_pct, a.advance_pct, a.contract_value, a.stage_id
     FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id JOIN subcontractors s ON s.id = a.subcontractor_id
     WHERE i.project_id = ? ${where} ORDER BY i.invoice_date DESC, i.id DESC`).all(projectId, ...args) as InvoiceRow[];
}

export type CertRow = CompletionCertificate & { assignment_code: string | null; subcontractor_name: string; stage_code: string | null; issuer_name: string | null };
export function getCertificates(projectId: number, where = "", args: (string | number)[] = []): CertRow[] {
  return getDb().prepare(
    `SELECT c.*, a.code AS assignment_code, s.name AS subcontractor_name, st.code AS stage_code, u.name AS issuer_name
     FROM completion_certificates c JOIN assignments a ON a.id = c.assignment_id JOIN subcontractors s ON s.id = a.subcontractor_id
     LEFT JOIN stages st ON st.id = c.stage_id LEFT JOIN users u ON u.id = c.issued_by
     WHERE c.project_id = ? ${where} ORDER BY c.cert_date DESC, c.id DESC`).all(projectId, ...args) as CertRow[];
}

export type IssueRow = Issue & { stage_code: string | null; assignment_code: string | null };
export function getIssues(projectId: number): IssueRow[] {
  return getDb().prepare(
    `SELECT i.*, s.code AS stage_code, a.code AS assignment_code FROM issues i LEFT JOIN stages s ON s.id = i.stage_id LEFT JOIN assignments a ON a.id = i.assignment_id
     WHERE i.project_id = ? ORDER BY CASE i.status WHEN 'closed' THEN 1 ELSE 0 END, i.raised_on DESC, i.id DESC`).all(projectId) as IssueRow[];
}

/** Subcontractor performance restricted to a single project (progress & delay for this project's assignments only). */
export interface ProjectSubPerf {
  subcontractorId: number; name: string; trade: string | null; assignments: number; contractValue: number;
  progressPct: number; plannedPct: number; spi: number | null; delayDays: number; certified: number; paid: number;
}
export function getProjectSubPerformance(projectId: number): ProjectSubPerf[] {
  const db = getDb();
  const asg = db.prepare("SELECT a.id, a.subcontractor_id, a.contract_value, s.name, s.trade FROM assignments a JOIN subcontractors s ON s.id = a.subcontractor_id WHERE a.project_id = ? AND a.status <> 'draft'").all(projectId) as { id: number; subcontractor_id: number; contract_value: number; name: string; trade: string | null }[];
  const by = new Map<number, ProjectSubPerf & { wa: number; wp: number }>();
  for (const a of asg) {
    const p = getAssignmentProgress(a.id);
    const issueDays = (db.prepare("SELECT COALESCE(SUM(impact_days),0) v FROM issues WHERE assignment_id = ? AND responsibility = 'subcontractor'").get(a.id) as { v: number }).v;
    const x = by.get(a.subcontractor_id) ?? { subcontractorId: a.subcontractor_id, name: a.name, trade: a.trade, assignments: 0, contractValue: 0, progressPct: 0, plannedPct: 0, spi: null, delayDays: 0, certified: 0, paid: 0, wa: 0, wp: 0 };
    const w = a.contract_value || 0;
    x.assignments += 1; x.contractValue += w; x.wa += p.actualPct * w; x.wp += p.plannedPct * w;
    x.delayDays += p.delayDays + issueDays; x.certified += p.certified; x.paid += p.paid;
    by.set(a.subcontractor_id, x);
  }
  return [...by.values()].map(({ wa, wp, ...x }) => {
    const progressPct = x.contractValue ? wa / x.contractValue : 0, plannedPct = x.contractValue ? wp / x.contractValue : 0;
    return { ...x, progressPct, plannedPct, spi: plannedPct > 0 ? progressPct / plannedPct : null };
  }).sort((a, b) => (a.spi ?? 9) - (b.spi ?? 9));
}

export function countByTab(projectId: number): Record<string, number> {
  const db = getDb();
  const c = (sql: string) => (db.prepare(sql).get(projectId) as { c: number }).c;
  return {
    stages: c("SELECT COUNT(*) c FROM stages WHERE project_id = ?"),
    subprojects: c("SELECT COUNT(*) c FROM projects WHERE parent_id = ?"),
    subcontracts: c("SELECT COUNT(*) c FROM assignments WHERE project_id = ?"),
    progress: c("SELECT COUNT(*) c FROM progress_reports WHERE project_id = ? AND status = 'submitted'"),
    issues: c("SELECT COUNT(*) c FROM issues WHERE project_id = ? AND status <> 'closed'"),
  };
}
