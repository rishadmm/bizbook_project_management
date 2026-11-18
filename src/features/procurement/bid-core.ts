// Supplier bids + the SEALED-BID RULE (SUPPLIER_TENDERING_SPEC B2/B3). Synchronous, no next/* imports, relative imports only.
//
// Sealed-bid rule, enforced HERE (query layer) and reused by the files API:
//   - before the first opening, internal users only learn that a bid exists: its number, the submitted-at timestamp and the receipt hash (no bidder, no content, no prices);
//   - two-envelope tenders: the technical envelope opens at `tech_opening`; prices stay sealed until `commercial_opening` and then only for technically qualified bids;
//   - single-envelope tenders: technical content and prices open together at `opening`;
//   - a supplier only ever reads its own bid (portal queries filter by the session's company).
// Every page / action / check that reads bid content or bid money MUST go through internalBids / internalBidDetail / internalPrices below.
import { createHash } from "node:crypto";
import type { DB } from "../../lib/db";
import { mailSupplier } from "../../lib/mailer";
import { RECEIVED_BID_STATUSES, bidTotals, decimalsOf, isTwoEnvelope, receiptPayload, roundTo } from "../../lib/rfx";
import { bidBlockers } from "../supplier-registration/core";
import {
  RfxError, boqOf, entityCurrency, isEligibleToView, logRfx, mustRfx, nowIso, requirementsOf, sqlNow, supplierName, unackedAddenda,
  type BoqRow, type RequirementRow, type RfxRow,
} from "./rfx-core";

const one = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as never[])) as T | undefined;
const all = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[];

export interface BidRow {
  id: number; rfx_id: number; subcontractor_id: number; status: string; submitted_at: string | null; receipt_hash: string | null; revision: number; total_amount: number | null; discount_amount: number; vat_amount: number;
  validity_days: number | null; deviations: string | null; alternative_offer: string | null; bid_bond_ref: string | null; price_version: number; disqualified_step: number | null; disqualify_reason: string | null;
  rank: number | null; tech_score: number | null; commercial_score: number | null; final_score: number | null; bid_bond_received: number; register_note: string | null; created_at: string; updated_at: string | null;
}
export const getBid = (db: DB, id: number): BidRow | undefined => one<BidRow>(db, "SELECT * FROM rfx_bids WHERE id = ?", id);
export const bidOf = (db: DB, rfxId: number, subId: number): BidRow | undefined => one<BidRow>(db, "SELECT * FROM rfx_bids WHERE rfx_id = ? AND subcontractor_id = ?", rfxId, subId);
const vatRateOf = (db: DB, entityId: number): number => one<{ v: number }>(db, "SELECT vat_rate v FROM entities WHERE id = ?", entityId)?.v ?? 5;
const decOf = (db: DB, entityId: number): number => decimalsOf(entityCurrency(db, entityId));

/* ------------------------------------------------------------------ the supplier's own bid */

export const isBiddingOpen = (rfx: Pick<RfxRow, "status" | "closing_at">, now = Date.now()): boolean => rfx.status === "published" && !!rfx.closing_at && Date.parse(rfx.closing_at) > now;

/** Draft bid of a supplier for a tender (created on first use; a withdrawn bid becomes a draft again while bidding is open). */
export function ensureBid(db: DB, rfxId: number, subId: number): BidRow {
  let b = bidOf(db, rfxId, subId);
  if (!b) {
    db.prepare("INSERT INTO rfx_bids(rfx_id, subcontractor_id, status, created_at) VALUES (?,?, 'draft', ?)").run(rfxId, subId, sqlNow());
    b = bidOf(db, rfxId, subId)!;
  } else if (b.status === "withdrawn") {
    db.prepare("UPDATE rfx_bids SET status = 'draft' WHERE id = ?").run(b.id);
    b = bidOf(db, rfxId, subId)!;
  }
  return b;
}
function editable(db: DB, bid: BidRow, now = Date.now()): RfxRow {
  const rfx = mustRfx(db, bid.rfx_id);
  if (!isBiddingOpen(rfx, now)) throw new RfxError("Bidding is closed: the bid can no longer be changed.");
  if (!["draft", "submitted"].includes(bid.status)) throw new RfxError("This bid can no longer be changed.");
  return rfx;
}

