// Server-side helpers for invoice lines: BOQ for an assignment, parsing the line editor fields, inserting lines, certification pro-rata.
import { getDb, type DB } from "@/lib/db";
import { addDays } from "@/lib/format";
import type { SubInvoiceLine } from "@/lib/types";
import { lineAmount, r2, r3, r4, type BoqItem } from "./calc";

export interface AssignmentFacts {
  id: number; code: string | null; scope: string | null; contract_value: number; quantity: number | null; quantity_unit: string | null; unit_rate: number | null;
  stage_id: number | null; stage_code: string | null; stage_name: string | null; retention_pct: number; advance_pct: number; payment_days: number; project_id: number;
}
export function getAssignmentFacts(id: number): AssignmentFacts | undefined {
  return getDb().prepare(`SELECT a.id, a.code, a.scope, a.contract_value, a.quantity, a.quantity_unit, a.unit_rate, a.stage_id, a.retention_pct, a.advance_pct, a.payment_days, a.project_id,
    s.code AS stage_code, s.name AS stage_name FROM assignments a LEFT JOIN stages s ON s.id = a.stage_id WHERE a.id = ?`).get(id) as AssignmentFacts | undefined;
}

/** The single "whole subcontract" item used when an assignment has no previous invoice line. */
export function fallbackBoqItem(a: AssignmentFacts): BoqItem {
  const hasQty = !!a.quantity && a.quantity > 0;
  const qty = hasQty ? a.quantity! : 1;
  return {
    item_code: a.stage_code ?? "BOQ-01", description: a.scope ?? a.stage_name ?? "Subcontract works", unit: hasQty ? a.quantity_unit ?? "unit" : "lumpsum",
    contract_qty: qty, rate: r2(a.unit_rate && hasQty ? a.unit_rate : a.contract_value / qty), prev_qty: 0, stage_id: a.stage_id,
  };
}

/**
 * Bill of quantities of a subcontract = the distinct items of its earlier invoices (latest description/rate, cumulative quantity so far),
 * or one item derived from the assignment when nothing was invoiced yet. `excludeInvoiceId` leaves one invoice out (cumulative before it).
 */
export function getAssignmentBoq(assignmentId: number, excludeInvoiceId?: number): BoqItem[] {
  const a = getAssignmentFacts(assignmentId);
  if (!a) return [];
  const rows = getDb().prepare(`SELECT l.*, i.status AS inv_status FROM sub_invoice_lines l JOIN sub_invoices i ON i.id = l.invoice_id
    WHERE i.assignment_id = ? AND i.id <> ? ORDER BY i.invoice_date, i.id, l.line_no`).all(assignmentId, excludeInvoiceId ?? -1) as (SubInvoiceLine & { inv_status: string })[];
  const items = new Map<string, BoqItem>();
  for (const l of rows) {
    const key = l.item_code ?? l.description;
    const cur = items.get(key);
    const prev = (cur?.prev_qty ?? 0) + (l.inv_status === "rejected" ? 0 : l.this_qty);
    items.set(key, { item_code: key, description: l.description, unit: l.unit ?? "", contract_qty: l.contract_qty, rate: l.rate, prev_qty: r4(prev), stage_id: l.stage_id });
  }
  return items.size ? [...items.values()] : [fallbackBoqItem(a)];
}

export interface ParsedLine {
  item_code: string | null; description: string; unit: string | null; contract_qty: number; rate: number; prev_qty: number; this_qty: number; cum_qty: number; amount: number;
  remarks: string | null; stage_id: number | null;
}

/**
 * Reads the line editor fields (parallel arrays line_item_code / line_description / line_unit / line_rate / line_this_qty / line_remarks).
 * Quantities are the only trusted input for BOQ items: description, unit, rate, contract and previous quantity are taken from the BOQ.
 * Rows without a positive this-period quantity are ignored. `allowCustom` accepts extra items (internal form only).
 */
