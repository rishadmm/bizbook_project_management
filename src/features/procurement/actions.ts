"use server";
// Internal server actions of the Procurement module. Every action: requirePermission(procurement, <action>), the tender's country must be one of the user's countries,
// and the committee rules (scoring only by board members) are enforced in eval-core. Bid content is only ever read through bid-core's sealed readers.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { guard, type ActionResult } from "@/lib/action-result";
import { isAdminUser, requirePermission, type AuthUser } from "@/lib/auth";
import { assertUserEntity } from "@/lib/entity-context";
import { hasOpenRequest, submitForApproval, withdrawOpenRequest } from "@/lib/approvals/engine";
import { requestOrigin } from "@/lib/portal-auth";
import { saveUpload } from "@/lib/files";
import { logActivity } from "@/lib/activity";
import { decimalsOf, localToIso, roundTo, validateRfxDates } from "@/lib/rfx";
import {
  RfxError, answerClarification, cancelRfx, closeBiddingNow, copyTemplateInto, createDraft, entityCurrency, issueAddendum, mustRfx, prefillBoq, replaceBoq, scopeStageIds,
  invite, logRfx, publishBlockers, refreshRfxStatuses, userName,
} from "./rfx-core";
import { recordOpening, requestFromBidder } from "./bid-core";
import { awardBlockers as awardBlockersOf, commercialGate, declareCoi, markCompliance, recommendBid, refreshEvaluation, setScore, signOff, startEvaluation, withdrawRecommendation } from "./eval-core";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOr = (f: FormData, k: string, d: number | null = null): number | null => { const v = str(f, k).replace(/,/g, ""); return v === "" || Number.isNaN(Number(v)) ? d : Number(v); };
const flag = (f: FormData, k: string) => f.get(k) === "1" || f.get(k) === "on";

async function load(f: FormData | number, perm: string, opts: { draftOnly?: boolean } = {}): Promise<{ me: AuthUser; rfx: ReturnType<typeof mustRfx>; db: ReturnType<typeof getDb> }> {
  const me = await requirePermission("procurement", perm);
  const db = getDb();
  refreshRfxStatuses(db);
  const id = typeof f === "number" ? f : Number(f.get("id") ?? f.get("rfx_id"));
  const rfx = mustRfx(db, id);
  assertUserEntity(me, rfx.entity_id, "Supplier tender");
  if (opts.draftOnly && rfx.status !== "draft") throw new RfxError("Only a draft tender can be edited.");
  return { me, rfx, db };
}
const done = (id: number) => { revalidatePath(`/procurement/${id}`); revalidatePath(`/procurement/${id}/edit`); revalidatePath("/procurement"); revalidatePath("/approvals"); revalidatePath("/", "layout"); };

/* ------------------------------------------------------------------ create + draft editor */

export async function createRfxAction(f: FormData): Promise<ActionResult> {
  let id = 0;
  const r = await guard(async () => {
    const me = await requirePermission("procurement", "create");
    const db = getDb();
    const projectId = Number(f.get("project_id"));
    const proj = db.prepare("SELECT entity_id FROM projects WHERE id = ?").get(projectId) as { entity_id: number } | undefined;
    if (!proj) throw new RfxError("Choose a project.");
    assertUserEntity(me, proj.entity_id, "Project");
    const kind = str(f, "scope_kind") as "project" | "subproject" | "stages";
    id = createDraft(db, { entityId: proj.entity_id, userId: me.id, projectId, scopeKind: kind, stageIds: f.getAll("stage").map(Number).filter(Boolean), title: str(f, "title"), description: str(f, "description"),
      categoryId: numOr(f, "category_id"), templateId: numOr(f, "template_id"), procedure: str(f, "procedure") === "selective" ? "selective" : "open" });
    revalidatePath("/procurement");
  });
  if (r.ok) redirect(`/procurement/${id}/edit`);
  return r;
}