export interface ResponseInput { requirementId: number; text?: string | null; number?: number | null; attachmentId?: number | null }
/** Saves technical-envelope answers (upsert). An empty value clears the answer. */
export function saveResponses(db: DB, bidId: number, inputs: ResponseInput[], now = Date.now()): void {
  const bid = getBid(db, bidId);
  if (!bid) throw new RfxError("Bid not found");
  editable(db, bid, now);
  const reqs = new Map(requirementsOf(db, bid.rfx_id).map((r) => [r.id, r]));
  for (const i of inputs) {
    const r = reqs.get(i.requirementId);
    if (!r) continue;
    const text = i.text?.toString().trim() || null;
    const prev = one<{ attachment_id: number | null }>(db, "SELECT attachment_id FROM rfx_bid_responses WHERE bid_id = ? AND requirement_id = ?", bidId, i.requirementId);
    db.prepare(`INSERT INTO rfx_bid_responses(bid_id, requirement_id, value_text, value_number, attachment_id) VALUES (?,?,?,?,?)
      ON CONFLICT(bid_id, requirement_id) DO UPDATE SET value_text = excluded.value_text, value_number = excluded.value_number, attachment_id = COALESCE(excluded.attachment_id, rfx_bid_responses.attachment_id)`)
      .run(bidId, i.requirementId, text, i.number ?? null, i.attachmentId ?? prev?.attachment_id ?? null);
  }
  db.prepare("UPDATE rfx_bids SET updated_at = ? WHERE id = ?").run(sqlNow(), bidId);
}
export interface CommercialInput { prices: { boqLineId: number; unitRate: number }[]; discount?: number; deviations?: string | null; alternative?: string | null; validityDays?: number | null; bondRef?: string | null }
/** Saves the priced BOQ (version 1; a revision replaces the previous prices) and the commercial terms; recomputes the bid totals (excl. VAT in `total_amount`). */
export function saveCommercial(db: DB, bidId: number, c: CommercialInput, now = Date.now()): void {
  const bid = getBid(db, bidId);
  if (!bid) throw new RfxError("Bid not found");
  const rfx = editable(db, bid, now);
  const dec = decOf(db, rfx.entity_id);
  const lines = new Map(boqOf(db, rfx.id).map((l) => [l.id, l]));
  db.prepare("DELETE FROM rfx_bid_prices WHERE bid_id = ? AND version = 1").run(bidId);
  const ins = db.prepare("INSERT INTO rfx_bid_prices(bid_id, boq_line_id, version, unit_rate, amount, created_at) VALUES (?,?,1,?,?,?)");
  for (const p of c.prices) {
    const l = lines.get(p.boqLineId);
    if (!l || !Number.isFinite(p.unitRate) || p.unitRate < 0) continue;
    ins.run(bidId, l.id, roundTo(p.unitRate, 4), roundTo(l.quantity * p.unitRate, dec), sqlNow());
  }
  writeTotals(db, bidId, rfx, 1, c.discount ?? bid.discount_amount ?? 0);
  db.prepare("UPDATE rfx_bids SET deviations = ?, alternative_offer = ?, validity_days = ?, bid_bond_ref = ?, price_version = 1, updated_at = ? WHERE id = ?")
    .run(c.deviations?.trim() || null, c.alternative?.trim() || null, c.validityDays ?? null, c.bondRef?.trim() || null, sqlNow(), bidId);
}
/** Recomputes subtotal / discount / VAT of the bid at a price version and stores the net total. */
export function writeTotals(db: DB, bidId: number, rfx: RfxRow, version: number, discount: number): void {
  const dec = decOf(db, rfx.entity_id);
  const lines = all<{ amount: number }>(db, "SELECT amount FROM rfx_bid_prices WHERE bid_id = ? AND version = ?", bidId, version);
  const t = bidTotals(lines, discount, vatRateOf(db, rfx.entity_id), dec);
  db.prepare("UPDATE rfx_bids SET total_amount = ?, discount_amount = ?, vat_amount = ? WHERE id = ?").run(t.net, t.discount, t.vat, bidId);
}

