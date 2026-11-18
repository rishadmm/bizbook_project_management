// Subcontractor portal authentication + authorisation (PORTAL_SPEC section 1). Completely separate from the internal session (lib/auth.ts).
// Rules: the subcontractor id ALWAYS comes from the portal session (never from the URL or a form); every query filters by it; pages and actions both validate here.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { hashToken, newToken, nowIso, parseDbDate, requestMeta } from "./auth";
import { burnPasswordCheck, verifyPassword } from "./password";
import { isPortalRole, isRestrictedAllowed, parseScope, portalCan, type PortalPerm, type PortalRole } from "./portal-core";
import type { Attachment, Subcontractor } from "./types";
import { getEntityById, type Entity } from "./entities";
import { setRequestCurrency } from "./request-context";
import { PORTAL_VISIBLE_STATUSES } from "./rfx";
import { getRfx, isEligibleToView } from "../features/procurement/rfx-core";

export const PORTAL_COOKIE = "bbp_portal";
export const PORTAL_SESSION_HOURS = 12;
export const PORTAL_REMEMBER_DAYS = 30;
export const PORTAL_MAX_FAILED = 5;
export const PORTAL_LOCK_MINUTES = 15;
export const IMPERSONATION_HOURS = 2;

export class PortalError extends Error { constructor(m: string) { super(m); this.name = "PortalError"; } }

export interface PortalSessionUser {
  id: number; name: string; email: string; role: PortalRole; phone: string | null; jobTitle: string | null; mustChange: boolean;
  scope: number[] | null; lastLoginAt: string | null; previousLoginAt: string | null;
}
export interface PortalSession {
  sessionId: number; user: PortalSessionUser; sub: Subcontractor; /** the subcontractor's country: tenant legal name, currency, tax label, map centre */ entity: Entity; readOnly: boolean; impersonator: { id: number; name: string } | null;
}

export type PortalEvent = "login_success" | "login_failed" | "locked" | "logout" | "password_changed" | "password_reset" | "user_created" | "user_disabled" | "user_enabled"
  | "user_updated" | "user_unlocked" | "user_deleted" | "session_revoked" | "impersonation_started" | "impersonation_ended" | "portal_enabled" | "portal_disabled" | "slug_changed";

