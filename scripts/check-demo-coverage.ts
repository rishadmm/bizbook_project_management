// Demo-data coverage check for the multi-country database. Run after `npm run seed`:  npm run check:demo
//  1. For every country (entity) it extracts that country's rows into a scratch database and runs scripts/check-demo-entity.ts on it
//     (the full per-country coverage rules: map, status mix, approvals, dashboard, invoices, portals, region profile; for Oman a leak scan restricted to OM rows).
//  2. Multi-country assertions on the real database: entities / currencies / FX pegs, USD equivalents (currency + locked rate on every money row, `_usd` = amount x rate,
//     Oman rows OMR x 2.60078, UAE rows AED x 0.272294), country access, entity consistency of links and approvals.
// Exit code 1 on any gap.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "@/lib/db";
import { FX_TABLES } from "@/lib/fx-tables";
import { entityOfAttachmentOwner } from "@/lib/entities";
import { getDb } from "@/lib/db";
import { completenessOf } from "@/features/supplier-registration/core";
import { internalBids, internalPrices, internalResponses, sealOf } from "@/features/procurement/bid-core";
import { portalTenders } from "@/features/procurement/portal-queries";
import { RFX_STATUSES } from "@/lib/rfx";
import { getPublicNotices } from "@/features/supplier-registration/queries";
import { rateLimitOk, resetRateLimits } from "@/lib/rate-limit";
import { REGISTRATION_STATUSES } from "@/lib/registration";
import { SYSTEM_ROLES } from "@/lib/role-defaults";

const db = getDb();
const rows: { area: string; check: string; value: string; need: string; ok: boolean }[] = [];
const check = (area: string, name: string, value: number | string, need: string, ok: boolean) => rows.push({ area, check: name, value: String(value), need, ok });
const one = <T = Record<string, number>>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as never[])) as T;
const all = <T = Record<string, number>>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[];
const n = (sql: string, ...a: unknown[]) => (one<{ n: number }>(sql, ...a)).n;

const REGIONS: [code: string, region: string][] = [["AE", "uae"], ["OM", "oman"]];
let failed = 0;

