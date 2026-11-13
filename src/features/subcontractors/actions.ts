"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { saveUpload } from "@/lib/files";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_ONBOARDING_ITEMS, ENUMS } from "@/lib/status";
import { requirePermission } from "@/lib/auth";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const SUB_STATUSES = Object.keys(ENUMS.subcontractorStatus);
const DOC_TYPES = Object.keys(ENUMS.docType);
const DOC_STATUSES = Object.keys(ENUMS.docStatus);

function profileFields(form: FormData) {
  const name = str(form, "name");
  if (!name) throw new Error("Name is required");
  const rating = form.get("rating") ? Number(form.get("rating")) : null;
  if (rating !== null && (Number.isNaN(rating) || rating < 0 || rating > 5)) throw new Error("Rating must be between 0 and 5");
  return {
    name, trade: opt(form, "trade"), categories: opt(form, "categories"), contact_person: opt(form, "contact_person"),
    email: opt(form, "email"), phone: opt(form, "phone"), address: opt(form, "address"),
    trade_license_no: opt(form, "trade_license_no"), trade_license_expiry: opt(form, "trade_license_expiry"),
    tax_no: opt(form, "tax_no"), bank_name: opt(form, "bank_name"), iban: opt(form, "iban"), rating, notes: opt(form, "notes"),
  };
}

