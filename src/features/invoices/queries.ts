import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting } from "@/lib/db";
import { getActivity, type ActivityRow } from "@/lib/activity";
import { getApprovalStatus, type ApprovalStatus } from "@/lib/approvals/engine";
import { UPLOAD_DIR, listAttachments } from "@/lib/files";
import type { Attachment, InvoiceStatus, ProgressReport, SubInvoice, SubInvoiceLine } from "@/lib/types";

export type InvoiceQueueRow = SubInvoice & {
  assignment_code: string | null; project_code: string; project_name: string; subcontractor_id: number; subcontractor_name: string;
  contract_value: number; advance_pct: number; retention_pct: number; files: { id: number; filename: string }[];
};

export function listInvoices(status?: string): InvoiceQueueRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT i.*, a.code AS assignment_code, a.contract_value, a.advance_pct, a.retention_pct, p.code AS project_code, p.name AS project_name,
      s.id AS subcontractor_id, s.name AS subcontractor_name
    FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id JOIN projects p ON p.id = i.project_id
    JOIN subcontractors s ON s.id = a.subcontractor_id
    ${status ? "WHERE i.status = ?" : ""} ORDER BY i.invoice_date DESC, i.id DESC`).all(...(status ? [status] : [])) as Omit<InvoiceQueueRow, "files">[];
  const att = db.prepare("SELECT id, filename FROM attachments WHERE entity_type='sub_invoice' AND entity_id = ? ORDER BY id");
  return rows.map((r) => ({ ...r, files: att.all(r.id) as { id: number; filename: string }[] }));
}

export function invoiceTotals(): Record<InvoiceStatus, { count: number; amount: number }> {
  const out = {} as Record<InvoiceStatus, { count: number; amount: number }>;
  for (const s of ["submitted", "under_review", "certified", "approved", "paid", "rejected"] as InvoiceStatus[]) out[s] = { count: 0, amount: 0 };
  const rows = getDb().prepare("SELECT status, COUNT(*) c, COALESCE(SUM(CASE WHEN status IN ('submitted','under_review','rejected') THEN claimed_amount WHEN status='paid' THEN paid_amount ELSE certified_amount END),0) a FROM sub_invoices GROUP BY status").all() as { status: InvoiceStatus; c: number; a: number }[];
  for (const r of rows) if (out[r.status]) out[r.status] = { count: r.c, amount: r.a };
  return out;
}

/* ------------------------------------------------------------------ invoice document */

export interface InvoiceDetail {
  invoice: SubInvoice & { assignment_code: string | null };
  lines: SubInvoiceLine[];
  subcontractor: { id: number; code: string | null; name: string; trade: string | null; address: string | null; tax_no: string | null; trade_license_no: string | null; contact_person: string | null; email: string | null; phone: string | null; bank_name: string | null; iban_masked: string | null };
  project: { id: number; code: string; name: string; location: string | null; region: string | null; manager_name: string | null; cost_centre: string };
  client: { id: number; name: string; address: string | null } | null;
  company: { name: string; address: string; trn: string };
  assignment: { id: number; code: string | null; scope: string | null; contract_value: number; payment_terms: string | null; payment_days: number; retention_pct: number; advance_pct: number; quantity: number | null; quantity_unit: string | null; status: string; stage_id: number | null };
  stages: { id: number; code: string | null; name: string }[];
  progress: ProgressReport[];
  statement: { id: number; invoice_no: string | null; invoice_date: string | null; status: InvoiceStatus; claimed: number; certified: number; paid: number; current: boolean }[];
  attachments: (Attachment & { uploader_name: string | null; sha256?: string | null })[];
  approval: ApprovalStatus | null;
  paymentApproval: ApprovalStatus | null;
  trail: { document: "Invoice" | "Payment"; level: string; approver: string; decision: string; date: string | null; comment: string | null }[];
  people: { submittedBy: string | null; submittedAt: string | null; reviewedBy: string | null; certifiedBy: string | null; certifiedAt: string | null; approvedBy: string | null; approvedAt: string | null };
  activity: ActivityRow[];
  kpis: { claimed: number; certified: number; netPayable: number; paid: number; outstanding: number };
  certifiedState: boolean;
}

const maskIban = (iban: string | null): string | null => {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "");
  return (clean.length > 4 ? "*".repeat(clean.length - 4) + clean.slice(-4) : clean).replace(/(.{4})/g, "$1 ").trim();
};
const CERT_STATES = ["certified", "approved", "paid"];

/** Everything the invoice page, PDF and ERP payload need. `hashes` adds sha256 of each attachment file (reads the files). */
export function getInvoiceDetail(id: number, opts: { hashes?: boolean } = {}): InvoiceDetail | null {
  const db = getDb();
  const inv = db.prepare("SELECT i.*, a.code AS assignment_code FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id WHERE i.id = ?").get(id) as (SubInvoice & { assignment_code: string | null }) | undefined;
  if (!inv) return null;
  const lines = db.prepare("SELECT * FROM sub_invoice_lines WHERE invoice_id = ? ORDER BY line_no, id").all(id) as SubInvoiceLine[];
  const asg = db.prepare("SELECT * FROM assignments WHERE id = ?").get(inv.assignment_id) as InvoiceDetail["assignment"] & { subcontractor_id: number };
  const sub = db.prepare("SELECT * FROM subcontractors WHERE id = ?").get(asg.subcontractor_id) as Record<string, string | number | null>;
  const prj = db.prepare(`SELECT p.id, p.code, p.name, p.location, p.region, p.client_id, u.name AS manager_name FROM projects p LEFT JOIN users u ON u.id = p.manager_id WHERE p.id = ?`).get(inv.project_id) as
    { id: number; code: string; name: string; location: string | null; region: string | null; client_id: number | null; manager_name: string | null };
  const client = prj.client_id ? (db.prepare("SELECT id, name, address FROM clients WHERE id = ?").get(prj.client_id) as { id: number; name: string; address: string | null } | undefined) ?? null : null;
  const stageIds = [...new Set([asg.stage_id, ...lines.map((l) => l.stage_id)].filter((x): x is number => !!x))];
  const stages = stageIds.length ? (db.prepare(`SELECT id, code, name FROM stages WHERE id IN (${stageIds.map(() => "?").join(",")}) ORDER BY sort, id`).all(...stageIds) as InvoiceDetail["stages"]) : [];
  const progress = inv.period_from && inv.period_to
    ? (db.prepare("SELECT * FROM progress_reports WHERE assignment_id = ? AND report_date >= ? AND report_date <= ? ORDER BY report_date, id").all(inv.assignment_id, inv.period_from, inv.period_to) as ProgressReport[])
    : [];
  const statement = (db.prepare("SELECT id, invoice_no, invoice_date, status, claimed_amount, certified_amount, paid_amount FROM sub_invoices WHERE assignment_id = ? ORDER BY invoice_date, id").all(inv.assignment_id) as
    { id: number; invoice_no: string | null; invoice_date: string | null; status: InvoiceStatus; claimed_amount: number; certified_amount: number; paid_amount: number }[])
    .map((r) => ({ id: r.id, invoice_no: r.invoice_no, invoice_date: r.invoice_date, status: r.status, claimed: r.claimed_amount, certified: CERT_STATES.includes(r.status) ? r.certified_amount : 0, paid: r.paid_amount, current: r.id === id }));
  const attachments = listAttachments("sub_invoice", id).map((a) => ({ ...a, sha256: opts.hashes ? hashFile(a.stored_path) : undefined }));
  const approval = getApprovalStatus("sub_invoice", id);
  const paymentApproval = getApprovalStatus("invoice_payment", id);
  const trail: InvoiceDetail["trail"] = [];
  for (const [doc, st] of [["Invoice", approval], ["Payment", paymentApproval]] as const) {
    if (!st) continue;
    for (const l of st.levels) for (const t of l.tasks) trail.push({
      document: doc, level: `L${l.level.level_no} ${l.level.name}`, approver: t.decided_by_name ?? t.assignee_name, decision: t.status, date: t.decided_at, comment: t.decision_comment,
    });
  }
  const name = (uid: number | null) => (uid ? (db.prepare("SELECT name FROM users WHERE id = ?").get(uid) as { name: string } | undefined)?.name ?? null : null);
  const lastApproved = [...trail].reverse().find((t) => t.document === "Invoice" && t.decision === "approved");
  const people: InvoiceDetail["people"] = {
    submittedBy: inv.submitted_by_name, submittedAt: inv.submitted_at, reviewedBy: name(inv.reviewed_by), certifiedBy: name(inv.certified_by), certifiedAt: inv.certified_at,
    approvedBy: approval?.request.status === "approved" ? lastApproved?.approver ?? null : null, approvedAt: approval?.request.status === "approved" ? approval.request.completed_at ?? lastApproved?.date ?? null : null,
  };
  const activity = [...getActivity("invoice", id, 100), ...getActivity("sub_invoice", id, 100)].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id)).slice(0, 100);
  const certifiedState = CERT_STATES.includes(inv.status);
  const kpis = {
    claimed: inv.claimed_amount, certified: certifiedState ? inv.certified_amount : 0, netPayable: certifiedState ? inv.net_payable : 0, paid: inv.paid_amount,
    outstanding: certifiedState ? Math.max(0, inv.net_payable - inv.paid_amount) : 0,
  };
  return {
    invoice: inv, lines,
    subcontractor: {
      id: asg.subcontractor_id, code: sub.code as string | null, name: sub.name as string, trade: sub.trade as string | null, address: sub.address as string | null, tax_no: sub.tax_no as string | null,
      trade_license_no: sub.trade_license_no as string | null, contact_person: sub.contact_person as string | null, email: sub.email as string | null, phone: sub.phone as string | null,
      bank_name: sub.bank_name as string | null, iban_masked: maskIban(sub.iban as string | null),
    },
    project: { id: prj.id, code: prj.code, name: prj.name, location: prj.location, region: prj.region, manager_name: prj.manager_name, cost_centre: prj.code },
    client, company: { name: getSetting("company_name"), address: getSetting("company_address"), trn: getSetting("company_trn") },
    assignment: { id: asg.id, code: asg.code, scope: asg.scope, contract_value: asg.contract_value, payment_terms: asg.payment_terms, payment_days: asg.payment_days, retention_pct: asg.retention_pct, advance_pct: asg.advance_pct, quantity: asg.quantity, quantity_unit: asg.quantity_unit, status: asg.status, stage_id: asg.stage_id },
    stages, progress, statement, attachments, approval, paymentApproval, trail, people, activity, kpis, certifiedState,
  };
}

function hashFile(stored: string): string | null {
  try { return crypto.createHash("sha256").update(fs.readFileSync(path.join(UPLOAD_DIR, path.basename(stored)))).digest("hex"); } catch { return null; }
}

/** Minimal header used by list pages and breadcrumbs. */
export function getInvoiceHeader(id: number): { id: number; invoice_no: string | null; project_id: number } | undefined {
  return getDb().prepare("SELECT id, invoice_no, project_id FROM sub_invoices WHERE id = ?").get(id) as { id: number; invoice_no: string | null; project_id: number } | undefined;
}
