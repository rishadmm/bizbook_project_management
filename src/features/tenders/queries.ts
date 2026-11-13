import { getDb } from "@/lib/db";
import { OPEN_TENDER_STATUSES } from "@/lib/status";
import { daysUntil } from "@/lib/format";
import type {
  BudgetLine, Client, Department, MarginChange, Negotiation, Tender, TenderReview, TenderRevision, TenderSection, User,
} from "@/lib/types";

export interface TenderRow extends Tender {
  client_name: string | null; owner_name: string | null; rev_label: string | null; rev_cost: number; rev_price: number;
  /** Best available value: won_value (won) > current revision price > estimated value. */
  value: number;
}
export interface TenderFilters { status?: string; category?: string; client?: string; owner?: string; q?: string; sort?: string }

const BASE = `SELECT t.*, c.name AS client_name, u.name AS owner_name, r.label AS rev_label,
  COALESCE(r.total_cost,0) AS rev_cost, COALESCE(r.total_price,0) AS rev_price
  FROM tenders t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.owner_id
  LEFT JOIN tender_revisions r ON r.id = t.current_revision_id`;

function withValue(rows: Omit<TenderRow, "value">[]): TenderRow[] {
  return rows.map((r) => ({ ...r, value: r.status === "won" && r.won_value ? r.won_value : r.rev_price > 0 ? r.rev_price : r.estimated_value ?? 0 }));
}

export function listTenders(f: TenderFilters = {}): TenderRow[] {
  const where: string[] = []; const args: (string | number)[] = [];
  if (f.status) { where.push("t.status = ?"); args.push(f.status); }
  if (f.category) { where.push("t.category = ?"); args.push(f.category); }
  if (f.client) { where.push("t.client_id = ?"); args.push(Number(f.client)); }
  if (f.owner) { where.push("t.owner_id = ?"); args.push(Number(f.owner)); }
  if (f.q) { where.push("(t.code LIKE ? OR t.title LIKE ? OR t.location LIKE ?)"); const q = `%${f.q}%`; args.push(q, q, q); }
  const order = f.sort === "code" ? "t.code DESC" : f.sort === "probability" ? "t.probability_pct DESC" : "(t.submission_deadline IS NULL), t.submission_deadline ASC";
  const rows = getDb().prepare(`${BASE} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order}, t.id DESC`).all(...args) as Omit<TenderRow, "value">[];
  const out = withValue(rows);
  if (f.sort === "value") out.sort((a, b) => b.value - a.value);
  return out;
}

export interface TenderKpis {
  openCount: number; openValue: number; submittedCount: number; submittedValue: number;
  won: number; lost: number; wonValue: number; lostValue: number; winRateCount: number | null; winRateValue: number | null; due7: number;
}
export function tenderKpis(): TenderKpis {
  const rows = listTenders();
  const open = rows.filter((r) => (OPEN_TENDER_STATUSES as readonly string[]).includes(r.status));
  const sub = rows.filter((r) => r.status === "submitted" || r.status === "negotiation");
  const won = rows.filter((r) => r.status === "won"); const lost = rows.filter((r) => r.status === "lost");
  const sum = (a: TenderRow[]) => a.reduce((s, r) => s + r.value, 0);
  const wv = sum(won); const lv = sum(lost);
  const pre = open.filter((r) => ["draft", "in_preparation", "under_review", "approved"].includes(r.status));
  return {
    openCount: open.length, openValue: sum(open), submittedCount: sub.length, submittedValue: sum(sub),
    won: won.length, lost: lost.length, wonValue: wv, lostValue: lv,
    winRateCount: won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : null,
    winRateValue: wv + lv ? (wv / (wv + lv)) * 100 : null,
    due7: pre.filter((r) => { const d = daysUntil(r.submission_deadline); return d !== null && d >= 0 && d <= 7; }).length,
  };
}

export function lookups(): { clients: Client[]; users: User[]; departments: Department[] } {
  const db = getDb();
  return {
    clients: db.prepare("SELECT * FROM clients ORDER BY name").all() as Client[],
    users: db.prepare("SELECT * FROM users ORDER BY name").all() as User[],
    departments: db.prepare("SELECT * FROM departments ORDER BY name").all() as Department[],
  };
}

export type TenderDetail = Tender & { client_name: string | null; owner_name: string | null; project_code: string | null };
export function getTender(id: number): TenderDetail | undefined {
  return getDb().prepare(`SELECT t.*, c.name AS client_name, u.name AS owner_name, p.code AS project_code FROM tenders t
    LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.owner_id LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`).get(id) as TenderDetail | undefined;
}
export function getRevisions(tenderId: number): TenderRevision[] {
  return getDb().prepare("SELECT * FROM tender_revisions WHERE tender_id = ? ORDER BY rev_no").all(tenderId) as TenderRevision[];
}
export function getBudgetLines(revisionId: number): BudgetLine[] {
  return getDb().prepare("SELECT * FROM budget_lines WHERE revision_id = ? ORDER BY sort, id").all(revisionId) as BudgetLine[];
}
export type SectionRow = TenderSection & { department_name: string | null; assignee_name: string | null };
export function getSections(tenderId: number): SectionRow[] {
  return getDb().prepare(`SELECT s.*, d.name AS department_name, u.name AS assignee_name FROM tender_sections s
    LEFT JOIN departments d ON d.id = s.department_id LEFT JOIN users u ON u.id = s.assignee_id WHERE s.tender_id = ? ORDER BY s.id`).all(tenderId) as SectionRow[];
}
export type ReviewRow = TenderReview & { department_name: string | null; reviewer_name: string | null; rev_label: string | null };
export function getReviews(tenderId: number): ReviewRow[] {
  return getDb().prepare(`SELECT r.*, d.name AS department_name, u.name AS reviewer_name, v.label AS rev_label FROM tender_reviews r
    LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN users u ON u.id = r.reviewer_id LEFT JOIN tender_revisions v ON v.id = r.revision_id
    WHERE r.tender_id = ? ORDER BY r.revision_id DESC, r.id`).all(tenderId) as ReviewRow[];
}
export type NegotiationRow = Negotiation & { rev_label: string | null; rev_price: number | null };
export function getNegotiations(tenderId: number): NegotiationRow[] {
  return getDb().prepare(`SELECT n.*, v.label AS rev_label, v.total_price AS rev_price FROM negotiations n
    LEFT JOIN tender_revisions v ON v.id = n.revision_id WHERE n.tender_id = ? ORDER BY n.date, n.id`).all(tenderId) as NegotiationRow[];
}
export type MarginChangeRow = MarginChange & { line_desc: string | null; item_code: string | null; user_name: string | null; rev_label: string | null };
export function getMarginChanges(tenderId: number, limit = 100): MarginChangeRow[] {
  return getDb().prepare(`SELECT m.*, b.description AS line_desc, b.item_code, u.name AS user_name, v.label AS rev_label FROM margin_changes m
    JOIN tender_revisions v ON v.id = m.revision_id LEFT JOIN budget_lines b ON b.id = m.budget_line_id LEFT JOIN users u ON u.id = m.user_id
    WHERE v.tender_id = ? ORDER BY m.id DESC LIMIT ?`).all(tenderId, limit) as MarginChangeRow[];
}
