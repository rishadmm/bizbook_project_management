import bcrypt from "bcryptjs";
import type { DB } from "./db";
import { LEGACY_ROLE_MAP, SYSTEM_ROLES } from "./role-defaults";
import { installDefaultWorkflows } from "./approvals/defaults";
import { addDays } from "./format";
import { uniqueSlug } from "./portal-core";
import { uniqueClientSlug } from "./client-portal-core";

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

  migrateInvoices(db);
  migratePortal(db, haveRoles);
  migrateClientPortal(db, haveRoles);

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

/* ------------------------------------------------------------------ subcontractor invoice document (INVOICE_SPEC) */

const INVOICE_COLUMNS: [string, string][] = [
  ["sub_invoice_ref", "TEXT"], ["currency", "TEXT NOT NULL DEFAULT 'AED'"], ["vat_rate", "REAL NOT NULL DEFAULT 5"],
  ["subtotal", "REAL DEFAULT 0"], ["vat_amount", "REAL DEFAULT 0"], ["gross_amount", "REAL DEFAULT 0"],
  ["retention_percent", "REAL DEFAULT 0"], ["advance_recovery_percent", "REAL DEFAULT 0"], ["previous_certified", "REAL DEFAULT 0"],
  ["submitted_by_name", "TEXT"], ["submitted_by_email", "TEXT"], ["submitted_at", "TEXT"], ["due_date", "TEXT"],
  ["reviewed_by", "INTEGER"], ["certified_by", "INTEGER"], ["certified_at", "TEXT"], ["payment_ref", "TEXT"], ["payment_method", "TEXT"],
  ["erp_doc_no", "TEXT"], ["erp_sync_status", "TEXT NOT NULL DEFAULT 'not_synced'"], ["erp_synced_at", "TEXT"], ["erp_error", "TEXT"],
];

/**
 * Idempotent. Adds the invoice-document columns, renames legacy attachments (`invoice` -> `sub_invoice`) and gives every invoice that has no
 * line yet one backfilled line (quantity = claimed share of the assignment quantity, rate = contract value / quantity, VAT 5 %).
 * Convention: `claimed_amount` stays the GROSS amount incl. VAT (= subtotal + vat_amount); `certified_amount` is gross too.
 */
