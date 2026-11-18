import { getDb } from "@/lib/db";
import { parseDbDate } from "@/lib/auth";
import { MODULE_KEYS, MODULES, type ModuleKey } from "@/lib/permissions";
import type { User } from "@/lib/types";

export interface UserListRow extends User { department_name: string | null; role_name: string | null; role_code: string | null; entities?: string }
export interface UserFilters { q?: string; role?: string; status?: string; department?: string }

export function listUsers(f: UserFilters = {}): UserListRow[] {
  const where: string[] = []; const p: unknown[] = [];
  if (f.q) { where.push("(lower(u.name) LIKE ? OR lower(u.email) LIKE ?)"); p.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`); }
  if (f.role) { where.push("u.role_id = ?"); p.push(Number(f.role)); }
  if (f.department) { where.push("u.department_id = ?"); p.push(Number(f.department)); }
  if (f.status === "locked") where.push("(u.status = 'locked')");
  else if (f.status) { where.push("u.status = ?"); p.push(f.status); }
  return getDb().prepare(
    `SELECT u.*, d.name AS department_name, r.name AS role_name, r.code AS role_code,
       (SELECT group_concat(e.flag || ' ' || e.short_name, ', ') FROM user_entities ue JOIN entities e ON e.id = ue.entity_id WHERE ue.user_id = u.id ORDER BY e.sort_order) AS entities FROM users u
     LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN roles r ON r.id = u.role_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY u.id`,
  ).all(...p) as UserListRow[];
}

export function getUserRow(id: number): UserListRow | undefined {
  return getDb().prepare(
    `SELECT u.*, d.name AS department_name, r.name AS role_name, r.code AS role_code FROM users u
     LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
  ).get(id) as UserListRow | undefined;
}

export interface RoleRow { id: number; code: string; name: string; description: string | null; is_system: number; user_count: number; perm_count: number }
export function listRoles(): RoleRow[] {
  return getDb().prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
            (SELECT COUNT(*) FROM role_permissions p WHERE p.role_id = r.id) AS perm_count FROM roles r ORDER BY r.is_system DESC, r.id`,
  ).all() as RoleRow[];
}
export function getRole(id: number): RoleRow | undefined {
  return listRoles().find((r) => r.id === id);
}
export function rolePermissionKeys(roleId: number): string[] {
  return (getDb().prepare("SELECT module, action FROM role_permissions WHERE role_id = ?").all(roleId) as { module: string; action: string }[]).map((r) => `${r.module}:${r.action}`);
}
export function roleUsers(roleId: number): { id: number; name: string; email: string | null }[] {
  return getDb().prepare("SELECT id, name, email FROM users WHERE role_id = ? ORDER BY name").all(roleId) as { id: number; name: string; email: string | null }[];
}
export function userOverrides(userId: number): Record<string, "allow" | "deny"> {
  const out: Record<string, "allow" | "deny"> = {};
  for (const o of getDb().prepare("SELECT module, action, effect FROM user_permission_overrides WHERE user_id = ?").all(userId) as { module: string; action: string; effect: "allow" | "deny" }[]) out[`${o.module}:${o.action}`] = o.effect;
  return out;
}

export function lookups() {
  const db = getDb();
  return {
    departments: db.prepare("SELECT id, name FROM departments ORDER BY name").all() as { id: number; name: string }[],
    roles: db.prepare("SELECT id, code, name FROM roles ORDER BY is_system DESC, id").all() as { id: number; code: string; name: string }[],
    users: db.prepare("SELECT id, name FROM users WHERE status != 'disabled' ORDER BY name").all() as { id: number; name: string }[],
    entities: db.prepare("SELECT id, code, country, flag, short_name, currency FROM entities WHERE status = 'active' ORDER BY sort_order, id").all() as { id: number; code: string; country: string; flag: string | null; short_name: string; currency: string }[],
  };
}
/** Countries a user may access (rows of user_entities) + the default country. */
export function userEntityAccess(userId: number): { ids: number[]; defaultId: number | null } {
  const db = getDb();
  return {
    ids: (db.prepare("SELECT entity_id FROM user_entities WHERE user_id = ? ORDER BY entity_id").all(userId) as { entity_id: number }[]).map((r) => r.entity_id),
    defaultId: (db.prepare("SELECT default_entity_id d FROM users WHERE id = ?").get(userId) as { d: number | null } | undefined)?.d ?? null,
  };
}

export interface SessionInfo { id: number; created_at: string; last_seen_at: string | null; expires_at: string; ip: string | null; user_agent: string | null; revoked_at: string | null }
export function userSessions(userId: number): SessionInfo[] {
  return getDb().prepare("SELECT id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(userId) as SessionInfo[];
}

export interface AuditEntry { at: string; ts: number; source: "auth" | "activity"; userId: number | null; userName: string | null; event: string; detail: string; ip: string | null }
export interface AuditFilters { user?: string; event?: string; from?: string; to?: string; source?: string; limit?: number }

/** auth_events + activity_log merged (newest first). */
export function listAudit(f: AuditFilters = {}): AuditEntry[] {
  const db = getDb();
  const out: AuditEntry[] = [];
  const uid = f.user ? Number(f.user) : null;
  const from = f.from ? Date.parse(f.from + "T00:00:00Z") : null;
  const to = f.to ? Date.parse(f.to + "T23:59:59Z") : null;
  const limit = f.limit ?? 300;
  if (f.source !== "activity") {
    const where = ["1=1"]; const p: unknown[] = [];
    if (uid) { where.push("e.user_id = ?"); p.push(uid); }
    if (f.event) { where.push("e.event = ?"); p.push(f.event); }
    for (const e of db.prepare(`SELECT e.*, u.name AS user_name FROM auth_events e LEFT JOIN users u ON u.id = e.user_id WHERE ${where.join(" AND ")} ORDER BY e.id DESC LIMIT 2000`).all(...p) as
      { user_id: number | null; user_name: string | null; email: string | null; event: string; detail: string | null; ip: string | null; created_at: string }[]) {
      out.push({ at: e.created_at, ts: parseDbDate(e.created_at), source: "auth", userId: e.user_id, userName: e.user_name ?? e.email, event: e.event, detail: e.detail ?? "", ip: e.ip });
    }
  }
  if (f.source !== "auth" && !(f.event && f.event !== "activity")) {
    const where = ["1=1"]; const p: unknown[] = [];
    if (uid) { where.push("a.user_id = ?"); p.push(uid); }
    for (const a of db.prepare(`SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(" AND ")} ORDER BY a.id DESC LIMIT 2000`).all(...p) as
      { user_id: number | null; user_name: string | null; entity_type: string; entity_id: number; action: string; message: string | null; created_at: string }[]) {
      out.push({ at: a.created_at, ts: parseDbDate(a.created_at), source: "activity", userId: a.user_id, userName: a.user_name, event: `${a.entity_type}:${a.action}`, detail: `${a.message ?? ""} (${a.entity_type} #${a.entity_id})`, ip: null });
    }
  }
  return out.filter((x) => (from === null || x.ts >= from) && (to === null || x.ts <= to)).sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export const ALL_PERMISSION_KEYS: string[] = MODULE_KEYS.flatMap((m: ModuleKey) => MODULES[m].actions.map((a) => `${m}:${a}`));
