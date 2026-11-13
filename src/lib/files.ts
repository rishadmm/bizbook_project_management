import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { getCurrentUser } from "./session";
import type { Attachment, EntityType } from "./types";

export const UPLOAD_DIR = process.env.OPS_UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

/**
 * Saves a File to uploads/ and inserts an attachments row. Returns the row.
 * `uploadedBy`: undefined = current user, null = anonymous (portal).
 */
export async function saveUpload(
  file: File, entityType: EntityType, entityId: number, category: string | null = null,
  opts: { note?: string | null; uploadedBy?: number | null } = {},
): Promise<Attachment> {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
  const stored = `${Date.now()}-${nanoid(8)}-${safe}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));
  const uid = opts.uploadedBy === undefined ? (await getCurrentUser()).id || null : opts.uploadedBy;
  const db = getDb();
  const r = db
    .prepare("INSERT INTO attachments(entity_type, entity_id, category, filename, stored_path, mime, size, uploaded_by, note) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(entityType, entityId, category, file.name, stored, file.type || null, file.size, uid, opts.note ?? null);
  return db.prepare("SELECT * FROM attachments WHERE id = ?").get(r.lastInsertRowid) as Attachment;
}

/** Saves every non-empty File found under `fieldName` in a FormData; returns the rows. */
export async function saveUploadsFromForm(
  form: FormData, fieldName: string, entityType: EntityType, entityId: number, category: string | null = null,
  opts: { uploadedBy?: number | null } = {},
): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of form.getAll(fieldName)) {
    if (f instanceof File && f.size > 0) out.push(await saveUpload(f, entityType, entityId, category, opts));
  }
  return out;
}

export function listAttachments(entityType: EntityType, entityId: number): (Attachment & { uploader_name: string | null })[] {
  return getDb()
    .prepare(
      `SELECT a.*, u.name AS uploader_name FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC`,
    )
    .all(entityType, entityId) as (Attachment & { uploader_name: string | null })[];
}

export function deleteAttachmentFile(a: Attachment): void {
  try { fs.unlinkSync(path.join(UPLOAD_DIR, a.stored_path)); } catch { /* already gone */ }
}
