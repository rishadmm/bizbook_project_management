// Supplier tender evaluation, recommendation and award (SUPPLIER_TENDERING_SPEC B2). Synchronous, no next/* imports, relative imports only.
//   pass_fail steps: every requirement of the step is marked compliant / non-compliant;
//   scored steps:   each evaluator scores each criterion 0..max; step score = average over the evaluators of (criteria total / max x 100);
//   a bid that fails a gate or scores below the pass mark is disqualified from the next steps (reason kept); the commercial step ranks the qualified bids.
import type { DB } from "../../lib/db";
import { formatMoney } from "../../lib/format";
import { mailSupplier } from "../../lib/mailer";
import {
  RECEIVED_BID_STATUSES, averagePercent, commercialScore, decimalsOf, evaluatorPercent, finalScore, isTwoEnvelope, isWeighted, rankBids, roundTo, technicalScore,
} from "../../lib/rfx";
import { insertAssignment } from "../projects/assignment-core";
import { getBid, internalPrices, priceVisible, sealOf, type BidRow } from "./bid-core";
import {
  RfxError, boqOf, committeeOf, criteriaOf, entityCurrency, evaluatorsOf, logRfx, mustRfx, nowIso, requirementsOf, scopeStageIds, sqlNow, stepsOf, supplierName, userName,
  type CriterionRow, type RequirementRow, type RfxRow, type StepRow,
} from "./rfx-core";

const one = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as never[])) as T | undefined;
const all = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[];

export type CellState = "pass" | "fail" | "pending" | "partial" | "skipped" | "locked" | "na";
export interface StepCell { stepId: number; state: CellState; score: number | null; reason: string | null; done: number; total: number }
export interface MatrixRow { bidId: number; status: string; cells: StepCell[]; tech: number | null; qualified: boolean; dq: { stepId: number; reason: string } | null; price: number | null; commercial: number | null; final: number | null; rank: number | null }

/** Computes the evaluation matrix of every received bid from the raw marks / scores (optionally persists statuses, scores and ranks on the bids). */
export function evaluate(db: DB, rfxId: number, persist = false): { rfx: RfxRow; steps: StepRow[]; rows: MatrixRow[] } {
  const rfx = mustRfx(db, rfxId);
  const seal = sealOf(db, rfx);
  const steps = stepsOf(db, rfxId);
  const technicalSteps = steps.filter((s) => s.kind !== "commercial");
  const criteria = criteriaOf(db, rfxId);
  const reqs = requirementsOf(db, rfxId);
  const bids = seal.techOpen ? all<BidRow>(db, `SELECT * FROM rfx_bids WHERE rfx_id = ? AND status IN ('submitted', 'qualified', 'disqualified', 'awarded', 'unsuccessful') AND submitted_at IS NOT NULL ORDER BY submitted_at, id`, rfxId) : [];
  const rows: MatrixRow[] = [];
  for (const b of bids) {
    let dq: MatrixRow["dq"] = null, blocked = false;
    const cells: StepCell[] = [];
    const parts: { score: number | null; weight: number | null }[] = [];
    for (const s of technicalSteps) {
      if (dq) { cells.push({ stepId: s.id, state: "skipped", score: null, reason: null, done: 0, total: 0 }); continue; }
      if (blocked) { cells.push({ stepId: s.id, state: "locked", score: null, reason: null, done: 0, total: 0 }); continue; }
      const cell = stepCell(db, rfx, s, b.id, criteria.filter((c) => c.step_id === s.id), reqs.filter((r) => r.step_id === s.id && (r.envelope === "technical" || seal.priceOpen)));
      cells.push(cell);
      if (s.gate === "scored") parts.push({ score: cell.score, weight: s.weight });
      if (cell.state === "fail") dq = { stepId: s.id, reason: cell.reason ?? `${s.name}: not compliant` };
      else if (cell.state === "pending" || cell.state === "partial") blocked = true;
    }
    const qualified = !dq && !blocked;
    rows.push({ bidId: b.id, status: b.status, cells, tech: technicalScore(parts), qualified, dq, price: null, commercial: null, final: null, rank: null });
  }
  // commercial step: only the technically qualified bids, once the price envelope is open
  if (seal.priceOpen) {
    const live = rows.filter((r) => r.qualified); // qualified bids only: their prices are open (single envelope: all prices open, two-envelope: the technically qualified ones)
    for (const r of live) r.price = getBid(db, r.bidId)?.total_amount ?? null;
    const lowest = Math.min(...live.map((r) => r.price ?? Infinity));
    for (const r of live) {
      r.commercial = r.price ? commercialScore(lowest, r.price) : null;
      r.final = rfx.evaluation_method === "lowest_compliant" ? r.commercial : finalScore(r.tech, r.commercial, rfx.tech_weight, rfx.commercial_weight);
    }
    const ranked = rankBids(live.map((r) => ({ id: r.bidId, price: r.price, final: r.final, submitted_at: bids.find((b) => b.id === r.bidId)?.submitted_at ?? null })), rfx.evaluation_method);
    for (const k of ranked) rows.find((r) => r.bidId === k.id)!.rank = k.rank;
  }
  if (persist) {
    for (const r of rows) {
      const keep = ["awarded", "unsuccessful"].includes(r.status);
      const status = keep ? r.status : r.dq ? "disqualified" : r.qualified ? "qualified" : "submitted";
      db.prepare("UPDATE rfx_bids SET status = ?, disqualified_step = ?, disqualify_reason = ?, tech_score = ?, commercial_score = ?, final_score = ?, rank = ? WHERE id = ?")
        .run(status, r.dq?.stepId ?? null, r.dq?.reason ?? null, r.tech === null ? null : roundTo(r.tech, 2), r.commercial === null ? null : roundTo(r.commercial, 2), r.final === null ? null : roundTo(r.final, 2), r.rank, r.bidId);
      r.status = status;
    }
  }
  return { rfx, steps, rows };
}
export const refreshEvaluation = (db: DB, rfxId: number) => evaluate(db, rfxId, true);

