"use server";
// Public (no login) supplier actions: register (step 1 of the wizard), global sign-in, forgot / reset password.
// Security: honeypot + in-memory rate limits on every public form, generic messages for unknown accounts, the subcontractor id always comes from the created row / session.
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { hashToken, newToken, nowIso, requestMeta } from "@/lib/auth";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/password";
import { passwordPolicyError } from "@/lib/permissions";
import { portalAvailable, portalLogin, requestOrigin, revokePortalSessions, startPortalSession, logPortalEvent } from "@/lib/portal-auth";
import { insertPortalUser, uniqueSlug } from "@/lib/portal-core";
import { getEntityByCode } from "@/lib/entities";
import { rateLimitOk } from "@/lib/rate-limit";
import { emailError } from "@/lib/registration";
import { mailContext, queueMail } from "@/lib/mailer";
import { renderMail } from "@/lib/mail-templates";
import { guard } from "@/lib/action-result";
import { logSub } from "./core";
import type { Subcontractor } from "@/lib/types";

export type PubState = { error?: string; fieldErrors?: Record<string, string>; info?: string; choices?: { slug: string; name: string; country: string; flag: string | null }[] } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const GENERIC_LOGIN = "Invalid email or password.";

async function clientKey(prefix: string): Promise<string> {
  const m = await requestMeta();
  return `${prefix}:${m.ip ?? "unknown"}`;
}

/** Step 1 of /suppliers/register: creates the supplier (draft / prospect) and its first portal user (owner), signs in and opens the registration wizard. */
export async function registerSupplier(_prev: PubState, form: FormData): Promise<PubState> {
  // honeypot: bots fill every input. A silent, generic refusal gives them no signal.
  if (str(form, "company_website")) return { error: "We could not process this registration. Please try again." };
  if (!rateLimitOk(await clientKey("register"), 15, 10 * 60_000)) return { error: "Too many registration attempts from your network. Please wait a few minutes and try again." };
  const fe: Record<string, string> = {};
  const entity = getEntityByCode(str(form, "country"));
  if (!entity || entity.status !== "active") fe.country = "Choose the country you want to register in.";
  const company = str(form, "company"), contact = str(form, "contact_name"), email = str(form, "email").toLowerCase(), phone = str(form, "phone");
  const password = String(form.get("password") ?? ""), confirm = String(form.get("confirm") ?? "");
  if (company.length < 3) fe.company = "Enter the company's legal name.";
  if (contact.length < 3) fe.contact_name = "Enter the primary contact's full name.";
  const ee = emailError(email); if (ee) fe.email = ee;
  if (phone.replace(/\D/g, "").length < 8) fe.phone = "Enter a mobile number with the country code.";
  const pe = passwordPolicyError(password); if (pe) fe.password = pe; else if (password !== confirm) fe.confirm = "The two passwords do not match.";
  if (form.get("terms") !== "on") fe.terms = "Please accept the terms to continue.";
  if (Object.keys(fe).length || !entity) return { error: "Please correct the highlighted fields.", fieldErrors: fe };

  const db = getDb();
  const taken = db.prepare("SELECT 1 FROM portal_users pu JOIN subcontractors s ON s.id = pu.subcontractor_id WHERE s.entity_id = ? AND lower(pu.email) = ?").get(entity.id, email);
  if (taken) return { error: "An account with this email already exists for this country.", fieldErrors: { email: "This email is already registered. Sign in instead, or use the password reset." } };

  const created = db.transaction(() => {
    const pre = `${entity.doc_prefix}SUB-`;
    const max = (db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code, ?) AS INTEGER)),0) m FROM subcontractors WHERE entity_id = ? AND code LIKE ?").get(pre.length + 1, entity.id, `${pre}%`) as { m: number }).m;
    const now = nowIso();
    const id = Number(db.prepare(`INSERT INTO subcontractors(code, name, contact_person, email, phone, status, entity_id, registration_status, registered_at, portal_enabled, country_of_registration)
      VALUES (?,?,?,?,?, 'prospect', ?, 'draft', ?, 1, ?)`).run(`${pre}${String(max + 1).padStart(3, "0")}`, company, contact, email, phone, entity.id, now, entity.country).lastInsertRowid);
    const slug = uniqueSlug(db, company, id);
    db.prepare("UPDATE subcontractors SET portal_slug = ? WHERE id = ?").run(slug, id);
    const userId = insertPortalUser(db, { subcontractorId: id, name: contact, email, phone, jobTitle: "Primary contact", role: "owner", password, mustChange: false, createdAt: now });
    db.prepare("INSERT INTO subcontractor_contacts(subcontractor_id, role, name, title, email, phone) VALUES (?, 'primary', ?, 'Primary contact', ?, ?)").run(id, contact, email, phone);
    logSub(db, id, "registration", `Supplier registration started by ${contact} (${entity.country})`, null);
    return { id, slug, userId };
  })();
  await startPortalSession({ userId: created.userId, subId: created.id, remember: false });
  await logPortalEvent("user_created", { subId: created.id, userId: created.userId, email, detail: "Self-registration" });
  await logPortalEvent("login_success", { subId: created.id, userId: created.userId, email });
  redirect(`/p/${created.slug}/registration?step=2`);
}