/** Sections 1-2: title, scope text, category, procedure, template (changing the template re-copies steps + requirements). */
export async function saveRfxDetails(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    db.transaction(() => {
      db.prepare("UPDATE rfx_tenders SET title = ?, description = ?, category_id = ?, procedure = ?, owner_id = ? WHERE id = ?")
        .run(str(f, "title") || rfx.title, str(f, "description") || null, numOr(f, "category_id"), str(f, "procedure") === "selective" ? "selective" : "open", numOr(f, "owner_id", rfx.owner_id), rfx.id);
      const tpl = numOr(f, "template_id");
      if (tpl && tpl !== rfx.template_id) copyTemplateInto(db, rfx.id, tpl);
    })();
    done(rfx.id);
    return "Saved.";
  });
}
export async function saveRfxDates(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    const d = { publish_at: localToIso(str(f, "publish_at")), clarification_deadline: localToIso(str(f, "clarification_deadline")), site_visit_at: localToIso(str(f, "site_visit_at")), closing_at: localToIso(str(f, "closing_at")), opening_at: localToIso(str(f, "opening_at")) };
    const err = validateRfxDates(d);
    if (err) throw new RfxError(err);
    db.prepare("UPDATE rfx_tenders SET publish_at = ?, clarification_deadline = ?, site_visit_at = ?, site_visit_note = ?, closing_at = ?, opening_at = ?, validity_days = ? WHERE id = ?")
      .run(d.publish_at, d.clarification_deadline, d.site_visit_at, str(f, "site_visit_note") || null, d.closing_at, d.opening_at, Math.max(1, Math.floor(numOr(f, "validity_days", 90) ?? 90)), rfx.id);
    done(rfx.id);
    return "Dates saved.";
  });
}
export async function saveRfxTerms(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    const pct = (k: string) => { const v = numOr(f, k, 0) ?? 0; if (v < 0 || v > 100) throw new RfxError("Percentages must be between 0 and 100."); return v; };
    db.prepare("UPDATE rfx_tenders SET bid_bond_pct = ?, performance_bond_pct = ?, advance_pct = ?, retention_pct = ?, payment_days = ?, payment_terms = ?, contract_start = ?, contract_end = ?, estimate = ? WHERE id = ?")
      .run(pct("bid_bond_pct"), pct("performance_bond_pct"), pct("advance_pct"), pct("retention_pct"), Math.floor(numOr(f, "payment_days", 30) ?? 30), str(f, "payment_terms") || null, str(f, "contract_start") || null, str(f, "contract_end") || null, numOr(f, "estimate", rfx.estimate), rfx.id);
    done(rfx.id);
    return "Terms saved.";
  });
}
/** BOQ rows come as item_i / desc_i / unit_i / qty_i / rate_i; rows without a description are dropped. `reprefill` rebuilds them from the scope's budget lines. */
export async function saveRfxBoq(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    const dec = decimalsOf(entityCurrency(db, rfx.entity_id));
    if (str(f, "mode") === "reprefill") { replaceBoq(db, rfx.id, prefillBoq(db, scopeStageIds(db, rfx), dec), dec); done(rfx.id); return "BOQ rebuilt from the project budget lines."; }
    const n = Number(f.get("rows") ?? 0);
    const lines: { item_no: string; description: string; unit: string | null; quantity: number; stage_id: number | null; estimate_rate: number }[] = [];
    for (let i = 0; i < n; i++) {
      const desc = str(f, `desc_${i}`);
      if (!desc) continue;
      const qty = numOr(f, `qty_${i}`, 0) ?? 0, rate = numOr(f, `rate_${i}`, 0) ?? 0;
      if (qty <= 0 || rate < 0) throw new RfxError(`Line "${desc}": quantity must be positive and the rate cannot be negative.`);
      lines.push({ item_no: str(f, `item_${i}`) || String(lines.length + 1), description: desc, unit: str(f, `unit_${i}`) || null, quantity: qty, stage_id: numOr(f, `stage_${i}`), estimate_rate: roundTo(rate, 4) });
    }
    if (!lines.length) throw new RfxError("Add at least one BOQ line.");
    replaceBoq(db, rfx.id, lines, dec, flag(f, "set_estimate"));
    done(rfx.id);
    return "BOQ saved.";
  });
}
/** Requirements (name / kind / mandatory / envelope / step) and the step settings (pass mark, weight, criteria max scores). */
export async function saveRfxRequirements(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    db.transaction(() => {
      const n = Number(f.get("rows") ?? 0);
      const keep: number[] = [];
      for (let i = 0; i < n; i++) {
        const name = str(f, `rname_${i}`);
        if (!name) continue;
        const id = Number(f.get(`rid_${i}`)) || 0;
        const vals = [name, ["document", "text", "number", "yes_no", "date"].includes(str(f, `rkind_${i}`)) ? str(f, `rkind_${i}`) : "document", flag(f, `rmand_${i}`) ? 1 : 0, str(f, `renv_${i}`) === "commercial" ? "commercial" : "technical", numOr(f, `rstep_${i}`), str(f, `rhint_${i}`) || null, keep.length + 1];
        if (id) { db.prepare("UPDATE rfx_requirements SET name = ?, kind = ?, mandatory = ?, envelope = ?, step_id = ?, instructions = ?, sort = ? WHERE id = ? AND rfx_id = ?").run(...vals, id, rfx.id); keep.push(id); }
        else keep.push(Number(db.prepare("INSERT INTO rfx_requirements(name, kind, mandatory, envelope, step_id, instructions, sort, rfx_id) VALUES (?,?,?,?,?,?,?,?)").run(...vals, rfx.id).lastInsertRowid));
      }
      db.prepare(`DELETE FROM rfx_requirements WHERE rfx_id = ? ${keep.length ? `AND id NOT IN (${keep.join(",")})` : ""}`).run(rfx.id);
      for (const s of db.prepare("SELECT id FROM rfx_steps WHERE rfx_id = ?").all(rfx.id) as { id: number }[]) {
        db.prepare("UPDATE rfx_steps SET pass_mark = ?, weight = ? WHERE id = ?").run(numOr(f, `spass_${s.id}`), numOr(f, `sweight_${s.id}`), s.id);
        for (const c of db.prepare("SELECT id FROM rfx_criteria WHERE step_id = ?").all(s.id) as { id: number }[]) { const m = numOr(f, `cmax_${c.id}`); if (m && m > 0) db.prepare("UPDATE rfx_criteria SET max_score = ? WHERE id = ?").run(m, c.id); }
      }
      const w = numOr(f, "tech_weight"), c = numOr(f, "commercial_weight"), pm = numOr(f, "tech_pass_mark");
      if (w !== null && c !== null) {
        if (rfx.evaluation_method !== "lowest_compliant" && Math.round(w + c) !== 100) throw new RfxError("Technical and commercial weights must total 100.");
        db.prepare("UPDATE rfx_tenders SET tech_weight = ?, commercial_weight = ?, tech_pass_mark = COALESCE(?, tech_pass_mark) WHERE id = ?").run(w, c, pm, rfx.id);
      }
    })();
    done(rfx.id);
    return "Requirements and steps saved.";
  });
}
export async function saveRfxCommittee(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    const op = str(f, "op");
    if (op === "remove") db.prepare("DELETE FROM rfx_committee WHERE id = ? AND rfx_id = ?").run(Number(f.get("member_id")), rfx.id);
    else {
      const user = Number(f.get("user_id"));
      if (!user) throw new RfxError("Choose a user.");
      const steps = f.getAll("step").map(Number).filter(Boolean);
      const role = ["chair", "member", "secretary", "observer"].includes(str(f, "role")) ? str(f, "role") : "member";
      if (role === "chair") db.prepare("UPDATE rfx_committee SET role = 'member' WHERE rfx_id = ? AND role = 'chair'").run(rfx.id);
      db.prepare(`INSERT INTO rfx_committee(rfx_id, user_id, role, steps) VALUES (?,?,?,?) ON CONFLICT(rfx_id, user_id) DO UPDATE SET role = excluded.role, steps = excluded.steps`).run(rfx.id, user, role, steps.length ? JSON.stringify(steps) : null);
    }
    done(rfx.id);
  });
}
export async function saveRfxInvitees(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    if (str(f, "op") === "remove") db.prepare("DELETE FROM rfx_invitations WHERE rfx_id = ? AND subcontractor_id = ?").run(rfx.id, Number(f.get("sub_id")));
    else for (const s of f.getAll("sub_id").map(Number).filter(Boolean)) {
      const ok = db.prepare("SELECT 1 FROM subcontractors WHERE id = ? AND entity_id = ? AND registration_status = 'approved'").get(s, rfx.entity_id);
      if (ok) db.prepare("INSERT OR IGNORE INTO rfx_invitations(rfx_id, subcontractor_id, source) VALUES (?,?, 'invited')").run(rfx.id, s);
    }
    done(rfx.id);
  });
}
export async function deleteRfxDraft(f: FormData): Promise<ActionResult> {
  const r = await guard(async () => {
    const { rfx, db } = await load(f, "edit", { draftOnly: true });
    db.prepare("DELETE FROM rfx_tenders WHERE id = ?").run(rfx.id);
    revalidatePath("/procurement");
  });
  if (r.ok) redirect("/procurement");
  return r;
}

