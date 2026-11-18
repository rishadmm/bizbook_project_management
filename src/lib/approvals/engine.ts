// Multi-level approval workflow engine (AUTH_SPEC section D). Server-side only; every mutation runs in a DB transaction and writes
// the approval event history plus an activity_log entry on the document. Functions take the acting user id explicitly so the
// engine does not depend on request cookies.
import { getDb, getSetting } from "../db";
import { entityOfAttachmentOwner, userHasEntity } from "../entities";
import { todayISO } from "../format";
import type {
  ApprovalDelegation, ApprovalDocType, ApprovalLevel, ApprovalRequest, ApprovalTask, ApprovalWorkflow,
} from "../types";
import { DOC_LABEL, type LevelSnapshot } from "./meta";
import { REGISTRY, logEntity, type HandlerCtx } from "./registry";

const db = () => getDb();
const nowIso = () => new Date().toISOString();
const parse = (s: string | null | undefined): number => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z") : NaN);
const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };

export class ApprovalError extends Error { constructor(m: string) { super(m); this.name = "ApprovalError"; } }

/* ------------------------------------------------------------------ workflow selection */

export interface DocContext { amount: number; departmentId: number | null; projectCategory: string | null; /** country of the document: workflows of that country (or of all countries) apply */ entityId?: number | null }

/** Active workflow with matching conditions: highest priority, then most specific, then newest. */
export function selectWorkflow(type: ApprovalDocType, ctx: DocContext): ApprovalWorkflow | null {
  const rows = (db().prepare("SELECT * FROM approval_workflows WHERE document_type = ? AND is_active = 1").all(type) as ApprovalWorkflow[])
    .filter((w) => w.entity_id === null || w.entity_id === undefined || ctx.entityId === undefined || ctx.entityId === null || w.entity_id === ctx.entityId);
  const spec = (w: ApprovalWorkflow) => [w.condition_min_amount, w.condition_max_amount, w.condition_department_id, w.condition_project_category].filter((x) => x !== null).length;
  const ok = rows.filter((w) =>
    (w.condition_min_amount === null || ctx.amount >= w.condition_min_amount) &&
    (w.condition_max_amount === null || ctx.amount < w.condition_max_amount) &&
    (w.condition_department_id === null || w.condition_department_id === ctx.departmentId) &&
    (w.condition_project_category === null || w.condition_project_category === ctx.projectCategory));
  // a workflow of the document's own country beats a group-wide one (entity_id NULL), then priority, specificity, newest
  const own = (w: ApprovalWorkflow) => (w.entity_id !== null && w.entity_id !== undefined ? 1 : 0);
  ok.sort((a, b) => own(b) - own(a) || b.priority - a.priority || spec(b) - spec(a) || b.id - a.id);
  return ok[0] ?? null;
}

export function describeApprover(l: Pick<ApprovalLevel, "approver_type" | "approver_role_id" | "approver_user_id" | "approver_department_id">): string {
  const d = db();
  switch (l.approver_type) {
    case "role": return `Role: ${(d.prepare("SELECT name FROM roles WHERE id = ?").get(l.approver_role_id) as { name: string } | undefined)?.name ?? "?"}`;
    case "user": return (d.prepare("SELECT name FROM users WHERE id = ?").get(l.approver_user_id) as { name: string } | undefined)?.name ?? "?";
    case "department": return `Department: ${(d.prepare("SELECT name FROM departments WHERE id = ?").get(l.approver_department_id) as { name: string } | undefined)?.name ?? "?"}`;
    case "department_head": return l.approver_department_id ? `Head of ${(d.prepare("SELECT name FROM departments WHERE id = ?").get(l.approver_department_id) as { name: string } | undefined)?.name ?? "?"}` : "Head of the document's department";
    case "project_manager": return "Project manager";
    case "requester_manager": return "Requester's manager";
  }
}

