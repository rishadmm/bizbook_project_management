// Supplier tendering (RFx) lifecycle: synchronous better-sqlite3, NO next/* imports and relative imports only (the approvals registry reaches this module and Playwright loads the
// registry directly, so `@/` aliases must not be used here). Server actions (actions.ts, portal-actions.ts) add authentication, entity guards, revalidation on top.
// Bid handling and the sealed-bid rule: bid-core.ts. Evaluation, recommendation and award: eval-core.ts.
import type { DB } from "../../lib/db";
import { appBaseUrl, mailSupplier } from "../../lib/mailer";
import { EXCLUDED_BUDGET_CATEGORIES, LIVE_RFX_STATUSES, SUBCONTRACT_SHARE, niceQty, niceRate, roundTo, validateRfxDates } from "../../lib/rfx";
import { bidBlockers } from "../supplier-registration/core";

export interface RfxRow {
  id: number; entity_id: number; code: string; title: string; description: string | null; project_id: number; scope_kind: "project" | "subproject" | "stages"; category_id: number | null;
  procedure: "open" | "selective"; template_id: number | null; evaluation_method: string; tech_weight: number; commercial_weight: number; tech_pass_mark: number; min_bidders: number;
  estimate: number | null; publish_at: string | null; clarification_deadline: string | null; site_visit_at: string | null; site_visit_note: string | null; closing_at: string | null; opening_at: string | null;
  validity_days: number; bid_bond_pct: number; performance_bond_pct: number; advance_pct: number; retention_pct: number; payment_days: number; payment_terms: string | null;
  contract_start: string | null; contract_end: string | null; owner_id: number | null; status: string; awarded_bid_id: number | null; assignment_id: number | null; cancel_reason: string | null;
  created_by: number | null; created_at: string; award_value: number | null; recommended_bid_id: number | null; recommendation_note: string | null; recommended_by: number | null;
  recommended_at: string | null; published_at: string | null; closed_at: string | null; awarded_at: string | null; currency?: string | null;
}
export interface StepRow { id: number; rfx_id: number; step_key: string; name: string; kind: string; gate: "pass_fail" | "scored"; weight: number | null; pass_mark: number | null; evaluator_role: string | null; sort: number }
export interface CriterionRow { id: number; step_id: number; criterion: string; max_score: number; guidance: string | null; sort: number }
export interface RequirementRow { id: number; rfx_id: number; name: string; kind: string; mandatory: number; envelope: "technical" | "commercial"; step_id: number | null; instructions: string | null; sort: number }
export interface BoqRow { id: number; rfx_id: number; item_no: string; description: string; unit: string | null; quantity: number; stage_id: number | null; estimate_rate: number; sort: number }
export interface CommitteeRow { id: number; rfx_id: number; user_id: number; role: string; steps: string | null; coi_declared_at: string | null; coi_conflict: number; coi_note: string | null; name?: string }

export const nowIso = (): string => new Date().toISOString();
export const sqlNow = (iso?: string): string => (iso ?? nowIso()).replace("T", " ").slice(0, 19);
const one = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as never[])) as T | undefined;
const all = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[];

export class RfxError extends Error { constructor(m: string) { super(m); this.name = "RfxError"; } }

export function logRfx(db: DB, rfxId: number, action: string, message: string, userId: number | null, at?: string): void {
  db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES ('rfx',?,?,?,?,?)").run(rfxId, action, message, userId, sqlNow(at));
}
export const getRfx = (db: DB, id: number): RfxRow | undefined => one<RfxRow>(db, "SELECT * FROM rfx_tenders WHERE id = ?", id);
export const mustRfx = (db: DB, id: number): RfxRow => { const r = getRfx(db, id); if (!r) throw new RfxError("Supplier tender not found"); return r; };
export const entityCurrency = (db: DB, entityId: number): string => one<{ currency: string }>(db, "SELECT currency FROM entities WHERE id = ?", entityId)?.currency ?? "AED";
export const supplierName = (db: DB, id: number): string => one<{ name: string }>(db, "SELECT name FROM subcontractors WHERE id = ?", id)?.name ?? `Supplier ${id}`;
export const userName = (db: DB, id: number | null | undefined): string => (id ? one<{ name: string }>(db, "SELECT name FROM users WHERE id = ?", id)?.name ?? `User ${id}` : "System");