/** Copies the database and removes every row that belongs to another country (children go through ON DELETE CASCADE). */
function extract(code: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "check-demo-")), `${code}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const eid = n("SELECT id n FROM entities WHERE code = ?", code);
  // attachments / activity rows of other countries (their owner is resolved through the original database)
  const dropAtt = all<{ id: number; entity_type: string; entity_id: number }>("SELECT id, entity_type, entity_id FROM attachments").filter((a) => { const e = entityOfAttachmentOwner(a.entity_type, a.entity_id); return e !== undefined && e !== eid; }).map((a) => a.id);
  const dropAct = all<{ id: number; entity_type: string; entity_id: number }>("SELECT id, entity_type, entity_id FROM activity_log").filter((a) => { const e = entityOfAttachmentOwner(a.entity_type, a.entity_id); return e !== undefined && e !== eid; }).map((a) => a.id);
  const x = new Database(file);
  x.pragma("foreign_keys = ON");
  x.transaction(() => {
    for (const id of dropAtt) x.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    for (const id of dropAct) x.prepare("DELETE FROM activity_log WHERE id = ?").run(id);
    x.prepare("DELETE FROM approval_requests WHERE entity_id <> ?").run(eid);
    x.prepare("DELETE FROM email_outbox WHERE entity_id IS NOT NULL AND entity_id <> ?").run(eid);
    x.prepare("DELETE FROM registration_doc_types WHERE entity_id <> ?").run(eid);
    x.prepare("DELETE FROM rfx_templates WHERE entity_id IS NOT NULL AND entity_id <> ?").run(eid);
    x.prepare("DELETE FROM supplier_categories WHERE entity_id IS NOT NULL AND entity_id <> ?").run(eid);
    x.prepare("DELETE FROM approval_workflows WHERE entity_id IS NOT NULL AND entity_id <> ?").run(eid);
    x.prepare("DELETE FROM projects WHERE entity_id <> ?").run(eid);
    x.prepare("DELETE FROM tenders WHERE entity_id <> ?").run(eid);
    x.prepare("DELETE FROM subcontractors WHERE entity_id <> ?").run(eid);
    x.prepare("DELETE FROM clients WHERE entity_id <> ?").run(eid);
    // audit tables without a foreign key to the deleted parents
    x.prepare("DELETE FROM portal_auth_events WHERE subcontractor_id IS NOT NULL AND subcontractor_id NOT IN (SELECT id FROM subcontractors)").run();
    x.prepare("DELETE FROM client_auth_events WHERE client_id IS NOT NULL AND client_id NOT IN (SELECT id FROM clients)").run();
  })();
  x.close();
  return file;
}

for (const [code, region] of REGIONS) {
  const file = extract(code);
  console.log(`\n================ ${code} (${region}) ================`);
  const r = spawnSync("npx", ["tsx", "scripts/check-demo-entity.ts"], {
    stdio: "inherit", env: { ...process.env, OPS_DB_PATH: file, SEED_REGION: region },
  });
  check("Country", `${code}: per-country coverage checks`, r.status === 0 ? "passed" : "FAILED", "all pass", r.status === 0);
  if (r.status !== 0) failed++;
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

/* ---------------------------------------------------------------- multi-country checks (real database) */
const ae = one<{ id: number; currency: string; doc_prefix: string }>("SELECT * FROM entities WHERE code = 'AE'"), om = one<{ id: number; currency: string; doc_prefix: string }>("SELECT * FROM entities WHERE code = 'OM'");
check("Entities", "entities AE + OM", n("SELECT COUNT(*) n FROM entities WHERE code IN ('AE','OM')"), "= 2", n("SELECT COUNT(*) n FROM entities WHERE code IN ('AE','OM')") === 2);
check("Entities", "currencies AED / OMR / USD / SAR / QAR / KWD / BHD", n("SELECT COUNT(*) n FROM currencies WHERE code IN ('AED','OMR','USD','SAR','QAR','KWD','BHD')"), "= 7", n("SELECT COUNT(*) n FROM currencies WHERE code IN ('AED','OMR','USD','SAR','QAR','KWD','BHD')") === 7);
check("Entities", "decimals AED 2 / OMR 3 / KWD 3", all<{ code: string; decimals: number }>("SELECT code, decimals FROM currencies WHERE code IN ('AED','OMR','KWD') ORDER BY code").map((c) => `${c.code} ${c.decimals}`).join(", "), "AED 2, KWD 3, OMR 3",
  all<{ code: string; decimals: number }>("SELECT code, decimals FROM currencies WHERE code IN ('AED','OMR','KWD') ORDER BY code").map((c) => `${c.code}:${c.decimals}`).join(",") === "AED:2,KWD:3,OMR:3");
check("Entities", "AE currency / prefix", `${ae.currency} / "${ae.doc_prefix}"`, 'AED / ""', ae.currency === "AED" && ae.doc_prefix === "");
check("Entities", "OM currency / prefix", `${om.currency} / "${om.doc_prefix}"`, 'OMR / "OM-"', om.currency === "OMR" && om.doc_prefix === "OM-");
const peg = (c: string) => (one<{ r: number } | undefined>("SELECT rate_to_usd r FROM fx_rates WHERE currency = ? ORDER BY effective_date LIMIT 1", c))?.r;
check("FX", "peg rates AED / OMR / USD", `${peg("AED")} / ${peg("OMR")} / ${peg("USD")}`, "0.272294 / 2.60078 / 1", peg("AED") === 0.272294 && peg("OMR") === 2.60078 && peg("USD") === 1);
check("FX", "reporting currency setting", one<{ v: string }>("SELECT value v FROM settings WHERE key = 'reporting_currency'").v, "= USD", one<{ v: string }>("SELECT value v FROM settings WHERE key = 'reporting_currency'").v === "USD");

// every money row carries currency + fx_rate_usd + fx_date; `_usd` = amount x rate; country rate / currency
let missing = 0, badUsd = 0, badRate = 0;
const cols = (t: string) => (db.prepare(`PRAGMA table_xinfo(${t})`).all() as { name: string }[]).map((c) => c.name);
for (const t of FX_TABLES) {
  const total = n(`SELECT COUNT(*) n FROM ${t.table}`);
  const miss = n(`SELECT COUNT(*) n FROM ${t.table} WHERE currency IS NULL OR fx_rate_usd IS NULL OR fx_date IS NULL`);
  missing += miss;
  for (const c of t.money) {
    if (!cols(t.table).includes(`${c}_usd`)) { badUsd++; continue; }
    badUsd += n(`SELECT COUNT(*) n FROM ${t.table} WHERE ${c} IS NOT NULL AND ${c}_usd IS NOT NULL AND abs(${c}_usd - round(${c} * fx_rate_usd, 2)) > 0.005`);
  }
  for (const c of t.rates ?? []) badUsd += n(`SELECT COUNT(*) n FROM ${t.table} WHERE ${c} IS NOT NULL AND ${c}_usd IS NOT NULL AND abs(${c}_usd - round(${c} * fx_rate_usd, 4)) > 0.00005`);
  // rate/currency of the row's country: the entity of the row through its parent (same expressions as the triggers)
  const ent = t.entity.split("{r}").join(t.table);
  badRate += n(`SELECT COUNT(*) n FROM ${t.table} WHERE (${ent}) = ${ae.id} AND (currency <> 'AED' OR fx_rate_usd <> 0.272294)`);
  badRate += n(`SELECT COUNT(*) n FROM ${t.table} WHERE (${ent}) = ${om.id} AND (currency <> 'OMR' OR fx_rate_usd <> 2.60078)`);
  check("USD layer", `${t.table}: rows / without currency+rate / _usd mismatches`, `${total} / ${miss}`, "all rows filled", miss === 0);
}
check("USD layer", `money rows in ${FX_TABLES.length} tables without currency / rate / date`, missing, "= 0", missing === 0);
check("USD layer", "_usd differs from amount x locked rate (all money columns)", badUsd, "= 0", badUsd === 0);
check("USD layer", "UAE rows are AED x 0.272294, Oman rows OMR x 2.60078", badRate, "= 0 deviations", badRate === 0);
const sample = one<{ g: number; u: number; r: number; c: string }>("SELECT i.gross_amount g, i.gross_amount_usd u, i.fx_rate_usd r, i.currency c FROM sub_invoices i JOIN projects p ON p.id = i.project_id WHERE p.entity_id = ? ORDER BY i.id DESC LIMIT 1", om.id);
check("USD layer", "sample Oman invoice: gross OMR x 2.60078 = USD", `${sample.g} ${sample.c} -> ${sample.u}`, `= ${(Math.round(sample.g * 2.60078 * 100) / 100)}`, Math.abs(sample.u - Math.round(sample.g * 2.60078 * 100) / 100) < 0.006);

// country access + consistency
check("Access", "users with no country access row (non-admin)", n("SELECT COUNT(*) n FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE COALESCE(r.code, u.role) NOT IN ('super_admin','admin') AND NOT EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id)"), "= 0", n("SELECT COUNT(*) n FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE COALESCE(r.code, u.role) NOT IN ('super_admin','admin') AND NOT EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id)") === 0);
check("Access", "admin has both countries", n("SELECT COUNT(*) n FROM user_entities ue JOIN users u ON u.id = ue.user_id WHERE u.email = 'admin@alnoor.demo'"), "= 2", n("SELECT COUNT(*) n FROM user_entities ue JOIN users u ON u.id = ue.user_id WHERE u.email = 'admin@alnoor.demo'") === 2);
const omOnly = n("SELECT COUNT(*) n FROM users u WHERE EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?) AND NOT EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?)", om.id, ae.id);
check("Access", "Oman-only users", omOnly, ">= 5", omOnly >= 5);
check("Access", "UAE-only users", n("SELECT COUNT(*) n FROM users u WHERE EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?) AND NOT EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?)", ae.id, om.id), ">= 3", n("SELECT COUNT(*) n FROM users u WHERE EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?) AND NOT EXISTS (SELECT 1 FROM user_entities ue WHERE ue.user_id = u.id AND ue.entity_id = ?)", ae.id, om.id) >= 3);
check("Consistency", "assignments linking a project and a subcontractor of different countries", n("SELECT COUNT(*) n FROM assignments a JOIN projects p ON p.id = a.project_id JOIN subcontractors s ON s.id = a.subcontractor_id WHERE p.entity_id <> s.entity_id"), "= 0", n("SELECT COUNT(*) n FROM assignments a JOIN projects p ON p.id = a.project_id JOIN subcontractors s ON s.id = a.subcontractor_id WHERE p.entity_id <> s.entity_id") === 0);
check("Consistency", "projects / tenders whose client is in another country", n("SELECT (SELECT COUNT(*) FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.entity_id <> p.entity_id) + (SELECT COUNT(*) FROM tenders t JOIN clients c ON c.id = t.client_id WHERE c.entity_id <> t.entity_id) n"), "= 0", n("SELECT (SELECT COUNT(*) FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.entity_id <> p.entity_id) + (SELECT COUNT(*) FROM tenders t JOIN clients c ON c.id = t.client_id WHERE c.entity_id <> t.entity_id) n") === 0);
check("Consistency", "approval requests whose country differs from their document's", n(`SELECT COUNT(*) n FROM approval_requests r WHERE
  (r.document_type IN ('tender_submission','tender_award') AND r.entity_id <> (SELECT entity_id FROM tenders WHERE id = r.document_id))
  OR (r.document_type = 'sub_invoice' AND r.entity_id <> (SELECT p.entity_id FROM sub_invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = r.document_id))
  OR (r.document_type = 'subcontract_award' AND r.entity_id <> (SELECT p.entity_id FROM assignments a JOIN projects p ON p.id = a.project_id WHERE a.id = r.document_id))`), "= 0", n(`SELECT COUNT(*) n FROM approval_requests r WHERE
  (r.document_type IN ('tender_submission','tender_award') AND r.entity_id <> (SELECT entity_id FROM tenders WHERE id = r.document_id))
  OR (r.document_type = 'sub_invoice' AND r.entity_id <> (SELECT p.entity_id FROM sub_invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = r.document_id))
  OR (r.document_type = 'subcontract_award' AND r.entity_id <> (SELECT p.entity_id FROM assignments a JOIN projects p ON p.id = a.project_id WHERE a.id = r.document_id))`) === 0);
check("Consistency", "Oman workflows with OMR-sized thresholds (max < UAE max)", `${one<{ m: number }>("SELECT MAX(condition_min_amount) m FROM approval_workflows WHERE entity_id = ?", om.id).m} vs ${one<{ m: number }>("SELECT MAX(condition_min_amount) m FROM approval_workflows WHERE entity_id IS NULL").m}`, "OM < UAE",
  one<{ m: number }>("SELECT MAX(condition_min_amount) m FROM approval_workflows WHERE entity_id = ?", om.id).m < one<{ m: number }>("SELECT MAX(condition_min_amount) m FROM approval_workflows WHERE entity_id IS NULL").m);
check("Consistency", "legacy per-country settings left behind", n("SELECT COUNT(*) n FROM settings WHERE key IN ('currency','company_address','company_trn','tax_label','map_center','approval_cost_threshold')"), "= 0", n("SELECT COUNT(*) n FROM settings WHERE key IN ('currency','company_address','company_trn','tax_label','map_center','approval_cost_threshold')") === 0);

/* ---------------------------------------------------------------- procurement: supplier registration (SUPPLIER_TENDERING_SPEC Part A) */
/** Part B adds its own tender templates to this list when it seeds them. */
const REGISTRATION_TEMPLATES = ["registration_received", "registration_referred_back", "registration_approved", "registration_rejected",
  // supplier tendering (Part B)
  "tender_invitation", "addendum_issued", "clarification_answered", "bid_received", "award_letter", "regret"];
for (const [code, ent] of [["AE", ae], ["OM", om]] as const) {
  const sub = (where: string, ...a: unknown[]) => n(`SELECT COUNT(*) n FROM subcontractors WHERE entity_id = ? AND ${where}`, ent.id, ...a);
  for (const st of Object.keys(REGISTRATION_STATUSES)) check("Registration", `${code}: suppliers with status ${st}`, sub("registration_status = ?", st), ">= 1", sub("registration_status = ?", st) >= 1);
  check("Registration", `${code}: 8 extra approved suppliers (approved without a legacy checklist)`, sub("registration_status = 'approved' AND registration_no IS NOT NULL AND id NOT IN (SELECT id FROM subcontractors WHERE entity_id = ? ORDER BY id LIMIT 11)", ent.id), ">= 8", sub("registration_status = 'approved' AND registration_no IS NOT NULL AND id NOT IN (SELECT id FROM subcontractors WHERE entity_id = ? ORDER BY id LIMIT 11)", ent.id) >= 8);
  const ref = one<{ id: number }>("SELECT id FROM subcontractors WHERE entity_id = ? AND registration_status = 'referred_back' ORDER BY id LIMIT 1", ent.id);
  const queried = n("SELECT COUNT(*) n FROM registration_items WHERE subcontractor_id = ? AND status = 'query' AND comment IS NOT NULL", ref.id);
  check("Registration", `${code}: referred-back supplier has 3 queried items with comments`, queried, "= 3", queried === 3);
  check("Registration", `${code}: referred-back supplier has its e-mail in the outbox`, n("SELECT COUNT(*) n FROM email_outbox WHERE related_id = ? AND template = 'registration_referred_back'", ref.id), ">= 1", n("SELECT COUNT(*) n FROM email_outbox WHERE related_id = ? AND template = 'registration_referred_back'", ref.id) >= 1);
  const res = n("SELECT COUNT(*) n FROM subcontractors WHERE entity_id = ? AND registration_status = 'submitted' AND resubmit_count >= 1", ent.id);
  check("Registration", `${code}: a resubmitted registration (second round)`, res, ">= 1", res >= 1);
  const under = n("SELECT COUNT(*) n FROM subcontractors s WHERE entity_id = ? AND registration_status = 'under_review' AND reviewed_by IS NOT NULL AND EXISTS (SELECT 1 FROM registration_items i WHERE i.subcontractor_id = s.id AND i.status = 'accepted')", ent.id);
  check("Registration", `${code}: under-review supplier with a reviewer and accepted items`, under, ">= 1", under >= 1);
  check("Registration", `${code}: rejected supplier has a reason`, sub("registration_status = 'rejected' AND reject_reason IS NOT NULL"), ">= 1", sub("registration_status = 'rejected' AND reject_reason IS NOT NULL") >= 1);
  check("Registration", `${code}: approved this week`, sub("registration_status = 'approved' AND reviewed_at >= ?", new Date(Date.now() - 7 * 86_400_000).toISOString()), ">= 1", sub("registration_status = 'approved' AND reviewed_at >= ?", new Date(Date.now() - 7 * 86_400_000).toISOString()) >= 1);
  // a complete registration profile: categories, 3+ contacts, 2+ references, accepted mandatory documents (approved suppliers); every non-draft submission is 100 % complete
  const approved = all<{ id: number }>("SELECT id FROM subcontractors WHERE entity_id = ? AND registration_status = 'approved' AND registration_no IS NOT NULL", ent.id);
  const thin = approved.filter((s) => n("SELECT COUNT(*) n FROM subcontractor_categories WHERE subcontractor_id = ? AND status = 'approved'", s.id) < 1 || n("SELECT COUNT(*) n FROM subcontractor_contacts WHERE subcontractor_id = ?", s.id) < 3
    || n("SELECT COUNT(*) n FROM subcontractor_experience WHERE subcontractor_id = ?", s.id) < 2 || n("SELECT COUNT(*) n FROM registration_reviews WHERE subcontractor_id = ? AND decision = 'approve'", s.id) < 1);
  check("Registration", `${code}: approved suppliers without categories / contacts / references / approval history`, thin.length, "= 0", thin.length === 0);
  const incomplete = all<{ id: number }>("SELECT id FROM subcontractors WHERE entity_id = ? AND registration_status IN ('submitted','referred_back','rejected') ", ent.id).filter((s) => completenessOf(getDb(), s.id) < 100);
  check("Registration", `${code}: submitted / referred back / rejected registrations that are not 100 % complete`, incomplete.length, "= 0", incomplete.length === 0);
  for (const t of REGISTRATION_TEMPLATES) check("Outbox", `${code}: outbox has template ${t}`, n("SELECT COUNT(*) n FROM email_outbox WHERE entity_id = ? AND template = ?", ent.id, t), ">= 1", n("SELECT COUNT(*) n FROM email_outbox WHERE entity_id = ? AND template = ?", ent.id, t) >= 1);
  const wrongType = n("SELECT COUNT(*) n FROM subcontractor_documents d JOIN subcontractors s ON s.id = d.subcontractor_id WHERE s.entity_id = ? AND d.doc_type_code IS NOT NULL AND d.doc_type_code NOT IN (SELECT code FROM registration_doc_types WHERE entity_id = ?)", ent.id, ent.id);
  check("Registration", `${code}: registration documents of a type the country does not define`, wrongType, "= 0", wrongType === 0);
  const noPortal = n("SELECT COUNT(*) n FROM subcontractors s WHERE entity_id = ? AND registration_no IS NOT NULL AND status IN ('approved', 'prospect') AND registration_status <> 'under_review' AND NOT EXISTS (SELECT 1 FROM portal_users u WHERE u.subcontractor_id = s.id)", ent.id);
  check("Registration", `${code}: registered suppliers without a portal login`, noPortal, "= 0", noPortal === 0);
}
/* ---------------------------------------------------------------- procurement: supplier tendering (SUPPLIER_TENDERING_SPEC Part B) */
for (const [code, ent] of [["AE", ae], ["OM", om]] as const) {
  const t = (where: string, ...a: unknown[]) => n(`SELECT COUNT(*) n FROM rfx_tenders WHERE entity_id = ? AND ${where}`, ent.id, ...a);
  for (const st of RFX_STATUSES) check("Tendering", `${code}: supplier tenders with status ${st}`, t("status = ?", st), ">= 1", t("status = ?", st) >= 1);
  const asgN = n("SELECT COUNT(*) n FROM assignments a JOIN projects p ON p.id = a.project_id WHERE p.entity_id = ?", ent.id);
  const tenderN = n("SELECT COUNT(*) n FROM assignments a JOIN projects p ON p.id = a.project_id WHERE p.entity_id = ? AND a.source = 'tender'", ent.id);
  const share = (tenderN / asgN) * 100;
  check("Tendering", `${code}: assignments that came through a tender`, `${tenderN}/${asgN} = ${share.toFixed(1)}%`, "80% +/- 2", Math.abs(share - 80) <= 2);
  const bad = all<{ id: number }>(`SELECT t.id FROM rfx_tenders t JOIN assignments a ON a.id = t.assignment_id WHERE t.entity_id = ? AND t.status = 'awarded'
    AND ((SELECT COUNT(*) FROM rfx_bids b WHERE b.rfx_id = t.id AND b.status = 'awarded') <> 1 OR abs((SELECT total_amount FROM rfx_bids b WHERE b.id = t.awarded_bid_id) - a.contract_value) > 0.001
      OR a.rfx_id <> t.id OR a.rfx_bid_id <> t.awarded_bid_id OR a.source <> 'tender')`, ent.id);
  check("Tendering", `${code}: awarded tenders without exactly 1 awarded bid equal to the contract value (or BAFO)`, bad.length, "= 0", bad.length === 0);
  check("Tendering", `${code}: awarded tenders without an approved rfx_award request`, n("SELECT COUNT(*) n FROM rfx_tenders t WHERE t.entity_id = ? AND t.status = 'awarded' AND NOT EXISTS (SELECT 1 FROM approval_requests r WHERE r.document_type = 'rfx_award' AND r.document_id = t.id AND r.status = 'approved')", ent.id), "= 0", n("SELECT COUNT(*) n FROM rfx_tenders t WHERE t.entity_id = ? AND t.status = 'awarded' AND NOT EXISTS (SELECT 1 FROM approval_requests r WHERE r.document_type = 'rfx_award' AND r.document_id = t.id AND r.status = 'approved')", ent.id) === 0);
  check("Tendering", `${code}: open approval tasks for rfx_publish / rfx_award`, n("SELECT COUNT(*) n FROM approval_requests WHERE entity_id = ? AND document_type IN ('rfx_publish', 'rfx_award') AND status = 'pending'", ent.id), ">= 2", n("SELECT COUNT(*) n FROM approval_requests WHERE entity_id = ? AND document_type IN ('rfx_publish', 'rfx_award') AND status = 'pending'", ent.id) >= 2);
  // sealed-bid rule through the query layer: no internal-visible price before the relevant opening
  let leaks = 0, sealedChecked = 0;
  for (const x of all<{ id: number }>("SELECT id FROM rfx_tenders WHERE entity_id = ? AND status IN ('published', 'closed', 'opening', 'evaluation', 'cancelled')", ent.id)) {
    const seal = sealOf(db, { id: x.id, evaluation_method: one<{ m: string }>("SELECT evaluation_method m FROM rfx_tenders WHERE id = ?", x.id).m });
    const bids = internalBids(db, x.id);
    for (const b of bids) {
      const shouldSeal = !seal.techOpen || !seal.priceOpen;
      if (!seal.techOpen) { sealedChecked++; if (b.supplier_name !== null || b.total_amount !== null || internalResponses(db, b.id).length || internalPrices(db, b.id) !== null) leaks++; }
      else if (shouldSeal && !b.price_visible) { sealedChecked++; if (b.total_amount !== null || internalPrices(db, b.id) !== null || b.final_score !== null) leaks++; }
    }
  }
  check("Tendering", `${code}: sealed bids exposing a name, content or price to internal users (${sealedChecked} sealed bids checked)`, leaks, "= 0", leaks === 0 && sealedChecked > 0);
  check("Tendering", `${code}: supplier tender templates (shared)`, n("SELECT COUNT(*) n FROM rfx_templates WHERE entity_id IS NULL"), "= 4", n("SELECT COUNT(*) n FROM rfx_templates WHERE entity_id IS NULL") === 4);
  check("Tendering", `${code}: rfx_publish + rfx_award workflows`, n("SELECT COUNT(*) n FROM approval_workflows WHERE document_type IN ('rfx_publish', 'rfx_award') AND (entity_id IS NULL OR entity_id = ?)", ent.id), ">= 3", n("SELECT COUNT(*) n FROM approval_workflows WHERE document_type IN ('rfx_publish', 'rfx_award') AND (entity_id IS NULL OR entity_id = ?)", ent.id) >= 3);
  const demoSub = code === "AE" ? "gulf-trench" : "al-hajar";
  const sid = n("SELECT id n FROM subcontractors WHERE portal_slug = ?", demoSub);
  const dopen = portalTenders(sid, ent.id, "opportunities").length, dbids = portalTenders(sid, ent.id, "bids");
  check("Tendering", `${code}: demo supplier ${demoSub} opportunities / draft bid / submitted bid / award`, `${dopen} / ${dbids.filter((b) => b.my_status === "draft").length} / ${n("SELECT COUNT(*) n FROM rfx_bids WHERE subcontractor_id = ? AND status IN ('submitted', 'qualified')", sid)} / ${portalTenders(sid, ent.id, "awarded").length}`, "all >= 1",
    dopen >= 1 && dbids.some((b) => b.my_status === "draft") && n("SELECT COUNT(*) n FROM rfx_bids WHERE subcontractor_id = ? AND status IN ('submitted', 'qualified')", sid) >= 1 && portalTenders(sid, ent.id, "awarded").length >= 1);
  // one stage cannot be awarded / assigned and out to tender at the same time (a terminated assignment = a re-tender, which is fine)
  const clash = all<{ code: string; ac: string | null }>(`SELECT t.code, a.code ac FROM rfx_tenders t JOIN rfx_scope sc ON sc.rfx_id = t.id JOIN assignments a ON a.stage_id = sc.stage_id
    WHERE t.entity_id = ? AND t.status NOT IN ('awarded', 'cancelled') AND a.status <> 'terminated'`, ent.id);
  check("Tendering", `${code}: live tenders sharing a stage with a non-terminated assignment${clash.length ? ` (${clash.map((c) => `${c.code}/${c.ac}`).join(", ")})` : ""}`, clash.length, "= 0", clash.length === 0);
  const twoLive = n(`SELECT COUNT(*) n FROM (SELECT sc.stage_id FROM rfx_scope sc JOIN rfx_tenders t ON t.id = sc.rfx_id WHERE t.entity_id = ? AND t.status NOT IN ('awarded', 'cancelled') GROUP BY sc.stage_id HAVING COUNT(*) > 1)`, ent.id);
  check("Tendering", `${code}: stages in more than one live tender`, twoLive, "= 0", twoLive === 0);
  // realistic BOQ data: whole quantities for count / time units, <= 1 dp for areas / volumes / km, rates with 2 dp (AED) or 3 dp (OMR)
  const dpf = code === "OM" ? 1000 : 100;
  const WHOLE = "('m', 'day', 'man-day', 'month', 'nos', 'nr', 'ls', 'lot', 'set', 'lumpsum', 'ton')";
  const badQty = n(`SELECT COUNT(*) n FROM rfx_boq_lines l JOIN rfx_tenders t ON t.id = l.rfx_id WHERE t.entity_id = ? AND ((lower(l.unit) IN ${WHOLE} AND abs(l.quantity - round(l.quantity)) > 1e-9) OR abs(l.quantity * 10 - round(l.quantity * 10)) > 1e-9)`, ent.id);
  check("Tendering", `${code}: BOQ lines with unrealistic quantities (decimals on count / time units, > 1 dp)`, badQty, "= 0", badQty === 0);
  const badRate = n(`SELECT (SELECT COUNT(*) FROM rfx_boq_lines l JOIN rfx_tenders t ON t.id = l.rfx_id WHERE t.entity_id = ? AND abs(l.estimate_rate * ${dpf} - round(l.estimate_rate * ${dpf})) > 1e-6)
    + (SELECT COUNT(*) FROM rfx_bid_prices p JOIN rfx_bids b ON b.id = p.bid_id JOIN rfx_tenders t ON t.id = b.rfx_id WHERE t.entity_id = ? AND abs(p.unit_rate * ${dpf} - round(p.unit_rate * ${dpf})) > 1e-6) n`, ent.id, ent.id);
  check("Tendering", `${code}: estimate / bid unit rates with more than ${dpf === 100 ? 2 : 3} decimals`, badRate, "= 0", badRate === 0);
  const lowBidders = n("SELECT COUNT(*) n FROM rfx_tenders t WHERE t.entity_id = ? AND t.status = 'awarded' AND (SELECT COUNT(*) FROM rfx_bids b WHERE b.rfx_id = t.id AND b.submitted_at IS NOT NULL) NOT BETWEEN 3 AND 6", ent.id);
  check("Tendering", `${code}: awarded tenders with fewer than 3 or more than 6 bidders`, lowBidders, "= 0", lowBidders === 0);
  const bafo = n("SELECT COUNT(*) n FROM rfx_bids b JOIN rfx_tenders t ON t.id = b.rfx_id WHERE t.entity_id = ? AND t.status = 'awarded' AND b.price_version > 1", ent.id);
  check("Tendering", `${code}: awarded tenders with a BAFO price version`, bafo, ">= 4", bafo >= 4);
}
check("Registration", "OM requires the PDO / OQ registration only for oil & gas categories", n("SELECT COUNT(*) n FROM registration_doc_types WHERE entity_id = ? AND code = 'pdo_registration' AND category_condition = 'group:Oil and gas'", om.id), "= 1", n("SELECT COUNT(*) n FROM registration_doc_types WHERE entity_id = ? AND code = 'pdo_registration' AND category_condition = 'group:Oil and gas'", om.id) === 1);
check("Registration", "supplier categories (master list)", n("SELECT COUNT(*) n FROM supplier_categories WHERE entity_id IS NULL"), ">= 17", n("SELECT COUNT(*) n FROM supplier_categories WHERE entity_id IS NULL") >= 17);
check("Registration", "public notice board query runs", getPublicNotices().length, ">= 0", Array.isArray(getPublicNotices()));
const proc = SYSTEM_ROLES.find((r) => r.code === "procurement")!;
const procPerms = n("SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'procurement' AND rp.module = 'procurement' AND rp.action <> 'award'");
check("Permissions", "procurement role: every procurement action except award", procPerms, `= ${proc.perms.procurement!.length}`, procPerms === proc.perms.procurement!.length && n("SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'procurement' AND rp.module = 'procurement' AND rp.action = 'award'") === 0);
check("Permissions", "procurement users: Rashid (UAE) and Asma (Oman)", n("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'procurement' AND u.email IN ('rashid.al.mazrouei@alnoor.demo', 'asma.al.harthy@alnoor.demo')"), "= 2", n("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'procurement' AND u.email IN ('rashid.al.mazrouei@alnoor.demo', 'asma.al.harthy@alnoor.demo')") === 2);
resetRateLimits();
const lim = Array.from({ length: 6 }, () => rateLimitOk("check", 5, 60_000));
check("Security", "public rate limit refuses the 6th hit within the window", lim.join(","), "5 true then false", lim.slice(0, 5).every(Boolean) && !lim[5]);
resetRateLimits();
void DB_PATH;

console.log("\n================ multi-country checks ================");
const w = { area: 12, check: 70, value: 36, need: 22 };
const line = (a: string, c: string, v: string, nn: string, s: string) => `${a.padEnd(w.area)} ${c.padEnd(w.check)} ${v.padStart(w.value)}  ${nn.padEnd(w.need)} ${s}`;
console.log(line("AREA", "CHECK", "VALUE", "REQUIRED", ""));
console.log("-".repeat(w.area + w.check + w.value + w.need + 8));
for (const r of rows) console.log(line(r.area, r.check, r.value, r.need, r.ok ? "ok" : "FAIL"));
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} multi-country checks passed; per-country runs failed: ${failed}.`);
if (bad.length) {
  console.log("\nGaps:");
  for (const r of bad) console.log(`  - [${r.area}] ${r.check}: got ${r.value}, need ${r.need}`);
  process.exit(1);
}
