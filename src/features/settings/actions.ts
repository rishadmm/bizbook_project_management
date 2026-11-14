"use server";
import { revalidatePath } from "next/cache";
import { getDb, setSetting } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { DOC_TYPES } from "@/lib/approvals/meta";
import { guard, type ActionResult as FormResult } from "@/lib/action-result";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveCompanySettings(form: FormData): Promise<FormResult> {
  return guard(async () => {
    await requirePermission("settings", "edit");
    const name = str(form, "company_name");
    const currency = str(form, "currency").toUpperCase();
    if (!name) throw new Error("Company name is required");
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter code");
    setSetting("company_name", name);
    setSetting("currency", currency);
    revalidatePath("/", "layout");
  });
}

export async function saveDepartment(form: FormData): Promise<FormResult> {
  return guard(async () => {
    await requirePermission("settings", "edit");
    const id = Number(form.get("id")) || 0;
    const name = str(form, "name");
    const code = str(form, "code").toUpperCase() || null;
    const head = Number(form.get("head_user_id")) || null;
    if (!name) throw new Error("Name is required");
    const db = getDb();
    if (id) db.prepare("UPDATE departments SET name=?, code=?, head_user_id=? WHERE id=?").run(name, code, head, id);
    else db.prepare("INSERT INTO departments(name, code, head_user_id) VALUES (?,?,?)").run(name, code, head);
    revalidatePath("/settings");
  });
}

export async function deleteDepartment(form: FormData): Promise<FormResult> {
  return guard(async () => {
    await requirePermission("settings", "edit");
    getDb().prepare("DELETE FROM departments WHERE id = ?").run(Number(form.get("id")));
    revalidatePath("/settings");
  });
}

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

/** Approval settings: cost threshold + "approval required" toggle per document type. */
export async function saveApprovalSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  try { await requirePermission("settings", "edit"); } catch { return { ok: false, error: "You do not have permission to change settings." }; }
  const raw = str(form, "approval_cost_threshold");
  const threshold = Number(raw);
  if (raw === "" || !Number.isFinite(threshold) || threshold < 0) return { ok: false, error: "Cost threshold must be a number of zero or more." };
  setSetting("approval_cost_threshold", String(threshold));
  for (const d of DOC_TYPES) setSetting(`approval_required_${d.type}`, form.get(`approval_required_${d.type}`) ? "1" : "0");
  revalidatePath("/settings");
  return { ok: true, message: "Approval settings saved." };
}