/** Levels of a workflow that apply to an amount (min_amount skipping), ordered, as snapshots. */
export function applicableLevels(workflowId: number, amount: number): LevelSnapshot[] {
  const rows = db().prepare("SELECT * FROM approval_levels WHERE workflow_id = ? ORDER BY level_no, id").all(workflowId) as ApprovalLevel[];
  return rows.filter((l) => l.min_amount === null || amount >= l.min_amount).map((l) => ({
    level_no: l.level_no, name: l.name, approver_type: l.approver_type, approver_role_id: l.approver_role_id, approver_user_id: l.approver_user_id,
    approver_department_id: l.approver_department_id, approval_mode: l.approval_mode, min_approvals: l.min_approvals, min_amount: l.min_amount,
    sla_hours: l.sla_hours, allow_self_approval: l.allow_self_approval, label: describeApprover(l),
  }));
}

/* ------------------------------------------------------------------ approver resolution */

export interface ResolveCtx { requesterId: number | null; departmentId: number | null; projectId: number | null; /** approvers must be allowed to work in this country */ entityId?: number | null }

/**
 * Active user ids a level resolves to (before requester exclusion and delegation). Only users who may work in the document's country qualify;
 * a department head without access to that country is replaced by the department's accessible users (first by id).
 */
export function resolveApprovers(l: Pick<LevelSnapshot, "approver_type" | "approver_role_id" | "approver_user_id" | "approver_department_id">, c: ResolveCtx): number[] {
  const d = db();
  const ids = (sql: string, ...a: unknown[]) => (d.prepare(sql).all(...a) as { id: number }[]).map((r) => r.id);
  const access = (list: number[]) => (c.entityId ? list.filter((u) => userHasEntity(u, c.entityId)) : list);
  switch (l.approver_type) {
    case "role": return l.approver_role_id ? access(ids("SELECT id FROM users WHERE role_id = ? AND status = 'active' ORDER BY id", l.approver_role_id)) : [];
    case "user": return l.approver_user_id ? access(ids("SELECT id FROM users WHERE id = ? AND status = 'active'", l.approver_user_id)) : [];
    case "department": return l.approver_department_id ? access(ids("SELECT id FROM users WHERE department_id = ? AND status = 'active' ORDER BY id", l.approver_department_id)) : [];
    case "department_head": {
      const dept = l.approver_department_id ?? c.departmentId;
      if (!dept) return [];
      const head = access(ids("SELECT u.id FROM departments d JOIN users u ON u.id = d.head_user_id WHERE d.id = ? AND u.status = 'active'", dept));
      return head.length ? head : access(ids("SELECT id FROM users WHERE department_id = ? AND status = 'active' ORDER BY id", dept)).slice(0, 1);
    }
    case "project_manager": return c.projectId ? access(ids("SELECT u.id FROM projects p JOIN users u ON u.id = p.manager_id WHERE p.id = ? AND u.status = 'active'", c.projectId)) : [];
    case "requester_manager": return c.requesterId ? access(ids("SELECT u.id FROM users r JOIN users u ON u.id = r.manager_id WHERE r.id = ? AND u.status = 'active'", c.requesterId)) : [];
  }
}

