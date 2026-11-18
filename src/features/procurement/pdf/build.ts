// Server-side assembly of the PDF data (sealed-bid rules applied through bid-core).
import { getDb } from "@/lib/db";
import { decimalsOf, isTwoEnvelope } from "@/lib/rfx";
import { internalBids, internalPrices, sealOf } from "../bid-core";
import { awardLetterData, evaluate } from "../eval-core";
import { boqOf, committeeOf, entityCurrency, mustRfx, stepsOf } from "../rfx-core";
import { timelineOf } from "../queries";
import type { AwardLetterData, OpeningPdfData, RecommendationPdfData } from "./TenderPdfs";

const ent = (id: number) => getDb().prepare("SELECT legal_name, address FROM entities WHERE id = ?").get(id) as { legal_name: string; address: string | null };
const proj = (id: number) => (getDb().prepare("SELECT code, name FROM projects WHERE id = ?").get(id) as { code: string; name: string });
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function openingPdfData(rfxId: number): OpeningPdfData {
  const db = getDb(), r = mustRfx(db, rfxId), p = proj(r.project_id), seal = sealOf(db, r);
  const events = timelineOf(rfxId).filter((e) => ["opening", "tech_opening", "commercial_opening"].includes(e.kind)).map((e) => { const a = e.attendees_json ? JSON.parse(e.attendees_json) as { names: string[]; observers: string } : { names: [], observers: "" }; return { kind: e.kind, at: e.at, attendees: a.names, observers: a.observers, minutes: e.minutes }; });
  return { company: ent(r.entity_id).legal_name, code: r.code, title: r.title, project: `${p.code} ${p.name}`, method: isTwoEnvelope(r.evaluation_method) ? "two-envelope: technical envelope" : "single envelope", events, generatedAt: stamp(),
    bids: internalBids(db, rfxId).map((b) => ({ label: b.label, bidder: seal.techOpen ? b.supplier_name ?? "—" : "sealed", receivedAt: b.submitted_at, hash: b.receipt_hash, bond: b.bid_bond_received ? "Yes" : b.bid_bond_received === 0 ? "No" : "—", status: b.status, note: b.register_note })) };
}
export function recommendationPdfData(rfxId: number): RecommendationPdfData {
  const db = getDb(), r = mustRfx(db, rfxId), p = proj(r.project_id), cur = entityCurrency(db, r.entity_id), dec = decimalsOf(cur);
  const bids = internalBids(db, rfxId), { rows } = evaluate(db, rfxId);
  const visible = bids.filter((b) => b.price_visible);
  const boq = boqOf(db, rfxId);
  const prices = visible.map((b) => new Map((internalPrices(db, b.id) ?? []).map((x) => [x.boq_line_id, x.unit_rate])));
  return {
    company: ent(r.entity_id).legal_name, code: r.code, title: r.title, project: `${p.code} ${p.name}`, currency: cur, dec, method: r.evaluation_method.replace(/_/g, " "), estimate: r.estimate, awardValue: r.award_value,
    recommended: bids.find((b) => b.id === r.recommended_bid_id)?.supplier_name ?? null, justification: r.recommendation_note, steps: stepsOf(db, rfxId).map((s) => s.name), generatedAt: stamp(),
    bids: [...bids].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((b) => ({ rank: b.rank, bidder: b.supplier_name ?? b.label, tech: b.tech_score, comm: b.commercial_score, final: b.final_score, price: b.total_amount, outcome: rows.find((x) => x.bidId === b.id)?.dq ? "Disqualified" : b.status === "awarded" ? "Awarded" : b.status === "qualified" || b.status === "unsuccessful" ? "Qualified" : b.status })),
    bidders: visible.map((b) => b.supplier_name ?? b.label), lines: boq.map((l) => ({ item: l.item_no, desc: l.description, est: l.estimate_rate, rates: visible.map((_, k) => prices[k].get(l.id) ?? null) })),
    signoffs: (db.prepare("SELECT u.name, s.decision, s.comment FROM rfx_signoffs s JOIN users u ON u.id = s.user_id WHERE s.rfx_id = ?").all(rfxId) as { name: string; decision: string; comment: string | null }[]),
  };
}
export function awardLetterPdfData(rfxId: number): AwardLetterData | null {
  const db = getDb(), x = awardLetterData(db, rfxId);
  if (!x) return null;
  return { company: x.entity.legal_name, companyAddress: x.entity.address, code: x.rfx.code, title: x.rfx.title, supplier: x.supplier.name, supplierAddress: x.supplier.address, attention: x.supplier.contact_person, assignmentCode: x.assignmentCode, currency: x.entity.currency,
    dec: decimalsOf(x.entity.currency), value: x.rfx.award_value ?? x.bid.total_amount ?? 0, vatRate: x.entity.vat_rate, taxLabel: x.entity.tax_label, taxNo: x.entity.tax_no, date: (x.rfx.awarded_at ?? new Date().toISOString()).slice(0, 10),
    terms: { adv: x.rfx.advance_pct, ret: x.rfx.retention_pct, days: x.rfx.payment_days, start: x.rfx.contract_start, end: x.rfx.contract_end, payment: x.rfx.payment_terms, perfBond: x.rfx.performance_bond_pct },
    lines: x.lines.map((l) => ({ item: l.item_no, desc: l.description, unit: l.unit, qty: l.quantity, rate: l.unit_rate, amount: l.amount })) };
}
export { committeeOf };