function stepCell(db: DB, rfx: RfxRow, s: StepRow, bidId: number, crit: CriterionRow[], reqs: RequirementRow[]): StepCell {
  if (s.gate === "pass_fail") {
    const resp = new Map(all<{ requirement_id: number; compliant: number | null; eval_comment: string | null }>(db, "SELECT requirement_id, compliant, eval_comment FROM rfx_bid_responses WHERE bid_id = ?", bidId).map((r) => [r.requirement_id, r]));
    if (reqs.length) {
      const mandatory = reqs.filter((r) => r.mandatory);
      const bad = mandatory.find((r) => resp.get(r.id)?.compliant === 0);
      if (bad) return { stepId: s.id, state: "fail", score: null, reason: `${s.name}: ${bad.name}${resp.get(bad.id)?.eval_comment ? ` - ${resp.get(bad.id)!.eval_comment}` : " is not compliant"}`, done: 0, total: mandatory.length };
      const done = mandatory.filter((r) => resp.get(r.id)?.compliant === 1).length;
      return { stepId: s.id, state: done === mandatory.length ? "pass" : done === 0 ? "pending" : "partial", score: null, reason: null, done, total: mandatory.length };
    }
    // a gate without requirements is decided by the evaluators' compliant marks
    const marks = all<{ compliant: number | null; comment: string | null }>(db, "SELECT compliant, comment FROM rfx_scores WHERE bid_id = ? AND step_id = ? AND criterion_id IS NULL", bidId, s.id);
    const ev = evaluatorsOf(db, rfx.id, s.id).length || 1;
    const bad = marks.find((m) => m.compliant === 0);
    if (bad) return { stepId: s.id, state: "fail", score: null, reason: `${s.name}: ${bad.comment ?? "not compliant"}`, done: marks.length, total: ev };
    return { stepId: s.id, state: marks.length >= ev ? "pass" : marks.length ? "partial" : "pending", score: null, reason: null, done: marks.length, total: ev };
  }
  const evaluators = evaluatorsOf(db, rfx.id, s.id);
  if (!crit.length) return { stepId: s.id, state: "pass", score: null, reason: null, done: 0, total: 0 };
  const rows = all<{ evaluator_id: number; criterion_id: number; score: number }>(db, "SELECT evaluator_id, criterion_id, score FROM rfx_scores WHERE bid_id = ? AND step_id = ? AND criterion_id IS NOT NULL AND score IS NOT NULL", bidId, s.id);
  const maxOf = new Map(crit.map((c) => [c.id, c.max_score]));
  const percents: number[] = [];
  for (const e of evaluators) {
    const mine = rows.filter((r) => r.evaluator_id === e.user_id && maxOf.has(r.criterion_id));
    if (mine.length === crit.length) percents.push(evaluatorPercent(mine.map((r) => ({ score: r.score, max: maxOf.get(r.criterion_id)! }))));
  }
  const score = averagePercent(percents);
  const total = evaluators.length;
  if (!percents.length) return { stepId: s.id, state: "pending", score: null, reason: null, done: 0, total };
  if (percents.length < total) return { stepId: s.id, state: "partial", score, reason: null, done: percents.length, total };
  const pass = s.pass_mark ?? (s.kind === "technical" ? rfx.tech_pass_mark : 0);
  return score !== null && score >= pass ? { stepId: s.id, state: "pass", score, reason: null, done: percents.length, total }
    : { stepId: s.id, state: "fail", score, reason: `${s.name}: score ${score?.toFixed(1)} is below the pass mark ${pass}`, done: percents.length, total };
}

