"use server";
// Server actions of the login portal. EVERY action: requirePortalAction(perm) -> the company comes from the session, ids from the form are only
// accepted together with the company filter (getAssignment / getIssue ...). Refused in the read-only admin view.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { saveUpload, saveUploadsFromForm } from "@/lib/files";
import { generateTempPassword, hashPassword } from "@/lib/password";
import { logPortalEvent, requirePortalAction, revokePortalSessions } from "@/lib/portal-auth";
import { PORTAL_ROLES, insertPortalUser, isPortalRole } from "@/lib/portal-core";
import { ENUMS } from "@/lib/status";
import type { Project } from "@/lib/types";
import type { IssuedCredentials } from "../portal-admin/types";
import { canWorkOn, getAssignment, getIssue } from "./data";
import { PortalError, checkFiles, raiseIssueRow, saveCertificateRequest, saveInvoice, saveProgressReport, str, num } from "./core";

export type WorkState = { error?: string; ok?: string; credentials?: IssuedCredentials } | undefined;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Runs an action body: PortalError messages are shown to the user, anything unexpected is logged and reported generically. Redirects pass through. */
async function act(fn: () => Promise<WorkState | void>): Promise<WorkState> {
  try {
    return (await fn()) ?? { ok: "Saved." };
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    if (e instanceof PortalError) return { error: e.message };
    console.error("[portal action]", e);
    return { error: "Could not save. Please try again." };
  }
}

function projectOf(id: number): Project {
  const p = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  if (!p) throw new PortalError("Project not found");
  return p;
}
const refresh = (slug: string | null, ...paths: string[]) => { for (const p of paths) revalidatePath(`/p/${slug}${p}`); revalidatePath("/"); revalidatePath("/invoices"); };

/** New progress update, or correction + resubmission of a rejected one (`report_id`). */
export async function submitProgress(_prev: WorkState, form: FormData): Promise<WorkState> {
  let slug = "";
  const r = await act(async () => {
    const s = await requirePortalAction("progress_submit");
    slug = s.sub.portal_slug ?? "";
    const a = getAssignment(s, Number(form.get("assignment_id")));
    if (!a) throw new PortalError("Choose one of your subcontracts");
    if (!canWorkOn(a)) throw new PortalError("Progress can only be reported on an active subcontract");
    const resubmitId = Number(form.get("report_id")) || undefined;
    await saveProgressReport(form, a, projectOf(a.project_id), { name: s.user.name, userId: s.user.id }, { guardQty: true, resubmitId });
    refresh(slug, "", "/progress"); revalidatePath(`/projects/${a.project_id}`);
  });
  if (r?.error) return r;
  redirect(`/p/${slug}/progress?sent=${form.get("report_id") ? "resubmitted" : "submitted"}`);
}

export async function submitInvoice(_prev: WorkState, form: FormData): Promise<WorkState> {
  let slug = "", id = 0;
  const r = await act(async () => {
    const s = await requirePortalAction("invoices_submit");
    slug = s.sub.portal_slug ?? "";
    const a = getAssignment(s, Number(form.get("assignment_id")));
    if (!a) throw new PortalError("Choose one of your subcontracts");
    if (!canWorkOn(a)) throw new PortalError("Invoices can only be submitted for an active subcontract");
    id = await saveInvoice(form, a, projectOf(a.project_id), { name: str(form, "submitted_by_name") || s.user.name, email: str(form, "submitted_by_email") || s.user.email });
    refresh(slug, "", "/invoices", "/payments"); revalidatePath(`/projects/${a.project_id}`);
  });
  if (r?.error) return r;
  redirect(`/p/${slug}/invoices/${id}?sent=1`);
}

export async function requestCertificate(_prev: WorkState, form: FormData): Promise<WorkState> {
  let slug = "";
  const r = await act(async () => {
    const s = await requirePortalAction("certificates_request");
    slug = s.sub.portal_slug ?? "";
    const a = getAssignment(s, Number(form.get("assignment_id")));
    if (!a) throw new PortalError("Choose one of your subcontracts");
    await saveCertificateRequest(form, a, projectOf(a.project_id), { name: s.user.name, userId: s.user.id });
    refresh(slug, "/certificates");
  });
  if (r?.error) return r;
  redirect(`/p/${slug}/certificates?sent=1`);
}

