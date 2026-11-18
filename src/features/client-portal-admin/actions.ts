"use server";
// Internal-staff actions for the client portal (Portal access tab of /clients/[id]). Permission: clients / portal.
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { requirePermission, type AuthUser } from "@/lib/auth";
import { assertUserEntity } from "@/lib/entity-context";
import { entityOfClient } from "@/lib/entities";
import { generateTempPassword, hashPassword } from "@/lib/password";
import { passwordPolicyError } from "@/lib/permissions";
import { ensureClientSlug, insertClientUser, isClientRole, isClientSlugTaken } from "@/lib/client-portal-core";
import { slugError } from "@/lib/portal-perms";
import { logClientEvent, revokeClientSessions } from "@/lib/client-portal-auth";
import { guard, type ActionResult } from "@/lib/action-result";
import type { CredResult } from "@/features/portal-admin/types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const refresh = (clientId: number) => { revalidatePath(`/clients/${clientId}`); revalidatePath("/clients"); };

async function run(fn: () => Promise<CredResult>): Promise<CredResult> {
  try { return await fn(); } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
  }
}

function clientOrThrow(clientId: number, who: AuthUser) {
  const c = getDb().prepare("SELECT id, name, portal_slug, portal_enabled FROM clients WHERE id = ?").get(clientId) as { id: number; name: string; portal_slug: string | null; portal_enabled: number } | undefined;
  if (!c) throw new Error("Client not found");
  assertUserEntity(who, entityOfClient(clientId), "Client"); // country access
  return c;
}
/** The client user must belong to the given client (never trust the user id alone). */
function userOrThrow(clientId: number, userId: number, who: AuthUser) {
  assertUserEntity(who, entityOfClient(clientId), "Portal user");
  const u = getDb().prepare("SELECT * FROM client_users WHERE id = ? AND client_id = ?").get(userId, clientId) as { id: number; name: string; email: string; status: string; last_login_at: string | null; role: string } | undefined;
  if (!u) throw new Error("Portal user not found");
  return u;
}
function scopeFrom(form: FormData, clientId: number): number[] | null {
  if (str(form, "scope_mode") !== "pick") return null;
  const wanted = form.getAll("scope").map(Number).filter((n) => Number.isInteger(n));
  const ok = new Set((getDb().prepare("SELECT id FROM projects WHERE client_id = ?").all(clientId) as { id: number }[]).map((r) => r.id));
  const ids = wanted.filter((i) => ok.has(i));
  if (!ids.length) throw new Error("Pick at least one project, or choose all projects.");
  return ids;
}
const hasProjects = (clientId: number) => !!getDb().prepare("SELECT 1 FROM projects WHERE client_id = ?").get(clientId);

export async function createClientUser(_prev: CredResult, form: FormData): Promise<CredResult> {
  return run(async () => {
    const me = await requirePermission("clients", "portal");
    const clientId = Number(form.get("client_id"));
    clientOrThrow(clientId, me);
    if (!hasProjects(clientId)) throw new Error("This client has no projects yet: the portal needs at least one project.");
    const name = str(form, "name"), email = str(form, "email").toLowerCase(), role = str(form, "role");
    if (!name) throw new Error("Name is required");
    if (!EMAIL.test(email)) throw new Error("Enter a valid e-mail address");
    if (!isClientRole(role)) throw new Error("Choose a role");
    const password = String(form.get("password") ?? "");
    const policy = passwordPolicyError(password);
    if (policy) throw new Error(policy);
    const db = getDb();
    if (db.prepare("SELECT 1 FROM client_users WHERE client_id = ? AND lower(email) = ?").get(clientId, email)) throw new Error("A portal user with this e-mail already exists for this client");
    const scope = scopeFrom(form, clientId);
    const slug = ensureClientSlug(db, clientId)!;
    const id = insertClientUser(db, { clientId, name, email, phone: opt(form, "phone"), jobTitle: opt(form, "job_title"), role, password, mustChange: form.get("must_change") === "on", scope, createdBy: me.id || null });
    await logClientEvent("user_created", { clientId, userId: id, email, detail: `Created by ${me.name} (${role})` });
    await logActivity("project", firstProject(clientId), "client_portal", `Client portal user ${name} <${email}> created (${role})`);
    refresh(clientId);
    return { ok: true, credentials: { name, email, password, slug } };
  });
}
const firstProject = (clientId: number) => (getDb().prepare("SELECT id FROM projects WHERE client_id = ? ORDER BY id LIMIT 1").get(clientId) as { id: number } | undefined)?.id ?? 0;

export async function resetClientUserPassword(_prev: CredResult, form: FormData): Promise<CredResult> {
  return run(async () => {
    const me = await requirePermission("clients", "portal");
    const clientId = Number(form.get("client_id"));
    clientOrThrow(clientId, me);
    const u = userOrThrow(clientId, Number(form.get("user_id")), me);
    const password = generateTempPassword();
    getDb().prepare("UPDATE client_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, password_changed_at = NULL WHERE id = ?").run(hashPassword(password), u.id);
    revokeClientSessions(u.id);
    await logClientEvent("password_reset", { clientId, userId: u.id, email: u.email, detail: `Temporary password issued by ${me.name}` });
    refresh(clientId);
    return { ok: true, credentials: { name: u.name, email: u.email, password, slug: ensureClientSlug(getDb(), clientId)! } };
  });
}

