// Supplier registration: data access + state transitions (synchronous better-sqlite3, NO next/* imports, so approval handlers and the seed can use it).
// The server actions (actions.ts / review-actions.ts) add authentication, entity guards, activity logging and revalidation on top of these functions.
import type { DB } from "../../lib/db";
import { getDb } from "../../lib/db";
import { addDays, todayISO } from "../../lib/format";
import { mailSupplier, appBaseUrl } from "../../lib/mailer";
import {
  conditionHolds, ibanError, parseRegions, regionsOf, sectionLabel, sectionStep, swiftError, EXPIRY_WARNING_DAYS, REVIEW_SECTIONS,
  type RegistrationStatus,
} from "../../lib/registration";
import type { Subcontractor, SubcontractorDocument } from "../../lib/types";

export interface CategoryRow { category_id: number; code: string; name: string; group_name: string; status: "requested" | "approved" | "declined" }
export interface ContactRow { id: number; role: string; name: string | null; title: string | null; email: string | null; phone: string | null }
export interface ExperienceRow { id: number; client: string | null; project: string | null; value: number | null; currency: string | null; year: number | null; description: string | null }
export type RegDoc = SubcontractorDocument & { filename: string | null; expiry_state: "expired" | "expiring" | null };
export interface RequiredDoc { code: string; name: string; mandatory: boolean; needs_expiry: boolean; condition: string | null }
export interface ItemRow { id: number; item_kind: "section" | "document"; item_ref: string; status: "accepted" | "query" | "fixed"; comment: string | null; reviewed_by: number | null; reviewed_at: string | null; fixed_at: string | null }
export interface ReviewRow { id: number; decision: string; note: string | null; items_json: string | null; decided_by: number | null; decided_at: string; round: number; decided_by_name: string | null }

const nowIso = () => new Date().toISOString();
const sqlNow = (iso?: string) => (iso ?? nowIso()).replace("T", " ").slice(0, 19);

export function getSub(db: DB, id: number): Subcontractor | undefined {
  return db.prepare("SELECT * FROM subcontractors WHERE id = ?").get(id) as Subcontractor | undefined;
}
export const entityCodeOf = (db: DB, entityId: number): string => (db.prepare("SELECT code FROM entities WHERE id = ?").get(entityId) as { code: string } | undefined)?.code ?? "AE";

/** Writes an activity-log row for a subcontractor without needing a request (sync). */
export function logSub(db: DB, subId: number, action: string, message: string, userId: number | null, at?: string): void {
  db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES ('subcontractor',?,?,?,?,?)")
    .run(subId, action, message, userId, sqlNow(at));
}

/* ------------------------------------------------------------------ reads */

