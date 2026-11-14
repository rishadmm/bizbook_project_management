import bcrypt from "bcryptjs";
import type { DB } from "./db";
import { LEGACY_ROLE_MAP, SYSTEM_ROLES } from "./role-defaults";
import { installDefaultWorkflows } from "./approvals/defaults";

export const DEMO_ADMIN_EMAIL = "admin@alnoor.demo";
export const DEMO_ADMIN_PASSWORD = "Admin@12345";
export const DEMO_USER_PASSWORD = "Password@123";

function columns(db: DB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}
function ensureColumn(db: DB, table: string, column: string, ddl: string) {
  if (!columns(db, table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

/** Inserts the system roles and their default permissions (skips roles that already exist). */
export function ensureSystemRoles(db: DB): void {
  const insRole = db.prepare("INSERT OR IGNORE INTO roles(code, name, description, is_system) VALUES (?,?,?,1)");
  const getRole = db.prepare("SELECT id FROM roles WHERE code = ?");
  const insPerm = db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, module, action) VALUES (?,?,?)");
  for (const r of SYSTEM_ROLES) {
    const res = insRole.run(r.code, r.name, r.description);
    if (res.changes === 0) continue;
    const id = (getRole.get(r.code) as { id: number }).id;
    for (const [m, actions] of Object.entries(r.perms)) for (const a of actions ?? []) insPerm.run(id, m, a);
  }
}

/** Idempotent in-place upgrade of an existing database (guarded by PRAGMA table_info). */
export function migrate(db: DB): void {
  const userCols: [string, string][] = [
    ["password_hash", "TEXT"], ["status", "TEXT NOT NULL DEFAULT 'active'"], ["role_id", "INTEGER REFERENCES roles(id)"],
    ["phone", "TEXT"], ["job_title", "TEXT"], ["must_change_password", "INTEGER DEFAULT 0"], ["failed_attempts", "INTEGER DEFAULT 0"],
    ["locked_until", "TEXT"], ["last_login_at", "TEXT"], ["password_changed_at", "TEXT"], ["manager_id", "INTEGER"],
  ];
  for (const [c, ddl] of userCols) ensureColumn(db, "users", c, ddl);
  ensureColumn(db, "departments", "head_user_id", "INTEGER");
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email))"); } catch { /* duplicate emails in a legacy db: leave non-unique */ }

  // Bootstrap roles + credentials on the first upgrade of a pre-auth database.
  const roleCount = (db.prepare("SELECT COUNT(*) c FROM roles").get() as { c: number }).c;
  const userCount = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  if (roleCount === 0) {
    db.transaction(() => {
      ensureSystemRoles(db);
      if (userCount === 0) return;
      const roleId = (code: string) => (db.prepare("SELECT id FROM roles WHERE code = ?").get(code) as { id: number }).id;
      const users = db.prepare("SELECT id, role, email, password_hash FROM users ORDER BY id").all() as { id: number; role: string; email: string | null; password_hash: string | null }[];
      const now = new Date().toISOString();
      users.forEach((u, i) => {
        const code = i === 0 ? "super_admin" : (LEGACY_ROLE_MAP[u.role] ?? "viewer");
        const sets = ["role_id = ?", "role = ?"];
        const params: unknown[] = [roleId(code), code];
        if (!u.password_hash) {
          sets.push("password_hash = ?", "password_changed_at = ?");
          params.push(bcrypt.hashSync(i === 0 ? DEMO_ADMIN_PASSWORD : DEMO_USER_PASSWORD, 10), now);
        }
        if (i === 0) { sets.push("email = ?"); params.push(DEMO_ADMIN_EMAIL); }
        db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...params, u.id);
      });
    })();
  }

  // Approval engine (AUTH_SPEC section D): tables come from schema.sql (IF NOT EXISTS); install the default workflows once on an
  // existing database that already has users and roles (an empty database gets them from the seed).
  const haveUsers = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c > 0;
  const haveRoles = (db.prepare("SELECT COUNT(*) c FROM roles").get() as { c: number }).c > 0;
  const haveWf = (db.prepare("SELECT COUNT(*) c FROM approval_workflows").get() as { c: number }).c > 0;
  if (haveUsers && haveRoles && !haveWf) installDefaultWorkflows(db);

  // One-time backfill: every role that can view projects also gets the Live Ops Map (guarded by a settings flag so a later manual revoke sticks).
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migr_ops_map_view'").get();
  if (!flag && haveRoles) {
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO role_permissions(role_id, module, action)
                  SELECT role_id, 'ops_map', 'view' FROM role_permissions WHERE module = 'projects' AND action = 'view'`).run();
      db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('migr_ops_map_view', '1')").run();
    })();
  }
}
