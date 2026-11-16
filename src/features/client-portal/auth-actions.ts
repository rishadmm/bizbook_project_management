"use server";
// The ONLY actions of the client portal: sign in/out, change password, sign out other sessions. Everything else is read-only by construction.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { nowIso, safeNext } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { passwordPolicyError } from "@/lib/permissions";
import { clientLogin, endClientSession, getClientSession, logClientEvent, requireClientAction, revokeClientSessions } from "@/lib/client-portal-auth";
import { guard } from "@/lib/action-result";

export type ClientFormState = { error?: string; ok?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Safe in-portal redirect target (must stay under /c/<slug>/). */
function portalNext(slug: string, next: string): string {
  const n = safeNext(next);
  return n.startsWith(`/c/${slug}/`) && !n.startsWith(`/c/${slug}/login`) ? n : `/c/${slug}`;
}

export async function clientSignIn(_prev: ClientFormState, form: FormData): Promise<ClientFormState> {
  const slug = str(form, "slug");
  const r = await clientLogin(slug, str(form, "email").toLowerCase(), String(form.get("password") ?? ""), form.get("remember") === "on");
  if ("error" in r) return { error: r.error };
  redirect(r.mustChange ? `/c/${slug}/change-password` : portalNext(slug, str(form, "next")));
}

export async function clientSignOut(): Promise<void> {
  const s = await endClientSession();
  if (!s) redirect("/");
  const slug = s.client.portal_slug ?? "";
  if (s.impersonator) {
    await logClientEvent("impersonation_ended", { clientId: s.client.id, email: null, detail: `${s.impersonator.name} left the read-only admin view` });
    redirect(`/clients/${s.client.id}?tab=portal`);
  }
  await logClientEvent("logout", { clientId: s.client.id, userId: s.user.id, email: s.user.email });
  redirect(`/c/${slug}/login`);
}
/** Ends the read-only admin view and returns to the Portal access tab. */
export async function exitClientView(): Promise<void> { await clientSignOut(); }

async function doChangePassword(form: FormData): Promise<void> {
  const s = await getClientSession();
  if (!s) throw new Error("Your session has expired. Please sign in again.");
  if (s.readOnly) throw new Error("Read-only view: actions are disabled while viewing the portal as an administrator.");
  const current = String(form.get("current") ?? ""), next = String(form.get("next") ?? ""), confirm = String(form.get("confirm") ?? "");
  const db = getDb();
  const row = db.prepare("SELECT password_hash FROM client_users WHERE id = ? AND client_id = ?").get(s.user.id, s.client.id) as { password_hash: string | null } | undefined;
  if (!row || !verifyPassword(current, row.password_hash)) throw new Error("Current password is incorrect.");
  if (next !== confirm) throw new Error("New password and confirmation do not match.");
  const policy = passwordPolicyError(next);
  if (policy) throw new Error(policy);
  if (next === current) throw new Error("New password must be different from the current one.");
  db.prepare("UPDATE client_users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(hashPassword(next), nowIso(), s.user.id);
  revokeClientSessions(s.user.id, s.sessionId);
  await logClientEvent("password_changed", { clientId: s.client.id, userId: s.user.id, email: s.user.email });
  if (s.user.mustChange) redirect(`/c/${s.client.portal_slug}`);
}

/** Forced change at first sign-in / after a reset (stand-alone page). */
export async function clientForcedPasswordChange(_prev: ClientFormState, form: FormData): Promise<ClientFormState> {
  const r = await guard(() => doChangePassword(form));
  return r.ok ? { ok: "Password changed." } : { error: r.error };
}
export async function clientChangePassword(_prev: ClientFormState, form: FormData): Promise<ClientFormState> {
  const r = await guard(async () => { await doChangePassword(form); });
  if (r.ok) { revalidatePath("/c", "layout"); return { ok: "Password changed. Other sessions were signed out." }; }
  return { error: r.error };
}

export async function clientRevokeOtherSessions(): Promise<void> {
  const s = await requireClientAction();
  const n = revokeClientSessions(s.user.id, s.sessionId);
  if (n) await logClientEvent("session_revoked", { clientId: s.client.id, userId: s.user.id, email: s.user.email, detail: `${n} other session(s) signed out by the user` });
  revalidatePath(`/c/${s.client.portal_slug}/account`);
}