export function listSupplierCategories(db: DB, entityId: number, includeInactive = false): { id: number; code: string; name: string; group_name: string; active: number; entity_id: number | null }[] {
  return db.prepare(`SELECT id, code, name, group_name, active, entity_id FROM supplier_categories WHERE (entity_id IS NULL OR entity_id = ?) ${includeInactive ? "" : "AND active = 1"} ORDER BY sort, id`).all(entityId) as never;
}
export function getCategories(db: DB, subId: number): CategoryRow[] {
  return db.prepare(`SELECT sc.category_id, c.code, c.name, c.group_name, sc.status FROM subcontractor_categories sc JOIN supplier_categories c ON c.id = sc.category_id
    WHERE sc.subcontractor_id = ? ORDER BY c.sort, c.id`).all(subId) as CategoryRow[];
}
export function getContacts(db: DB, subId: number): Record<string, ContactRow> {
  const out: Record<string, ContactRow> = {};
  for (const r of db.prepare("SELECT * FROM subcontractor_contacts WHERE subcontractor_id = ?").all(subId) as ContactRow[]) out[r.role] = r;
  return out;
}
export function getExperience(db: DB, subId: number): ExperienceRow[] {
  return db.prepare("SELECT id, client, project, value, currency, year, description FROM subcontractor_experience WHERE subcontractor_id = ? ORDER BY id").all(subId) as ExperienceRow[];
}
export function docExpiryState(expiry: string | null | undefined): "expired" | "expiring" | null {
  if (!expiry) return null;
  const t = todayISO();
  return expiry < t ? "expired" : expiry <= addDays(t, EXPIRY_WARNING_DAYS) ? "expiring" : null;
}
/** Registration documents: every version (`all`) or only the current version of each type. */
export function getRegDocs(db: DB, subId: number, all = false): RegDoc[] {
  const rows = db.prepare(`SELECT d.*, a.filename FROM subcontractor_documents d LEFT JOIN attachments a ON a.id = d.attachment_id
    WHERE d.subcontractor_id = ? ${all ? "" : "AND d.is_current = 1"} ORDER BY d.doc_type_code IS NULL, d.doc_type_code, d.version DESC, d.id DESC`).all(subId) as (SubcontractorDocument & { filename: string | null })[];
  return rows.map((d) => ({ ...d, expiry_state: docExpiryState(d.expiry_date) }));
}
export function getItems(db: DB, subId: number): ItemRow[] {
  return db.prepare("SELECT id, item_kind, item_ref, status, comment, reviewed_by, reviewed_at, fixed_at FROM registration_items WHERE subcontractor_id = ?").all(subId) as ItemRow[];
}
export function getReviews(db: DB, subId: number): ReviewRow[] {
  return db.prepare(`SELECT r.*, u.name AS decided_by_name FROM registration_reviews r LEFT JOIN users u ON u.id = r.decided_by WHERE r.subcontractor_id = ? ORDER BY r.id DESC`).all(subId) as ReviewRow[];
}

/** Document types the supplier has to provide: the country's active types, narrowed by the categories requested (conditional types). */
export function requiredDocs(db: DB, entityId: number, groups: string[]): RequiredDoc[] {
  const rows = db.prepare("SELECT code, name, mandatory, needs_expiry, category_condition FROM registration_doc_types WHERE entity_id = ? AND active = 1 ORDER BY sort, id").all(entityId) as
    { code: string; name: string; mandatory: number; needs_expiry: number; category_condition: string | null }[];
  return rows.filter((r) => conditionHolds(r.category_condition, groups) || !r.category_condition)
    .map((r) => ({ code: r.code, name: r.name, mandatory: !!r.mandatory && conditionHolds(r.category_condition, groups), needs_expiry: !!r.needs_expiry, condition: r.category_condition }));
}
export const groupsOf = (cats: CategoryRow[]): string[] => [...new Set(cats.filter((c) => c.status !== "declined").map((c) => c.group_name))];

export interface Profile {
  sub: Subcontractor; entityCode: string; categories: CategoryRow[]; contacts: Record<string, ContactRow>; experience: ExperienceRow[]; regions: string[];
  docs: RegDoc[]; required: RequiredDoc[]; items: ItemRow[]; reviews: ReviewRow[]; pendingQueries: ItemRow[];
}
export function getProfile(db: DB, subId: number): Profile | undefined {
  const sub = getSub(db, subId);
  if (!sub) return undefined;
  const categories = getCategories(db, subId);
  const items = getItems(db, subId);
  return {
    sub, entityCode: entityCodeOf(db, sub.entity_id), categories, contacts: getContacts(db, subId), experience: getExperience(db, subId), regions: parseRegions(sub.regions_served),
    docs: getRegDocs(db, subId), required: requiredDocs(db, sub.entity_id, groupsOf(categories)), items, reviews: getReviews(db, subId), pendingQueries: items.filter((i) => i.status === "query"),
  };
}

/* ------------------------------------------------------------------ completeness */

