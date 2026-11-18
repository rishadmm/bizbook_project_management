"use server";
// Supplier-side registration wizard (steps 2-8). Every action: requirePortalAction("registration") -> the supplier id comes from the portal session, never from the form;
// edits are only accepted while the registration is a draft or referred back. Saving a section / uploading a document answers an open reviewer query on it.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requirePortalAction, requestOrigin } from "@/lib/portal-auth";
import { saveUpload } from "@/lib/files";
import { guard, type ActionResult } from "@/lib/action-result";
import { emailError, ibanError, legacyDocType, normalizeIban, regionsOf, swiftError } from "@/lib/registration";
import { addDocumentVersion, entityCodeOf, getCategories, groupsOf, isEditable, listSupplierCategories, logSub, markFixed, requiredDocs, submitRegistration, updateCurrentDocMeta } from "./core";

export type RegState = ActionResult | undefined;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => str(f, k) || null;
const num = (f: FormData, k: string) => { const v = str(f, k); return v === "" ? null : Number(v); };
const MAX_FILE = 10 * 1024 * 1024;
const FILE_RE = /^(application\/pdf|image\/(png|jpe?g|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet))|text\/plain)$/;

async function editable() {
  const s = await requirePortalAction("registration");
  if (!isEditable(s.sub.registration_status)) throw new Error("This registration can no longer be edited. It is " + s.sub.registration_status.replace("_", " ") + ".");
  return s;
}
const go = (slug: string | null, step: number): never => redirect(`/p/${slug}/registration?step=${step}`);

export async function saveCompany(_p: RegState, f: FormData): Promise<RegState> {
  const r = await guard(async () => {
    const s = await editable();
    const name = str(f, "name"), phone = str(f, "phone"), address = str(f, "address");
    if (name.length < 3) throw new Error("Enter the company's legal name.");
    const year = num(f, "year_established"), emp = num(f, "employees");
    if (!str(f, "legal_form")) throw new Error("Choose the legal form.");
    if (!str(f, "cr_no")) throw new Error(`Enter your ${entityCodeOf(getDb(), s.sub.entity_id) === "OM" ? "commercial registration (CR)" : "trade licence"} number.`);
    if (!str(f, "cr_expiry")) throw new Error("Enter the registration / licence expiry date.");
    if (!str(f, "vat_no")) throw new Error(`Enter your ${s.entity.tax_label} number.`);
    if (year === null || !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) throw new Error("Enter a valid year of establishment.");
    if (emp === null || !Number.isInteger(emp) || emp < 1) throw new Error("Enter the number of employees.");
    if (!str(f, "turnover_band")) throw new Error("Choose the annual turnover band.");
    if (address.length < 5) throw new Error("Enter the company address.");
    if (phone.replace(/\D/g, "").length < 8) throw new Error("Enter a company phone number.");
    getDb().prepare(`UPDATE subcontractors SET name = ?, legal_form = ?, cr_no = ?, cr_expiry = ?, vat_no = ?, year_established = ?, employees = ?, turnover_band = ?, address = ?, website = ?, phone = ?,
      trade_license_no = ?, trade_license_expiry = ?, tax_no = ? WHERE id = ?`).run(name, str(f, "legal_form"), str(f, "cr_no"), str(f, "cr_expiry"), str(f, "vat_no"), year, emp, str(f, "turnover_band"), address, opt(f, "website"), phone,
      str(f, "cr_no"), str(f, "cr_expiry"), str(f, "vat_no"), s.sub.id);
    markFixed(getDb(), s.sub.id, "section", "company");
    logSub(getDb(), s.sub.id, "registration", "Company details saved", null);
    revalidatePath(`/p/${s.sub.portal_slug}/registration`);
    return s.sub.portal_slug ?? "";
  });
  if (!r.ok) return r;
  return go(r.message ?? "", 3);
}

export async function saveCategories(_p: RegState, f: FormData): Promise<RegState> {
  const r = await guard(async () => {
    const s = await editable();
    const db = getDb();
    const valid = new Set(listSupplierCategories(db, s.sub.entity_id).map((c) => c.id));
    const picked = f.getAll("cat").map(Number).filter((n) => valid.has(n));
    if (!picked.length) throw new Error("Choose at least one category.");
    const regions = f.getAll("region").map(String).filter((x) => regionsOf(entityCodeOf(db, s.sub.entity_id)).includes(x));
    if (!regions.length) throw new Error("Choose at least one region you serve.");
    db.transaction(() => {
      const have = new Map(getCategories(db, s.sub.id).map((c) => [c.category_id, c.status]));
      for (const id of have.keys()) if (!picked.includes(id)) db.prepare("DELETE FROM subcontractor_categories WHERE subcontractor_id = ? AND category_id = ?").run(s.sub.id, id);
      for (const id of picked) if (!have.has(id)) db.prepare("INSERT INTO subcontractor_categories(subcontractor_id, category_id, status) VALUES (?,?, 'requested')").run(s.sub.id, id);
      const names = getCategories(db, s.sub.id).map((c) => c.name);
      db.prepare("UPDATE subcontractors SET regions_served = ?, capacity_note = ?, trade = COALESCE(trade, ?) WHERE id = ?").run(JSON.stringify(regions), opt(f, "capacity_note"), names.slice(0, 2).join(", ") || null, s.sub.id);
      markFixed(db, s.sub.id, "section", "categories");
    })();
    logSub(db, s.sub.id, "registration", `Categories saved (${picked.length})`, null);
    revalidatePath(`/p/${s.sub.portal_slug}/registration`);
    return s.sub.portal_slug ?? "";
  });
  if (!r.ok) return r;
  return go(r.message ?? "", 4);
}

