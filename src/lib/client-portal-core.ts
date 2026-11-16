// Client portal: DB helpers shared by the app, the seed and the migration (no next/* imports, so tsx scripts can load it).
import type { DB } from "./db";
import { hashPassword } from "./password";
import { slugify } from "./portal-perms";
import type { ClientRole } from "./client-portal-perms";

export * from "./client-portal-perms";
export { parseScope } from "./portal-perms";

export function isClientSlugTaken(db: DB, slug: string, exceptClientId?: number): boolean {
  return !!db.prepare("SELECT 1 FROM clients WHERE portal_slug = ? AND id <> ?").get(slug, exceptClientId ?? 0);
}
/** Unique slug derived from the client name (suffix -2, -3 on collisions). */
export function uniqueClientSlug(db: DB, name: string, exceptClientId?: number): string {
  const base = slugify(name);
  let s = base, n = 2;
  while (isClientSlugTaken(db, s, exceptClientId)) s = `${base}-${n++}`;
  return s;
}
/** Gives a client a slug when it has none; returns the slug. */
export function ensureClientSlug(db: DB, clientId: number): string | null {
  const r = db.prepare("SELECT name, portal_slug FROM clients WHERE id = ?").get(clientId) as { name: string; portal_slug: string | null } | undefined;
  if (!r) return null;
  if (r.portal_slug) return r.portal_slug;
  const slug = uniqueClientSlug(db, r.name, clientId);
  db.prepare("UPDATE clients SET portal_slug = ? WHERE id = ?").run(slug, clientId);
  return slug;
}

export interface NewClientUser {
  clientId: number; name: string; email: string; phone?: string | null; jobTitle?: string | null; role: ClientRole; password: string;
  mustChange?: boolean; scope?: number[] | null; createdBy?: number | null; createdAt?: string; status?: string;
}
export function insertClientUser(db: DB, u: NewClientUser): number {
  const now = u.createdAt ?? new Date().toISOString();
  const r = db.prepare(`INSERT INTO client_users(client_id, name, email, phone, job_title, role, password_hash, status, must_change_password, password_changed_at,
      project_scope, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(u.clientId, u.name, u.email.trim().toLowerCase(), u.phone ?? null, u.jobTitle ?? null, u.role, hashPassword(u.password), u.status ?? "active", u.mustChange === false ? 0 : 1,
      u.mustChange === false ? now : null, u.scope && u.scope.length ? JSON.stringify(u.scope) : null, u.createdBy ?? null, now);
  return Number(r.lastInsertRowid);
}