export interface CheckItem { key: string; section: string; label: string; ok: boolean; /** wizard step to fix it */ step: number; detail?: string }
const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/** Every mandatory field and document of the registration, with its state. `ok` rows count towards the completeness meter. */
export function checklist(p: Profile): CheckItem[] {
  const s = p.sub, out: CheckItem[] = [];
  const add = (section: string, key: string, label: string, ok: boolean, step: number, detail?: string) => out.push({ key, section, label, ok, step, detail });
  const co: [string, string, unknown][] = [["legal_form", "Legal form", s.legal_form], ["cr_no", p.entityCode === "OM" ? "Commercial registration (CR) number" : "Trade licence number", s.cr_no],
    ["cr_expiry", "Registration / licence expiry", s.cr_expiry], ["vat_no", p.entityCode === "OM" ? "VAT number" : "VAT / TRN number", s.vat_no], ["year_established", "Year established", s.year_established],
    ["employees", "Number of employees", s.employees], ["turnover_band", "Annual turnover band", s.turnover_band], ["address", "Address", s.address], ["phone", "Phone", s.phone]];
  for (const [k, l, v] of co) add("company", `company.${k}`, l, filled(v), 2);
  add("categories", "categories.list", "At least one category", p.categories.length > 0, 3);
  add("categories", "categories.regions", "Regions served", p.regions.length > 0, 3);
  const sig = p.contacts.signatory, fin = p.contacts.finance;
  add("contacts", "contacts.signatory", "Authorised signatory (name and e-mail)", !!sig && filled(sig.name) && filled(sig.email), 4);
  add("contacts", "contacts.finance", "Finance contact (name and e-mail)", !!fin && filled(fin.name) && filled(fin.email), 4);
  add("contacts", "bank.bank_name", "Bank name", filled(s.bank_name), 4);
  add("contacts", "bank.account_name", "Account name", filled(s.account_name), 4);
  const ie = filled(s.iban) ? ibanError(s.iban!, p.entityCode) : "IBAN is required.";
  add("contacts", "bank.iban", "IBAN", !ie, 4, ie ?? undefined);
  const se = filled(s.swift) ? swiftError(s.swift!) : "SWIFT / BIC is required.";
  add("contacts", "bank.swift", "SWIFT / BIC", !se, 4, se ?? undefined);
  add("hse", "hse.policy", "HSE policy (yes / no)", s.hse_has_policy !== null && s.hse_has_policy !== undefined, 5);
  add("hse", "hse.lti", "Lost-time injury (LTI) rate", s.hse_lti_rate !== null && s.hse_lti_rate !== undefined, 5);
  const refs = p.experience.filter((e) => filled(e.client) && filled(e.project) && e.year);
  add("experience", "experience.count", "At least 2 reference projects", refs.length >= 2, 6, `${refs.length} of 2`);
  for (const r of p.required.filter((r) => r.mandatory)) {
    const d = p.docs.find((x) => x.doc_type_code === r.code && x.attachment_id);
    const bad = d && r.needs_expiry && (!d.expiry_date || d.expiry_date < todayISO());
    add("documents", `doc.${r.code}`, r.name, !!d && !bad, 7, !d ? "Not uploaded" : bad ? (d.expiry_date ? "Expired" : "Expiry date missing") : undefined);
  }
  return out;
}
export function completeness(p: Profile): { percent: number; done: number; total: number; missing: CheckItem[]; ok: boolean } {
  const all = checklist(p);
  const done = all.filter((c) => c.ok).length;
  return { percent: all.length ? Math.round((done / all.length) * 100) : 0, done, total: all.length, missing: all.filter((c) => !c.ok), ok: done === all.length };
}
/** Quick completeness % for lists (the queue). */
export function completenessOf(db: DB, subId: number): number {
  const p = getProfile(db, subId);
  return p ? completeness(p).percent : 0;
}

/* ------------------------------------------------------------------ supplier-side writes (the caller passes the verified supplier id) */

export function isEditable(status: string): boolean { return status === "draft" || status === "referred_back"; }