/** Global sign-in (/suppliers/login): finds the portal users by e-mail; several matching suppliers / countries -> a chooser. */
export async function supplierSignIn(_prev: PubState, form: FormData): Promise<PubState> {
  const email = str(form, "email").toLowerCase(), password = String(form.get("password") ?? ""), remember = form.get("remember") === "on";
  const chosen = str(form, "slug");
  if (!rateLimitOk(await clientKey("supplier-login"), 20, 10 * 60_000)) return { error: "Too many sign-in attempts. Please wait a few minutes and try again." };
  if (!email || !password) return { error: GENERIC_LOGIN };
  const db = getDb();
  type Cand = { slug: string; name: string; country: string; flag: string | null; password_hash: string | null; status: string; portal_enabled: number; sub_status: string };
  const cands = (db.prepare(`SELECT s.portal_slug slug, s.name, e.country, e.flag, pu.password_hash, pu.status, s.portal_enabled, s.status sub_status
    FROM portal_users pu JOIN subcontractors s ON s.id = pu.subcontractor_id JOIN entities e ON e.id = s.entity_id
    WHERE lower(pu.email) = ? AND s.portal_slug IS NOT NULL ORDER BY s.id`).all(email) as Cand[]).filter((c) => portalAvailable({ portal_enabled: c.portal_enabled as 0 | 1, status: c.sub_status as Subcontractor["status"] }));
  if (!cands.length) { burnPasswordCheck(password); return { error: GENERIC_LOGIN }; }
  if (chosen) {
    const c = cands.find((x) => x.slug === chosen);
    if (!c) return { error: GENERIC_LOGIN };
    return finishLogin(c.slug, email, password, remember);
  }
  const matching = cands.filter((c) => c.password_hash && verifyPassword(password, c.password_hash));
  if (matching.length === 0) return finishLogin(cands[0].slug, email, password, remember); // wrong password: let the portal count the failure / lock-out
  if (matching.length === 1) return finishLogin(matching[0].slug, email, password, remember);
  return { choices: matching.map((c) => ({ slug: c.slug, name: c.name, country: c.country, flag: c.flag })) };
}
async function finishLogin(slug: string, email: string, password: string, remember: boolean): Promise<PubState> {
  const r = await portalLogin(slug, email, password, remember);
  if ("error" in r) return { error: r.error };
  redirect(r.mustChange ? `/p/${slug}/change-password` : `/p/${slug}`);
}