/** Active delegation of `userId` for a document type on a date (the delegate user id), if any. */
export function activeDelegate(userId: number, type: ApprovalDocType, date = todayISO()): number | null {
  const rows = db().prepare("SELECT * FROM approval_delegations WHERE user_id = ? AND is_active = 1 AND start_date <= ? AND end_date >= ? ORDER BY id DESC").all(userId, date, date) as ApprovalDelegation[];
  for (const r of rows) {
    const types = r.document_types ? r.document_types.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (types.length === 0 || types.includes(type)) {
      const u = db().prepare("SELECT status FROM users WHERE id = ?").get(r.delegate_user_id) as { status: string } | undefined;
      if (u?.status === "active") return r.delegate_user_id;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ internals */

function event(requestId: number, levelNo: number | null, ev: string, userId: number | null, comment?: string | null): void {
  db().prepare("INSERT INTO approval_events(request_id, level_no, event, user_id, comment, created_at) VALUES (?,?,?,?,?,?)").run(requestId, levelNo, ev, userId, comment ?? null, nowIso());
}
function loadRequest(id: number): ApprovalRequest {
  const r = db().prepare("SELECT * FROM approval_requests WHERE id = ?").get(id) as ApprovalRequest | undefined;
  if (!r) throw new ApprovalError("Approval request not found");
  return r;
}
const userName = (id: number | null) => (id ? (db().prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? `user ${id}` : "system");
const levels = (r: ApprovalRequest): LevelSnapshot[] => json<LevelSnapshot[]>(r.levels_json, []);
const ctxFor = (r: ApprovalRequest, actorId: number | null, comment: string | null): HandlerCtx => ({ actorId, requestId: r.id, comment, payload: json<Record<string, unknown>>(r.payload, {}), requestedBy: r.requested_by });
function docEntity(r: ApprovalRequest): [import("../types").EntityType, number] {
  return REGISTRY[r.document_type].getDocument(r.document_id, json(r.payload, {}))?.entity ?? ["tender", r.document_id];
}
function logDoc(r: ApprovalRequest, action: string, message: string, userId: number | null): void {
  const [et, eid] = docEntity(r);
  logEntity(et, eid, action, message, userId);
}
function contextOf(r: ApprovalRequest): ResolveCtx {
  const info = REGISTRY[r.document_type].getDocument(r.document_id, json(r.payload, {}));
  return { requesterId: r.requested_by, departmentId: info?.departmentId ?? null, projectId: info?.projectId ?? null, entityId: r.entity_id ?? null };
}

/** Creates the tasks of one level. Throws an ApprovalError naming the level when nobody can approve. */
function createTasks(r: ApprovalRequest, lvl: LevelSnapshot, opts: { fallbackToAdmins?: boolean } = {}): number[] {
  const c = contextOf(r);
  let approvers = resolveApprovers(lvl, c);
  if (!lvl.allow_self_approval && r.requested_by) approvers = approvers.filter((u) => u !== r.requested_by);
  const barred = REGISTRY[r.document_type].excludedApprovers?.(r.document_id) ?? []; // separation of duties (e.g. the recommender of a tender award)
  if (barred.length) approvers = approvers.filter((u) => !barred.includes(u));
  if (approvers.length === 0 && opts.fallbackToAdmins) {
    approvers = (db().prepare("SELECT u.id FROM users u JOIN roles ro ON ro.id = u.role_id WHERE ro.code = 'super_admin' AND u.status = 'active' ORDER BY u.id").all() as { id: number }[]).map((x) => x.id).filter((u) => !barred.includes(u));
    if (approvers.length) event(r.id, lvl.level_no, "escalated", null, `No eligible approver for "${lvl.name}" (${lvl.label}); assigned to super administrators`);
  }
  if (approvers.length === 0) throw new ApprovalError(`Level ${lvl.level_no} "${lvl.name}": no eligible approvers found (${lvl.label}). Ask an administrator to fix the approval workflow.`);
  const seen = new Set<number>();
  const created: number[] = [];
  const ins = db().prepare("INSERT INTO approval_tasks(request_id, level_no, assignee_user_id, status, delegated_from_user_id, due_at, created_at) VALUES (?,?,?, 'pending', ?, ?, ?)");
  const now = new Date();
  const due = new Date(now.getTime() + (lvl.sla_hours || 0) * 3_600_000).toISOString();
  for (const original of approvers) {
    let assignee = original; let from: number | null = null;
    const del = activeDelegate(original, r.document_type);
    if (del && del !== original && (lvl.allow_self_approval || del !== r.requested_by)) { assignee = del; from = original; }
    if (seen.has(assignee)) continue;
    seen.add(assignee);
    ins.run(r.id, lvl.level_no, assignee, from, due, now.toISOString());
    created.push(assignee);
    if (from) event(r.id, lvl.level_no, "delegated", assignee, `Task of ${userName(from)} delegated to ${userName(assignee)}`);
  }
  event(r.id, lvl.level_no, "level_started", null, `${lvl.name}: ${created.map(userName).join(", ")}`);
  return created;
}

function finish(r: ApprovalRequest, status: "approved" | "rejected" | "returned" | "cancelled", actorId: number | null, comment: string | null): void {
  db().prepare("UPDATE approval_requests SET status = ?, completed_at = ? WHERE id = ?").run(status, nowIso(), r.id);
  db().prepare("UPDATE approval_tasks SET status = 'skipped' WHERE request_id = ? AND status = 'pending'").run(r.id);
  event(r.id, null, status, actorId, comment);
  const h = REGISTRY[r.document_type];
  const ctx = ctxFor(r, actorId, comment);
  if (status === "approved") h.onApproved(r.document_id, ctx);
  else if (status === "rejected") h.onRejected(r.document_id, ctx);
  else if (status === "returned") (h.onReturned ?? h.onRejected)(r.document_id, ctx);
  else h.onCancelled?.(r.document_id, ctx);
}

/* ------------------------------------------------------------------ public API */

export type SubmitResult = { status: "pending" | "auto_approved"; requestId: number };

/** Raises an approval request for a document. Auto-approves when no workflow / no level applies (unless required by setting). */
export function submitForApproval(type: ApprovalDocType, documentId: number, opts: { userId: number | null; note?: string | null; payload?: Record<string, unknown> }): SubmitResult {
  const entry = REGISTRY[type];
  return db().transaction((): SubmitResult => {
    const payload = opts.payload ?? {};
    const doc = entry.getDocument(documentId, payload);
    if (!doc) throw new ApprovalError("Document not found");
    const open = db().prepare("SELECT id FROM approval_requests WHERE document_type = ? AND document_id = ? AND status = 'pending'").get(type, documentId);
    if (open) throw new ApprovalError(`${entry.label} is already awaiting approval.`);
    const why = entry.canSubmit?.(documentId);
    if (why) throw new ApprovalError(why);
    const cat = doc.projectId ? (db().prepare("SELECT category FROM projects WHERE id = ?").get(doc.projectId) as { category: string | null } | undefined)?.category ?? null : null;
    const entityId = entityOfAttachmentOwner(doc.entity[0], doc.entity[1]) ?? 1;
    const wf = selectWorkflow(type, { amount: doc.amount, departmentId: doc.departmentId, projectCategory: cat, entityId });
    const lv = wf ? applicableLevels(wf.id, doc.amount) : [];
    const ins = db().prepare(`INSERT INTO approval_requests(document_type, document_id, document_ref, title, amount, workflow_id, current_level, status, requested_by, requested_at, note, levels_json, payload, entity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    if (!wf || lv.length === 0) {
      if (!wf && getSetting(`approval_required_${type}`, "0") === "1") throw new ApprovalError(`No approval workflow configured for ${entry.label}.`);
      const id = Number(ins.run(type, documentId, doc.ref, doc.title, doc.amount, wf?.id ?? null, 0, "approved", opts.userId, nowIso(), opts.note ?? null, "[]", JSON.stringify(payload), entityId).lastInsertRowid);
      db().prepare("UPDATE approval_requests SET completed_at = ? WHERE id = ?").run(nowIso(), id);
      event(id, null, "auto_approved", opts.userId, wf ? "No approval level applies to this amount" : "No approval workflow configured");
      logEntity(doc.entity[0], doc.entity[1], "approval", `${entry.label} auto-approved (no approval required)`, opts.userId);
      entry.onApproved(documentId, ctxFor(loadRequest(id), opts.userId, null));
      return { status: "auto_approved", requestId: id };
    }
    const id = Number(ins.run(type, documentId, doc.ref, doc.title, doc.amount, wf.id, lv[0].level_no, "pending", opts.userId, nowIso(), opts.note ?? null, JSON.stringify(lv), JSON.stringify(payload), entityId).lastInsertRowid);
    const req = loadRequest(id);
    event(id, null, "submitted", opts.userId, opts.note ?? null);
    createTasks(req, lv[0], { fallbackToAdmins: !!entry.escalateFirstLevel });
    logEntity(doc.entity[0], doc.entity[1], "approval", `${entry.label} submitted for approval (${wf.name}, ${lv.length} level${lv.length === 1 ? "" : "s"})`, opts.userId);
    return { status: "pending", requestId: id };
  })();
}

export type Decision = "approve" | "reject" | "return";

/** Decides a task. Only the assignee can decide; a super administrator may approve on behalf of the level (logged). */
export function decide(taskId: number, decision: Decision, comment: string | null, actorId: number): { requestStatus: string } {
  return db().transaction(() => {
    const task = db().prepare("SELECT * FROM approval_tasks WHERE id = ?").get(taskId) as ApprovalTask | undefined;
    if (!task) throw new ApprovalError("Approval task not found");
    const r = loadRequest(task.request_id);
    if (!userHasEntity(actorId, r.entity_id)) throw new ApprovalError("Approval request not found");
    if (r.status !== "pending") throw new ApprovalError("This approval request is no longer pending.");
    if (task.status !== "pending") throw new ApprovalError("This task has already been decided.");
    const actor = db().prepare("SELECT u.id, u.name, ro.code AS role_code FROM users u LEFT JOIN roles ro ON ro.id = u.role_id WHERE u.id = ?").get(actorId) as { id: number; name: string; role_code: string | null } | undefined;
    if (!actor) throw new ApprovalError("Unknown user");
    if (REGISTRY[r.document_type].excludedApprovers?.(r.document_id).includes(actorId)) throw new ApprovalError("You recommended this bidder and cannot decide the award (separation of duties).");
    const onBehalf = task.assignee_user_id !== actorId;
    if (onBehalf && actor.role_code !== "super_admin") throw new ApprovalError("Only the assigned approver can decide this task.");
    const text = (comment ?? "").trim() || null;
    if (decision !== "approve" && !text) throw new ApprovalError("A comment is required to reject or return a request.");
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "returned";
    db().prepare("UPDATE approval_tasks SET status = ?, decision_comment = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(status, text, nowIso(), actorId, taskId);
    const lvl = levels(r).find((l) => l.level_no === task.level_no);
    const behalf = onBehalf ? ` (on behalf of ${userName(task.assignee_user_id)})` : "";
    event(r.id, task.level_no, onBehalf ? `${status}_on_behalf` : status, actorId, text);
    logDoc(r, "approval", `${DOC_LABEL[r.document_type]} ${status} at level ${task.level_no}${lvl ? ` "${lvl.name}"` : ""} by ${actor.name}${behalf}${text ? `: ${text}` : ""}`, actorId);
    if (decision === "reject") { finish(r, "rejected", actorId, text); return { requestStatus: "rejected" }; }
    if (decision === "return") { finish(r, "returned", actorId, text); return { requestStatus: "returned" }; }
    // approve: level completion by mode
    const tasks = db().prepare("SELECT * FROM approval_tasks WHERE request_id = ? AND level_no = ?").all(r.id, task.level_no) as ApprovalTask[];
    const live = tasks.filter((t) => t.status !== "skipped");
    const approved = live.filter((t) => t.status === "approved").length;
    const mode = lvl?.approval_mode ?? "any";
    const need = mode === "any" ? 1 : mode === "all" ? live.length : Math.min(Math.max(lvl?.min_approvals ?? 1, 1), live.length);
    if (approved < need) return { requestStatus: "pending" };
    db().prepare("UPDATE approval_tasks SET status = 'skipped' WHERE request_id = ? AND level_no = ? AND status = 'pending'").run(r.id, task.level_no);
    event(r.id, task.level_no, "level_completed", actorId, null);
    const all = levels(r);
    const next = all.find((l) => l.level_no > task.level_no);
    if (!next) { finish(r, "approved", actorId, null); return { requestStatus: "approved" }; }
    db().prepare("UPDATE approval_requests SET current_level = ? WHERE id = ?").run(next.level_no, r.id);
    createTasks(loadRequest(r.id), next, { fallbackToAdmins: true });
    return { requestStatus: "pending" };
  })();
}

/** Cancels an open request (requester, administrator or super administrator). */
export function cancelRequest(requestId: number, actorId: number): void {
  db().transaction(() => {
    const r = loadRequest(requestId);
    if (!userHasEntity(actorId, r.entity_id)) throw new ApprovalError("Approval request not found");
    if (r.status !== "pending") throw new ApprovalError("Only pending requests can be cancelled.");
    const actor = db().prepare("SELECT ro.code AS role_code FROM users u LEFT JOIN roles ro ON ro.id = u.role_id WHERE u.id = ?").get(actorId) as { role_code: string | null } | undefined;
    const isAdmin = actor?.role_code === "super_admin" || actor?.role_code === "admin";
    if (r.requested_by !== actorId && !isAdmin) throw new ApprovalError("Only the requester or an administrator can cancel this request.");
    logDoc(r, "approval", `${DOC_LABEL[r.document_type]} approval request cancelled by ${userName(actorId)}`, actorId);
    finish(r, "cancelled", actorId, null);
  })();
}

/** Cancels the open request of a document when the document itself is withdrawn/closed (no permission check; used by module actions). */
export function withdrawOpenRequest(type: ApprovalDocType, documentId: number, actorId: number | null): boolean {
  return db().transaction(() => {
    const r = db().prepare("SELECT * FROM approval_requests WHERE document_type = ? AND document_id = ? AND status = 'pending'").get(type, documentId) as ApprovalRequest | undefined;
    if (!r) return false;
    logDoc(r, "approval", `${DOC_LABEL[r.document_type]} approval request withdrawn by ${userName(actorId)}`, actorId);
    finish(r, "cancelled", actorId, "Withdrawn");
    return true;
  })();
}

/* ------------------------------------------------------------------ status & inbox queries */

export interface LevelStatus {
  level: LevelSnapshot; state: "done" | "current" | "upcoming" | "rejected" | "returned";
  tasks: (ApprovalTask & { assignee_name: string; decided_by_name: string | null; delegated_from_name: string | null; overdue: boolean })[];
}
export interface ApprovalStatus {
  request: ApprovalRequest; workflowName: string | null; requesterName: string | null; levels: LevelStatus[];
  events: { id: number; level_no: number | null; event: string; user_name: string | null; comment: string | null; created_at: string }[];
  previous: (ApprovalRequest & { decider: string | null; comment: string | null })[];
}

export const isOverdue = (t: { status: string; due_at: string | null }): boolean => t.status === "pending" && !!t.due_at && parse(t.due_at) < Date.now();

/** Latest request for a document with levels, tasks and history (null if none was ever raised). */
export function getApprovalStatus(type: ApprovalDocType, documentId: number): ApprovalStatus | null {
  const reqs = db().prepare("SELECT * FROM approval_requests WHERE document_type = ? AND document_id = ? ORDER BY id DESC").all(type, documentId) as ApprovalRequest[];
  const request = reqs[0];
  if (!request) return null;
  const tasks = db().prepare(`SELECT t.*, a.name AS assignee_name, d.name AS decided_by_name, f.name AS delegated_from_name FROM approval_tasks t
    JOIN users a ON a.id = t.assignee_user_id LEFT JOIN users d ON d.id = t.decided_by LEFT JOIN users f ON f.id = t.delegated_from_user_id
    WHERE t.request_id = ? ORDER BY t.level_no, t.id`).all(request.id) as (ApprovalTask & { assignee_name: string; decided_by_name: string | null; delegated_from_name: string | null })[];
  const lv = levels(request);
  const stat: LevelStatus[] = lv.map((l) => {
    const ts = tasks.filter((t) => t.level_no === l.level_no).map((t) => ({ ...t, overdue: isOverdue(t) }));
    let state: LevelStatus["state"];
    if (ts.some((t) => t.status === "rejected")) state = "rejected";
    else if (ts.some((t) => t.status === "returned")) state = "returned";
    else if (request.status === "approved" || l.level_no < request.current_level) state = "done";
    else if (request.status === "pending" && l.level_no === request.current_level) state = "current";
    else if (ts.length && ts.every((t) => t.status === "approved" || t.status === "skipped") && ts.some((t) => t.status === "approved")) state = "done";
    else state = "upcoming";
    return { level: l, state, tasks: ts };
  });
  const events = db().prepare(`SELECT e.id, e.level_no, e.event, u.name AS user_name, e.comment, e.created_at FROM approval_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.request_id = ? ORDER BY e.id`).all(request.id) as ApprovalStatus["events"];
  const wf = request.workflow_id ? (db().prepare("SELECT name FROM approval_workflows WHERE id = ?").get(request.workflow_id) as { name: string } | undefined)?.name ?? null : null;
  const prevStmt = db().prepare("SELECT u.name AS decider, t.decision_comment AS comment FROM approval_tasks t LEFT JOIN users u ON u.id = COALESCE(t.decided_by, t.assignee_user_id) WHERE t.request_id = ? AND t.status IN ('rejected','returned') ORDER BY t.id DESC LIMIT 1");
  const previous = reqs.slice(1).map((p) => ({ ...p, ...((prevStmt.get(p.id) as { decider: string | null; comment: string | null } | undefined) ?? { decider: null, comment: null }) }));
  return { request, workflowName: wf, requesterName: request.requested_by ? userName(request.requested_by) : null, levels: stat, events, previous };
}

export interface PendingTaskRow {
  task_id: number; request_id: number; document_type: ApprovalDocType; document_id: number; document_ref: string | null; title: string | null; amount: number; entity_flag: string | null;
  level_no: number; level_name: string; level_count: number; requested_by: number | null; requester_name: string | null; requested_at: string;
  created_at: string; due_at: string | null; overdue: boolean; delegated_from_name: string | null; url: string;
}
/** Pending tasks assigned to a user (including delegated ones), oldest first. */
export function getMyPendingTasks(userId: number, entityId?: number | null): PendingTaskRow[] {
  const rows = db().prepare(`SELECT t.id AS task_id, t.request_id, t.level_no, t.created_at, t.due_at, f.name AS delegated_from_name,
      r.document_type, r.document_id, r.document_ref, r.title, r.amount, r.requested_by, r.requested_at, r.levels_json, u.name AS requester_name, en.flag AS entity_flag
    FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id AND r.status = 'pending'
    LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN users f ON f.id = t.delegated_from_user_id LEFT JOIN entities en ON en.id = r.entity_id
    WHERE t.assignee_user_id = ? AND t.status = 'pending' ${entityId ? "AND r.entity_id = ?" : ""} ORDER BY t.id`).all(...(entityId ? [userId, entityId] : [userId])) as (Omit<PendingTaskRow, "level_name" | "level_count" | "overdue" | "url"> & { levels_json: string | null })[];
  return rows.map(({ levels_json, ...r }) => {
    const lv = json<LevelSnapshot[]>(levels_json, []);
    const info = REGISTRY[r.document_type]?.getDocument(r.document_id);
    return { ...r, level_name: lv.find((l) => l.level_no === r.level_no)?.name ?? `Level ${r.level_no}`, level_count: lv.length, overdue: isOverdue({ status: "pending", due_at: r.due_at }), url: info?.url ?? "/approvals" };
  });
}
export function getPendingCount(userId: number, entityId?: number | null): number {
  return (db().prepare(`SELECT COUNT(*) c FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id AND r.status = 'pending' WHERE t.assignee_user_id = ? AND t.status = 'pending' ${entityId ? "AND r.entity_id = ?" : ""}`).get(...(entityId ? [userId, entityId] : [userId])) as { c: number }).c;
}

/** The user's open task on a document, if any (for the panel's decision form). */
export function getMyTaskFor(userId: number, type: ApprovalDocType, documentId: number): ApprovalTask | undefined {
  return db().prepare(`SELECT t.* FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id AND r.status = 'pending'
    WHERE r.document_type = ? AND r.document_id = ? AND t.assignee_user_id = ? AND t.status = 'pending' ORDER BY t.id LIMIT 1`).get(type, documentId, userId) as ApprovalTask | undefined;
}
/** First pending task of the current level (used for super-admin "approve on behalf"). */
export function getAnyPendingTask(type: ApprovalDocType, documentId: number): (ApprovalTask & { assignee_name: string }) | undefined {
  return db().prepare(`SELECT t.*, u.name AS assignee_name FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id AND r.status = 'pending' JOIN users u ON u.id = t.assignee_user_id
    WHERE r.document_type = ? AND r.document_id = ? AND t.status = 'pending' ORDER BY t.id LIMIT 1`).get(type, documentId) as (ApprovalTask & { assignee_name: string }) | undefined;
}
export const hasOpenRequest = (type: ApprovalDocType, documentId: number): boolean =>
  !!db().prepare("SELECT 1 FROM approval_requests WHERE document_type = ? AND document_id = ? AND status = 'pending'").get(type, documentId);