/** Submit for publication approval (`rfx_publish`). */
export async function submitPublish(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "publish");
    const why = publishBlockers(db, rfx);
    if (why.length) throw new RfxError(why[0]);
    if (hasOpenRequest("rfx_publish", rfx.id)) throw new RfxError("Already awaiting approval.");
    const payload = { base_url: await requestOrigin() };
    db.transaction(() => {
      submitForApproval("rfx_publish", rfx.id, { userId: me.id, payload, note: str(f, "note") || null });
      db.prepare("UPDATE rfx_tenders SET status = 'pending_approval' WHERE id = ? AND status = 'draft'").run(rfx.id);
    })();
    done(rfx.id);
    return "Submitted for approval.";
  });
}

/* ------------------------------------------------------------------ published phase */

export async function closeBiddingAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, rfx, db } = await load(f, "open"); if (!isAdminUser(me) && rfx.owner_id !== me.id) throw new RfxError("Only the tender owner or an administrator can close bidding early."); closeBiddingNow(db, rfx.id, me.id); done(rfx.id); return "Bidding closed."; });
}
export async function answerClarificationAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, rfx, db } = await load(f, "edit"); answerClarification(db, Number(f.get("clarification_id")), str(f, "answer"), me.id, await requestOrigin()); done(rfx.id); return "Answer published to all bidders."; });
}
export async function issueAddendumAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "edit");
    let attId: number | null = null;
    const file = f.get("file");
    if (file instanceof File && file.size > 0) attId = (await saveUpload(file, "rfx", rfx.id, "Addendum", { uploadedBy: me.id })).id;
    const newClosing = localToIso(str(f, "new_closing_at"));
    issueAddendum(db, rfx.id, { title: str(f, "title"), description: str(f, "description"), attachmentId: attId, newClosingAt: newClosing }, me.id, await requestOrigin());
    done(rfx.id);
    return "Addendum issued; every bidder and invitee was notified.";
  });
}

