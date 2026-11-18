// Read-side queries for the approval inbox and the workflow designer.
import { getDb } from "../db";
import type { ApprovalDelegation, ApprovalLevel, ApprovalRequest, ApprovalWorkflow } from "../types";
import { REGISTRY } from "./registry";
import type { LevelSnapshot } from "./meta";

const all = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).all(...a) as T[];
const json = <T>(s: string | null | undefined, fb: T): T => { try { return s ? (JSON.parse(s) as T) : fb; } catch { return fb; } };

export type RequestRow = ApprovalRequest & { entity_flag: string | null; requester_name: string | null; url: string; level_name: string | null; level_count: number; waiting_on: string | null; overdue: boolean };

function decorate(rows: (ApprovalRequest & { requester_name: string | null; entity_flag: string | null })[]): RequestRow[] {
  const pend = getDb().prepare("SELECT u.name, t.due_at FROM approval_tasks t JOIN users u ON u.id = t.assignee_user_id WHERE t.request_id = ? AND t.status = 'pending'");
  return rows.map((r) => {
    const lv = json<LevelSnapshot[]>(r.levels_json, []);
    const waiting = r.status === "pending" ? (pend.all(r.id) as { name: string; due_at: string | null }[]) : [];
    return {
      ...r, url: REGISTRY[r.document_type]?.getDocument(r.document_id)?.url ?? "/approvals", level_name: lv.find((l) => l.level_no === r.current_level)?.name ?? null, level_count: lv.length,
      waiting_on: waiting.length ? waiting.map((w) => w.name).join(", ") : null, overdue: waiting.some((w) => !!w.due_at && Date.parse(w.due_at) < Date.now()),
    };
  });
}

/** Requests raised by the user (open first, then newest). */
export function listSubmittedBy(userId: number, entityId?: number): RequestRow[] {
  return decorate(all(`SELECT r.*, u.name AS requester_name, e.flag AS entity_flag FROM approval_requests r LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN entities e ON e.id = r.entity_id
    WHERE r.requested_by = ? ${entityId ? "AND r.entity_id = ?" : ""} ORDER BY (r.status = 'pending') DESC, r.id DESC LIMIT 200`, ...(entityId ? [userId, entityId] : [userId])));
}

export type CompletedRow = RequestRow & { my_decision: string | null; my_comment: string | null; my_decided_at: string | null };
/** Finished requests the user raised or decided on. */
export function listCompletedFor(userId: number, entityId?: number): CompletedRow[] {
  const rows = all<ApprovalRequest & { requester_name: string | null; entity_flag: string | null }>(`SELECT r.*, u.name AS requester_name, e.flag AS entity_flag FROM approval_requests r LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN entities e ON e.id = r.entity_id
    WHERE r.status != 'pending' ${entityId ? "AND r.entity_id = ?" : ""} AND (r.requested_by = ? OR r.id IN (SELECT request_id FROM approval_tasks WHERE (assignee_user_id = ? OR decided_by = ?) AND status IN ('approved','rejected','returned')))
    ORDER BY r.completed_at DESC, r.id DESC LIMIT 200`, ...(entityId ? [entityId, userId, userId, userId] : [userId, userId, userId]));
  const mine = getDb().prepare("SELECT status, decision_comment, decided_at FROM approval_tasks WHERE request_id = ? AND (assignee_user_id = ? OR decided_by = ?) AND status IN ('approved','rejected','returned') ORDER BY id DESC LIMIT 1");
  return decorate(rows).map((r) => {
    const m = mine.get(r.id, userId, userId) as { status: string; decision_comment: string | null; decided_at: string | null } | undefined;
    return { ...r, my_decision: m?.status ?? null, my_comment: m?.decision_comment ?? null, my_decided_at: m?.decided_at ?? null };
  });
}

export type DelegationRow = ApprovalDelegation & { user_name: string; delegate_name: string };
export function listDelegations(userId: number): { outgoing: DelegationRow[]; incoming: DelegationRow[] } {
  const q = (where: string) => all<DelegationRow>(`SELECT d.*, u.name AS user_name, g.name AS delegate_name FROM approval_delegations d JOIN users u ON u.id = d.user_id JOIN users g ON g.id = d.delegate_user_id WHERE ${where} ORDER BY d.end_date DESC, d.id DESC`, userId);
  return { outgoing: q("d.user_id = ?"), incoming: q("d.delegate_user_id = ?") };
}

/* ------------------------------------------------------------------ workflows */

export type WorkflowRow = ApprovalWorkflow & { entity_flag: string | null; entity_short: string | null; entity_currency: string | null; level_count: number; department_name: string | null; open_requests: number };
export function listWorkflows(): WorkflowRow[] {
  return all<WorkflowRow>(`SELECT w.*, (SELECT COUNT(*) FROM approval_levels l WHERE l.workflow_id = w.id) AS level_count, d.name AS department_name,
      (SELECT COUNT(*) FROM approval_requests r WHERE r.workflow_id = w.id AND r.status = 'pending') AS open_requests, e.flag AS entity_flag, e.short_name AS entity_short, e.currency AS entity_currency
    FROM approval_workflows w LEFT JOIN departments d ON d.id = w.condition_department_id LEFT JOIN entities e ON e.id = w.entity_id ORDER BY w.document_type, w.priority DESC, w.id`);
}
export function getWorkflow(id: number): { workflow: ApprovalWorkflow; levels: ApprovalLevel[] } | null {
  const workflow = getDb().prepare("SELECT * FROM approval_workflows WHERE id = ?").get(id) as ApprovalWorkflow | undefined;
  if (!workflow) return null;
  return { workflow, levels: all<ApprovalLevel>("SELECT * FROM approval_levels WHERE workflow_id = ? ORDER BY level_no, id", id) };
}
export function approvalLookups(): { roles: { id: number; name: string }[]; users: { id: number; name: string }[]; departments: { id: number; name: string }[]; countries: { id: number; name: string }[] } {
  return {
    countries: all("SELECT id, country AS name FROM entities WHERE status = 'active' ORDER BY sort_order, id"),
    roles: all("SELECT id, name FROM roles ORDER BY name"), users: all("SELECT id, name FROM users WHERE status = 'active' ORDER BY name"), departments: all("SELECT id, name FROM departments ORDER BY name"),
  };
}
