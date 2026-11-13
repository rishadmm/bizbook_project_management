"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getCurrentUser } from "@/lib/session";
import { refreshRevisionTotals } from "@/lib/metrics";
import { DEFAULT_TENDER_SECTIONS, REVIEW_DEPARTMENTS, ENUMS } from "@/lib/status";
import { todayISO } from "@/lib/format";
import type { BudgetCategory, BudgetLine, Tender, TenderRevision, TenderStatus } from "@/lib/types";
import { canMove, TERMINAL } from "./workflow";
import { isAdminUser, requirePermission } from "@/lib/auth";

const str = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
const strOrNull = (f: FormData, k: string): string | null => str(f, k) || null;
const numOrNull = (f: FormData, k: string): number | null => { const v = str(f, k).replace(/,/g, ""); return v === "" || Number.isNaN(Number(v)) ? null : Number(v); };
const intOrNull = (f: FormData, k: string): number | null => { const n = numOrNull(f, k); return n === null ? null : Math.round(n); };
const isCategory = (c: string): c is BudgetCategory => c in ENUMS.budgetCategory;
const path = (id: number) => `/tenders/${id}`;

function tenderOr404(id: number): Tender {
  const t = getDb().prepare("SELECT * FROM tenders WHERE id = ?").get(id) as Tender | undefined;
  if (!t) throw new Error("Tender not found");
  return t;
}
function currentRevision(t: Tender): TenderRevision {
  const r = getDb().prepare("SELECT * FROM tender_revisions WHERE id = ?").get(t.current_revision_id) as TenderRevision | undefined;
  if (!r) throw new Error("Tender has no current revision");
  return r;
}
function nextCode(table: "tenders" | "projects", prefix: string): string {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const rows = getDb().prepare(`SELECT code FROM ${table} WHERE code LIKE ?`).all(like) as { code: string }[];
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.split("-")[2]) || 0), 0);
  return `${prefix}-${year}-${String(max + 1).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ tender CRUD */

function tenderFields(f: FormData) {
  const title = str(f, "title");
  if (!title) throw new Error("Title is required");
  const prob = intOrNull(f, "probability_pct");
  return {
    title, client_id: intOrNull(f, "client_id"), kind: str(f, "kind") || "tender", category: str(f, "category") || "other",
    location: strOrNull(f, "location"), scope_summary: strOrNull(f, "scope_summary"), technical_spec: strOrNull(f, "technical_spec"),
    quantity: numOrNull(f, "quantity"), quantity_unit: strOrNull(f, "quantity_unit"),
    issue_date: strOrNull(f, "issue_date"), clarification_deadline: strOrNull(f, "clarification_deadline"), submission_deadline: strOrNull(f, "submission_deadline"),
    bid_bond_amount: numOrNull(f, "bid_bond_amount"), estimated_value: numOrNull(f, "estimated_value"), owner_id: intOrNull(f, "owner_id"),
    probability_pct: prob === null ? null : Math.min(100, Math.max(0, prob)),
  };
}

export async function createTender(form: FormData): Promise<void> {
  await requirePermission("tenders", "create");
  const v = tenderFields(form);
  const user = await getCurrentUser();
  const db = getDb();
  const id = db.transaction(() => {
    const code = nextCode("tenders", "TND");
    const info = db.prepare(`INSERT INTO tenders(code, title, client_id, kind, category, location, scope_summary, technical_spec, quantity, quantity_unit,
      issue_date, clarification_deadline, submission_deadline, bid_bond_amount, estimated_value, status, owner_id, probability_pct)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(code, v.title, v.client_id, v.kind, v.category, v.location, v.scope_summary, v.technical_spec,
      v.quantity, v.quantity_unit, v.issue_date, v.clarification_deadline, v.submission_deadline, v.bid_bond_amount, v.estimated_value, v.owner_id ?? (user.id || null), v.probability_pct);
    const tid = Number(info.lastInsertRowid);
    const rev = db.prepare("INSERT INTO tender_revisions(tender_id, rev_no, label, reason, status, created_by) VALUES (?,0,'R0','Initial estimate','draft',?)").run(tid, user.id || null);
    db.prepare("UPDATE tenders SET current_revision_id = ? WHERE id = ?").run(Number(rev.lastInsertRowid), tid);
    for (const [dept, title] of DEFAULT_TENDER_SECTIONS) {
      const d = db.prepare("SELECT id FROM departments WHERE name = ?").get(dept) as { id: number } | undefined;
      db.prepare("INSERT INTO tender_sections(tender_id, department_id, title, status) VALUES (?,?,?, 'not_started')").run(tid, d?.id ?? null, title);
    }
    return tid;
  })();
  await logActivity("tender", id, "created", `Tender created with revision R0 and ${DEFAULT_TENDER_SECTIONS.length} department sections`);
  revalidatePath("/tenders");
  redirect(path(id));
}