/* ------------------------------------------------------------------ opening + evaluation */

export async function recordOpeningAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "open");
    const members = (db.prepare("SELECT user_id, role FROM rfx_committee WHERE rfx_id = ?").all(rfx.id) as { user_id: number; role: string }[]);
    if (!isAdminUser(me) && !members.some((m) => m.user_id === me.id && ["secretary", "chair"].includes(m.role)) && rfx.owner_id !== me.id) throw new RfxError("The board secretary records the opening.");
    const kind = str(f, "kind") as "opening" | "tech_opening" | "commercial_opening";
    const register = (db.prepare("SELECT id FROM rfx_bids WHERE rfx_id = ? AND status IN ('submitted', 'qualified', 'disqualified', 'late_refused', 'withdrawn')").all(rfx.id) as { id: number }[])
      .map((b) => ({ bidId: b.id, bondYes: flag(f, `bond_${b.id}`), note: str(f, `note_${b.id}`) }));
    recordOpening(db, rfx.id, { kind, at: localToIso(str(f, "at")) ?? new Date().toISOString(), attendeeIds: f.getAll("attendee").map(Number).filter(Boolean), observers: str(f, "observers"), minutes: str(f, "minutes"), register }, me.id, (id) => commercialGate(db, id));
    refreshEvaluation(db, rfx.id);
    done(rfx.id);
    return "Opening recorded.";
  });
}
export async function startEvaluationAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, rfx, db } = await load(f, "open"); startEvaluation(db, rfx.id, me.id); done(rfx.id); return "Evaluation started."; });
}
export async function declareCoiAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, rfx, db } = await load(f, "evaluate"); declareCoi(db, rfx.id, me.id, str(f, "conflict") === "yes", str(f, "note") || null); done(rfx.id); return "Declaration recorded."; });
}
/** One evaluator's scores for one bid and step: fields score_<criterionId>, comment_<criterionId>. */
export async function saveScoresAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "evaluate");
    const bidId = Number(f.get("bid_id")), stepId = Number(f.get("step_id"));
    db.transaction(() => {
      for (const c of db.prepare("SELECT id FROM rfx_criteria WHERE step_id = ?").all(stepId) as { id: number }[]) {
        const v = numOr(f, `score_${c.id}`);
        if (v !== null) setScore(db, { bidId, stepId, criterionId: c.id, evaluatorId: me.id, score: v, comment: str(f, `comment_${c.id}`) || null });
      }
    })();
    done(rfx.id);
    return "Scores saved.";
  });
}
export async function markComplianceAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "evaluate");
    markCompliance(db, { bidId: Number(f.get("bid_id")), requirementId: Number(f.get("requirement_id")), compliant: str(f, "decision") === "compliant", comment: str(f, "comment") || null, evaluatorId: me.id });
    done(rfx.id);
  });
}
export async function requestFromBidderAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "evaluate");
    requestFromBidder(db, Number(f.get("bid_id")), { kind: str(f, "kind") === "bafo" ? "bafo" : "clarification", message: str(f, "message"), dueAt: localToIso(str(f, "due_at")) }, me.id);
    done(rfx.id);
    return "Request sent to the bidder through the portal.";
  });
}

