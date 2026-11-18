import bcrypt from "bcryptjs";
import type { DB } from "./db";
import { LEGACY_ROLE_MAP, SYSTEM_ROLES } from "./role-defaults";
import { installDefaultWorkflows, installRfxWorkflows } from "./approvals/defaults";
import { addDays } from "./format";
import { uniqueSlug } from "./portal-core";
import { uniqueClientSlug } from "./client-portal-core";
import { FX_TABLES, fxFillSql, fxTriggerSql, usdColumn, usdDdl } from "./fx-tables";
import { DEFAULT_CATEGORIES, DEFAULT_DOC_TYPES } from "./registration";

export const DEMO_ADMIN_EMAIL = "admin@alnoor.demo";
export const DEMO_ADMIN_PASSWORD = "Admin@12345";
export const DEMO_USER_PASSWORD = "Password@123";

function columns(db: DB, table: string): string[] {
  // table_xinfo (not table_info): it also lists generated columns, which table_info hides
  return (db.prepare(`PRAGMA table_xinfo(${table})`).all() as { name: string }[]).map((c) => c.name);
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
  migrateMultiCountry(db);
  migratePortal(db, haveRoles);
  migrateClientPortal(db, haveRoles);
  migrateProcurement(db, haveRoles);
  migrateTendering(db);

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

/* ------------------------------------------------------------------ multi-country operations + USD reporting layer (MULTI_COUNTRY_SPEC) */

export const CURRENCIES: [code: string, name: string, decimals: number, symbol: string][] = [
  ["USD", "US dollar", 2, "$"], ["AED", "UAE dirham", 2, "AED"], ["OMR", "Omani rial", 3, "OMR"], ["SAR", "Saudi riyal", 2, "SAR"],
  ["QAR", "Qatari riyal", 2, "QAR"], ["KWD", "Kuwaiti dinar", 3, "KWD"], ["BHD", "Bahraini dinar", 3, "BHD"],
];
/** Central-bank peg rates (USD per 1 unit), effective from the start of the demo history. */
export const PEG_RATES: [string, number][] = [["USD", 1], ["AED", 0.272294], ["OMR", 2.60078]];

/** Tables whose root rows belong to one country. Child rows inherit through their parent (see fx-tables.ts). */
const ENTITY_ROOTS = ["clients", "subcontractors", "tenders", "projects", "approval_requests"] as const;

function settingOf(db: DB, key: string): string | undefined {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

/** Inserts the reference currencies, the peg rates and the two country entities (AE = id 1, OM = id 2) when missing. Old per-country settings are only a migration source. */
export function ensureEntities(db: DB): void {
  const insCur = db.prepare("INSERT OR IGNORE INTO currencies(code, name, decimals, symbol) VALUES (?,?,?,?)");
  for (const c of CURRENCIES) insCur.run(...c);
  const insRate = db.prepare("INSERT OR IGNORE INTO fx_rates(currency, rate_to_usd, effective_date, source) VALUES (?,?,?,?)");
  for (const [cur, rate] of PEG_RATES) insRate.run(cur, rate, "2020-01-01", cur === "USD" ? "Reporting currency" : "Central bank peg");
  const ins = db.prepare(`INSERT OR IGNORE INTO entities(code, country, flag, legal_name, short_name, currency, vat_rate, tax_label, tax_no, cr_no, address, phone, email, map_center, timezone, approval_cost_threshold, doc_prefix, status, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const company = settingOf(db, "company_name") || "Al Noor Infrastructure LLC";
  ins.run("AE", "United Arab Emirates", "\u{1F1E6}\u{1F1EA}", company, "UAE", settingOf(db, "currency") || "AED", 5, settingOf(db, "tax_label") || "TRN",
    settingOf(db, "company_trn") || "100234567800003", null, settingOf(db, "company_address") || "Office 1204, Al Moosa Tower 2, Sheikh Zayed Road, Dubai, United Arab Emirates",
    null, null, settingOf(db, "map_center") || "25.2048,55.2708", "Asia/Dubai", Number(settingOf(db, "approval_cost_threshold")) || 50000, "", "active", 1);
  ins.run("OM", "Oman", "\u{1F1F4}\u{1F1F2}", "Al Noor Infrastructure LLC \u2013 Oman Branch", "Oman", "OMR", 5, "VATIN", "OM1100248613", "1248613",
    "Office 504, Al Khuwair Business Tower, Sultan Qaboos Street, Al Khuwair, Muscat, Sultanate of Oman", null, null, "23.588,58.383", "Asia/Muscat", 5000, "OM-", "active", 2);
  if (!settingOf(db, "reporting_currency")) db.prepare("INSERT INTO settings(key, value) VALUES ('reporting_currency', 'USD')").run();
  if (!settingOf(db, "company_name")) db.prepare("INSERT INTO settings(key, value) VALUES ('company_name', 'Al Noor Infrastructure LLC')").run();
}

/**
 * Idempotent in-place upgrade of a UAE-only database (SCHEMA_VERSION 8): entities + currencies + fx rates, entity_id on the root tables
 * (existing rows -> AE), per-user country access (every user -> AE, administrators -> all), currency / fx_rate_usd / fx_date + `<col>_usd` virtual
 * columns and AFTER INSERT triggers on every money table, and the backfill of those columns from the rows' own dates.
 */
export function migrateMultiCountry(db: DB): void {
  ensureEntities(db);
  const cols = (t: string) => columns(db, t);
  // entity_id on the root tables. SQLite cannot add a NOT NULL REFERENCES column with a non-NULL default, so: NOT NULL DEFAULT 1 (= AE, the first entity) without the FK clause.
  for (const t of ENTITY_ROOTS) {
    ensureColumn(db, t, "entity_id", "INTEGER NOT NULL DEFAULT 1");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_entity ON ${t}(entity_id)`);
  }
  ensureColumn(db, "approval_workflows", "entity_id", "INTEGER REFERENCES entities(id)"); // NULL = applies to every country
  ensureColumn(db, "users", "default_entity_id", "INTEGER REFERENCES entities(id)");
  // Default country of existing approval requests = entity of their project/tender is resolved lazily; the backfill below fixes them.
  if (!settingOf(db, "migr_multi_country_users")) {
    db.transaction(() => {
      const ae = (db.prepare("SELECT id FROM entities WHERE code = 'AE'").get() as { id: number }).id;
      const all = db.prepare("SELECT id FROM entities ORDER BY id").all() as { id: number }[];
      const users = db.prepare("SELECT u.id, COALESCE(r.code, u.role) AS role_code FROM users u LEFT JOIN roles r ON r.id = u.role_id").all() as { id: number; role_code: string }[];
      const insUe = db.prepare("INSERT OR IGNORE INTO user_entities(user_id, entity_id) VALUES (?,?)");
      for (const u of users) {
        if (u.role_code === "super_admin" || u.role_code === "admin") for (const e of all) insUe.run(u.id, e.id); else insUe.run(u.id, ae);
      }
      db.prepare("UPDATE users SET default_entity_id = ? WHERE default_entity_id IS NULL").run(ae);
      db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('migr_multi_country_users', '1')").run();
    })();
  }
  // Approval requests inherit the entity of their document's project/tender (existing rows: projects/tenders are AE, so the default 1 already holds).

  // An upgraded database gets the default approval workflows of the Oman entity too (OMR-sized thresholds) once, when workflows already exist.
  if ((db.prepare("SELECT COUNT(*) c FROM approval_workflows").get() as { c: number }).c > 0) {
    const om = db.prepare("SELECT id FROM entities WHERE code = 'OM'").get() as { id: number } | undefined;
    if (om && !settingOf(db, `approval_defaults_installed_${om.id}`)) installDefaultWorkflows(db, null, 0.1, om.id);
  }

  // USD equivalents: columns, virtual USD columns, triggers, backfill.
  db.transaction(() => {
    for (const t of FX_TABLES) {
      ensureColumn(db, t.table, "currency", "TEXT");
      ensureColumn(db, t.table, "fx_rate_usd", "REAL");
      ensureColumn(db, t.table, "fx_date", "TEXT");
      for (const c of t.money) if (!cols(t.table).includes(usdColumn(c))) db.exec(`ALTER TABLE ${t.table} ADD COLUMN ${usdColumn(c)} ${usdDdl(c, false)}`);
      for (const c of t.rates ?? []) if (!cols(t.table).includes(usdColumn(c))) db.exec(`ALTER TABLE ${t.table} ADD COLUMN ${usdColumn(c)} ${usdDdl(c, true)}`);
      db.exec(`DROP TRIGGER IF EXISTS trg_fx_${t.table}`);
      db.exec(fxTriggerSql(t));
      for (const sql of fxFillSql(t, t.table, "fx_rate_usd IS NULL")) db.exec(sql);
    }
  })();
}

/* ------------------------------------------------------------------ supplier registration + procurement foundation (SUPPLIER_TENDERING_SPEC Part A, SCHEMA_VERSION 9) */

const SUPPLIER_COLUMNS: [string, string][] = [
  ["registration_status", "TEXT NOT NULL DEFAULT 'approved'"], ["registration_no", "TEXT"], ["registered_at", "TEXT"], ["submitted_at", "TEXT"], ["reviewed_by", "INTEGER"],
  ["reviewed_at", "TEXT"], ["review_note", "TEXT"], ["reject_reason", "TEXT"], ["resubmit_count", "INTEGER NOT NULL DEFAULT 0"],
  ["legal_form", "TEXT"], ["year_established", "INTEGER"], ["employees", "INTEGER"], ["turnover_band", "TEXT"], ["website", "TEXT"], ["cr_no", "TEXT"], ["cr_expiry", "TEXT"],
  ["vat_no", "TEXT"], ["country_of_registration", "TEXT"], ["regions_served", "TEXT"], ["capacity_note", "TEXT"],
  ["prequal_grade", "TEXT"], ["prequal_valid_until", "TEXT"], ["account_name", "TEXT"], ["swift", "TEXT"],
  ["hse_lti_rate", "REAL"], ["hse_has_policy", "INTEGER"], ["iso_9001", "INTEGER NOT NULL DEFAULT 0"], ["iso_14001", "INTEGER NOT NULL DEFAULT 0"], ["iso_45001", "INTEGER NOT NULL DEFAULT 0"],
  ["icv_score", "REAL"], ["declaration_accepted_at", "TEXT"],
];
const DOC_COLUMNS: [string, string][] = [
  ["doc_type_code", "TEXT"], ["review_status", "TEXT NOT NULL DEFAULT 'pending'"], ["review_comment", "TEXT"], ["reviewed_by", "INTEGER"], ["reviewed_at", "TEXT"],
  ["version", "INTEGER NOT NULL DEFAULT 1"], ["is_current", "INTEGER NOT NULL DEFAULT 1"],
];

/** Inserts the supplier trade master list (all countries) and the registration document types of every country. INSERT OR IGNORE: safe to call again, never overwrites edits. */
export function ensureProcurementReference(db: DB): void {
  const insCat = db.prepare("INSERT OR IGNORE INTO supplier_categories(entity_id, code, name, group_name, active, sort) VALUES (NULL,?,?,?,1,?)");
  DEFAULT_CATEGORIES.forEach((c, i) => insCat.run(c.code, c.name, c.group, i + 1));
  const insDoc = db.prepare("INSERT OR IGNORE INTO registration_doc_types(entity_id, code, name, mandatory, needs_expiry, category_condition, sort, active) VALUES (?,?,?,?,?,?,?,1)");
  for (const [code, defs] of Object.entries(DEFAULT_DOC_TYPES)) {
    const e = db.prepare("SELECT id FROM entities WHERE code = ?").get(code) as { id: number } | undefined;
    if (e) defs.forEach((d, i) => insDoc.run(e.id, d.code, d.name, d.mandatory, d.needs_expiry, d.category_condition, i + 1));
  }
}

/**
 * Idempotent in-place upgrade to SCHEMA_VERSION 9: supplier registration columns on subcontractors / subcontractor_documents (new tables come from schema.sql),
 * the status backfill (every existing supplier -> approved, prospect / onboarding -> under_review), the trade list and document types, and the permission backfill
 * (procurement module, subcontractors/setup, role name "Procurement officer").
 */
export function migrateProcurement(db: DB, haveRoles: boolean): void {
  const fresh = !columns(db, "subcontractors").includes("registration_status");
  for (const [c, ddl] of SUPPLIER_COLUMNS) ensureColumn(db, "subcontractors", c, ddl);
  for (const [c, ddl] of DOC_COLUMNS) ensureColumn(db, "subcontractor_documents", c, ddl);
  if (fresh) {
    db.prepare("UPDATE subcontractors SET registration_status = 'under_review' WHERE status IN ('prospect', 'onboarding')").run();
    db.prepare("UPDATE subcontractors SET registered_at = created_at WHERE registered_at IS NULL").run();
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_sub_regstatus ON subcontractors(entity_id, registration_status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sdoc_code ON subcontractor_documents(subcontractor_id, doc_type_code, is_current)");
  // reference data only once (guarded by a flag so that edits / deletions made in Settings stick)
  if (haveRoles && !settingOf(db, "migr_procurement_ref") && (db.prepare("SELECT COUNT(*) c FROM entities").get() as { c: number }).c > 0) {
    ensureProcurementReference(db);
    db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('migr_procurement_ref', '1')").run();
  }
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'migr_procurement_perm'").get();
  if (!flag && haveRoles) {
    db.transaction(() => {
      const ins = db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, module, action) SELECT id, ?, ? FROM roles WHERE code = ?");
      for (const r of SYSTEM_ROLES) {
        for (const a of r.perms.procurement ?? []) ins.run("procurement", a, r.code);
        if (r.perms.subcontractors?.includes("setup")) ins.run("subcontractors", "setup", r.code);
      }
      db.prepare("UPDATE roles SET name = 'Procurement officer', description = ? WHERE code = 'procurement' AND is_system = 1")
        .run(SYSTEM_ROLES.find((r) => r.code === "procurement")?.description ?? "");
      db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('migr_procurement_perm', '1')").run();
    })();
  }
}

/* ------------------------------------------------------------------ supplier tendering (SUPPLIER_TENDERING_SPEC Part B, SCHEMA_VERSION 10) */

/** Idempotent: the tender link on assignments (`source` direct | tender, `rfx_id`, `rfx_bid_id`). The rfx_* tables come from schema.sql, their USD columns from migrateMultiCountry (fx-tables.ts). */
export function migrateTendering(db: DB): void {
  ensureColumn(db, "assignments", "source", "TEXT NOT NULL DEFAULT 'direct'");
  ensureColumn(db, "assignments", "rfx_id", "INTEGER");
  ensureColumn(db, "assignments", "rfx_bid_id", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_asg_rfx ON assignments(rfx_id)");
  // an existing database already has its default approval workflows: add the supplier tender ones once (group-wide in AED sizes, Oman in OMR sizes). An empty database gets them from the seed.
  if ((db.prepare("SELECT COUNT(*) c FROM approval_workflows").get() as { c: number }).c > 0 && !settingOf(db, "migr_rfx_workflows")) {
    installRfxWorkflows(db, 1, null);
    const om = db.prepare("SELECT id FROM entities WHERE code = 'OM'").get() as { id: number } | undefined;
    if (om && (db.prepare("SELECT COUNT(*) c FROM approval_workflows WHERE entity_id = ?").get(om.id) as { c: number }).c > 0) installRfxWorkflows(db, 0.1, om.id);
    db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('migr_rfx_workflows', '1')").run();
  }
}