export async function logPortalEvent(event: PortalEvent, o: { subId?: number | null; userId?: number | null; email?: string | null; detail?: string | null }): Promise<void> {
  const m = await requestMeta();
  getDb().prepare("INSERT INTO portal_auth_events(subcontractor_id, portal_user_id, email, event, ip, user_agent, detail, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(o.subId ?? null, o.userId ?? null, o.email ?? null, event, m.ip, m.userAgent, o.detail ?? null, nowIso());
}

type SessRow = { id: number; portal_user_id: number | null; subcontractor_id: number; impersonated_by: number | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null };
type UserRow = { id: number; name: string; email: string; phone: string | null; job_title: string | null; portal_role: string; status: string; must_change_password: number;
  assignment_scope: string | null; last_login_at: string | null; previous_login_at: string | null };

/** A portal subcontractor is reachable only while its portal is enabled and it is not blacklisted. */
export const portalAvailable = (s: Pick<Subcontractor, "portal_enabled" | "status">): boolean => s.portal_enabled === 1 && s.status !== "blacklisted";

/** Current valid portal session (token hash, expiry, user + company status). Cached per request. */
export const getPortalSession = cache(async (): Promise<PortalSession | null> => {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const s = db.prepare("SELECT id, portal_user_id, subcontractor_id, impersonated_by, expires_at, revoked_at, last_seen_at FROM portal_sessions WHERE token_hash = ?").get(hashToken(token)) as SessRow | undefined;
  if (!s || s.revoked_at || parseDbDate(s.expires_at) <= Date.now()) return null;
  const sub = db.prepare("SELECT * FROM subcontractors WHERE id = ?").get(s.subcontractor_id) as Subcontractor | undefined;
  if (!sub || !portalAvailable(sub)) return null;
  let user: PortalSessionUser;
  let impersonator: PortalSession["impersonator"] = null;
  if (s.impersonated_by) {
    const adm = db.prepare("SELECT id, name, status FROM users WHERE id = ?").get(s.impersonated_by) as { id: number; name: string; status: string } | undefined;
    if (!adm || adm.status === "disabled" || adm.status === "locked") return null;
    impersonator = { id: adm.id, name: adm.name };
    user = { id: 0, name: `${adm.name} (admin view)`, email: "", role: "owner", phone: null, jobTitle: "Internal staff", mustChange: false, scope: null, lastLoginAt: null, previousLoginAt: null };
  } else {
    const u = s.portal_user_id ? (db.prepare("SELECT * FROM portal_users WHERE id = ? AND subcontractor_id = ?").get(s.portal_user_id, sub.id) as UserRow | undefined) : undefined;
    if (!u || u.status !== "active" || !isPortalRole(u.portal_role)) return null;
    user = { id: u.id, name: u.name, email: u.email, role: u.portal_role, phone: u.phone, jobTitle: u.job_title, mustChange: !!u.must_change_password, scope: parseScope(u.assignment_scope),
      lastLoginAt: u.last_login_at, previousLoginAt: u.previous_login_at };
  }
  if (!s.last_seen_at || Date.now() - parseDbDate(s.last_seen_at) > 60_000) db.prepare("UPDATE portal_sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), s.id);
  const entity = getEntityById(sub.entity_id);
  if (!entity) return null;
  setRequestCurrency(entity.currency); // formatMoney default of this portal request = the subcontractor's country currency
  return { sessionId: s.id, user, sub, entity, readOnly: !!impersonator, impersonator };
});

/**
 * Page guard. No session -> login of the requested company; session of ANOTHER company -> redirect to that company's own portal;
 * forced password change -> /change-password; missing permission -> /forbidden. Returns the session (company id = session.sub.id).
 */
export async function requirePortalUser(slug: string, perm?: PortalPerm, opts: { allowMustChange?: boolean } = {}): Promise<PortalSession> {
  const s = await getPortalSession();
  if (!s) redirect(`/p/${encodeURIComponent(slug)}/login`);
  if (s.sub.portal_slug !== slug) redirect(`/p/${encodeURIComponent(s.sub.portal_slug ?? "")}`);
  if (s.user.mustChange && !opts.allowMustChange) redirect(`/p/${slug}/change-password`);
  if (perm && !portalCan(s.user.role, perm)) redirect(`/p/${slug}/forbidden`);
  // Restricted portal: a supplier whose registration is not approved only reaches Dashboard, Registration, Documents and Account (SUPPLIER_TENDERING_SPEC A4).
  if (isRestricted(s.sub) && !isRestrictedAllowed(perm)) redirect(`/p/${slug}/forbidden?restricted=1`);
  return s;
}

/** True while the supplier's registration is not approved (restricted portal). Legacy rows without the column count as approved. */
export const isRestricted = (sub: Pick<Subcontractor, "registration_status">): boolean => !!sub.registration_status && sub.registration_status !== "approved";

/** Server-action / route guard: throws PortalError. Mutations (`write`, default) are refused in the read-only admin view. */
export async function requirePortalAction(perm: PortalPerm | null, opts: { write?: boolean } = {}): Promise<PortalSession> {
  const s = await getPortalSession();
  if (!s) throw new PortalError("Your session has expired. Please sign in again.");
  if (s.user.mustChange) throw new PortalError("You must change your password before continuing.");
  if ((opts.write ?? true) && s.readOnly) throw new PortalError("Read-only view: actions are disabled while viewing the portal as an administrator.");
  if (perm && !portalCan(s.user.role, perm)) throw new PortalError("You do not have permission to do this.");
  if (isRestricted(s.sub) && !isRestrictedAllowed(perm)) throw new PortalError("This is available after your registration has been approved.");
  return s;
}

/* ------------------------------------------------------------------ scope */

/** Assignment ids of this session's company that the user may see (company filter always applied; draft contracts hidden). */
export function visibleAssignmentIds(s: PortalSession): number[] {
  const rows = getDb().prepare("SELECT id FROM assignments WHERE subcontractor_id = ? AND status <> 'draft' ORDER BY id").all(s.sub.id) as { id: number }[];
  const ids = rows.map((r) => r.id);
  return s.user.scope ? ids.filter((i) => s.user.scope!.includes(i)) : ids;
}
export const idList = (ids: number[]): string => (ids.length ? ids.map((i) => Math.trunc(Number(i))).join(",") : "NULL");
export function canSeeAssignment(s: PortalSession, assignmentId: number | null | undefined): boolean {
  return !!assignmentId && visibleAssignmentIds(s).includes(assignmentId);
}

/** True when the attachment belongs to this company (its assignments' progress reports, invoices, certificates, issues, own documents, shared drawings). */
export function portalOwnsAttachment(s: PortalSession, a: Attachment): boolean {
  if (s.user.mustChange) return false;
  // a supplier that is not approved only ever gets its own registration documents
  if (isRestricted(s.sub) && a.entity_type !== "subcontractor") return false;
  const db = getDb();
  const own = (asg: number | null | undefined) => canSeeAssignment(s, asg);
  const col = (sql: string) => (db.prepare(sql).get(a.entity_id) as { a: number | null } | undefined)?.a ?? null;
  switch (a.entity_type) {
    case "subcontractor": return portalCan(s.user.role, "documents") && a.entity_id === s.sub.id;
    case "assignment": return portalCan(s.user.role, "projects") && own(a.entity_id);
    case "stage": {
      if (!portalCan(s.user.role, "projects") || (a.category ?? "") !== "Drawings") return false;
      const ids = visibleAssignmentIds(s);
      return !!db.prepare(`SELECT 1 FROM assignments WHERE stage_id = ? AND id IN (${idList(ids)})`).get(a.entity_id);
    }
    case "progress": return portalCan(s.user.role, "progress") && own(col("SELECT assignment_id a FROM progress_reports WHERE id = ?"));
    case "invoice": case "sub_invoice": return portalCan(s.user.role, "invoices") && own(col("SELECT assignment_id a FROM sub_invoices WHERE id = ?"));
    case "certificate": return portalCan(s.user.role, "certificates") && own(col("SELECT assignment_id a FROM completion_certificates WHERE id = ?"));
    case "issue": return portalCan(s.user.role, "issues") && own(col("SELECT assignment_id a FROM issues WHERE id = ?"));
    // supplier tendering: tender documents / addenda go to eligible suppliers once the tender is published; a bid file only to the company that owns the bid (sealed-bid rule: never to a competitor)
    case "rfx": {
      if (!portalCan(s.user.role, "tenders")) return false;
      const rfx = getRfx(db, a.entity_id);
      return !!rfx && rfx.entity_id === s.sub.entity_id && PORTAL_VISIBLE_STATUSES.includes(rfx.status as never) && isEligibleToView(db, rfx, s.sub.id);
    }
    case "rfx_bid": return portalCan(s.user.role, "tenders") && (db.prepare("SELECT 1 FROM rfx_bids WHERE id = ? AND subcontractor_id = ?").get(a.entity_id, s.sub.id) !== undefined);
    default: return false;
  }
}

/* ------------------------------------------------------------------ sessions */

export async function startPortalSession(opts: { userId: number | null; subId: number; remember: boolean; impersonatedBy?: number | null }): Promise<void> {
  const token = newToken();
  const now = new Date();
  const ttlMs = opts.impersonatedBy ? IMPERSONATION_HOURS * 3_600_000 : opts.remember ? PORTAL_REMEMBER_DAYS * 86_400_000 : PORTAL_SESSION_HOURS * 3_600_000;
  const m = await requestMeta();
  getDb().prepare("INSERT INTO portal_sessions(token_hash, portal_user_id, subcontractor_id, impersonated_by, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(hashToken(token), opts.userId, opts.subId, opts.impersonatedBy ?? null, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString(), now.toISOString(), m.ip, m.userAgent);
  const jar = await cookies();
  // Path "/" (not "/p"): the viewer in the portal loads files from /api/files/:id, which must see the cookie as well. Name and DB table are portal-only.
  jar.set(PORTAL_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0",
    ...(opts.remember && !opts.impersonatedBy ? { maxAge: Math.floor(ttlMs / 1000) } : {}),
  });
}

export async function endPortalSession(): Promise<PortalSession | null> {
  const s = await getPortalSession();
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  if (token) getDb().prepare("UPDATE portal_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(nowIso(), hashToken(token));
  jar.delete(PORTAL_COOKIE);
  return s;
}

export function revokePortalSessions(userId: number, exceptSessionId?: number): number {
  return getDb().prepare("UPDATE portal_sessions SET revoked_at = ? WHERE portal_user_id = ? AND revoked_at IS NULL AND id != ?").run(nowIso(), userId, exceptSessionId ?? 0).changes;
}

/**
 * Credential check for /p/:slug/login. Returns an error message or the signed-in user id (session cookie already set).
 * Generic message for unknown e-mail / wrong password; lockout after 5 failures for 15 minutes.
 */
export async function portalLogin(slug: string, email: string, password: string, remember: boolean): Promise<{ error: string } | { userId: number; mustChange: boolean }> {
  const GENERIC = "Invalid email or password.";
  const db = getDb();
  const sub = db.prepare("SELECT * FROM subcontractors WHERE portal_slug = ?").get(slug) as Subcontractor | undefined;
  if (!sub) { burnPasswordCheck(password); return { error: GENERIC }; }
  if (!portalAvailable(sub)) {
    burnPasswordCheck(password);
    await logPortalEvent("login_failed", { subId: sub.id, email, detail: "portal disabled" });
    return { error: "The portal is currently disabled for this company. Please contact your project contact." };
  }
  const u = email ? (db.prepare("SELECT * FROM portal_users WHERE subcontractor_id = ? AND lower(email) = ?").get(sub.id, email) as (UserRow & { password_hash: string | null; failed_attempts: number; locked_until: string | null }) | undefined) : undefined;
  if (!u || !u.password_hash) {
    burnPasswordCheck(password);
    await logPortalEvent("login_failed", { subId: sub.id, email, detail: "unknown user" });
    return { error: GENERIC };
  }
  let attempts = u.failed_attempts ?? 0;
  const lockedUntil = parseDbDate(u.locked_until);
  if (lockedUntil && lockedUntil > Date.now()) {
    burnPasswordCheck(password);
    await logPortalEvent("login_failed", { subId: sub.id, userId: u.id, email, detail: "account locked" });
    const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
    return { error: `Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"} or contact your project contact.` };
  }
  if (lockedUntil) { attempts = 0; db.prepare("UPDATE portal_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(u.id); }
  if (!verifyPassword(password, u.password_hash)) {
    attempts += 1;
    if (attempts >= PORTAL_MAX_FAILED) {
      db.prepare("UPDATE portal_users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(attempts, new Date(Date.now() + PORTAL_LOCK_MINUTES * 60000).toISOString(), u.id);
      await logPortalEvent("login_failed", { subId: sub.id, userId: u.id, email, detail: `bad password (${attempts})` });
      await logPortalEvent("locked", { subId: sub.id, userId: u.id, email, detail: `locked for ${PORTAL_LOCK_MINUTES} minutes` });
      return { error: `Account locked after too many failed attempts. Try again in ${PORTAL_LOCK_MINUTES} minutes or contact your project contact.` };
    }
    db.prepare("UPDATE portal_users SET failed_attempts = ? WHERE id = ?").run(attempts, u.id);
    await logPortalEvent("login_failed", { subId: sub.id, userId: u.id, email, detail: `bad password (${attempts})` });
    return { error: GENERIC };
  }
  if (u.status !== "active") {
    await logPortalEvent("login_failed", { subId: sub.id, userId: u.id, email, detail: "account disabled" });
    return { error: "This account has been disabled. Please contact your project contact." };
  }
  db.prepare("UPDATE portal_users SET failed_attempts = 0, locked_until = NULL, previous_login_at = last_login_at, last_login_at = ? WHERE id = ?").run(nowIso(), u.id);
  await startPortalSession({ userId: u.id, subId: sub.id, remember });
  await logPortalEvent("login_success", { subId: sub.id, userId: u.id, email });
  return { userId: u.id, mustChange: !!u.must_change_password };
}

/** `http://host` of the current request (for portal links shown to staff). */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3100";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
