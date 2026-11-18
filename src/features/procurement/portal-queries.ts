// Supplier-side read models (portal). Every function takes the company id from the portal SESSION; a supplier only ever reads its own bid and, after the award, its own result.
import { getDb } from "@/lib/db";
import { PORTAL_VISIBLE_STATUSES, RECEIVED_BID_STATUSES } from "@/lib/rfx";
import { isEligibleToView, refreshRfxStatuses, type RfxRow } from "./rfx-core";
import { bidOf, type BidRow } from "./bid-core";

const all = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).all(...(a as never[])) as T[];
const one = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).get(...(a as never[])) as T | undefined;

export type PortalTab = "opportunities" | "bids" | "closed" | "awarded";
export type PortalRfx = RfxRow & { category_name: string | null; my_status: string | null; intent: string | null; open: boolean };

/** Tenders of the company's country that the supplier may see (invited, or open + approved category), grouped into the four portal tabs. */
export function portalTenders(subId: number, entityId: number, tab: PortalTab): PortalRfx[] {
  const db = getDb();
  refreshRfxStatuses(db);
  const rows = all<RfxRow & { category_name: string | null }>(`SELECT t.*, c.name category_name FROM rfx_tenders t LEFT JOIN supplier_categories c ON c.id = t.category_id
    WHERE t.entity_id = ? AND t.status IN (${PORTAL_VISIBLE_STATUSES.map((s) => `'${s}'`).join(",")}) ORDER BY t.closing_at DESC, t.id DESC`, entityId);
  const out: PortalRfx[] = [];
  for (const t of rows) {
    const bid = bidOf(db, t.id, subId);
    const eligible = isEligibleToView(db, t, subId) || (!!bid && bid.status !== "late_refused");
    if (!eligible) continue;
    const inv = one<{ intent: string }>("SELECT intent FROM rfx_invitations WHERE rfx_id = ? AND subcontractor_id = ?", t.id, subId);
    const mine = bid && !(bid.status === "withdrawn" && t.status !== "published") ? bid.status : null;
    const row: PortalRfx = { ...t, my_status: mine, intent: inv?.intent ?? null, open: t.status === "published" };
    const hasBid = !!bid && ["draft", "submitted", "withdrawn", "late_refused", "disqualified", "qualified", "unsuccessful", "awarded"].includes(bid.status);
    const submittedOrDraft = !!bid && bid.status !== "withdrawn" || (!!bid && t.status === "published");
    const inTab = tab === "opportunities" ? t.status === "published" && !(bid && ["submitted", "draft"].includes(bid.status)) && inv?.intent !== "declined"
      : tab === "bids" ? hasBid && submittedOrDraft && t.status !== "awarded" && !(t.status !== "published" && bid?.status === "draft")
      : tab === "closed" ? ["closed", "opening", "evaluation", "recommended", "award_pending"].includes(t.status) && !(bid && bid.status === "submitted")
      : t.status === "awarded";
    if (tab === "awarded" ? inTab && !!bid : inTab) out.push(row);
  }
  return out;
}
export const opportunityCount = (subId: number, entityId: number): number => portalTenders(subId, entityId, "opportunities").length;
export function portalTender(rfxId: number, subId: number, entityId: number): { rfx: RfxRow; category: string | null; bid: BidRow | undefined; eligible: boolean } | null {
  const db = getDb();
  refreshRfxStatuses(db);
  const rfx = one<RfxRow>("SELECT * FROM rfx_tenders WHERE id = ? AND entity_id = ?", rfxId, entityId);
  if (!rfx || !PORTAL_VISIBLE_STATUSES.includes(rfx.status as never)) return null;
  const bid = bidOf(db, rfxId, subId);
  const eligible = isEligibleToView(db, rfx, subId);
  if (!eligible && !(bid && RECEIVED_BID_STATUSES.includes(bid.status as never))) return null;
  return { rfx, category: rfx.category_id ? one<{ name: string }>("SELECT name FROM supplier_categories WHERE id = ?", rfx.category_id)?.name ?? null : null, bid, eligible };
}
export const tenderDocuments = (rfxId: number) => all<{ id: number; filename: string; category: string | null; size: number | null; created_at: string }>("SELECT id, filename, category, size, created_at FROM attachments WHERE entity_type = 'rfx' AND entity_id = ? ORDER BY id", rfxId);
export const publicClarifications = (rfxId: number) => all<{ id: number; question: string; answer: string; published_at: string }>("SELECT id, question, answer, published_at FROM rfx_clarifications WHERE rfx_id = ? AND answer IS NOT NULL ORDER BY id", rfxId);
export const myQuestions = (rfxId: number, subId: number) => all<{ id: number; question: string; answer: string | null; asked_at: string }>("SELECT id, question, answer, asked_at FROM rfx_clarifications WHERE rfx_id = ? AND subcontractor_id = ? ORDER BY id", rfxId, subId);
export const addendaFor = (rfxId: number, subId: number) => all<{ id: number; no: number; title: string; description: string | null; new_closing_at: string | null; issued_at: string; attachment_id: number | null; acked_at: string | null }>(
  "SELECT a.id, a.no, a.title, a.description, a.new_closing_at, a.issued_at, a.attachment_id, k.acked_at FROM rfx_addenda a LEFT JOIN rfx_addendum_acks k ON k.addendum_id = a.id AND k.subcontractor_id = ? WHERE a.rfx_id = ? ORDER BY a.no", subId, rfxId);
export const myRequests = (bidId: number) => all<{ id: number; kind: string; message: string; due_at: string | null; requested_at: string; response: string | null; status: string }>("SELECT id, kind, message, due_at, requested_at, response, status FROM rfx_bid_requests WHERE bid_id = ? ORDER BY id DESC", bidId);
export const openRequestCount = (subId: number): number => one<{ n: number }>("SELECT COUNT(*) n FROM rfx_bid_requests r JOIN rfx_bids b ON b.id = r.bid_id WHERE b.subcontractor_id = ? AND r.status = 'open'", subId)?.n ?? 0;
/** The supplier's own bid content (own data only). */
export function myBidContent(bidId: number) {
  return {
    responses: all<{ requirement_id: number; value_text: string | null; value_number: number | null; attachment_id: number | null; filename: string | null }>("SELECT x.requirement_id, x.value_text, x.value_number, x.attachment_id, a.filename FROM rfx_bid_responses x LEFT JOIN attachments a ON a.id = x.attachment_id WHERE x.bid_id = ?", bidId),
    prices: all<{ boq_line_id: number; unit_rate: number; amount: number; version: number }>("SELECT boq_line_id, unit_rate, amount, version FROM rfx_bid_prices WHERE bid_id = ? ORDER BY version, boq_line_id", bidId),
    history: all<{ revision: number; submitted_at: string | null; receipt_hash: string | null }>("SELECT revision, submitted_at, receipt_hash FROM rfx_bid_history WHERE bid_id = ? ORDER BY revision", bidId),
  };
}
