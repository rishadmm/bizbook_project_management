import { getDb } from "@/lib/db";
import { userInEntitySql } from "@/lib/entities";
import type { LossAnalysis, User } from "@/lib/types";

export type LossRow = LossAnalysis & {
  tender_code: string; tender_title: string; tender_category: string; client_name: string | null; owner_name: string | null; decided_at: string | null; entity_id: number;
};
const SELECT = `SELECT l.*, t.code AS tender_code, t.title AS tender_title, t.category AS tender_category, t.decided_at, c.name AS client_name, u.name AS owner_name, t.entity_id
  FROM loss_analyses l JOIN tenders t ON t.id = l.tender_id LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = l.owner_id`;

export function listLosses(entityId: number): LossRow[] {
  return getDb().prepare(`${SELECT} WHERE t.entity_id = ? ORDER BY t.decided_at DESC, l.id DESC`).all(entityId) as LossRow[];
}
export function getLoss(id: number): LossRow | undefined {
  return getDb().prepare(`${SELECT} WHERE l.id = ?`).get(id) as LossRow | undefined;
}
export function allUsers(entityId: number): User[] { return getDb().prepare(`SELECT u.* FROM users u WHERE ${userInEntitySql("u")} ORDER BY u.name`).all(entityId) as User[]; }

export interface LossStats {
  total: number; open: number; avgGap: number | null; priceLosses: number;
  byReason: { reason: string; count: number }[]; byCategory: { category: string; count: number }[]; gapByReason: { reason: string; gap: number }[];
}
export function lossStats(rows: LossRow[]): LossStats {
  const count = <K extends string>(f: (r: LossRow) => K) => { const m = new Map<K, number>(); rows.forEach((r) => m.set(f(r), (m.get(f(r)) ?? 0) + 1)); return [...m.entries()]; };
  const gaps = rows.filter((r) => r.price_gap_pct !== null);
  const gm = new Map<string, number[]>();
  gaps.forEach((r) => gm.set(r.primary_reason, [...(gm.get(r.primary_reason) ?? []), r.price_gap_pct as number]));
  return {
    total: rows.length, open: rows.filter((r) => r.status !== "closed").length,
    avgGap: gaps.length ? gaps.reduce((s, r) => s + (r.price_gap_pct as number), 0) / gaps.length : null,
    priceLosses: rows.filter((r) => r.primary_reason === "price").length,
    byReason: count((r) => r.primary_reason).map(([reason, c]) => ({ reason, count: c })),
    byCategory: count((r) => r.tender_category).map(([category, c]) => ({ category, count: c })),
    gapByReason: [...gm.entries()].map(([reason, v]) => ({ reason, gap: v.reduce((a, b) => a + b, 0) / v.length })),
  };
}