/** Everything that still stops the supplier from submitting (empty = ready). */
export function submitBlockers(db: DB, rfx: RfxRow, bid: BidRow, now = Date.now()): string[] {
  const out: string[] = [];
  if (!isBiddingOpen(rfx, now)) out.push(rfx.status === "published" ? "Bidding is closed." : "This tender is not open for bids.");
  out.push(...bidBlockers(db, bid.subcontractor_id));
  if (!isEligibleToView(db, rfx, bid.subcontractor_id)) out.push("Your company is not eligible to bid on this tender.");
  for (const a of unackedAddenda(db, rfx.id, bid.subcontractor_id)) out.push(`Acknowledge addendum ${a.no} (${a.title}).`);
  const resp = new Map(all<{ requirement_id: number; value_text: string | null; value_number: number | null; attachment_id: number | null }>(db, "SELECT requirement_id, value_text, value_number, attachment_id FROM rfx_bid_responses WHERE bid_id = ?", bid.id).map((r) => [r.requirement_id, r]));
  for (const r of requirementsOf(db, rfx.id).filter((x) => x.mandatory)) {
    const v = resp.get(r.id);
    const ok = !!v && (r.kind === "document" ? !!v.attachment_id : r.kind === "number" ? v.value_number !== null : !!v.value_text);
    if (!ok) out.push(`Missing: ${r.name}.`);
  }
  const priced = new Set(all<{ boq_line_id: number }>(db, "SELECT boq_line_id FROM rfx_bid_prices WHERE bid_id = ? AND version = 1", bid.id).map((p) => p.boq_line_id));
  const lines = boqOf(db, rfx.id);
  const unpriced = lines.filter((l) => !priced.has(l.id));
  if (unpriced.length) out.push(`${unpriced.length} BOQ line${unpriced.length === 1 ? " is" : "s are"} not priced.`);
  if (bid.validity_days === null || bid.validity_days < rfx.validity_days) out.push(`The bid validity must be at least ${rfx.validity_days} days.`);
  return out;
}

