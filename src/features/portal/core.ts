// Shared write logic of the subcontractor portal (legacy token page AND the login portal). No auth here: callers resolve the company/assignment first.
import { getDb, getSetting } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { saveUpload, saveUploadsFromForm } from "@/lib/files";
import { todayISO } from "@/lib/format";
import { ENUMS } from "@/lib/status";
import { PortalError } from "@/lib/portal-auth";
import { DEFAULT_VAT_RATE, fromSubtotal } from "@/features/invoices/calc";
import { dueDate, getAssignmentBoq, insertInvoiceLines, parseInvoiceLines, previousCertified } from "@/features/invoices/lines";
import { readInvoiceUploads, saveInvoiceUploads } from "@/features/invoices/attachments";
import type { Assignment, Project } from "@/lib/types";

export { PortalError };
export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const num = (f: FormData, k: string) => { const n = Number(str(f, k)); return Number.isFinite(n) ? n : 0; };
const MAX_FILE = 15 * 1024 * 1024;

export function checkFiles(form: FormData, field: string) {
  for (const f of form.getAll(field)) if (f instanceof File && f.size > MAX_FILE) throw new PortalError("Files must be smaller than 15 MB");
}
export function validDate(s: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new PortalError(`${label} is required`);
  return s;
}

export interface Who { name: string; email?: string | null; userId?: number | null }

/**
 * Inserts (or, for a rejected report, corrects and resubmits) a progress report as source `portal`. Returns the report id.
 * `guardQty` (login portal) refuses a cumulative quantity above the subcontract quantity.
 */
