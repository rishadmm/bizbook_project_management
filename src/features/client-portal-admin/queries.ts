import { getDb } from "@/lib/db";
import { parseDbDate } from "@/lib/auth";
import { parseScope } from "@/lib/client-portal-core";

export interface ClientUserRow {
  id: number; name: string; email: string; phone: string | null; job_title: string | null; role: string; status: string; must_change_password: number;
  failed_attempts: number; locked_until: string | null; last_login_at: string | null; created_at: string; created_by_name: string | null; scope: number[] | null; locked: boolean; sessions: number;
}
export interface ClientEventRow { id: number; event: string; email: string | null; user_name: string | null; detail: string | null; ip: string | null; created_at: string }

export function getClientUsers(clientId: number): ClientUserRow[] {
  const rows = getDb().prepare(`SELECT p.*, u.name AS staff_name,
      (SELECT COUNT(*) FROM client_sessions s WHERE s.client_user_id = p.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS sessions
    FROM client_users p LEFT JOIN users u ON u.id = p.created_by WHERE p.client_id = ? ORDER BY p.id`).all(new Date().toISOString(), clientId) as (Record<string, unknown> & { staff_name: string | null })[];
  return rows.map((r) => ({
    id: r.id as number, name: r.name as string, email: r.email as string, phone: r.phone as string | null, job_title: r.job_title as string | null, role: r.role as string,
    status: r.status as string, must_change_password: r.must_change_password as number, failed_attempts: r.failed_attempts as number, locked_until: r.locked_until as string | null,
    last_login_at: r.last_login_at as string | null, created_at: r.created_at as string, created_by_name: r.staff_name, scope: parseScope(r.project_scope as string | null),
    locked: !!r.locked_until && parseDbDate(r.locked_until as string) > Date.now(), sessions: r.sessions as number,
  }));
}

export function getClientEvents(clientId: number, limit = 20): ClientEventRow[] {
  return getDb().prepare(`SELECT e.id, e.event, e.email, e.detail, e.ip, e.created_at, u.name AS user_name FROM client_auth_events e LEFT JOIN client_users u ON u.id = e.client_user_id
    WHERE e.client_id = ? ORDER BY e.id DESC LIMIT ?`).all(clientId, limit) as ClientEventRow[];
}

export function getClientProjectsLite(clientId: number): { id: number; code: string; name: string }[] {
  return getDb().prepare("SELECT id, code, name FROM projects WHERE client_id = ? ORDER BY code").all(clientId) as { id: number; code: string; name: string }[];
}

/** { clientId -> portal summary } for the Clients list column. */
export function clientPortalSummary(): Map<number, { enabled: boolean; users: number }> {
  const rows = getDb().prepare(`SELECT c.id, c.portal_enabled e, (SELECT COUNT(*) FROM client_users u WHERE u.client_id = c.id AND u.status = 'active') n FROM clients c`).all() as { id: number; e: number; n: number }[];
  return new Map(rows.map((r) => [r.id, { enabled: !!r.e, users: r.n }]));
}
