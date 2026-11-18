/* eslint-disable @typescript-eslint/no-explicit-any */
// Procurement seed phase (SUPPLIER_TENDERING_SPEC C1): runs ONCE after both country profiles (see seed.ts). It only APPENDS rows: the ids and business values of every existing
// UAE / Oman row stay identical (existing subcontractors only receive values in the new SCHEMA_VERSION 9 columns). Region content comes from `profile.procurement`.
//   Part A (supplier registration): registration profiles for the existing subcontractors, 8 more approved suppliers per country and the registration pipeline.
//   Part B (supplier tendering) hooks in at `seedProcurement()` below: templates, workflows, historic + live tenders.
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { addDays, todayISO } from "./format";
import { hashPassword } from "./password";
import { DEMO_USER_PASSWORD } from "./migrate";
import { DEMO_PORTAL_PASSWORD, insertPortalUser, uniqueSlug } from "./portal-core";
import { legacyDocType, regionsOf } from "./registration";
import type { RegionResult } from "./seed-engine";
import type { SupplierSeed } from "./seed-regions/types";
import {
  addDocumentVersion, applyApproval, getCategories, groupsOf, markFixed, nextRegistrationNo, referBack, reject, requiredDocs, setItemVerdict, startReview, submitRegistration,
} from "../features/supplier-registration/core";

const TODAY = todayISO();
const SWIFT: Record<string, string> = {
  "Emirates NBD": "EBILAEAD", ADCB: "ADCBAEAA", Mashreq: "BOMLAEAD", FAB: "NBADAEAA", "Bank Muscat": "BMUSOMRX", "National Bank of Oman": "NBOMOMRX",
  "Sohar International": "BSHROMRU", "Bank Dhofar": "BDOFOMRU", "Oman Arab Bank": "OMABOMRU", "HSBC Oman": "BBMEOMRU",
};
const GROUP_LEGACY: Record<string, string[]> = { Telecom: ["cable", "telecom"], Civil: ["road", "civil"], "Oil and gas": ["pipeline", "civil"], Others: ["civil"] };

import { miniPdf } from "./seed-files";
import { seedTendering, type TenderingDemo } from "./seed-tendering";
export { miniPdf };

export interface RegistrationDemo {
  entityId: number; code: string;
  /** referred-back supplier login of the demo */ referredBack: { company: string; slug: string; email: string } | null;
  resubmitted: { company: string; slug: string; email: string } | null; draft: { company: string; slug: string; email: string } | null;
  approvedThisWeek: { company: string; slug: string; email: string } | null; rejected: { company: string; slug: string; email: string } | null;
  procurementUsers: { name: string; email: string; title: string }[]; extraApproved: { company: string; slug: string; email: string; note: string }[];
}

export let tendering: TenderingDemo[] = [];
export async function seedProcurement(db: DB, results: RegionResult[], uploads: string): Promise<RegistrationDemo[]> {
  const out: RegistrationDemo[] = [];
  for (const r of results) out.push(seedSupplierRegistration(db, r, uploads));
  // Part B (supplier tendering): templates, historic awarded tenders and the live tenders of every status (src/lib/seed-tendering.ts)
  tendering = seedTendering(db, results, uploads);
  return out;
}

