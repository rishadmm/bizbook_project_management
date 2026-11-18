// Shared, synchronous assignment insert (no next/* imports, relative imports only: the approvals registry reaches it, and Playwright loads the registry directly).
// NOTE: no ESM-only dependency (nanoid) here: Playwright loads the approvals registry through this file.
// Used by the direct route (saveAssignment in actions.ts) and by the supplier-tender award (`rfx_award` onApproved): codes, portal token and the activity log stay identical.
// FX / USD columns are filled by the AFTER INSERT trigger on assignments (fx-tables.ts).
import { randomBytes } from "node:crypto";
import type { DB } from "../../lib/db";

export interface AssignmentInput {
  projectId: number; stageId: number | null; subcontractorId: number; scope: string | null; contractValue: number; quantity: number | null; quantityUnit: string | null; unitRate: number | null;
  startDate: string | null; endDate: string | null; paymentTerms: string | null; advancePct: number; retentionPct: number; paymentDays: number; status: string;
  /** supplier tender link; direct assignments keep the defaults ('direct', NULL, NULL) */ source?: "direct" | "tender"; rfxId?: number | null; rfxBidId?: number | null;
  /** the portal link is switched on at creation (awarded tenders: the subcontract is active at once) */ portalEnabled?: boolean;
}

/** 24-character URL-safe portal token (same alphabet and length as nanoid(24)). */
export const portalToken = (): string => randomBytes(18).toString("base64url");

/** Next assignment code of a country: `<doc_prefix>SC-001` (sequence per country). */
export function nextAssignmentCode(db: DB, entityId: number): string {
  const pre = `${(db.prepare("SELECT doc_prefix p FROM entities WHERE id = ?").get(entityId) as { p: string } | undefined)?.p ?? ""}SC-`;
  const maxN = (db.prepare("SELECT a.code FROM assignments a JOIN projects p ON p.id = a.project_id WHERE p.entity_id = ? AND a.code LIKE ?").all(entityId, `${pre}%`) as { code: string }[])
    .reduce((m, r) => Math.max(m, Number(r.code.slice(pre.length)) || 0), 0);
  return `${pre}${String(maxN + 1).padStart(3, "0")}`;
}

/** Inserts an assignment row (must run inside the caller's transaction when it belongs to a larger unit of work). Returns id + code. */
export function insertAssignment(db: DB, entityId: number, a: AssignmentInput): { id: number; code: string } {
  const code = nextAssignmentCode(db, entityId);
  const id = Number(db.prepare(`INSERT INTO assignments(stage_id, subcontractor_id, scope, contract_value, quantity, quantity_unit, unit_rate, start_date, end_date, payment_terms, advance_pct, retention_pct, payment_days, status,
      project_id, code, portal_token, portal_enabled, source, rfx_id, rfx_bid_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(a.stageId, a.subcontractorId, a.scope, a.contractValue, a.quantity, a.quantityUnit, a.unitRate, a.startDate, a.endDate, a.paymentTerms, a.advancePct, a.retentionPct, a.paymentDays, a.status,
      a.projectId, code, portalToken(), a.portalEnabled ? 1 : 0, a.source ?? "direct", a.rfxId ?? null, a.rfxBidId ?? null).lastInsertRowid);
  return { id, code };
}
