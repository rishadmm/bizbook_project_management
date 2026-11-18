// ERP-ready export of a subcontractor invoice as a BizBook AP invoice (no live integration yet). See docs/ERP_INTEGRATION.md.
import type { InvoiceDetail } from "./queries";

export const ERP_SCHEMA = "bizbook.ap_invoice.v1";

export interface ErpApInvoice {
  schema: typeof ERP_SCHEMA;
  /** Idempotency key for the push: `<source invoice id>:<version>`; version bumps whenever the invoice is re-certified or re-approved. */
  idempotencyKey: string;
  source: { system: "bizbook-project"; invoiceId: number; assignmentId: number; projectId: number; subcontractorId: number; portalSubmitted: boolean; status: string };
  header: {
    supplierCode: string; supplierName: string; supplierTrn: string | null; supplierTradeLicense: string | null;
    invoiceNo: string | null; supplierInvoiceRef: string | null; invoiceDate: string | null; dueDate: string | null; periodFrom: string | null; periodTo: string | null;
    currency: string; projectCode: string; costCentre: string; subcontractNo: string | null; narration: string | null; buyerTrn: string | null;
    /** country operation (entity) that owns the document: its legal name, code and tax label */ entityCode: string; buyerName: string; taxLabel: string;
  };
  /** reporting-currency (USD) equivalents with the rate locked at the invoice date */
  reporting: { currency: string; rate: number | null; rateDate: string | null; gross: number | null; netPayable: number | null };
  lines: { lineNo: number; itemCode: string | null; description: string; unit: string | null; accountHint: string; projectCostCode: string; stageCostCode: string | null; quantity: number; rate: number; netAmount: number; vatCode: "SR5"; vatRate: number; vatAmount: number; certifiedQuantity: number; certifiedNetAmount: number }[];
  deductions: { retention: { percent: number; amount: number; account: string }; advanceRecovery: { percent: number; amount: number; account: string } };
  totals: { subtotal: number; vatAmount: number; gross: number; certifiedGross: number; retention: number; advanceRecovery: number; netPayable: number; paid: number; outstanding: number };
  attachments: { name: string; category: string | null; mimeType: string | null; size: number | null; sha256: string | null; url: string }[];
  approvals: { document: string; level: string; approver: string; decision: string; decidedAt: string | null; comment: string | null }[];
  erp: { syncStatus: string; docNo: string | null; syncedAt: string | null; error: string | null };
}

/** Stable AP-invoice payload. Pass a detail loaded with `getInvoiceDetail(id, { hashes: true })` to include attachment sha256 values. */
export function toErpPayload(d: InvoiceDetail, opts: { baseUrl?: string } = {}): ErpApInvoice {
  const i = d.invoice;
  const base = opts.baseUrl ?? "";
  const certified = d.certifiedState;
  const stageCode = (id: number | null) => (id ? d.stages.find((s) => s.id === id)?.code ?? null : null);
  const version = 1 + d.trail.filter((t) => t.document === "Invoice" && (t.decision === "returned" || t.decision === "rejected")).length;
  return {
    schema: "bizbook.ap_invoice.v1",
    idempotencyKey: `${i.id}:${version}`,
    source: { system: "bizbook-project", invoiceId: i.id, assignmentId: i.assignment_id, projectId: i.project_id, subcontractorId: d.subcontractor.id, portalSubmitted: i.source === "portal", status: i.status },
    header: {
      supplierCode: d.subcontractor.code ?? `SUB-${d.subcontractor.id}`, supplierName: d.subcontractor.name, supplierTrn: d.subcontractor.tax_no, supplierTradeLicense: d.subcontractor.trade_license_no,
      invoiceNo: i.invoice_no, supplierInvoiceRef: i.sub_invoice_ref, invoiceDate: i.invoice_date, dueDate: i.due_date, periodFrom: i.period_from, periodTo: i.period_to,
      currency: i.currency, projectCode: d.project.code, costCentre: d.project.cost_centre, subcontractNo: d.assignment.code, narration: d.assignment.scope, buyerTrn: d.company.trn || null,
      entityCode: d.entity.code, buyerName: d.company.name, taxLabel: d.company.tax_label,
    },
    reporting: { currency: "USD", rate: i.fx_rate_usd ?? null, rateDate: i.fx_date ?? null, gross: i.claimed_amount_usd ?? null, netPayable: i.net_payable_usd ?? null },
    lines: d.lines.map((l) => ({
      lineNo: l.line_no, itemCode: l.item_code, description: l.description, unit: l.unit, accountHint: "Subcontract cost", projectCostCode: d.project.code, stageCostCode: stageCode(l.stage_id) ?? stageCode(d.assignment.stage_id),
      quantity: l.this_qty, rate: l.rate, netAmount: l.amount, vatCode: "SR5", vatRate: i.vat_rate, vatAmount: Math.round(l.amount * i.vat_rate) / 100, certifiedQuantity: certified ? l.certified_qty : 0, certifiedNetAmount: certified ? l.certified_amount : 0,
    })),
    deductions: {
      retention: { percent: i.retention_percent, amount: certified ? i.retention_amount : 0, account: "Retention payable" },
      advanceRecovery: { percent: i.advance_recovery_percent, amount: certified ? i.advance_recovery : 0, account: "Advance to subcontractors" },
    },
    totals: {
      subtotal: i.subtotal, vatAmount: i.vat_amount, gross: i.claimed_amount, certifiedGross: certified ? i.certified_amount : 0,
      retention: certified ? i.retention_amount : 0, advanceRecovery: certified ? i.advance_recovery : 0, netPayable: certified ? i.net_payable : 0, paid: i.paid_amount, outstanding: d.kpis.outstanding,
    },
    attachments: d.attachments.map((a) => ({ name: a.filename, category: a.category, mimeType: a.mime, size: a.size, sha256: a.sha256 ?? null, url: `${base}/api/files/${a.id}?download=1` })),
    approvals: d.trail.map((t) => ({ document: t.document, level: t.level, approver: t.approver, decision: t.decision, decidedAt: t.date, comment: t.comment })),
    erp: { syncStatus: i.erp_sync_status, docNo: i.erp_doc_no, syncedAt: i.erp_synced_at, error: i.erp_error },
  };
}
