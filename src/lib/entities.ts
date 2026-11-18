// Country operations of the company (table `entities`) + access helpers. Pure data access (no Next imports): used by pages, actions, seeds and scripts.
import { getDb } from "./db";

export interface Entity {
  id: number; code: string; country: string; flag: string | null; legal_name: string; short_name: string; currency: string; vat_rate: number;
  tax_label: string; tax_no: string | null; cr_no: string | null; address: string | null; phone: string | null; email: string | null;
  map_center: string | null; timezone: string | null; approval_cost_threshold: number; doc_prefix: string; status: string; sort_order: number;
}

/** Entity code of the demo default context (UAE). */
export const DEFAULT_ENTITY_CODE = "AE";

export function listEntities(includeInactive = false): Entity[] {
  return getDb().prepare(`SELECT * FROM entities ${includeInactive ? "" : "WHERE status = 'active'"} ORDER BY sort_order, id`).all() as Entity[];
}
export function getEntityById(id: number | null | undefined): Entity | undefined {
  return id ? (getDb().prepare("SELECT * FROM entities WHERE id = ?").get(id) as Entity | undefined) : undefined;
}
export function getEntityByCode(code: string | null | undefined): Entity | undefined {
  return code ? (getDb().prepare("SELECT * FROM entities WHERE code = ?").get(code.toUpperCase()) as Entity | undefined) : undefined;
}
/** Entity of the first (default) country; the app always has at least one. */
export function defaultEntity(): Entity {
  return (getDb().prepare("SELECT * FROM entities WHERE status = 'active' ORDER BY sort_order, id LIMIT 1").get() as Entity | undefined)
    ?? (getDb().prepare("SELECT * FROM entities ORDER BY sort_order, id LIMIT 1").get() as Entity);
}

/** Country ids a user may access: administrators all active countries, everybody else their user_entities rows. */
export function allowedEntityIds(userId: number, isAdminLevel: boolean): number[] {
  const db = getDb();
  const rows = isAdminLevel
    ? (db.prepare("SELECT id FROM entities WHERE status = 'active' ORDER BY sort_order, id").all() as { id: number }[])
    : (db.prepare("SELECT e.id FROM user_entities ue JOIN entities e ON e.id = ue.entity_id WHERE ue.user_id = ? AND e.status = 'active' ORDER BY e.sort_order, e.id").all(userId) as { id: number }[]);
  return rows.map((r) => r.id);
}

/** Ids of the users that may work in a country (administrators + user_entities). */
export function usersOfEntity(entityId: number): number[] {
  return (getDb().prepare(`SELECT u.id FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE COALESCE(r.code, u.role) IN ('super_admin','admin') OR EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?)`).all(entityId) as { id: number }[]).map((r) => r.id);
}
/** SQL fragment: users (alias `u`) that may work in the entity `?`-bound by the caller as `${p}`. */
export const userInEntitySql = (alias: string, param = "?") =>
  `(EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = ${alias}.id AND ue.entity_id = ${param}) OR EXISTS (SELECT 1 FROM roles rr WHERE rr.id = ${alias}.role_id AND rr.code IN ('super_admin','admin')))`;

/* ---- entity of a record (root rows carry entity_id; children inherit through their parent) */
const ONE = (sql: string, id: number): number | undefined => (getDb().prepare(sql).get(id) as { e: number } | undefined)?.e;
export const entityOfProject = (id: number) => ONE("SELECT entity_id e FROM projects WHERE id = ?", id);
export const entityOfTender = (id: number) => ONE("SELECT entity_id e FROM tenders WHERE id = ?", id);
export const entityOfClient = (id: number) => ONE("SELECT entity_id e FROM clients WHERE id = ?", id);
export const entityOfSubcontractor = (id: number) => ONE("SELECT entity_id e FROM subcontractors WHERE id = ?", id);
export const entityOfAssignment = (id: number) => ONE("SELECT p.entity_id e FROM assignments a JOIN projects p ON p.id = a.project_id WHERE a.id = ?", id);
export const entityOfInvoice = (id: number) => ONE("SELECT p.entity_id e FROM sub_invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = ?", id);
export const entityOfStage = (id: number) => ONE("SELECT p.entity_id e FROM stages s JOIN projects p ON p.id = s.project_id WHERE s.id = ?", id);
export const entityOfLoss = (id: number) => ONE("SELECT t.entity_id e FROM loss_analyses l JOIN tenders t ON t.id = l.tender_id WHERE l.id = ?", id);
export const entityOfRevision = (id: number) => ONE("SELECT t.entity_id e FROM tender_revisions r JOIN tenders t ON t.id = r.tender_id WHERE r.id = ?", id);
export const entityOfApproval = (id: number) => ONE("SELECT entity_id e FROM approval_requests WHERE id = ?", id);
export const entityOfCertificate = (id: number) => ONE("SELECT p.entity_id e FROM completion_certificates c JOIN projects p ON p.id = c.project_id WHERE c.id = ?", id);
export const entityOfRfx = (id: number) => ONE("SELECT entity_id e FROM rfx_tenders WHERE id = ?", id);
export const entityOfRfxBid = (id: number) => ONE("SELECT t.entity_id e FROM rfx_bids b JOIN rfx_tenders t ON t.id = b.rfx_id WHERE b.id = ?", id);
export const entityOfProgress = (id: number) => ONE("SELECT p.entity_id e FROM progress_reports r JOIN projects p ON p.id = r.project_id WHERE r.id = ?", id);

/** Entity of an attachment through its owner (`entity_type` as stored in attachments / activity_log). */
export function entityOfAttachmentOwner(type: string, id: number): number | undefined {
  switch (type) {
    case "tender": return entityOfTender(id);
    case "revision": return entityOfRevision(id);
    case "project": return entityOfProject(id);
    case "stage": return entityOfStage(id);
    case "subcontractor": return entityOfSubcontractor(id);
    case "assignment": return entityOfAssignment(id);
    case "sub_invoice": case "invoice": return entityOfInvoice(id);
    case "certificate": return entityOfCertificate(id);
    case "progress": return entityOfProgress(id);
    case "loss": return entityOfLoss(id);
    case "client": return entityOfClient(id);
    case "rfx": return entityOfRfx(id);
    case "rfx_bid": return entityOfRfxBid(id);
    case "issue": return ONE("SELECT p.entity_id e FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?", id);
    default: return undefined;
  }
}

/** True when the user may work in the country (administrators: every country). */
export function userHasEntity(userId: number, entityId: number | null | undefined): boolean {
  if (!entityId) return false;
  return !!getDb().prepare(`SELECT 1 FROM users u LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND (COALESCE(r.code, u.role) IN ('super_admin','admin') OR EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?))`).get(userId, entityId);
}