/** A supplier edit of a section / document answers an open query on it: mark the item as fixed. */
export function markFixed(db: DB, subId: number, kind: "section" | "document", ref: string): void {
  db.prepare("UPDATE registration_items SET status = 'fixed', fixed_at = ? WHERE subcontractor_id = ? AND item_kind = ? AND item_ref = ? AND status = 'query'").run(nowIso(), subId, kind, ref);
}
/** Saves one document version: a re-upload keeps the older versions (is_current = 0) and flags the queried item as fixed. */
export function addDocumentVersion(db: DB, subId: number, o: {
  code: string; attachmentId: number | null; refNo: string | null; issueDate: string | null; expiryDate: string | null; uploadedByName: string | null; legacyType: string; createdAt?: string;
}): number {
  const prev = db.prepare("SELECT MAX(version) v FROM subcontractor_documents WHERE subcontractor_id = ? AND doc_type_code = ?").get(subId, o.code) as { v: number | null };
  db.prepare("UPDATE subcontractor_documents SET is_current = 0 WHERE subcontractor_id = ? AND doc_type_code = ?").run(subId, o.code);
  const id = Number(db.prepare(`INSERT INTO subcontractor_documents(subcontractor_id, doc_type, doc_type_code, ref_no, issue_date, expiry_date, attachment_id, status, source, uploaded_by_name, review_status, version, is_current, created_at)
    VALUES (?,?,?,?,?,?,?, 'pending_review', 'portal', ?, 'pending', ?, 1, ?)`).run(subId, o.legacyType, o.code, o.refNo, o.issueDate, o.expiryDate, o.attachmentId, o.uploadedByName, (prev.v ?? 0) + 1, sqlNow(o.createdAt)).lastInsertRowid);
  markFixed(db, subId, "document", o.code);
  return id;
}
/** Updates the metadata (ref / dates) of the current version without a new file. */
export function updateCurrentDocMeta(db: DB, subId: number, code: string, refNo: string | null, issueDate: string | null, expiryDate: string | null): boolean {
  const r = db.prepare("UPDATE subcontractor_documents SET ref_no = ?, issue_date = ?, expiry_date = ? WHERE subcontractor_id = ? AND doc_type_code = ? AND is_current = 1").run(refNo, issueDate, expiryDate, subId, code);
  if (r.changes) markFixed(db, subId, "document", code);
  return r.changes > 0;
}

/** Next registration number of a country: `<prefix>REG-<year>-0001`. */
export function nextRegistrationNo(db: DB, entityId: number, year = new Date().getFullYear()): string {
  const e = db.prepare("SELECT doc_prefix FROM entities WHERE id = ?").get(entityId) as { doc_prefix: string } | undefined;
  const pre = `${e?.doc_prefix ?? ""}REG-${year}-`;
  const max = (db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(registration_no, ?) AS INTEGER)), 0) m FROM subcontractors WHERE entity_id = ? AND registration_no LIKE ?").get(pre.length + 1, entityId, `${pre}%`) as { m: number }).m;
  return `${pre}${String(max + 1).padStart(4, "0")}`;
}

export class RegistrationError extends Error { constructor(m: string) { super(m); this.name = "RegistrationError"; } }

/**
 * Submit (draft) or resubmit (referred back). Checks completeness and, on a resubmission, that every queried item has been changed.
 * First submission assigns the registration number and sends the "received" mail; a resubmission keeps the review history and counts the round.
 */
