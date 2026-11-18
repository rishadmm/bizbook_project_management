// Read models of the Procurement module. Lists / details refresh the lazy statuses first (refreshRfxStatuses). Bid content is NEVER read here: use bid-core's sealed readers.
import { getDb } from "@/lib/db";
import { LIVE_RFX_STATUSES, RECEIVED_BID_STATUSES } from "@/lib/rfx";
import { refreshRfxStatuses, type RfxRow } from "./rfx-core";

const all = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).all(...(a as never[])) as T[];
const one = <T>(sql: string, ...a: unknown[]) => getDb().prepare(sql).get(...(a as never[])) as T | undefined;
const RECEIVED = RECEIVED_BID_STATUSES.map((s) => `'${s}'`).join(",");

export type RfxListRow = RfxRow & { project_code: string; project_name: string; category_name: string | null; owner_name: string | null; bids: number; stage_codes: string | null; flag: string | null; currency: string };
export interface RfxFilters { status?: string; project?: number; category?: number; owner?: number; q?: string }

export function listRfx(entityId: number, f: RfxFilters = {}): RfxListRow[] {
  refreshRfxStatuses(getDb());
  const where = ["t.entity_id = ?"]; const p: unknown[] = [entityId];
  if (f.status) { where.push("t.status = ?"); p.push(f.status); }
  if (f.project) { where.push("t.project_id = ?"); p.push(f.project); }
  if (f.category) { where.push("t.category_id = ?"); p.push(f.category); }
  if (f.owner) { where.push("t.owner_id = ?"); p.push(f.owner); }
  if (f.q) { where.push("(t.code LIKE ? OR t.title LIKE ?)"); p.push(`%${f.q}%`, `%${f.q}%`); }
  return all<RfxListRow>(`SELECT t.*, pr.code project_code, pr.name project_name, c.name category_name, u.name owner_name, en.flag, en.currency,
      (SELECT COUNT(*) FROM rfx_bids b WHERE b.rfx_id = t.id AND b.status IN (${RECEIVED}) AND b.submitted_at IS NOT NULL) bids,
      (SELECT group_concat(COALESCE(s.code, s.name), ', ') FROM rfx_scope sc JOIN stages s ON s.id = sc.stage_id WHERE sc.rfx_id = t.id) stage_codes
    FROM rfx_tenders t JOIN projects pr ON pr.id = t.project_id JOIN entities en ON en.id = t.entity_id LEFT JOIN supplier_categories c ON c.id = t.category_id LEFT JOIN users u ON u.id = t.owner_id
    WHERE ${where.join(" AND ")} ORDER BY CASE t.status WHEN 'cancelled' THEN 2 WHEN 'awarded' THEN 1 ELSE 0 END, t.id DESC`, ...p);
}

export function statusCounts(entityId: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of all<{ status: string; c: number }>("SELECT status, COUNT(*) c FROM rfx_tenders WHERE entity_id = ? GROUP BY status", entityId)) out[r.status] = r.c;
  return out;
}

export interface RfxKpis { open: number; closingSoon: number; bids: number; evaluation: number; awardPending: number; awardedValue: number; savingsPct: number | null; awardedCount: number; currency: string }
export function rfxKpis(entityId: number): RfxKpis {
  refreshRfxStatuses(getDb());
  const now = new Date().toISOString(), in7 = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const n = (sql: string, ...a: unknown[]) => one<{ n: number }>(sql, ...a)?.n ?? 0;
  const year = `${new Date().getFullYear()}-01-01`;
  const aw = one<{ v: number; e: number; c: number }>("SELECT COALESCE(SUM(award_value), 0) v, COALESCE(SUM(estimate), 0) e, COUNT(*) c FROM rfx_tenders WHERE entity_id = ? AND status = 'awarded' AND awarded_at >= ?", entityId, year);
  return {
    open: n("SELECT COUNT(*) n FROM rfx_tenders WHERE entity_id = ? AND status = 'published'", entityId),
    closingSoon: n("SELECT COUNT(*) n FROM rfx_tenders WHERE entity_id = ? AND status = 'published' AND closing_at > ? AND closing_at <= ?", entityId, now, in7),
    bids: n(`SELECT COUNT(*) n FROM rfx_bids b JOIN rfx_tenders t ON t.id = b.rfx_id WHERE t.entity_id = ? AND t.status IN ('published', 'closed', 'opening', 'evaluation', 'recommended', 'award_pending') AND b.status IN (${RECEIVED}) AND b.submitted_at IS NOT NULL`, entityId),
    evaluation: n("SELECT COUNT(*) n FROM rfx_tenders WHERE entity_id = ? AND status IN ('closed', 'opening', 'evaluation', 'recommended')", entityId),
    awardPending: n("SELECT COUNT(*) n FROM rfx_tenders WHERE entity_id = ? AND status = 'award_pending'", entityId),
    awardedValue: aw?.v ?? 0, awardedCount: aw?.c ?? 0, savingsPct: aw && aw.e > 0 ? ((aw.e - aw.v) / aw.e) * 100 : null,
    currency: one<{ currency: string }>("SELECT currency FROM entities WHERE id = ?", entityId)?.currency ?? "AED",
  };
}

