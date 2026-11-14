// Document-type registry for the approval engine (AUTH_SPEC section D). Handlers are synchronous (better-sqlite3) and run
// inside the engine's transaction. They reuse the existing status transitions of each module.
import { getDb } from "../db";
import { todayISO } from "../format";
import { syncInvoiceCost } from "../metrics";
import type { ModuleKey } from "../permissions";
import type { ApprovalDocType, EntityType } from "../types";
import { convertTenderToProject, applyRevisionSubmitted, type WonInput } from "../../features/tenders/conversion";

export interface DocInfo {
  ref: string; title: string; amount: number; departmentId: number | null; projectId: number | null; url: string;
  /** Where the activity-log entries for this approval are written. */
  entity: [EntityType, number];
}
export interface HandlerCtx { actorId: number | null; requestId: number; comment: string | null; payload: Record<string, unknown>; requestedBy: number | null }
export interface RegistryEntry {
  type: ApprovalDocType; label: string; module: ModuleKey;
  /** Permission needed to (re)submit this document from the generic panel. */
  submitPermission: [ModuleKey, string];
  getDocument(id: number, payload?: Record<string, unknown>): DocInfo | null;
  /** Returns an error message when the document cannot be submitted in its current state. */
  canSubmit?(id: number): string | null;
  onApproved(id: number, ctx: HandlerCtx): void;
  onRejected(id: number, ctx: HandlerCtx): void;
  onReturned?(id: number, ctx: HandlerCtx): void;
  onCancelled?(id: number, ctx: HandlerCtx): void;
}

export function logEntity(entityType: EntityType, entityId: number, action: string, message: string, userId: number | null): void {
  getDb().prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id) VALUES (?,?,?,?,?)").run(entityType, entityId, action, message, userId);
}
const one = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).get(...a) as T | undefined;
const run = (sql: string, ...a: unknown[]) => getDb().prepare(sql).run(...a);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

interface TenderLite { id: number; code: string; title: string; status: string; owner_id: number | null; estimated_value: number | null; current_revision_id: number | null; project_id: number | null }
const tender = (id: number) => one<TenderLite>("SELECT id, code, title, status, owner_id, estimated_value, current_revision_id, project_id FROM tenders WHERE id = ?", id);
const ownerDept = (ownerId: number | null) => (ownerId ? one<{ department_id: number | null }>("SELECT department_id FROM users WHERE id = ?", ownerId)?.department_id ?? null : null);
const tenderPrice = (t: TenderLite) => {
  const r = one<{ total_price: number }>("SELECT total_price FROM tender_revisions WHERE id = ?", t.current_revision_id);
  return r && r.total_price > 0 ? r.total_price : t.estimated_value ?? 0;
};

interface InvLite { id: number; invoice_no: string | null; project_id: number; status: string; certified_amount: number; net_payable: number; claimed_amount: number; subcontractor: string; acode: string | null }
const invoice = (id: number) => one<InvLite>(`SELECT i.id, i.invoice_no, i.project_id, i.status, i.certified_amount, i.net_payable, i.claimed_amount, s.name AS subcontractor, a.code AS acode
  FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id JOIN subcontractors s ON s.id = a.subcontractor_id WHERE i.id = ?`, id);
const invLabel = (i: InvLite) => i.invoice_no ?? `#${i.id}`;

