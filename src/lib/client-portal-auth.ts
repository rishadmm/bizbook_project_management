// Client portal authentication + authorisation (CLIENT_PORTAL_SPEC section 1). Completely separate from the internal session (lib/auth.ts) and from the
// subcontractor portal (lib/portal-auth.ts). Rules: the client id ALWAYS comes from the client session (never from the URL or a form); every query filters
// by it (and by the user's project scope); the portal is READ-ONLY, so the only actions are sign in/out, change password and sign out other sessions.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { hashToken, newToken, nowIso, parseDbDate, requestMeta } from "./auth";
import { burnPasswordCheck, verifyPassword } from "./password";
import { isClientRole, parseScope, type ClientRole } from "./client-portal-core";
import type { Attachment } from "./types";
import { getEntityById, type Entity } from "./entities";
import { setRequestCurrency } from "./request-context";

export const CLIENT_COOKIE = "bbp_client";
export const CLIENT_SESSION_HOURS = 12;
export const CLIENT_REMEMBER_DAYS = 30;
export const CLIENT_MAX_FAILED = 5;
export const CLIENT_LOCK_MINUTES = 15;
export const CLIENT_IMPERSONATION_HOURS = 2;

export class ClientPortalError extends Error { constructor(m: string) { super(m); this.name = "ClientPortalError"; } }

export interface ClientRecord {
  id: number; name: string; type: string; contact_person: string | null; email: string | null; phone: string | null;
  portal_slug: string | null; portal_enabled: number; portal_show_subcontractors: number; portal_show_financials: number; entity_id: number;
}
export interface ClientSessionUser {
  id: number; name: string; email: string; role: ClientRole; phone: string | null; jobTitle: string | null; mustChange: boolean;
  scope: number[] | null; lastLoginAt: string | null; previousLoginAt: string | null;
}
export interface ClientSession {
  sessionId: number; user: ClientSessionUser; client: ClientRecord; /** the client's country: tenant legal name, currency, map centre */ entity: Entity; readOnly: boolean; impersonator: { id: number; name: string } | null;
}

export type ClientEvent = "login_success" | "login_failed" | "locked" | "logout" | "password_changed" | "password_reset" | "user_created" | "user_disabled" | "user_enabled"
  | "user_updated" | "user_unlocked" | "user_deleted" | "session_revoked" | "impersonation_started" | "impersonation_ended" | "portal_enabled" | "portal_disabled" | "slug_changed" | "settings_changed";

