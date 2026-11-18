// Default approval workflows (AUTH_SPEC section E). Installed by the seed and, once, when an existing database is upgraded.
import type { DB } from "../db";
import type { ApprovalDocType, ApproverType } from "../types";

interface LevelDef {
  name: string; type: ApproverType; role?: string; dept?: string; user?: "super_admin"; mode?: "any" | "all" | "min"; min?: number; minAmount?: number; sla?: number; self?: boolean;
}
interface WfDef { type: ApprovalDocType; name: string; description: string; priority?: number; minAmount?: number; maxAmount?: number; levels: LevelDef[] }

const short = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}k`);
const grp = (n: number) => n.toLocaleString("en-US");

/** The default workflows; `scale` multiplies the amount conditions (1 = the AED-sized defaults, 0.1 for a currency worth about ten times more such as OMR). */
export function buildWorkflows(scale = 1): WfDef[] {
  const T_AWARD = Math.round(20_000_000 * scale), T_INV = Math.round(500_000 * scale), T_PAY = Math.round(1_000_000 * scale), T_RFX = Math.round(250_000 * scale);
  return [
  { type: "tender_submission", name: "Tender submission review", description: "Technical head, finance head, then management sign off the bid before it goes to the client.", levels: [
    { name: "Technical review", type: "department_head", dept: "Technical", sla: 48 }, { name: "Finance review", type: "department_head", dept: "Finance", sla: 48 }, { name: "Management approval", type: "role", role: "management", sla: 72 }] },
  { type: "tender_revision", name: "Price revision approval", description: "Revised pricing needs commercial and management approval before it is sent.", levels: [
    { name: "Commercial head", type: "department_head", dept: "Commercial", sla: 24 }, { name: "Management approval", type: "role", role: "management", sla: 48 }] },
  { type: "tender_award", name: "Award / Mark Won approval", description: `Management confirms the award; the GM adds a second sign-off for awards of ${short(T_AWARD)} and above.`, levels: [
    { name: "Management", type: "role", role: "management", sla: 48 }, { name: "General manager", type: "user", user: "super_admin", minAmount: T_AWARD, sla: 48 }] },
  { type: "sub_invoice", name: `Subcontractor invoice < ${short(T_INV)}`, description: `Project manager then finance for invoices below ${grp(T_INV)}.`, priority: 10, maxAmount: T_INV, levels: [
    { name: "Project manager", type: "project_manager", sla: 24 }, { name: "Finance", type: "role", role: "finance", sla: 48 }] },
  { type: "sub_invoice", name: `Subcontractor invoice >= ${short(T_INV)}`, description: `Adds a management level for invoices of ${grp(T_INV)} and above.`, priority: 10, minAmount: T_INV, levels: [
    { name: "Project manager", type: "project_manager", sla: 24 }, { name: "Finance", type: "role", role: "finance", sla: 48 }, { name: "Management", type: "role", role: "management", sla: 72 }] },
  { type: "invoice_payment", name: "Invoice payment approval", description: `Finance releases payment; management also signs payments of ${short(T_PAY)} and above.`, levels: [
    { name: "Finance", type: "role", role: "finance", sla: 24 }, { name: "Management", type: "role", role: "management", minAmount: T_PAY, sla: 48 }] },
  { type: "subcontract_award", name: "Subcontract award", description: "Project manager and management approve before a subcontract becomes active.", levels: [
    { name: "Project manager", type: "project_manager", sla: 48 }, { name: "Management", type: "role", role: "management", sla: 72 }] },
  { type: "subcontractor_onboarding", name: "Subcontractor onboarding", description: "Procurement head then HSE head approve a new subcontractor.", levels: [
    { name: "Procurement head", type: "department_head", dept: "Procurement", sla: 48 }, { name: "HSE head", type: "department_head", dept: "HSE", sla: 48 }] },
  { type: "completion_certificate", name: "Completion certificate", description: "The project manager confirms before a certificate is issued.", levels: [{ name: "Project manager", type: "project_manager", sla: 24 }] },
  { type: "project_cost", name: "Manual cost above threshold", description: "Manual costs above the approval threshold setting: project manager then finance.", levels: [
    { name: "Project manager", type: "project_manager", sla: 24 }, { name: "Finance", type: "role", role: "finance", sla: 48 }] },
  { type: "loss_analysis", name: "Loss analysis closure", description: "Management signs off the lessons learned before the analysis is closed.", levels: [{ name: "Management", type: "role", role: "management", sla: 72 }] },
  ...buildRfxWorkflows(T_RFX),
  ];
}

/** Supplier tendering workflows (SUPPLIER_TENDERING_SPEC B2): publication by the estimate, award by the award value (thresholds in the country's currency, `t` = 250k AED / 25k OMR). */
function buildRfxWorkflows(t: number): WfDef[] {
  return [
    { type: "rfx_publish", name: `Supplier tender publication < ${short(t)}`, description: `A procurement manager releases supplier tenders with an estimate below ${grp(t)}.`, priority: 10, maxAmount: t, levels: [
      { name: "Procurement manager", type: "role", role: "procurement", sla: 24 }] },
    { type: "rfx_publish", name: `Supplier tender publication >= ${short(t)}`, description: `Adds management sign-off for supplier tenders with an estimate of ${grp(t)} and above.`, priority: 10, minAmount: t, levels: [
      { name: "Procurement manager", type: "role", role: "procurement", sla: 24 }, { name: "Management", type: "role", role: "management", sla: 48 }] },
    { type: "rfx_award", name: "Supplier tender award", description: `Procurement manager, then the project manager; awards of ${grp(t)} and above also go to finance and the country / general manager. The bidder's recommender never approves.`, levels: [
      { name: "Procurement manager", type: "role", role: "procurement", sla: 24 }, { name: "Project manager", type: "project_manager", sla: 48 },
      { name: "Finance manager", type: "role", role: "finance", minAmount: t, sla: 48 }, { name: "Country / general manager", type: "role", role: "management", minAmount: t, sla: 72 }] },
  ];
}

