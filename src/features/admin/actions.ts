"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { logAuthEvent, requirePermission, revokeSessions, nowIso, type AuthUser } from "@/lib/auth";
import { generateTempPassword, hashPassword } from "@/lib/password";
import { MODULES, MODULE_KEYS, isValidPermission, passwordPolicyError } from "@/lib/permissions";

export type AdminState = { error?: string; ok?: string; tempPassword?: string; email?: string } | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const intOrNull = (f: FormData, k: string) => { const n = Number(f.get(k)); return Number.isInteger(n) && n > 0 ? n : null; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RoleRef = { id: number; code: string; name: string; is_system: number };
const roleById = (id: number | null) => (id ? (getDb().prepare("SELECT * FROM roles WHERE id = ?").get(id) as RoleRef | undefined) : undefined);
type Target = { id: number; name: string; email: string | null; status: string; role_id: number | null; role_code: string | null };
const target = (id: number) => getDb().prepare("SELECT u.id, u.name, u.email, u.status, u.role_id, r.code AS role_code FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(id) as Target | undefined;
const activeSuperAdmins = () => (getDb().prepare("SELECT COUNT(*) c FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'super_admin' AND u.status != 'disabled'").get() as { c: number }).c;

/** Only a super admin may touch super admin accounts or hand out the super_admin role. */
function guardSuper(me: AuthUser, t: Target | undefined, newRole?: RoleRef) {
  if (t?.role_code === "super_admin" && !me.isSuperAdmin) throw new Error("Only a super admin can change a super admin account.");
  if (newRole?.code === "super_admin" && !me.isSuperAdmin) throw new Error("Only a super admin can assign the super admin role.");
}

/** Country access from the user form: `entity_ids` (multi) + `default_entity_id`. No selection = the first country; the default must be one of the selected countries. */
function parseEntityAccess(form: FormData): { ids: number[]; def: number } {
  const all = (getDb().prepare("SELECT id FROM entities WHERE status = 'active' ORDER BY sort_order, id").all() as { id: number }[]).map((e) => e.id);
  let ids = form.getAll("entity_ids").map((v) => Number(v)).filter((n) => all.includes(n));
  if (!ids.length) ids = [all[0]];
  const d = intOrNull(form, "default_entity_id");
  return { ids, def: d && ids.includes(d) ? d : ids[0] };
}
function saveEntityAccess(userId: number, a: { ids: number[]; def: number }) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM user_entities WHERE user_id = ?").run(userId);
    for (const e of a.ids) db.prepare("INSERT INTO user_entities(user_id, entity_id) VALUES (?,?)").run(userId, e);
    db.prepare("UPDATE users SET default_entity_id = ? WHERE id = ?").run(a.def, userId);
  })();
}

/* ------------------------------------------------------------------ users */

export async function createUserAction(_p: AdminState, form: FormData): Promise<AdminState> {
  const me = await requirePermission("users", "create");
  const name = str(form, "name"); const email = str(form, "email").toLowerCase();
  if (!name) return { error: "Name is required." };
  if (!EMAIL.test(email)) return { error: "A valid email is required (it is the login id)." };
  const role = roleById(intOrNull(form, "role_id"));
  if (!role) return { error: "Choose a role." };
  try { guardSuper(me, undefined, role); } catch (e) { return { error: (e as Error).message }; }
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE lower(email) = ?").get(email)) return { error: "A user with this email already exists." };
  let pw = String(form.get("password") ?? "");
  const temp = form.get("generate") === "on" || !pw;
  if (temp) pw = generateTempPassword(); else { const pe = passwordPolicyError(pw); if (pe) return { error: pe }; }
  const mustChange = temp || form.get("must_change") === "on" ? 1 : 0;
  const r = db.prepare(
    `INSERT INTO users(name, email, department_id, role, role_id, job_title, phone, manager_id, password_hash, must_change_password, status, password_changed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?)`,
  ).run(name, email, intOrNull(form, "department_id"), role.code, role.id, str(form, "job_title") || null, str(form, "phone") || null, intOrNull(form, "manager_id"), hashPassword(pw), mustChange, nowIso());
  saveEntityAccess(Number(r.lastInsertRowid), parseEntityAccess(form));
  await logAuthEvent("user_created", { userId: Number(r.lastInsertRowid), email, detail: `by ${me.email}; role ${role.code}` });
  revalidatePath("/admin/users");
  return { ok: `User ${name} created.`, tempPassword: pw, email };
}