export async function saveContacts(_p: RegState, f: FormData): Promise<RegState> {
  const r = await guard(async () => {
    const s = await editable();
    const db = getDb();
    const code = entityCodeOf(db, s.sub.entity_id);
    for (const [role, label] of [["signatory", "authorised signatory"], ["finance", "finance contact"]] as const) {
      if (str(f, `${role}_name`).length < 3) throw new Error(`Enter the name of the ${label}.`);
      const ee = emailError(str(f, `${role}_email`)); if (ee) throw new Error(`${label[0].toUpperCase()}${label.slice(1)}: ${ee}`);
    }
    if (!str(f, "bank_name")) throw new Error("Enter the bank name.");
    if (str(f, "account_name").length < 3) throw new Error("Enter the account name.");
    const ie = ibanError(str(f, "iban"), code); if (ie) throw new Error(ie);
    const se = swiftError(str(f, "swift")); if (se) throw new Error(se);
    db.transaction(() => {
      for (const role of ["signatory", "finance", "hse"] as const) {
        if (role === "hse" && !str(f, "hse_name")) { db.prepare("DELETE FROM subcontractor_contacts WHERE subcontractor_id = ? AND role = 'hse'").run(s.sub.id); continue; }
        db.prepare(`INSERT INTO subcontractor_contacts(subcontractor_id, role, name, title, email, phone) VALUES (?,?,?,?,?,?)
          ON CONFLICT(subcontractor_id, role) DO UPDATE SET name = excluded.name, title = excluded.title, email = excluded.email, phone = excluded.phone`)
          .run(s.sub.id, role, str(f, `${role}_name`), opt(f, `${role}_title`), opt(f, `${role}_email`), opt(f, `${role}_phone`));
      }
      db.prepare("UPDATE subcontractors SET bank_name = ?, account_name = ?, iban = ?, swift = ? WHERE id = ?").run(str(f, "bank_name"), str(f, "account_name"), normalizeIban(str(f, "iban")), str(f, "swift").replace(/\s+/g, "").toUpperCase(), s.sub.id);
      markFixed(db, s.sub.id, "section", "contacts");
    })();
    logSub(db, s.sub.id, "registration", "Contacts and bank details saved", null);
    revalidatePath(`/p/${s.sub.portal_slug}/registration`);
    return s.sub.portal_slug ?? "";
  });
  if (!r.ok) return r;
  return go(r.message ?? "", 5);
}

export async function saveHse(_p: RegState, f: FormData): Promise<RegState> {
  const r = await guard(async () => {
    const s = await editable();
    const policy = str(f, "hse_has_policy");
    if (policy !== "yes" && policy !== "no") throw new Error("Tell us whether you have a written HSE policy.");
    const lti = num(f, "hse_lti_rate");
    if (lti === null || Number.isNaN(lti) || lti < 0 || lti > 100) throw new Error("Enter your lost-time injury (LTI) rate (0 or more).");
    const icv = num(f, "icv_score");
    if (icv !== null && (Number.isNaN(icv) || icv < 0 || icv > 100)) throw new Error("The ICV score is a percentage between 0 and 100.");
    getDb().prepare("UPDATE subcontractors SET hse_has_policy = ?, hse_lti_rate = ?, iso_9001 = ?, iso_14001 = ?, iso_45001 = ?, icv_score = ? WHERE id = ?")
      .run(policy === "yes" ? 1 : 0, lti, f.get("iso_9001") ? 1 : 0, f.get("iso_14001") ? 1 : 0, f.get("iso_45001") ? 1 : 0, icv, s.sub.id);
    markFixed(getDb(), s.sub.id, "section", "hse");
    logSub(getDb(), s.sub.id, "registration", "HSE and quality saved", null);
    revalidatePath(`/p/${s.sub.portal_slug}/registration`);
    return s.sub.portal_slug ?? "";
  });
  if (!r.ok) return r;
  return go(r.message ?? "", 6);
}

