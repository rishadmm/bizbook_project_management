/* eslint-disable @typescript-eslint/no-explicit-any */
// Demo approval history for `npm run seed`: open requests at different levels (some overdue), approved / rejected / returned
// history and one active delegation. Rows are inserted directly (the documents already carry their final demo status).
import type { DB } from "../db";
import type { ApprovalDocType } from "../types";
import { activeDelegate, applicableLevels, resolveApprovers, selectWorkflow } from "./engine";
import { REGISTRY } from "./registry";

const H = 3_600_000;
export interface SeedOpts {
  requestedBy: number | null; hoursAgo: number; outcome: "approved" | "pending" | "rejected" | "returned";
  /** 1-based index among the applicable levels where a pending / rejected / returned request stands. */
  atLevel?: number; comment?: string; payload?: Record<string, unknown>; note?: string;
}

/** Inserts one demo request (+ tasks + events) following the workflow that would apply today. Returns the request id or null. */
export function seedRequest(db: DB, type: ApprovalDocType, docId: number, o: SeedOpts): number | null {
  const payload = o.payload ?? {};
  const doc = REGISTRY[type].getDocument(docId, payload);
  if (!doc) return null;
  const cat = doc.projectId ? (db.prepare("SELECT category FROM projects WHERE id = ?").get(doc.projectId) as { category: string | null } | undefined)?.category ?? null : null;
  const wf = selectWorkflow(type, { amount: doc.amount, departmentId: doc.departmentId, projectCategory: cat });
  if (!wf) return null;
  const lv = applicableLevels(wf.id, doc.amount);
  if (!lv.length) return null;
  const stop = o.outcome === "approved" ? lv.length - 1 : Math.min(Math.max(o.atLevel ?? 1, 1), lv.length) - 1;
  const t0 = Date.now() - o.hoursAgo * H;
  const iso = (ms: number) => new Date(ms).toISOString();
  const ctx = { requesterId: o.requestedBy, departmentId: doc.departmentId, projectId: doc.projectId };

  // plan the tasks first so nothing is inserted when a level cannot be resolved
  const plan = lv.slice(0, stop + 1).map((l, i) => {
    let ids = resolveApprovers(l, ctx);
    if (!l.allow_self_approval && o.requestedBy) ids = ids.filter((u) => u !== o.requestedBy);
    return { l, ids, created: t0 + i * (o.outcome === "pending" ? Math.min(o.hoursAgo / (stop + 1), 20) : 20) * H };
  });
  if (plan.some((p) => p.ids.length === 0)) return null;

  const reqId = Number(db.prepare(`INSERT INTO approval_requests(document_type, document_id, document_ref, title, amount, workflow_id, current_level, status, requested_by, requested_at, completed_at, note, levels_json, payload)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(type, docId, doc.ref, doc.title, doc.amount, wf.id, lv[stop].level_no, o.outcome, o.requestedBy, iso(t0), null, o.note ?? null, JSON.stringify(lv), JSON.stringify(payload)).lastInsertRowid);
  const ev = (level: number | null, event: string, user: number | null, comment: string | null, at: number) =>
    db.prepare("INSERT INTO approval_events(request_id, level_no, event, user_id, comment, created_at) VALUES (?,?,?,?,?,?)").run(reqId, level, event, user, comment, iso(at));
  const nm = (id: number) => (db.prepare("SELECT name FROM users WHERE id = ?").get(id) as { name: string }).name;
  ev(null, "submitted", o.requestedBy, o.note ?? null, t0);
  const task = db.prepare("INSERT INTO approval_tasks(request_id, level_no, assignee_user_id, status, decision_comment, decided_at, decided_by, delegated_from_user_id, due_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  let last = t0;
  plan.forEach(({ l, ids, created }, idx) => {
    const standing = idx === stop && o.outcome !== "approved";
    const due = iso(created + (l.sla_hours || 0) * H);
    const needed = l.approval_mode === "all" ? ids.length : l.approval_mode === "min" ? Math.min(l.min_approvals, ids.length) : 1;
    // delegation applies to freshly created pending tasks only
    const recent = standing && o.outcome === "pending" && Date.now() - created < 30 * H;
    ids.forEach((u, k) => {
      let assignee = u; let from: number | null = null;
      if (recent) { const d = activeDelegate(u, type); if (d && d !== u && d !== o.requestedBy) { assignee = d; from = u; } }
      if (!standing) {
        const approves = k < needed;
        const at = created + (4 + 3 * k) * H;
        last = Math.max(last, at);
        task.run(reqId, l.level_no, assignee, approves ? "approved" : "skipped", approves ? "Reviewed and approved." : null, approves ? iso(at) : null, approves ? assignee : null, from, due, iso(created));
        if (approves) ev(l.level_no, "approved", assignee, "Reviewed and approved.", at);
      } else if (o.outcome === "pending") {
        task.run(reqId, l.level_no, assignee, "pending", null, null, null, from, due, iso(created));
      } else {
        const decides = k === 0;
        const at = created + 5 * H;
        last = Math.max(last, at);
        const status = decides ? o.outcome : "skipped";
        task.run(reqId, l.level_no, assignee, status, decides ? o.comment ?? "See comment." : null, decides ? iso(at) : null, decides ? assignee : null, from, due, iso(created));
        if (decides) ev(l.level_no, o.outcome, assignee, o.comment ?? null, at);
      }
    });
    if (idx > 0 || true) ev(l.level_no, "level_started", null, `${l.name}: ${ids.map(nm).join(", ")}`, created);
    if (!standing) ev(l.level_no, "level_completed", null, null, created + 8 * H);
  });
  if (o.outcome !== "pending") {
    const done = o.outcome === "approved" ? last + 2 * H : last + H;
    db.prepare("UPDATE approval_requests SET completed_at = ? WHERE id = ?").run(iso(done), reqId);
    ev(null, o.outcome, null, o.comment ?? null, done);
  }
  return reqId;
}

/** Seeds the demo delegation and request history on top of the already seeded documents. */
export function seedApprovalDemo(db: DB, u: { sara: number; daniel: number; imran: number; mariam: number; rahul: number; layla: number; omar: number; hamdan: number }): void {
  const all = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
  const today = new Date().toISOString().slice(0, 10);
  const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  // Technical head Sara is out of office: new tasks of hers go to Daniel.
  db.prepare("INSERT INTO approval_delegations(user_id, delegate_user_id, start_date, end_date, document_types, is_active) VALUES (?,?,?,?,NULL,1)").run(u.sara, u.daniel, plus(-3), plus(10));
  void today;
  const pm = (pid: number) => (db.prepare("SELECT manager_id m FROM projects WHERE id = ?").get(pid) as { m: number | null }).m;

  // ---- tenders: pending / approved submission approvals, award + revision history
  for (const t of all("SELECT id, status, owner_id, project_id, won_value, current_revision_id FROM tenders ORDER BY id")) {
    if (t.status === "under_review") seedRequest(db, "tender_submission", t.id, { requestedBy: t.owner_id, hoursAgo: 20, outcome: "pending", atLevel: 1, note: "All department sections completed." });
    else if (["approved", "submitted", "negotiation", "won", "lost"].includes(t.status)) seedRequest(db, "tender_submission", t.id, { requestedBy: t.owner_id, hoursAgo: 24 * 40, outcome: "approved" });
    if (t.status === "won") seedRequest(db, "tender_award", t.id, { requestedBy: u.omar, hoursAgo: 24 * 25, outcome: "approved", payload: { won_value: t.won_value } });
    // awards of 20M and above wait for the general manager (level 2)
    // (only the negotiation tender: a pending award hides Mark Won / Mark Lost, and the e2e flow marks the newest open tender lost)
    if (t.status === "negotiation") seedRequest(db, "tender_award", t.id, { requestedBy: u.rahul, hoursAgo: t.status === "negotiation" ? 70 : 30, outcome: "pending", atLevel: 2, note: "Client confirmed intent to award; GM sign-off needed (value above 20M)." });
    if (["negotiation", "won", "lost"].includes(t.status)) {
      const rev = db.prepare("SELECT id FROM tender_revisions WHERE tender_id = ? AND rev_no = 1 AND status IN ('submitted','final','superseded')").get(t.id) as { id: number } | undefined;
      if (rev) seedRequest(db, "tender_revision", rev.id, { requestedBy: t.owner_id, hoursAgo: 24 * 18, outcome: "approved" });
      const draft = db.prepare("SELECT id FROM tender_revisions WHERE tender_id = ? AND status = 'draft' AND rev_no > 0").get(t.id) as { id: number } | undefined;
      if (draft && t.status === "negotiation") seedRequest(db, "tender_revision", draft.id, { requestedBy: t.owner_id, hoursAgo: 60, outcome: "pending", atLevel: 2, note: "Round-2 concession (BAFO)." });
    }
  }
  // one returned history item: a submitted tender whose first submission was returned before approval
  const returned = all("SELECT id, owner_id FROM tenders WHERE status = 'submitted' ORDER BY id LIMIT 1")[0];
  if (returned) seedRequest(db, "tender_submission", returned.id, { requestedBy: returned.owner_id, hoursAgo: 24 * 47, outcome: "returned", atLevel: 2, comment: "Cash-flow assumptions need a 60-day payment cycle; revisit contingency before resubmitting." });

  // ---- loss analyses
  for (const l of all("SELECT id, status FROM loss_analyses ORDER BY id")) {
    if (l.status === "closed") seedRequest(db, "loss_analysis", l.id, { requestedBy: u.rahul, hoursAgo: 24 * 12, outcome: "approved" });
    else if (l.status === "in_review") seedRequest(db, "loss_analysis", l.id, { requestedBy: u.rahul, hoursAgo: 30, outcome: "pending", atLevel: 1 });
  }

  // ---- subcontractors
  for (const s of all("SELECT id, status FROM subcontractors ORDER BY id")) {
    const open = (db.prepare("SELECT COUNT(*) c FROM onboarding_checklist WHERE subcontractor_id = ? AND done = 0").get(s.id) as { c: number }).c;
    if (s.status === "approved" || s.status === "suspended") seedRequest(db, "subcontractor_onboarding", s.id, { requestedBy: u.layla, hoursAgo: 24 * 120, outcome: "approved" });
    else if (s.status === "onboarding" && open === 0) seedRequest(db, "subcontractor_onboarding", s.id, { requestedBy: u.layla, hoursAgo: 80, outcome: "pending", atLevel: 2 });
  }

  // ---- assignments
  let n = 0;
  for (const a of all("SELECT id, project_id, status FROM assignments ORDER BY id")) {
    if (a.status === "draft") seedRequest(db, "subcontract_award", a.id, { requestedBy: pm(a.project_id) === u.omar ? u.layla : u.omar, hoursAgo: n++ % 2 === 0 ? 3 : 90, outcome: "pending", atLevel: 1, note: "Awaiting award sign-off." });
    else if (n < 9 && ["active", "completed"].includes(a.status)) { seedRequest(db, "subcontract_award", a.id, { requestedBy: pm(a.project_id) === u.layla ? u.omar : u.layla, hoursAgo: 24 * 90, outcome: "approved" }); n++; }
  }

  // ---- invoices
  const finance = [u.imran, u.mariam];
  let k = 0, payPending = 0, payDone = 0, retSeeded = false;
  for (const i of all("SELECT id, status, project_id FROM sub_invoices ORDER BY id")) {
    const by = finance[k++ % 2];
    if (i.status === "certified") {
      const slow = k % 3 === 0;
      seedRequest(db, "sub_invoice", i.id, { requestedBy: by, hoursAgo: slow ? 24 * 6 : k % 2 ? 30 : 8, outcome: "pending", atLevel: k % 4 === 0 ? 2 : 1 });
    } else if (i.status === "approved") {
      seedRequest(db, "sub_invoice", i.id, { requestedBy: by, hoursAgo: 24 * 30, outcome: "approved" });
      if (payPending < 6 && seedRequest(db, "invoice_payment", i.id, { requestedBy: by, hoursAgo: 52, outcome: "pending", atLevel: 1 })) payPending++;
    } else if (i.status === "paid") {
      seedRequest(db, "sub_invoice", i.id, { requestedBy: by, hoursAgo: 24 * 60, outcome: "approved" });
      if (payDone < 8 && seedRequest(db, "invoice_payment", i.id, { requestedBy: by, hoursAgo: 24 * 45, outcome: "approved" })) payDone++;
    } else if (i.status === "rejected") {
      seedRequest(db, "sub_invoice", i.id, { requestedBy: by, hoursAgo: 24 * 20, outcome: "rejected", atLevel: 1, comment: "Claimed quantities exceed verified progress." });
    } else if (i.status === "under_review" && !retSeeded) {
      seedRequest(db, "sub_invoice", i.id, { requestedBy: by, hoursAgo: 24 * 9, outcome: "returned", atLevel: 2, comment: "Retention deduction missing; please re-certify." });
      retSeeded = true;
    }
  }

  // ---- completion certificates
  let c = 0;
  for (const x of all("SELECT id, status, project_id FROM completion_certificates ORDER BY id")) {
    if (x.status === "issued" && c < 5) { seedRequest(db, "completion_certificate", x.id, { requestedBy: u.rahul, hoursAgo: 24 * 70, outcome: "approved" }); c++; }
    else if (x.status === "rejected") seedRequest(db, "completion_certificate", x.id, { requestedBy: u.omar, hoursAgo: 24 * 21, outcome: "rejected", atLevel: 1, comment: "Snag items outstanding." });
  }

  // ---- manual costs above the threshold (pending)
  const open = all("SELECT id FROM projects WHERE status IN ('active','mobilizing') ORDER BY id");
  const projects = [open[0], open.find((p) => pm(p.id) === u.omar) ?? open[1]];
  projects.forEach((p, idx) => {
    const rid = Number(db.prepare("INSERT INTO project_cost_requests(project_id, category, description, amount, cost_date, created_by, status) VALUES (?,?,?,?,?,?, 'pending')")
      .run(p.id, idx === 0 ? "equipment" : "overhead", idx === 0 ? "Emergency crane hire for bridge girder lift" : "Site establishment extension (temporary offices)", idx === 0 ? 86_000 : 64_500, today, pm(p.id) === u.omar ? u.layla : u.omar).lastInsertRowid);
    seedRequest(db, "project_cost", rid, { requestedBy: pm(p.id) === u.omar ? u.layla : u.omar, hoursAgo: idx === 0 ? 70 : 5, outcome: "pending", atLevel: idx === 0 ? 2 : 1 });
  });
}
