// Portal read models. EVERY function takes the portal session and filters by the session's company (subcontractor_id) and the user's assignment scope.
// Ids coming from the URL are only ever used together with these filters: unknown / foreign ids simply return null (-> 404).
import { getDb } from "@/lib/db";
import { addDays, todayISO } from "@/lib/format";
import { portalCan, type PortalPerm } from "@/lib/portal-core";
import { idList, visibleAssignmentIds, type PortalSession } from "@/lib/portal-auth";
import { ENUMS } from "@/lib/status";
import { docWarning } from "@/features/subcontractors/queries";
import type { Assignment, CompletionCertificate, ProgressReport, SubInvoice } from "@/lib/types";

export type PortalAsg = Assignment & { project_code: string; project_name: string; stage_code: string | null; stage_name: string | null; project_status: string; /** supplier tender the subcontract was awarded through (source = tender) */ tender_code: string | null };

const ASG_SQL = `SELECT a.*, p.code AS project_code, p.name AS project_name, p.status AS project_status, st.code AS stage_code, st.name AS stage_name, (SELECT t.code FROM rfx_tenders t WHERE t.id = a.rfx_id) AS tender_code
  FROM assignments a JOIN projects p ON p.id = a.project_id LEFT JOIN stages st ON st.id = a.stage_id`;

export function listAssignments(s: PortalSession): PortalAsg[] {
  const ids = visibleAssignmentIds(s);
  return getDb().prepare(`${ASG_SQL} WHERE a.subcontractor_id = ? AND a.id IN (${idList(ids)}) ORDER BY (a.status = 'active') DESC, a.id DESC`).all(s.sub.id) as PortalAsg[];
}
/** One of the company's visible subcontracts, or null (foreign / hidden ids behave as "not found"). */
export function getAssignment(s: PortalSession, id: number): PortalAsg | null {
  if (!Number.isInteger(id) || !visibleAssignmentIds(s).includes(id)) return null;
  return (getDb().prepare(`${ASG_SQL} WHERE a.id = ? AND a.subcontractor_id = ?`).get(id, s.sub.id) as PortalAsg | undefined) ?? null;
}
const WORKABLE = ["active"];
export const canWorkOn = (a: Pick<Assignment, "status">) => WORKABLE.includes(a.status);

/* ------------------------------------------------------------------ progress reports */
export type PortalReport = ProgressReport & { assignment_code: string | null; project_code: string; unit: string | null };
export function listReports(s: PortalSession, assignmentId?: number): PortalReport[] {
  const ids = assignmentId ? visibleAssignmentIds(s).filter((i) => i === assignmentId) : visibleAssignmentIds(s);
  return getDb().prepare(`SELECT r.*, a.code AS assignment_code, p.code AS project_code, a.quantity_unit AS unit FROM progress_reports r
    JOIN assignments a ON a.id = r.assignment_id JOIN projects p ON p.id = r.project_id
    WHERE a.subcontractor_id = ? AND r.assignment_id IN (${idList(ids)}) ORDER BY r.report_date DESC, r.id DESC LIMIT 300`).all(s.sub.id) as PortalReport[];
}
export function getReport(s: PortalSession, id: number): PortalReport | null {
  if (!Number.isInteger(id)) return null;
  const r = getDb().prepare(`SELECT r.*, a.code AS assignment_code, p.code AS project_code, a.quantity_unit AS unit FROM progress_reports r
    JOIN assignments a ON a.id = r.assignment_id JOIN projects p ON p.id = r.project_id WHERE r.id = ? AND a.subcontractor_id = ?`).get(id, s.sub.id) as PortalReport | undefined;
  return r && visibleAssignmentIds(s).includes(r.assignment_id!) ? r : null;
}