/** `<doc_prefix>RFX-<year>-001` (sequence per country and year). */
export function nextRfxCode(db: DB, entityId: number, year = new Date().getFullYear()): string {
  const dp = one<{ p: string }>(db, "SELECT doc_prefix p FROM entities WHERE id = ?", entityId)?.p ?? "";
  const full = `${dp}RFX-${year}-`;
  const max = all<{ code: string }>(db, "SELECT code FROM rfx_tenders WHERE entity_id = ? AND code LIKE ?", entityId, `${full}%`).reduce((m, r) => Math.max(m, Number(r.code.slice(full.length)) || 0), 0);
  return `${full}${String(max + 1).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ scope */

export interface StageAvail { id: number; code: string | null; name: string; sort: number; planned_quantity: number | null; quantity_unit: string | null; budget_amount: number | null; planned_start: string | null; planned_end: string | null; blocked: string | null }

/** Stages of a project with the reason why a stage cannot be tendered (already assigned, or already in another live tender). `exceptRfx` = the draft being edited. */
export function stageAvailability(db: DB, projectId: number, exceptRfx = 0): StageAvail[] {
  const stages = all<Omit<StageAvail, "blocked">>(db, "SELECT id, code, name, sort, planned_quantity, quantity_unit, budget_amount, planned_start, planned_end FROM stages WHERE project_id = ? ORDER BY sort, id", projectId);
  const live = LIVE_RFX_STATUSES.map((s) => `'${s}'`).join(",");
  return stages.map((s) => {
    const asg = one<{ code: string | null }>(db, "SELECT code FROM assignments WHERE stage_id = ? AND status <> 'terminated' ORDER BY id LIMIT 1", s.id);
    if (asg) return { ...s, blocked: `Already assigned (${asg.code ?? "subcontract"})` };
    const t = one<{ code: string }>(db, `SELECT t.code FROM rfx_tenders t WHERE t.status IN (${live}) AND t.id <> ? AND t.project_id = ?
      AND (t.scope_kind IN ('project', 'subproject') OR EXISTS (SELECT 1 FROM rfx_scope sc WHERE sc.rfx_id = t.id AND sc.stage_id = ?)) ORDER BY t.id LIMIT 1`, exceptRfx, projectId, s.id);
    if (t) return { ...s, blocked: `Out to tender (${t.code})` };
    return { ...s, blocked: null };
  });
}
/** Stage ids a tender covers: its rfx_scope rows (stages), or every free stage of the project for a project / sub-project tender. */
export function scopeStageIds(db: DB, rfx: Pick<RfxRow, "id" | "project_id" | "scope_kind">): number[] {
  if (rfx.scope_kind === "stages") return all<{ stage_id: number }>(db, "SELECT sc.stage_id FROM rfx_scope sc JOIN stages s ON s.id = sc.stage_id WHERE sc.rfx_id = ? ORDER BY s.sort, s.id", rfx.id).map((r) => r.stage_id);
  return stageAvailability(db, rfx.project_id, rfx.id).filter((s) => !s.blocked).map((s) => s.id);
}

/** BOQ prefill from the project budget lines of the scope (overhead / contingency excluded), estimate rate = unit cost x the subcontract share. */
export function prefillBoq(db: DB, stageIds: number[], dec = 2): { item_no: string; description: string; unit: string | null; quantity: number; stage_id: number | null; estimate_rate: number }[] {
  const out: { item_no: string; description: string; unit: string | null; quantity: number; stage_id: number | null; estimate_rate: number }[] = [];
  stageIds.forEach((sid, si) => {
    const st = one<{ code: string | null; name: string; budget_amount: number | null }>(db, "SELECT code, name, budget_amount FROM stages WHERE id = ?", sid);
    if (!st) return;
    const lines = all<{ description: string | null; category: string; unit: string | null; quantity: number | null; unit_cost: number | null }>(db,
      "SELECT description, category, unit, quantity, unit_cost FROM project_budget_lines WHERE stage_id = ? ORDER BY id", sid).filter((l) => !EXCLUDED_BUDGET_CATEGORIES.includes(l.category) && (l.quantity ?? 0) > 0);
    const prefix = stageIds.length > 1 ? `${si + 1}.` : "";
    const tag = stageIds.length > 1 && st.code ? ` (${st.code})` : "";
    if (!lines.length) {
      out.push({ item_no: `${prefix}1`, description: `Stage works - ${st.name}${tag}`, unit: "lumpsum", quantity: 1, stage_id: sid, estimate_rate: roundTo((st.budget_amount ?? 0) * SUBCONTRACT_SHARE, 0) });
      return;
    }
    lines.forEach((l, i) => out.push({ item_no: `${prefix}${i + 1}`, description: `${l.description ?? l.category}${tag}`, unit: l.unit, quantity: niceQty(l.unit, l.quantity ?? 1), stage_id: sid, estimate_rate: niceRate((l.unit_cost ?? 0) * SUBCONTRACT_SHARE, dec) }));
  });
  return out;
}

/** Replaces the BOQ of a draft and refreshes the estimate (sum of quantity x estimate rate). */
export function replaceBoq(db: DB, rfxId: number, lines: { item_no: string; description: string; unit: string | null; quantity: number; stage_id: number | null; estimate_rate: number }[], dec: number, setEstimate = true): void {
  db.prepare("DELETE FROM rfx_boq_lines WHERE rfx_id = ?").run(rfxId);
  const ins = db.prepare("INSERT INTO rfx_boq_lines(rfx_id, item_no, description, unit, quantity, stage_id, estimate_rate, sort) VALUES (?,?,?,?,?,?,?,?)");
  lines.forEach((l, i) => ins.run(rfxId, l.item_no, l.description, l.unit, l.quantity, l.stage_id, l.estimate_rate, i + 1));
  if (setEstimate) db.prepare("UPDATE rfx_tenders SET estimate = ? WHERE id = ?").run(roundTo(lines.reduce((a, l) => a + l.quantity * l.estimate_rate, 0), dec), rfxId);
}

/* ------------------------------------------------------------------ templates -> tender copy */

/** Copies steps, criteria and requirements of a template into the tender (replacing what is there; draft only). Template edits never reach a live tender afterwards. */
export function copyTemplateInto(db: DB, rfxId: number, templateId: number): void {
  const t = one<{ id: number; evaluation_method: string; tech_weight: number; commercial_weight: number; tech_pass_mark: number; bid_bond_pct: number; performance_bond_pct: number; default_validity_days: number; min_bidders: number }>(db, "SELECT * FROM rfx_templates WHERE id = ?", templateId);
  if (!t) throw new RfxError("Template not found");
  db.prepare("DELETE FROM rfx_requirements WHERE rfx_id = ?").run(rfxId);
  db.prepare("DELETE FROM rfx_steps WHERE rfx_id = ?").run(rfxId); // criteria cascade
  const stepMap = new Map<number, number>();
  for (const s of all<{ id: number; step_key: string; name: string; kind: string; gate: string; weight: number | null; pass_mark: number | null; evaluator_role: string | null; sort: number }>(db, "SELECT * FROM rfx_template_steps WHERE template_id = ? ORDER BY sort, id", templateId)) {
    const sid = Number(db.prepare("INSERT INTO rfx_steps(rfx_id, step_key, name, kind, gate, weight, pass_mark, evaluator_role, sort) VALUES (?,?,?,?,?,?,?,?,?)").run(rfxId, s.step_key, s.name, s.kind, s.gate, s.weight, s.pass_mark, s.evaluator_role, s.sort).lastInsertRowid);
    stepMap.set(s.id, sid);
    for (const c of all<{ criterion: string; max_score: number; guidance: string | null; sort: number }>(db, "SELECT * FROM rfx_template_criteria WHERE step_id = ? ORDER BY sort, id", s.id))
      db.prepare("INSERT INTO rfx_criteria(step_id, criterion, max_score, guidance, sort) VALUES (?,?,?,?,?)").run(sid, c.criterion, c.max_score, c.guidance, c.sort);
  }
  for (const r of all<{ name: string; kind: string; mandatory: number; envelope: string; step_id: number | null; instructions: string | null; sort: number }>(db, "SELECT * FROM rfx_template_requirements WHERE template_id = ? ORDER BY sort, id", templateId))
    db.prepare("INSERT INTO rfx_requirements(rfx_id, name, kind, mandatory, envelope, step_id, instructions, sort) VALUES (?,?,?,?,?,?,?,?)").run(rfxId, r.name, r.kind, r.mandatory, r.envelope, r.step_id ? stepMap.get(r.step_id) ?? null : null, r.instructions, r.sort);
  db.prepare(`UPDATE rfx_tenders SET template_id = ?, evaluation_method = ?, tech_weight = ?, commercial_weight = ?, tech_pass_mark = ?, bid_bond_pct = ?, performance_bond_pct = ?, validity_days = ?, min_bidders = ? WHERE id = ?`)
    .run(templateId, t.evaluation_method, t.tech_weight, t.commercial_weight, t.tech_pass_mark, t.bid_bond_pct, t.performance_bond_pct, t.default_validity_days, t.min_bidders, rfxId);
}

export interface DraftInput {
  entityId: number; userId: number | null; projectId: number; scopeKind: "project" | "subproject" | "stages"; stageIds: number[]; title: string; description?: string | null;
  categoryId: number | null; templateId: number | null; procedure?: "open" | "selective"; ownerId?: number | null; createdAt?: string; code?: string;
  /** seeds only: skip the "stage is free" check (historic tenders cover stages that are assigned today) */ force?: boolean;
}
/** Creates a draft tender: scope, template copy (steps, criteria, requirements), BOQ prefill + estimate, contract dates, default committee. Returns the id. */
export function createDraft(db: DB, d: DraftInput): number {
  const proj = one<{ id: number; entity_id: number; manager_id: number | null; parent_id: number | null }>(db, "SELECT id, entity_id, manager_id, parent_id FROM projects WHERE id = ?", d.projectId);
  if (!proj || proj.entity_id !== d.entityId) throw new RfxError("Project not found");
  if (!d.title.trim()) throw new RfxError("Title is required.");
  let stageIds = d.stageIds;
  if (d.scopeKind === "stages") {
    if (!stageIds.length) throw new RfxError("Choose at least one stage.");
    const av = stageAvailability(db, d.projectId);
    for (const id of stageIds) {
      const s = av.find((x) => x.id === id);
      if (!s) throw new RfxError("A selected stage does not belong to the project.");
      if (s.blocked && !d.force) throw new RfxError(`${s.code ?? s.name}: ${s.blocked}.`);
    }
  } else {
    stageIds = stageAvailability(db, d.projectId).filter((s) => !s.blocked || d.force).map((s) => s.id);
    if (!stageIds.length) throw new RfxError("Every stage of this project is already assigned or out to tender.");
    if (d.scopeKind === "subproject" && !proj.parent_id) throw new RfxError("Choose a sub-project (or use the whole project scope).");
  }
  const dec = entityDecimals(db, d.entityId);
  const code = d.code ?? nextRfxCode(db, d.entityId);
  const id = Number(db.prepare(`INSERT INTO rfx_tenders(entity_id, code, title, description, project_id, scope_kind, category_id, procedure, owner_id, status, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?, ?)`).run(d.entityId, code, d.title.trim(), d.description?.trim() || null, d.projectId, d.scopeKind, d.categoryId, d.procedure ?? "open", d.ownerId ?? d.userId, d.userId, sqlNow(d.createdAt)).lastInsertRowid);
  if (d.scopeKind === "stages") for (const s of stageIds) db.prepare("INSERT INTO rfx_scope(rfx_id, stage_id) VALUES (?,?)").run(id, s);
  db.prepare("UPDATE rfx_tenders SET payment_terms = ? WHERE id = ?").run("Monthly certified invoices, advance recovered pro-rata, retention held until completion, payment within the agreed days of certification.", id);
  if (d.templateId) copyTemplateInto(db, id, d.templateId);
  replaceBoq(db, id, prefillBoq(db, stageIds, dec), dec);
  const dates = one<{ s: string | null; e: string | null }>(db, `SELECT MIN(planned_start) s, MAX(planned_end) e FROM stages WHERE id IN (${stageIds.map(Number).join(",") || "NULL"})`);
  db.prepare("UPDATE rfx_tenders SET contract_start = ?, contract_end = ? WHERE id = ?").run(dates?.s ?? null, dates?.e ?? null, id);
  // default board: the owner is the secretary (marks the pass / fail gates), the project manager scores the scored steps
  const owner = d.ownerId ?? d.userId;
  const stepIds = (gate: string) => JSON.stringify(all<{ id: number }>(db, "SELECT id FROM rfx_steps WHERE rfx_id = ? AND gate = ? AND kind <> 'commercial' ORDER BY sort", id, gate).map((x) => x.id));
  if (owner) db.prepare("INSERT OR IGNORE INTO rfx_committee(rfx_id, user_id, role, steps) VALUES (?,?, 'secretary', ?)").run(id, owner, stepIds("pass_fail"));
  if (proj.manager_id && proj.manager_id !== owner) db.prepare("INSERT OR IGNORE INTO rfx_committee(rfx_id, user_id, role, steps) VALUES (?,?, 'member', ?)").run(id, proj.manager_id, stepIds("scored"));
  logRfx(db, id, "created", `Supplier tender ${code} created as a draft`, d.userId, d.createdAt);
  return id;
}
export const entityDecimals = (db: DB, entityId: number): number => ((one<{ currency: string }>(db, "SELECT currency FROM entities WHERE id = ?", entityId)?.currency ?? "AED") === "OMR" ? 3 : 2);

/** Problems that stop a draft from being submitted for approval (empty = ready). */
export function publishBlockers(db: DB, rfx: RfxRow): string[] {
  const out: string[] = [];
  if (rfx.status !== "draft") out.push("Only a draft can be submitted for approval.");
  const d = validateRfxDates(rfx, true);
  if (d) out.push(d);
  if (!rfx.category_id) out.push("Choose the supplier category.");
  if (!rfx.template_id && !one<{ c: number }>(db, "SELECT COUNT(*) c FROM rfx_steps WHERE rfx_id = ?", rfx.id)!.c) out.push("Choose a template (evaluation steps) for the tender.");
  if (!one<{ c: number }>(db, "SELECT COUNT(*) c FROM rfx_boq_lines WHERE rfx_id = ?", rfx.id)!.c) out.push("Add at least one BOQ line.");
  if (!one<{ c: number }>(db, "SELECT COUNT(*) c FROM rfx_committee WHERE rfx_id = ? AND role IN ('chair', 'member')", rfx.id)!.c) out.push("Add at least one evaluating committee member.");
  if (rfx.procedure === "selective" && !one<{ c: number }>(db, "SELECT COUNT(*) c FROM rfx_invitations WHERE rfx_id = ?", rfx.id)!.c) out.push("A selective tender needs at least one invited supplier.");
  if (rfx.closing_at && Date.parse(rfx.closing_at) <= Date.now() && !rfx.publish_at) out.push("The closing date is in the past.");
  return out;
}

/* ------------------------------------------------------------------ eligibility, invitations, publishing */

/** Approved suppliers of the tender's country whose category is approved and that have no blocking expired document (open procedure pool). */
export function eligibleSupplierIds(db: DB, rfx: Pick<RfxRow, "entity_id" | "category_id">, opts: { ignoreBlockers?: boolean } = {}): number[] {
  const rows = all<{ id: number }>(db, `SELECT s.id FROM subcontractors s WHERE s.entity_id = ? AND s.registration_status = 'approved' AND s.status = 'approved'
    ${rfx.category_id ? "AND EXISTS (SELECT 1 FROM subcontractor_categories sc WHERE sc.subcontractor_id = s.id AND sc.category_id = ? AND sc.status = 'approved')" : ""} ORDER BY s.id`,
    ...(rfx.category_id ? [rfx.entity_id, rfx.category_id] : [rfx.entity_id]));
  return rows.map((r) => r.id).filter((id) => opts.ignoreBlockers || bidBlockers(db, id).length === 0);
}
/** May the supplier see this (published or later) tender: invited, or open procedure + approved category + same country. */
export function isEligibleToView(db: DB, rfx: RfxRow, subId: number): boolean {
  if (one(db, "SELECT 1 FROM rfx_invitations WHERE rfx_id = ? AND subcontractor_id = ?", rfx.id, subId)) return true;
  if (rfx.procedure !== "open") return false;
  return eligibleSupplierIds(db, rfx, { ignoreBlockers: true }).includes(subId);
}

/** Sends the invitation mail + notification and creates the invitation row. */
export function invite(db: DB, rfx: RfxRow, subId: number, source: "eligible" | "invited", baseUrl: string, at?: string): void {
  db.prepare("INSERT OR IGNORE INTO rfx_invitations(rfx_id, subcontractor_id, invited_at, intent, source) VALUES (?,?,?, 'pending', ?)").run(rfx.id, subId, sqlNow(at), source);
  db.prepare("UPDATE rfx_invitations SET invited_at = COALESCE(invited_at, ?) WHERE rfx_id = ? AND subcontractor_id = ?").run(sqlNow(at), rfx.id, subId);
  const slug = one<{ portal_slug: string | null }>(db, "SELECT portal_slug FROM subcontractors WHERE id = ?", subId)?.portal_slug;
  const cat = rfx.category_id ? one<{ name: string }>(db, "SELECT name FROM supplier_categories WHERE id = ?", rfx.category_id)?.name ?? null : null;
  mailSupplier(db, subId, "tender_invitation", { code: rfx.code, title: rfx.title, category: cat, closingAt: rfx.closing_at ?? "", procedure: rfx.procedure === "open" ? "Open tender" : "Selective tender (invited suppliers)", tenderHref: `/p/${slug}/tenders/${rfx.id}` },
    { baseUrl, related: { type: "rfx", id: rfx.id }, createdAt: at ? sqlNow(at) : undefined });
}

/** Puts an approved draft live: status `published` (or `scheduled` while publish_at lies in the future) and, once live, the invitations (open: every eligible supplier; selective: the invited ones). */
export function applyPublish(db: DB, rfxId: number, o: { actorId: number | null; baseUrl?: string; now?: number }): void {
  const rfx = mustRfx(db, rfxId);
  const now = o.now ?? Date.now();
  if (rfx.publish_at && Date.parse(rfx.publish_at) > now) {
    db.prepare("UPDATE rfx_tenders SET status = 'scheduled' WHERE id = ?").run(rfxId);
    logRfx(db, rfxId, "scheduled", `Approved; publication scheduled for ${rfx.publish_at}`, o.actorId);
    return;
  }
  goLive(db, rfxId, o.actorId, o.baseUrl ?? appBaseUrl(), now);
}
export function goLive(db: DB, rfxId: number, actorId: number | null, baseUrl: string, now = Date.now()): void {
  const rfx = mustRfx(db, rfxId);
  db.prepare("UPDATE rfx_tenders SET status = 'published', published_at = ? WHERE id = ?").run(new Date(now).toISOString(), rfxId);
  const fresh = mustRfx(db, rfxId);
  const ids = rfx.procedure === "selective"
    ? all<{ subcontractor_id: number }>(db, "SELECT subcontractor_id FROM rfx_invitations WHERE rfx_id = ? ORDER BY id", rfxId).map((r) => r.subcontractor_id)
    : eligibleSupplierIds(db, rfx);
  for (const id of ids) invite(db, fresh, id, rfx.procedure === "selective" ? "invited" : "eligible", baseUrl);
  logRfx(db, rfxId, "published", `Published; ${ids.length} supplier${ids.length === 1 ? "" : "s"} invited by e-mail and portal notification`, actorId);
}

/** Lazy status maintenance, called from every read / list: scheduled -> published at publish_at, published -> closed at closing_at. */
export function refreshRfxStatuses(db: DB, now = Date.now()): void {
  const iso = new Date(now).toISOString();
  const due = all<{ id: number; status: string; closing_at: string | null }>(db, "SELECT id, status, closing_at FROM rfx_tenders WHERE (status = 'scheduled' AND publish_at <= ?) OR (status = 'published' AND closing_at <= ?)", iso, iso);
  for (const r of due) {
    if (r.status === "scheduled") goLive(db, r.id, null, appBaseUrl(), now);
    const x = mustRfx(db, r.id);
    if (x.status === "published" && x.closing_at && Date.parse(x.closing_at) <= now) {
      db.prepare("UPDATE rfx_tenders SET status = 'closed', closed_at = ? WHERE id = ?").run(x.closing_at, r.id);
      logRfx(db, r.id, "closed", "Bidding closed (closing date reached)", null, x.closing_at);
    }
  }
}
/** Audited admin / demo action: closes bidding immediately (the closing date moves to now when it lay in the future). */
export function closeBiddingNow(db: DB, rfxId: number, userId: number | null): void {
  const r = mustRfx(db, rfxId);
  if (r.status !== "published") throw new RfxError("Only a published tender can be closed.");
  const now = nowIso();
  db.prepare("UPDATE rfx_tenders SET status = 'closed', closed_at = ?, closing_at = CASE WHEN closing_at > ? THEN ? ELSE closing_at END, opening_at = CASE WHEN opening_at > ? THEN ? ELSE opening_at END WHERE id = ?").run(now, now, now, now, now, rfxId);
  logRfx(db, rfxId, "closed", `Bidding closed now by ${userName(db, userId)} (was due ${r.closing_at ?? "-"})`, userId);
}

/* ------------------------------------------------------------------ clarifications + addenda */

/** Suppliers that hold an invitation (invited, or viewed / bid on an open tender). */
export const tenderParticipants = (db: DB, rfxId: number): number[] => all<{ subcontractor_id: number }>(db,
  "SELECT subcontractor_id FROM rfx_invitations WHERE rfx_id = ? UNION SELECT subcontractor_id FROM rfx_bids WHERE rfx_id = ? AND status <> 'late_refused'", rfxId, rfxId).map((r) => r.subcontractor_id);

export function askQuestion(db: DB, rfxId: number, subId: number, question: string, now = Date.now()): number {
  const r = mustRfx(db, rfxId);
  if (r.status !== "published") throw new RfxError("Questions can only be asked while the tender is published.");
  if (r.clarification_deadline && Date.parse(r.clarification_deadline) < now) throw new RfxError("The clarification deadline has passed.");
  if (!question.trim()) throw new RfxError("Write your question.");
  const id = Number(db.prepare("INSERT INTO rfx_clarifications(rfx_id, subcontractor_id, question, asked_at) VALUES (?,?,?,?)").run(rfxId, subId, question.trim(), sqlNow()).lastInsertRowid);
  logRfx(db, rfxId, "clarification", `A bidder asked a question (clarification #${id})`, null);
  return id;
}
/** Publishes the answer (anonymously: the asker's identity is never shown) to every participant and sends the e-mail. */
export function answerClarification(db: DB, id: number, answer: string, userId: number, baseUrl: string): void {
  const c = one<{ id: number; rfx_id: number; question: string }>(db, "SELECT id, rfx_id, question FROM rfx_clarifications WHERE id = ?", id);
  if (!c) throw new RfxError("Question not found");
  if (!answer.trim()) throw new RfxError("Write the answer.");
  const r = mustRfx(db, c.rfx_id);
  db.prepare("UPDATE rfx_clarifications SET answer = ?, answered_by = ?, published_at = ? WHERE id = ?").run(answer.trim(), userId, sqlNow(), id);
  for (const sid of tenderParticipants(db, r.id)) {
    const slug = one<{ portal_slug: string | null }>(db, "SELECT portal_slug FROM subcontractors WHERE id = ?", sid)?.portal_slug;
    mailSupplier(db, sid, "clarification_answered", { code: r.code, title: r.title, question: c.question, answer: answer.trim(), tenderHref: `/p/${slug}/tenders/${r.id}` }, { baseUrl, related: { type: "rfx", id: r.id } });
  }
  logRfx(db, r.id, "clarification", `Clarification #${id} answered and published to all bidders`, userId);
}
export function issueAddendum(db: DB, rfxId: number, a: { title: string; description?: string | null; attachmentId?: number | null; newClosingAt?: string | null }, userId: number | null, baseUrl: string, at?: string): number {
  const r = mustRfx(db, rfxId);
  if (r.status !== "published") throw new RfxError("Addenda can only be issued while the tender is published.");
  if (!a.title.trim()) throw new RfxError("Addendum title is required.");
  if (a.newClosingAt && Date.parse(a.newClosingAt) <= Date.parse(r.closing_at ?? "")) throw new RfxError("The new closing date must be later than the current one.");
  const no = (one<{ n: number }>(db, "SELECT COALESCE(MAX(no), 0) n FROM rfx_addenda WHERE rfx_id = ?", rfxId)?.n ?? 0) + 1;
  const id = Number(db.prepare("INSERT INTO rfx_addenda(rfx_id, no, title, description, attachment_id, new_closing_at, issued_by, issued_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(rfxId, no, a.title.trim(), a.description?.trim() || null, a.attachmentId ?? null, a.newClosingAt ?? null, userId, sqlNow(at)).lastInsertRowid);
  if (a.newClosingAt) {
    db.prepare("UPDATE rfx_tenders SET closing_at = ?, opening_at = CASE WHEN opening_at IS NULL OR opening_at < ? THEN ? ELSE opening_at END WHERE id = ?").run(a.newClosingAt, a.newClosingAt, a.newClosingAt, rfxId);
  }
  for (const sid of tenderParticipants(db, rfxId)) {
    const slug = one<{ portal_slug: string | null }>(db, "SELECT portal_slug FROM subcontractors WHERE id = ?", sid)?.portal_slug;
    mailSupplier(db, sid, "addendum_issued", { code: r.code, title: r.title, no, addendumTitle: a.title.trim(), description: a.description?.trim() || null, newClosingAt: a.newClosingAt ?? null, tenderHref: `/p/${slug}/tenders/${r.id}` }, { baseUrl, related: { type: "rfx", id: r.id }, createdAt: at ? sqlNow(at) : undefined });
  }
  logRfx(db, rfxId, "addendum", `Addendum ${no} issued: ${a.title.trim()}${a.newClosingAt ? ` (closing moved to ${a.newClosingAt})` : ""}`, userId, at);
  return id;
}
export function ackAddendum(db: DB, addendumId: number, subId: number, byName: string): void {
  const a = one<{ rfx_id: number }>(db, "SELECT rfx_id FROM rfx_addenda WHERE id = ?", addendumId);
  if (!a) throw new RfxError("Addendum not found");
  db.prepare("INSERT OR IGNORE INTO rfx_addendum_acks(addendum_id, subcontractor_id, acked_at, acked_by_name) VALUES (?,?,?,?)").run(addendumId, subId, sqlNow(), byName);
  logRfx(db, a.rfx_id, "addendum", `${supplierName(db, subId)} acknowledged addendum #${addendumId}`, null);
}
export const unackedAddenda = (db: DB, rfxId: number, subId: number): { id: number; no: number; title: string }[] =>
  all(db, "SELECT a.id, a.no, a.title FROM rfx_addenda a WHERE a.rfx_id = ? AND NOT EXISTS (SELECT 1 FROM rfx_addendum_acks k WHERE k.addendum_id = a.id AND k.subcontractor_id = ?) ORDER BY a.no", rfxId, subId);

/* ------------------------------------------------------------------ cancel */

/** Cancels a tender before the award; notifies every bidder / invitee by portal notification (no competitor data). */
export function cancelRfx(db: DB, rfxId: number, reason: string, userId: number | null): void {
  const r = mustRfx(db, rfxId);
  if (r.status === "awarded") throw new RfxError("An awarded tender cannot be cancelled.");
  if (r.status === "cancelled") throw new RfxError("The tender is already cancelled.");
  if (!reason.trim()) throw new RfxError("A cancellation reason is required.");
  db.prepare("UPDATE rfx_tenders SET status = 'cancelled', cancel_reason = ? WHERE id = ?").run(reason.trim(), rfxId);
  db.prepare("UPDATE rfx_bids SET status = 'withdrawn' WHERE rfx_id = ? AND status IN ('draft', 'submitted', 'qualified')").run(rfxId);
  if (r.status !== "draft" && r.status !== "pending_approval") {
    for (const sid of tenderParticipants(db, rfxId)) {
      const slug = one<{ portal_slug: string | null }>(db, "SELECT portal_slug FROM subcontractors WHERE id = ?", sid)?.portal_slug;
      db.prepare("INSERT INTO portal_notifications(subcontractor_id, portal_user_id, kind, title, body, href, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(sid, null, "tender_cancelled", `Tender ${r.code} was cancelled`, `${r.title}: ${reason.trim()}`.slice(0, 240), `/p/${slug}/tenders/${r.id}`, nowIso());
    }
  }
  logRfx(db, rfxId, "cancelled", `Tender cancelled: ${reason.trim()}`, userId);
}

/* ------------------------------------------------------------------ committee */

export function committeeOf(db: DB, rfxId: number): CommitteeRow[] {
  return all<CommitteeRow>(db, `SELECT c.*, u.name FROM rfx_committee c JOIN users u ON u.id = c.user_id WHERE c.rfx_id = ?
    ORDER BY CASE c.role WHEN 'chair' THEN 0 WHEN 'secretary' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, c.id`, rfxId);
}
/** Board members who may mark / score (chair, members, secretary; observers never), without a declared conflict of interest, and assigned to the step (steps NULL = every step). */
export const evaluatorsOf = (db: DB, rfxId: number, stepId?: number): CommitteeRow[] => committeeOf(db, rfxId).filter((m) => ["chair", "member", "secretary"].includes(m.role) && !m.coi_conflict
  && (stepId === undefined || !m.steps || (JSON.parse(m.steps) as number[]).includes(stepId)));
export function stepsOf(db: DB, rfxId: number): StepRow[] { return all<StepRow>(db, "SELECT * FROM rfx_steps WHERE rfx_id = ? ORDER BY sort, id", rfxId); }
export function criteriaOf(db: DB, rfxId: number): CriterionRow[] { return all<CriterionRow>(db, "SELECT c.* FROM rfx_criteria c JOIN rfx_steps s ON s.id = c.step_id WHERE s.rfx_id = ? ORDER BY s.sort, c.sort, c.id", rfxId); }
export function requirementsOf(db: DB, rfxId: number): RequirementRow[] { return all<RequirementRow>(db, "SELECT * FROM rfx_requirements WHERE rfx_id = ? ORDER BY sort, id", rfxId); }
export function boqOf(db: DB, rfxId: number): BoqRow[] { return all<BoqRow>(db, "SELECT * FROM rfx_boq_lines WHERE rfx_id = ? ORDER BY sort, id", rfxId); }
