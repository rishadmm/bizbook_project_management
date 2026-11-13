// Server-side authentication + authorization API (AUTH_SPEC section A/B). Every module uses this file.
import crypto from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { MODULES, MODULE_KEYS, hasPermission, type ModuleKey, type PermissionMap } from "./permissions";
import type { User } from "./types";

export const SESSION_COOKIE = "ops_session";
export const SESSION_HOURS = 12;
export const REMEMBER_DAYS = 30;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export type AuthUser = User & {
  roleCode: string;
  roleName: string;
  permissions: Record<ModuleKey, string[]>;
  isSuperAdmin: boolean;
};
export type AuthSession = { user: AuthUser; sessionId: number };

export class ForbiddenError extends Error {
  constructor(public module: ModuleKey, public action: string) {
    super(`You don't have permission to ${action.replace(/_/g, " ")} ${MODULES[module].label.toLowerCase()}.`);
    this.name = "ForbiddenError";
  }
}

export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const newToken = () => crypto.randomBytes(32).toString("hex");
export const nowIso = () => new Date().toISOString();
/** Parses DB timestamps written either as ISO (T..Z) or SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC). */
export function parseDbDate(s: string | null | undefined): number {
  if (!s) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
}

/** Effective permissions = role permissions + user allow overrides - user deny overrides. */
export function resolvePermissions(userId: number, roleId: number | null, isSuperAdmin: boolean): Record<ModuleKey, string[]> {
  const out = Object.fromEntries(MODULE_KEYS.map((m) => [m, [] as string[]])) as Record<ModuleKey, string[]>;
  if (isSuperAdmin) { for (const m of MODULE_KEYS) out[m] = [...MODULES[m].actions]; return out; }
  const db = getDb();
  const set = new Set<string>();
  if (roleId) for (const r of db.prepare("SELECT module, action FROM role_permissions WHERE role_id = ?").all(roleId) as { module: string; action: string }[]) set.add(`${r.module}:${r.action}`);
  for (const o of db.prepare("SELECT module, action, effect FROM user_permission_overrides WHERE user_id = ?").all(userId) as { module: string; action: string; effect: string }[]) {
    if (o.effect === "allow") set.add(`${o.module}:${o.action}`); else set.delete(`${o.module}:${o.action}`);
  }
  for (const k of set) { const [m, a] = k.split(":"); if (m in out) out[m as ModuleKey].push(a); }
  return out;
}

export function loadAuthUser(userId: number): AuthUser | null {
  const db = getDb();
  const u = db.prepare(
    `SELECT u.*, r.code AS role_code, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
  ).get(userId) as (User & { role_code: string | null; role_name: string | null }) | undefined;
  if (!u) return null;
  const roleCode = u.role_code ?? u.role;
  const isSuperAdmin = roleCode === "super_admin";
  const { role_code: _rc, role_name: _rn, password_hash: _ph, ...base } = u;
  void _rc; void _rn; void _ph;
  return { ...base, roleCode, roleName: u.role_name ?? roleCode, isSuperAdmin, permissions: resolvePermissions(u.id, u.role_id ?? null, isSuperAdmin) };
}

/** Current valid session (token hash, expiry, user status). Cached per request. */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const s = db.prepare("SELECT id, user_id, expires_at, revoked_at, last_seen_at FROM sessions WHERE token_hash = ?").get(hashToken(token)) as
    { id: number; user_id: number; expires_at: string; revoked_at: string | null; last_seen_at: string | null } | undefined;
  if (!s || s.revoked_at || parseDbDate(s.expires_at) <= Date.now()) return null;
  const user = loadAuthUser(s.user_id);
  if (!user || user.status === "disabled" || user.status === "locked") return null;
  if (!s.last_seen_at || Date.now() - parseDbDate(s.last_seen_at) > 60_000) db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), s.id);
  return { user, sessionId: s.id };
});

export async function requireUser(): Promise<AuthUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s.user;
}

/** Admin-level user (administrator or super admin): used for legacy "admin may override" rules. */
export const isAdminUser = (u: AuthUser): boolean => u.isSuperAdmin || u.roleCode === "admin";

/** Like requirePermission but passes when ANY of the listed actions is granted. */
export async function requireAnyPermission(module: ModuleKey, actions: string[]): Promise<AuthUser> {
  const user = await requireUser();
  if (user.must_change_password) throw new Error("You must change your password before continuing.");
  if (!actions.some((a) => can(user, module, a))) throw new ForbiddenError(module, actions[0]);
  return user;
}

export function can(user: AuthUser | null | undefined, module: ModuleKey, action: string = "view"): boolean {
  if (!user) return false;
  return hasPermission(user.permissions as PermissionMap, user.isSuperAdmin, module, action);
}

/** Server-action guard: throws ForbiddenError (or redirects when not signed in). Returns the user. */
export async function requirePermission(module: ModuleKey, action: string): Promise<AuthUser> {
  const user = await requireUser();
  if (user.must_change_password) throw new Error("You must change your password before continuing.");
  if (!can(user, module, action)) throw new ForbiddenError(module, action);
  return user;
}

/** Page guard: redirects to /login, /account/password (forced change) or /forbidden. */
export async function requirePage(module?: ModuleKey, action: string = "view"): Promise<AuthUser> {
  const user = await requireUser();
  if (user.must_change_password) redirect("/account/password");
  if (module && !can(user, module, action)) redirect(`/forbidden?module=${module}`);
  return user;
}

/** Convenience for pages: returns can-flags for a module, e.g. `const c = canMap(user, "tenders", ["create","delete"])`. */
export function canMap<A extends string>(user: AuthUser, module: ModuleKey, actions: readonly A[]): Record<A, boolean> {
  return Object.fromEntries(actions.map((a) => [a, can(user, module, a)])) as Record<A, boolean>;
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}

export type AuthEvent = "login_success" | "login_failed" | "logout" | "locked" | "password_changed" | "password_reset" | "session_revoked" | "user_created" | "user_disabled"
  | "user_enabled" | "user_unlocked" | "user_updated" | "role_changed" | "permissions_changed";

export async function logAuthEvent(event: AuthEvent, o: { userId?: number | null; email?: string | null; detail?: string | null }): Promise<void> {
  const m = await requestMeta();
  getDb().prepare("INSERT INTO auth_events(user_id, email, event, ip, user_agent, detail, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(o.userId ?? null, o.email ?? null, event, m.ip, m.userAgent, o.detail ?? null, nowIso());
}

/** Creates a session row and sets the cookie. Call from a server action / route handler. */
export async function startSession(userId: number, remember: boolean): Promise<void> {
  const token = newToken();
  const now = new Date();
  const ttlMs = remember ? REMEMBER_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000;
  const m = await requestMeta();
  getDb().prepare("INSERT INTO sessions(token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)")
    .run(hashToken(token), userId, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString(), now.toISOString(), m.ip, m.userAgent);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export function revokeSessions(userId: number, exceptSessionId?: number): number {
  return getDb().prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?").run(nowIso(), userId, exceptSessionId ?? 0).changes;
}

/** True when `next` is a safe same-origin relative path. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) return "/";
  return next;
}
