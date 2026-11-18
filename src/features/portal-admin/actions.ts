"use server";
// Internal-staff actions for the subcontractor portal (Portal access tab). Permission: subcontractors / portal.
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requirePermission, type AuthUser } from "@/lib/auth";
import { assertUserEntity } from "@/lib/entity-context";
import { entityOfSubcontractor, entityOfAttachmentOwner } from "@/lib/entities";
import { generateTempPassword, hashPassword } from "@/lib/password";
import { passwordPolicyError } from "@/lib/permissions";
import { ensureSlug, insertPortalUser, isPortalRole, isSlugTaken, slugError } from "@/lib/portal-core";
import { logPortalEvent, revokePortalSessions } from "@/lib/portal-auth";
import { guard, type ActionResult } from "@/lib/action-result";
import type { CredResult } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const refresh = (subId: number) => { revalidatePath(`/subcontractors/${subId}`); revalidatePath("/subcontractors"); };

/** Like guard() but for actions that return issued credentials. Control-flow errors are re-thrown. */
async function run(fn: () => Promise<CredResult>): Promise<CredResult> {
  try { return await fn(); } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

function subOrThrow(subId: number, who: AuthUser) {
  const s = getDb().prepare("SELECT id, name, portal_slug, portal_enabled FROM subcontractors WHERE id = ?").get(subId) as { id: number; name: string; portal_slug: string | null; portal_enabled: number } | undefined;
  if (!s) throw new Error("Subcontractor not found");
  assertUserEntity(who, entityOfSubcontractor(subId), "Subcontractor"); // country access
  return s;
}
/** The portal user must belong to the given subcontractor (never trust the user id alone). */
function userOrThrow(subId: number, userId: number, who: AuthUser) {
  assertUserEntity(who, entityOfSubcontractor(subId), "Portal user");
  const u = getDb().prepare("SELECT * FROM portal_users WHERE id = ? AND subcontractor_id = ?").get(userId, subId) as
    { id: number; name: string; email: string; status: string; last_login_at: string | null; portal_role: string } | undefined;
  if (!u) throw new Error("Portal user not found");
  return u;
}
function scopeFrom(form: FormData, subId: number): number[] | null {
  if (str(form, "scope_mode") !== "pick") return null;
  const wanted = form.getAll("scope").map(Number).filter((n) => Number.isInteger(n));
  const ok = new Set((getDb().prepare("SELECT id FROM assignments WHERE subcontractor_id = ?").all(subId) as { id: number }[]).map((r) => r.id));
  const ids = wanted.filter((i) => ok.has(i));
  if (!ids.length) throw new Error("Pick at least one subcontract, or choose all subcontracts.");
  return ids;
}

export async function createPortalUser(_prev: CredResult, form: FormData): Promise<CredResult> {
  return run(async () => {
    const me = await requirePermission("subcontractors", "portal");
    const subId = Number(form.get("subcontractor_id"));
    subOrThrow(subId, me);
    const name = str(form, "name"), email = str(form, "email").toLowerCase(), role = str(form, "portal_role");
    if (!name) throw new Error("Name is required");
    if (!EMAIL.test(email)) throw new Error("Enter a valid e-mail address");
    if (!isPortalRole(role)) throw new Error("Choose a portal role");
    const password = String(form.get("password") ?? "");
    const policy = passwordPolicyError(password);
    if (policy) throw new Error(policy);
    const db = getDb();
    if (db.prepare("SELECT 1 FROM portal_users WHERE subcontractor_id = ? AND lower(email) = ?").get(subId, email)) throw new Error("A portal user with this e-mail already exists for this company");
    const scope = scopeFrom(form, subId);
    const slug = ensureSlug(db, subId)!;
    const id = insertPortalUser(db, { subcontractorId: subId, name, email, phone: opt(form, "phone"), jobTitle: opt(form, "job_title"), role, password, mustChange: form.get("must_change") === "on", scope, createdBy: me.id || null });
    await logPortalEvent("user_created", { subId, userId: id, email, detail: `Created by ${me.name} (${role})` });
    await logActivity("subcontractor", subId, "portal", `Portal user ${name} <${email}> created (${role})`);
    refresh(subId);
    return { ok: true, credentials: { name, email, password, slug } };
  });
}

export async function resetPortalUserPassword(_prev: CredResult, form: FormData): Promise<CredResult> {
  return run(async () => {
    const me = await requirePermission("subcontractors", "portal");
    const subId = Number(form.get("subcontractor_id"));
    const sub = subOrThrow(subId, me);
    const u = userOrThrow(subId, Number(form.get("user_id")), me);
    const password = generateTempPassword();
    getDb().prepare("UPDATE portal_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, password_changed_at = NULL WHERE id = ?").run(hashPassword(password), u.id);
    revokePortalSessions(u.id);
    await logPortalEvent("password_reset", { subId, userId: u.id, email: u.email, detail: `Temporary password issued by ${me.name}` });
    await logActivity("subcontractor", subId, "portal", `Portal password reset for ${u.name}`);
    refresh(subId);
    return { ok: true, credentials: { name: u.name, email: u.email, password, slug: ensureSlug(getDb(), sub.id)! } };
  });
}

export async function updatePortalUser(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("subcontractors", "portal");
    const subId = Number(form.get("subcontractor_id"));
    const u = userOrThrow(subId, Number(form.get("user_id")), me);
    const name = str(form, "name"), role = str(form, "portal_role");
    if (!name) throw new Error("Name is required");
    if (!isPortalRole(role)) throw new Error("Choose a portal role");
    const scope = scopeFrom(form, subId);
    getDb().prepare("UPDATE portal_users SET name = ?, phone = ?, job_title = ?, portal_role = ?, assignment_scope = ? WHERE id = ?")
      .run(name, opt(form, "phone"), opt(form, "job_title"), role, scope ? JSON.stringify(scope) : null, u.id);
    await logPortalEvent("user_updated", { subId, userId: u.id, email: u.email, detail: `Updated by ${me.name}: role ${role}, ${scope ? `${scope.length} subcontract(s)` : "all subcontracts"}` });
    refresh(subId);
  });
}