export async function updateUserAction(_p: AdminState, form: FormData): Promise<AdminState> {
  const me = await requirePermission("users", "edit");
  const id = Number(form.get("id"));
  const t = target(id);
  if (!t) return { error: "User not found." };
  const name = str(form, "name"); const email = str(form, "email").toLowerCase();
  if (!name) return { error: "Name is required." };
  if (!EMAIL.test(email)) return { error: "A valid email is required." };
  const role = roleById(intOrNull(form, "role_id"));
  if (!role) return { error: "Choose a role." };
  try { guardSuper(me, t, role); } catch (e) { return { error: (e as Error).message }; }
  const db = getDb();
  if (db.prepare("SELECT 1 FROM users WHERE lower(email) = ? AND id != ?").get(email, id)) return { error: "Another user already has this email." };
  if (t.role_code === "super_admin" && role.code !== "super_admin" && activeSuperAdmins() <= 1) return { error: "Cannot remove the last super admin." };
  const mgr = intOrNull(form, "manager_id");
  if (mgr === id) return { error: "A user cannot be their own manager." };
  db.prepare("UPDATE users SET name=?, email=?, department_id=?, role=?, role_id=?, job_title=?, phone=?, manager_id=? WHERE id=?")
    .run(name, email, intOrNull(form, "department_id"), role.code, role.id, str(form, "job_title") || null, str(form, "phone") || null, mgr, id);
  saveEntityAccess(id, parseEntityAccess(form));
  await logAuthEvent(role.id !== t.role_id ? "role_changed" : "user_updated", { userId: id, email, detail: `by ${me.email}${role.id !== t.role_id ? `; role ${t.role_code} -> ${role.code}` : ""}` });
  revalidatePath("/admin/users"); revalidatePath(`/admin/users/${id}`);
  return { ok: "User saved." };
}

/** Disable / enable / unlock a user (form fields: id, op). */
export async function setUserStatus(form: FormData): Promise<void> {
  const me = await requirePermission("users", "disable");
  const id = Number(form.get("id")); const op = str(form, "op");
  const t = target(id);
  if (!t) throw new Error("User not found");
  guardSuper(me, t);
  const db = getDb();
  if (op === "disable") {
    if (id === me.id) throw new Error("You cannot disable your own account.");
    if (t.role_code === "super_admin" && activeSuperAdmins() <= 1) throw new Error("Cannot disable the last super admin.");
    db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(id);
    revokeSessions(id);
    await logAuthEvent("user_disabled", { userId: id, email: t.email, detail: `by ${me.email}` });
  } else if (op === "enable" || op === "unlock") {
    db.prepare("UPDATE users SET status='active', failed_attempts=0, locked_until=NULL WHERE id=?").run(id);
    await logAuthEvent(op === "enable" ? "user_enabled" : "user_unlocked", { userId: id, email: t.email, detail: `by ${me.email}` });
  } else throw new Error("Unknown operation");
  revalidatePath("/admin/users"); revalidatePath(`/admin/users/${id}`);
}

export async function resetPasswordAction(_p: AdminState, form: FormData): Promise<AdminState> {
  const me = await requirePermission("users", "reset_password");
  const id = Number(form.get("id"));
  const t = target(id);
  if (!t) return { error: "User not found." };
  try { guardSuper(me, t); } catch (e) { return { error: (e as Error).message }; }
  const pw = generateTempPassword();
  getDb().prepare("UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL, status = CASE WHEN status='locked' THEN 'active' ELSE status END, password_changed_at=? WHERE id=?")
    .run(hashPassword(pw), nowIso(), id);
  revokeSessions(id);
  await logAuthEvent("password_reset", { userId: id, email: t.email, detail: `by ${me.email}` });
  revalidatePath(`/admin/users/${id}`);
  return { ok: "Temporary password generated. Share it securely; it is shown only once.", tempPassword: pw, email: t.email ?? "" };
}

export async function revokeUserSessions(form: FormData): Promise<void> {
  const me = await requirePermission("users", "edit");
  const id = Number(form.get("id"));
  const t = target(id);
  if (!t) throw new Error("User not found");
  guardSuper(me, t);
  const sid = Number(form.get("session_id")) || 0;
  const db = getDb();
  const n = sid
    ? db.prepare("UPDATE sessions SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL").run(nowIso(), sid, id).changes
    : revokeSessions(id);
  if (n) await logAuthEvent("session_revoked", { userId: id, email: t.email, detail: `${n} session(s) revoked by ${me.email}` });
  revalidatePath(`/admin/users/${id}`);
}

