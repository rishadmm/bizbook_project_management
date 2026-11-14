"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { nowIso, safeNext } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { passwordPolicyError } from "@/lib/permissions";
import { endPortalSession, getPortalSession, logPortalEvent, portalLogin, revokePortalSessions, requirePortalAction } from "@/lib/portal-auth";
import { guard, type ActionResult } from "@/lib/action-result";

export type PortalFormState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Safe in-portal redirect target (must stay under /p/<slug>/). */
function portalNext(slug: string, next: string): string {
  const n = safeNext(next);
  return n.startsWith(`/p/${slug}/`) && !n.startsWith(`/p/${slug}/login`) ? n : `/p/${slug}`;
}

export async function portalSignIn(_prev: PortalFormState, form: FormData): Promise<PortalFormState> {
  const slug = str(form, "slug");
  const r = await portalLogin(slug, str(form, "email").toLowerCase(), String(form.get("password") ?? ""), form.get("remember") === "on");
  if ("error" in r) return { error: r.error };
  redirect(r.mustChange ? `/p/${slug}/change-password` : portalNext(slug, str(form, "next")));
}

export async function portalSignOut(): Promise<void> {
  const s = await endPortalSession();
  if (!s) redirect("/");
  const slug = s.sub.portal_slug ?? "";
  if (s.impersonator) {
    await logPortalEvent("impersonation_ended", { subId: s.sub.id, email: null, detail: `${s.impersonator.name} left the read-only admin view` });
    redirect(`/subcontractors/${s.sub.id}?tab=portal`);
  }
  await logPortalEvent("logout", { subId: s.sub.id, userId: s.user.id, email: s.user.email });
  redirect(`/p/${slug}/login`);
}

/** Ends the read-only admin view and returns to the Portal access tab. */
export async function exitAdminView(): Promise<void> { await portalSignOut(); }

async function doChangePassword(form: FormData): Promise<void> {
  const s = await getPortalSession();
  if (!s) throw new Error("Your session has expired. Please sign in again.");
  if (s.readOnly) throw new Error("Read-only view: actions are disabled while viewing the portal as an administrator.");
  const current = String(form.get("current") ?? ""), next = String(form.get("next") ?? ""), confirm = String(form.get("confirm") ?? "");
  const db = getDb();
  const row = db.prepare("SELECT password_hash FROM portal_users WHERE id = ? AND subcontractor_id = ?").get(s.user.id, s.sub.id) as { password_hash: string | null } | undefined;
  if (!row || !verifyPassword(current, row.password_hash)) throw new Error("Current password is incorrect.");
  if (next !== confirm) throw new Error("New password and confirmation do not match.");
  const policy = passwordPolicyError(next);
  if (policy) throw new Error(policy);
  if (next === current) throw new Error("New password must be different from the current one.");
  db.prepare("UPDATE portal_users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(hashPassword(next), nowIso(), s.user.id);
  revokePortalSessions(s.user.id, s.sessionId);
  await logPortalEvent("password_changed", { subId: s.sub.id, userId: s.user.id, email: s.user.email });
  if (s.user.mustChange) redirect(`/p/${s.sub.portal_slug}`);
}

/** Forced change at first sign-in / after a reset (stand-alone page). */
export async function portalForcedPasswordChange(_prev: PortalFormState, form: FormData): Promise<PortalFormState> {
  const r = await guard(() => doChangePassword(form));
  return r.ok ? { ok: "Password changed." } : { error: r.error };
}
export async function portalChangePassword(_prev: PortalFormState, form: FormData): Promise<PortalFormState> {
  const r = await guard(async () => { await doChangePassword(form); });
  if (r.ok) { revalidatePath("/p", "layout"); return { ok: "Password changed. Other sessions were signed out." }; }
  return { error: r.error };
}

export async function portalUpdateProfile(_prev: PortalFormState, form: FormData): Promise<PortalFormState> {
  const r = await guard(async () => {
    const s = await requirePortalAction(null);
    const name = str(form, "name");
    if (!name) throw new Error("Name is required.");
    getDb().prepare("UPDATE portal_users SET name = ?, phone = ?, job_title = ? WHERE id = ? AND subcontractor_id = ?").run(name, str(form, "phone") || null, str(form, "job_title") || null, s.user.id, s.sub.id);
    revalidatePath("/p", "layout");
  });
  return r.ok ? { ok: "Profile saved." } : { error: r.error };
}

export async function portalRevokeOtherSessions(): Promise<void> {
  const s = await requirePortalAction(null);
  const n = revokePortalSessions(s.user.id, s.sessionId);
  if (n) await logPortalEvent("session_revoked", { subId: s.sub.id, userId: s.user.id, email: s.user.email, detail: `${n} other session(s) signed out by the user` });
  revalidatePath(`/p/${s.sub.portal_slug}/account`);
}
export type { ActionResult };
