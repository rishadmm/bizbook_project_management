"use server";
// Supplier-side actions. EVERY action: requirePortalAction(perm) (company from the session, never from the form), the tender must be visible to that company, the bid is the company's own.
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { saveUpload } from "@/lib/files";
import { guard, type ActionResult } from "@/lib/action-result";
import { requestOrigin, requirePortalAction } from "@/lib/portal-auth";
import { isBiddingOpen, bidOf, ensureBid, respondToRequest, saveCommercial, saveResponses, submitBid, submitBlockers, withdrawBid } from "./bid-core";
import { RfxError, ackAddendum, askQuestion, logRfx, mustRfx, refreshRfxStatuses } from "./rfx-core";
import { refreshEvaluation } from "./eval-core";
import { portalTender } from "./portal-queries";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOr = (f: FormData, k: string): number | null => { const v = str(f, k).replace(/,/g, ""); return v === "" || Number.isNaN(Number(v)) ? null : Number(v); };

async function ctx(f: FormData, perm: "tenders" | "tenders_bid") {
  const s = await requirePortalAction(perm);
  refreshRfxStatuses(getDb());
  const rfxId = Number(f.get("rfx_id"));
  const t = portalTender(rfxId, s.sub.id, s.entity.id);
  if (!t) throw new RfxError("Tender not found");
  return { s, db: getDb(), rfx: t.rfx };
}
const refresh = (slug: string | null, rfxId: number) => { revalidatePath(`/p/${slug}/tenders`); revalidatePath(`/p/${slug}/tenders/${rfxId}`); revalidatePath(`/p/${slug}/tenders/${rfxId}/bid`); revalidatePath("/procurement"); revalidatePath(`/procurement/${rfxId}`); };

export async function setIntentAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { s, db, rfx } = await ctx(f, "tenders_bid");
    const intent = str(f, "intent");
    if (!["interested", "declined"].includes(intent)) throw new RfxError("Choose interested or decline.");
    if (intent === "declined" && !str(f, "reason")) throw new RfxError("Give a reason for declining.");
    db.prepare(`INSERT INTO rfx_invitations(rfx_id, subcontractor_id, invited_at, viewed_at, intent, decline_reason, source) VALUES (?,?,?,?,?,?, 'eligible')
      ON CONFLICT(rfx_id, subcontractor_id) DO UPDATE SET intent = excluded.intent, decline_reason = excluded.decline_reason`).run(rfx.id, s.sub.id, new Date().toISOString().slice(0, 19).replace("T", " "), new Date().toISOString().slice(0, 19).replace("T", " "), intent, intent === "declined" ? str(f, "reason") : null);
    refresh(s.sub.portal_slug, rfx.id);
    return intent === "declined" ? "Marked as declined." : "Marked as interested.";
  });
}
export async function askQuestionAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { s, db, rfx } = await ctx(f, "tenders_bid"); askQuestion(db, rfx.id, s.sub.id, str(f, "question")); refresh(s.sub.portal_slug, rfx.id); return "Question sent. The answer is published anonymously to all bidders."; });
}
export async function ackAddendumAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { s, db, rfx } = await ctx(f, "tenders_bid");
    const a = db.prepare("SELECT id FROM rfx_addenda WHERE id = ? AND rfx_id = ?").get(Number(f.get("addendum_id")), rfx.id);
    if (!a) throw new RfxError("Addendum not found");
    ackAddendum(db, Number(f.get("addendum_id")), s.sub.id, s.user.name);
    refresh(s.sub.portal_slug, rfx.id);
  });
}