/** Replaces all per-user overrides. Form: id, overrides = JSON {"module:action": "allow"|"deny"}. */
export async function saveUserOverrides(form: FormData): Promise<void> {
  const me = await requirePermission("users", "edit");
  const id = Number(form.get("id"));
  const t = target(id);
  if (!t) throw new Error("User not found");
  guardSuper(me, t);
  if (t.role_code === "super_admin") throw new Error("Super admin permissions cannot be overridden.");
  if (id === me.id && !me.isSuperAdmin) throw new Error("You cannot change your own access.");
  let parsed: Record<string, string>;
  try { parsed = JSON.parse(str(form, "overrides") || "{}"); } catch { throw new Error("Invalid overrides"); }
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ?").run(id);
    const ins = db.prepare("INSERT INTO user_permission_overrides(user_id, module, action, effect) VALUES (?,?,?,?)");
    for (const [k, effect] of Object.entries(parsed)) {
      const [m, a] = k.split(":");
      if (!isValidPermission(m, a) || (effect !== "allow" && effect !== "deny")) throw new Error(`Invalid permission ${k}`);
      ins.run(id, m, a, effect);
    }
  })();
  await logAuthEvent("permissions_changed", { userId: id, email: t.email, detail: `${Object.keys(parsed).length} override(s) set by ${me.email}` });
  revalidatePath(`/admin/users/${id}`);
}

/* ------------------------------------------------------------------ roles */

const allPermissionPairs = (): [string, string][] => MODULE_KEYS.flatMap((m) => MODULES[m].actions.map((a): [string, string] => [m, a]));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export async function createRoleAction(_p: AdminState, form: FormData): Promise<AdminState> {
  const me = await requirePermission("roles", "edit");
  const name = str(form, "name");
  if (!name) return { error: "Role name is required." };
  const code = slug(name);
  if (!code) return { error: "Role name must contain letters or digits." };
  const db = getDb();
  if (db.prepare("SELECT 1 FROM roles WHERE code = ? OR lower(name) = lower(?)").get(code, name)) return { error: "A role with this name already exists." };
  const from = intOrNull(form, "clone_from");
  const id = db.transaction(() => {
    const r = db.prepare("INSERT INTO roles(code, name, description, is_system) VALUES (?,?,?,0)").run(code, name, str(form, "description") || null);
    const rid = Number(r.lastInsertRowid);
    if (from) {
      const src = roleById(from);
      if (src?.code === "super_admin") for (const [m, a] of (allPermissionPairs())) db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, module, action) VALUES (?,?,?)").run(rid, m, a);
      else db.prepare("INSERT INTO role_permissions(role_id, module, action) SELECT ?, module, action FROM role_permissions WHERE role_id = ?").run(rid, from);
    } else {
      db.prepare("INSERT INTO role_permissions(role_id, module, action) VALUES (?,?,?)").run(rid, "dashboard", "view");
      db.prepare("INSERT INTO role_permissions(role_id, module, action) VALUES (?,?,?)").run(rid, "approvals", "view");
    }
    return rid;
  })();
  await logAuthEvent("role_changed", { detail: `role ${code} created by ${me.email}` });
  revalidatePath("/admin/roles");
  redirect(`/admin/roles/${id}`);
}

/** Matrix editor submit. Form: id, name?, description?, perm (repeated "module:action"). */
export async function saveRoleAction(form: FormData): Promise<void> {
  const me = await requirePermission("roles", "edit");
  const id = Number(form.get("id"));
  const role = roleById(id);
  if (!role) throw new Error("Role not found");
  if (role.code === "super_admin") throw new Error("The super admin role cannot be edited.");
  const perms = form.getAll("perm").map(String);
  for (const k of perms) { const [m, a] = k.split(":"); if (!isValidPermission(m, a)) throw new Error(`Invalid permission ${k}`); }
  const db = getDb();
  db.transaction(() => {
    if (!role.is_system) {
      const name = str(form, "name");
      if (name) db.prepare("UPDATE roles SET name=?, description=? WHERE id=?").run(name, str(form, "description") || null, id);
    }
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(id);
    const ins = db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, module, action) VALUES (?,?,?)");
    for (const k of new Set(perms)) { const [m, a] = k.split(":"); ins.run(id, m, a); }
  })();
  await logAuthEvent("permissions_changed", { detail: `role ${role.code}: ${new Set(perms).size} permission(s) saved by ${me.email}` });
  revalidatePath("/admin/roles"); revalidatePath(`/admin/roles/${id}`); revalidatePath("/", "layout");
}

export async function deleteRoleAction(form: FormData): Promise<void> {
  const me = await requirePermission("roles", "edit");
  const id = Number(form.get("id"));
  const role = roleById(id);
  if (!role) throw new Error("Role not found");
  if (role.is_system) throw new Error("System roles cannot be deleted.");
  const used = (getDb().prepare("SELECT COUNT(*) c FROM users WHERE role_id = ?").get(id) as { c: number }).c;
  if (used > 0) throw new Error("Reassign the users of this role before deleting it.");
  getDb().prepare("DELETE FROM roles WHERE id = ?").run(id);
  await logAuthEvent("role_changed", { detail: `role ${role.code} deleted by ${me.email}` });
  revalidatePath("/admin/roles");
  redirect("/admin/roles");
}