export async function logClientEvent(event: ClientEvent, o: { clientId?: number | null; userId?: number | null; email?: string | null; detail?: string | null }): Promise<void> {
  const m = await requestMeta();
  getDb().prepare("INSERT INTO client_auth_events(client_id, client_user_id, email, event, ip, user_agent, detail, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(o.clientId ?? null, o.userId ?? null, o.email ?? null, event, m.ip, m.userAgent, o.detail ?? null, nowIso());
}

type SessRow = { id: number; client_user_id: number | null; client_id: number; impersonated_by: number | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null };
type UserRow = { id: number; name: string; email: string; phone: string | null; job_title: string | null; role: string; status: string; must_change_password: number;
  project_scope: string | null; last_login_at: string | null; previous_login_at: string | null };

/** A client is reachable only while its portal is enabled. */
export const clientPortalAvailable = (c: Pick<ClientRecord, "portal_enabled">): boolean => c.portal_enabled === 1;

/** Current valid client session (token hash, expiry, user + client status). Cached per request. */
export const getClientSession = cache(async (): Promise<ClientSession | null> => {
  const jar = await cookies();
  const token = jar.get(CLIENT_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const s = db.prepare("SELECT id, client_user_id, client_id, impersonated_by, expires_at, revoked_at, last_seen_at FROM client_sessions WHERE token_hash = ?").get(hashToken(token)) as SessRow | undefined;
  if (!s || s.revoked_at || parseDbDate(s.expires_at) <= Date.now()) return null;
  const client = db.prepare("SELECT id, name, type, contact_person, email, phone, portal_slug, portal_enabled, portal_show_subcontractors, portal_show_financials, entity_id FROM clients WHERE id = ?").get(s.client_id) as ClientRecord | undefined;
  if (!client || !clientPortalAvailable(client)) return null;
  let user: ClientSessionUser;
  let impersonator: ClientSession["impersonator"] = null;
  if (s.impersonated_by) {
    const adm = db.prepare("SELECT id, name, status FROM users WHERE id = ?").get(s.impersonated_by) as { id: number; name: string; status: string } | undefined;
    if (!adm || adm.status === "disabled" || adm.status === "locked") return null;
    impersonator = { id: adm.id, name: adm.name };
    user = { id: 0, name: `${adm.name} (admin view)`, email: "", role: "admin", phone: null, jobTitle: "Internal staff", mustChange: false, scope: null, lastLoginAt: null, previousLoginAt: null };
  } else {
    const u = s.client_user_id ? (db.prepare("SELECT * FROM client_users WHERE id = ? AND client_id = ?").get(s.client_user_id, client.id) as UserRow | undefined) : undefined;
    if (!u || u.status !== "active" || !isClientRole(u.role)) return null;
    user = { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, jobTitle: u.job_title, mustChange: !!u.must_change_password, scope: parseScope(u.project_scope),
      lastLoginAt: u.last_login_at, previousLoginAt: u.previous_login_at };
  }
  if (!s.last_seen_at || Date.now() - parseDbDate(s.last_seen_at) > 60_000) db.prepare("UPDATE client_sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), s.id);
  const entity = getEntityById(client.entity_id);
  if (!entity) return null;
  setRequestCurrency(entity.currency);
  return { sessionId: s.id, user, client, entity, readOnly: !!impersonator, impersonator };
});

/**
 * Page guard. No session -> login of the requested client; session of ANOTHER client -> redirect to that client's own portal;
 * forced password change -> /change-password; `team` is for admins only -> /forbidden. Returns the session (client id = session.client.id).
 */
export async function requireClientUser(slug: string, perm: "view" | "team" = "view", opts: { allowMustChange?: boolean } = {}): Promise<ClientSession> {
  const s = await getClientSession();
  if (!s) redirect(`/c/${encodeURIComponent(slug)}/login`);
  if (s.client.portal_slug !== slug) redirect(`/c/${encodeURIComponent(s.client.portal_slug ?? "")}`);
  if (s.user.mustChange && !opts.allowMustChange) redirect(`/c/${slug}/change-password`);
  if (perm === "team" && s.user.role !== "admin") redirect(`/c/${slug}/forbidden`);
  return s;
}

/** Server-action guard (only account actions exist). `write` actions are refused in the read-only admin view. */
export async function requireClientAction(opts: { write?: boolean } = {}): Promise<ClientSession> {
  const s = await getClientSession();
  if (!s) throw new ClientPortalError("Your session has expired. Please sign in again.");
  if (s.user.mustChange) throw new ClientPortalError("You must change your password before continuing.");
  if ((opts.write ?? true) && s.readOnly) throw new ClientPortalError("Read-only view: actions are disabled while viewing the portal as an administrator.");
  return s;
}

/* ------------------------------------------------------------------ scope */

/** Project ids of this session's client that the user may see (client filter always applied; cancelled projects hidden). */
export function visibleProjectIds(s: ClientSession): number[] {
  const rows = getDb().prepare("SELECT id FROM projects WHERE client_id = ? AND status <> 'cancelled' ORDER BY id").all(s.client.id) as { id: number }[];
  const ids = rows.map((r) => r.id);
  return s.user.scope ? ids.filter((i) => s.user.scope!.includes(i)) : ids;
}
export const canSeeProject = (s: ClientSession, projectId: number | null | undefined): boolean => !!projectId && visibleProjectIds(s).includes(projectId);
export const idsSql = (ids: number[]): string => (ids.length ? ids.map((i) => Math.trunc(Number(i))).join(",") : "NULL");

/** Project attachment categories a client may open (contracts, correspondence and "other" stay internal). */
export const CLIENT_PROJECT_FILE_CATEGORIES = ["Drawings", "Reports", "Permits", "Photos"];

/** True when the attachment is a file of a VERIFIED progress report or a client-safe project-level attachment of a project this session may see. */
export function clientOwnsAttachment(s: ClientSession, a: Attachment): boolean {
  if (s.user.mustChange) return false;
  const db = getDb();
  const ids = visibleProjectIds(s);
  if (a.entity_type === "progress") {
    const r = db.prepare("SELECT project_id, status FROM progress_reports WHERE id = ?").get(a.entity_id) as { project_id: number; status: string } | undefined;
    return !!r && r.status === "verified" && ids.includes(r.project_id);
  }
  if (a.entity_type === "project") return ids.includes(a.entity_id) && CLIENT_PROJECT_FILE_CATEGORIES.includes(a.category ?? "");
  return false;
}

/* ------------------------------------------------------------------ sessions */

export async function startClientSession(opts: { userId: number | null; clientId: number; remember: boolean; impersonatedBy?: number | null }): Promise<void> {
  const token = newToken();
  const now = new Date();
  const ttlMs = opts.impersonatedBy ? CLIENT_IMPERSONATION_HOURS * 3_600_000 : opts.remember ? CLIENT_REMEMBER_DAYS * 86_400_000 : CLIENT_SESSION_HOURS * 3_600_000;
  const m = await requestMeta();
  getDb().prepare("INSERT INTO client_sessions(token_hash, client_user_id, client_id, impersonated_by, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(hashToken(token), opts.userId, opts.clientId, opts.impersonatedBy ?? null, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString(), now.toISOString(), m.ip, m.userAgent);
  const jar = await cookies();
  jar.set(CLIENT_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0",
    ...(opts.remember && !opts.impersonatedBy ? { maxAge: Math.floor(ttlMs / 1000) } : {}),
  });
}

export async function endClientSession(): Promise<ClientSession | null> {
  const s = await getClientSession();
  const jar = await cookies();
  const token = jar.get(CLIENT_COOKIE)?.value;
  if (token) getDb().prepare("UPDATE client_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(nowIso(), hashToken(token));
  jar.delete(CLIENT_COOKIE);
  return s;
}

export function revokeClientSessions(userId: number, exceptSessionId?: number): number {
  return getDb().prepare("UPDATE client_sessions SET revoked_at = ? WHERE client_user_id = ? AND revoked_at IS NULL AND id != ?").run(nowIso(), userId, exceptSessionId ?? 0).changes;
}

/** Credential check for /c/:slug/login. Generic message for unknown e-mail / wrong password; lockout after 5 failures for 15 minutes. */
export async function clientLogin(slug: string, email: string, password: string, remember: boolean): Promise<{ error: string } | { userId: number; mustChange: boolean }> {
  const GENERIC = "Invalid email or password.";
  const db = getDb();
  const client = db.prepare("SELECT id, name, type, contact_person, email, phone, portal_slug, portal_enabled, portal_show_subcontractors, portal_show_financials FROM clients WHERE portal_slug = ?").get(slug) as ClientRecord | undefined;
  if (!client) { burnPasswordCheck(password); return { error: GENERIC }; }
  if (!clientPortalAvailable(client)) {
    burnPasswordCheck(password);
    await logClientEvent("login_failed", { clientId: client.id, email, detail: "portal disabled" });
    return { error: "The portal is currently disabled for this client. Please contact your project manager." };
  }
  const u = email ? (db.prepare("SELECT * FROM client_users WHERE client_id = ? AND lower(email) = ?").get(client.id, email) as (UserRow & { password_hash: string | null; failed_attempts: number; locked_until: string | null }) | undefined) : undefined;
  if (!u || !u.password_hash) {
    burnPasswordCheck(password);
    await logClientEvent("login_failed", { clientId: client.id, email, detail: "unknown user" });
    return { error: GENERIC };
  }
  let attempts = u.failed_attempts ?? 0;
  const lockedUntil = parseDbDate(u.locked_until);
  if (lockedUntil && lockedUntil > Date.now()) {
    burnPasswordCheck(password);
    await logClientEvent("login_failed", { clientId: client.id, userId: u.id, email, detail: "account locked" });
    const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000));
    return { error: `Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"} or contact your project manager.` };
  }
  if (lockedUntil) { attempts = 0; db.prepare("UPDATE client_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(u.id); }
  if (!verifyPassword(password, u.password_hash)) {
    attempts += 1;
    if (attempts >= CLIENT_MAX_FAILED) {
      db.prepare("UPDATE client_users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(attempts, new Date(Date.now() + CLIENT_LOCK_MINUTES * 60000).toISOString(), u.id);
      await logClientEvent("login_failed", { clientId: client.id, userId: u.id, email, detail: `bad password (${attempts})` });
      await logClientEvent("locked", { clientId: client.id, userId: u.id, email, detail: `locked for ${CLIENT_LOCK_MINUTES} minutes` });
      return { error: `Account locked after too many failed attempts. Try again in ${CLIENT_LOCK_MINUTES} minutes or contact your project manager.` };
    }
    db.prepare("UPDATE client_users SET failed_attempts = ? WHERE id = ?").run(attempts, u.id);
    await logClientEvent("login_failed", { clientId: client.id, userId: u.id, email, detail: `bad password (${attempts})` });
    return { error: GENERIC };
  }
  if (u.status !== "active") {
    await logClientEvent("login_failed", { clientId: client.id, userId: u.id, email, detail: "account disabled" });
    return { error: "This account has been disabled. Please contact your project manager." };
  }
  db.prepare("UPDATE client_users SET failed_attempts = 0, locked_until = NULL, previous_login_at = last_login_at, last_login_at = ? WHERE id = ?").run(nowIso(), u.id);
  await startClientSession({ userId: u.id, clientId: client.id, remember });
  await logClientEvent("login_success", { clientId: client.id, userId: u.id, email });
  return { userId: u.id, mustChange: !!u.must_change_password };
}