/* ------------------------------------------------------------------ invoices / certificates */
export type PortalInvoice = SubInvoice & { assignment_code: string | null; project_code: string; project_name: string };
export function listInvoices(s: PortalSession, assignmentId?: number): PortalInvoice[] {
  const ids = assignmentId ? visibleAssignmentIds(s).filter((i) => i === assignmentId) : visibleAssignmentIds(s);
  return getDb().prepare(`SELECT i.*, a.code AS assignment_code, p.code AS project_code, p.name AS project_name FROM sub_invoices i
    JOIN assignments a ON a.id = i.assignment_id JOIN projects p ON p.id = i.project_id
    WHERE a.subcontractor_id = ? AND i.assignment_id IN (${idList(ids)}) ORDER BY i.invoice_date DESC, i.id DESC`).all(s.sub.id) as PortalInvoice[];
}
/** Invoice id of THIS company (and visible assignment) or null. */
export function ownedInvoiceId(s: PortalSession, id: number): number | null {
  if (!Number.isInteger(id)) return null;
  const r = getDb().prepare("SELECT i.id, i.assignment_id FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id WHERE i.id = ? AND a.subcontractor_id = ?").get(id, s.sub.id) as { id: number; assignment_id: number } | undefined;
  return r && visibleAssignmentIds(s).includes(r.assignment_id) ? r.id : null;
}
export type PortalCert = CompletionCertificate & { assignment_code: string | null; project_code: string; project_name: string };
export function listCertificates(s: PortalSession, assignmentId?: number): PortalCert[] {
  const ids = assignmentId ? visibleAssignmentIds(s).filter((i) => i === assignmentId) : visibleAssignmentIds(s);
  return getDb().prepare(`SELECT c.*, a.code AS assignment_code, p.code AS project_code, p.name AS project_name FROM completion_certificates c
    JOIN assignments a ON a.id = c.assignment_id JOIN projects p ON p.id = c.project_id
    WHERE a.subcontractor_id = ? AND c.assignment_id IN (${idList(ids)}) AND c.status <> 'draft' ORDER BY c.cert_date DESC, c.id DESC`).all(s.sub.id) as PortalCert[];
}
export function getCertificate(s: PortalSession, id: number): PortalCert | null {
  return listCertificates(s).find((c) => c.id === id) ?? null;
}