export const REGISTRY: Record<ApprovalDocType, RegistryEntry> = {
  tender_submission: {
    type: "tender_submission", label: "Tender submission", module: "tenders", submitPermission: ["tenders", "submit"],
    getDocument(id) {
      const t = tender(id); if (!t) return null;
      return { ref: t.code, title: t.title, amount: tenderPrice(t), departmentId: ownerDept(t.owner_id), projectId: null, url: `/tenders/${id}?tab=approvals`, entity: ["tender", id] };
    },
    canSubmit: (id) => (tender(id)?.status === "under_review" ? null : "The tender must be under review to be submitted for approval."),
    onApproved: (id) => { run("UPDATE tenders SET status = 'approved' WHERE id = ? AND status = 'under_review'", id); },
    onRejected: (id) => { run("UPDATE tenders SET status = 'in_preparation' WHERE id = ? AND status = 'under_review'", id); },
    onReturned: (id) => { run("UPDATE tenders SET status = 'in_preparation' WHERE id = ? AND status = 'under_review'", id); },
    onCancelled: (id) => { run("UPDATE tenders SET status = 'in_preparation' WHERE id = ? AND status = 'under_review'", id); },
  },
  tender_revision: {
    type: "tender_revision", label: "Tender price revision", module: "tenders", submitPermission: ["tenders", "submit"],
    getDocument(id) {
      const r = one<{ tender_id: number; label: string | null; rev_no: number; total_price: number }>("SELECT tender_id, label, rev_no, total_price FROM tender_revisions WHERE id = ?", id);
      const t = r && tender(r.tender_id); if (!r || !t) return null;
      return { ref: `${t.code} ${r.label ?? "R" + r.rev_no}`, title: `${t.title} - revision ${r.label ?? r.rev_no}`, amount: r.total_price, departmentId: ownerDept(t.owner_id), projectId: null, url: `/tenders/${t.id}?tab=approvals`, entity: ["tender", t.id] };
    },
    canSubmit(id) {
      const r = one<{ status: string; rev_no: number }>("SELECT status, rev_no FROM tender_revisions WHERE id = ?", id);
      return r && r.status === "draft" && r.rev_no > 0 ? null : "Only a draft revision R1 or later can be submitted.";
    },
    onApproved(id, ctx) {
      applyRevisionSubmitted(id);
      const r = one<{ tender_id: number; label: string | null }>("SELECT tender_id, label FROM tender_revisions WHERE id = ?", id);
      if (r) logEntity("tender", r.tender_id, "revision", `Revision ${r.label ?? id} approved and submitted to client`, ctx.actorId);
    },
    onRejected: () => { /* revision stays draft */ },
    onReturned: () => { /* revision stays draft */ },
  },
  tender_award: {
    type: "tender_award", label: "Tender award (Mark Won)", module: "tenders", submitPermission: ["tenders", "approve"],
    getDocument(id, payload) {
      const t = tender(id); if (!t) return null;
      return { ref: t.code, title: `${t.title} - award`, amount: payload?.won_value !== undefined ? num(payload.won_value) : tenderPrice(t), departmentId: ownerDept(t.owner_id), projectId: null, url: `/tenders/${id}?tab=approvals`, entity: ["tender", id] };
    },
    canSubmit(id) {
      const t = tender(id);
      if (!t) return "Tender not found";
      if (t.project_id) return "This tender already has a project.";
      return ["submitted", "negotiation"].includes(t.status) ? null : "Only submitted or negotiation tenders can be marked won.";
    },
    onApproved(id, ctx) {
      const p = ctx.payload as Partial<WonInput>;
      const projectId = convertTenderToProject(id, {
        won_value: num(p.won_value), award_date: String(p.award_date || todayISO()), start_date: p.start_date ? String(p.start_date) : null,
        end_date: p.end_date ? String(p.end_date) : null, manager_id: p.manager_id ? Number(p.manager_id) : null,
      });
      const t = tender(id)!;
      logEntity("tender", id, "won", `Tender won at final value ${num(p.won_value)}; project created`, ctx.actorId);
      logEntity("project", projectId, "created", `Project created from tender ${t.code}`, ctx.actorId);
    },
    onRejected: () => { /* tender stays in negotiation */ },
    onReturned: () => { /* tender stays in negotiation */ },
  },
  subcontractor_onboarding: {
    type: "subcontractor_onboarding", label: "Subcontractor onboarding", module: "subcontractors", submitPermission: ["subcontractors", "approve"],
    getDocument(id) {
      const s = one<{ name: string; code: string | null }>("SELECT name, code FROM subcontractors WHERE id = ?", id); if (!s) return null;
      return { ref: s.code ?? `SUB-${id}`, title: `Onboarding of ${s.name}`, amount: 0, departmentId: null, projectId: null, url: `/subcontractors/${id}?tab=onboarding`, entity: ["subcontractor", id] };
    },
    canSubmit(id) {
      const open = one<{ c: number }>("SELECT COUNT(*) c FROM onboarding_checklist WHERE subcontractor_id = ? AND done = 0", id)!.c;
      return open > 0 ? "Complete the onboarding checklist first." : null;
    },
    onApproved: (id) => { run("UPDATE subcontractors SET status = 'approved' WHERE id = ?", id); },
    onRejected: () => { /* stays onboarding */ },
    onReturned: () => { /* stays onboarding */ },
  },
  subcontract_award: {
    type: "subcontract_award", label: "Subcontract award", module: "subcontractors", submitPermission: ["subcontractors", "edit"],
    getDocument(id) {
      const a = one<{ code: string | null; scope: string | null; contract_value: number; project_id: number }>("SELECT code, scope, contract_value, project_id FROM assignments WHERE id = ?", id); if (!a) return null;
      return { ref: a.code ?? `SC-${id}`, title: `Subcontract ${a.code ?? id}${a.scope ? ` - ${a.scope}` : ""}`, amount: a.contract_value, departmentId: null, projectId: a.project_id, url: `/projects/${a.project_id}?tab=subcontracts`, entity: ["assignment", id] };
    },
    canSubmit: (id) => (one<{ status: string }>("SELECT status FROM assignments WHERE id = ?", id)?.status === "active" ? "The subcontract is already active." : null),
    onApproved: (id) => { run("UPDATE assignments SET status = 'active' WHERE id = ?", id); },
    onRejected: (id) => { run("UPDATE assignments SET status = 'draft' WHERE id = ? AND status != 'active'", id); },
    onReturned: (id) => { run("UPDATE assignments SET status = 'draft' WHERE id = ? AND status != 'active'", id); },
    onCancelled: (id) => { run("UPDATE assignments SET status = 'draft' WHERE id = ? AND status != 'active'", id); },
  },
  sub_invoice: {
    type: "sub_invoice", label: "Subcontractor invoice", module: "invoices", submitPermission: ["invoices", "approve"],
    getDocument(id) {
      const i = invoice(id); if (!i) return null;
      return { ref: invLabel(i), title: `Invoice ${invLabel(i)} - ${i.subcontractor}`, amount: i.certified_amount, departmentId: null, projectId: i.project_id, url: `/invoices/${id}`, entity: ["invoice", id] };
    },
    canSubmit: (id) => (invoice(id)?.status === "certified" ? null : "Only certified invoices can be submitted for approval."),
    onApproved(id) { run("UPDATE sub_invoices SET status = 'approved' WHERE id = ? AND status = 'certified'", id); syncInvoiceCost(id); },
    onRejected(id) { run("UPDATE sub_invoices SET status = 'rejected' WHERE id = ? AND status = 'certified'", id); syncInvoiceCost(id); },
    onReturned(id) { run("UPDATE sub_invoices SET status = 'under_review' WHERE id = ? AND status = 'certified'", id); syncInvoiceCost(id); },
  },
  invoice_payment: {
    type: "invoice_payment", label: "Invoice payment", module: "invoices", submitPermission: ["invoices", "pay"],
    getDocument(id, payload) {
      const i = invoice(id); if (!i) return null;
      return { ref: invLabel(i), title: `Payment of invoice ${invLabel(i)} - ${i.subcontractor}`, amount: payload?.paid_amount !== undefined ? num(payload.paid_amount) : i.net_payable, departmentId: null, projectId: i.project_id, url: `/invoices/${id}`, entity: ["invoice", id] };
    },
    canSubmit: (id) => (invoice(id)?.status === "approved" ? null : "Only approved invoices can be paid."),
    onApproved(id, ctx) {
      const i = invoice(id)!;
      const amount = ctx.payload.paid_amount !== undefined ? num(ctx.payload.paid_amount) : i.net_payable;
      run("UPDATE sub_invoices SET status = 'paid', paid_amount = ?, paid_date = ?, payment_method = COALESCE(?, payment_method), payment_ref = COALESCE(?, payment_ref) WHERE id = ? AND status = 'approved'",
        amount, String(ctx.payload.paid_date || todayISO()), ctx.payload.payment_method ? String(ctx.payload.payment_method) : null, ctx.payload.payment_ref ? String(ctx.payload.payment_ref) : null, id);
      syncInvoiceCost(id);
    },
    onRejected: () => { /* stays approved */ },
    onReturned: () => { /* stays approved */ },
  },
  completion_certificate: {
    type: "completion_certificate", label: "Completion certificate", module: "certificates", submitPermission: ["certificates", "issue"],
    getDocument(id) {
      const c = one<{ cert_no: string | null; cert_type: string; project_id: number; percent: number | null }>("SELECT cert_no, cert_type, project_id, percent FROM completion_certificates WHERE id = ?", id); if (!c) return null;
      return { ref: c.cert_no ?? `#${id}`, title: `Certificate ${c.cert_no ?? id} (${c.cert_type}${c.percent !== null ? ` ${c.percent}%` : ""})`, amount: 0, departmentId: null, projectId: c.project_id, url: `/projects/${c.project_id}?tab=invoices`, entity: ["certificate", id] };
    },
    canSubmit: (id) => (one<{ status: string }>("SELECT status FROM completion_certificates WHERE id = ?", id)?.status === "issued" ? "The certificate is already issued." : null),
    onApproved(id, ctx) { run("UPDATE completion_certificates SET status = 'issued', issued_by = ?, cert_date = ? WHERE id = ?", ctx.requestedBy, todayISO(), id); },
    onRejected: (id) => { run("UPDATE completion_certificates SET status = 'rejected' WHERE id = ? AND status != 'issued'", id); },
    onReturned: (id) => { run("UPDATE completion_certificates SET status = 'draft' WHERE id = ? AND status != 'issued'", id); },
  },
  project_cost: {
    type: "project_cost", label: "Manual project cost", module: "project_costs", submitPermission: ["project_costs", "create"],
    getDocument(id) {
      const c = one<{ project_id: number; description: string | null; amount: number; category: string }>("SELECT project_id, description, amount, category FROM project_cost_requests WHERE id = ?", id); if (!c) return null;
      const p = one<{ code: string }>("SELECT code FROM projects WHERE id = ?", c.project_id);
      return { ref: `${p?.code ?? "PRJ"} cost #${id}`, title: `${c.category} cost: ${c.description ?? ""}`, amount: c.amount, departmentId: null, projectId: c.project_id, url: `/projects/${c.project_id}?tab=budget`, entity: ["project", c.project_id] };
    },
    canSubmit: (id) => (one<{ status: string }>("SELECT status FROM project_cost_requests WHERE id = ?", id)?.status === "pending" ? null : "This cost is no longer awaiting approval."),
    onApproved(id) {
      const c = one<{ project_id: number; stage_id: number | null; category: string; description: string | null; amount: number; cost_date: string | null }>("SELECT * FROM project_cost_requests WHERE id = ?", id);
      if (!c) return;
      run("INSERT INTO project_costs(project_id, stage_id, category, description, amount, cost_date, source_type, source_id) VALUES (?,?,?,?,?,?, 'manual', NULL)", c.project_id, c.stage_id, c.category, c.description, c.amount, c.cost_date ?? todayISO());
      run("UPDATE project_cost_requests SET status = 'posted' WHERE id = ?", id);
    },
    onRejected: (id) => { run("DELETE FROM project_cost_requests WHERE id = ? AND status = 'pending'", id); },
    onReturned: (id) => { run("DELETE FROM project_cost_requests WHERE id = ? AND status = 'pending'", id); },
    onCancelled: (id) => { run("DELETE FROM project_cost_requests WHERE id = ? AND status = 'pending'", id); },
  },
  loss_analysis: {
    type: "loss_analysis", label: "Loss analysis closure", module: "lost_analysis", submitPermission: ["lost_analysis", "edit"],
    getDocument(id) {
      const l = one<{ tender_id: number; our_price: number | null }>("SELECT tender_id, our_price FROM loss_analyses WHERE id = ?", id);
      const t = l && tender(l.tender_id); if (!l || !t) return null;
      return { ref: `${t.code} loss`, title: `Close loss analysis of ${t.title}`, amount: l.our_price ?? 0, departmentId: ownerDept(t.owner_id), projectId: null, url: `/lost-analysis/${id}`, entity: ["loss", id] };
    },
    canSubmit: (id) => (one<{ status: string }>("SELECT status FROM loss_analyses WHERE id = ?", id)?.status === "closed" ? "The analysis is already closed." : null),
    onApproved: (id) => { run("UPDATE loss_analyses SET status = 'closed' WHERE id = ?", id); },
    onRejected: (id) => { run("UPDATE loss_analyses SET status = 'in_review' WHERE id = ? AND status != 'closed'", id); },
    onReturned: (id) => { run("UPDATE loss_analyses SET status = 'in_review' WHERE id = ? AND status != 'closed'", id); },
    onCancelled: (id) => { run("UPDATE loss_analyses SET status = 'in_review' WHERE id = ? AND status != 'closed'", id); },
  },
};