export async function setPortalUserStatus(form: FormData): Promise<void> {
  const me = await requirePermission("subcontractors", "portal");
  const subId = Number(form.get("subcontractor_id"));
  const u = userOrThrow(subId, Number(form.get("user_id")), me);
  const enable = str(form, "enable") === "1";
  getDb().prepare("UPDATE portal_users SET status = ? WHERE id = ?").run(enable ? "active" : "disabled", u.id);
  if (!enable) revokePortalSessions(u.id);
  await logPortalEvent(enable ? "user_enabled" : "user_disabled", { subId, userId: u.id, email: u.email, detail: `${enable ? "Enabled" : "Disabled"} by ${me.name}` });
  await logActivity("subcontractor", subId, "portal", `Portal user ${u.name} ${enable ? "enabled" : "disabled"}`);
  refresh(subId);
}

export async function unlockPortalUser(form: FormData): Promise<void> {
  const me = await requirePermission("subcontractors", "portal");
  const subId = Number(form.get("subcontractor_id"));
  const u = userOrThrow(subId, Number(form.get("user_id")), me);
  getDb().prepare("UPDATE portal_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(u.id);
  await logPortalEvent("user_unlocked", { subId, userId: u.id, email: u.email, detail: `Unlocked by ${me.name}` });
  refresh(subId);
}

export async function signOutPortalUser(form: FormData): Promise<void> {
  const me = await requirePermission("subcontractors", "portal");
  const subId = Number(form.get("subcontractor_id"));
  const u = userOrThrow(subId, Number(form.get("user_id")), me);
  const n = revokePortalSessions(u.id);
  await logPortalEvent("session_revoked", { subId, userId: u.id, email: u.email, detail: `${n} session(s) signed out by ${me.name}` });
  refresh(subId);
}

export async function deletePortalUser(form: FormData): Promise<void> {
  const me = await requirePermission("subcontractors", "portal");
  const subId = Number(form.get("subcontractor_id"));
  const u = userOrThrow(subId, Number(form.get("user_id")), me);
  if (u.last_login_at) throw new Error("This user has already signed in: disable the account instead of deleting it.");
  getDb().prepare("DELETE FROM portal_users WHERE id = ?").run(u.id);
  await logPortalEvent("user_deleted", { subId, email: u.email, detail: `Deleted by ${me.name}` });
  await logActivity("subcontractor", subId, "portal", `Portal user ${u.name} deleted`);
  refresh(subId);
}

/** Portal address (slug) + enable/disable. */
export async function savePortalSettings(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("subcontractors", "portal");
    const subId = Number(form.get("subcontractor_id"));
    const sub = subOrThrow(subId, me);
    const db = getDb();
    const slugRaw = str(form, "slug").toLowerCase();
    if (slugRaw && slugRaw !== sub.portal_slug) {
      const err = slugError(slugRaw);
      if (err) throw new Error(err);
      if (isSlugTaken(db, slugRaw, subId)) throw new Error("This portal address is already used by another company");
      db.prepare("UPDATE subcontractors SET portal_slug = ? WHERE id = ?").run(slugRaw, subId);
      db.prepare("UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE subcontractor_id = ? AND revoked_at IS NULL AND impersonated_by IS NULL").run(subId);
      await logPortalEvent("slug_changed", { subId, detail: `${sub.portal_slug} -> ${slugRaw} by ${me.name}` });
    }
    const enable = str(form, "enable");
    if (enable === "1" || enable === "0") {
      db.prepare("UPDATE subcontractors SET portal_enabled = ? WHERE id = ?").run(Number(enable), subId);
      if (enable === "0") db.prepare("UPDATE portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE subcontractor_id = ? AND revoked_at IS NULL").run(subId);
      await logPortalEvent(enable === "1" ? "portal_enabled" : "portal_disabled", { subId, detail: `By ${me.name}` });
      await logActivity("subcontractor", subId, "portal", `Subcontractor portal ${enable === "1" ? "enabled" : "disabled"}`);
    }
    refresh(subId);
  });
}