/** Adds the RFx workflows to a database whose default workflows were installed before supplier tendering existed (migration; skips a scope that already has them). */
export function installRfxWorkflows(db: DB, scale = 1, entityId: number | null = null): number {
  const have = db.prepare(`SELECT COUNT(*) c FROM approval_workflows WHERE document_type IN ('rfx_publish', 'rfx_award') AND ${entityId === null ? "entity_id IS NULL" : "entity_id = ?"}`).get(...(entityId === null ? [] : [entityId])) as { c: number };
  if (have.c > 0) return 0;
  const roleId = (code: string) => (db.prepare("SELECT id FROM roles WHERE code = ?").get(code) as { id: number } | undefined)?.id ?? null;
  const now = new Date().toISOString();
  let n = 0;
  db.transaction(() => {
    for (const w of buildRfxWorkflows(Math.round(250_000 * scale))) {
      const id = Number(db.prepare(`INSERT INTO approval_workflows(document_type, name, description, is_active, priority, condition_min_amount, condition_max_amount, created_by, updated_at, entity_id)
        VALUES (?,?,?,1,?,?,?,NULL,?,?)`).run(w.type, w.name, w.description, w.priority ?? 0, w.minAmount ?? null, w.maxAmount ?? null, now, entityId).lastInsertRowid);
      w.levels.forEach((l, i) => db.prepare(`INSERT INTO approval_levels(workflow_id, level_no, name, approver_type, approver_role_id, approver_user_id, approver_department_id, approval_mode, min_approvals, min_amount, sla_hours, allow_self_approval)
        VALUES (?,?,?,?,?,NULL,NULL,'any',1,?,?,0)`).run(id, i + 1, l.name, l.type, l.role ? roleId(l.role) : null, l.minAmount ?? null, l.sla ?? 48));
      n++;
    }
  })();
  return n;
}

export const DEFAULT_WORKFLOWS: WfDef[] = buildWorkflows(1);

/** Inserts the default workflows (idempotent through the `approval_defaults_installed` setting) and the cost threshold setting. */
export function installDefaultWorkflows(db: DB, createdBy: number | null = null, scale = 1, entityId: number | null = null): number {
  // one install per scope: group-wide (entity NULL, the legacy flag) or per country (Oman gets its own thresholds in OMR)
  const flag = entityId === null ? "approval_defaults_installed" : `approval_defaults_installed_${entityId}`;
  if ((db.prepare("SELECT value FROM settings WHERE key = ?").get(flag) as { value: string } | undefined)?.value === "1") return 0;
  const roleId = (code: string) => (db.prepare("SELECT id FROM roles WHERE code = ?").get(code) as { id: number } | undefined)?.id ?? null;
  const deptId = (name: string) => (db.prepare("SELECT id FROM departments WHERE name = ?").get(name) as { id: number } | undefined)?.id ?? null;
  const superAdmin = (db.prepare("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'super_admin' ORDER BY u.id LIMIT 1").get() as { id: number } | undefined)?.id ?? null;
  const now = new Date().toISOString();
  let n = 0;
  db.transaction(() => {
    for (const w of scale === 1 ? DEFAULT_WORKFLOWS : buildWorkflows(scale)) {
      const id = Number(db.prepare(`INSERT INTO approval_workflows(document_type, name, description, is_active, priority, condition_min_amount, condition_max_amount, created_by, updated_at, entity_id)
        VALUES (?,?,?,1,?,?,?,?,?,?)`).run(w.type, w.name, w.description, w.priority ?? 0, w.minAmount ?? null, w.maxAmount ?? null, createdBy, now, entityId).lastInsertRowid);
      w.levels.forEach((l, i) => {
        db.prepare(`INSERT INTO approval_levels(workflow_id, level_no, name, approver_type, approver_role_id, approver_user_id, approver_department_id, approval_mode, min_approvals, min_amount, sla_hours, allow_self_approval)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, i + 1, l.name, l.type, l.role ? roleId(l.role) : null, l.user === "super_admin" ? superAdmin : null, l.dept ? deptId(l.dept) : null,
          l.mode ?? "any", l.min ?? 1, l.minAmount ?? null, l.sla ?? 48, l.self ? 1 : 0);
      });
      n++;
    }
    db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES (?, '1')").run(flag);
  })();
  return n;
}
