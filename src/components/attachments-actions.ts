"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { deleteAttachmentFile, saveUploadsFromForm } from "@/lib/files";
import { logActivity } from "@/lib/activity";
import { requirePermission } from "@/lib/auth";
import { assertUserEntity } from "@/lib/entity-context";
import { entityOfAttachmentOwner } from "@/lib/entities";
import type { ModuleKey } from "@/lib/permissions";
import type { Attachment, EntityType } from "@/lib/types";

/** Which permission is needed to add/remove files on each kind of record. */
const ENTITY_PERMISSION: Record<EntityType, [ModuleKey, string]> = {
  tender: ["tenders", "edit"], revision: ["tenders", "edit"], project: ["projects", "edit"], stage: ["projects", "edit"],
  subcontractor: ["subcontractors", "edit"], assignment: ["subcontractors", "edit"], progress: ["progress", "create"],
  invoice: ["invoices", "certify"], sub_invoice: ["invoices", "certify"], certificate: ["certificates", "issue"], loss: ["lost_analysis", "edit"], issue: ["projects", "edit"],
  rfx: ["procurement", "edit"], rfx_bid: ["procurement", "edit"],
};
async function guard(entityType: EntityType, entityId?: number) {
  const p = ENTITY_PERMISSION[entityType];
  if (!p) throw new Error("Unknown entity");
  const user = await requirePermission(p[0], p[1]);
  if (entityId) assertUserEntity(user, entityOfAttachmentOwner(entityType, entityId), "Record"); // country access
}

/** Server action for AttachmentsPanel: fields entityType, entityId, category, note, revalidate, files (multiple). */
export async function uploadAttachments(form: FormData): Promise<void> {
  const entityType = String(form.get("entityType")) as EntityType;
  const entityId = Number(form.get("entityId"));
  await guard(entityType, entityId);
  if (!entityType || !entityId) throw new Error("Missing entity");
  const category = String(form.get("category") ?? "") || null;
  const rows = await saveUploadsFromForm(form, "files", entityType, entityId, category);
  const note = String(form.get("note") ?? "").trim();
  if (note) for (const r of rows) getDb().prepare("UPDATE attachments SET note = ? WHERE id = ?").run(note, r.id);
  if (rows.length) await logActivity(entityType, entityId, "upload", `Uploaded ${rows.map((r) => r.filename).join(", ")}${category ? ` (${category})` : ""}`);
  const path = String(form.get("revalidate") ?? "");
  if (path) revalidatePath(path);
}

export async function deleteAttachment(form: FormData): Promise<void> {
  const id = Number(form.get("id"));
  const a = getDb().prepare("SELECT * FROM attachments WHERE id = ?").get(id) as Attachment | undefined;
  if (!a) return;
  await guard(a.entity_type, a.entity_id);
  getDb().prepare("DELETE FROM attachments WHERE id = ?").run(id);
  deleteAttachmentFile(a);
  await logActivity(a.entity_type, a.entity_id, "delete_file", `Deleted ${a.filename}`);
  const path = String(form.get("revalidate") ?? "");
  if (path) revalidatePath(path);
}