function migrateInvoices(db: DB): void {
  for (const [c, ddl] of INVOICE_COLUMNS) ensureColumn(db, "sub_invoices", c, ddl);
  db.prepare("UPDATE attachments SET entity_type = 'sub_invoice' WHERE entity_type = 'invoice'").run();
  const currency = (db.prepare("SELECT value FROM settings WHERE key = 'currency'").get() as { value: string } | undefined)?.value || "AED";
  type Row = {
    id: number; assignment_id: number; claimed_amount: number; certified_amount: number; status: string; invoice_date: string | null; created_at: string | null;
    source: string; a_qty: number | null; a_unit: string | null; a_cv: number; a_scope: string | null; a_stage: number | null; a_ret: number; a_adv: number; a_days: number; st_code: string | null; st_name: string | null;
  };
  const todo = db.prepare(`
    SELECT i.id, i.assignment_id, i.claimed_amount, i.certified_amount, i.status, i.invoice_date, i.created_at, i.source,
      a.quantity a_qty, a.quantity_unit a_unit, a.contract_value a_cv, a.scope a_scope, a.stage_id a_stage, a.retention_pct a_ret, a.advance_pct a_adv, a.payment_days a_days,
      s.code st_code, s.name st_name
    FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id LEFT JOIN stages s ON s.id = a.stage_id
    WHERE NOT EXISTS (SELECT 1 FROM sub_invoice_lines l WHERE l.invoice_id = i.id)
    ORDER BY i.assignment_id, i.invoice_date, i.id`).all() as Row[];
  if (!todo.length) return;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const prevQty = new Map<number, number>();
  const prevCert = new Map<number, number>();
  // earlier invoices that already have lines count towards the cumulative figures
  for (const r of db.prepare("SELECT i.assignment_id a, SUM(l.this_qty) q FROM sub_invoice_lines l JOIN sub_invoices i ON i.id = l.invoice_id WHERE i.status <> 'rejected' GROUP BY i.assignment_id").all() as { a: number; q: number }[]) prevQty.set(r.a, r.q);
  const insLine = db.prepare(`INSERT INTO sub_invoice_lines(invoice_id, line_no, item_code, description, unit, contract_qty, rate, prev_qty, this_qty, cum_qty, amount, certified_qty, certified_amount, remarks, stage_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const upd = db.prepare(`UPDATE sub_invoices SET currency = ?, vat_rate = 5, subtotal = ?, vat_amount = ?, gross_amount = ?, retention_percent = ?, advance_recovery_percent = ?, previous_certified = ?,
    submitted_at = COALESCE(submitted_at, ?), due_date = COALESCE(due_date, ?) WHERE id = ?`);
  db.transaction(() => {
    for (const r of todo) {
      const qty = r.a_qty && r.a_qty > 0 ? r.a_qty : 1;
      const unit = r.a_qty && r.a_qty > 0 ? r.a_unit ?? "unit" : "lumpsum";
      const rate = r.a_cv > 0 ? r.a_cv / qty : 0;
      const gross = r.claimed_amount || 0;
      const subtotal = r2(gross / 1.05);
      const thisQty = rate > 0 ? subtotal / rate : 0;
      const prev = prevQty.get(r.assignment_id) ?? 0;
      const certified = ["certified", "approved", "paid"].includes(r.status) ? r.certified_amount || 0 : 0;
      const certSub = r2(certified / 1.05);
      insLine.run(r.id, 1, r.st_code ?? "BOQ-01", r.a_scope ?? r.st_name ?? "Subcontract works", unit, qty, r2(rate), prev, thisQty, prev + thisQty, subtotal,
        rate > 0 ? certSub / rate : 0, certSub, null, r.a_stage);
      if (r.status !== "rejected") prevQty.set(r.assignment_id, prev + thisQty);
      const day = (r.invoice_date ?? (r.created_at ?? "").slice(0, 10)) || null;
      upd.run(currency, subtotal, r2(gross - subtotal), gross, r.a_ret || 0, r.a_adv || 0, prevCert.get(r.assignment_id) ?? 0,
        r.created_at ?? null, day ? addDays(day, r.a_days || 30) : null, r.id);
      if (r.status !== "rejected") prevCert.set(r.assignment_id, (prevCert.get(r.assignment_id) ?? 0) + certified);
    }
  })();
}

/* ------------------------------------------------------------------ subcontractor portal (PORTAL_SPEC) */

/** Idempotent: portal columns on existing tables (new tables come from schema.sql), a slug for every subcontractor and the `portal` permission backfill. */
function migratePortal(db: DB, haveRoles: boolean): void {
  ensureColumn(db, "subcontractors", "portal_slug", "TEXT");
  ensureColumn(db, "subcontractors", "portal_enabled", "INTEGER NOT NULL DEFAULT 0");
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_portal_slug ON subcontractors(portal_slug)"); } catch { /* keep going without the index */ }
  for (const [c, ddl] of [["submitted_by_name", "TEXT"], ["portal_user_id", "INTEGER"], ["reject_reason", "TEXT"], ["weather", "TEXT"], ["resubmitted_at", "TEXT"]] as [string, string][]) ensureColumn(db, "progress_reports", c, ddl);
  for (const [c, ddl] of [["source", "TEXT NOT NULL DEFAULT 'internal'"], ["kind", "TEXT NOT NULL DEFAULT 'issue'"], ["category", "TEXT"], ["raised_by_name", "TEXT"],
    ["raised_by_portal_user", "INTEGER"], ["awaiting_party", "TEXT"], ["last_activity_at", "TEXT"]] as [string, string][]) ensureColumn(db, "issues", c, ddl);
  for (const [c, ddl] of [["source", "TEXT NOT NULL DEFAULT 'internal'"], ["uploaded_by_name", "TEXT"], ["review_note", "TEXT"]] as [string, string][]) ensureColumn(db, "subcontractor_documents", c, ddl);
  const noSlug = db.prepare("SELECT id, name FROM subcontractors WHERE portal_slug IS NULL ORDER BY id").all() as { id: number; name: string }[];
  for (const s of noSlug) db.prepare("UPDATE subcontractors SET portal_slug = ? WHERE id = ?").run(uniqueSlug(db, s.name, s.id), s.id);
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migr_portal_perm'").get();
  if (!flag && haveRoles) {
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO role_permissions(role_id, module, action) SELECT id, 'subcontractors', 'portal' FROM roles WHERE code IN ('admin', 'procurement')`).run();
      db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('migr_portal_perm', '1')").run();
    })();
  }
}

/* ------------------------------------------------------------------ client portal (CLIENT_PORTAL_SPEC) */

/** Idempotent: portal columns on `clients` (new tables come from schema.sql), a slug for every client and the `clients/portal` permission backfill. */
function migrateClientPortal(db: DB, haveRoles: boolean): void {
  ensureColumn(db, "clients", "portal_slug", "TEXT");
  ensureColumn(db, "clients", "portal_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "clients", "portal_show_subcontractors", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "clients", "portal_show_financials", "INTEGER NOT NULL DEFAULT 1");
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_slug ON clients(portal_slug)"); } catch { /* keep going without the index */ }
  const noSlug = db.prepare("SELECT id, name FROM clients WHERE portal_slug IS NULL ORDER BY id").all() as { id: number; name: string }[];
  for (const c of noSlug) db.prepare("UPDATE clients SET portal_slug = ? WHERE id = ?").run(uniqueClientSlug(db, c.name, c.id), c.id);
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migr_client_portal_perm'").get();
  if (!flag && haveRoles) {
    db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO role_permissions(role_id, module, action) SELECT id, 'clients', 'portal' FROM roles WHERE code IN ('admin', 'project_manager')`).run();
      db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('migr_client_portal_perm', '1')").run();
    })();
  }
}
