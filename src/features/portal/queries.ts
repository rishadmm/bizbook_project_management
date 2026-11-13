import { getDb } from "@/lib/db";
import type { Assignment, CompletionCertificate, ProgressReport, Project, Stage, SubInvoice, Subcontractor } from "@/lib/types";

export interface PortalContext {
  assignment: Assignment;
  project: Project;
  stage: Stage | null;
  subcontractor: Subcontractor;
}

/** Resolves a portal token. Returns null for unknown tokens or disabled portals. Call on every request/action. */
export function resolvePortal(token: string): PortalContext | null {
  if (!token || token.length > 64 || !/^[\w-]+$/.test(token)) return null;
  const db = getDb();
  const assignment = db.prepare("SELECT * FROM assignments WHERE portal_token = ? AND portal_enabled = 1").get(token) as Assignment | undefined;
  if (!assignment) return null;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(assignment.project_id) as Project | undefined;
  const subcontractor = db.prepare("SELECT * FROM subcontractors WHERE id = ?").get(assignment.subcontractor_id) as Subcontractor | undefined;
  if (!project || !subcontractor) return null;
  const stage = assignment.stage_id ? (db.prepare("SELECT * FROM stages WHERE id = ?").get(assignment.stage_id) as Stage | undefined) ?? null : null;
  return { assignment, project, stage, subcontractor };
}

export function portalProgressReports(assignmentId: number): ProgressReport[] {
  return getDb().prepare("SELECT * FROM progress_reports WHERE assignment_id = ? ORDER BY report_date DESC, id DESC LIMIT 30").all(assignmentId) as ProgressReport[];
}
export function portalInvoices(assignmentId: number): SubInvoice[] {
  return getDb().prepare("SELECT * FROM sub_invoices WHERE assignment_id = ? ORDER BY id DESC LIMIT 30").all(assignmentId) as SubInvoice[];
}
export function portalCertificates(assignmentId: number): CompletionCertificate[] {
  return getDb().prepare("SELECT * FROM completion_certificates WHERE assignment_id = ? ORDER BY id DESC LIMIT 30").all(assignmentId) as CompletionCertificate[];
}