/** Approve / reject a change request raised from the portal (bank details, contact details). */
export async function decideChangeRequest(form: FormData): Promise<void> {
  const me = await requirePermission("subcontractors", "portal");
  await requirePermission("subcontractors", "edit");
  const subId = Number(form.get("subcontractor_id"));
  const id = Number(form.get("id"));
  assertUserEntity(me, entityOfSubcontractor(subId), "Change request");
  const approve = str(form, "decision") === "approve";
  const db = getDb();
  const r = db.prepare("SELECT * FROM portal_change_requests WHERE id = ? AND subcontractor_id = ? AND status = 'pending'").get(id, subId) as { id: number; kind: string; payload: string } | undefined;
  if (!r) throw new Error("Change request not found or already decided");
  db.transaction(() => {
    if (approve) {
      const p = JSON.parse(r.payload) as Record<string, string | null>;
      if (r.kind === "bank") db.prepare("UPDATE subcontractors SET bank_name = COALESCE(?, bank_name), iban = COALESCE(?, iban) WHERE id = ?").run(p.bank_name || null, p.iban || null, subId);
      else if (r.kind === "contact") db.prepare("UPDATE subcontractors SET contact_person = COALESCE(?, contact_person), email = COALESCE(?, email), phone = COALESCE(?, phone), address = COALESCE(?, address) WHERE id = ?")
        .run(p.contact_person || null, p.email || null, p.phone || null, p.address || null, subId);
    }
    db.prepare("UPDATE portal_change_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?")
      .run(approve ? "approved" : "rejected", me.id || null, new Date().toISOString(), opt(form, "note"), r.id);
  })();
  await logActivity("subcontractor", subId, "portal", `Portal ${r.kind} change request ${approve ? "approved" : "rejected"}`);
  refresh(subId);
}

/** Rejects a document uploaded through the portal (the subcontractor sees the note). */
export async function rejectPortalDocument(form: FormData): Promise<void> {
  const editor = await requirePermission("subcontractors", "edit");
  const subId = Number(form.get("subcontractor_id"));
  const id = Number(form.get("id"));
  assertUserEntity(editor, entityOfSubcontractor(subId), "Document");
  const r = getDb().prepare("UPDATE subcontractor_documents SET status = 'rejected', review_note = ? WHERE id = ? AND subcontractor_id = ?").run(opt(form, "note") ?? "Rejected", id, subId);
  if (!r.changes) throw new Error("Document not found");
  await logActivity("subcontractor", subId, "document", "Portal document rejected");
  refresh(subId);
}

/** Internal reply on an issue / RFI thread (visible to the subcontractor in the portal). */
export async function replyToIssue(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("projects", "edit");
    const id = Number(form.get("issue_id"));
    const body = str(form, "body");
    if (!body) throw new Error("Write a reply first");
    if (body.length > 4000) throw new Error("Reply is too long");
    const db = getDb();
    const i = db.prepare("SELECT id, project_id, title, assignment_id FROM issues WHERE id = ?").get(id) as { id: number; project_id: number; title: string; assignment_id: number | null } | undefined;
    if (!i) throw new Error("Issue not found");
    assertUserEntity(me, entityOfAttachmentOwner("project", i.project_id), "Issue");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO issue_comments(issue_id, author_type, author_id, author_name, body, created_at) VALUES (?,?,?,?,?,?)").run(i.id, "internal", me.id || null, me.name, body, now);
    // awaiting the subcontractor only when asked and when the issue sits on a subcontract
    db.prepare("UPDATE issues SET awaiting_party = ?, last_activity_at = ? WHERE id = ?").run(form.get("needs_response") === "on" && i.assignment_id ? "portal" : null, now, i.id);
    await logActivity("project", i.project_id, "issue", `Reply posted on "${i.title}"`);
    revalidatePath(`/projects/${i.project_id}`);
  });
}
