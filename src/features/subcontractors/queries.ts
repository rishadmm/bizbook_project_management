import { getDb } from "@/lib/db";
import { addDays, todayISO } from "@/lib/format";
import type {
  Assignment, CompletionCertificate, OnboardingItem, SubInvoice, Subcontractor, SubcontractorDocument,
} from "@/lib/types";

export type DocWarning = "expired" | "expiring" | null;

export function docWarning(expiry: string | null, status?: string): DocWarning {
  if (!expiry || status === "rejected") return null;
  const today = todayISO();
  if (expiry < today) return "expired";
  if (expiry <= addDays(today, 30)) return "expiring";
  return null;
}

export interface SubcontractorRow extends Subcontractor {
  active_assignments: number;
  total_assignments: number;
  expired_docs: number;
  expiring_docs: number;
  portal_users: number;
}

export function listSubcontractors(): SubcontractorRow[] {
  const db = getDb();
  const subs = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM assignments a WHERE a.subcontractor_id = s.id AND a.status = 'active') AS active_assignments,
      (SELECT COUNT(*) FROM assignments a WHERE a.subcontractor_id = s.id) AS total_assignments,
      (SELECT COUNT(*) FROM portal_users u WHERE u.subcontractor_id = s.id AND u.status = 'active') AS portal_users
    FROM subcontractors s ORDER BY s.name`).all() as (Subcontractor & { active_assignments: number; total_assignments: number; portal_users: number })[];
  const docs = db.prepare("SELECT subcontractor_id, expiry_date, status FROM subcontractor_documents WHERE expiry_date IS NOT NULL").all() as
    { subcontractor_id: number; expiry_date: string; status: string }[];
  return subs.map((s) => {
    let expired = 0, expiring = 0;
    for (const d of docs) {
      if (d.subcontractor_id !== s.id) continue;
      const w = docWarning(d.expiry_date, d.status);
      if (w === "expired") expired++; else if (w === "expiring") expiring++;
    }
    return { ...s, expired_docs: expired, expiring_docs: expiring };
  });
}

export function getSubcontractor(id: number): Subcontractor | undefined {
  return getDb().prepare("SELECT * FROM subcontractors WHERE id = ?").get(id) as Subcontractor | undefined;
}

export function getChecklist(id: number): OnboardingItem[] {
  return getDb().prepare("SELECT * FROM onboarding_checklist WHERE subcontractor_id = ? ORDER BY id").all(id) as OnboardingItem[];
}

export type DocRow = SubcontractorDocument & { filename: string | null };
export function getDocuments(id: number): DocRow[] {
  return getDb().prepare(`
    SELECT d.*, a.filename FROM subcontractor_documents d LEFT JOIN attachments a ON a.id = d.attachment_id
    WHERE d.subcontractor_id = ? ORDER BY d.expiry_date IS NULL, d.expiry_date`).all(id) as DocRow[];
}

export type AssignmentRow = Assignment & { project_code: string; project_name: string; stage_name: string | null };
export function getSubAssignments(id: number): AssignmentRow[] {
  return getDb().prepare(`
    SELECT a.*, p.code AS project_code, p.name AS project_name, s.name AS stage_name
    FROM assignments a JOIN projects p ON p.id = a.project_id LEFT JOIN stages s ON s.id = a.stage_id
    WHERE a.subcontractor_id = ? ORDER BY a.id DESC`).all(id) as AssignmentRow[];
}

export type SubInvoiceRow = SubInvoice & { assignment_code: string | null; project_code: string };
export function getSubInvoices(id: number): SubInvoiceRow[] {
  return getDb().prepare(`
    SELECT i.*, a.code AS assignment_code, p.code AS project_code FROM sub_invoices i
    JOIN assignments a ON a.id = i.assignment_id JOIN projects p ON p.id = i.project_id
    WHERE a.subcontractor_id = ? ORDER BY i.invoice_date DESC, i.id DESC`).all(id) as SubInvoiceRow[];
}

export type CertRow = CompletionCertificate & { assignment_code: string | null; project_code: string };
export function getSubCertificates(id: number): CertRow[] {
  return getDb().prepare(`
    SELECT c.*, a.code AS assignment_code, p.code AS project_code FROM completion_certificates c
    JOIN assignments a ON a.id = c.assignment_id JOIN projects p ON p.id = c.project_id
    WHERE a.subcontractor_id = ? ORDER BY c.cert_date DESC, c.id DESC`).all(id) as CertRow[];
}