export async function updateTender(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const id = Number(form.get("id"));
  tenderOr404(id);
  const v = tenderFields(form);
  getDb().prepare(`UPDATE tenders SET title=?, client_id=?, kind=?, category=?, location=?, scope_summary=?, technical_spec=?, quantity=?, quantity_unit=?,
    issue_date=?, clarification_deadline=?, submission_deadline=?, bid_bond_amount=?, estimated_value=?, owner_id=?, probability_pct=? WHERE id=?`)
    .run(v.title, v.client_id, v.kind, v.category, v.location, v.scope_summary, v.technical_spec, v.quantity, v.quantity_unit, v.issue_date,
      v.clarification_deadline, v.submission_deadline, v.bid_bond_amount, v.estimated_value, v.owner_id, v.probability_pct, id);
  await logActivity("tender", id, "updated", "Tender details updated");
  revalidatePath(path(id)); revalidatePath("/tenders");
}

export async function deleteTender(form: FormData): Promise<void> {
  await requirePermission("tenders", "delete");
  const id = Number(form.get("id"));
  const t = tenderOr404(id);
  if (t.project_id) throw new Error("Cannot delete a tender that has a project");
  if (t.status !== "draft") throw new Error("Only draft tenders can be deleted - cancel it instead");
  getDb().transaction(() => {
    getDb().prepare("UPDATE tenders SET current_revision_id = NULL WHERE id = ?").run(id);
    getDb().prepare("DELETE FROM tenders WHERE id = ?").run(id);
  })();
  revalidatePath("/tenders");
  redirect("/tenders");
}

/* ------------------------------------------------------------------ workflow */

/** Generic status transitions (start prep, send for review, submit, negotiation, back to prep, cancel, no-bid). */
export async function transitionTender(form: FormData): Promise<void> {
  const id = Number(form.get("id"));
  const to = str(form, "to") as TenderStatus;
  const override = str(form, "override") === "on";
  await requirePermission("tenders", to === "submitted" || to === "under_review" ? "submit" : "edit");
  const t = tenderOr404(id);
  if (to === "won" || to === "lost") throw new Error("Use the Mark Won / Mark Lost dialogs");
  if (!canMove(t.status, to)) throw new Error(`Cannot move from ${t.status} to ${to}`);
  const user = await getCurrentUser();
  const db = getDb();
  const rev = currentRevision(t);
  db.transaction(() => {
    if (to === "under_review") {
      const open = db.prepare("SELECT COUNT(*) c FROM tender_sections WHERE tender_id = ? AND status != 'completed'").get(id) as { c: number };
      if (open.c > 0 && !(override && isAdminUser(user))) throw new Error(`${open.c} department section(s) not completed (admin may override)`);
      db.prepare("DELETE FROM tender_reviews WHERE revision_id = ?").run(rev.id);
      for (const name of REVIEW_DEPARTMENTS) {
        const d = db.prepare("SELECT id FROM departments WHERE name = ?").get(name) as { id: number } | undefined;
        db.prepare("INSERT INTO tender_reviews(tender_id, revision_id, department_id, decision) VALUES (?,?,?, 'pending')").run(id, rev.id, d?.id ?? null);
      }
    }
    if (to === "submitted") {
      db.prepare("UPDATE tenders SET submitted_at = ? WHERE id = ?").run(todayISO(), id);
      db.prepare("UPDATE tender_revisions SET status = 'submitted', submitted_at = ? WHERE id = ?").run(todayISO(), rev.id);
    }
    if (to === "cancelled" || to === "no_bid") db.prepare("UPDATE tenders SET decided_at = ? WHERE id = ?").run(todayISO(), id);
    db.prepare("UPDATE tenders SET status = ? WHERE id = ?").run(to, id);
  })();
  await logActivity("tender", id, "status", `Status changed ${t.status} -> ${to}`);
  revalidatePath(path(id)); revalidatePath("/tenders");
}