export async function saveExperience(_p: RegState, f: FormData): Promise<RegState> {
  const r = await guard(async () => {
    const s = await editable();
    const rows: { client: string; project: string; value: number | null; year: number; description: string | null }[] = [];
    for (let i = 0; i < 6; i++) {
      const client = str(f, `client_${i}`), project = str(f, `project_${i}`), year = num(f, `year_${i}`), value = num(f, `value_${i}`);
      if (!client && !project && year === null && value === null) continue;
      if (!client || !project) throw new Error(`Reference ${i + 1}: enter both the client and the project.`);
      if (year === null || !Number.isInteger(year) || year < 1990 || year > new Date().getFullYear()) throw new Error(`Reference ${i + 1}: enter the completion year.`);
      if (value !== null && (Number.isNaN(value) || value < 0)) throw new Error(`Reference ${i + 1}: the contract value must be a positive number.`);
      rows.push({ client, project, value, year, description: opt(f, `description_${i}`) });
    }
    if (rows.length < 2) throw new Error("Add at least 2 reference projects.");
    const db = getDb();
    db.transaction(() => {
      db.prepare("DELETE FROM subcontractor_experience WHERE subcontractor_id = ?").run(s.sub.id);
      for (const x of rows) db.prepare("INSERT INTO subcontractor_experience(subcontractor_id, client, project, value, currency, year, description) VALUES (?,?,?,?,?,?,?)").run(s.sub.id, x.client, x.project, x.value, s.entity.currency, x.year, x.description);
      markFixed(db, s.sub.id, "section", "experience");
    })();
    logSub(db, s.sub.id, "registration", `Experience saved (${rows.length} references)`, null);
    revalidatePath(`/p/${s.sub.portal_slug}/registration`);
    return s.sub.portal_slug ?? "";
  });
  if (!r.ok) return r;
  return go(r.message ?? "", 7);
}

/** Uploads a registration document (a new version when one exists) or updates the dates / reference of the current version. */
export async function uploadRegDocument(_p: RegState, f: FormData): Promise<RegState> {
  return guard(async () => {
    const s = await editable();
    const db = getDb();
    const code = str(f, "code");
    const types = requiredDocs(db, s.sub.entity_id, groupsOf(getCategories(db, s.sub.id)));
    const t = types.find((x) => x.code === code) ?? (db.prepare("SELECT code, name, mandatory, needs_expiry FROM registration_doc_types WHERE entity_id = ? AND code = ?").get(s.sub.entity_id, code) as { code: string; name: string; needs_expiry: number } | undefined);
    if (!t) throw new Error("Unknown document type.");
    const needsExpiry = "needs_expiry" in t ? !!t.needs_expiry : false;
    const issue = opt(f, "issue_date"), expiry = opt(f, "expiry_date"), ref = opt(f, "ref_no");
    if (needsExpiry && !expiry) throw new Error("Enter the expiry date of this document.");
    if (issue && expiry && expiry < issue) throw new Error("The expiry date is before the issue date.");
    const file = f.get("file");
    const hasFile = file instanceof File && file.size > 0;
    if (!hasFile) {
      if (!updateCurrentDocMeta(db, s.sub.id, code, ref, issue, expiry)) throw new Error("Choose a file to upload.");
    } else {
      const fl = file as File;
      if (fl.size > MAX_FILE) throw new Error("The file is larger than 10 MB.");
      if (!FILE_RE.test(fl.type || "")) throw new Error("Upload a PDF, image, Word, Excel or text file.");
      const att = await saveUpload(fl, "subcontractor", s.sub.id, code, { uploadedBy: null, note: `Registration document uploaded by ${s.user.name}` });
      addDocumentVersion(db, s.sub.id, { code, attachmentId: att.id, refNo: ref, issueDate: issue, expiryDate: expiry, uploadedByName: s.user.name, legacyType: legacyDocType(code) });
    }
    logSub(db, s.sub.id, "document", `Registration document ${"name" in t ? t.name : code} ${hasFile ? "uploaded" : "updated"}`, null);
    revalidatePath(`/p/${s.sub.portal_slug}/registration`); revalidatePath(`/p/${s.sub.portal_slug}/documents`);
    return "Saved";
  });
}

/** Final step: the three declarations, then submit (draft) or resubmit (referred back). */
export async function submitMyRegistration(_p: RegState, f: FormData): Promise<RegState> {
  const r = await guard(async () => {
    const s = await editable();
    if (f.get("decl_accuracy") !== "on" || f.get("decl_coi") !== "on" || f.get("decl_conduct") !== "on") throw new Error("Tick all three declarations to submit.");
    const db = getDb();
    db.prepare("UPDATE subcontractors SET declaration_accepted_at = ? WHERE id = ?").run(new Date().toISOString(), s.sub.id);
    submitRegistration(db, s.sub.id, { portalUserId: s.user.id, actorName: s.user.name, baseUrl: await requestOrigin() });
    revalidatePath(`/p/${s.sub.portal_slug}`, "layout"); revalidatePath("/subcontractors/registrations"); revalidatePath("/", "layout");
    return s.sub.portal_slug ?? "";
  });
  if (!r.ok) return r;
  redirect(`/p/${r.message}/registration`);
}