/** Step 1: technical envelope answers + uploads (file_<reqId>, text_<reqId>). */
export async function saveTechnicalAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { s, db, rfx } = await ctx(f, "tenders_bid");
    if (!isBiddingOpen(rfx)) throw new RfxError("Bidding is closed: the bid can no longer be changed.");
    const bid = ensureBid(db, rfx.id, s.sub.id);
    const reqs = db.prepare("SELECT id, kind FROM rfx_requirements WHERE rfx_id = ?").all(rfx.id) as { id: number; kind: string }[];
    const inputs = [];
    for (const r of reqs) {
      let attachmentId: number | null = null;
      const file = f.get(`file_${r.id}`);
      if (r.kind === "document" && file instanceof File && file.size > 0) {
        if (file.size > 15 * 1024 * 1024) throw new RfxError("Files are limited to 15 MB.");
        attachmentId = (await saveUpload(file, "rfx_bid", bid.id, "Bid document", { uploadedBy: null, note: `Uploaded by ${s.user.name}` })).id;
      }
      if (r.kind === "document" && !attachmentId) continue;
      inputs.push({ requirementId: r.id, text: r.kind === "number" || r.kind === "document" ? null : str(f, `text_${r.id}`), number: r.kind === "number" ? numOr(f, `text_${r.id}`) : null, attachmentId });
    }
    saveResponses(db, bid.id, inputs);
    refresh(s.sub.portal_slug, rfx.id);
    return "Technical envelope saved.";
  });
}
/** Step 2: priced BOQ (rate_<lineId>) + discount, deviations, validity, bond reference. */
export async function saveCommercialAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { s, db, rfx } = await ctx(f, "tenders_bid");
    const bid = ensureBid(db, rfx.id, s.sub.id);
    const prices = (db.prepare("SELECT id FROM rfx_boq_lines WHERE rfx_id = ?").all(rfx.id) as { id: number }[]).map((l) => ({ boqLineId: l.id, unitRate: numOr(f, `rate_${l.id}`) })).filter((p) => p.unitRate !== null) as { boqLineId: number; unitRate: number }[];
    saveCommercial(db, bid.id, { prices, discount: numOr(f, "discount") ?? 0, deviations: str(f, "deviations"), alternative: str(f, "alternative"), validityDays: numOr(f, "validity_days"), bondRef: str(f, "bond_ref") });
    // commercial yes / no answers (payment terms acceptance ...)
    const reqs = db.prepare("SELECT id FROM rfx_requirements WHERE rfx_id = ? AND envelope = 'commercial'").all(rfx.id) as { id: number }[];
    saveResponses(db, bid.id, reqs.filter((r) => str(f, `text_${r.id}`)).map((r) => ({ requirementId: r.id, text: str(f, `text_${r.id}`) })));
    refresh(s.sub.portal_slug, rfx.id);
    return "Commercial envelope saved.";
  });
}
export async function submitBidAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { s, db, rfx } = await ctx(f, "tenders_bid");
    const bid = ensureBid(db, rfx.id, s.sub.id);
    const r = submitBid(db, bid.id, { actorName: s.user.name, baseUrl: await requestOrigin() });
    refresh(s.sub.portal_slug, rfx.id);
    return `Bid ${r.revision > 1 ? "revised" : "submitted"}. Receipt ${r.receiptHash.slice(0, 16)}...`;
  });
}
export async function submitBidLateSafe(f: FormData): Promise<ActionResult> { return submitBidAction(f); }
export async function withdrawBidAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { s, db, rfx } = await ctx(f, "tenders_bid");
    const bid = bidOf(db, rfx.id, s.sub.id);
    if (!bid) throw new RfxError("You have no bid on this tender.");
    withdrawBid(db, bid.id);
    refresh(s.sub.portal_slug, rfx.id);
    return "Bid withdrawn. You can prepare a new one until the closing date.";
  });
}
/** Answer to an evaluation clarification or a BAFO request (BAFO: rate_<lineId> for every BOQ line). */
export async function respondRequestAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { s, db, rfx } = await ctx(f, "tenders_bid");
    const bid = bidOf(db, rfx.id, s.sub.id);
    if (!bid) throw new RfxError("You have no bid on this tender.");
    let attachmentId: number | null = null;
    const file = f.get("file");
    if (file instanceof File && file.size > 0) attachmentId = (await saveUpload(file, "rfx_bid", bid.id, "clarification", { uploadedBy: null, note: `Uploaded by ${s.user.name}` })).id;
    const prices = (db.prepare("SELECT id FROM rfx_boq_lines WHERE rfx_id = ?").all(rfx.id) as { id: number }[]).map((l) => ({ boqLineId: l.id, unitRate: numOr(f, `rate_${l.id}`) })).filter((p) => p.unitRate !== null) as { boqLineId: number; unitRate: number }[];
    respondToRequest(db, Number(f.get("request_id")), s.sub.id, { response: str(f, "response"), attachmentId, prices, discount: numOr(f, "discount") ?? undefined });
    refreshEvaluation(db, rfx.id);
    refresh(s.sub.portal_slug, rfx.id);
    return "Answer sent.";
  });
}
export { mustRfx, logRfx, submitBlockers };
