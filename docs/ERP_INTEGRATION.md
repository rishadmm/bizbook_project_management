# ERP integration: subcontractor invoice as BizBook AP invoice

No live integration yet. `GET /api/erp/invoices/:id` (session + `invoices/view`) returns the payload built by `toErpPayload()` in `src/features/invoices/erp.ts`; the invoice page shows it under **ERP > Preview ERP payload**. "Send to ERP" is disabled until a connection is configured.

## Payload `schema: "bizbook.ap_invoice.v1"`
| Block | Fields | Source |
|---|---|---|
| `idempotencyKey` | `<invoice id>:<version>` (version +1 per return/reject of the invoice approval) | sub_invoices.id, approvals |
| `source` | system, invoiceId, assignmentId, projectId, subcontractorId, portalSubmitted, status | ids |
| `header` | supplierCode (subcontractors.code), supplierName, supplierTrn (tax_no), supplierTradeLicense, invoiceNo, supplierInvoiceRef, invoiceDate, dueDate, period, currency, projectCode, costCentre (= project code), subcontractNo (assignment code), buyerTrn | invoice, subcontractor, settings.company_trn |
| `lines[]` | itemCode, description, unit, accountHint "Subcontract cost", projectCostCode, stageCostCode, quantity, rate, netAmount, vatCode `SR5`, vatRate, vatAmount, certifiedQuantity, certifiedNetAmount | sub_invoice_lines |
| `deductions` | retention (percent, amount, account "Retention payable"), advanceRecovery | invoice |
| `totals` | subtotal, vatAmount, gross, certifiedGross, retention, advanceRecovery, netPayable, paid, outstanding | invoice |
| `attachments[]` | name, category, mimeType, size, sha256, url | attachments (entity `sub_invoice`) |
| `approvals[]` | document (Invoice/Payment), level, approver, decision, decidedAt, comment | approval tasks |
| `erp` | syncStatus, docNo, syncedAt, error | sub_invoices.erp_* |

Amount convention: `claimed_amount` = gross incl. VAT = subtotal + VAT; certified is gross; retention and advance recovery are taken on the certified gross; line amounts are ex-VAT.

## Planned push flow
1. Invoice final approval (`approved`) sets `erp_sync_status = 'queued'`.
2. A worker POSTs the payload with `Idempotency-Key: <idempotencyKey>`; on success stores `erp_doc_no`, `erp_synced_at`, status `synced`; on failure `failed` + `erp_error` (retry with the same key).
3. Payment approval later pushes the payment against `erp_doc_no`.
Re-certification after a return bumps the version, so the ERP can replace the earlier draft.