export async function saveProgressReport(form: FormData, a: Assignment, project: Project, who: Who, opts: { guardQty?: boolean; resubmitId?: number } = {}): Promise<number> {
  checkFiles(form, "photos");
  const date = validDate(str(form, "report_date"), "Report date");
  if (date > todayISO()) throw new PortalError("The report date cannot be in the future");
  const qty = num(form, "quantity_done");
  if (qty < 0) throw new PortalError("Quantity cannot be negative");
  const delayDays = num(form, "delay_days");
  if (delayDays < 0) throw new PortalError("Delay days cannot be negative");
  const resp = str(form, "delay_responsibility") || "none";
  if (!Object.keys(ENUMS.responsibility).includes(resp)) throw new PortalError("Invalid delay responsibility");
  const trades = form.getAll("mp_trade").map(String), heads = form.getAll("mp_count").map(Number), hours = form.getAll("mp_hours").map(Number);
  const mats = form.getAll("mat_name").map(String), mUnit = form.getAll("mat_unit").map(String), mQty = form.getAll("mat_qty").map(Number);
  const eqName = form.getAll("eq_name").map(String), eqQty = form.getAll("eq_qty").map(Number);
  const db = getDb();
  const resubmit = opts.resubmitId
    ? (db.prepare("SELECT id, status FROM progress_reports WHERE id = ? AND assignment_id = ?").get(opts.resubmitId, a.id) as { id: number; status: string } | undefined)
    : undefined;
  if (opts.resubmitId && (!resubmit || resubmit.status !== "rejected")) throw new PortalError("Only a rejected report can be corrected and resubmitted");
  const prior = (db.prepare("SELECT COALESCE(SUM(quantity_done),0) q FROM progress_reports WHERE assignment_id = ? AND status <> 'rejected' AND id <> ?").get(a.id, resubmit?.id ?? 0) as { q: number }).q;
  const cum = prior + qty;
  if (opts.guardQty && a.quantity && a.quantity > 0 && cum > a.quantity * 1.0001) {
    throw new PortalError(`Cumulative quantity ${Math.round(cum * 100) / 100} would exceed the subcontract quantity of ${a.quantity} ${a.quantity_unit ?? ""}. Already reported: ${Math.round(prior * 100) / 100}.`.replace(/\s+\./, "."));
  }
  const percent = a.quantity && a.quantity > 0 ? Math.min(100, (cum / a.quantity) * 100) : 0;
  const mp = trades.map((t, i) => ({ trade: t.trim(), headcount: Math.max(0, Math.round(heads[i] || 0)), hours: Math.max(0, hours[i] || 0) })).filter((x) => x.trade && (x.headcount || x.hours));
  const equipment = eqName.map((n, i) => (n.trim() ? `${eqQty[i] > 0 ? `${eqQty[i]} × ` : ""}${n.trim()}` : "")).filter(Boolean).join(", ") || str(form, "equipment_used") || null;
  const issuesText = str(form, "issues") || null;
  const reportId = db.transaction(() => {
    const vals = [a.stage_id, project.id, date, qty, cum, percent, mp.reduce((s, x) => s + x.headcount, 0), mp.reduce((s, x) => s + x.hours, 0), equipment, str(form, "work_done") || null,
      issuesText, delayDays, str(form, "delay_cause") || null, delayDays > 0 ? resp : "none", str(form, "weather") || null, who.name, who.userId ?? null] as const;
    let id: number;
    if (resubmit) {
      id = resubmit.id;
      db.prepare(`UPDATE progress_reports SET stage_id=?, project_id=?, report_date=?, quantity_done=?, cumulative_quantity=?, percent_complete=?, manpower_count=?, man_hours=?, equipment_used=?, work_done=?,
        issues=?, delay_days=?, delay_cause=?, delay_responsibility=?, weather=?, submitted_by_name=?, portal_user_id=?, status='submitted', reject_reason=NULL, verified_by=NULL, verified_at=NULL, resubmitted_at=? WHERE id=?`)
        .run(...vals, new Date().toISOString(), id);
      db.prepare("DELETE FROM progress_manpower WHERE progress_report_id = ?").run(id);
      db.prepare("DELETE FROM progress_materials WHERE progress_report_id = ?").run(id);
    } else {
      id = Number(db.prepare(`INSERT INTO progress_reports(assignment_id, stage_id, project_id, report_date, quantity_done, cumulative_quantity, percent_complete,
        manpower_count, man_hours, equipment_used, work_done, issues, delay_days, delay_cause, delay_responsibility, weather, submitted_by_name, portal_user_id, source, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'portal','submitted')`).run(a.id, ...vals).lastInsertRowid);
    }
    const im = db.prepare("INSERT INTO progress_manpower(progress_report_id, trade, headcount, hours) VALUES (?,?,?,?)");
    mp.forEach((x) => im.run(id, x.trade, x.headcount, x.hours));
    const ii = db.prepare("INSERT INTO progress_materials(progress_report_id, material, unit, quantity, unit_cost) VALUES (?,?,?,?,0)");
    mats.forEach((m, i) => { if (m.trim() && (mQty[i] || 0) > 0) ii.run(id, m.trim(), (mUnit[i] ?? "").trim() || null, mQty[i]); });
    // optional: raise the encountered issue as a tracked issue (visible internally, with its responsibility)
    if (!resubmit && form.get("raise_issue") === "on" && issuesText) {
      raiseIssueRow({ projectId: project.id, stageId: a.stage_id, assignmentId: a.id, title: issuesText.slice(0, 80), description: issuesText, responsibility: resp === "none" ? "subcontractor" : resp,
        impactDays: delayDays, kind: "issue", category: null, byName: who.name, byUserId: who.userId ?? null });
    }
    return id;
  })();
  await saveUploadsFromForm(form, "photos", "progress", reportId, "Photos", { uploadedBy: null });
  await logActivity("progress", reportId, resubmit ? "resubmitted" : "submitted", `Progress report ${resubmit ? "corrected and resubmitted" : "submitted"} via portal by ${who.name} for ${a.code ?? "assignment"} (${qty} this period)`, null);
  await logActivity("assignment", a.id, "portal", `Portal progress report ${date}${resubmit ? " (resubmitted)" : ""}`, null);
  return reportId;
}

export interface NewIssue { projectId: number; stageId: number | null; assignmentId: number; title: string; description: string | null; responsibility: string; impactDays: number; kind: string; category: string | null; byName: string; byUserId: number | null }
/** Inserts an issue / RFI raised from the portal (awaiting the internal team). */
export function raiseIssueRow(i: NewIssue): number {
  const now = new Date().toISOString();
  const r = getDb().prepare(`INSERT INTO issues(project_id, stage_id, assignment_id, title, description, responsibility, impact_days, impact_cost, status, raised_on, source, kind, category,
    raised_by_name, raised_by_portal_user, awaiting_party, last_activity_at) VALUES (?,?,?,?,?,?,?,0,'open',?,'portal',?,?,?,?,'internal',?)`)
    .run(i.projectId, i.stageId, i.assignmentId, i.title, i.description, i.responsibility, i.impactDays, todayISO(), i.kind, i.category, i.byName, i.byUserId, now);
  return Number(r.lastInsertRowid);
}