/* ------------------------------------------------------------------ statement */
export interface StatementRow {
  assignmentId: number; code: string | null; project: string; contractValue: number; claimed: number; certified: number; retention: number; advance: number; netPayable: number; paid: number; outstanding: number;
}
const CERT = "('certified','approved','paid')";
/** Statement of account per subcontract: claimed -> certified -> less retention / advance recovery -> net payable -> paid -> outstanding. */
export function getStatement(s: PortalSession, assignmentId?: number): StatementRow[] {
  const asgs = listAssignments(s).filter((a) => !assignmentId || a.id === assignmentId);
  const q = getDb().prepare(`SELECT COALESCE(SUM(CASE WHEN status <> 'rejected' THEN claimed_amount ELSE 0 END),0) claimed,
      COALESCE(SUM(CASE WHEN status IN ${CERT} THEN certified_amount ELSE 0 END),0) certified,
      COALESCE(SUM(CASE WHEN status IN ${CERT} THEN retention_amount ELSE 0 END),0) retention,
      COALESCE(SUM(CASE WHEN status IN ${CERT} THEN advance_recovery ELSE 0 END),0) advance,
      COALESCE(SUM(CASE WHEN status IN ${CERT} THEN net_payable ELSE 0 END),0) net, COALESCE(SUM(paid_amount),0) paid
    FROM sub_invoices WHERE assignment_id = ?`);
  return asgs.map((a) => {
    const r = q.get(a.id) as { claimed: number; certified: number; retention: number; advance: number; net: number; paid: number };
    return { assignmentId: a.id, code: a.code, project: `${a.project_code} · ${a.project_name}`, contractValue: a.contract_value, claimed: r.claimed, certified: r.certified, retention: r.retention,
      advance: r.advance, netPayable: r.net, paid: r.paid, outstanding: Math.max(0, r.net - r.paid) };
  });
}
export interface PaymentRow { invoiceId: number; invoiceNo: string | null; ref: string | null; assignmentCode: string | null; date: string | null; amount: number; method: string | null; paymentRef: string | null }
export function getPayments(s: PortalSession, assignmentId?: number): PaymentRow[] {
  return listInvoices(s, assignmentId).filter((i) => i.paid_amount > 0).map((i) => ({
    invoiceId: i.id, invoiceNo: i.invoice_no, ref: i.sub_invoice_ref, assignmentCode: i.assignment_code, date: i.paid_date, amount: i.paid_amount, method: i.payment_method, paymentRef: i.payment_ref,
  })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/* ------------------------------------------------------------------ documents */
export interface PortalDoc { doc_type_code?: string | null; version?: number; review_status?: string; review_comment?: string | null; id: number; doc_type: string; ref_no: string | null; issue_date: string | null; expiry_date: string | null; status: string; attachment_id: number | null; filename: string | null; source: string; uploaded_by_name: string | null; review_note: string | null; created_at: string }
export function listCompanyDocuments(s: PortalSession): PortalDoc[] {
  return getDb().prepare(`SELECT d.*, a.filename FROM subcontractor_documents d LEFT JOIN attachments a ON a.id = d.attachment_id
    WHERE d.subcontractor_id = ? AND d.is_current = 1 ORDER BY d.expiry_date IS NULL, d.expiry_date`).all(s.sub.id) as PortalDoc[];
}
/** Documents shared with the subcontractor: attachments of its subcontracts and the drawings of the stages it works on. */
export interface SharedDoc { id: number; filename: string; category: string | null; mime: string | null; size: number | null; created_at: string; source: string; context: string }
export function listSharedDocuments(s: PortalSession, assignmentId?: number): SharedDoc[] {
  const ids = assignmentId ? visibleAssignmentIds(s).filter((i) => i === assignmentId) : visibleAssignmentIds(s);
  const db = getDb();
  const asg = db.prepare(`SELECT a.id, a.code, a.stage_id FROM assignments a WHERE a.subcontractor_id = ? AND a.id IN (${idList(ids)})`).all(s.sub.id) as { id: number; code: string | null; stage_id: number | null }[];
  const out: SharedDoc[] = [];
  const seen = new Set<number>();
  for (const a of asg) {
    for (const r of db.prepare("SELECT id, filename, category, mime, size, created_at FROM attachments WHERE entity_type = 'assignment' AND entity_id = ? ORDER BY id DESC").all(a.id) as Omit<SharedDoc, "source" | "context">[])
      if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, source: "Subcontract", context: a.code ?? `#${a.id}` }); }
    if (a.stage_id) for (const r of db.prepare("SELECT id, filename, category, mime, size, created_at FROM attachments WHERE entity_type = 'stage' AND entity_id = ? AND category = 'Drawings' ORDER BY id DESC").all(a.stage_id) as Omit<SharedDoc, "source" | "context">[])
      if (!seen.has(r.id)) { seen.add(r.id); out.push({ ...r, source: "Stage drawings", context: a.code ?? `#${a.id}` }); }
  }
  return out;
}

/* ------------------------------------------------------------------ issues */
export interface PortalIssue {
  id: number; title: string; description: string | null; status: string; responsibility: string | null; impact_days: number; kind: string; category: string | null; source: string; raised_on: string | null;
  raised_by_name: string | null; awaiting_party: string | null; assignment_id: number | null; assignment_code: string | null; project_code: string; last_activity_at: string | null;
}
export function listIssues(s: PortalSession, assignmentId?: number): PortalIssue[] {
  const ids = assignmentId ? visibleAssignmentIds(s).filter((i) => i === assignmentId) : visibleAssignmentIds(s);
  return getDb().prepare(`SELECT i.*, a.code AS assignment_code, p.code AS project_code FROM issues i JOIN assignments a ON a.id = i.assignment_id JOIN projects p ON p.id = i.project_id
    WHERE a.subcontractor_id = ? AND i.assignment_id IN (${idList(ids)}) ORDER BY (i.status = 'closed'), COALESCE(i.last_activity_at, i.raised_on) DESC, i.id DESC`).all(s.sub.id) as PortalIssue[];
}
export function getIssue(s: PortalSession, id: number): PortalIssue | null {
  return listIssues(s).find((i) => i.id === id) ?? null;
}
export interface CommentRow { id: number; author_type: string; author_name: string; body: string; created_at: string }
export function getIssueComments(issueId: number): CommentRow[] {
  return getDb().prepare("SELECT id, author_type, author_name, body, created_at FROM issue_comments WHERE issue_id = ? ORDER BY id").all(issueId) as CommentRow[];
}