/** Compact numbers for the dashboard card. */
export function procurementCard(entityId: number): { open: number; closingWeek: number; pendingRegistrations: number; awardsPending: number } {
  const k = rfxKpis(entityId);
  const reg = one<{ n: number }>("SELECT COUNT(*) n FROM subcontractors WHERE entity_id = ? AND registration_status IN ('submitted', 'under_review')", entityId)?.n ?? 0;
  return { open: k.open, closingWeek: k.closingSoon, pendingRegistrations: reg, awardsPending: k.awardPending };
}

export function rfxHeader(id: number): (RfxRow & { project_code: string; project_name: string; project_manager: number | null; category_name: string | null; owner_name: string | null; currency: string; vat_rate: number; flag: string | null }) | undefined {
  refreshRfxStatuses(getDb());
  return one(`SELECT t.*, pr.code project_code, pr.name project_name, pr.manager_id project_manager, c.name category_name, u.name owner_name, en.currency, en.vat_rate, en.flag
    FROM rfx_tenders t JOIN projects pr ON pr.id = t.project_id JOIN entities en ON en.id = t.entity_id LEFT JOIN supplier_categories c ON c.id = t.category_id LEFT JOIN users u ON u.id = t.owner_id WHERE t.id = ?`, id);
}

/** Tenders of a project (Overview section + Subcontracts tab). */
export function rfxOfProject(projectId: number): { id: number; code: string; title: string; status: string; closing_at: string | null; award_value: number | null; estimate: number | null }[] {
  refreshRfxStatuses(getDb());
  return all("SELECT id, code, title, status, closing_at, award_value, estimate FROM rfx_tenders WHERE project_id = ? ORDER BY id DESC", projectId);
}
/** Stage -> tender badge ("Out to tender" for a live one, "Awarded via" for an awarded one). Project / sub-project tenders mark every stage of the project. */
export interface StageTenderChip { rfxId: number; code: string; status: string; closing_at: string | null }
export function stageTenderChips(projectId: number): Map<number, StageTenderChip> {
  refreshRfxStatuses(getDb());
  const out = new Map<number, StageTenderChip>();
  const live = LIVE_RFX_STATUSES.map((s) => `'${s}'`).join(",");
  for (const r of all<{ stage_id: number; id: number; code: string; status: string; closing_at: string | null }>(`SELECT sc.stage_id, t.id, t.code, t.status, t.closing_at FROM rfx_scope sc JOIN rfx_tenders t ON t.id = sc.rfx_id WHERE t.project_id = ? AND t.status IN (${live}, 'awarded') ORDER BY t.id`, projectId))
    out.set(r.stage_id, { rfxId: r.id, code: r.code, status: r.status, closing_at: r.closing_at });
  for (const t of all<{ id: number; code: string; status: string; closing_at: string | null }>(`SELECT id, code, status, closing_at FROM rfx_tenders WHERE project_id = ? AND scope_kind IN ('project', 'subproject') AND status IN (${live})`, projectId))
    for (const s of all<{ id: number }>("SELECT id FROM stages WHERE project_id = ?", projectId)) if (!out.has(s.id)) out.set(s.id, { rfxId: t.id, code: t.code, status: t.status, closing_at: t.closing_at });
  return out;
}

export function listTemplates(entityId: number) {
  return all<{ id: number; entity_id: number | null; name: string; description: string | null; active: number; evaluation_method: string; tech_weight: number; commercial_weight: number; tech_pass_mark: number; steps: number; reqs: number; used: number }>(
    `SELECT t.*, (SELECT COUNT(*) FROM rfx_template_steps s WHERE s.template_id = t.id) steps, (SELECT COUNT(*) FROM rfx_template_requirements r WHERE r.template_id = t.id) reqs,
      (SELECT COUNT(*) FROM rfx_tenders x WHERE x.template_id = t.id) used FROM rfx_templates t WHERE t.entity_id IS NULL OR t.entity_id = ? ORDER BY t.id`, entityId);
}
export function projectOptions(entityId: number) {
  return all<{ id: number; code: string; name: string; parent_id: number | null; status: string }>("SELECT id, code, name, parent_id, status FROM projects WHERE entity_id = ? AND status NOT IN ('closed', 'completed') ORDER BY id", entityId);
}
export function procurementUsers(entityId: number) {
  return all<{ id: number; name: string; job_title: string | null }>(`SELECT u.id, u.name, u.job_title FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.status = 'active'
    AND (COALESCE(r.code, u.role) IN ('super_admin', 'admin') OR EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?)) ORDER BY u.name`, entityId);
}
export const timelineOf = (rfxId: number) => all<{ kind: string; at: string; attendees_json: string | null; minutes: string | null; created_by_name: string | null; data_json: string | null }>(
  "SELECT e.kind, e.at, e.attendees_json, e.minutes, u.name created_by_name, e.data_json FROM rfx_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.rfx_id = ? ORDER BY e.id", rfxId);