export async function raisePortalIssue(_prev: WorkState, form: FormData): Promise<WorkState> {
  let slug = "", id = 0;
  const r = await act(async () => {
    const s = await requirePortalAction("issues_raise");
    slug = s.sub.portal_slug ?? "";
    checkFiles(form, "files");
    const a = getAssignment(s, Number(form.get("assignment_id")));
    if (!a) throw new PortalError("Choose one of your subcontracts");
    const title = str(form, "title");
    if (!title) throw new PortalError("A title is required");
    const kind = str(form, "kind") === "rfi" ? "rfi" : "issue";
    const resp = str(form, "responsibility") || "other";
    if (!Object.keys(ENUMS.responsibility).includes(resp)) throw new PortalError("Invalid responsibility");
    const days = num(form, "impact_days");
    if (days < 0) throw new PortalError("Impact days cannot be negative");
    id = raiseIssueRow({ projectId: a.project_id, stageId: a.stage_id, assignmentId: a.id, title, description: str(form, "description") || null, responsibility: resp, impactDays: days, kind,
      category: str(form, "category") || null, byName: s.user.name, byUserId: s.user.id });
    await saveUploadsFromForm(form, "files", "issue", id, "Portal", { uploadedBy: null });
    await logActivity("project", a.project_id, "issue", `${kind === "rfi" ? "RFI" : "Issue"} "${title}" raised via portal by ${s.user.name} (${a.code})`, null);
    refresh(slug, "/issues");
  });
  if (r?.error) return r;
  redirect(`/p/${slug}/issues/${id}`);
}

export async function postIssueComment(_prev: WorkState, form: FormData): Promise<WorkState> {
  return act(async () => {
    const s = await requirePortalAction("issues_raise");
    const issue = getIssue(s, Number(form.get("issue_id")));
    if (!issue) throw new PortalError("Issue not found");
    if (issue.status === "closed") throw new PortalError("This issue is closed");
    const body = str(form, "body");
    if (!body) throw new PortalError("Write a comment first");
    if (body.length > 4000) throw new PortalError("Comment is too long");
    const now = new Date().toISOString();
    getDb().prepare("INSERT INTO issue_comments(issue_id, author_type, author_id, author_name, body, created_at) VALUES (?,?,?,?,?,?)").run(issue.id, "portal", s.user.id, s.user.name, body, now);
    getDb().prepare("UPDATE issues SET awaiting_party = 'internal', last_activity_at = ? WHERE id = ?").run(now, issue.id);
    await logActivity("project", (getDb().prepare("SELECT project_id p FROM issues WHERE id = ?").get(issue.id) as { p: number }).p, "issue", `Portal comment by ${s.user.name} on "${issue.title}"`, null);
    refresh(s.sub.portal_slug, `/issues/${issue.id}`, "/issues", "");
    return { ok: "Comment posted." };
  });
}

const DOC_TYPES = Object.keys(ENUMS.docType);
/** Upload a new / renewed company document: goes to internal review (status pending_review). */
export async function uploadCompanyDocument(_prev: WorkState, form: FormData): Promise<WorkState> {
  return act(async () => {
    const s = await requirePortalAction("documents_upload");
    const type = str(form, "doc_type");
    if (!DOC_TYPES.includes(type)) throw new PortalError("Choose a document type");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new PortalError("Attach the document file");
    if (file.size > 15 * 1024 * 1024) throw new PortalError("Files must be smaller than 15 MB");
    const expiry = str(form, "expiry_date"), issue = str(form, "issue_date");
    for (const d of [expiry, issue]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new PortalError("Invalid date");
    const att = await saveUpload(file, "subcontractor", s.sub.id, type, { uploadedBy: null, note: `Uploaded via portal by ${s.user.name}` });
    getDb().prepare("INSERT INTO subcontractor_documents(subcontractor_id, doc_type, ref_no, issue_date, expiry_date, attachment_id, status, source, uploaded_by_name) VALUES (?,?,?,?,?,?,'pending_review','portal',?)")
      .run(s.sub.id, type, str(form, "ref_no") || null, issue || null, expiry || null, att.id, s.user.name);
    await logActivity("subcontractor", s.sub.id, "document", `Document ${type} uploaded via portal by ${s.user.name} (pending review)`, null);
    refresh(s.sub.portal_slug, "/documents", ""); revalidatePath(`/subcontractors/${s.sub.id}`);
    return { ok: "Document uploaded. It will be reviewed by the project team." };
  });
}

/** Request a change of bank or contact details (approved internally before it touches the subcontractor record). */
export async function requestProfileChange(_prev: WorkState, form: FormData): Promise<WorkState> {
  return act(async () => {
    const s = await requirePortalAction("request_change");
    const kind = str(form, "kind");
    let payload: Record<string, string>;
    if (kind === "bank") {
      const bank = str(form, "bank_name"), iban = str(form, "iban").replace(/\s+/g, "").toUpperCase();
      if (!bank || !iban) throw new PortalError("Bank name and IBAN are required");
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) throw new PortalError("The IBAN looks invalid");
      payload = { bank_name: bank, iban };
    } else if (kind === "contact") {
      payload = { contact_person: str(form, "contact_person"), email: str(form, "email"), phone: str(form, "phone"), address: str(form, "address") };
      if (payload.email && !EMAIL.test(payload.email)) throw new PortalError("Enter a valid e-mail address");
      if (!Object.values(payload).some(Boolean)) throw new PortalError("Enter at least one new value");
    } else throw new PortalError("Unknown change type");
    getDb().prepare("INSERT INTO portal_change_requests(subcontractor_id, requested_by, requested_by_name, kind, payload, reason, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)")
      .run(s.sub.id, s.user.id, s.user.name, kind, JSON.stringify(payload), str(form, "reason") || null, new Date().toISOString());
    await logActivity("subcontractor", s.sub.id, "portal", `${kind === "bank" ? "Bank" : "Contact"} details change requested via portal by ${s.user.name}`, null);
    refresh(s.sub.portal_slug, "/documents"); revalidatePath(`/subcontractors/${s.sub.id}`);
    return { ok: "Change request sent for approval." };
  });
}