export function parseInvoiceLines(form: FormData, boq: BoqItem[], opts: { allowCustom: boolean; fail: (msg: string) => never }): ParsedLine[] {
  const g = (k: string) => form.getAll(k).map((v) => String(v ?? "").trim());
  const code = g("line_item_code"), desc = g("line_description"), unit = g("line_unit"), rate = g("line_rate"), qty = g("line_this_qty"), rem = g("line_remarks");
  const byCode = new Map(boq.map((b) => [b.item_code, b]));
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < qty.length; i++) {
    if (qty[i] === "") continue;
    const q = Number(qty[i]);
    if (!Number.isFinite(q)) opts.fail(`Quantity of line ${i + 1} is not a number`);
    if (q < 0) opts.fail(`Quantity of line ${i + 1} cannot be negative`);
    if (q === 0) continue;
    const b = byCode.get(code[i]);
    let row: ParsedLine;
    if (b) {
      if (seen.has(b.item_code)) opts.fail(`Item ${b.item_code} appears twice`);
      seen.add(b.item_code);
      row = { item_code: b.item_code, description: b.description, unit: b.unit, contract_qty: b.contract_qty, rate: b.rate, prev_qty: b.prev_qty, this_qty: r4(q), cum_qty: r4(b.prev_qty + q), amount: lineAmount(q, b.rate), remarks: rem[i] || null, stage_id: b.stage_id };
    } else {
      const rt = Number(rate[i]);
      if (!opts.allowCustom) opts.fail(`Unknown item "${code[i] || desc[i] || i + 1}"`);
      if (!desc[i]) opts.fail(`Description of line ${i + 1} is required`);
      if (!(rt > 0)) opts.fail(`Rate of line ${i + 1} must be greater than zero`);
      row = { item_code: code[i] || null, description: desc[i], unit: unit[i] || null, contract_qty: 0, rate: r2(rt), prev_qty: 0, this_qty: r4(q), cum_qty: r4(q), amount: lineAmount(q, rt), remarks: rem[i] || null, stage_id: null };
    }
    out.push(row);
  }
  return out;
}

export function insertInvoiceLines(db: DB, invoiceId: number, lines: ParsedLine[]): void {
  const ins = db.prepare(`INSERT INTO sub_invoice_lines(invoice_id, line_no, item_code, description, unit, contract_qty, rate, prev_qty, this_qty, cum_qty, amount, certified_qty, certified_amount, remarks, stage_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)`);
  lines.forEach((l, i) => ins.run(invoiceId, i + 1, l.item_code, l.description, l.unit, l.contract_qty, l.rate, l.prev_qty, l.this_qty, l.cum_qty, l.amount, l.remarks, l.stage_id));
}

/** Single fallback line for an invoice entered as a lump claim (no line editor values): amount = subtotal, quantity derived from the rate. */
export function lumpLine(a: AssignmentFacts, subtotal: number, prevQty = 0): ParsedLine {
  const b = fallbackBoqItem(a);
  const q = b.rate > 0 ? subtotal / b.rate : 0;
  return { item_code: b.item_code, description: b.description, unit: b.unit, contract_qty: b.contract_qty, rate: b.rate, prev_qty: prevQty, this_qty: q, cum_qty: prevQty + q, amount: subtotal, remarks: null, stage_id: b.stage_id };
}

/** Cumulative certified (gross) of the invoices of an assignment that precede the given date/id (all of them when omitted). */
export function previousCertified(assignmentId: number, before?: { date: string | null; id: number }): number {
  const rows = getDb().prepare("SELECT certified_amount c, invoice_date d, id FROM sub_invoices WHERE assignment_id = ? AND status IN ('certified','approved','paid')").all(assignmentId) as { c: number; d: string | null; id: number }[];
  return r2(rows.filter((r) => !before || (r.d ?? "") < (before.date ?? "") || ((r.d ?? "") === (before.date ?? "") && r.id < before.id)).reduce((s, r) => s + r.c, 0));
}

export function dueDate(invoiceDate: string, paymentDays: number): string { return addDays(invoiceDate, paymentDays || 30); }

/**
 * Certification at invoice level: spreads the certified subtotal over the lines pro rata (a line keeps its remarks). The last line absorbs the rounding.
 * Called inside the certify action's transaction; per-line overrides from the seed are replaced on re-certification.
 */
export function applyCertificationToLines(db: DB, invoiceId: number, certifiedSubtotal: number): void {
  const lines = db.prepare("SELECT id, this_qty, amount FROM sub_invoice_lines WHERE invoice_id = ? ORDER BY line_no, id").all(invoiceId) as { id: number; this_qty: number; amount: number }[];
  if (!lines.length) return;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const f = total > 0 ? certifiedSubtotal / total : 0;
  const upd = db.prepare("UPDATE sub_invoice_lines SET certified_qty = ?, certified_amount = ? WHERE id = ?");
  let left = r2(certifiedSubtotal);
  lines.forEach((l, i) => {
    const amt = i === lines.length - 1 ? left : r2(l.amount * f);
    left = r2(left - amt);
    upd.run(r3(l.this_qty * f), amt, l.id);
  });
}