/** Gate of the commercial opening (two-envelope): every received bid is decided on the technical steps and at least one qualified. */
export function commercialGate(db: DB, rfxId: number): string | null {
  const { rows } = evaluate(db, rfxId);
  if (!rows.length) return "No bids to evaluate.";
  if (rows.some((r) => !r.dq && !r.qualified)) return "Complete the technical evaluation of every bid first.";
  if (!rows.some((r) => r.qualified)) return "No bid passed the technical evaluation: nothing to open.";
  return null;
}

/* ------------------------------------------------------------------ evaluation entry (committee members only) */

export function startEvaluation(db: DB, rfxId: number, userId: number | null): void {
  const rfx = mustRfx(db, rfxId);
  if (rfx.status !== "opening") throw new RfxError("Record the opening first.");
  if (!committeeOf(db, rfxId).some((m) => ["chair", "member", "secretary"].includes(m.role))) throw new RfxError("The tender board has no evaluating member.");
  db.prepare("UPDATE rfx_tenders SET status = 'evaluation' WHERE id = ?").run(rfxId);
  refreshEvaluation(db, rfxId);
  logRfx(db, rfxId, "evaluation", "Evaluation started", userId);
}
export function declareCoi(db: DB, rfxId: number, userId: number, conflict: boolean, note: string | null): void {
  const m = one<{ id: number }>(db, "SELECT id FROM rfx_committee WHERE rfx_id = ? AND user_id = ?", rfxId, userId);
  if (!m) throw new RfxError("You are not a member of this tender board.");
  if (conflict && !note?.trim()) throw new RfxError("Describe the conflict of interest (which bidder you are linked to).");
  db.prepare("UPDATE rfx_committee SET coi_declared_at = ?, coi_conflict = ?, coi_note = ? WHERE id = ?").run(nowIso(), conflict ? 1 : 0, note?.trim() || null, m.id);
  logRfx(db, rfxId, "evaluation", `${userName(db, userId)} declared ${conflict ? "a conflict of interest and is excluded from scoring" : "no conflict of interest"}`, userId);
}
function scorer(db: DB, rfx: RfxRow, userId: number, stepId: number): void {
  if (rfx.status !== "evaluation") throw new RfxError("The tender is not in evaluation.");
  const m = committeeOf(db, rfx.id).find((x) => x.user_id === userId);
  if (!m || !["chair", "member", "secretary"].includes(m.role)) throw new RfxError("Only evaluating members of this tender board can score.");
  if (m.coi_conflict) throw new RfxError("You declared a conflict of interest and cannot score this tender.");
  if (!m.coi_declared_at) throw new RfxError("Declare your conflict-of-interest status before scoring.");
  if (!evaluatorsOf(db, rfx.id, stepId).some((x) => x.user_id === userId)) throw new RfxError("You are not assigned to evaluate this step.");
}
function reached(db: DB, rfxId: number, bidId: number, stepId: number): void {
  const row = evaluate(db, rfxId).rows.find((r) => r.bidId === bidId);
  const cell = row?.cells.find((c) => c.stepId === stepId);
  if (!row || !cell) throw new RfxError("This bid is not in the evaluation.");
  if (["skipped", "locked"].includes(cell.state)) throw new RfxError(cell.state === "skipped" ? "The bid was disqualified in an earlier step." : "Finish the earlier steps for this bid first.");
}
export function setScore(db: DB, o: { bidId: number; stepId: number; criterionId: number; evaluatorId: number; score: number; comment: string | null }): void {
  const bid = getBid(db, o.bidId);
  if (!bid) throw new RfxError("Bid not found");
  const rfx = mustRfx(db, bid.rfx_id);
  scorer(db, rfx, o.evaluatorId, o.stepId);
  const step = one<StepRow>(db, "SELECT * FROM rfx_steps WHERE id = ? AND rfx_id = ?", o.stepId, rfx.id);
  const crit = one<CriterionRow>(db, "SELECT * FROM rfx_criteria WHERE id = ? AND step_id = ?", o.criterionId, o.stepId);
  if (!step || step.gate !== "scored" || !crit) throw new RfxError("Unknown criterion.");
  if (!Number.isFinite(o.score) || o.score < 0 || o.score > crit.max_score) throw new RfxError(`The score must be between 0 and ${crit.max_score}.`);
  reached(db, rfx.id, o.bidId, o.stepId);
  db.prepare(`INSERT INTO rfx_scores(bid_id, step_id, criterion_id, evaluator_id, score, comment, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(bid_id, step_id, COALESCE(criterion_id, 0), evaluator_id) DO UPDATE SET score = excluded.score, comment = excluded.comment, created_at = excluded.created_at`)
    .run(o.bidId, o.stepId, o.criterionId, o.evaluatorId, o.score, o.comment?.trim() || null, sqlNow());
  refreshEvaluation(db, rfx.id);
  logRfx(db, rfx.id, "evaluation", `${userName(db, o.evaluatorId)} scored ${step.name}: ${crit.criterion}`, o.evaluatorId);
}
/** Marks one requirement of a bid compliant / non-compliant (pass-fail steps). */
export function markCompliance(db: DB, o: { bidId: number; requirementId: number; compliant: boolean; comment: string | null; evaluatorId: number }): void {
  const bid = getBid(db, o.bidId);
  if (!bid) throw new RfxError("Bid not found");
  const rfx = mustRfx(db, bid.rfx_id);
  const req = one<RequirementRow>(db, "SELECT * FROM rfx_requirements WHERE id = ? AND rfx_id = ?", o.requirementId, rfx.id);
  if (!req || !req.step_id) throw new RfxError("This requirement is not part of an evaluation step.");
  scorer(db, rfx, o.evaluatorId, req.step_id);
  if (!o.compliant && !o.comment?.trim()) throw new RfxError("Add a comment for a non-compliant mark.");
  if (req.envelope === "commercial" && !priceVisible(sealOf(db, rfx), bid.status)) throw new RfxError("The commercial envelope is still sealed.");
  reached(db, rfx.id, o.bidId, req.step_id);
  db.prepare(`INSERT INTO rfx_bid_responses(bid_id, requirement_id, compliant, eval_comment) VALUES (?,?,?,?) ON CONFLICT(bid_id, requirement_id) DO UPDATE SET compliant = excluded.compliant, eval_comment = excluded.eval_comment`)
    .run(o.bidId, o.requirementId, o.compliant ? 1 : 0, o.comment?.trim() || null);
  refreshEvaluation(db, rfx.id);
  logRfx(db, rfx.id, "evaluation", `${userName(db, o.evaluatorId)} marked "${req.name}" ${o.compliant ? "compliant" : "non-compliant"}`, o.evaluatorId);
}

