"use server";
// Internal registration review (A5). Permission `subcontractors/approve` (decisions) and `subcontractors/setup` (categories, document types);
// every action checks the country of the supplier against the user's countries.
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { isAdminUser, requirePermission } from "@/lib/auth";
import { assertUserEntity } from "@/lib/entity-context";
import { entityOfSubcontractor } from "@/lib/entities";
import { requestOrigin } from "@/lib/portal-auth";
import { guard, type ActionResult } from "@/lib/action-result";
import { hasOpenRequest, submitForApproval } from "@/lib/approvals/engine";
import { addDays, todayISO } from "@/lib/format";
import { CATEGORY_GROUPS } from "@/lib/registration";
import { getCategories, getSub, referBack, reject, reopen, setItemVerdict, startReview, type ApprovalPayload } from "./core";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const done = (id: number) => { revalidatePath(`/subcontractors/${id}/registration`); revalidatePath(`/subcontractors/${id}`); revalidatePath("/subcontractors/registrations"); revalidatePath("/approvals"); revalidatePath("/", "layout"); };

async function reviewer(f: FormData) {
  const me = await requirePermission("subcontractors", "approve");
  const id = Number(f.get("id"));
  if (!id || !getSub(getDb(), id)) throw new Error("Supplier not found.");
  assertUserEntity(me, entityOfSubcontractor(id), "Supplier");
  return { me, id };
}

export async function startRegistrationReview(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, id } = await reviewer(f); startReview(getDb(), id, me.id); done(id); });
}

/** Accept / Query a section (kind=section, ref=section key) or a document (kind=document, ref=document type code). */
export async function setRegistrationItem(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, id } = await reviewer(f);
    const kind = str(f, "kind") === "document" ? "document" : "section";
    const verdict = str(f, "verdict");
    if (!["accepted", "query", "clear"].includes(verdict)) throw new Error("Unknown verdict.");
    setItemVerdict(getDb(), id, me.id, kind, str(f, "ref"), verdict as "accepted" | "query" | "clear", str(f, "comment") || null);
    done(id);
  });
}

export async function referBackRegistration(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, id } = await reviewer(f); referBack(getDb(), id, me.id, str(f, "note") || null, { baseUrl: await requestOrigin() }); done(id); return "Referred back to the supplier."; });
}

/**
 * Approve: chosen categories (a subset of the requested ones), prequalification grade and validity. When an approval workflow applies, the request goes
 * to the engine and the registration stays under review ("Awaiting approval"); `onApproved` (approvals/registry.ts) finishes it. Without a workflow it approves at once.
 */
export async function approveRegistration(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, id } = await reviewer(f);
    const db = getDb();
    const s = getSub(db, id)!;
    if (s.registration_status !== "under_review") throw new Error("Start the review before approving.");
    const requested = new Set(getCategories(db, id).filter((c) => c.status !== "declined").map((c) => c.category_id));
    const cats = f.getAll("category").map(Number).filter((n) => requested.has(n));
    if (!cats.length) throw new Error("Approve at least one of the requested categories.");
    const grade = str(f, "grade");
    if (!["A", "B", "C"].includes(grade)) throw new Error("Choose the prequalification grade.");
    const valid = str(f, "valid_until") || addDays(todayISO(), 365);
    if (valid <= todayISO()) throw new Error("The validity date must be in the future.");
    if (hasOpenRequest("subcontractor_onboarding", id)) throw new Error("This registration is already awaiting approval.");
    // approval handlers run without a request: the origin for the mail links travels in the payload
    const payload: ApprovalPayload = { registration: true, categories: cats, grade: grade as "A" | "B" | "C", valid_until: valid, note: str(f, "note") || null, base_url: await requestOrigin() };
    const r = submitForApproval("subcontractor_onboarding", id, { userId: me.id, payload: payload as unknown as Record<string, unknown>, note: payload.note });
    done(id);
    return r.status === "auto_approved" ? "Registration approved." : "Submitted for approval. The registration stays under review until it is approved.";
  });
}

export async function rejectRegistration(f: FormData): Promise<ActionResult> {
  return guard(async () => { const { me, id } = await reviewer(f); reject(getDb(), id, me.id, str(f, "reason"), { baseUrl: await requestOrigin() }); done(id); return "Registration rejected."; });
}

