"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { ENUMS } from "@/lib/status";
import { getActiveEntity, requirePermission } from "@/lib/auth";
import { assertUserEntity } from "@/lib/entity-context";
import { entityOfClient } from "@/lib/entities";
import { guard, type ActionResult as FormResult } from "@/lib/action-result";

const str = (f: FormData, k: string): string | null => String(f.get(k) ?? "").trim() || null;

export async function saveClient(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const id = Number(form.get("id")) || 0;
    const me = await requirePermission("clients", id ? "edit" : "create");
    const entity = await getActiveEntity();
    if (id) assertUserEntity(me, entityOfClient(id), "Client");
    const entityId = id ? entityOfClient(id)! : entity.id;
    const name = str(form, "name");
    const type = str(form, "type") ?? "other";
    if (!name) throw new Error("Name is required");
    if (!(type in ENUMS.clientType)) throw new Error("Invalid client type");
    const db = getDb();
    const dup = db.prepare("SELECT id FROM clients WHERE lower(name) = lower(?) AND id != ? AND entity_id = ?").get(name, id, entityId);
    if (dup) throw new Error("A client with this name already exists");
    const vals = [name, type, str(form, "contact_person"), str(form, "email"), str(form, "phone"), str(form, "address"), str(form, "notes")];
    if (id) db.prepare("UPDATE clients SET name=?, type=?, contact_person=?, email=?, phone=?, address=?, notes=? WHERE id=?").run(...vals, id);
    else db.prepare("INSERT INTO clients(name, type, contact_person, email, phone, address, notes, entity_id) VALUES (?,?,?,?,?,?,?,?)").run(...vals, entityId);
    revalidatePath("/clients"); if (id) revalidatePath(`/clients/${id}`);
  });
}

export async function deleteClient(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const me = await requirePermission("clients", "delete");
    const id = Number(form.get("id"));
    assertUserEntity(me, entityOfClient(id), "Client");
    const db = getDb();
    const used = db.prepare("SELECT (SELECT COUNT(*) FROM tenders WHERE client_id = ?) + (SELECT COUNT(*) FROM projects WHERE client_id = ?) AS c").get(id, id) as { c: number };
    if (used.c > 0) throw new Error("This client has tenders or projects and cannot be deleted");
    db.prepare("DELETE FROM clients WHERE id = ?").run(id);
    revalidatePath("/clients");
    redirect("/clients");
  });
}