/* ------------------------------------------------------------------ recommendation + sign-off */

export function recommendBid(db: DB, rfxId: number, bidId: number, o: { justification: string; value: number | null }, userId: number): void {
  const rfx = mustRfx(db, rfxId);
  if (rfx.status !== "evaluation") throw new RfxError("Only a tender in evaluation can be recommended.");
  const seal = sealOf(db, rfx);
  if (!seal.priceOpen) throw new RfxError("Open the price envelopes before recommending a bidder.");
  const { rows } = evaluate(db, rfxId, true);
  if (rows.some((r) => !r.dq && !r.qualified)) throw new RfxError("Finish the evaluation of every bid first.");
  const row = rows.find((r) => r.bidId === bidId);
  if (!row || !row.qualified || !row.rank) throw new RfxError("Only a qualified, ranked bid can be recommended.");
  if (row.rank !== 1 && !o.justification.trim()) throw new RfxError("A justification is mandatory when the recommended bid is not rank 1.");
  const bid = getBid(db, bidId)!;
  const value = o.value && o.value > 0 ? o.value : bid.total_amount ?? 0;
  if (!(value > 0)) throw new RfxError("The award value must be positive.");
  db.prepare("UPDATE rfx_tenders SET status = 'recommended', recommended_bid_id = ?, recommendation_note = ?, award_value = ?, recommended_by = ?, recommended_at = ? WHERE id = ?")
    .run(bidId, o.justification.trim() || null, roundTo(value, decimalsOf(entityCurrency(db, rfx.entity_id))), userId, nowIso(), rfxId);
  db.prepare("DELETE FROM rfx_signoffs WHERE rfx_id = ?").run(rfxId);
  logRfx(db, rfxId, "recommendation", `${userName(db, userId)} recommended ${supplierName(db, bid.subcontractor_id)} (rank ${row.rank}) at ${formatMoney(value, { currency: entityCurrency(db, rfx.entity_id), decimals: 3 })}`, userId);
}
export function withdrawRecommendation(db: DB, rfxId: number, userId: number): void {
  const rfx = mustRfx(db, rfxId);
  if (rfx.status !== "recommended") throw new RfxError("There is no open recommendation to withdraw.");
  db.prepare("UPDATE rfx_tenders SET status = 'evaluation', recommended_bid_id = NULL, recommendation_note = NULL, award_value = NULL WHERE id = ?").run(rfxId);
  db.prepare("DELETE FROM rfx_signoffs WHERE rfx_id = ?").run(rfxId);
  logRfx(db, rfxId, "recommendation", "Recommendation withdrawn; the tender is back in evaluation", userId);
}
export function signOff(db: DB, rfxId: number, userId: number, decision: "concur" | "dissent", comment: string | null): void {
  const rfx = mustRfx(db, rfxId);
  if (!["recommended", "award_pending"].includes(rfx.status)) throw new RfxError("There is no recommendation to sign off.");
  const m = committeeOf(db, rfxId).find((x) => x.user_id === userId);
  if (!m || !["chair", "member"].includes(m.role)) throw new RfxError("Only the chair and members of the tender board sign off.");
  if (decision === "dissent" && !comment?.trim()) throw new RfxError("A comment is required to dissent.");
  db.prepare("INSERT INTO rfx_signoffs(rfx_id, user_id, decision, comment, decided_at) VALUES (?,?,?,?,?) ON CONFLICT(rfx_id, user_id) DO UPDATE SET decision = excluded.decision, comment = excluded.comment, decided_at = excluded.decided_at")
    .run(rfxId, userId, decision, comment?.trim() || null, nowIso());
  logRfx(db, rfxId, "recommendation", `${userName(db, userId)} ${decision === "concur" ? "concurs with" : "dissents from"} the recommendation`, userId);
}