export async function saveInvoice(form: FormData, a: Assignment, project: Project, who: Who): Promise<number> {
  checkFiles(form, "att_file");
  const fail = (m: string): never => { throw new PortalError(m); };
  const ref = str(form, "sub_invoice_ref");
  if (!ref) fail("Your invoice number is required");
  const date = validDate(str(form, "invoice_date") || todayISO(), "Invoice date");
  const from = str(form, "period_from"), to = str(form, "period_to");
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) fail("Invalid invoice period");
  if (from && to && from > to) fail("Period end must not be before its start");
  // The subcontract BOQ is the only source of descriptions, rates and previous quantities; the sub only enters this-period quantities.
  const lines = parseInvoiceLines(form, getAssignmentBoq(a.id), { allowCustom: false, fail });
  if (lines.length === 0) fail("Enter the quantity of at least one line item");
  const uploads = readInvoiceUploads(form, { requireTaxInvoice: true, fail });
  const { subtotal, vat, gross } = fromSubtotal(lines.reduce((t, l) => t + l.amount, 0), DEFAULT_VAT_RATE);
  const db = getDb();
  const n = (db.prepare("SELECT COUNT(*) c FROM sub_invoices WHERE assignment_id = ?").get(a.id) as { c: number }).c + 1;
  const no = `${a.code ?? `SC-${a.id}`}-INV-${String(n).padStart(2, "0")}`;
  const id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO sub_invoices(assignment_id, project_id, invoice_no, invoice_date, period_from, period_to, claimed_amount, claimed_percent, status, source, notes,
        sub_invoice_ref, currency, vat_rate, subtotal, vat_amount, gross_amount, retention_percent, advance_recovery_percent, previous_certified,
        submitted_by_name, submitted_by_email, submitted_at, due_date)
      VALUES (?,?,?,?,?,?,?,?,'submitted','portal',?, ?,?,?,?,?,?,?,?,?, ?,?,?,?)`).run(
      a.id, project.id, no, date, from || null, to || null, gross, a.contract_value ? Math.round((subtotal / a.contract_value) * 1000) / 10 : 0, str(form, "notes") || null,
      ref, getSetting("currency", "AED"), DEFAULT_VAT_RATE, subtotal, vat, gross, a.retention_pct || 0, a.advance_pct || 0, previousCertified(a.id),
      who.name || null, who.email || null, new Date().toISOString(), dueDate(date, a.payment_days));
    const newId = Number(r.lastInsertRowid);
    insertInvoiceLines(db, newId, lines);
    return newId;
  })();
  await saveInvoiceUploads(id, uploads, null);
  await logActivity("invoice", id, "submitted", `Invoice ${no} (ref ${ref}) submitted via portal by ${who.name} (${gross.toFixed(2)} incl. VAT, ${lines.length} line${lines.length === 1 ? "" : "s"}, ${uploads.length} file${uploads.length === 1 ? "" : "s"})`, null);
  return id;
}

export async function saveCertificateRequest(form: FormData, a: Assignment, project: Project, who: Who): Promise<number> {
  checkFiles(form, "file");
  const type = str(form, "cert_type");
  if (!Object.keys(ENUMS.certType).includes(type)) throw new PortalError("Invalid certificate type");
  const percent = num(form, "percent");
  if (percent < 0 || percent > 100) throw new PortalError("Percent must be between 0 and 100");
  const db = getDb();
  const r = db.prepare(`INSERT INTO completion_certificates(assignment_id, project_id, stage_id, cert_type, cert_date, percent, remarks, status, source)
    VALUES (?,?,?,?,?,?,?,'requested','portal')`).run(a.id, project.id, a.stage_id, type, todayISO(), percent, str(form, "remarks") || null);
  const id = Number(r.lastInsertRowid);
  const file = form.get("file");
  if (file instanceof File && file.size > 0) await saveUpload(file, "certificate", id, "Certificate", { uploadedBy: null });
  await logActivity("certificate", id, "requested", `${type} completion certificate requested via portal by ${who.name} (${percent}%)`, null);
  return id;
}
