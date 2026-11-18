// Plain (non "use server") tender helpers shared by server actions and the approval registry.
import { getDb } from "../../lib/db";
import { todayISO } from "../../lib/format";
import type { BudgetLine, Tender, TenderRevision } from "../../lib/types";
import { canMove } from "./workflow";

/** Next document code of a country: `<doc_prefix><PFX>-<year>-<seq>` with its own sequence per entity (UAE: PRJ-2026-001, Oman: OM-PRJ-2026-001). */
export function nextCode(table: "tenders" | "projects", prefix: string, entityId: number): string {
  const year = new Date().getFullYear();
  const dp = (getDb().prepare("SELECT doc_prefix p FROM entities WHERE id = ?").get(entityId) as { p: string } | undefined)?.p ?? "";
  const full = `${dp}${prefix}-${year}-`;
  const rows = getDb().prepare(`SELECT code FROM ${table} WHERE entity_id = ? AND code LIKE ?`).all(entityId, `${full}%`) as { code: string }[];
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(full.length)) || 0), 0);
  return `${full}${String(max + 1).padStart(3, "0")}`;
}

export interface WonInput { won_value: number; award_date: string; start_date: string | null; end_date: string | null; manager_id: number | null }

/** Tender won -> project conversion (project, stages and budget lines from the final revision). Returns the new project id. */
export function convertTenderToProject(tenderId: number, input: WonInput): number {
  const db = getDb();
  const t = db.prepare("SELECT * FROM tenders WHERE id = ?").get(tenderId) as Tender | undefined;
  if (!t) throw new Error("Tender not found");
  if (!canMove(t.status, "won")) throw new Error("Only submitted or negotiation tenders can be marked won");
  if (t.project_id) throw new Error("This tender already has a project");
  const rev = db.prepare("SELECT * FROM tender_revisions WHERE id = ?").get(t.current_revision_id) as TenderRevision | undefined;
  if (!rev) throw new Error("Tender has no current revision");
  return db.transaction(() => {
    const lines = db.prepare("SELECT * FROM budget_lines WHERE revision_id = ? ORDER BY sort, id").all(rev.id) as BudgetLine[];
    const stageNames: string[] = [];
    for (const l of lines) {
      const n = (l.wbs_stage ?? "").trim();
      if (n && n.toLowerCase() !== "general" && !stageNames.includes(n)) stageNames.push(n);
    }
    const cost = (l: BudgetLine) => l.quantity * l.unit_cost;
    const totalCost = lines.reduce((s, l) => s + cost(l), 0);
    const code = nextCode("projects", "PRJ", t.entity_id);
    const p = db.prepare(`INSERT INTO projects(code, name, tender_id, client_id, category, location, contract_value, budget_cost, start_date, end_date, status,
      manager_id, total_quantity, quantity_unit, description, entity_id) VALUES (?,?,?,?,?,?,?,?,?,?, 'planning', ?,?,?,?,?)`)
      .run(code, t.title, t.id, t.client_id, t.category, t.location, input.won_value, totalCost, input.start_date, input.end_date, input.manager_id, t.quantity, t.quantity_unit, t.scope_summary, t.entity_id);
    const pid = Number(p.lastInsertRowid);
    const stageIds = new Map<string, number>();
    stageNames.forEach((name, i) => {
      const budget = lines.filter((l) => (l.wbs_stage ?? "").trim() === name).reduce((s, l) => s + cost(l), 0);
      const s = db.prepare(`INSERT INTO stages(project_id, code, name, sort, planned_quantity, quantity_unit, planned_start, planned_end, budget_amount, status)
        VALUES (?,?,?,?,0,?,?,?,?, 'not_started')`).run(pid, `S${i + 1}`, name, i + 1, t.quantity_unit, input.start_date, input.end_date, budget);
      stageIds.set(name, Number(s.lastInsertRowid));
    });
    for (const l of lines) {
      const n = (l.wbs_stage ?? "").trim();
      db.prepare(`INSERT INTO project_budget_lines(project_id, stage_id, category, description, unit, quantity, unit_cost, budget_amount, source_budget_line_id)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(pid, stageIds.get(n) ?? null, l.category, l.description, l.unit, l.quantity, l.unit_cost, cost(l), l.id);
    }
    db.prepare("UPDATE tender_revisions SET status = 'final' WHERE id = ?").run(rev.id);
    db.prepare("UPDATE tenders SET status='won', won_value=?, project_id=?, decided_at=? WHERE id=?").run(input.won_value, pid, input.award_date, tenderId);
    return pid;
  })();
}

/** A revision R1+ was approved for release: it becomes the submitted revision, older ones are superseded. */
export function applyRevisionSubmitted(revisionId: number): void {
  const db = getDb();
  const rev = db.prepare("SELECT * FROM tender_revisions WHERE id = ?").get(revisionId) as TenderRevision | undefined;
  if (!rev) throw new Error("Revision not found");
  const t = db.prepare("SELECT * FROM tenders WHERE id = ?").get(rev.tender_id) as Tender;
  db.transaction(() => {
    db.prepare("UPDATE tender_revisions SET status='superseded' WHERE tender_id = ? AND status = 'submitted' AND id != ?").run(rev.tender_id, rev.id);
    db.prepare("UPDATE tender_revisions SET status='submitted', submitted_at=? WHERE id = ?").run(todayISO(), rev.id);
    if (t.status === "submitted") db.prepare("UPDATE tenders SET status='negotiation' WHERE id = ?").run(t.id);
  })();
}