/** Users that must not decide the award approval: whoever recommended the bidder (separation of duties). */
export const awardExcludedApprovers = (db: DB, rfxId: number): number[] => {
  const r = one<{ recommended_by: number | null }>(db, "SELECT recommended_by FROM rfx_tenders WHERE id = ?", rfxId);
  return r?.recommended_by ? [r.recommended_by] : [];
};
export function awardBlockers(db: DB, rfx: RfxRow): string[] {
  const out: string[] = [];
  if (rfx.status !== "recommended") out.push("Recommend a bidder before submitting the award for approval.");
  if (!rfx.recommended_bid_id || !(rfx.award_value && rfx.award_value > 0)) out.push("The recommendation has no award value.");
  return out;
}

/* ------------------------------------------------------------------ award -> assignment (called by the rfx_award approval handler) */

const fmt = (db: DB, rfx: RfxRow, v: number) => formatMoney(v, { currency: entityCurrency(db, rfx.entity_id), decimals: decimalsOf(entityCurrency(db, rfx.entity_id)) });

/**
 * `rfx_award` onApproved: creates the subcontract through the shared assignment helper (same codes, portal token, FX, activity log as a direct assignment), marks the winning bid awarded and
 * the others unsuccessful, sends the Letter of Award + regret letters and logs on the project, the assignment and the tender. Idempotent.
 */