export interface SubmitResult { receiptHash: string; submittedAt: string; revision: number }
/** Submits (or revises) the bid. Refused on the server after the closing time. Writes the receipt hash, history and the receipt mail. */
export function submitBid(db: DB, bidId: number, o: { actorName: string; baseUrl: string; now?: number }): SubmitResult {
  const now = o.now ?? Date.now();
  const bid = getBid(db, bidId);
  if (!bid) throw new RfxError("Bid not found");
  const rfx = mustRfx(db, bid.rfx_id);
  if (!isBiddingOpen(rfx, now)) {
    if (bid.status === "draft") db.prepare("UPDATE rfx_bids SET status = 'late_refused', register_note = ? WHERE id = ?").run(`Late attempt at ${new Date(now).toISOString()} refused`, bidId);
    logRfx(db, rfx.id, "bid", "A late bid submission was refused (bidding is closed)", null);
    throw new RfxError("Bidding is closed. Late bids are not accepted: your submission was refused and recorded.");
  }
  const blockers = submitBlockers(db, rfx, bid, now);
  if (blockers.length) throw new RfxError(blockers[0]);
  const at = new Date(now).toISOString();
  const revision = bid.revision + 1;
  const content = {
    responses: all(db, "SELECT requirement_id, value_text, value_number, attachment_id FROM rfx_bid_responses WHERE bid_id = ? ORDER BY requirement_id", bidId),
    prices: all(db, "SELECT boq_line_id, unit_rate, amount FROM rfx_bid_prices WHERE bid_id = ? AND version = 1 ORDER BY boq_line_id", bidId),
    totals: [bid.total_amount, bid.discount_amount, bid.vat_amount], deviations: bid.deviations, alternative: bid.alternative_offer, validity: bid.validity_days,
  };
  const hash = createHash("sha256").update(receiptPayload(rfx.code, bid.subcontractor_id, revision, at, content)).digest("hex");
  if (bid.status === "submitted") db.prepare("INSERT INTO rfx_bid_history(bid_id, revision, submitted_at, receipt_hash, total_amount, note) VALUES (?,?,?,?,?, 'Replaced by a revision')").run(bidId, bid.revision, bid.submitted_at, bid.receipt_hash, bid.total_amount);
  db.prepare("UPDATE rfx_bids SET status = 'submitted', submitted_at = ?, receipt_hash = ?, revision = ?, updated_at = ? WHERE id = ?").run(at, hash, revision, sqlNow(), bidId);
  const slug = one<{ portal_slug: string | null }>(db, "SELECT portal_slug FROM subcontractors WHERE id = ?", bid.subcontractor_id)?.portal_slug;
  mailSupplier(db, bid.subcontractor_id, "bid_received", { code: rfx.code, title: rfx.title, submittedAt: at, receiptHash: hash, revision, tenderHref: `/p/${slug}/tenders/${rfx.id}` }, { baseUrl: o.baseUrl, related: { type: "rfx", id: rfx.id } });
  // the activity log is read by internal users: it records THAT a bid arrived, never who sent it (sealed-bid rule)
  logRfx(db, rfx.id, "bid", `A sealed bid was ${revision > 1 ? `revised (revision ${revision})` : "received"} - receipt ${hash.slice(0, 12)}`, null);
  return { receiptHash: hash, submittedAt: at, revision };
}
export function withdrawBid(db: DB, bidId: number, now = Date.now()): void {
  const bid = getBid(db, bidId);
  if (!bid) throw new RfxError("Bid not found");
  const rfx = mustRfx(db, bid.rfx_id);
  if (!isBiddingOpen(rfx, now)) throw new RfxError("Bidding is closed: a bid can no longer be withdrawn.");
  if (!["draft", "submitted"].includes(bid.status)) throw new RfxError("This bid cannot be withdrawn.");
  db.prepare("UPDATE rfx_bids SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(sqlNow(), bidId);
  logRfx(db, rfx.id, "bid", "A bid was withdrawn before closing", null);
}

/* ------------------------------------------------------------------ seal state */

export interface Seal { twoEnvelope: boolean; techOpen: boolean; priceOpen: boolean; techOpenedAt: string | null; priceOpenedAt: string | null }
export function sealOf(db: DB, rfx: Pick<RfxRow, "id" | "evaluation_method">): Seal {
  const ev = (k: string) => one<{ at: string }>(db, "SELECT at FROM rfx_events WHERE rfx_id = ? AND kind = ? ORDER BY id LIMIT 1", rfx.id, k)?.at ?? null;
  const two = isTwoEnvelope(rfx.evaluation_method);
  const opening = ev("opening"), tech = ev("tech_opening"), comm = ev("commercial_opening");
  return { twoEnvelope: two, techOpen: !!(opening || tech), priceOpen: two ? !!comm : !!opening, techOpenedAt: opening ?? tech, priceOpenedAt: two ? comm : opening };
}
/** Prices of a bid are readable internally when the price envelope is open (two-envelope: only technically qualified bids). */
export const priceVisible = (seal: Seal, status: string): boolean => seal.priceOpen && (!seal.twoEnvelope || ["qualified", "awarded", "unsuccessful"].includes(status));

export interface SealedBid {
  id: number; /** "Bid 1" by submission order: the only identifier before the opening */ label: string; subcontractor_id: number | null; supplier_name: string | null;
  status: string; submitted_at: string | null; receipt_hash: string | null; revision: number; opened: boolean; price_visible: boolean;
  bid_bond_received: number | null; register_note: string | null;
  total_amount: number | null; discount_amount: number | null; vat_amount: number | null; price_version: number | null; original_total: number | null;
  tech_score: number | null; commercial_score: number | null; final_score: number | null; rank: number | null; disqualified_step: number | null; disqualify_reason: string | null;
}
/** Bids of a tender as internal users may see them (the sealed-bid rule applied). Only received bids are listed; drafts and withdrawn bids are never shown before the opening. */
export function internalBids(db: DB, rfxId: number): SealedBid[] {
  const rfx = mustRfx(db, rfxId);
  const seal = sealOf(db, rfx);
  const rows = all<BidRow & { supplier_name: string }>(db, `SELECT b.*, s.name supplier_name FROM rfx_bids b JOIN subcontractors s ON s.id = b.subcontractor_id WHERE b.rfx_id = ?
    AND b.status IN (${RECEIVED_BID_STATUSES.map((s) => `'${s}'`).join(",")}) AND b.submitted_at IS NOT NULL ORDER BY b.submitted_at, b.id`, rfxId);
  return rows.map((b, i): SealedBid => {
    const pv = priceVisible(seal, b.status);
    const orig = pv && b.price_version > 1 ? one<{ s: number | null }>(db, "SELECT SUM(amount) s FROM rfx_bid_prices WHERE bid_id = ? AND version = 1", b.id)?.s ?? null : null;
    const base: SealedBid = {
      id: b.id, label: `Bid ${i + 1}`, subcontractor_id: null, supplier_name: null, status: "submitted", submitted_at: b.submitted_at, receipt_hash: b.receipt_hash, revision: b.revision, opened: seal.techOpen, price_visible: false,
      bid_bond_received: null, register_note: null, total_amount: null, discount_amount: null, vat_amount: null, price_version: null, original_total: null,
      tech_score: null, commercial_score: null, final_score: null, rank: null, disqualified_step: null, disqualify_reason: null,
    };
    if (!seal.techOpen) return base;
    return {
      ...base, subcontractor_id: b.subcontractor_id, supplier_name: b.supplier_name, status: b.status, bid_bond_received: b.bid_bond_received, register_note: b.register_note,
      tech_score: b.tech_score, disqualified_step: b.disqualified_step, disqualify_reason: b.disqualify_reason, price_visible: pv,
      ...(pv ? { total_amount: b.total_amount, discount_amount: b.discount_amount, vat_amount: b.vat_amount, price_version: b.price_version, original_total: orig, commercial_score: b.commercial_score, final_score: b.final_score, rank: b.rank } : {}),
    };
  });
}

export interface SealedResponse { requirement_id: number; name: string; kind: string; envelope: string; mandatory: number; step_id: number | null; value_text: string | null; value_number: number | null; attachment_id: number | null; filename: string | null; compliant: number | null; eval_comment: string | null }
/** Technical answers of a bid (only after the technical opening); commercial-envelope answers only while the price envelope of that bid is open. */
export function internalResponses(db: DB, bidId: number): SealedResponse[] {
  const b = getBid(db, bidId);
  if (!b) return [];
  const rfx = mustRfx(db, b.rfx_id);
  const seal = sealOf(db, rfx);
  if (!seal.techOpen || !RECEIVED_BID_STATUSES.includes(b.status as never)) return [];
  const pv = priceVisible(seal, b.status);
  return all<SealedResponse>(db, `SELECT r.id requirement_id, r.name, r.kind, r.envelope, r.mandatory, r.step_id, x.value_text, x.value_number, x.attachment_id, a.filename, x.compliant, x.eval_comment
    FROM rfx_requirements r LEFT JOIN rfx_bid_responses x ON x.requirement_id = r.id AND x.bid_id = ? LEFT JOIN attachments a ON a.id = x.attachment_id WHERE r.rfx_id = ? ORDER BY r.sort, r.id`, bidId, rfx.id)
    .filter((r) => r.envelope === "technical" || pv);
}
export interface SealedPrice { boq_line_id: number; unit_rate: number; amount: number; version: number }
/** Priced BOQ of a bid; null while sealed. `version` defaults to the bid's effective price version. */
export function internalPrices(db: DB, bidId: number, version?: number): SealedPrice[] | null {
  const b = getBid(db, bidId);
  if (!b) return null;
  const seal = sealOf(db, mustRfx(db, b.rfx_id));
  if (!priceVisible(seal, b.status) || !RECEIVED_BID_STATUSES.includes(b.status as never)) return null;
  return all<SealedPrice>(db, "SELECT boq_line_id, unit_rate, amount, version FROM rfx_bid_prices WHERE bid_id = ? AND version = ? ORDER BY boq_line_id", bidId, version ?? b.price_version);
}

/** Files API rule for `rfx_bid` attachments read by INTERNAL users. Request / response documents (category clarification / bafo) are readable by the evaluators once the technical envelope is open. */
export function internalMayReadBidFile(db: DB, att: { id: number; entity_id: number; category: string | null }): boolean {
  const b = getBid(db, att.entity_id);
  if (!b) return false;
  const seal = sealOf(db, mustRfx(db, b.rfx_id));
  if (!seal.techOpen) return false;
  const resp = one<{ envelope: string }>(db, "SELECT r.envelope FROM rfx_bid_responses x JOIN rfx_requirements r ON r.id = x.requirement_id WHERE x.attachment_id = ? AND x.bid_id = ?", att.id, b.id);
  if (!resp) return RECEIVED_BID_STATUSES.includes(b.status as never);
  return resp.envelope === "technical" ? true : priceVisible(seal, b.status);
}

/* ------------------------------------------------------------------ openings */

export interface OpeningInput {
  kind: "opening" | "tech_opening" | "commercial_opening"; at: string; attendeeIds: number[]; observers: string; minutes: string;
  register: { bidId: number; bondYes: boolean; note: string }[];
}
/** Records a tender board opening (technical or single opening: status -> `opening`; commercial opening: unseals the prices of the technically qualified bids). */
export function recordOpening(db: DB, rfxId: number, o: OpeningInput, userId: number | null, evalGate?: (rfxId: number) => string | null): number {
  const rfx = mustRfx(db, rfxId);
  const two = isTwoEnvelope(rfx.evaluation_method);
  const exists = (k: string) => !!one(db, "SELECT 1 FROM rfx_events WHERE rfx_id = ? AND kind = ?", rfxId, k);
  if (o.kind === "commercial_opening") {
    if (!two) throw new RfxError("This tender has a single opening only.");
    if (rfx.status !== "evaluation") throw new RfxError("The commercial opening is held during the evaluation, after the technical steps.");
    if (exists("commercial_opening")) throw new RfxError("The commercial envelopes are already open.");
    const gate = evalGate?.(rfxId);
    if (gate) throw new RfxError(gate);
  } else {
    if (rfx.status !== "closed") throw new RfxError(rfx.status === "published" ? "Bidding is still open. Close bidding first." : "The opening has already been recorded.");
    if (two && o.kind !== "tech_opening") throw new RfxError("A two-envelope tender opens the technical envelope first.");
    if (!two && o.kind !== "opening") throw new RfxError("This tender has a single opening.");
    if (!internalBidsExist(db, rfxId)) throw new RfxError("No bids were received: cancel the tender or re-issue it.");
  }
  const names = o.attendeeIds.map((id) => one<{ name: string }>(db, "SELECT name FROM users WHERE id = ?", id)?.name).filter(Boolean);
  const id = Number(db.prepare("INSERT INTO rfx_events(rfx_id, kind, at, attendees_json, minutes, created_by) VALUES (?,?,?,?,?,?)")
    .run(rfxId, o.kind, o.at, JSON.stringify({ userIds: o.attendeeIds, names, observers: o.observers.trim() }), o.minutes.trim() || null, userId).lastInsertRowid);
  for (const r of o.register) db.prepare("UPDATE rfx_bids SET bid_bond_received = ?, register_note = ? WHERE id = ? AND rfx_id = ?").run(r.bondYes ? 1 : 0, r.note.trim() || null, r.bidId, rfxId);
  if (o.kind !== "commercial_opening") db.prepare("UPDATE rfx_tenders SET status = 'opening' WHERE id = ?").run(rfxId);
  logRfx(db, rfxId, "opening", `${o.kind === "commercial_opening" ? "Commercial envelopes" : two ? "Technical envelopes" : "Bids"} opened by the tender board (${names.length} attendee${names.length === 1 ? "" : "s"})`, userId, o.at);
  return id;
}
const internalBidsExist = (db: DB, rfxId: number): boolean => !!one(db, `SELECT 1 FROM rfx_bids WHERE rfx_id = ? AND status IN (${RECEIVED_BID_STATUSES.map((s) => `'${s}'`).join(",")}) AND submitted_at IS NOT NULL`, rfxId);

/** Late / refused attempts and withdrawn bids for the opening register (names only after the opening). */
export function registerNotes(db: DB, rfxId: number): { label: string; status: string; note: string | null }[] {
  const seal = sealOf(db, mustRfx(db, rfxId));
  if (!seal.techOpen) return [];
  return all<{ id: number; supplier_name: string; status: string; register_note: string | null }>(db, `SELECT b.id, s.name supplier_name, b.status, b.register_note FROM rfx_bids b JOIN subcontractors s ON s.id = b.subcontractor_id WHERE b.rfx_id = ? AND b.status IN ('withdrawn', 'late_refused') ORDER BY b.id`, rfxId)
    .map((b) => ({ label: b.supplier_name, status: b.status, note: b.register_note }));
}

/* ------------------------------------------------------------------ requests to a bidder (clarification / BAFO) */

export function requestFromBidder(db: DB, bidId: number, r: { kind: "clarification" | "bafo"; message: string; dueAt: string | null }, userId: number | null, now = Date.now()): number {
  const bid = getBid(db, bidId);
  if (!bid) throw new RfxError("Bid not found");
  const rfx = mustRfx(db, bid.rfx_id);
  if (rfx.status !== "evaluation") throw new RfxError("Requests to bidders are sent during the evaluation.");
  if (!r.message.trim()) throw new RfxError("Write the request.");
  if (r.dueAt && Date.parse(r.dueAt) <= now) throw new RfxError("The answer date must be in the future.");
  const seal = sealOf(db, rfx);
  if (r.kind === "bafo" && !priceVisible(seal, bid.status)) throw new RfxError("A negotiation (BAFO) round is only possible with a bidder whose price envelope is open.");
  if (!["submitted", "qualified"].includes(bid.status)) throw new RfxError("Requests can only be sent to bidders that are still in the evaluation.");
  const id = Number(db.prepare("INSERT INTO rfx_bid_requests(rfx_id, bid_id, kind, message, due_at, requested_by, requested_at, status) VALUES (?,?,?,?,?,?,?, 'open')").run(rfx.id, bidId, r.kind, r.message.trim(), r.dueAt, userId, nowIso()).lastInsertRowid);
  db.prepare("INSERT INTO rfx_events(rfx_id, kind, at, minutes, created_by, data_json) VALUES (?,?,?,?,?,?)").run(rfx.id, r.kind === "bafo" ? "bafo_request" : "clarification_request", nowIso(), r.message.trim(), userId, JSON.stringify({ bidId, requestId: id }));
  const slug = one<{ portal_slug: string | null }>(db, "SELECT portal_slug FROM subcontractors WHERE id = ?", bid.subcontractor_id)?.portal_slug;
  db.prepare("INSERT INTO portal_notifications(subcontractor_id, portal_user_id, kind, title, body, href, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(bid.subcontractor_id, null, r.kind === "bafo" ? "tender_bafo" : "tender_clarification", `${r.kind === "bafo" ? "Revised price requested" : "Clarification requested"} - ${rfx.code}`, r.message.trim().slice(0, 240), `/p/${slug}/tenders/${rfx.id}`, nowIso());
  logRfx(db, rfx.id, "evaluation", `${r.kind === "bafo" ? "Negotiation (BAFO) request" : "Clarification request"} sent to a bidder`, userId);
  return id;
}
/** The bidder answers a request. A BAFO answer carries a revised price list stored as a NEW price version (the original stays visible); the bid total follows the latest version. */
export function respondToRequest(db: DB, requestId: number, subId: number, a: { response: string; attachmentId?: number | null; prices?: { boqLineId: number; unitRate: number }[]; discount?: number }, now = Date.now()): { kind: string; bidId: number } {
  const req = one<{ id: number; rfx_id: number; bid_id: number; kind: string; due_at: string | null; status: string }>(db, "SELECT * FROM rfx_bid_requests WHERE id = ?", requestId);
  if (!req) throw new RfxError("Request not found");
  const bid = getBid(db, req.bid_id);
  if (!bid || bid.subcontractor_id !== subId) throw new RfxError("Request not found");
  if (req.status !== "open") throw new RfxError("This request has already been answered.");
  if (req.due_at && Date.parse(req.due_at) < now) throw new RfxError("The answer date has passed.");
  const rfx = mustRfx(db, req.rfx_id);
  if (rfx.status !== "evaluation") throw new RfxError("The evaluation is no longer running.");
  if (req.kind === "bafo") {
    const dec = decOf(db, rfx.entity_id);
    const lines = new Map(boqOf(db, rfx.id).map((l) => [l.id, l]));
    const prices = (a.prices ?? []).filter((p) => lines.has(p.boqLineId) && Number.isFinite(p.unitRate) && p.unitRate >= 0);
    if (prices.length !== lines.size) throw new RfxError("Price every BOQ line in the revised offer.");
    const version = (one<{ v: number }>(db, "SELECT MAX(version) v FROM rfx_bid_prices WHERE bid_id = ?", bid.id)?.v ?? 1) + 1;
    const ins = db.prepare("INSERT INTO rfx_bid_prices(bid_id, boq_line_id, version, unit_rate, amount, created_at) VALUES (?,?,?,?,?,?)");
    for (const p of prices) ins.run(bid.id, p.boqLineId, version, roundTo(p.unitRate, 4), roundTo(lines.get(p.boqLineId)!.quantity * p.unitRate, dec), sqlNow());
    writeTotals(db, bid.id, rfx, version, a.discount ?? bid.discount_amount ?? 0);
    db.prepare("UPDATE rfx_bids SET price_version = ? WHERE id = ?").run(version, bid.id);
  }
  db.prepare("UPDATE rfx_bid_requests SET response = ?, responded_at = ?, response_attachment_id = ?, status = 'answered' WHERE id = ?").run(a.response.trim() || null, nowIso(), a.attachmentId ?? null, requestId);
  logRfx(db, rfx.id, "evaluation", `A bidder answered the ${req.kind === "bafo" ? "negotiation (BAFO)" : "clarification"} request`, null);
  return { kind: req.kind, bidId: bid.id };
}

export type { BoqRow, RequirementRow };
export { supplierName };