/* ------------------------------------------------------------------ recommendation + award */

export async function recommendAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, rfx, db } = await load(f, "recommend"); recommendBid(db, rfx.id, Number(f.get("bid_id")), { justification: str(f, "justification"), value: numOr(f, "value") }, me.id); done(rfx.id); return "Recommendation recorded."; });
}
export async function withdrawRecommendationAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, rfx, db } = await load(f, "recommend"); if (hasOpenRequest("rfx_award", rfx.id)) withdrawOpenRequest("rfx_award", rfx.id, me.id); withdrawRecommendation(db, rfx.id, me.id); done(rfx.id); });
}
export async function signOffAction(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, rfx, db } = await load(f, "evaluate"); signOff(db, rfx.id, me.id, str(f, "decision") === "dissent" ? "dissent" : "concur", str(f, "comment") || null); done(rfx.id); return "Sign-off recorded."; });
}
export async function submitAwardAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "recommend");
    const why = awardBlockersOf(db, rfx);
    if (why.length) throw new RfxError(why[0]);
    const payload = { base_url: await requestOrigin() };
    db.transaction(() => {
      submitForApproval("rfx_award", rfx.id, { userId: me.id, payload, note: str(f, "note") || null });
      db.prepare("UPDATE rfx_tenders SET status = 'award_pending' WHERE id = ? AND status = 'recommended'").run(rfx.id);
    })();
    done(rfx.id);
    return "Award submitted for approval.";
  });
}
export async function cancelRfxAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "cancel");
    db.transaction(() => {
      withdrawOpenRequest("rfx_publish", rfx.id, me.id); withdrawOpenRequest("rfx_award", rfx.id, me.id);
      cancelRfx(db, rfx.id, str(f, "reason"), me.id);
    })();
    done(rfx.id);
    return "Tender cancelled; bidders were notified.";
  });
}