export async function markWon(form: FormData): Promise<void> {
  await requirePermission("tenders", "approve");
  const id = Number(form.get("id"));
  const t = tenderOr404(id);
  if (!canMove(t.status, "won")) throw new Error("Only submitted or negotiation tenders can be marked won");
  if (t.project_id) throw new Error("This tender already has a project");
  const wonValue = numOrNull(form, "won_value");
  if (!wonValue || wonValue <= 0) throw new Error("Final contract value is required");
  const awardDate = str(form, "award_date") || todayISO();
  const start = strOrNull(form, "start_date"); const end = strOrNull(form, "end_date");
  const managerId = intOrNull(form, "manager_id");
  const rev = currentRevision(t);
  const db = getDb();
  const projectId = db.transaction(() => {
    const lines = db.prepare("SELECT * FROM budget_lines WHERE revision_id = ? ORDER BY sort, id").all(rev.id) as BudgetLine[];
    const stageNames: string[] = [];
    for (const l of lines) {
      const n = (l.wbs_stage ?? "").trim();
      if (n && n.toLowerCase() !== "general" && !stageNames.includes(n)) stageNames.push(n);
    }
    const cost = (l: BudgetLine) => l.quantity * l.unit_cost;
    const totalCost = lines.reduce((s, l) => s + cost(l), 0);
    const code = nextCode("projects", "PRJ");
    const p = db.prepare(`INSERT INTO projects(code, name, tender_id, client_id, category, location, contract_value, budget_cost, start_date, end_date, status,
      manager_id, total_quantity, quantity_unit, description) VALUES (?,?,?,?,?,?,?,?,?,?, 'planning', ?,?,?,?)`)
      .run(code, t.title, t.id, t.client_id, t.category, t.location, wonValue, totalCost, start, end, managerId, t.quantity, t.quantity_unit, t.scope_summary);
    const pid = Number(p.lastInsertRowid);
    const stageIds = new Map<string, number>();
    stageNames.forEach((name, i) => {
      const budget = lines.filter((l) => (l.wbs_stage ?? "").trim() === name).reduce((s, l) => s + cost(l), 0);
      const s = db.prepare(`INSERT INTO stages(project_id, code, name, sort, planned_quantity, quantity_unit, planned_start, planned_end, budget_amount, status)
        VALUES (?,?,?,?,0,?,?,?,?, 'not_started')`).run(pid, `S${i + 1}`, name, i + 1, t.quantity_unit, start, end, budget);
      stageIds.set(name, Number(s.lastInsertRowid));
    });
    for (const l of lines) {
      const n = (l.wbs_stage ?? "").trim();
      db.prepare(`INSERT INTO project_budget_lines(project_id, stage_id, category, description, unit, quantity, unit_cost, budget_amount, source_budget_line_id)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(pid, stageIds.get(n) ?? null, l.category, l.description, l.unit, l.quantity, l.unit_cost, cost(l), l.id);
    }
    db.prepare("UPDATE tender_revisions SET status = 'final' WHERE id = ?").run(rev.id);
    db.prepare("UPDATE tenders SET status='won', won_value=?, project_id=?, decided_at=? WHERE id=?").run(wonValue, pid, awardDate, id);
    return pid;
  })();
  await logActivity("tender", id, "won", `Tender won at final value ${wonValue}; project created`);
  await logActivity("project", projectId, "created", `Project created from tender ${t.code}`);
  revalidatePath(path(id)); revalidatePath("/tenders"); revalidatePath("/projects"); revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

export async function markLost(form: FormData): Promise<void> {
  await requirePermission("tenders", "approve");
  const id = Number(form.get("id"));
  const t = tenderOr404(id);
  if (!canMove(t.status, "lost")) throw new Error("Only submitted or negotiation tenders can be marked lost");
  const reason = str(form, "primary_reason") || "other";
  if (!(reason in ENUMS.lossReason)) throw new Error("Invalid reason");
  const winnerPrice = numOrNull(form, "winner_price");
  const rev = currentRevision(t);
  const ourPrice = rev.total_price > 0 ? rev.total_price : t.estimated_value;
  const gap = winnerPrice && ourPrice ? ((ourPrice - winnerPrice) / winnerPrice) * 100 : null;
  const user = await getCurrentUser();
  const db = getDb();
  const lossId = db.transaction(() => {
    const r = db.prepare(`INSERT INTO loss_analyses(tender_id, primary_reason, winner_name, winner_price, our_price, price_gap_pct, client_feedback, owner_id, status)
      VALUES (?,?,?,?,?,?,?,?, 'open')`).run(id, reason, strOrNull(form, "winner_name"), winnerPrice, ourPrice, gap, strOrNull(form, "client_feedback"), user.id || null);
    db.prepare("UPDATE tenders SET status='lost', decided_at=? WHERE id=?").run(strOrNull(form, "decided_at") ?? todayISO(), id);
    return Number(r.lastInsertRowid);
  })();
  await logActivity("tender", id, "lost", `Tender marked lost (${reason})`);
  await logActivity("loss", lossId, "created", `Loss analysis opened for ${t.code}`);
  revalidatePath(path(id)); revalidatePath("/tenders"); revalidatePath("/lost-analysis"); revalidatePath("/");
  redirect(`/lost-analysis/${lossId}`);
}

/* ------------------------------------------------------------------ sections */

export async function saveSection(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const id = Number(form.get("id"));
  const db = getDb();
  const s = db.prepare("SELECT * FROM tender_sections WHERE id = ?").get(id) as { id: number; tender_id: number; status: string; completed_at: string | null } | undefined;
  if (!s) throw new Error("Section not found");
  const status = str(form, "status");
  if (!(status in ENUMS.sectionStatus)) throw new Error("Invalid status");
  const completed = status === "completed" ? s.completed_at ?? todayISO() : null;
  db.prepare("UPDATE tender_sections SET content=?, status=?, assignee_id=?, due_date=?, completed_at=? WHERE id=?")
    .run(strOrNull(form, "content"), status, intOrNull(form, "assignee_id"), strOrNull(form, "due_date"), completed, id);
  await logActivity("tender", s.tender_id, "section", `Section updated (${status})`);
  revalidatePath(path(s.tender_id));
}

export async function addSection(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const tid = Number(form.get("tender_id")); const title = str(form, "title");
  if (!title) throw new Error("Title is required");
  tenderOr404(tid);
  getDb().prepare("INSERT INTO tender_sections(tender_id, department_id, title, status, assignee_id, due_date) VALUES (?,?,?, 'not_started', ?, ?)")
    .run(tid, intOrNull(form, "department_id"), title, intOrNull(form, "assignee_id"), strOrNull(form, "due_date"));
  await logActivity("tender", tid, "section", `Section added: ${title}`);
  revalidatePath(path(tid));
}

export async function deleteSection(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const id = Number(form.get("id"));
  const s = getDb().prepare("SELECT tender_id, title FROM tender_sections WHERE id = ?").get(id) as { tender_id: number; title: string } | undefined;
  if (!s) return;
  getDb().prepare("DELETE FROM tender_sections WHERE id = ?").run(id);
  await logActivity("tender", s.tender_id, "section", `Section removed: ${s.title}`);
  revalidatePath(path(s.tender_id));
}

/* ------------------------------------------------------------------ budget grid (called from a client component) */

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
export interface LinePatch {
  item_code?: string | null; description?: string; unit?: string | null; quantity?: number; unit_cost?: number;
  margin_pct?: number; wbs_stage?: string | null; notes?: string | null;
}
export interface ImportRow {
  category: string; item_code?: string; description: string; unit?: string; quantity: number; unit_cost: number; margin_pct: number; wbs_stage?: string; notes?: string;
}

function editableRevision(revisionId: number): { rev: TenderRevision; tender: Tender } {
  const rev = getDb().prepare("SELECT * FROM tender_revisions WHERE id = ?").get(revisionId) as TenderRevision | undefined;
  if (!rev) throw new Error("Revision not found");
  if (rev.status !== "draft") throw new Error(`Revision ${rev.label ?? rev.rev_no} is ${rev.status} and read-only`);
  const tender = tenderOr404(rev.tender_id);
  if (TERMINAL.includes(tender.status)) throw new Error("Tender is closed");
  return { rev, tender };
}
const fail = (e: unknown): { ok: false; error: string } => {
  if (e && typeof e === "object" && String((e as { digest?: unknown }).digest ?? "").startsWith("NEXT_REDIRECT")) throw e; // let redirect() (not signed in) through
  return { ok: false, error: e instanceof Error ? e.message : "Unexpected error" };
};
const finite = (n: unknown, name: string): number => { if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${name} must be a number`); return n; };

export async function updateBudgetLine(lineId: number, patch: LinePatch, reason?: string): Promise<ActionResult> {
  try {
    await requirePermission("tender_budget", "edit");
    const db = getDb();
    const line = db.prepare("SELECT * FROM budget_lines WHERE id = ?").get(lineId) as BudgetLine | undefined;
    if (!line) throw new Error("Line not found");
    if (patch.margin_pct !== undefined && patch.margin_pct !== line.margin_pct) await requirePermission("tender_budget", "edit_margin");
    editableRevision(line.revision_id);
    const user = await getCurrentUser();
    const next = { ...line, ...patch };
    if (patch.description !== undefined && !patch.description.trim()) throw new Error("Description is required");
    if (patch.quantity !== undefined) { finite(patch.quantity, "Quantity"); if (patch.quantity < 0) throw new Error("Quantity cannot be negative"); }
    if (patch.unit_cost !== undefined) { finite(patch.unit_cost, "Unit cost"); if (patch.unit_cost < 0) throw new Error("Unit cost cannot be negative"); }
    if (patch.margin_pct !== undefined) {
      finite(patch.margin_pct, "Margin");
      if (patch.margin_pct < -100 || patch.margin_pct > 1000) throw new Error("Margin out of range");
      if (patch.margin_pct !== line.margin_pct && !reason?.trim()) throw new Error("A reason is required when changing margin");
    }
    db.transaction(() => {
      db.prepare("UPDATE budget_lines SET item_code=?, description=?, unit=?, quantity=?, unit_cost=?, margin_pct=?, wbs_stage=?, notes=? WHERE id=?")
        .run(next.item_code, next.description.trim(), next.unit, next.quantity, next.unit_cost, next.margin_pct, next.wbs_stage, next.notes, lineId);
      if (patch.margin_pct !== undefined && patch.margin_pct !== line.margin_pct)
        db.prepare("INSERT INTO margin_changes(budget_line_id, revision_id, old_margin, new_margin, reason, user_id) VALUES (?,?,?,?,?,?)")
          .run(lineId, line.revision_id, line.margin_pct, patch.margin_pct, reason!.trim(), user.id || null);
      refreshRevisionTotals(line.revision_id);
    })();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function addBudgetLine(revisionId: number, category: string): Promise<ActionResult<BudgetLine>> {
  try {
    await requirePermission("tender_budget", "edit");
    if (!isCategory(category)) throw new Error("Invalid category");
    const { rev } = editableRevision(revisionId);
    const db = getDb();
    const last = db.prepare("SELECT MAX(sort) m FROM budget_lines WHERE revision_id = ?").get(revisionId) as { m: number | null };
    const sib = db.prepare("SELECT margin_pct, wbs_stage FROM budget_lines WHERE revision_id = ? AND category = ? ORDER BY id DESC LIMIT 1").get(revisionId, category) as { margin_pct: number; wbs_stage: string | null } | undefined;
    const r = db.prepare("INSERT INTO budget_lines(revision_id, tender_id, sort, category, description, unit, quantity, unit_cost, margin_pct, wbs_stage) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(revisionId, rev.tender_id, (last.m ?? 0) + 1, category, "New item", "nos", 1, 0, sib?.margin_pct ?? 10, sib?.wbs_stage ?? null);
    refreshRevisionTotals(revisionId);
    return { ok: true, data: db.prepare("SELECT * FROM budget_lines WHERE id = ?").get(Number(r.lastInsertRowid)) as BudgetLine };
  } catch (e) { return fail(e); }
}

export async function deleteBudgetLine(lineId: number): Promise<ActionResult> {
  try {
    await requirePermission("tender_budget", "edit");
    const db = getDb();
    const line = db.prepare("SELECT * FROM budget_lines WHERE id = ?").get(lineId) as BudgetLine | undefined;
    if (!line) return { ok: true };
    editableRevision(line.revision_id);
    db.prepare("DELETE FROM budget_lines WHERE id = ?").run(lineId);
    refreshRevisionTotals(line.revision_id);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Set markup % on all lines (scope "all") or one category; every changed line is logged in margin_changes. */
export async function bulkSetMargin(revisionId: number, scope: string, margin: number, reason: string): Promise<ActionResult<{ changed: number }>> {
  try {
    await requirePermission("tender_budget", "edit_margin");
    const { rev } = editableRevision(revisionId);
    finite(margin, "Margin");
    if (margin < -100 || margin > 1000) throw new Error("Margin out of range");
    if (!reason.trim()) throw new Error("A reason is required");
    if (scope !== "all" && !isCategory(scope)) throw new Error("Invalid scope");
    const user = await getCurrentUser();
    const db = getDb();
    const lines = db.prepare(`SELECT id, margin_pct FROM budget_lines WHERE revision_id = ? ${scope === "all" ? "" : "AND category = ?"}`)
      .all(...(scope === "all" ? [revisionId] : [revisionId, scope])) as { id: number; margin_pct: number }[];
    let changed = 0;
    db.transaction(() => {
      for (const l of lines) {
        if (l.margin_pct === margin) continue;
        db.prepare("UPDATE budget_lines SET margin_pct = ? WHERE id = ?").run(margin, l.id);
        db.prepare("INSERT INTO margin_changes(budget_line_id, revision_id, old_margin, new_margin, reason, user_id) VALUES (?,?,?,?,?,?)")
          .run(l.id, revisionId, l.margin_pct, margin, `[bulk: ${scope}] ${reason.trim()}`, user.id || null);
        changed++;
      }
      refreshRevisionTotals(revisionId);
    })();
    await logActivity("tender", rev.tender_id, "margin", `Bulk margin ${margin}% on ${scope === "all" ? "all lines" : scope} (${changed} lines): ${reason.trim()}`);
    revalidatePath(path(rev.tender_id));
    return { ok: true, data: { changed } };
  } catch (e) { return fail(e); }
}

export async function importBudgetLines(revisionId: number, rows: ImportRow[], replace: boolean): Promise<ActionResult<{ imported: number }>> {
  try {
    await requirePermission("tender_budget", "edit");
    const { rev } = editableRevision(revisionId);
    if (!rows.length) throw new Error("No rows to import");
    rows.forEach((r, i) => {
      if (!isCategory(r.category)) throw new Error(`Row ${i + 1}: invalid category "${r.category}"`);
      if (!r.description?.trim()) throw new Error(`Row ${i + 1}: description is required`);
      for (const k of ["quantity", "unit_cost", "margin_pct"] as const) if (!Number.isFinite(r[k])) throw new Error(`Row ${i + 1}: ${k} is not a number`);
    });
    const db = getDb();
    db.transaction(() => {
      if (replace) db.prepare("DELETE FROM budget_lines WHERE revision_id = ?").run(revisionId);
      let sort = ((db.prepare("SELECT MAX(sort) m FROM budget_lines WHERE revision_id = ?").get(revisionId) as { m: number | null }).m ?? 0);
      for (const r of rows)
        db.prepare("INSERT INTO budget_lines(revision_id, tender_id, sort, category, item_code, description, unit, quantity, unit_cost, margin_pct, wbs_stage, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(revisionId, rev.tender_id, ++sort, r.category, r.item_code || null, r.description.trim(), r.unit || null, r.quantity, r.unit_cost, r.margin_pct, r.wbs_stage || null, r.notes || null);
      refreshRevisionTotals(revisionId);
    })();
    await logActivity("tender", rev.tender_id, "budget", `Imported ${rows.length} budget lines from CSV (${replace ? "replaced" : "appended"})`);
    revalidatePath(path(rev.tender_id));
    return { ok: true, data: { imported: rows.length } };
  } catch (e) { return fail(e); }
}

/* ------------------------------------------------------------------ revisions & negotiation */

export async function createRevision(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const tid = Number(form.get("tender_id")); const reason = str(form, "reason");
  if (!reason) throw new Error("A reason is required for a new revision");
  const t = tenderOr404(tid);
  if (!["submitted", "negotiation"].includes(t.status)) throw new Error("New revisions are created after submission");
  const cur = currentRevision(t);
  if (cur.status === "draft") throw new Error("The current revision is still a draft - submit it first");
  const user = await getCurrentUser();
  const db = getDb();
  db.transaction(() => {
    const max = db.prepare("SELECT MAX(rev_no) m FROM tender_revisions WHERE tender_id = ?").get(tid) as { m: number };
    const n = max.m + 1;
    const r = db.prepare("INSERT INTO tender_revisions(tender_id, rev_no, label, reason, status, created_by) VALUES (?,?,?,?, 'draft', ?)").run(tid, n, `R${n}`, reason, user.id || null);
    const rid = Number(r.lastInsertRowid);
    db.prepare(`INSERT INTO budget_lines(revision_id, tender_id, sort, category, item_code, description, unit, quantity, unit_cost, margin_pct, department_id, notes, wbs_stage)
      SELECT ?, tender_id, sort, category, item_code, description, unit, quantity, unit_cost, margin_pct, department_id, notes, wbs_stage FROM budget_lines WHERE revision_id = ?`).run(rid, cur.id);
    db.prepare("UPDATE tenders SET current_revision_id = ? WHERE id = ?").run(rid, tid);
    refreshRevisionTotals(rid);
  })();
  await logActivity("tender", tid, "revision", `New revision created: ${reason}`);
  revalidatePath(path(tid));
}

export async function submitRevision(form: FormData): Promise<void> {
  await requirePermission("tenders", "submit");
  const tid = Number(form.get("tender_id"));
  const t = tenderOr404(tid);
  const cur = currentRevision(t);
  if (cur.status !== "draft" || cur.rev_no === 0) throw new Error("Only a draft revision R1+ can be submitted here");
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE tender_revisions SET status='superseded' WHERE tender_id = ? AND status = 'submitted' AND id != ?").run(tid, cur.id);
    db.prepare("UPDATE tender_revisions SET status='submitted', submitted_at=? WHERE id = ?").run(todayISO(), cur.id);
    if (t.status === "submitted") db.prepare("UPDATE tenders SET status='negotiation' WHERE id = ?").run(tid);
  })();
  await logActivity("tender", tid, "revision", `Revision ${cur.label} submitted to client`);
  revalidatePath(path(tid)); revalidatePath("/tenders");
}

export async function saveRevisionFeedback(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const rid = Number(form.get("revision_id"));
  const rev = getDb().prepare("SELECT tender_id FROM tender_revisions WHERE id = ?").get(rid) as { tender_id: number } | undefined;
  if (!rev) throw new Error("Revision not found");
  getDb().prepare("UPDATE tender_revisions SET client_feedback = ? WHERE id = ?").run(strOrNull(form, "client_feedback"), rid);
  revalidatePath(path(rev.tender_id));
}

export async function saveNegotiation(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const id = Number(form.get("id")) || 0; const tid = Number(form.get("tender_id"));
  const t = tenderOr404(tid);
  const channel = str(form, "channel") || "meeting";
  if (!(channel in ENUMS.negotiationChannel)) throw new Error("Invalid channel");
  const vals = [intOrNull(form, "revision_id") ?? t.current_revision_id, str(form, "date") || todayISO(), channel, strOrNull(form, "summary"), strOrNull(form, "client_position"),
    strOrNull(form, "our_position"), numOrNull(form, "client_target_price"), strOrNull(form, "outcome"), strOrNull(form, "next_step")];
  const db = getDb();
  if (id) db.prepare("UPDATE negotiations SET revision_id=?, date=?, channel=?, summary=?, client_position=?, our_position=?, client_target_price=?, outcome=?, next_step=? WHERE id=? AND tender_id=?").run(...vals, id, tid);
  else db.prepare("INSERT INTO negotiations(revision_id, date, channel, summary, client_position, our_position, client_target_price, outcome, next_step, tender_id) VALUES (?,?,?,?,?,?,?,?,?,?)").run(...vals, tid);
  await logActivity("tender", tid, "negotiation", `Negotiation ${id ? "updated" : "logged"} (${channel})`);
  revalidatePath(path(tid));
}

export async function deleteNegotiation(form: FormData): Promise<void> {
  await requirePermission("tenders", "edit");
  const id = Number(form.get("id")); const tid = Number(form.get("tender_id"));
  getDb().prepare("DELETE FROM negotiations WHERE id = ? AND tender_id = ?").run(id, tid);
  await logActivity("tender", tid, "negotiation", "Negotiation entry deleted");
  revalidatePath(path(tid));
}

/* ------------------------------------------------------------------ reviews */

export async function decideReview(form: FormData): Promise<void> {
  await requirePermission("tenders", "approve");
  const id = Number(form.get("id")); const decision = str(form, "decision");
  if (!["approved", "changes_requested", "rejected"].includes(decision)) throw new Error("Invalid decision");
  const db = getDb();
  const rv = db.prepare("SELECT * FROM tender_reviews WHERE id = ?").get(id) as { id: number; tender_id: number; revision_id: number | null; department_id: number | null } | undefined;
  if (!rv) throw new Error("Review not found");
  const user = await getCurrentUser();
  if (!isAdminUser(user) && user.department_id !== rv.department_id) throw new Error("You can only decide your own department's review");
  const comment = strOrNull(form, "comment");
  if (decision !== "approved" && !comment) throw new Error("A comment is required when requesting changes or rejecting");
  const t = tenderOr404(rv.tender_id);
  if (t.status !== "under_review") throw new Error("Tender is not under review");
  let newStatus: TenderStatus = t.status;
  db.transaction(() => {
    db.prepare("UPDATE tender_reviews SET decision=?, comment=?, reviewer_id=?, decided_at=? WHERE id=?").run(decision, comment, user.id || null, todayISO(), id);
    const all = db.prepare("SELECT decision FROM tender_reviews WHERE tender_id = ? AND revision_id IS ?").all(rv.tender_id, rv.revision_id) as { decision: string }[];
    if (all.some((r) => r.decision === "changes_requested" || r.decision === "rejected")) newStatus = "in_preparation";
    else if (all.every((r) => r.decision === "approved")) newStatus = "approved";
    if (newStatus !== t.status) db.prepare("UPDATE tenders SET status = ? WHERE id = ?").run(newStatus, rv.tender_id);
  })();
  await logActivity("tender", rv.tender_id, "review", `Review ${decision.replace("_", " ")}${newStatus !== t.status ? ` - tender now ${newStatus}` : ""}`);
  revalidatePath(path(rv.tender_id)); revalidatePath("/tenders"); revalidatePath("/");
}
