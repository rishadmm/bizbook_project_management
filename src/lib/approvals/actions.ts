"use server";
// Server actions of the approval engine UI (panel, inbox, delegations, workflow designer).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { guard, type ActionResult } from "@/lib/action-result";
import { todayISO } from "@/lib/format";
import { can, requirePermission, requireUser } from "@/lib/auth";
import type { ApprovalDocType, ApprovalMode, ApproverType } from "@/lib/types";
import { activeDelegate, cancelRequest, decide, resolveApprovers, submitForApproval, type Decision } from "./engine";
import { APPROVAL_MODES, APPROVER_TYPES, isDocType } from "./meta";
import { REGISTRY } from "./registry";

const str = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
const numOrNull = (f: FormData, k: string): number | null => { const v = str(f, k).replace(/,/g, ""); return v === "" || Number.isNaN(Number(v)) ? null : Number(v); };
function refresh(extra?: string) {
  revalidatePath("/", "layout");
  if (extra) revalidatePath(extra);
}

async function actingUser() {
  const u = await requireUser();
  if (u.must_change_password) throw new Error("You must change your password before continuing.");
  return u;
}

/* ------------------------------------------------------------------ panel / inbox */

/** Approve / return / reject a task. Fields: task_id, decision (approve|return|reject), comment, path (page to refresh). */
export async function decideTaskAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await actingUser();
    const decision = str(form, "decision") as Decision;
    if (!["approve", "return", "reject"].includes(decision)) throw new Error("Invalid decision");
    decide(Number(form.get("task_id")), decision, str(form, "comment") || null, user.id);
    refresh(str(form, "path") || undefined);
  });
}

/** (Re)submit a document from the panel. Fields: type, id, note, path. */
export async function submitApprovalAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const type = str(form, "type");
    if (!isDocType(type)) throw new Error("Unknown document type");
    const [mod, act] = REGISTRY[type].submitPermission;
    const user = await requirePermission(mod, act);
    submitForApproval(type, Number(form.get("id")), { userId: user.id, note: str(form, "note") || null, payload: restorePayload(type, Number(form.get("id"))) });
    refresh(str(form, "path") || undefined);
  });
}

/** Resubmission of a returned tender award / payment re-uses the payload of the last request. */
function restorePayload(type: ApprovalDocType, id: number): Record<string, unknown> {
  const r = getDb().prepare("SELECT payload FROM approval_requests WHERE document_type = ? AND document_id = ? ORDER BY id DESC LIMIT 1").get(type, id) as { payload: string | null } | undefined;
  try { return r?.payload ? (JSON.parse(r.payload) as Record<string, unknown>) : {}; } catch { return {}; }
}

export async function cancelApprovalAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await actingUser();
    cancelRequest(Number(form.get("request_id")), user.id);
    refresh(str(form, "path") || undefined);
  });
}

/* ------------------------------------------------------------------ delegations */

export async function setDelegationAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("approvals", "view");
    const delegate = Number(form.get("delegate_user_id"));
    const start = str(form, "start_date") || todayISO(); const end = str(form, "end_date");
    if (!delegate || delegate === user.id) throw new Error("Choose another user as delegate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("End date is required");
    if (end < start) throw new Error("End date is before start date");
    const types = form.getAll("document_types").map(String).filter(isDocType);
    const d = getDb().prepare("SELECT status FROM users WHERE id = ?").get(delegate) as { status: string } | undefined;
    if (!d || d.status !== "active") throw new Error("Delegate must be an active user");
    getDb().prepare("INSERT INTO approval_delegations(user_id, delegate_user_id, start_date, end_date, document_types, is_active) VALUES (?,?,?,?,?,1)")
      .run(user.id, delegate, start, end, types.length ? types.join(",") : null);
    refresh("/approvals");
  });
}

export async function endDelegationAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("approvals", "view");
    getDb().prepare("UPDATE approval_delegations SET is_active = 0 WHERE id = ? AND user_id = ?").run(Number(form.get("id")), user.id);
    refresh("/approvals");
  });
}

/* ------------------------------------------------------------------ workflow designer */

export interface LevelInput {
  name: string; approver_type: ApproverType; approver_role_id: number | null; approver_user_id: number | null; approver_department_id: number | null;
  approval_mode: ApprovalMode; min_approvals: number; min_amount: number | null; sla_hours: number; allow_self_approval: boolean;
}