export async function createSubcontractor(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "create");
  const f = profileFields(form);
  const db = getDb();
  const id = db.transaction(() => {
    const max = (db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(code, 5) AS INTEGER)),0) m FROM subcontractors WHERE code LIKE 'SUB-%'").get() as { m: number }).m;
    const code = `SUB-${String(max + 1).padStart(3, "0")}`;
    const r = db.prepare(`INSERT INTO subcontractors(code, name, trade, categories, contact_person, email, phone, address, trade_license_no, trade_license_expiry, tax_no, bank_name, iban, status, rating, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, f.name, f.trade, f.categories, f.contact_person, f.email, f.phone, f.address,
      f.trade_license_no, f.trade_license_expiry, f.tax_no, f.bank_name, f.iban, "onboarding", f.rating, f.notes);
    const sid = Number(r.lastInsertRowid);
    const ins = db.prepare("INSERT INTO onboarding_checklist(subcontractor_id, item, done) VALUES (?,?,0)");
    for (const item of DEFAULT_ONBOARDING_ITEMS) ins.run(sid, item);
    return sid;
  })();
  await logActivity("subcontractor", id, "created", `Subcontractor ${f.name} created (onboarding started)`);
  revalidatePath("/subcontractors");
  redirect(`/subcontractors/${id}?tab=onboarding`);
}

export async function updateSubcontractor(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const id = Number(form.get("id"));
  if (!id) throw new Error("Missing id");
  const f = profileFields(form);
  getDb().prepare(`UPDATE subcontractors SET name=?, trade=?, categories=?, contact_person=?, email=?, phone=?, address=?, trade_license_no=?,
    trade_license_expiry=?, tax_no=?, bank_name=?, iban=?, rating=?, notes=? WHERE id=?`).run(f.name, f.trade, f.categories, f.contact_person, f.email,
    f.phone, f.address, f.trade_license_no, f.trade_license_expiry, f.tax_no, f.bank_name, f.iban, f.rating, f.notes, id);
  await logActivity("subcontractor", id, "updated", "Profile updated");
  revalidatePath(`/subcontractors/${id}`); revalidatePath("/subcontractors");
}

export async function setSubcontractorStatus(form: FormData): Promise<void> {
  const id = Number(form.get("id")); const status = str(form, "status");
  if (!id || !SUB_STATUSES.includes(status)) throw new Error("Invalid status");
  await requirePermission("subcontractors", status === "approved" ? "approve" : "edit");
  if (status === "approved") {
    const open = (getDb().prepare("SELECT COUNT(*) c FROM onboarding_checklist WHERE subcontractor_id = ? AND done = 0").get(id) as { c: number }).c;
    if (open > 0) throw new Error("Complete the onboarding checklist first");
  }
  getDb().prepare("UPDATE subcontractors SET status = ? WHERE id = ?").run(status, id);
  await logActivity("subcontractor", id, "status", `Status set to ${status}`);
  revalidatePath(`/subcontractors/${id}`); revalidatePath("/subcontractors"); revalidatePath("/");
}

export async function toggleChecklistItem(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const itemId = Number(form.get("item_id")); const sid = Number(form.get("id"));
  const db = getDb();
  const it = db.prepare("SELECT * FROM onboarding_checklist WHERE id = ? AND subcontractor_id = ?").get(itemId, sid) as { done: number; item: string } | undefined;
  if (!it) throw new Error("Checklist item not found");
  const me = await getCurrentUser();
  if (it.done) db.prepare("UPDATE onboarding_checklist SET done=0, done_by=NULL, done_at=NULL WHERE id=?").run(itemId);
  else db.prepare("UPDATE onboarding_checklist SET done=1, done_by=?, done_at=CURRENT_TIMESTAMP WHERE id=?").run(me.id || null, itemId);
  await logActivity("subcontractor", sid, "checklist", `${it.done ? "Reopened" : "Completed"}: ${it.item}`);
  revalidatePath(`/subcontractors/${sid}`);
}

export async function approveSubcontractor(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "approve");
  form.set("status", "approved");
  await setSubcontractorStatus(form);
}

export async function saveDocument(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const id = Number(form.get("id")) || 0;
  const sid = Number(form.get("subcontractor_id"));
  const docType = str(form, "doc_type"); const status = str(form, "status") || "pending";
  if (!sid) throw new Error("Missing subcontractor");
  if (!DOC_TYPES.includes(docType)) throw new Error("Invalid document type");
  if (!DOC_STATUSES.includes(status)) throw new Error("Invalid status");
  const db = getDb();
  let attachmentId: number | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) attachmentId = (await saveUpload(file, "subcontractor", sid, docType)).id;
  if (id) {
    const ex = db.prepare("SELECT id FROM subcontractor_documents WHERE id=? AND subcontractor_id=?").get(id, sid);
    if (!ex) throw new Error("Document not found");
    db.prepare("UPDATE subcontractor_documents SET doc_type=?, ref_no=?, issue_date=?, expiry_date=?, status=?, attachment_id=COALESCE(?, attachment_id) WHERE id=?")
      .run(docType, opt(form, "ref_no"), opt(form, "issue_date"), opt(form, "expiry_date"), status, attachmentId, id);
  } else {
    db.prepare("INSERT INTO subcontractor_documents(subcontractor_id, doc_type, ref_no, issue_date, expiry_date, attachment_id, status) VALUES (?,?,?,?,?,?,?)")
      .run(sid, docType, opt(form, "ref_no"), opt(form, "issue_date"), opt(form, "expiry_date"), attachmentId, status);
  }
  await logActivity("subcontractor", sid, "document", `${id ? "Updated" : "Added"} document ${docType}`);
  revalidatePath(`/subcontractors/${sid}`); revalidatePath("/subcontractors"); revalidatePath("/");
}

export async function verifyDocument(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const id = Number(form.get("id")); const sid = Number(form.get("subcontractor_id"));
  const r = getDb().prepare("UPDATE subcontractor_documents SET status='verified' WHERE id=? AND subcontractor_id=?").run(id, sid);
  if (!r.changes) throw new Error("Document not found");
  await logActivity("subcontractor", sid, "document", "Document verified");
  revalidatePath(`/subcontractors/${sid}`); revalidatePath("/");
}

export async function deleteDocument(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const id = Number(form.get("id")); const sid = Number(form.get("subcontractor_id"));
  getDb().prepare("DELETE FROM subcontractor_documents WHERE id=? AND subcontractor_id=?").run(id, sid);
  await logActivity("subcontractor", sid, "document", "Document deleted");
  revalidatePath(`/subcontractors/${sid}`); revalidatePath("/subcontractors"); revalidatePath("/");
}
