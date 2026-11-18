// Read models for the registration UI (internal queue, public landing, portal bell). No next/* imports.
import { getDb } from "@/lib/db";
import { daysBetween, todayISO } from "@/lib/format";
import { hasOpenRequest } from "@/lib/approvals/engine";
import { listEntities } from "@/lib/entities";
import { completenessOf } from "./core";

export type QueueTab = "submitted" | "under_review" | "referred_back" | "approved" | "rejected" | "draft";
export const QUEUE_TABS: { key: QueueTab; label: string }[] = [
  { key: "submitted", label: "New / Submitted" }, { key: "under_review", label: "Under review" }, { key: "referred_back", label: "Referred back" },
  { key: "approved", label: "Approved" }, { key: "rejected", label: "Rejected" }, { key: "draft", label: "Drafts" },
];

export interface QueueRow {
  id: number; registration_no: string | null; name: string; status: string; submitted_at: string | null; waiting_days: number | null; completeness: number;
  categories: string; reviewer: string | null; awaiting_approval: boolean; resubmit_count: number; country_flag: string | null; country_code: string; portal_slug: string | null;
}

/** Counts per queue tab for one country (the Approved tab only counts suppliers that went through the registration). */
export function queueCounts(entityId: number): Record<QueueTab, number> {
  const rows = getDb().prepare(`SELECT registration_status s, COUNT(*) c FROM subcontractors WHERE entity_id = ? AND (registration_status <> 'approved' OR registration_no IS NOT NULL) GROUP BY registration_status`).all(entityId) as { s: string; c: number }[];
  const out: Record<QueueTab, number> = { submitted: 0, under_review: 0, referred_back: 0, approved: 0, rejected: 0, draft: 0 };
  for (const r of rows) if (r.s in out) out[r.s as QueueTab] = r.c;
  return out;
}
/** Registrations waiting for a reviewer (submitted, not yet taken into review): the topbar badge of users with `subcontractors/approve`. */
export function awaitingReviewCount(entityId: number): number {
  return (getDb().prepare("SELECT COUNT(*) c FROM subcontractors WHERE entity_id = ? AND registration_status = 'submitted'").get(entityId) as { c: number }).c;
}

export function listRegistrations(entityId: number, tab: QueueTab): QueueRow[] {
  const db = getDb();
  const rows = db.prepare(`SELECT s.id, s.registration_no, s.name, s.registration_status status, s.submitted_at, s.resubmit_count, s.portal_slug, u.name reviewer, e.flag, e.code
    FROM subcontractors s JOIN entities e ON e.id = s.entity_id LEFT JOIN users u ON u.id = s.reviewed_by
    WHERE s.entity_id = ? AND s.registration_status = ? AND (s.registration_status <> 'approved' OR s.registration_no IS NOT NULL)
    ORDER BY CASE WHEN s.submitted_at IS NULL THEN 1 ELSE 0 END, s.submitted_at, s.id`).all(entityId, tab) as
    { id: number; registration_no: string | null; name: string; status: string; submitted_at: string | null; resubmit_count: number; portal_slug: string | null; reviewer: string | null; flag: string | null; code: string }[];
  const today = todayISO();
  return rows.map((r) => ({
    id: r.id, registration_no: r.registration_no, name: r.name, status: r.status, submitted_at: r.submitted_at, resubmit_count: r.resubmit_count, portal_slug: r.portal_slug,
    waiting_days: r.submitted_at && ["submitted", "under_review", "referred_back"].includes(r.status) ? Math.max(0, daysBetween(r.submitted_at.slice(0, 10), today)) : null,
    completeness: completenessOf(db, r.id), reviewer: r.reviewer, country_flag: r.flag, country_code: r.code, awaiting_approval: r.status === "under_review" && hasOpenRequest("subcontractor_onboarding", r.id),
    categories: (db.prepare("SELECT GROUP_CONCAT(c.name, ', ') n FROM subcontractor_categories sc JOIN supplier_categories c ON c.id = sc.category_id WHERE sc.subcontractor_id = ? AND sc.status <> 'declined'").get(r.id) as { n: string | null }).n ?? "—",
  }));
}

export interface PortalNotice { id: number; kind: string; title: string; body: string | null; href: string | null; read_at: string | null; created_at: string }
/** Notifications of a supplier for one portal user (company-wide rows have portal_user_id NULL), newest first. */
export function listNotifications(subId: number, userId: number, limit = 20): PortalNotice[] {
  return getDb().prepare("SELECT id, kind, title, body, href, read_at, created_at FROM portal_notifications WHERE subcontractor_id = ? AND (portal_user_id IS NULL OR portal_user_id = ?) ORDER BY id DESC LIMIT ?").all(subId, userId, limit) as PortalNotice[];
}
export function unreadNotificationCount(subId: number, userId: number): number {
  return (getDb().prepare("SELECT COUNT(*) c FROM portal_notifications WHERE subcontractor_id = ? AND (portal_user_id IS NULL OR portal_user_id = ?) AND read_at IS NULL").get(subId, userId) as { c: number }).c;
}

/* ------------------------------------------------------------------ public landing */
export interface PublicNotice { code: string; title: string; category: string | null; country: string; flag: string | null; closing_at: string }
/**
 * Published, still open supplier tenders for the public notice board: title, category, country and closing date only (no documents, no prices).
 * Part B creates `rfx_tenders`; until then (or when the columns differ) the board is simply empty.
 */
export function getPublicNotices(limit = 12): PublicNotice[] {
  try {
    return getDb().prepare(`SELECT t.code, t.title, c.name category, e.country, e.flag, t.closing_at FROM rfx_tenders t JOIN entities e ON e.id = t.entity_id
      LEFT JOIN supplier_categories c ON c.id = t.category_id WHERE t.status = 'published' AND t.procedure = 'open' AND t.closing_at > ? ORDER BY t.closing_at LIMIT ?`).all(new Date().toISOString(), limit) as PublicNotice[];
  } catch { return []; }
}
export function publicCategories(): { group_name: string; names: string[] }[] {
  const rows = getDb().prepare("SELECT group_name, name FROM supplier_categories WHERE active = 1 AND entity_id IS NULL ORDER BY sort, id").all() as { group_name: string; name: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.group_name, [...(map.get(r.group_name) ?? []), r.name]);
  return [...map].map(([group_name, names]) => ({ group_name, names }));
}
export const publicCountries = () => listEntities().map((e) => ({ code: e.code, flag: e.flag, country: e.country, legal: e.legal_name }));