function parseLevels(raw: string): LevelInput[] {
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch { throw new Error("Invalid levels"); }
  if (!Array.isArray(arr) || arr.length === 0) throw new Error("Add at least one approval level");
  const types = APPROVER_TYPES.map((t) => t.value as string); const modes = APPROVAL_MODES.map((m) => m.value as string);
  return arr.map((x, i): LevelInput => {
    const l = x as Record<string, unknown>;
    const at = String(l.approver_type);
    const name = String(l.name ?? "").trim();
    if (!name) throw new Error(`Level ${i + 1}: name is required`);
    if (!types.includes(at)) throw new Error(`Level ${i + 1}: invalid approver type`);
    const mode = String(l.approval_mode ?? "any");
    if (!modes.includes(mode)) throw new Error(`Level ${i + 1}: invalid approval mode`);
    const id = (k: string) => (l[k] === null || l[k] === undefined || l[k] === "" ? null : Number(l[k]));
    const out: LevelInput = {
      name, approver_type: at as ApproverType, approver_role_id: id("approver_role_id"), approver_user_id: id("approver_user_id"), approver_department_id: id("approver_department_id"),
      approval_mode: mode as ApprovalMode, min_approvals: Math.max(1, Math.floor(Number(l.min_approvals) || 1)), min_amount: id("min_amount"),
      sla_hours: Math.max(0, Math.floor(Number(l.sla_hours) || 0)), allow_self_approval: !!l.allow_self_approval,
    };
    if (at === "role" && !out.approver_role_id) throw new Error(`Level ${i + 1}: choose a role`);
    if (at === "user" && !out.approver_user_id) throw new Error(`Level ${i + 1}: choose a user`);
    if (at === "department" && !out.approver_department_id) throw new Error(`Level ${i + 1}: choose a department`);
    if (at !== "role") out.approver_role_id = null;
    if (at !== "user") out.approver_user_id = null;
    if (at !== "department" && at !== "department_head") out.approver_department_id = null;
    return out;
  });
}

/** Create / update a workflow. Fields: id (0 = new), name, document_type, description, priority, conditions, is_active, levels_json. */
export async function saveWorkflowAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("approval_setup", "edit");
    const id = Number(form.get("id")) || 0;
    const name = str(form, "name"); const type = str(form, "document_type");
    if (!name) throw new Error("Workflow name is required");
    if (!isDocType(type)) throw new Error("Choose a document type");
    const min = numOrNull(form, "condition_min_amount"); const max = numOrNull(form, "condition_max_amount");
    if (min !== null && max !== null && max <= min) throw new Error("Maximum amount must be greater than the minimum amount");
    const levels = parseLevels(str(form, "levels_json"));
    const db = getDb();
    const vals = [type, name, str(form, "description") || null, form.getAll("is_active").includes("on") ? 1 : 0, Math.floor(numOrNull(form, "priority") ?? 0), min, max,
      numOrNull(form, "condition_department_id"), str(form, "condition_project_category") || null];
    const wid = db.transaction(() => {
      let wf = id;
      if (id) {
        if (!db.prepare("SELECT 1 FROM approval_workflows WHERE id = ?").get(id)) throw new Error("Workflow not found");
        db.prepare(`UPDATE approval_workflows SET document_type=?, name=?, description=?, is_active=?, priority=?, condition_min_amount=?, condition_max_amount=?, condition_department_id=?, condition_project_category=?, updated_at=? WHERE id=?`)
          .run(...vals, new Date().toISOString(), id);
        db.prepare("DELETE FROM approval_levels WHERE workflow_id = ?").run(id);
      } else {
        wf = Number(db.prepare(`INSERT INTO approval_workflows(document_type, name, description, is_active, priority, condition_min_amount, condition_max_amount, condition_department_id, condition_project_category, created_by, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...vals, user.id, new Date().toISOString()).lastInsertRowid);
      }
      levels.forEach((l, i) => db.prepare(`INSERT INTO approval_levels(workflow_id, level_no, name, approver_type, approver_role_id, approver_user_id, approver_department_id, approval_mode, min_approvals, min_amount, sla_hours, allow_self_approval)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(wf, i + 1, l.name, l.approver_type, l.approver_role_id, l.approver_user_id, l.approver_department_id, l.approval_mode, l.min_approvals, l.min_amount, l.sla_hours, l.allow_self_approval ? 1 : 0));
      return wf;
    })();
    revalidatePath("/admin/approval-workflows");
    redirect(`/admin/approval-workflows?saved=${wid}`);
  });
}

