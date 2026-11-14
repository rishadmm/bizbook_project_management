// Default approval workflows (AUTH_SPEC section E). Installed by the seed and, once, when an existing database is upgraded.
import type { DB } from "../db";
import type { ApprovalDocType, ApproverType } from "../types";

interface LevelDef {
  name: string; type: ApproverType; role?: string; dept?: string; user?: "super_admin"; mode?: "any" | "all" | "min"; min?: number; minAmount?: number; sla?: number; self?: boolean;
}
interface WfDef { type: ApprovalDocType; name: string; description: string; priority?: number; minAmount?: number; maxAmount?: number; levels: LevelDef[] }

export const DEFAULT_WORKFLOWS: WfDef[] = [
  { type: "tender_submission", name: "Tender submission review", description: "Technical head, finance head, then management sign off the bid before it goes to the client.", levels: [
    { name: "Technical review", type: "department_head", dept: "Technical", sla: 48 }, { name: "Finance review", type: "department_head", dept: "Finance", sla: 48 }, { name: "Management approval", type: "role", role: "management", sla: 72 }] },
  { type: "tender_revision", name: "Price revision approval", description: "Revised pricing needs commercial and management approval before it is sent.", levels: [
    { name: "Commercial head", type: "department_head", dept: "Commercial", sla: 24 }, { name: "Management approval", type: "role", role: "management", sla: 48 }] },
  { type: "tender_award", name: "Award / Mark Won approval", description: "Management confirms the award; the GM adds a second sign-off for awards of 20M and above.", levels: [
    { name: "Management", type: "role", role: "management", sla: 48 }, { name: "General manager", type: "user", user: "super_admin", minAmount: 20_000_000, sla: 48 }] },
  { type: "sub_invoice", name: "Subcontractor invoice < 500k", description: "Project manager then finance for invoices below 500,000.", priority: 10, maxAmount: 500_000, levels: [
    { name: "Project manager", type: "project_manager", sla: 24 }, { name: "Finance", type: "role", role: "finance", sla: 48 }] },
  { type: "sub_invoice", name: "Subcontractor invoice >= 500k", description: "Adds a management level for invoices of 500,000 and above.", priority: 10, minAmount: 500_000, levels: [
    { name: "Project manager", type: "project_manager", sla: 24 }, { name: "Finance", type: "role", role: "finance", sla: 48 }, { name: "Management", type: "role", role: "management", sla: 72 }] },
  { type: "invoice_payment", name: "Invoice payment approval", description: "Finance releases payment; management also signs payments of 1M and above.", levels: [
    { name: "Finance", type: "role", role: "finance", sla: 24 }, { name: "Management", type: "role", role: "management", minAmount: 1_000_000, sla: 48 }] },
  { type: "subcontract_award", name: "Subcontract award", description: "Project manager and management approve before a subcontract becomes active.", levels: [
    { name: "Project manager", type: "project_manager", sla: 48 }, { name: "Management", type: "role", role: "management", sla: 72 }] },
  { type: "subcontractor_onboarding", name: "Subcontractor onboarding", description: "Procurement head then HSE head approve a new subcontractor.", levels: [
    { name: "Procurement head", type: "department_head", dept: "Procurement", sla: 48 }, { name: "HSE head", type: "department_head", dept: "HSE", sla: 48 }] },
  { type: "completion_certificate", name: "Completion certificate", description: "The project manager confirms before a certificate is issued.", levels: [{ name: "Project manager", type: "project_manager", sla: 24 }] },
  { type: "project_cost", name: "Manual cost above threshold", description: "Manual costs above the approval threshold setting: project manager then finance.", levels: [
    { name: "Project manager", type: "project_manager", sla: 24 }, { name: "Finance", type: "role", role: "finance", sla: 48 }] },
  { type: "loss_analysis", name: "Loss analysis closure", description: "Management signs off the lessons learned before the analysis is closed.", levels: [{ name: "Management", type: "role", role: "management", sla: 72 }] },
];

/** Inserts the default workflows (idempotent through the `approval_defaults_installed` setting) and the cost threshold setting. */
export function installDefaultWorkflows(db: DB, createdBy: number | null = null): number {
  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES ('approval_cost_threshold', '50000')").run();
  if ((db.prepare("SELECT value FROM settings WHERE key = 'approval_defaults_installed'").get() as { value: string } | undefined)?.value === "1") return 0;
  const roleId = (code: string) => (db.prepare("SELECT id FROM roles WHERE code = ?").get(code) as { id: number } | undefined)?.id ?? null;
  const deptId = (name: string) => (db.prepare("SELECT id FROM departments WHERE name = ?").get(name) as { id: number } | undefined)?.id ?? null;
  const superAdmin = (db.prepare("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'super_admin' ORDER BY u.id LIMIT 1").get() as { id: number } | undefined)?.id ?? null;
  const now = new Date().toISOString();
  let n = 0;
  db.transaction(() => {
    for (const w of DEFAULT_WORKFLOWS) {
      const id = Number(db.prepare(`INSERT INTO approval_workflows(document_type, name, description, is_active, priority, condition_min_amount, condition_max_amount, created_by, updated_at)
        VALUES (?,?,?,1,?,?,?,?,?)`).run(w.type, w.name, w.description, w.priority ?? 0, w.minAmount ?? null, w.maxAmount ?? null, createdBy, now).lastInsertRowid);
      w.levels.forEach((l, i) => {
        db.prepare(`INSERT INTO approval_levels(workflow_id, level_no, name, approver_type, approver_role_id, approver_user_id, approver_department_id, approval_mode, min_approvals, min_amount, sla_hours, allow_self_approval)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, i + 1, l.name, l.type, l.role ? roleId(l.role) : null, l.user === "super_admin" ? superAdmin : null, l.dept ? deptId(l.dept) : null,
          l.mode ?? "any", l.min ?? 1, l.minAmount ?? null, l.sla ?? 48, l.self ? 1 : 0);
      });
      n++;
    }
    db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('approval_defaults_installed', '1')").run();
  })();
  return n;
}