export function submitRegistration(db: DB, subId: number, o: { portalUserId?: number | null; actorName?: string | null; now?: string; baseUrl?: string; skipChecks?: boolean } = {}): { regNo: string; resubmitted: boolean } {
  return db.transaction(() => {
    const p = getProfile(db, subId);
    if (!p) throw new RegistrationError("Supplier not found.");
    const st = p.sub.registration_status;
    if (!isEditable(st)) throw new RegistrationError("This registration cannot be submitted in its current state.");
    const resubmit = st === "referred_back";
    if (!o.skipChecks) {
      if (resubmit && p.pendingQueries.length) throw new RegistrationError(`${p.pendingQueries.length} queried item${p.pendingQueries.length === 1 ? " has" : "s have"} not been changed yet.`);
      const c = completeness(p);
      if (!c.ok) throw new RegistrationError(`The registration is incomplete: ${c.missing.slice(0, 3).map((m) => m.label).join(", ")}${c.missing.length > 3 ? ` and ${c.missing.length - 3} more` : ""}.`);
    }
    const at = o.now ?? nowIso();
    const regNo = p.sub.registration_no ?? nextRegistrationNo(db, p.sub.entity_id, Number(at.slice(0, 4)));
    db.prepare(`UPDATE subcontractors SET registration_status = 'submitted', registration_no = ?, submitted_at = ?, registered_at = COALESCE(registered_at, ?),
      resubmit_count = resubmit_count + ?, declaration_accepted_at = COALESCE(declaration_accepted_at, ?) WHERE id = ?`)
      .run(regNo, at, at, resubmit ? 1 : 0, at, subId);
    if (resubmit) {
      db.prepare("INSERT INTO registration_reviews(subcontractor_id, decision, note, items_json, decided_by, decided_at, round) VALUES (?, 'resubmit', ?, NULL, NULL, ?, ?)")
        .run(subId, `Resubmitted by ${o.actorName ?? "the supplier"}`, at, p.sub.resubmit_count + 2);
      logSub(db, subId, "registration", `Registration resubmitted (round ${p.sub.resubmit_count + 2})`, null, at);
    } else {
      logSub(db, subId, "registration", `Registration ${regNo} submitted`, null, at);
      mailSupplier(db, subId, "registration_received", { company: p.sub.name, regNo }, { related: { type: "subcontractor", id: subId }, baseUrl: o.baseUrl, createdAt: sqlNow(at) });
    }
    return { regNo, resubmitted: resubmit };
  })();
}

/* ------------------------------------------------------------------ reviewer-side transitions */

export function startReview(db: DB, subId: number, reviewerId: number, at?: string): void {
  const s = getSub(db, subId);
  if (!s) throw new RegistrationError("Supplier not found.");
  if (s.registration_status !== "submitted" && s.registration_status !== "under_review") throw new RegistrationError("Only a submitted registration can be taken into review.");
  db.prepare("UPDATE subcontractors SET registration_status = 'under_review', reviewed_by = ? WHERE id = ?").run(reviewerId, subId);
  logSub(db, subId, "registration", "Review started", reviewerId, at);
}

/** Per-section / per-document verdict. A query needs a comment. */
export function setItemVerdict(db: DB, subId: number, reviewerId: number, kind: "section" | "document", ref: string, verdict: "accepted" | "query" | "clear", comment: string | null, at?: string): void {
  const s = getSub(db, subId);
  if (!s) throw new RegistrationError("Supplier not found.");
  if (s.registration_status !== "under_review") throw new RegistrationError("Start the review first.");
  if (kind === "section" && !REVIEW_SECTIONS.some((x) => x.key === ref)) throw new RegistrationError("Unknown section.");
  const text = (comment ?? "").trim() || null;
  if (verdict === "query" && !text) throw new RegistrationError("A comment is required when you query an item.");
  if (verdict === "clear") { db.prepare("DELETE FROM registration_items WHERE subcontractor_id = ? AND item_kind = ? AND item_ref = ?").run(subId, kind, ref); }
  else {
    db.prepare(`INSERT INTO registration_items(subcontractor_id, item_kind, item_ref, status, comment, reviewed_by, reviewed_at, fixed_at) VALUES (?,?,?,?,?,?,?,NULL)
      ON CONFLICT(subcontractor_id, item_kind, item_ref) DO UPDATE SET status = excluded.status, comment = excluded.comment, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, fixed_at = NULL`)
      .run(subId, kind, ref, verdict, verdict === "query" ? text : null, reviewerId, sqlNow(at));
  }
  if (kind === "document") {
    db.prepare("UPDATE subcontractor_documents SET review_status = ?, review_comment = ?, reviewed_by = ?, reviewed_at = ?, status = ? WHERE subcontractor_id = ? AND doc_type_code = ? AND is_current = 1")
      .run(verdict === "clear" ? "pending" : verdict, verdict === "query" ? text : null, reviewerId, sqlNow(at), verdict === "accepted" ? "verified" : verdict === "query" ? "rejected" : "pending_review", subId, ref);
  }
}