export async function setWorkflowActiveAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    await requirePermission("approval_setup", "edit");
    getDb().prepare("UPDATE approval_workflows SET is_active = ?, updated_at = ? WHERE id = ?").run(form.get("active") === "1" ? 1 : 0, new Date().toISOString(), Number(form.get("id")));
    revalidatePath("/admin/approval-workflows");
  });
}

export async function cloneWorkflowAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const user = await requirePermission("approval_setup", "edit");
    const db = getDb();
    const id = Number(form.get("id"));
    const w = db.prepare("SELECT * FROM approval_workflows WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!w) throw new Error("Workflow not found");
    const nid = db.transaction(() => {
      const n = Number(db.prepare(`INSERT INTO approval_workflows(document_type, name, description, is_active, priority, condition_min_amount, condition_max_amount, condition_department_id, condition_project_category, created_by, updated_at)
        VALUES (?,?,?,0,?,?,?,?,?,?,?)`).run(w.document_type, `${w.name} (copy)`, w.description, w.priority, w.condition_min_amount, w.condition_max_amount, w.condition_department_id, w.condition_project_category, user.id, new Date().toISOString()).lastInsertRowid);
      db.prepare(`INSERT INTO approval_levels(workflow_id, level_no, name, approver_type, approver_role_id, approver_user_id, approver_department_id, approval_mode, min_approvals, min_amount, sla_hours, allow_self_approval)
        SELECT ?, level_no, name, approver_type, approver_role_id, approver_user_id, approver_department_id, approval_mode, min_approvals, min_amount, sla_hours, allow_self_approval FROM approval_levels WHERE workflow_id = ?`).run(n, id);
      return n;
    })();
    revalidatePath("/admin/approval-workflows");
    redirect(`/admin/approval-workflows/${nid}`);
  });
}

export async function deleteWorkflowAction(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    await requirePermission("approval_setup", "edit");
    const id = Number(form.get("id"));
    const used = (getDb().prepare("SELECT COUNT(*) c FROM approval_requests WHERE workflow_id = ?").get(id) as { c: number }).c;
    if (used > 0) throw new Error("This workflow has approval requests; deactivate it instead of deleting.");
    getDb().prepare("DELETE FROM approval_workflows WHERE id = ?").run(id);
    revalidatePath("/admin/approval-workflows");
  });
}

export interface PreviewRow { levelNo: number; name: string; applies: boolean; mode: string; note: string | null; approvers: string[] }

/** Live preview for the designer: which levels apply to a sample amount and who would approve today. */
export async function previewWorkflowAction(levelsJson: string, amount: number, documentType: string): Promise<PreviewRow[]> {
  const me = await requireUser();
  if (!can(me, "approval_setup", "view")) return [];
  let levels: LevelInput[];
  try { levels = parseLevels(levelsJson); } catch { return []; }
  const db = getDb();
  const name = (id: number) => (db.prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? `user ${id}`;
  const type = isDocType(documentType) ? documentType : null;
  return levels.map((l, i) => {
    const applies = l.min_amount === null || amount >= l.min_amount;
    let note: string | null = null; let ids: number[] = [];
    if (l.approver_type === "project_manager") note = "Resolved from the project of the document";
    else if (l.approver_type === "requester_manager") note = "Resolved from the requester's manager";
    else if (l.approver_type === "department_head" && !l.approver_department_id) note = "Head of the document's department";
    else ids = resolveApprovers({ ...l }, { requesterId: null, departmentId: null, projectId: null });
    const names = ids.map((u) => {
      const del = type ? activeDelegate(u, type) : null;
      return del ? `${name(u)} (delegated to ${name(del)})` : name(u);
    });
    return { levelNo: i + 1, name: l.name, applies, mode: l.approval_mode === "min" ? `at least ${l.min_approvals}` : l.approval_mode, note, approvers: names };
  });
}
