import { getDb } from "@/lib/db";
import { addDays, todayISO } from "@/lib/format";
import { getProjectMetrics, type ProjectMetrics } from "@/lib/metrics";
import { OPEN_TENDER_STATUSES, TENDER_PIPELINE } from "@/lib/status";
import type { Project } from "@/lib/types";

export interface FunnelRow { status: string; count: number; value: number }
export interface WinRate { won: number; lost: number; wonValue: number; lostValue: number; byCount: number | null; byValue: number | null }

const TENDER_VALUE = "COALESCE(NULLIF((SELECT total_price FROM tender_revisions r WHERE r.id = t.current_revision_id), 0), t.estimated_value, 0)";

export function tenderFunnel(entityId: number): { rows: FunnelRow[]; winRate: WinRate; openValue: number; openCount: number } {
  const db = getDb();
  const raw = db.prepare(`SELECT t.status, COUNT(*) c, COALESCE(SUM(CASE WHEN t.status = 'won' THEN COALESCE(t.won_value, ${TENDER_VALUE}) ELSE ${TENDER_VALUE} END),0) v FROM tenders t WHERE t.entity_id = ? GROUP BY t.status`).all(entityId) as { status: string; c: number; v: number }[];
  const map = new Map(raw.map((r) => [r.status, r]));
  const rows = TENDER_PIPELINE.map((s) => ({ status: s as string, count: map.get(s)?.c ?? 0, value: map.get(s)?.v ?? 0 }));
  const won = map.get("won"), lost = map.get("lost");
  const w = won?.c ?? 0, l = lost?.c ?? 0, wv = won?.v ?? 0, lv = lost?.v ?? 0;
  const open = OPEN_TENDER_STATUSES.map((s) => map.get(s));
  return {
    rows,
    winRate: { won: w, lost: l, wonValue: wv, lostValue: lv, byCount: w + l ? (w / (w + l)) * 100 : null, byValue: wv + lv ? (wv / (wv + lv)) * 100 : null },
    openValue: open.reduce((s, x) => s + (x?.v ?? 0), 0), openCount: open.reduce((s, x) => s + (x?.c ?? 0), 0),
  };
}

export interface DeadlineRow { id: number; code: string; title: string; status: string; submission_deadline: string; value: number; client_name: string | null }
export function upcomingDeadlines(entityId: number, limit = 8): DeadlineRow[] {
  return getDb().prepare(`
    SELECT t.id, t.code, t.title, t.status, t.submission_deadline, ${TENDER_VALUE} AS value, c.name AS client_name
    FROM tenders t LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.entity_id = ? AND t.submission_deadline IS NOT NULL AND t.submission_deadline >= ? AND t.status IN ('draft','in_preparation','under_review','approved')
    ORDER BY t.submission_deadline LIMIT ?`).all(entityId, todayISO(), limit) as DeadlineRow[];
}

export interface ProjectHealth { project: Project; m: ProjectMetrics; client_name: string | null }
export function activeProjectHealth(entityId: number): ProjectHealth[] {
  const db = getDb();
  const ps = db.prepare("SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.entity_id = ? AND p.status IN ('mobilizing','active','on_hold') ORDER BY p.code").all(entityId) as (Project & { client_name: string | null })[];
  return ps.map((p) => ({ project: p, m: getProjectMetrics(p.id), client_name: p.client_name }));
}

export interface Portfolio { contractValue: number; bac: number; ac: number; ev: number; pv: number; spi: number | null; cpi: number | null; count: number }
export function portfolioTotals(items: ProjectHealth[]): Portfolio {
  const t = items.reduce((a, x) => ({ contractValue: a.contractValue + x.project.contract_value, bac: a.bac + x.m.bac, ac: a.ac + x.m.ac, ev: a.ev + x.m.ev, pv: a.pv + x.m.pv }), { contractValue: 0, bac: 0, ac: 0, ev: 0, pv: 0 });
  return { ...t, spi: t.pv > 0 ? t.ev / t.pv : null, cpi: t.ac > 0 ? t.ev / t.ac : null, count: items.length };
}

export interface PendingProgress { id: number; project_id: number; project_code: string; report_date: string; subcontractor_name: string; assignment_code: string | null }
export interface PendingInvoice { id: number; invoice_no: string | null; claimed_amount: number; status: string; subcontractor_name: string; project_code: string }
export interface PendingCert { id: number; cert_type: string; percent: number | null; subcontractor_name: string; project_code: string; assignment_code: string | null }

export function pendingApprovals(entityId: number) {
  const db = getDb();
  const progress = db.prepare(`
    SELECT r.id, r.project_id, p.code AS project_code, r.report_date, s.name AS subcontractor_name, a.code AS assignment_code FROM progress_reports r
    JOIN projects p ON p.id = r.project_id LEFT JOIN assignments a ON a.id = r.assignment_id LEFT JOIN subcontractors s ON s.id = a.subcontractor_id
    WHERE p.entity_id = ? AND r.status = 'submitted' ORDER BY r.report_date DESC LIMIT 50`).all(entityId) as PendingProgress[];
  const invoices = db.prepare(`
    SELECT i.id, i.invoice_no, i.claimed_amount, i.status, s.name AS subcontractor_name, p.code AS project_code FROM sub_invoices i
    JOIN assignments a ON a.id = i.assignment_id JOIN subcontractors s ON s.id = a.subcontractor_id JOIN projects p ON p.id = i.project_id
    WHERE p.entity_id = ? AND i.status IN ('submitted','under_review') ORDER BY i.invoice_date LIMIT 50`).all(entityId) as PendingInvoice[];
  const certs = db.prepare(`
    SELECT c.id, c.cert_type, c.percent, s.name AS subcontractor_name, p.code AS project_code, a.code AS assignment_code FROM completion_certificates c
    JOIN assignments a ON a.id = c.assignment_id JOIN subcontractors s ON s.id = a.subcontractor_id JOIN projects p ON p.id = c.project_id
    WHERE p.entity_id = ? AND c.status = 'requested' ORDER BY c.id DESC LIMIT 50`).all(entityId) as PendingCert[];
  return { progress, invoices, certs };
}

export interface ExpiringDoc { id: number; subcontractor_id: number; name: string; doc_type: string; expiry_date: string; days: number }
export function expiringDocuments(entityId: number): ExpiringDoc[] {
  const today = todayISO();
  const rows = getDb().prepare(`
    SELECT d.id, d.subcontractor_id, s.name, d.doc_type, d.expiry_date FROM subcontractor_documents d JOIN subcontractors s ON s.id = d.subcontractor_id
    WHERE s.entity_id = ? AND d.is_current = 1 AND d.expiry_date IS NOT NULL AND d.expiry_date <= ? AND d.status <> 'rejected' AND s.status NOT IN ('blacklisted') ORDER BY d.expiry_date`).all(entityId, addDays(today, 30)) as Omit<ExpiringDoc, "days">[];
  return rows.map((r) => ({ ...r, days: Math.round((new Date(r.expiry_date).getTime() - new Date(today).getTime()) / 86400000) }));
}