/* ------------------------------------------------------------------ tender documents + templates */

export async function uploadRfxDocument(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx } = await load(f, "edit");
    if (["awarded", "cancelled"].includes(rfx.status)) throw new RfxError("The tender is closed for changes.");
    let n = 0;
    for (const file of f.getAll("files")) if (file instanceof File && file.size > 0) { await saveUpload(file, "rfx", rfx.id, str(f, "category") || "Other", { uploadedBy: me.id }); n++; }
    if (!n) throw new RfxError("Choose a file.");
    await logActivity("rfx", rfx.id, "upload", `${n} tender document${n === 1 ? "" : "s"} uploaded`);
    done(rfx.id);
    return `${n} file${n === 1 ? "" : "s"} uploaded; visible to eligible bidders once published.`;
  });
}
export async function inviteMoreAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, rfx, db } = await load(f, "edit");
    if (rfx.status !== "published") throw new RfxError("Suppliers can be invited while the tender is published.");
    const sub = Number(f.get("sub_id"));
    if (!db.prepare("SELECT 1 FROM subcontractors WHERE id = ? AND entity_id = ? AND registration_status = 'approved'").get(sub, rfx.entity_id)) throw new RfxError("Choose an approved supplier of this country.");
    invite(db, rfx, sub, "invited", await requestOrigin());
    logRfx(db, rfx.id, "invite", "A supplier was invited", me.id);
    done(rfx.id);
    return "Invitation sent.";
  });
}