export function applyAward(db: DB, rfxId: number, o: { actorId: number | null; baseUrl: string; at?: string }): number | null {
  const rfx = mustRfx(db, rfxId);
  if (rfx.status === "awarded" && rfx.assignment_id) return rfx.assignment_id;
  const win = rfx.recommended_bid_id ? getBid(db, rfx.recommended_bid_id) : undefined;
  if (!win) throw new RfxError("There is no recommended bid to award.");
  const value = rfx.award_value && rfx.award_value > 0 ? rfx.award_value : win.total_amount ?? 0;
  const stageIds = scopeStageIds(db, rfx);
  const stage = stageIds.length && rfx.scope_kind === "stages" ? one<{ id: number; code: string | null; planned_start: string | null; planned_end: string | null }>(db, "SELECT id, code, planned_start, planned_end FROM stages WHERE id = ?", stageIds[0]) : undefined;
  const boq = boqOf(db, rfx.id);
  const single = boq.length === 1 && boq[0].quantity > 0 && boq[0].unit !== "lumpsum" ? boq[0] : null;
  const stageCodes = rfx.scope_kind === "stages" && stageIds.length > 1 ? all<{ code: string | null; name: string }>(db, `SELECT code, name FROM stages WHERE id IN (${stageIds.join(",")}) ORDER BY sort, id`).map((s) => s.code ?? s.name).join(", ") : "";
  const scope = `${rfx.title}${stageCodes ? ` (stages ${stageCodes})` : ""}`.slice(0, 240);
  const a = insertAssignment(db, rfx.entity_id, {
    projectId: rfx.project_id, stageId: stage?.id ?? null, subcontractorId: win.subcontractor_id, scope, contractValue: value, quantity: single ? single.quantity : null,
    quantityUnit: single ? single.unit : "lumpsum", unitRate: single ? roundTo(value / single.quantity, 4) : null, startDate: rfx.contract_start ?? stage?.planned_start ?? null,
    endDate: rfx.contract_end ?? stage?.planned_end ?? null, paymentTerms: rfx.payment_terms, advancePct: rfx.advance_pct, retentionPct: rfx.retention_pct, paymentDays: rfx.payment_days,
    status: "active", source: "tender", rfxId: rfx.id, rfxBidId: win.id, portalEnabled: true,
  });
  const when = o.at ? sqlNow(o.at) : sqlNow();
  const log = (type: string, id: number, action: string, msg: string) => db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES (?,?,?,?,?,?)").run(type, id, action, msg, o.actorId, when);
  const winner = supplierName(db, win.subcontractor_id);
  log("assignment", a.id, "created", `Subcontract ${a.code} created from supplier tender ${rfx.code} (awarded to ${winner})`);
  log("project", rfx.project_id, "subcontract", `Subcontract ${a.code} awarded through supplier tender ${rfx.code}`);
  db.prepare("UPDATE rfx_bids SET status = 'awarded' WHERE id = ?").run(win.id);
  db.prepare("UPDATE rfx_bids SET status = 'unsuccessful' WHERE rfx_id = ? AND id <> ? AND status IN ('submitted', 'qualified')").run(rfx.id, win.id);
  db.prepare("UPDATE rfx_tenders SET status = 'awarded', awarded_bid_id = ?, assignment_id = ?, awarded_at = ?, award_value = ? WHERE id = ?").run(win.id, a.id, o.at ?? nowIso(), value, rfx.id);
  log("rfx", rfx.id, "awarded", `Awarded to ${winner} at ${fmt(db, rfx, value)}; subcontract ${a.code} created`);
  sendAwardLetters(db, rfx.id, { assignmentCode: a.code, assignmentId: a.id, baseUrl: o.baseUrl, at: o.at });
  return a.id;
}