function seedSupplierRegistration(db: DB, r: RegionResult, uploads: string): RegistrationDemo {
  const P = r.profile, PP = P.procurement, entityId = r.entityId;
  const ent = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId) as { id: number; code: string; doc_prefix: string; country: string; currency: string };
  const one = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as any[])) as T | undefined;
  const all = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
  const stamp = (daysAgo: number, hh = 9, mm = 0) => { const d = new Date(Date.now() - daysAgo * 86_400_000); d.setUTCHours(hh, mm, 0, 0); return d.toISOString(); };
  const sql = (iso: string) => iso.replace("T", " ").slice(0, 19);
  const pick = <T,>(a: T[], k: number) => a[Math.abs(k) % a.length];
  const catId = (code: string) => (one<{ id: number }>("SELECT id FROM supplier_categories WHERE code = ? AND entity_id IS NULL", code))!.id;
  const group = (code: string) => (one<{ group_name: string }>("SELECT group_name FROM supplier_categories WHERE code = ? AND entity_id IS NULL", code))!.group_name;
  /** Valid 23-character IBAN (AE / OM: country code, 2 check digits, 3-digit bank code, 16-digit account) for the n-th supplier of the country. */
  const ibanFor = (n: number) => {
    const raw = `${ent.code}${String(10 + ((n * 7) % 88)).padStart(2, "0")}${String(18 + ((n * 13) % 80)).padStart(3, "0")}${String(1_000_000_000_000_000 + n * 7_654_321_987).slice(0, 16)}`;
    return raw.replace(/(.{4})/g, "$1 ").trim();
  };
  const swiftOf = (bank: string | null) => SWIFT[bank ?? ""] ?? (ent.code === "OM" ? "BMUSOMRX" : "EBILAEAD");

  /* ---------------------------------------------------------------- reviewer (procurement officer) */
  let reviewer = r.U[8]; // slot 8 is the procurement officer of the profile (UAE: Aisha Rahman, Oman: Asma Al Harthy), role `procurement`
  const procurementUsers: RegistrationDemo["procurementUsers"] = [];
  const u8 = one<{ name: string; email: string; job_title: string | null }>("SELECT name, email, job_title FROM users WHERE id = ?", reviewer)!;
  procurementUsers.push({ name: u8.name, email: u8.email, title: u8.job_title ?? "Procurement Officer" });
  if (PP.reviewer) {
    const roleId = one<{ id: number }>("SELECT id FROM roles WHERE code = 'procurement'")!.id;
    const uid = Number(db.prepare(`INSERT INTO users(name, email, department_id, role, role_id, status, must_change_password, failed_attempts, password_hash, password_changed_at, job_title, manager_id, default_entity_id)
      VALUES (?,?,?,?,?, 'active', 0, 0, ?, ?, ?, ?, ?)`).run(PP.reviewer.name, PP.reviewer.email, r.DEPT.Procurement, "procurement", roleId, hashPassword(DEMO_USER_PASSWORD), new Date().toISOString(), PP.reviewer.title, r.U[1], entityId).lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO user_entities(user_id, entity_id) VALUES (?,?)").run(uid, entityId);
    db.prepare("INSERT INTO auth_events(user_id, email, event, ip, user_agent, detail, created_at) VALUES (?,?, 'user_created', '10.20.4.11', 'Mozilla/5.0', ?, ?)").run(uid, PP.reviewer.email, `Created user ${PP.reviewer.name}`, stamp(40, 9, 30));
    reviewer = uid;
    procurementUsers.unshift({ name: PP.reviewer.name, email: PP.reviewer.email, title: PP.reviewer.title });
  }

  /* ---------------------------------------------------------------- helpers */
  const clientNames = [...P.clients.map((c) => c.name.replace(/\s*\(demo\)\s*$/i, "")), ...PP.clients];
  const file = (subId: number, code: string, label: string, daysAgo: number, uploader: string | null): number => {
    const filename = `${code}-${subId}.pdf`;
    const stored = `seed-${nanoid(8)}-${filename}`;
    const buf = miniPdf(label, [`Supplier: ${one<{ name: string }>("SELECT name FROM subcontractors WHERE id = ?", subId)!.name}`, "Placeholder document generated by the demo seed.", `Document type: ${code}`]);
    fs.writeFileSync(path.join(uploads, stored), buf);
    return Number(db.prepare("INSERT INTO attachments(entity_type, entity_id, category, filename, stored_path, mime, size, uploaded_by, note, created_at) VALUES ('subcontractor',?,?,?,?, 'application/pdf',?,NULL,?,?)")
      .run(subId, code, filename, stored, buf.length, uploader ? `Registration document uploaded by ${uploader}` : "Demo file", sql(stamp(daysAgo, 10))).lastInsertRowid);
  };
  const portalOwner = (subId: number, name: string, createdDaysAgo: number, lastLoginDaysAgo: number | null) => {
    const s = one<{ email: string; phone: string | null }>("SELECT email, phone FROM subcontractors WHERE id = ?", subId)!;
    const domain = s.email.split("@")[1] ?? P.portal.defaultDomain;
    const local = name.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter((w, i, a) => i === 0 || i === a.length - 1).join(".");
    const email = `${local}@${domain}`;
    const id = insertPortalUser(db, { subcontractorId: subId, name, email, jobTitle: "Owner", phone: s.phone, role: "owner", password: DEMO_PORTAL_PASSWORD, mustChange: false, createdAt: stamp(createdDaysAgo), createdBy: null });
    if (lastLoginDaysAgo !== null) db.prepare("UPDATE portal_users SET last_login_at = ?, previous_login_at = ? WHERE id = ?").run(stamp(lastLoginDaysAgo, 8), stamp(lastLoginDaysAgo + 3, 8), id);
    db.prepare("INSERT INTO portal_auth_events(subcontractor_id, portal_user_id, email, event, ip, user_agent, detail, created_at) VALUES (?,?,?, 'user_created', '10.30.8.14', 'Mozilla/5.0', ?, ?)").run(subId, id, email, "Self-registration", stamp(createdDaysAgo));
    return { id, email };
  };

  interface Fill { legalForm: string; year: number; employees: number; turnover: string; regions: string[]; cats: string[]; catStatus: "requested" | "approved"; partial?: boolean; keepLegacy?: boolean; idx: number; contactName: string }
  /** Registration data of one supplier (all columns of SCHEMA_VERSION 9 + categories, contacts, references). `partial` = company details and categories only (a draft). */
  function fillProfile(subId: number, f: Fill): void {
    const s = one<any>("SELECT * FROM subcontractors WHERE id = ?", subId);
    const regions = f.regions.filter((x) => regionsOf(ent.code).includes(x));
    const i = f.idx;
    db.prepare(`UPDATE subcontractors SET legal_form = ?, year_established = ?, employees = ?, turnover_band = ?, website = ?, cr_no = ?, cr_expiry = ?, vat_no = ?, country_of_registration = ?, regions_served = ?, capacity_note = ?,
      account_name = ?, swift = ?, hse_has_policy = ?, hse_lti_rate = ?, iso_9001 = ?, iso_14001 = ?, iso_45001 = ?, icv_score = ? WHERE id = ?`)
      .run(f.legalForm, f.year, f.employees, f.turnover, `https://www.${String(s.name).toLowerCase().replace(/[^a-z]+/g, "").slice(0, 16)}.${ent.code === "OM" ? "om" : "ae"}`, s.trade_license_no, s.trade_license_expiry, s.tax_no, ent.country, JSON.stringify(regions),
        `${f.employees} staff; ${Math.max(2, Math.round(f.employees / 22))} crews; capacity ${Math.max(2, Math.round(f.employees / 14))} km per month`, f.partial ? null : s.name, f.partial ? null : swiftOf(s.bank_name),
        f.partial ? null : 1, f.partial ? null : [0.0, 0.4, 0.8, 1.2, 0.0, 0.6][i % 6], f.partial ? 0 : i % 3 === 0 ? 1 : 0, f.partial ? 0 : i % 4 === 0 ? 1 : 0, f.partial ? 0 : i % 5 === 0 ? 1 : 0, ent.code === "OM" && !f.partial ? [18, 24, 31, 12, 27][i % 5] : null, subId);
    db.prepare("DELETE FROM subcontractor_categories WHERE subcontractor_id = ?").run(subId);
    for (const c of f.cats) db.prepare("INSERT OR IGNORE INTO subcontractor_categories(subcontractor_id, category_id, status) VALUES (?,?,?)").run(subId, catId(c), f.catStatus);
    if (f.partial) return;
    const contact = f.contactName;
    const people = PP.people;
    const ins = db.prepare("INSERT OR REPLACE INTO subcontractor_contacts(subcontractor_id, role, name, title, email, phone) VALUES (?,?,?,?,?,?)");
    const domain = String(s.email ?? "").split("@")[1] ?? P.portal.defaultDomain;
    const mail = (n: string) => `${n.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter((w, k, a) => k === 0 || k === a.length - 1).join(".")}@${domain}`;
    ins.run(subId, "primary", contact, "General Manager", s.email, s.phone);
    ins.run(subId, "signatory", contact, "Managing Director", mail(contact), s.phone);
    const fin = pick(people, i * 3 + 1), hse = pick(people, i * 3 + 2);
    ins.run(subId, "finance", fin, "Finance Manager", mail(fin), s.phone);
    ins.run(subId, "hse", hse, "HSE Manager", mail(hse), s.phone);
    db.prepare("DELETE FROM subcontractor_experience WHERE subcontractor_id = ?").run(subId);
    const grp = group(f.cats[0]);
    const kind = grp === "Telecom" ? "telecom" : grp === "Civil" ? "civil" : grp === "Oil and gas" ? "oilgas" : "other";
    const n = 2 + (i % 2);
    for (let k = 0; k < n; k++) {
      const value = Math.round((ent.code === "OM" ? 60_000 : 600_000) * (1 + ((i * 7 + k * 5) % 9)) * (1 + k * 0.4));
      db.prepare("INSERT INTO subcontractor_experience(subcontractor_id, client, project, value, currency, year, description) VALUES (?,?,?,?,?,?,?)")
        .run(subId, pick(clientNames, i + k * 2), pick(PP.projects[kind], i + k), value, ent.currency, 2025 - ((i + k) % 4), k === 0 ? "Completed on programme with no lost-time incidents." : null);
    }
  }

  /** Uploads every mandatory document (+ some optional ones); returns nothing. `override` sets the expiry of one document type (days from today). */
  function uploadDocs(subId: number, o: { daysAgo: number; uploader: string; skip?: string[]; expiry?: Record<string, number>; accepted?: boolean; optional?: boolean }): void {
    const cats = getCategories(db, subId);
    const req = requiredDocs(db, ent.id, groupsOf(cats));
    req.filter((d) => d.mandatory || (o.optional && ["audited_financials", "iso_certs", "insurance_car", "chamber", "occi"].includes(d.code))).forEach((d, k) => {
      if (o.skip?.includes(d.code)) return;
      const att = file(subId, d.code, d.name, o.daysAgo + (k % 5), o.uploader);
      const exp = d.needs_expiry ? addDays(TODAY, o.expiry?.[d.code] ?? 120 + ((subId * 37 + k * 53) % 600)) : null;
      addDocumentVersion(db, subId, { code: d.code, attachmentId: att, refNo: `${d.code.slice(0, 3).toUpperCase()}-${7000 + subId * 11 + k}`, issueDate: exp ? addDays(exp, -365) : addDays(TODAY, -(150 + k * 20)),
        expiryDate: exp, uploadedByName: o.uploader, legacyType: legacyDocType(d.code), createdAt: stamp(o.daysAgo + (k % 5), 10) });
    });
    if (o.accepted) db.prepare("UPDATE subcontractor_documents SET review_status = 'accepted', status = 'verified', reviewed_by = ?, reviewed_at = ? WHERE subcontractor_id = ? AND doc_type_code IS NOT NULL").run(reviewer, stamp(Math.max(0, o.daysAgo - 1), 11), subId);
  }
  const legacyCats = (cats: string[]) => [...new Set(cats.flatMap((c) => GROUP_LEGACY[group(c)] ?? []))].join(",");

  /** Historic approval of an established supplier: registration number, dates, grade, approved categories, history row (no mail: it happened long ago). */
  function markHistoricApproval(subId: number, o: { submittedDaysAgo: number; grade: "A" | "B" | "C"; validDays: number }): void {
    const at = stamp(o.submittedDaysAgo - 6, 14);
    const submitted = stamp(o.submittedDaysAgo, 9);
    const regNo = nextRegistrationNo(db, entityId, Number(submitted.slice(0, 4)));
    db.prepare(`UPDATE subcontractors SET registration_no = ?, registered_at = ?, submitted_at = ?, reviewed_by = ?, reviewed_at = ?, review_note = 'Documents verified; references checked.', prequal_grade = ?, prequal_valid_until = ?,
      declaration_accepted_at = ?, registration_status = 'approved' WHERE id = ?`).run(regNo, stamp(o.submittedDaysAgo + 2, 9), submitted, reviewer, at, o.grade, addDays(TODAY, o.validDays), submitted, subId);
    db.prepare("UPDATE subcontractor_categories SET status = 'approved' WHERE subcontractor_id = ?").run(subId);
    db.prepare("INSERT INTO registration_reviews(subcontractor_id, decision, note, items_json, decided_by, decided_at, round) VALUES (?, 'approve', 'Approved after document and reference checks.', ?, ?, ?, 1)")
      .run(subId, JSON.stringify({ grade: o.grade, valid_until: addDays(TODAY, o.validDays) }), reviewer, at);
    db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES ('subcontractor',?, 'registration', ?, ?, ?)").run(subId, `Registration ${regNo} approved: grade ${o.grade}`, reviewer, sql(at));
  }

  /* ---------------------------------------------------------------- 1. the existing subcontractors get a full registration profile */
  db.prepare("UPDATE subcontractors SET registration_status = 'under_review' WHERE entity_id = ? AND status IN ('prospect', 'onboarding')").run(entityId);
  db.prepare("UPDATE subcontractors SET registered_at = created_at WHERE entity_id = ? AND registered_at IS NULL").run(entityId);
  const existing = all<any>("SELECT * FROM subcontractors WHERE entity_id = ? ORDER BY id", entityId);
  const regions0 = regionsOf(ent.code);
  existing.forEach((s, i) => {
    const t = `${s.trade ?? ""} ${s.categories ?? ""} ${s.name}`.toLowerCase();
    const cats = new Set<string>();
    if (/trench|cable|fibre|telecom/.test(t)) { cats.add("tel-cable"); cats.add("tel-duct"); }
    if (/splic|fibre/.test(t)) cats.add("tel-splice");
    if (/hdd|drill|boring/.test(t)) cats.add("tel-hdd");
    if (/earth|excav|civil|shoring/.test(t)) cats.add("civ-works");
    if (/asphalt|pav|landscap|road/.test(t) && !/survey/.test(t)) cats.add("civ-reinst");
    if (/pipe|weld/.test(t)) { cats.add("og-weld"); cats.add("og-hydro"); }
    if (/survey|testing/.test(t)) { cats.add("oth-survey"); cats.add("oth-hse"); }
    if (/traffic|signage/.test(t)) cats.add("oth-traffic");
    if (/labour|manpower|rigging/.test(t)) { cats.add("oth-manpower"); cats.add("oth-plant"); }
    if (!cats.size) cats.add("civ-works");
    const regions = regions0.filter((x) => String(s.address ?? "").includes(x) || String(s.address ?? "").toLowerCase().includes(x.toLowerCase().split(" ").pop()!));
    const approvedReg = s.registration_status === "approved";
    fillProfile(s.id, {
      legalForm: i % 4 === 3 ? (ent.code === "OM" ? "SAOC" : "Free zone company (FZE / FZCO)") : "LLC", year: 2004 + ((i * 3) % 14), employees: 40 + ((i * 47) % 260), turnover: pick(["5 - 25 million", "25 - 100 million", "1 - 5 million", "5 - 25 million"], i),
      regions: [...new Set([...regions, regions0[i % regions0.length], regions0[(i + 1) % regions0.length]])], cats: [...cats], catStatus: approvedReg ? "approved" : "requested", idx: i, contactName: s.contact_person ?? pick(PP.people, i), partial: false,
    });
    if (approvedReg) {
      uploadDocs(s.id, { daysAgo: 380 - i * 15, uploader: s.contact_person ?? "Supplier", accepted: true, optional: i % 2 === 0 });
      const grade = (s.rating ?? 3) >= 4.3 ? "A" : (s.rating ?? 3) >= 3.5 ? "B" : "C";
      markHistoricApproval(s.id, { submittedDaysAgo: 400 - i * 15, grade, validDays: 60 + ((i * 53) % 330) });
    } else {
      // in the legacy onboarding flow: submitted, in review, not decided yet (some documents already uploaded)
      const regNo = nextRegistrationNo(db, entityId, Number(stamp(200).slice(0, 4)));
      db.prepare("UPDATE subcontractors SET registration_no = ?, submitted_at = ?, reviewed_by = ?, declaration_accepted_at = ? WHERE id = ?").run(regNo, stamp(40 - i, 9), i % 2 ? reviewer : null, stamp(41 - i), s.id);
      uploadDocs(s.id, { daysAgo: 42 - i, uploader: s.contact_person ?? "Supplier", skip: ["insurance_wc", "hse_policy", "owner_id"] });
    }
  });

  /* ---------------------------------------------------------------- 2. eight more approved suppliers (they bid on tenders, mostly without winning) */
  const subCount = (one<{ c: number }>("SELECT COUNT(*) c FROM subcontractors WHERE entity_id = ?", entityId))!.c;
  const createSub = (x: SupplierSeed, idx: number, o: { status: string; regStatus: string; createdDaysAgo: number; rating: number | null; portal: boolean }) => {
    const sg = P.subGen;
    const local = sg.emailLocal ? sg.emailLocal(x.name) : x.name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14);
    const code = `${ent.doc_prefix}SUB-${String(subCount + idx + 1).padStart(3, "0")}`;
    const id = Number(db.prepare(`INSERT INTO subcontractors(code, name, trade, categories, contact_person, email, phone, address, trade_license_no, trade_license_expiry, tax_no, bank_name, iban, status, rating, notes, entity_id, created_at,
      registration_status, portal_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, x.name, x.trade, legacyCats(x.cats), x.contact, `info@${local}${sg.emailSuffix}`, sg.phone(subCount + idx), x.address + sg.addressSuffix,
      sg.licenseNo(subCount + idx), addDays(TODAY, 200 + ((idx * 71) % 420)), sg.taxNo(subCount + idx), sg.bank(subCount + idx), ibanFor(subCount + idx), o.status, o.rating, null, entityId, sql(stamp(o.createdDaysAgo)), o.regStatus, o.portal ? 1 : 0).lastInsertRowid);
    db.prepare("UPDATE subcontractors SET portal_slug = ? WHERE id = ?").run(uniqueSlug(db, x.name, id), id);
    return id;
  };
  const extraApproved: RegistrationDemo["extraApproved"] = [];
  PP.extra.forEach((x, k) => {
    const id = createSub(x, k, { status: "approved", regStatus: "approved", createdDaysAgo: 330 - k * 24, rating: [3.8, 4.1, 3.4, 4.3, 3.6, 3.9, 3.2, 3.5][k], portal: true });
    fillProfile(id, { legalForm: x.legalForm, year: x.year, employees: x.employees, turnover: x.turnover, regions: x.regions, cats: x.cats, catStatus: "approved", idx: k + 20, contactName: x.contact });
    const expiry: Record<string, number> = k === 6 ? { insurance_wc: 18 } : k === 7 ? { insurance_tpl: -6 } : {};
    uploadDocs(id, { daysAgo: 320 - k * 24, uploader: x.contact, accepted: true, optional: k % 3 === 0, expiry });
    markHistoricApproval(id, { submittedDaysAgo: 318 - k * 24, grade: (["A", "B", "B", "A", "B", "C", "B", "C"] as const)[k], validDays: 90 + k * 31 });
    const o = portalOwner(id, x.contact, 300 - k * 24, k % 4);
    const s = one<{ portal_slug: string }>("SELECT portal_slug FROM subcontractors WHERE id = ?", id)!;
    extraApproved.push({ company: x.name, slug: s.portal_slug, email: o.email, note: k === 6 ? "insurance expiring in 18 days (warning chip)" : k === 7 ? "expired mandatory insurance: cannot bid until renewed" : "" });
  });

  /* ---------------------------------------------------------------- 3. the registration pipeline (real state transitions with back-dated timestamps) */
  const pl = PP.pipeline;
  const create = (x: SupplierSeed, idx: number, createdDaysAgo: number) => {
    const id = createSub(x, 8 + idx, { status: "prospect", regStatus: "draft", createdDaysAgo, rating: null, portal: true });
    const s = one<{ portal_slug: string }>("SELECT portal_slug FROM subcontractors WHERE id = ?", id)!;
    const o = portalOwner(id, x.contact, createdDaysAgo, createdDaysAgo > 5 ? createdDaysAgo - 2 : 0);
    db.prepare("INSERT OR REPLACE INTO subcontractor_contacts(subcontractor_id, role, name, title, email, phone) VALUES (?, 'primary', ?, 'Primary contact', ?, ?)").run(id, x.contact, o.email, one<{ phone: string }>("SELECT phone FROM subcontractors WHERE id = ?", id)!.phone);
    db.prepare("UPDATE subcontractors SET email = ? WHERE id = ?").run(o.email, id);
    db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES ('subcontractor',?, 'registration', ?, NULL, ?)").run(id, `Supplier registration started by ${x.contact} (${ent.country})`, sql(stamp(createdDaysAgo)));
    return { id, slug: s.portal_slug, email: o.email, x };
  };
  const full = (p: { id: number; x: SupplierSeed }, idx: number, docsDaysAgo: number, o: { skip?: string[] } = {}) => {
    fillProfile(p.id, { legalForm: p.x.legalForm, year: p.x.year, employees: p.x.employees, turnover: p.x.turnover, regions: p.x.regions, cats: p.x.cats, catStatus: "requested", idx: 40 + idx, contactName: p.x.contact });
    uploadDocs(p.id, { daysAgo: docsDaysAgo, uploader: p.x.contact, skip: o.skip });
  };
  const items = (id: number, at: number, accept: { sections?: string[]; docs?: string[] }) => {
    for (const k of accept.sections ?? []) setItemVerdict(db, id, reviewer, "section", k, "accepted", null, stamp(at, 11));
    for (const k of accept.docs ?? []) setItemVerdict(db, id, reviewer, "document", k, "accepted", null, stamp(at, 11));
  };
  const licence = ent.code === "OM" ? "cr" : "trade_licence";
  const mandatoryCodes = (id: number) => requiredDocs(db, ent.id, groupsOf(getCategories(db, id))).filter((d) => d.mandatory).map((d) => d.code);
  const info = (p: { slug: string; email: string; x: SupplierSeed }) => ({ company: p.x.name, slug: p.slug, email: p.email });

  // chronological order (registration numbers ascend): rejected, resubmitted, referred back, approved this week, under review, submitted x2, draft
  const pRej = create(pl[6], 6, 44);
  full(pRej, 6, 41);
  submitRegistration(db, pRej.id, { now: stamp(40, 9), actorName: pl[6].contact });
  startReview(db, pRej.id, reviewer, stamp(36, 10));
  reject(db, pRej.id, reviewer, PP.texts.rejectReason, { now: stamp(33, 15) });

  const pRes = create(pl[5], 5, 34);
  full(pRes, 5, 31);
  submitRegistration(db, pRes.id, { now: stamp(30, 9), actorName: pl[5].contact });
  startReview(db, pRes.id, reviewer, stamp(27, 10));
  items(pRes.id, 27, { sections: ["company", "categories", "contacts", "hse"], docs: mandatoryCodes(pRes.id).filter((c) => c !== licence).slice(0, 5) });
  setItemVerdict(db, pRes.id, reviewer, "document", licence, "query", PP.texts.licenceQuery, stamp(27, 12));
  setItemVerdict(db, pRes.id, reviewer, "section", "experience", "query", PP.texts.experienceQuery, stamp(27, 12));
  referBack(db, pRes.id, reviewer, "Two items need to be corrected before we can continue.", { now: stamp(26, 9) });
  { // the supplier fixes both queries and resubmits (second round)
    const att = file(pRes.id, licence, "Commercial registration (re-scan)", 3, pl[5].contact);
    addDocumentVersion(db, pRes.id, { code: licence, attachmentId: att, refNo: `${licence.toUpperCase()}-RESCAN-${pRes.id}`, issueDate: addDays(TODAY, -200), expiryDate: addDays(TODAY, 330), uploadedByName: pl[5].contact, legacyType: legacyDocType(licence), createdAt: stamp(3, 10) });
    db.prepare("UPDATE subcontractor_experience SET year = ? WHERE subcontractor_id = ?").run(2025, pRes.id);
    markFixed(db, pRes.id, "section", "experience");
    submitRegistration(db, pRes.id, { now: stamp(2, 9), actorName: pl[5].contact });
  }

  const pRef = create(pl[4], 4, 24);
  full(pRef, 4, 21);
  submitRegistration(db, pRef.id, { now: stamp(20, 9), actorName: pl[4].contact });
  startReview(db, pRef.id, reviewer, stamp(16, 10));
  items(pRef.id, 16, { sections: ["company", "categories", "contacts", "experience"], docs: mandatoryCodes(pRef.id).filter((c) => !["insurance_wc", "bank_letter"].includes(c)).slice(0, 5) });
  setItemVerdict(db, pRef.id, reviewer, "section", "hse", "query", PP.texts.hseQuery, stamp(16, 12));
  setItemVerdict(db, pRef.id, reviewer, "document", "insurance_wc", "query", PP.texts.insuranceQuery, stamp(16, 12));
  setItemVerdict(db, pRef.id, reviewer, "document", "bank_letter", "query", PP.texts.bankQuery, stamp(16, 12));
  referBack(db, pRef.id, reviewer, "Please correct the three items below and resubmit your registration.", { now: stamp(15, 9) });

  const pApp = create(pl[7], 7, 17);
  full(pApp, 7, 15);
  submitRegistration(db, pApp.id, { now: stamp(14, 9), actorName: pl[7].contact });
  startReview(db, pApp.id, reviewer, stamp(10, 10));
  items(pApp.id, 9, { sections: ["company", "categories", "contacts", "hse", "experience"], docs: mandatoryCodes(pApp.id) });
  applyApproval(db, pApp.id, { registration: true, categories: getCategories(db, pApp.id).map((c) => c.category_id), grade: "B", valid_until: addDays(addDays(TODAY, -3), 365), note: "Approved after document and reference checks." }, reviewer, { now: stamp(3, 14) });

  const pRev = create(pl[3], 3, 15);
  full(pRev, 3, 13);
  submitRegistration(db, pRev.id, { now: stamp(12, 9), actorName: pl[3].contact });
  startReview(db, pRev.id, reviewer, stamp(9, 10));
  items(pRev.id, 8, { sections: ["company", "categories", "contacts"], docs: mandatoryCodes(pRev.id).slice(0, 4) });

  const pSub2 = create(pl[2], 2, 10);
  full(pSub2, 2, 9);
  submitRegistration(db, pSub2.id, { now: stamp(8, 9), actorName: pl[2].contact });
  const pSub1 = create(pl[1], 1, 4);
  full(pSub1, 1, 3);
  submitRegistration(db, pSub1.id, { now: stamp(2, 9), actorName: pl[1].contact });
  const pDraft = create(pl[0], 0, 4);
  fillProfile(pDraft.id, { legalForm: pl[0].legalForm, year: pl[0].year, employees: pl[0].employees, turnover: pl[0].turnover, regions: pl[0].regions, cats: pl[0].cats, catStatus: "requested", idx: 40, contactName: pl[0].contact, partial: true });

  // a couple of notifications are already read, the rest stay unread so the bell shows them
  db.prepare("UPDATE portal_notifications SET read_at = ? WHERE kind = 'registration_received' AND subcontractor_id IN (SELECT id FROM subcontractors WHERE entity_id = ?)").run(stamp(1, 10), entityId);

  return {
    entityId, code: ent.code, referredBack: info(pRef), resubmitted: info(pRes), draft: info(pDraft), approvedThisWeek: info(pApp), rejected: info(pRej),
    procurementUsers, extraApproved,
  };
}