// templates -------------------------------------------------------------
async function tplGuard(f: FormData) {
  const me = await requirePermission("procurement", "setup");
  const db = getDb();
  const id = Number(f.get("id"));
  const t = db.prepare("SELECT * FROM rfx_templates WHERE id = ?").get(id) as { id: number; entity_id: number | null } | undefined;
  if (!t) throw new RfxError("Template not found");
  if (t.entity_id) assertUserEntity(me, t.entity_id, "Template");
  return { me, db, t };
}
export async function saveTemplateAction(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { db, t } = await tplGuard(f);
    const method = str(f, "evaluation_method");
    if (!["lowest_compliant", "weighted", "two_envelope_weighted"].includes(method)) throw new RfxError("Unknown evaluation method.");
    const tw = numOr(f, "tech_weight", 0) ?? 0, cw = numOr(f, "commercial_weight", 0) ?? 0;
    if (method !== "lowest_compliant" && Math.round(tw + cw) !== 100) throw new RfxError("Technical and commercial weights must total 100.");
    db.prepare(`UPDATE rfx_templates SET name = ?, description = ?, active = ?, evaluation_method = ?, tech_weight = ?, commercial_weight = ?, tech_pass_mark = ?, bid_bond_pct = ?, performance_bond_pct = ?,
      default_validity_days = ?, min_bidders = ?, clarification_days_before_close = ? WHERE id = ?`).run(str(f, "name") || "Template", str(f, "description") || null, flag(f, "active") ? 1 : 0, method, tw, cw, numOr(f, "tech_pass_mark", 70), numOr(f, "bid_bond_pct", 0),
      numOr(f, "performance_bond_pct", 0), Math.floor(numOr(f, "default_validity_days", 90) ?? 90), Math.floor(numOr(f, "min_bidders", 3) ?? 3), Math.floor(numOr(f, "clarification_days_before_close", 7) ?? 7), t.id);
    for (const s of db.prepare("SELECT id FROM rfx_template_steps WHERE template_id = ?").all(t.id) as { id: number }[]) {
      db.prepare("UPDATE rfx_template_steps SET pass_mark = ?, weight = ? WHERE id = ?").run(numOr(f, `spass_${s.id}`), numOr(f, `sweight_${s.id}`), s.id);
      for (const c of db.prepare("SELECT id FROM rfx_template_criteria WHERE step_id = ?").all(s.id) as { id: number }[]) { const m = numOr(f, `cmax_${c.id}`); if (m && m > 0) db.prepare("UPDATE rfx_template_criteria SET max_score = ? WHERE id = ?").run(m, c.id); }
    }
    for (const r of db.prepare("SELECT id FROM rfx_template_requirements WHERE template_id = ?").all(t.id) as { id: number }[]) {
      if (f.get(`rdel_${r.id}`)) { db.prepare("DELETE FROM rfx_template_requirements WHERE id = ?").run(r.id); continue; }
      db.prepare("UPDATE rfx_template_requirements SET name = COALESCE(NULLIF(?, ''), name), mandatory = ?, envelope = ? WHERE id = ?").run(str(f, `rname_${r.id}`), flag(f, `rmand_${r.id}`) ? 1 : 0, str(f, `renv_${r.id}`) === "commercial" ? "commercial" : "technical", r.id);
    }
    const newName = str(f, "new_req_name");
    if (newName) db.prepare("INSERT INTO rfx_template_requirements(template_id, name, kind, mandatory, envelope, step_id, sort) VALUES (?,?,?,?,?,?, 99)").run(t.id, newName, str(f, "new_req_kind") || "document", flag(f, "new_req_mand") ? 1 : 0, str(f, "new_req_env") === "commercial" ? "commercial" : "technical", numOr(f, "new_req_step"));
    revalidatePath("/procurement/setup/templates", "layout");
    return "Template saved. Live tenders keep their own copy.";
  });
}
export async function duplicateTemplateAction(f: FormData): Promise<ActionResult> {
  let nid = 0;
  const r = await guard(async () => {
    const { db, t, me } = await tplGuard(f);
    void me;
    db.transaction(() => {
      const src = db.prepare("SELECT * FROM rfx_templates WHERE id = ?").get(t.id) as Record<string, unknown>;
      nid = Number(db.prepare(`INSERT INTO rfx_templates(entity_id, name, description, active, evaluation_method, tech_weight, commercial_weight, tech_pass_mark, bid_bond_pct, performance_bond_pct, default_validity_days, min_bidders, clarification_days_before_close)
        VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?)`).run(src.entity_id, `${src.name} (copy)`, src.description, src.evaluation_method, src.tech_weight, src.commercial_weight, src.tech_pass_mark, src.bid_bond_pct, src.performance_bond_pct, src.default_validity_days, src.min_bidders, src.clarification_days_before_close).lastInsertRowid);
      const map = new Map<number, number>();
      for (const s of db.prepare("SELECT * FROM rfx_template_steps WHERE template_id = ? ORDER BY sort").all(t.id) as Record<string, unknown>[]) {
        const sid = Number(db.prepare("INSERT INTO rfx_template_steps(template_id, step_key, name, kind, gate, weight, pass_mark, evaluator_role, sort) VALUES (?,?,?,?,?,?,?,?,?)").run(nid, s.step_key, s.name, s.kind, s.gate, s.weight, s.pass_mark, s.evaluator_role, s.sort).lastInsertRowid);
        map.set(s.id as number, sid);
        for (const c of db.prepare("SELECT * FROM rfx_template_criteria WHERE step_id = ?").all(s.id as number) as Record<string, unknown>[]) db.prepare("INSERT INTO rfx_template_criteria(step_id, criterion, max_score, guidance, sort) VALUES (?,?,?,?,?)").run(sid, c.criterion, c.max_score, c.guidance, c.sort);
      }
      for (const q of db.prepare("SELECT * FROM rfx_template_requirements WHERE template_id = ? ORDER BY sort").all(t.id) as Record<string, unknown>[]) db.prepare("INSERT INTO rfx_template_requirements(template_id, name, kind, mandatory, envelope, step_id, instructions, sort) VALUES (?,?,?,?,?,?,?,?)").run(nid, q.name, q.kind, q.mandatory, q.envelope, q.step_id ? map.get(q.step_id as number) ?? null : null, q.instructions, q.sort);
    })();
    revalidatePath("/procurement/setup/templates", "layout");
  });
  if (r.ok) redirect(`/procurement/setup/templates/${nid}`);
  return r;
}
export { userName };