export function itemLabel(db: DB, subId: number, it: ItemRow, required?: RequiredDoc[]): string {
  if (it.item_kind === "section") return sectionLabel(it.item_ref);
  const name = required?.find((r) => r.code === it.item_ref)?.name
    ?? (db.prepare("SELECT d.name FROM registration_doc_types d JOIN subcontractors s ON s.entity_id = d.entity_id WHERE s.id = ? AND d.code = ?").get(subId, it.item_ref) as { name: string } | undefined)?.name;
  return name ?? it.item_ref;
}
/** Wizard step / portal link target of a queried item. */
export function itemStep(it: Pick<ItemRow, "item_kind" | "item_ref">): number { return it.item_kind === "section" ? sectionStep(it.item_ref) : 7; }

/** Refer back: needs at least one queried item or a note. Queried items are listed automatically in the review row and the mail. */
export function referBack(db: DB, subId: number, reviewerId: number, note: string | null, o: { baseUrl?: string; now?: string } = {}): void {
  db.transaction(() => {
    const p = getProfile(db, subId);
    if (!p) throw new RegistrationError("Supplier not found.");
    if (p.sub.registration_status !== "under_review") throw new RegistrationError("Only a registration under review can be referred back.");
    const text = (note ?? "").trim() || null;
    const queried = p.items.filter((i) => i.status === "query");
    if (!queried.length && !text) throw new RegistrationError("Query at least one item or write a note before referring back.");
    const items = queried.map((i) => ({ kind: i.item_kind, ref: i.item_ref, label: itemLabel(db, subId, i, p.required), comment: i.comment }));
    const at = o.now ?? nowIso();
    db.prepare("INSERT INTO registration_reviews(subcontractor_id, decision, note, items_json, decided_by, decided_at, round) VALUES (?, 'refer_back', ?, ?, ?, ?, ?)")
      .run(subId, text, JSON.stringify(items), reviewerId, at, p.sub.resubmit_count + 1);
    db.prepare("UPDATE subcontractors SET registration_status = 'referred_back', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(text, reviewerId, at, subId);
    logSub(db, subId, "registration", `Referred back to the supplier (${items.length} queried item${items.length === 1 ? "" : "s"})`, reviewerId, at);
    mailSupplier(db, subId, "registration_referred_back", { company: p.sub.name, note: text, items: items.map((i) => ({ label: i.label, comment: i.comment })) }, { baseUrl: o.baseUrl, createdAt: sqlNow(at) });
  })();
}

export interface ApprovalPayload { registration: true; categories: number[]; grade: "A" | "B" | "C"; valid_until: string; note?: string | null; base_url?: string }

/**
 * Applies an approved registration (called by the `subcontractor_onboarding` approval handler or immediately when no workflow applies):
 * registration_status / status = approved, grants the chosen categories (the others are declined), sets grade + validity, mails and notifies the supplier.
 */
export function applyApproval(db: DB, subId: number, payload: ApprovalPayload, actorId: number | null, o: { baseUrl?: string; now?: string } = {}): void {
  const baseUrl = o.baseUrl ?? payload.base_url;
  db.transaction(() => {
    const s = getSub(db, subId);
    if (!s) throw new RegistrationError("Supplier not found.");
    const at = o.now ?? nowIso();
    const allowed = new Set(payload.categories);
    db.prepare("UPDATE subcontractor_categories SET status = CASE WHEN category_id IN (" + (allowed.size ? [...allowed].map((n) => Math.trunc(n)).join(",") : "NULL") + ") THEN 'approved' ELSE 'declined' END WHERE subcontractor_id = ?").run(subId);
    db.prepare(`UPDATE subcontractors SET registration_status = 'approved', status = 'approved', prequal_grade = ?, prequal_valid_until = ?, reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = ?,
      review_note = ?, reject_reason = NULL, portal_enabled = 1 WHERE id = ?`).run(payload.grade, payload.valid_until, actorId, at, payload.note ?? null, subId);
    db.prepare("INSERT INTO registration_reviews(subcontractor_id, decision, note, items_json, decided_by, decided_at, round) VALUES (?, 'approve', ?, ?, ?, ?, ?)")
      .run(subId, payload.note ?? null, JSON.stringify({ grade: payload.grade, valid_until: payload.valid_until, categories: payload.categories }), actorId, at, s.resubmit_count + 1);
    const cats = getCategories(db, subId).filter((c) => c.status === "approved").map((c) => c.name);
    logSub(db, subId, "registration", `Registration approved: grade ${payload.grade} until ${payload.valid_until}, ${cats.length} categor${cats.length === 1 ? "y" : "ies"}`, actorId, at);
    mailSupplier(db, subId, "registration_approved", { company: s.name, grade: payload.grade, validUntil: payload.valid_until, categories: cats }, { baseUrl, createdAt: sqlNow(at) });
  })();
}

export function reject(db: DB, subId: number, reviewerId: number, reason: string, o: { baseUrl?: string; now?: string } = {}): void {
  db.transaction(() => {
    const s = getSub(db, subId);
    if (!s) throw new RegistrationError("Supplier not found.");
    if (s.registration_status !== "under_review" && s.registration_status !== "submitted") throw new RegistrationError("Only a registration under review can be rejected.");
    const text = reason.trim();
    if (!text) throw new RegistrationError("A reason is required to reject a registration.");
    const at = o.now ?? nowIso();
    db.prepare("UPDATE subcontractors SET registration_status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(text, reviewerId, at, subId);
    db.prepare("INSERT INTO registration_reviews(subcontractor_id, decision, note, items_json, decided_by, decided_at, round) VALUES (?, 'reject', ?, NULL, ?, ?, ?)").run(subId, text, reviewerId, at, s.resubmit_count + 1);
    logSub(db, subId, "registration", `Registration rejected: ${text}`, reviewerId, at);
    mailSupplier(db, subId, "registration_rejected", { company: s.name, reason: text }, { baseUrl: o.baseUrl, createdAt: sqlNow(at) });
  })();
}

/** Admin "Reopen": a rejected registration goes back to the supplier as referred back so that it can be corrected and resubmitted. */
export function reopen(db: DB, subId: number, adminId: number, note: string | null, at?: string): void {
  const s = getSub(db, subId);
  if (!s || s.registration_status !== "rejected") throw new RegistrationError("Only a rejected registration can be reopened.");
  db.prepare("UPDATE subcontractors SET registration_status = 'referred_back', reject_reason = NULL, review_note = ? WHERE id = ?").run(note ?? "Reopened by an administrator: please review and resubmit.", subId);
  db.prepare("INSERT INTO registration_reviews(subcontractor_id, decision, note, items_json, decided_by, decided_at, round) VALUES (?, 'reopen', ?, NULL, ?, ?, ?)").run(subId, note, adminId, at ?? nowIso(), s.resubmit_count + 1);
  logSub(db, subId, "registration", "Registration reopened", adminId, at);
}

/* ------------------------------------------------------------------ bidding eligibility (used by Part B) */

/** Reasons that block a supplier from bidding today: not approved, or an expired mandatory registration document. Empty = may bid. The supplier stays approved either way. */
export function bidBlockers(db: DB, subId: number): string[] {
  const p = getProfile(db, subId);
  if (!p) return ["Supplier not found"];
  const out: string[] = [];
  if (p.sub.registration_status !== "approved" || p.sub.status !== "approved") out.push("The supplier registration is not approved.");
  for (const r of p.required.filter((x) => x.mandatory)) {
    const d = p.docs.find((x) => x.doc_type_code === r.code);
    if (d?.expiry_date && d.expiry_date < todayISO()) out.push(`${r.name} expired on ${d.expiry_date}. Upload the renewed document.`);
  }
  return out;
}
export const canBid = (db: DB, subId: number): boolean => bidBlockers(db, subId).length === 0;

export { appBaseUrl, regionsOf, getDb };
export type { RegistrationStatus };
