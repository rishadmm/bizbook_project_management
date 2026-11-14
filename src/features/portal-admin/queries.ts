import { getDb } from "@/lib/db";
import { parseDbDate } from "@/lib/auth";
import { parseScope } from "@/lib/portal-core";

export interface PortalUserRow {
  id: number; name: string; email: string; phone: string | null; job_title: string | null; portal_role: string; status: string; must_change_password: number;
  failed_attempts: number; locked_until: string | null; last_login_at: string | null; created_at: string; created_by_name: string | null; scope: number[] | null; locked: boolean; sessions: number;
}
export interface PortalEventRow { id: number; event: string; email: string | null; user_name: string | null; detail: string | null; ip: string | null; created_at: string }
export interface ChangeRequestRow { id: number; kind: string; payload: Record<string, string>; reason: string | null; status: string; requested_by_name: string | null; created_at: string; decided_at: string | null; decision_note: string | null }

export function getPortalUsers(subId: number): PortalUserRow[] {
  const rows = getDb().prepare(`SELECT p.*, u.name AS staff_name, o.name AS owner_name,
      (SELECT COUNT(*) FROM portal_sessions s WHERE s.portal_user_id = p.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS sessions
    FROM portal_users p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN portal_users o ON o.id = p.created_by_portal_user
    WHERE p.subcontractor_id = ? ORDER BY p.id`).all(new Date().toISOString(), subId) as (Record<string, unknown> & { staff_name: string | null; owner_name: string | null })[];
  return rows.map((r) => ({
    id: r.id as number, name: r.name as string, email: r.email as string, phone: r.phone as string | null, job_title: r.job_title as string | null, portal_role: r.portal_role as string,
    status: r.status as string, must_change_password: r.must_change_password as number, failed_attempts: r.failed_attempts as number, locked_until: r.locked_until as string | null,
    last_login_at: r.last_login_at as string | null, created_at: r.created_at as string,
    created_by_name: r.staff_name ?? (r.owner_name ? `${r.owner_name} (portal owner)` : null), scope: parseScope(r.assignment_scope as string | null),
    locked: !!r.locked_until && parseDbDate(r.locked_until as string) > Date.now(), sessions: r.sessions as number,
  }));
}

export function getPortalEvents(subId: number, limit = 20): PortalEventRow[] {
  return getDb().prepare(`SELECT e.id, e.event, e.email, e.detail, e.ip, e.created_at, u.name AS user_name FROM portal_auth_events e LEFT JOIN portal_users u ON u.id = e.portal_user_id
    WHERE e.subcontractor_id = ? ORDER BY e.id DESC LIMIT ?`).all(subId, limit) as PortalEventRow[];
}

export function getChangeRequests(subId: number): ChangeRequestRow[] {
  const rows = getDb().prepare("SELECT * FROM portal_change_requests WHERE subcontractor_id = ? ORDER BY (status = 'pending') DESC, id DESC LIMIT 20").all(subId) as (Omit<ChangeRequestRow, "payload"> & { payload: string })[];
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) as Record<string, string> }));
}

export function getPortalAssignmentsLite(subId: number): { id: number; code: string | null; project: string }[] {
  return getDb().prepare("SELECT a.id, a.code, p.code AS project FROM assignments a JOIN projects p ON p.id = a.project_id WHERE a.subcontractor_id = ? ORDER BY a.id").all(subId) as { id: number; code: string | null; project: string }[];
}

export function pendingDocumentCount(subId: number): number {
  return (getDb().prepare("SELECT COUNT(*) c FROM subcontractor_documents WHERE subcontractor_id = ? AND status = 'pending_review'").get(subId) as { c: number }).c;
}