/** E-mails the Letter of Award to the winner and the regret letters to every other bidder (outbox + portal notifications). */
export function sendAwardLetters(db: DB, rfxId: number, o: { assignmentCode: string | null; assignmentId: number | null; baseUrl: string; at?: string }): void {
  const rfx = mustRfx(db, rfxId);
  const win = rfx.awarded_bid_id ?? rfx.recommended_bid_id;
  if (!win) return;
  const wb = getBid(db, win)!;
  const slugOf = (id: number) => one<{ portal_slug: string | null }>(db, "SELECT portal_slug FROM subcontractors WHERE id = ?", id)?.portal_slug ?? "";
  const stamp = o.at ? sqlNow(o.at) : undefined;
  mailSupplier(db, wb.subcontractor_id, "award_letter", { code: rfx.code, title: rfx.title, contractValue: fmt(db, rfx, rfx.award_value ?? wb.total_amount ?? 0), assignmentRef: o.assignmentCode, letterHref: `/p/${slugOf(wb.subcontractor_id)}/tenders/${rfx.id}/loa`, portalHref: o.assignmentId ? `/p/${slugOf(wb.subcontractor_id)}/projects/${o.assignmentId}` : `/p/${slugOf(wb.subcontractor_id)}/tenders/${rfx.id}` },
    { baseUrl: o.baseUrl, related: { type: "rfx", id: rfx.id }, createdAt: stamp });
  const others = all<{ subcontractor_id: number }>(db, "SELECT subcontractor_id FROM rfx_bids WHERE rfx_id = ? AND id <> ? AND status IN ('unsuccessful', 'disqualified') AND submitted_at IS NOT NULL ORDER BY id", rfx.id, win);
  for (const b of others) mailSupplier(db, b.subcontractor_id, "regret", { code: rfx.code, title: rfx.title, portalHref: `/p/${slugOf(b.subcontractor_id)}/tenders/${rfx.id}` }, { baseUrl: o.baseUrl, related: { type: "rfx", id: rfx.id }, createdAt: stamp });
}

/** Winner / regret letter data for the Letter of Award PDF. */
export function awardLetterData(db: DB, rfxId: number): { rfx: RfxRow; bid: BidRow; supplier: { id: number; name: string; address: string | null; contact_person: string | null }; assignmentCode: string | null; entity: { legal_name: string; address: string | null; currency: string; vat_rate: number; tax_label: string; tax_no: string | null }; lines: { item_no: string; description: string; unit: string | null; quantity: number; unit_rate: number; amount: number }[] } | null {
  const rfx = mustRfx(db, rfxId);
  const bid = rfx.awarded_bid_id ? getBid(db, rfx.awarded_bid_id) : undefined;
  if (!bid) return null;
  const supplier = one<{ id: number; name: string; address: string | null; contact_person: string | null }>(db, "SELECT id, name, address, contact_person FROM subcontractors WHERE id = ?", bid.subcontractor_id)!;
  const entity = one<{ legal_name: string; address: string | null; currency: string; vat_rate: number; tax_label: string; tax_no: string | null }>(db, "SELECT legal_name, address, currency, vat_rate, tax_label, tax_no FROM entities WHERE id = ?", rfx.entity_id)!;
  const lines = all<{ item_no: string; description: string; unit: string | null; quantity: number; unit_rate: number; amount: number }>(db,
    `SELECT l.item_no, l.description, l.unit, l.quantity, p.unit_rate, p.amount FROM rfx_boq_lines l JOIN rfx_bid_prices p ON p.boq_line_id = l.id AND p.bid_id = ? AND p.version = ? WHERE l.rfx_id = ? ORDER BY l.sort, l.id`, bid.id, bid.price_version, rfx.id);
  const code = rfx.assignment_id ? one<{ code: string | null }>(db, "SELECT code FROM assignments WHERE id = ?", rfx.assignment_id)?.code ?? null : null;
  return { rfx, bid, supplier, entity, assignmentCode: code, lines };
}

export { internalPrices, isTwoEnvelope, isWeighted, RECEIVED_BID_STATUSES };
