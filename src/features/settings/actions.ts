"use server";
import { revalidatePath } from "next/cache";
import { getDb, setSetting } from "@/lib/db";
import { getActiveEntity, logAuthEvent, requirePermission } from "@/lib/auth";
import { revalueFrom } from "@/lib/fx";
import { DOC_TYPES } from "@/lib/approvals/meta";
import { guard, type ActionResult as FormResult } from "@/lib/action-result";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Group-level settings: the company (group) name. Per-country values live in the Countries section; the reporting currency is USD (read-only for now). */
export async function saveCompanySettings(form: FormData): Promise<FormResult> {
  return guard(async () => {
    await requirePermission("settings", "edit");
    const name = str(form, "company_name");
    if (!name) throw new Error("Company name is required");
    setSetting("company_name", name);
    revalidatePath("/", "layout");
  });
}

const optNum = (f: FormData, k: string): number | null => { const v = str(f, k).replace(/,/g, ""); return v === "" ? null : Number(v); };

/** Country operation (entity) editor: legal details, currency, tax label / number, VAT, map centre, document prefix, approval threshold, status. */
export async function saveEntity(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const me = await requirePermission("settings", "edit");
    const db = getDb();
    const id = Number(form.get("id"));
    const cur = db.prepare("SELECT * FROM entities WHERE id = ?").get(id) as { code: string; currency: string; doc_prefix: string } | undefined;
    if (!cur) throw new Error("Country not found");
    const legal = str(form, "legal_name"), country = str(form, "country"), short = str(form, "short_name");
    if (!legal || !country || !short) throw new Error("Country, short name and legal name are required");
    const currency = str(form, "currency").toUpperCase();
    if (!db.prepare("SELECT 1 FROM currencies WHERE code = ?").get(currency)) throw new Error("Unknown currency (add it under Currencies & FX rates first)");
    const vat = optNum(form, "vat_rate"); const thr = optNum(form, "approval_cost_threshold");
    if (vat === null || !Number.isFinite(vat) || vat < 0 || vat > 100) throw new Error("VAT rate must be between 0 and 100");
    if (thr === null || !Number.isFinite(thr) || thr < 0) throw new Error("Approval threshold must be zero or more");
    const mc = str(form, "map_center");
    if (mc && !/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(mc)) throw new Error('Map centre must be "lat,lng", for example 23.588,58.383');
    const taxLabel = str(form, "tax_label") || "TRN";
    if (taxLabel.length > 12) throw new Error("Tax label is too long");
    const status = str(form, "status") === "inactive" ? "inactive" : "active";
    if (status === "inactive" && (db.prepare("SELECT COUNT(*) c FROM entities WHERE status = 'active' AND id != ?").get(id) as { c: number }).c === 0) throw new Error("At least one country must stay active");
    // The document prefix is part of every issued code: it can only change while the country has no documents.
    const prefix = str(form, "doc_prefix");
    const used = (db.prepare("SELECT (SELECT COUNT(*) FROM projects WHERE entity_id = ?) + (SELECT COUNT(*) FROM tenders WHERE entity_id = ?) c").get(id, id) as { c: number }).c;
    if (prefix !== cur.doc_prefix && used > 0) throw new Error("The document prefix cannot change once the country has tenders or projects");
    if (currency !== cur.currency && used > 0) throw new Error("The currency cannot change once the country has tenders or projects (amounts are stored in it)");
    db.prepare(`UPDATE entities SET country=?, flag=?, legal_name=?, short_name=?, currency=?, vat_rate=?, tax_label=?, tax_no=?, cr_no=?, address=?, phone=?, email=?, map_center=?, timezone=?, approval_cost_threshold=?, doc_prefix=?, status=? WHERE id=?`)
      .run(country, str(form, "flag") || null, legal, short, currency, vat, taxLabel, str(form, "tax_no") || null, str(form, "cr_no") || null, str(form, "address") || null, str(form, "phone") || null, str(form, "email") || null,
        mc || null, str(form, "timezone") || null, thr, prefix, status, id);
    await logAuthEvent("entity_updated", { userId: me.id, email: me.email, detail: `Country ${cur.code} updated by ${me.email}` });
    revalidatePath("/", "layout");
  });
}

/** Adds an FX rate (USD per 1 unit) effective from a date. Existing rows keep their locked rate. */
export async function addFxRate(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const me = await requirePermission("settings", "edit");
    const db = getDb();
    const currency = str(form, "currency").toUpperCase();
    const rate = optNum(form, "rate_to_usd");
    const date = str(form, "effective_date");
    if (!db.prepare("SELECT 1 FROM currencies WHERE code = ?").get(currency)) throw new Error("Unknown currency");
    if (currency === "USD") throw new Error("USD is the reporting currency (rate 1)");
    if (rate === null || !Number.isFinite(rate) || rate <= 0) throw new Error("Rate must be greater than zero");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Effective date is required");
    if (db.prepare("SELECT 1 FROM fx_rates WHERE currency = ? AND effective_date = ?").get(currency, date)) throw new Error("A rate for that currency and date already exists");
    db.prepare("INSERT INTO fx_rates(currency, rate_to_usd, effective_date, source, created_by) VALUES (?,?,?,?,?)").run(currency, rate, date, str(form, "source") || "Manual", me.id);
    await logAuthEvent("fx_updated", { userId: me.id, email: me.email, detail: `FX rate ${currency} = ${rate} USD effective ${date} (rows keep their locked rate until re-valued)` });
    revalidatePath("/settings");
  });
}

/** Explicit, audited admin action: re-values the locked USD rate of every money row dated on or after `from_date` with the rate effective on each row's date. */
export async function revalueFxAction(form: FormData): Promise<FormResult> {
  return guard(async () => {
    const me = await requirePermission("settings", "edit");
    const from = str(form, "from_date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("Choose the date to re-value from");
    const n = revalueFrom(from);
    await logAuthEvent("fx_updated", { userId: me.id, email: me.email, detail: `Re-valued ${n} row(s) dated ${from} or later with the current FX rates, by ${me.email}` });
    revalidatePath("/", "layout");
    return `Re-valued ${n} row(s) from ${from}.`;
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
  // the project-cost approval threshold belongs to the active country (its currency); the Countries section edits the other countries
  getDb().prepare("UPDATE entities SET approval_cost_threshold = ? WHERE id = ?").run(threshold, (await getActiveEntity()).id);
  for (const d of DOC_TYPES) setSetting(`approval_required_${d.type}`, form.get(`approval_required_${d.type}`) ? "1" : "0");
  revalidatePath("/settings");
  return { ok: true, message: "Approval settings saved." };
}