export async function updateClientUser(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("clients", "portal");
    const clientId = Number(form.get("client_id"));
    const u = userOrThrow(clientId, Number(form.get("user_id")), me);
    const name = str(form, "name"), role = str(form, "role");
    if (!name) throw new Error("Name is required");
    if (!isClientRole(role)) throw new Error("Choose a role");
    const scope = scopeFrom(form, clientId);
    getDb().prepare("UPDATE client_users SET name = ?, phone = ?, job_title = ?, role = ?, project_scope = ? WHERE id = ?").run(name, opt(form, "phone"), opt(form, "job_title"), role, scope ? JSON.stringify(scope) : null, u.id);
    await logClientEvent("user_updated", { clientId, userId: u.id, email: u.email, detail: `Updated by ${me.name}: role ${role}, ${scope ? `${scope.length} project(s)` : "all projects"}` });
    refresh(clientId);
  });
}

export async function setClientUserStatus(form: FormData): Promise<void> {
  const me = await requirePermission("clients", "portal");
  const clientId = Number(form.get("client_id"));
  const u = userOrThrow(clientId, Number(form.get("user_id")), me);
  const enable = str(form, "enable") === "1";
  getDb().prepare("UPDATE client_users SET status = ? WHERE id = ?").run(enable ? "active" : "disabled", u.id);
  if (!enable) revokeClientSessions(u.id);
  await logClientEvent(enable ? "user_enabled" : "user_disabled", { clientId, userId: u.id, email: u.email, detail: `${enable ? "Enabled" : "Disabled"} by ${me.name}` });
  refresh(clientId);
}

export async function unlockClientUser(form: FormData): Promise<void> {
  const me = await requirePermission("clients", "portal");
  const clientId = Number(form.get("client_id"));
  const u = userOrThrow(clientId, Number(form.get("user_id")), me);
  getDb().prepare("UPDATE client_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(u.id);
  await logClientEvent("user_unlocked", { clientId, userId: u.id, email: u.email, detail: `Unlocked by ${me.name}` });
  refresh(clientId);
}

export async function signOutClientUser(form: FormData): Promise<void> {
  const me = await requirePermission("clients", "portal");
  const clientId = Number(form.get("client_id"));
  const u = userOrThrow(clientId, Number(form.get("user_id")), me);
  const n = revokeClientSessions(u.id);
  await logClientEvent("session_revoked", { clientId, userId: u.id, email: u.email, detail: `${n} session(s) signed out by ${me.name}` });
  refresh(clientId);
}

export async function deleteClientUser(form: FormData): Promise<void> {
  const me = await requirePermission("clients", "portal");
  const clientId = Number(form.get("client_id"));
  const u = userOrThrow(clientId, Number(form.get("user_id")), me);
  if (u.last_login_at) throw new Error("This user has already signed in: disable the account instead of deleting it.");
  getDb().prepare("DELETE FROM client_users WHERE id = ?").run(u.id);
  await logClientEvent("user_deleted", { clientId, email: u.email, detail: `Deleted by ${me.name}` });
  refresh(clientId);
}

/** Portal address (slug), enable/disable and the two visibility switches. */
export async function saveClientPortalSettings(form: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("clients", "portal");
    const clientId = Number(form.get("client_id"));
    const c = clientOrThrow(clientId, me);
    const db = getDb();
    const slugRaw = str(form, "slug").toLowerCase();
    if (slugRaw && slugRaw !== c.portal_slug) {
      const err = slugError(slugRaw);
      if (err) throw new Error(err);
      if (isClientSlugTaken(db, slugRaw, clientId)) throw new Error("This portal address is already used by another client");
      db.prepare("UPDATE clients SET portal_slug = ? WHERE id = ?").run(slugRaw, clientId);
      db.prepare("UPDATE client_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE client_id = ? AND revoked_at IS NULL AND impersonated_by IS NULL").run(clientId);
      await logClientEvent("slug_changed", { clientId, detail: `${c.portal_slug} -> ${slugRaw} by ${me.name}` });
    }
    const enable = str(form, "enable");
    if (enable === "1" || enable === "0") {
      if (enable === "1" && !hasProjects(clientId)) throw new Error("This client has no projects yet: the portal needs at least one project.");
      db.prepare("UPDATE clients SET portal_enabled = ? WHERE id = ?").run(Number(enable), clientId);
      if (enable === "0") db.prepare("UPDATE client_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE client_id = ? AND revoked_at IS NULL").run(clientId);
      await logClientEvent(enable === "1" ? "portal_enabled" : "portal_disabled", { clientId, detail: `By ${me.name}` });
    }
    const flag = str(form, "visibility");
    if (flag === "subcontractors" || flag === "financials") {
      const on = str(form, "value") === "1" ? 1 : 0;
      db.prepare(`UPDATE clients SET ${flag === "subcontractors" ? "portal_show_subcontractors" : "portal_show_financials"} = ? WHERE id = ?`).run(on, clientId);
      await logClientEvent("settings_changed", { clientId, detail: `${flag === "subcontractors" ? "Show subcontractor names" : "Show financials"} ${on ? "on" : "off"} (${me.name})` });
    }
    refresh(clientId);
  });
}
