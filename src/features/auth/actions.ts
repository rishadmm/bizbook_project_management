"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import {
  LOCK_MINUTES, MAX_FAILED_ATTEMPTS, SESSION_COOKIE, getSession, hashToken, logAuthEvent, nowIso, parseDbDate, requireUser, revokeSessions, safeNext, startSession,
} from "@/lib/auth";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/password";
import { passwordPolicyError } from "@/lib/permissions";
import type { User } from "@/lib/types";

export type FormState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Sign in. Generic error for unknown user / bad password / disabled; lockout after 5 consecutive failures for 15 minutes. */
export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const email = str(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const remember = form.get("remember") === "on";
  const next = safeNext(str(form, "next"));
  const GENERIC = "Invalid email or password.";
  const db = getDb();
  const user = email ? (db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email) as User | undefined) : undefined;
  if (!user || !user.password_hash) {
    burnPasswordCheck(password);
    await logAuthEvent("login_failed", { email, detail: "unknown user" });
    return { error: GENERIC };
  }
  if (user.status === "disabled") {
    burnPasswordCheck(password);
    await logAuthEvent("login_failed", { userId: user.id, email, detail: "account disabled" });
    return { error: GENERIC };
  }
  const lockedUntil = parseDbDate(user.locked_until);
  if (user.status === "locked" || (lockedUntil && lockedUntil > Date.now())) {
    if (lockedUntil && lockedUntil <= Date.now()) {
      db.prepare("UPDATE users SET status='active', failed_attempts=0, locked_until=NULL WHERE id=?").run(user.id);
      user.status = "active"; user.failed_attempts = 0;
    } else {
      burnPasswordCheck(password);
      await logAuthEvent("login_failed", { userId: user.id, email, detail: "account locked" });
      const mins = lockedUntil ? Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60000)) : LOCK_MINUTES;
      return { error: `Account locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"} or contact an administrator.` };
    }
  }
  if (!verifyPassword(password, user.password_hash)) {
    const attempts = (user.failed_attempts ?? 0) + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      db.prepare("UPDATE users SET failed_attempts=?, status='locked', locked_until=? WHERE id=?").run(attempts, new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(), user.id);
      await logAuthEvent("login_failed", { userId: user.id, email, detail: `bad password (${attempts})` });
      await logAuthEvent("locked", { userId: user.id, email, detail: `locked for ${LOCK_MINUTES} minutes` });
      return { error: `Account locked after too many failed attempts. Try again in ${LOCK_MINUTES} minutes or contact an administrator.` };
    }
    db.prepare("UPDATE users SET failed_attempts=? WHERE id=?").run(attempts, user.id);
    await logAuthEvent("login_failed", { userId: user.id, email, detail: `bad password (${attempts})` });
    return { error: GENERIC };
  }
  db.prepare("UPDATE users SET failed_attempts=0, locked_until=NULL, status='active', last_login_at=? WHERE id=?").run(nowIso(), user.id);
  await startSession(user.id, remember);
  await logAuthEvent("login_success", { userId: user.id, email });
  redirect(user.must_change_password ? "/account/password" : next);
}

export async function logout(): Promise<void> {
  const s = await getSession();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) getDb().prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(nowIso(), hashToken(token));
  jar.delete(SESSION_COOKIE);
  if (s) await logAuthEvent("logout", { userId: s.user.id, email: s.user.email });
  redirect("/login");
}

export async function updateProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const name = str(form, "name");
  if (!name) return { error: "Name is required." };
  getDb().prepare("UPDATE users SET name=?, phone=?, job_title=? WHERE id=?").run(name, str(form, "phone") || null, str(form, "job_title") || null, me.id);
  revalidatePath("/", "layout");
  return { ok: "Profile saved." };
}

export async function changePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const row = getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(me.id) as { password_hash: string | null };
  if (!verifyPassword(current, row.password_hash)) return { error: "Current password is incorrect." };
  if (next !== confirm) return { error: "New password and confirmation do not match." };
  const policy = passwordPolicyError(next);
  if (policy) return { error: policy };
  if (next === current) return { error: "New password must be different from the current one." };
  const s = await getSession();
  getDb().prepare("UPDATE users SET password_hash=?, must_change_password=0, password_changed_at=?, failed_attempts=0 WHERE id=?").run(hashPassword(next), nowIso(), me.id);
  revokeSessions(me.id, s?.sessionId);
  await logAuthEvent("password_changed", { userId: me.id, email: me.email });
  revalidatePath("/", "layout");
  if (me.must_change_password) redirect("/");
  return { ok: "Password changed. Other sessions were signed out." };
}

export async function revokeOtherSessions(): Promise<void> {
  const s = await getSession();
  if (!s) redirect("/login");
  const n = revokeSessions(s.user.id, s.sessionId);
  if (n) await logAuthEvent("session_revoked", { userId: s.user.id, email: s.user.email, detail: `${n} other session(s)` });
  revalidatePath("/account");
}
