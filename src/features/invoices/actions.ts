"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { syncInvoiceCost } from "@/lib/metrics";
import { todayISO } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/types";
import { requireAnyPermission, requirePermission } from "@/lib/auth";
import { hasOpenRequest, submitForApproval, withdrawOpenRequest } from "@/lib/approvals/engine";
import { guard, type ActionResult as FormResult } from "@/lib/action-result";
import { DEFAULT_VAT_RATE, fromGross } from "./calc";
import { applyCertificationToLines } from "./lines";

interface InvRow {
  id: number; status: InvoiceStatus; project_id: number; claimed_amount: number; certified_amount: number; net_payable: number;
  invoice_no: string | null; retention_pct: number; advance_pct: number; subcontractor_id: number; vat_rate: number;
}

function load(form: FormData): InvRow {
  const id = Number(form.get("id"));
  const r = getDb().prepare(`SELECT i.*, a.retention_pct, a.advance_pct, a.subcontractor_id FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id WHERE i.id = ?`).get(id) as InvRow | undefined;
  if (!r) throw new Error("Invoice not found");
  return r;
}

async function done(inv: InvRow, action: string, message: string) {
  syncInvoiceCost(inv.id);
  await logActivity("invoice", inv.id, action, message);
  revalidatePath("/invoices"); revalidatePath("/"); revalidatePath(`/projects/${inv.project_id}`);
  revalidatePath(`/subcontractors/${inv.subcontractor_id}`); revalidatePath(`/invoices/${inv.id}`); revalidatePath("/", "layout");
}
const label = (i: InvRow) => i.invoice_no ?? `#${i.id}`;

export async function startInvoiceReview(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const reviewer = await requirePermission("invoices", "certify");
    const inv = load(form);
    if (inv.status !== "submitted") throw new Error("Only submitted invoices can be put under review");
    getDb().prepare("UPDATE sub_invoices SET status='under_review', reviewed_by=? WHERE id=?").run(reviewer.id || null, inv.id);
    await done(inv, "review", `Invoice ${label(inv)} under review`);
  });
}

export async function certifyInvoice(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const user = await requirePermission("invoices", "certify");
    const inv = load(form);
    if (inv.status !== "submitted" && inv.status !== "under_review") throw new Error("Invoice cannot be certified in its current status");
    const certified = Number(form.get("certified_amount"));
    if (!Number.isFinite(certified) || certified < 0) throw new Error("Certified amount is invalid");
    const retention = certified * (inv.retention_pct || 0) / 100;
    const advance = certified * (inv.advance_pct || 0) / 100;
    const net = certified - retention - advance;
    getDb().transaction(() => {
      withdrawOpenRequest("sub_invoice", inv.id, user.id);
      getDb().prepare("UPDATE sub_invoices SET status='certified', certified_amount=?, retention_amount=?, advance_recovery=?, net_payable=?, certified_by=?, certified_at=? WHERE id=?")
        .run(certified, retention, advance, net, user.id || null, new Date().toISOString(), inv.id);
      applyCertificationToLines(getDb(), inv.id, fromGross(certified, inv.vat_rate || DEFAULT_VAT_RATE).subtotal);
      // Certification raises the multi-level sub_invoice approval (approved + cost posted on final approval).
      submitForApproval("sub_invoice", inv.id, { userId: user.id });
    })();
    await done(inv, "certify", `Invoice ${label(inv)} certified at ${certified.toFixed(2)} (net payable ${net.toFixed(2)})`);
  });
}

export async function approveInvoice(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const user = await requirePermission("invoices", "approve");
    const inv = load(form);
    if (inv.status !== "certified") throw new Error("Only certified invoices can be approved");
    if (hasOpenRequest("sub_invoice", inv.id)) throw new Error("Invoice approval is already pending");
    submitForApproval("sub_invoice", inv.id, { userId: user.id });
    await done(inv, "approval", `Invoice ${label(inv)} submitted for approval`);
  });
}

export async function payInvoice(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const user = await requirePermission("invoices", "pay");
    const inv = load(form);
    if (inv.status !== "approved") throw new Error("Only approved invoices can be paid");
    const amount = form.get("paid_amount") ? Number(form.get("paid_amount")) : inv.net_payable;
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Paid amount is invalid");
    const date = String(form.get("paid_date") ?? "").trim() || todayISO();
    if (hasOpenRequest("invoice_payment", inv.id)) throw new Error("Payment approval is already pending");
    submitForApproval("invoice_payment", inv.id, { userId: user.id, payload: { paid_amount: amount, paid_date: date, payment_method: String(form.get("payment_method") ?? "").trim() || "Bank transfer", payment_ref: String(form.get("payment_ref") ?? "").trim() || null } });
    await done(inv, "approval", `Payment of invoice ${label(inv)} (${amount.toFixed(2)} on ${date}) submitted for approval`);
  });
}

export async function rejectInvoice(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const user = await requireAnyPermission("invoices", ["certify", "approve"]);
    const inv = load(form);
    if (inv.status === "paid" || inv.status === "rejected") throw new Error("Invoice cannot be rejected in its current status");
    const reason = String(form.get("reason") ?? "").trim();
    getDb().transaction(() => {
      withdrawOpenRequest("sub_invoice", inv.id, user.id); withdrawOpenRequest("invoice_payment", inv.id, user.id);
      getDb().prepare("UPDATE sub_invoices SET status='rejected', notes = CASE WHEN ? <> '' THEN ? ELSE notes END WHERE id=?").run(reason, reason ? `Rejected: ${reason}` : "", inv.id);
    })();
    await done(inv, "reject", `Invoice ${label(inv)} rejected${reason ? `: ${reason}` : ""}`);
  });
}
