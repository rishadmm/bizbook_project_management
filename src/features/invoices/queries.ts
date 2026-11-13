import { getDb } from "@/lib/db";
import type { InvoiceStatus, SubInvoice } from "@/lib/types";

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
  const att = db.prepare("SELECT id, filename FROM attachments WHERE entity_type='invoice' AND entity_id = ? ORDER BY id");
  return rows.map((r) => ({ ...r, files: att.all(r.id) as { id: number; filename: string }[] }));
}

export function invoiceTotals(): Record<InvoiceStatus, { count: number; amount: number }> {
  const out = {} as Record<InvoiceStatus, { count: number; amount: number }>;
  for (const s of ["submitted", "under_review", "certified", "approved", "paid", "rejected"] as InvoiceStatus[]) out[s] = { count: 0, amount: 0 };
  const rows = getDb().prepare("SELECT status, COUNT(*) c, COALESCE(SUM(CASE WHEN status IN ('submitted','under_review','rejected') THEN claimed_amount WHEN status='paid' THEN paid_amount ELSE certified_amount END),0) a FROM sub_invoices GROUP BY status").all() as { status: InvoiceStatus; c: number; a: number }[];
  for (const r of rows) if (out[r.status]) out[r.status] = { count: r.c, amount: r.a };
  return out;
}