/* ------------------------------------------------------------------ team (owner only) */
const TEAM_ROLES = PORTAL_ROLES.filter((r) => r.value !== "owner").map((r) => r.value);

export async function invitePortalUser(_prev: WorkState, form: FormData): Promise<WorkState> {
  return act(async () => {
    const s = await requirePortalAction("team");
    const name = str(form, "name"), email = str(form, "email").toLowerCase(), role = str(form, "portal_role");
    if (!name) throw new PortalError("Name is required");
    if (!EMAIL.test(email)) throw new PortalError("Enter a valid e-mail address");
    if (!isPortalRole(role) || !TEAM_ROLES.includes(role)) throw new PortalError("Choose a role");
    const db = getDb();
    if (db.prepare("SELECT 1 FROM portal_users WHERE subcontractor_id = ? AND lower(email) = ?").get(s.sub.id, email)) throw new PortalError("A user with this e-mail already exists");
    const password = generateTempPassword();
    const id = insertPortalUser(db, { subcontractorId: s.sub.id, name, email, phone: str(form, "phone") || null, jobTitle: str(form, "job_title") || null, role, password, mustChange: true, createdByPortalUser: s.user.id });
    await logPortalEvent("user_created", { subId: s.sub.id, userId: id, email, detail: `Invited by ${s.user.name} (${role})` });
    refresh(s.sub.portal_slug, "/team"); revalidatePath(`/subcontractors/${s.sub.id}`);
    return { ok: "User created.", credentials: { name, email, password, slug: s.sub.portal_slug ?? "" } };
  });
}

function teamUser(subId: number, id: number) {
  const u = getDb().prepare("SELECT id, name, email, portal_role, status FROM portal_users WHERE id = ? AND subcontractor_id = ?").get(id, subId) as { id: number; name: string; email: string; portal_role: string; status: string } | undefined;
  if (!u) throw new PortalError("User not found");
  return u;
}
export async function resetTeamPassword(_prev: WorkState, form: FormData): Promise<WorkState> {
  return act(async () => {
    const s = await requirePortalAction("team");
    const u = teamUser(s.sub.id, Number(form.get("user_id")));
    if (u.portal_role === "owner") throw new PortalError("Owner passwords are reset by your project contact.");
    const password = generateTempPassword();
    getDb().prepare("UPDATE portal_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, password_changed_at = NULL WHERE id = ?").run(hashPassword(password), u.id);
    revokePortalSessions(u.id);
    await logPortalEvent("password_reset", { subId: s.sub.id, userId: u.id, email: u.email, detail: `Temporary password issued by ${s.user.name}` });
    refresh(s.sub.portal_slug, "/team");
    return { ok: "Temporary password issued.", credentials: { name: u.name, email: u.email, password, slug: s.sub.portal_slug ?? "" } };
  });
}
export async function setTeamUserStatus(form: FormData): Promise<void> {
  const s = await requirePortalAction("team");
  const u = teamUser(s.sub.id, Number(form.get("user_id")));
  if (u.id === s.user.id) throw new PortalError("You cannot disable your own account.");
  if (u.portal_role === "owner") throw new PortalError("An owner can only be disabled by your project contact.");
  const enable = str(form, "enable") === "1";
  getDb().prepare("UPDATE portal_users SET status = ? WHERE id = ?").run(enable ? "active" : "disabled", u.id);
  if (!enable) revokePortalSessions(u.id);
  await logPortalEvent(enable ? "user_enabled" : "user_disabled", { subId: s.sub.id, userId: u.id, email: u.email, detail: `By ${s.user.name} (portal owner)` });
  refresh(s.sub.portal_slug, "/team"); revalidatePath(`/subcontractors/${s.sub.id}`);
}