/* ------------------------------------------------------------------ action items + notifications */
export interface ActionItem { key: string; type: "report_due" | "report_rejected" | "invoice_returned" | "doc_expiry" | "issue_response"; title: string; detail: string; href: string }
const has = (s: PortalSession, p: PortalPerm) => portalCan(s.user.role, p);

export function getActionItems(s: PortalSession): ActionItem[] {
  const db = getDb();
  const slug = s.sub.portal_slug ?? "";
  const base = `/p/${slug}`;
  const today = todayISO();
  const items: ActionItem[] = [];
  const ids = visibleAssignmentIds(s);
  const asgs = listAssignments(s);
  if (has(s, "progress")) {
    for (const a of asgs.filter((x) => x.status === "active")) {
      const last = (db.prepare("SELECT MAX(report_date) d FROM progress_reports WHERE assignment_id = ? AND status <> 'rejected'").get(a.id) as { d: string | null }).d;
      const since = last ?? a.start_date;
      if (since && since <= addDays(today, -7)) items.push({ key: `due-${a.id}`, type: "report_due", title: `Progress report due - ${a.code ?? `#${a.id}`}`, detail: last ? `No report since ${last}` : "No report submitted yet", href: `${base}/progress/new?assignment=${a.id}` });
    }
    for (const r of db.prepare(`SELECT r.id, r.report_date, r.reject_reason, a.code FROM progress_reports r JOIN assignments a ON a.id = r.assignment_id WHERE r.status = 'rejected' AND r.assignment_id IN (${idList(ids)}) AND a.subcontractor_id = ? ORDER BY r.report_date DESC`).all(s.sub.id) as { id: number; report_date: string; reject_reason: string | null; code: string | null }[])
      items.push({ key: `rej-${r.id}`, type: "report_rejected", title: `Resubmit progress report ${r.report_date}`, detail: `${r.code ?? ""} - ${r.reject_reason ?? "Rejected by the project team"}`, href: `${base}/progress/${r.id}` });
  }
  if (has(s, "invoices")) {
    for (const i of db.prepare(`SELECT i.id, i.invoice_no, i.sub_invoice_ref, i.notes FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id WHERE i.status = 'rejected' AND i.assignment_id IN (${idList(ids)}) AND a.subcontractor_id = ? ORDER BY i.id DESC`).all(s.sub.id) as { id: number; invoice_no: string | null; sub_invoice_ref: string | null; notes: string | null }[])
      items.push({ key: `inv-${i.id}`, type: "invoice_returned", title: `Invoice ${i.invoice_no ?? `#${i.id}`} was rejected`, detail: (i.notes?.split("\n").find((l) => l.startsWith("Rejected:")) ?? "Review the remarks and submit a corrected invoice").slice(0, 140), href: `${base}/invoices/${i.id}` });
  }
  if (has(s, "documents")) {
    const docs = listCompanyDocuments(s);
    for (const d of docs) {
      const w = docWarning(d.expiry_date, d.status);
      if (!w || d.status === "pending_review") continue;
      // superseded by a newer upload of the same type that is valid or waiting for review
      if (docs.some((o) => o.id !== d.id && o.doc_type === d.doc_type && o.status !== "rejected" && (o.expiry_date ?? "") > (d.expiry_date ?? "") && (o.status === "pending_review" || !docWarning(o.expiry_date, o.status)))) continue;
      items.push({ key: `doc-${d.id}`, type: "doc_expiry", title: `${ENUMS.docType[d.doc_type as keyof typeof ENUMS.docType]?.label ?? d.doc_type.replace(/_/g, " ")} ${w === "expired" ? "has expired" : "expires soon"}`, detail: `Expiry ${d.expiry_date}`, href: `${base}/documents` });
    }
  }
  if (has(s, "issues")) {
    for (const i of db.prepare(`SELECT i.id, i.title FROM issues i JOIN assignments a ON a.id = i.assignment_id WHERE i.awaiting_party = 'portal' AND i.status <> 'closed' AND i.assignment_id IN (${idList(ids)}) AND a.subcontractor_id = ?`).all(s.sub.id) as { id: number; title: string }[])
      items.push({ key: `iss-${i.id}`, type: "issue_response", title: "Response requested", detail: i.title, href: `${base}/issues/${i.id}` });
  }
  return items;
}

export interface RecentEvent { key: string; date: string; text: string; href: string; tone: "green" | "red" | "amber" | "blue" }
/** Verifications, certifications, payments and decisions on the company's submissions (newest first). */
export function getRecentEvents(s: PortalSession, limit = 8): RecentEvent[] {
  const db = getDb();
  const base = `/p/${s.sub.portal_slug}`;
  const ids = idList(visibleAssignmentIds(s));
  const ev: RecentEvent[] = [];
  for (const r of db.prepare(`SELECT r.id, r.status, r.report_date, r.verified_at, a.code FROM progress_reports r JOIN assignments a ON a.id = r.assignment_id WHERE r.assignment_id IN (${ids}) AND a.subcontractor_id = ? AND r.verified_at IS NOT NULL ORDER BY r.verified_at DESC LIMIT 10`).all(s.sub.id) as { id: number; status: string; report_date: string; verified_at: string; code: string | null }[])
    ev.push({ key: `r${r.id}`, date: r.verified_at, text: `Progress report ${r.report_date} (${r.code ?? ""}) ${r.status}`, href: `${base}/progress/${r.id}`, tone: r.status === "verified" ? "green" : "red" });
  for (const i of db.prepare(`SELECT i.id, i.invoice_no, i.status, i.certified_at, i.paid_date, i.paid_amount FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id WHERE i.assignment_id IN (${ids}) AND a.subcontractor_id = ? ORDER BY i.id DESC LIMIT 40`).all(s.sub.id) as { id: number; invoice_no: string | null; status: string; certified_at: string | null; paid_date: string | null; paid_amount: number }[]) {
    if (i.certified_at) ev.push({ key: `c${i.id}`, date: i.certified_at, text: `Invoice ${i.invoice_no} certified`, href: `${base}/invoices/${i.id}`, tone: "blue" });
    if (i.paid_date && i.paid_amount > 0) ev.push({ key: `p${i.id}`, date: i.paid_date, text: `Payment received for invoice ${i.invoice_no}`, href: `${base}/payments`, tone: "green" });
  }
  for (const c of db.prepare(`SELECT c.id, c.cert_no, c.cert_date, c.cert_type FROM completion_certificates c JOIN assignments a ON a.id = c.assignment_id WHERE c.assignment_id IN (${ids}) AND a.subcontractor_id = ? AND c.status = 'issued' AND c.cert_date IS NOT NULL ORDER BY c.cert_date DESC LIMIT 10`).all(s.sub.id) as { id: number; cert_no: string | null; cert_date: string; cert_type: string }[])
    ev.push({ key: `k${c.id}`, date: c.cert_date, text: `${c.cert_type} completion certificate ${c.cert_no ?? ""} issued`, href: `${base}/certificates/${c.id}`, tone: "green" });
  return ev.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
