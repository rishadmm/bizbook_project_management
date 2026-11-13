"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { saveUpload, saveUploadsFromForm } from "@/lib/files";
import { todayISO } from "@/lib/format";
import { ENUMS } from "@/lib/status";
import { resolvePortal } from "./queries";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => { const n = Number(str(f, k)); return Number.isFinite(n) ? n : 0; };
const MAX_FILE = 15 * 1024 * 1024;

class PortalError extends Error {}

function checkFiles(form: FormData, field: string) {
  for (const f of form.getAll(field)) if (f instanceof File && f.size > MAX_FILE) throw new PortalError("Files must be smaller than 15 MB");
}
function validDate(s: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new PortalError(`${label} is required`);
  return s;
}

/** Wraps a portal handler: token is re-validated on every call; errors come back as ?error= on the portal page. */
async function run(form: FormData, ok: string, fn: (ctx: NonNullable<ReturnType<typeof resolvePortal>>) => Promise<void>): Promise<never> {
  const token = str(form, "token");
  let url = `/portal/${encodeURIComponent(token)}`;
  try {
    const ctx = resolvePortal(token);
    if (!ctx) throw new PortalError("This link is no longer valid");
    await fn(ctx);
    revalidatePath(`/portal/${token}`);
    revalidatePath("/"); revalidatePath(`/projects/${ctx.project.id}`); revalidatePath("/invoices");
    url += `?sent=${ok}`;
  } catch (e) {
    url += `?error=${encodeURIComponent(e instanceof PortalError ? e.message : "Could not save your submission. Please try again.")}`;
    if (!(e instanceof PortalError)) console.error("portal action failed", e);
  }
  redirect(url);
}

export async function submitProgressReport(form: FormData): Promise<void> {
  await run(form, "progress", async ({ assignment: a, project }) => {
    checkFiles(form, "photos");
    const date = validDate(str(form, "report_date"), "Report date");
    const qty = num(form, "quantity_done");
    if (qty < 0) throw new PortalError("Quantity cannot be negative");
    const delayDays = num(form, "delay_days");
    if (delayDays < 0) throw new PortalError("Delay days cannot be negative");
    const resp = str(form, "delay_responsibility") || "none";
    if (!Object.keys(ENUMS.responsibility).includes(resp)) throw new PortalError("Invalid delay responsibility");
    const trades = form.getAll("mp_trade").map(String), heads = form.getAll("mp_count").map(Number), hours = form.getAll("mp_hours").map(Number);
    const mats = form.getAll("mat_name").map(String), mUnit = form.getAll("mat_unit").map(String), mQty = form.getAll("mat_qty").map(Number);
    const db = getDb();
    const prior = (db.prepare("SELECT COALESCE(SUM(quantity_done),0) q FROM progress_reports WHERE assignment_id = ? AND status <> 'rejected'").get(a.id) as { q: number }).q;
    const cum = prior + qty;
    const percent = a.quantity && a.quantity > 0 ? Math.min(100, (cum / a.quantity) * 100) : 0;
    const mp = trades.map((t, i) => ({ trade: t.trim(), headcount: Math.max(0, Math.round(heads[i] || 0)), hours: Math.max(0, hours[i] || 0) })).filter((x) => x.trade && (x.headcount || x.hours));
    const reportId = db.transaction(() => {
      const r = db.prepare(`INSERT INTO progress_reports(assignment_id, stage_id, project_id, report_date, quantity_done, cumulative_quantity, percent_complete,
        manpower_count, man_hours, equipment_used, work_done, issues, delay_days, delay_cause, delay_responsibility, source, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'portal','submitted')`).run(a.id, a.stage_id, project.id, date, qty, cum, percent,
        mp.reduce((s, x) => s + x.headcount, 0), mp.reduce((s, x) => s + x.hours, 0), str(form, "equipment_used") || null, str(form, "work_done") || null,
        str(form, "issues") || null, delayDays, str(form, "delay_cause") || null, delayDays > 0 ? resp : "none");
      const id = Number(r.lastInsertRowid);
      const im = db.prepare("INSERT INTO progress_manpower(progress_report_id, trade, headcount, hours) VALUES (?,?,?,?)");
      mp.forEach((x) => im.run(id, x.trade, x.headcount, x.hours));
      const ii = db.prepare("INSERT INTO progress_materials(progress_report_id, material, unit, quantity, unit_cost) VALUES (?,?,?,?,0)");
      mats.forEach((m, i) => { if (m.trim() && (mQty[i] || 0) > 0) ii.run(id, m.trim(), (mUnit[i] ?? "").trim() || null, mQty[i]); });
      return id;
    })();
    await saveUploadsFromForm(form, "photos", "progress", reportId, "Photos", { uploadedBy: null });
    await logActivity("progress", reportId, "submitted", `Progress report submitted via portal for ${a.code ?? "assignment"} (${qty} this period)`, null);
    await logActivity("assignment", a.id, "portal", `Portal progress report ${date}`, null);
  });
}

export async function submitPortalInvoice(form: FormData): Promise<void> {
  await run(form, "invoice", async ({ assignment: a, project }) => {
    checkFiles(form, "file");
    const no = str(form, "invoice_no");
    if (!no) throw new PortalError("Invoice number is required");
    const amount = num(form, "claimed_amount");
    if (amount <= 0) throw new PortalError("Claimed amount must be greater than zero");
    const date = validDate(str(form, "invoice_date") || todayISO(), "Invoice date");
    const db = getDb();
    const r = db.prepare(`INSERT INTO sub_invoices(assignment_id, project_id, invoice_no, invoice_date, period_from, period_to, claimed_amount, claimed_percent, status, source, notes)
      VALUES (?,?,?,?,?,?,?,?,'submitted','portal',?)`).run(a.id, project.id, no, date, str(form, "period_from") || null, str(form, "period_to") || null,
      amount, num(form, "claimed_percent"), str(form, "notes") || null);
    const id = Number(r.lastInsertRowid);
    const file = form.get("file");
    if (file instanceof File && file.size > 0) await saveUpload(file, "invoice", id, "Invoice", { uploadedBy: null });
    await logActivity("invoice", id, "submitted", `Invoice ${no} submitted via portal (${amount.toFixed(2)})`, null);
  });
}

export async function requestPortalCertificate(form: FormData): Promise<void> {
  await run(form, "certificate", async ({ assignment: a, project }) => {
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
    await logActivity("certificate", id, "requested", `${type} completion certificate requested via portal (${percent}%)`, null);
  });
}