const RESET_HOURS = 2;
/** "Forgot password?": e-mails a one-time reset link (outbox) to every matching portal user. The answer never reveals whether the address exists. */
export async function requestPasswordReset(_prev: PubState, form: FormData): Promise<PubState> {
  if (str(form, "company_website")) return { info: "If that address belongs to a supplier account, a reset link is on its way." };
  if (!rateLimitOk(await clientKey("supplier-reset"), 5, 15 * 60_000)) return { error: "Too many requests. Please wait a few minutes and try again." };
  const email = str(form, "email").toLowerCase();
  const ee = emailError(email);
  if (ee) return { error: ee };
  const db = getDb();
  const origin = await requestOrigin();
  const users = db.prepare(`SELECT pu.id, pu.name, s.id sub_id, s.entity_id, s.portal_enabled, s.status sub_status FROM portal_users pu JOIN subcontractors s ON s.id = pu.subcontractor_id
    WHERE lower(pu.email) = ? AND pu.status = 'active'`).all(email) as { id: number; name: string; sub_id: number; entity_id: number; portal_enabled: number; sub_status: string }[];
  for (const u of users) {
    if (!portalAvailable({ portal_enabled: u.portal_enabled as 0 | 1, status: u.sub_status as Subcontractor["status"] })) continue;
    const token = newToken();
    db.prepare("INSERT INTO portal_password_resets(portal_user_id, token_hash, expires_at, created_at) VALUES (?,?,?,?)").run(u.id, hashToken(token), new Date(Date.now() + RESET_HOURS * 3_600_000).toISOString(), nowIso());
    const ctx = mailContext(db, u.entity_id, u.name, origin);
    const r = renderMail("password_reset", ctx, { resetUrl: `${origin}/suppliers/reset/${token}`, hours: RESET_HOURS });
    queueMail(db, { to: email, toName: u.name, subject: r.subject, html: r.html, text: r.text, template: "password_reset", related: { type: "subcontractor", id: u.sub_id }, entityId: u.entity_id });
    await logPortalEvent("password_reset", { subId: u.sub_id, userId: u.id, email, detail: "Self-service reset link requested" });
  }
  return { info: "If that address belongs to a supplier account, a reset link is on its way. Check your inbox (the link is valid for 2 hours)." };
}

/** Sets the new password from a reset link. Single use; ends every session of the user. */
export async function resetPassword(_prev: PubState, form: FormData): Promise<PubState> {
  if (!rateLimitOk(await clientKey("supplier-reset-apply"), 10, 15 * 60_000)) return { error: "Too many attempts. Please wait a few minutes." };
  const token = str(form, "token"), next = String(form.get("password") ?? ""), confirm = String(form.get("confirm") ?? "");
  const pe = passwordPolicyError(next);
  if (pe) return { error: pe };
  if (next !== confirm) return { error: "The two passwords do not match." };
  const db = getDb();
  const row = db.prepare("SELECT r.id, r.portal_user_id, r.expires_at, r.used_at, pu.subcontractor_id sub_id, pu.email FROM portal_password_resets r JOIN portal_users pu ON pu.id = r.portal_user_id WHERE r.token_hash = ?").get(hashToken(token)) as
    { id: number; portal_user_id: number; expires_at: string; used_at: string | null; sub_id: number; email: string } | undefined;
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) return { error: "This reset link is invalid or has expired. Request a new one." };
  const res = await guard(() => {
    db.transaction(() => {
      db.prepare("UPDATE portal_users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(hashPassword(next), nowIso(), row.portal_user_id);
      db.prepare("UPDATE portal_password_resets SET used_at = ? WHERE id = ?").run(nowIso(), row.id);
      db.prepare("UPDATE portal_password_resets SET used_at = ? WHERE portal_user_id = ? AND used_at IS NULL").run(nowIso(), row.portal_user_id);
    })();
    revokePortalSessions(row.portal_user_id);
  });
  if (!res.ok) return { error: res.error };
  await logPortalEvent("password_changed", { subId: row.sub_id, userId: row.portal_user_id, email: row.email, detail: "Password set from a reset link" });
  return { info: "Your password has been changed. You can sign in now." };
}
