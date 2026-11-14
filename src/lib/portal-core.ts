// Subcontractor portal: DB helpers shared by the app, the seed and the migration (no next/* imports, so tsx scripts can load it).
import type { DB } from "./db";
import { hashPassword } from "./password";
import { slugify, type PortalRole } from "./portal-perms";

export * from "./portal-perms";

export function isSlugTaken(db: DB, slug: string, exceptSubId?: number): boolean {
  return !!db.prepare("SELECT 1 FROM subcontractors WHERE portal_slug = ? AND id <> ?").get(slug, exceptSubId ?? 0);
}
/** Unique slug derived from the company name (suffix -2, -3 on collisions). */
export function uniqueSlug(db: DB, name: string, exceptSubId?: number): string {
  const base = slugify(name);
  let s = base, n = 2;
  while (isSlugTaken(db, s, exceptSubId)) s = `${base}-${n++}`;
  return s;
}
/** Gives a subcontractor a slug when it has none; returns the slug. */
export function ensureSlug(db: DB, subId: number): string | null {
  const r = db.prepare("SELECT name, portal_slug FROM subcontractors WHERE id = ?").get(subId) as { name: string; portal_slug: string | null } | undefined;
  if (!r) return null;
  if (r.portal_slug) return r.portal_slug;
  const slug = uniqueSlug(db, r.name, subId);
  db.prepare("UPDATE subcontractors SET portal_slug = ? WHERE id = ?").run(slug, subId);
  return slug;
}

/* ------------------------------------------------------------------ users */
export interface NewPortalUser {
  subcontractorId: number; name: string; email: string; phone?: string | null; jobTitle?: string | null; role: PortalRole; password: string;
  mustChange?: boolean; scope?: number[] | null; createdBy?: number | null; createdByPortalUser?: number | null; createdAt?: string; status?: string;
}
export function insertPortalUser(db: DB, u: NewPortalUser): number {
  const now = u.createdAt ?? new Date().toISOString();
  const r = db.prepare(`INSERT INTO portal_users(subcontractor_id, name, email, phone, job_title, portal_role, password_hash, status, must_change_password, password_changed_at,
      assignment_scope, created_by, created_by_portal_user, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(u.subcontractorId, u.name, u.email.trim().toLowerCase(), u.phone ?? null, u.jobTitle ?? null, u.role, hashPassword(u.password), u.status ?? "active", u.mustChange === false ? 0 : 1,
      u.mustChange === false ? now : null, u.scope && u.scope.length ? JSON.stringify(u.scope) : null, u.createdBy ?? null, u.createdByPortalUser ?? null, now);
  return Number(r.lastInsertRowid);
}