/** Administrators only: a rejected registration is reopened (referred back) so that the supplier can correct and resubmit. */
export async function reopenRegistration(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const { me, id } = await reviewer(f);
    if (!isAdminUser(me)) throw new Error("Only an administrator can reopen a rejected registration.");
    reopen(getDb(), id, me.id, str(f, "note") || null);
    done(id);
  });
}

/* ------------------------------------------------------------------ setup (subcontractors/setup) */

export async function saveSupplierCategory(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("subcontractors", "setup");
    const id = Number(f.get("id")) || 0, name = str(f, "name"), code = str(f, "code").toLowerCase().replace(/[^a-z0-9-]+/g, "-"), group = str(f, "group_name");
    if (name.length < 3) throw new Error("Enter the category name.");
    if (!CATEGORY_GROUPS.includes(group)) throw new Error("Choose a group.");
    const db = getDb();
    const active = f.get("active") === "on" ? 1 : 0;
    const scope = str(f, "scope"); // "all" or the active country (set by the form)
    const entityId = scope === "all" ? null : me.entityIds.includes(Number(scope)) ? Number(scope) : null;
    if (id) {
      const r = db.prepare("UPDATE supplier_categories SET name = ?, group_name = ?, active = ? WHERE id = ?").run(name, group, active, id);
      if (!r.changes) throw new Error("Category not found.");
    } else {
      if (code.length < 3) throw new Error("Enter a short code (letters and digits).");
      if (db.prepare("SELECT 1 FROM supplier_categories WHERE COALESCE(entity_id, 0) = COALESCE(?, 0) AND code = ?").get(entityId, code)) throw new Error("That code already exists.");
      const sort = ((db.prepare("SELECT MAX(sort) m FROM supplier_categories").get() as { m: number | null }).m ?? 0) + 1;
      db.prepare("INSERT INTO supplier_categories(entity_id, code, name, group_name, active, sort) VALUES (?,?,?,?,?,?)").run(entityId, code, name, group, active, sort);
    }
    revalidatePath("/subcontractors/categories");
  });
}

export async function saveRegDocType(f: FormData): Promise<ActionResult> {
  return guard(async () => {
    const me = await requirePermission("subcontractors", "setup");
    const entityId = Number(f.get("entity_id"));
    if (!me.entityIds.includes(entityId)) throw new Error("You cannot edit another country's document types.");
    const id = Number(f.get("id")) || 0, name = str(f, "name"), code = str(f, "code").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (name.length < 3) throw new Error("Enter the document name.");
    const cond = str(f, "condition_group");
    const condition = cond && CATEGORY_GROUPS.includes(cond) ? `group:${cond}` : null;
    const mandatory = f.get("mandatory") === "on" ? 1 : 0, needsExpiry = f.get("needs_expiry") === "on" ? 1 : 0, active = f.get("active") === "on" ? 1 : 0;
    const db = getDb();
    if (id) {
      const r = db.prepare("UPDATE registration_doc_types SET name = ?, mandatory = ?, needs_expiry = ?, category_condition = ?, active = ? WHERE id = ? AND entity_id = ?").run(name, mandatory, needsExpiry, condition, active, id, entityId);
      if (!r.changes) throw new Error("Document type not found.");
    } else {
      if (code.length < 3) throw new Error("Enter a short code (letters, digits, underscore).");
      if (db.prepare("SELECT 1 FROM registration_doc_types WHERE entity_id = ? AND code = ?").get(entityId, code)) throw new Error("That code already exists.");
      const sort = ((db.prepare("SELECT MAX(sort) m FROM registration_doc_types WHERE entity_id = ?").get(entityId) as { m: number | null }).m ?? 0) + 1;
      db.prepare("INSERT INTO registration_doc_types(entity_id, code, name, mandatory, needs_expiry, category_condition, sort, active) VALUES (?,?,?,?,?,?,?,?)").run(entityId, code, name, mandatory, needsExpiry, condition, sort, active);
    }
    revalidatePath("/subcontractors/document-types");
  });
}
