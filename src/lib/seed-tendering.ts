/* eslint-disable @typescript-eslint/no-explicit-any */
// Supplier tendering seed (SUPPLIER_TENDERING_SPEC C1), called by seedProcurement() after the supplier registration data exists. APPENDS rows only:
//   - the 4 tender templates (all countries);
//   - per country: 32 of the 40 existing assignments get an AWARDED historic supplier tender (the other 8 stay direct); the assignment rows only receive source / rfx_id / rfx_bid_id;
//   - per country: 12 live tenders so that every status is demoable (draft, pending approval, scheduled, 2 published, closed, opened, technical evaluation, commercial evaluation,
//     recommended, award pending, cancelled).
// The raw rows (bids, answers, prices, marks, scores, openings) are written directly with back-dated timestamps; statuses, scores and ranks are then computed by the SAME evaluate()
// the application uses, so the demo data can never contradict the rules.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { addDays, todayISO } from "./format";
import { mailSupplier } from "./mailer";
import { niceRate, receiptPayload, roundTo } from "./rfx";
import { seedRequest } from "./approvals/seed-demo";
import type { RegionResult } from "./seed-engine";
import { miniPdf } from "./seed-files";
import { createDraft, goLive, invite, logRfx, replaceBoq, prefillBoq, boqOf, type RfxRow } from "../features/procurement/rfx-core";
import { evaluate, sendAwardLetters } from "../features/procurement/eval-core";

const TODAY = todayISO();
const DAY = 86_400_000;
/** Local 10:00 (UTC+4) = 06:00Z on a day offset from today (negative = past). */
const at = (offsetDays: number, hh = 10, mm = 0): string => { const d = new Date(`${addDays(TODAY, Math.floor(offsetDays))}T00:00:00Z`); return new Date(d.getTime() + ((hh - 4) * 60 + mm) * 60_000 + (offsetDays % 1) * DAY).toISOString(); };
const sqlOf = (iso: string) => iso.replace("T", " ").slice(0, 19);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/* ------------------------------------------------------------------ templates */

interface TplDef {
  key: string; name: string; description: string; method: "lowest_compliant" | "weighted" | "two_envelope_weighted"; tech: number; comm: number; pass: number; bond: number; perf: number; validity: number; minBidders: number; clar: number;
  steps: { key: string; name: string; kind: string; gate: "pass_fail" | "scored"; weight?: number; pass?: number; role: string; criteria?: [string, number, string][] }[];
  reqs: { name: string; kind: string; mandatory: boolean; env: "technical" | "commercial"; step: string | null; hint: string }[];
}
const TPLS: TplDef[] = [
  {
    key: "telecom", name: "Telecom civil & cable laying (two-envelope, 70/30)", description: "Fibre / duct-bank / cable-laying subcontracts. Technical envelope first (compliance, HSE, technical), prices stay sealed until the technical evaluation is complete.",
    method: "two_envelope_weighted", tech: 70, comm: 30, pass: 70, bond: 2, perf: 5, validity: 90, minBidders: 3, clar: 7,
    steps: [
      { key: "compliance", name: "Compliance", kind: "compliance", gate: "pass_fail", role: "Procurement" },
      { key: "hse", name: "HSE", kind: "hse", gate: "pass_fail", role: "HSE" },
      { key: "technical", name: "Technical", kind: "technical", gate: "scored", weight: 100, pass: 70, role: "Project manager / engineer", criteria: [
        ["Method statement", 30, "Sequence of work, trenching / HDD approach, reinstatement, testing."], ["Programme", 20, "Realistic Gantt, mobilisation, crew and rig loading."],
        ["Resources & equipment", 25, "Crews, rigs, plant and key staff actually available."], ["Experience", 25, "Similar completed projects, references, performance record."]] },
      { key: "commercial", name: "Commercial", kind: "commercial", gate: "scored", role: "Finance" },
    ],
    reqs: [
      { name: "Valid trade licence / commercial registration", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Copy of the licence valid on the closing date." },
      { name: "Bid bond", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Bank guarantee for the percentage stated in the tender." },
      { name: "HSE plan (incl. confined-space and traffic management)", kind: "document", mandatory: true, env: "technical", step: "hse", hint: "Project-specific HSE plan." },
      { name: "Method statement", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Trenching, ducting, pulling, splicing and testing." },
      { name: "Work programme (Gantt)", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Resource-loaded programme in PDF." },
      { name: "Equipment list", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Rigs, trenchers, compressors; owned vs hired." },
      { name: "Key staff CVs", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Project manager, supervisors, splicing lead, HSE officer." },
      { name: "Similar experience list", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "At least three comparable projects in the last five years." },
      { name: "Priced BOQ completed and arithmetically checked", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "Prices are entered in the commercial step of the bid." },
      { name: "Acceptance of the payment terms", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "Monthly certified invoices, retention as stated." },
    ],
  },
  {
    key: "pipeline", name: "Oil & gas pipeline works (HSE-critical, 60/40)", description: "Pipeline construction, welding, coating and hydrotest subcontracts in oil & gas environments. HSE is a scored gate with a high pass mark.",
    method: "two_envelope_weighted", tech: 60, comm: 40, pass: 70, bond: 2.5, perf: 10, validity: 120, minBidders: 3, clar: 10,
    steps: [
      { key: "compliance", name: "Compliance", kind: "compliance", gate: "pass_fail", role: "Procurement" },
      { key: "hse", name: "HSE", kind: "hse", gate: "scored", weight: 30, pass: 75, role: "HSE", criteria: [
        ["HSE management system", 25, "Certified system, procedures, audit record."], ["LTI statistics", 25, "LTI / TRIR for the last three years."],
        ["PDO / ADNOC approval", 25, "Valid client vendor approval for the activity."], ["Emergency response", 25, "Emergency response plan for the site, rescue capability."]] },
      { key: "technical", name: "Technical", kind: "technical", gate: "scored", weight: 70, pass: 70, role: "Project manager / engineer", criteria: [
        ["Method statement", 30, "Welding, NDT, lowering-in, tie-ins, hydrotest."], ["Welding & NDT capability", 25, "WPS / PQR, qualified welders, NDT crews."],
        ["Programme", 20, "Realistic programme with shutdown windows."], ["Experience", 25, "Comparable pipeline projects."]] },
      { key: "commercial", name: "Commercial", kind: "commercial", gate: "scored", role: "Finance" },
    ],
    reqs: [
      { name: "Valid trade licence / commercial registration", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Copy valid on the closing date." },
      { name: "Bid bond", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Bank guarantee for the stated percentage." },
      { name: "HSE management system and plan", kind: "document", mandatory: true, env: "technical", step: "hse", hint: "Certified system and a project HSE plan." },
      { name: "LTI statistics (last 3 years)", kind: "document", mandatory: true, env: "technical", step: "hse", hint: "Signed statistics." },
      { name: "PDO / ADNOC vendor approval", kind: "document", mandatory: true, env: "technical", step: "hse", hint: "Valid approval for the activity." },
      { name: "Emergency response plan", kind: "document", mandatory: true, env: "technical", step: "hse", hint: "Site-specific plan." },
      { name: "Method statement", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Pipelaying, welding, NDT, hydrotest." },
      { name: "Welding procedure (WPS / PQR)", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Qualified procedures for the pipe grade." },
      { name: "NDT plan", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "RT / UT / MPI coverage and crews." },
      { name: "QA/QC plan", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Inspection and test plan." },
      { name: "Work programme (Gantt)", kind: "document", mandatory: true, env: "technical", step: "technical", hint: "Resource-loaded programme." },
      { name: "ICV plan (Oman)", kind: "document", mandatory: false, env: "technical", step: null, hint: "Oman only: In-Country Value plan." },
      { name: "Priced BOQ completed and arithmetically checked", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "Prices are entered in the commercial step." },
      { name: "Acceptance of the payment terms", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "Monthly certified invoices, retention as stated." },
    ],
  },
  {
    key: "small", name: "Small works RFQ (lowest compliant)", description: "Quick request for quotation: compliance check, then the lowest compliant price wins.",
    method: "lowest_compliant", tech: 0, comm: 100, pass: 0, bond: 0, perf: 0, validity: 60, minBidders: 3, clar: 3,
    steps: [{ key: "compliance", name: "Compliance", kind: "compliance", gate: "pass_fail", role: "Procurement" }, { key: "commercial", name: "Commercial", kind: "commercial", gate: "scored", role: "Finance" }],
    reqs: [
      { name: "Valid trade licence / commercial registration", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Copy valid on the closing date." },
      { name: "Insurance certificate (workmen's compensation + third party)", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Valid for the contract period." },
      { name: "Short method statement", kind: "text", mandatory: true, env: "technical", step: "compliance", hint: "A few lines on how the work will be done." },
      { name: "Mobilisation time (days after award)", kind: "number", mandatory: true, env: "technical", step: "compliance", hint: "Calendar days." },
      { name: "Priced BOQ completed", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "Prices are entered in the commercial step." },
      { name: "Acceptance of the payment terms", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "As stated in the tender." },
    ],
  },
  {
    key: "plant", name: "Plant & equipment hire RFQ (lowest compliant)", description: "Hire of plant, vehicles or manpower: equipment details, insurance, operator certificates and the lowest compliant hire rates.",
    method: "lowest_compliant", tech: 0, comm: 100, pass: 0, bond: 0, perf: 0, validity: 45, minBidders: 3, clar: 3,
    steps: [{ key: "compliance", name: "Compliance", kind: "compliance", gate: "pass_fail", role: "Procurement" }, { key: "commercial", name: "Commercial", kind: "commercial", gate: "scored", role: "Finance" }],
    reqs: [
      { name: "Equipment list with year and model", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Year, model, capacity and availability." },
      { name: "Insurance (plant all-risks and third party)", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Valid for the hire period." },
      { name: "Operator certificates", kind: "document", mandatory: true, env: "technical", step: "compliance", hint: "Valid operator licences / competence certificates." },
      { name: "Priced hire rates completed", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "Rates are entered in the commercial step." },
      { name: "Acceptance of the payment terms", kind: "yes_no", mandatory: true, env: "commercial", step: null, hint: "As stated in the tender." },
    ],
  },
];

/** Inserts the four templates once (entity NULL = every country); returns template ids by key. */
export function seedTemplates(db: DB): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TPLS) {
    const id = Number(db.prepare(`INSERT INTO rfx_templates(entity_id, name, description, active, evaluation_method, tech_weight, commercial_weight, tech_pass_mark, bid_bond_pct, performance_bond_pct, default_validity_days, min_bidders, clarification_days_before_close)
      VALUES (NULL,?,?,1,?,?,?,?,?,?,?,?,?)`).run(t.name, t.description, t.method, t.tech, t.comm, t.pass, t.bond, t.perf, t.validity, t.minBidders, t.clar).lastInsertRowid);
    out[t.key] = id;
    const steps = new Map<string, number>();
    t.steps.forEach((s, i) => {
      const sid = Number(db.prepare("INSERT INTO rfx_template_steps(template_id, step_key, name, kind, gate, weight, pass_mark, evaluator_role, sort) VALUES (?,?,?,?,?,?,?,?,?)").run(id, s.key, s.name, s.kind, s.gate, s.weight ?? null, s.pass ?? null, s.role, i + 1).lastInsertRowid);
      steps.set(s.key, sid);
      (s.criteria ?? []).forEach((c, k) => db.prepare("INSERT INTO rfx_template_criteria(step_id, criterion, max_score, guidance, sort) VALUES (?,?,?,?,?)").run(sid, c[0], c[1], c[2], k + 1));
    });
    t.reqs.forEach((r, i) => db.prepare("INSERT INTO rfx_template_requirements(template_id, name, kind, mandatory, envelope, step_id, instructions, sort) VALUES (?,?,?,?,?,?,?,?)").run(id, r.name, r.kind, r.mandatory ? 1 : 0, r.env, r.step ? steps.get(r.step) ?? null : null, r.hint, i + 1));
  }
  return out;
}

/* ------------------------------------------------------------------ per-country seed */

export interface TenderingDemo { entityId: number; code: string; historic: number; live: { status: string; code: string; project: string; stage: string; note: string }[]; demo: { slug: string; email: string; company: string; notes: string } | null }

type Progress = "sealed" | "opened" | "tech_eval" | "comm_eval" | "recommended" | "award_pending" | "awarded";
interface BidderSpec {
  sub: number; role: "winner" | "qualified" | "dq_tech" | "dq_hse" | "dq_compliance" | "draft"; /** price relative to the reference price */ delta: number;
  tech?: number; hse?: number; bafo?: boolean; revised?: boolean; submittedAt?: string; errorLine?: boolean; partial?: boolean;
}
interface TenderSpec {
  projectId: number; stageIds: number[]; scopeKind: "stages" | "project" | "subproject"; title: string; description: string; catCode: string; tpl: TplKey; procedure: "open" | "selective";
  ownerId: number; chairId: number; hseId: number; engId: number; finId: number; createdAt: string;
  publishAt: string; clarAt: string; closingAt: string; openingAt: string; siteAt: string | null;
  bidders: BidderSpec[]; progress: Progress; ref: number; /** exact winner total (historic awards: the assignment's contract value) */ exact: number | null;
  clar: number; addendum: boolean; extend: boolean; invitedExtra: number[]; draftBidFor?: number; terms: { adv: number; ret: number; days: number; payment: string | null; start: string | null; end: string | null };
  assignmentId?: number; evalDays?: number; awardAt?: string; pending?: "draft" | "pending" | "scheduled" | "cancelled" | null; cancelReason?: string; tag?: string;
}
type TplKey = "telecom" | "pipeline" | "small" | "plant";

export function seedTendering(db: DB, results: RegionResult[], uploads: string): TenderingDemo[] {
  const tpl = seedTemplates(db);
  return results.map((r) => seedEntity(db, r, uploads, tpl));
}

function seedEntity(db: DB, r: RegionResult, uploads: string, tpl: Record<string, number>): TenderingDemo {
  const entityId = r.entityId, U = r.U;
  const ent = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId) as { id: number; code: string; doc_prefix: string; currency: string; country: string };
  const dec = ent.currency === "OMR" ? 3 : 2;
  const one = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as any[])) as T | undefined;
  const all = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
  let seq = 1;
  const rnd = () => { seq = (seq * 1103515245 + 12345 + ent.id * 7919) % 2147483647; return seq / 2147483647; };
  const pickIdx = <T,>(a: T[], k: number) => a[Math.abs(Math.floor(k)) % a.length];
  const catId = (code: string) => one<{ id: number }>("SELECT id FROM supplier_categories WHERE code = ? AND entity_id IS NULL", code)!.id;
  const owners = all<{ id: number }>(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id JOIN user_entities ue ON ue.user_id = u.id AND ue.entity_id = ? WHERE r.code = 'procurement' ORDER BY u.id`, entityId).map((x) => x.id);
  const CHAIR = U[11] ?? U[1], ENG = U[4], FIN = U[5], HSE = U[9];
  const baseUrl = (process.env.APP_URL || "http://localhost:3100").replace(/\/+$/, "");

  /* ---- supplier pool helpers */
  const approvedSubs = all<{ id: number; name: string; portal_slug: string }>("SELECT id, name, portal_slug FROM subcontractors WHERE entity_id = ? AND registration_status = 'approved' AND status = 'approved' ORDER BY id", entityId);
  const hasCat = (subId: number, code: string) => !!one("SELECT 1 FROM subcontractor_categories sc JOIN supplier_categories c ON c.id = sc.category_id WHERE sc.subcontractor_id = ? AND c.code = ? AND sc.status = 'approved'", subId, code);
  const groupOf = (code: string) => one<{ g: string }>("SELECT group_name g FROM supplier_categories WHERE code = ? AND entity_id IS NULL", code)!.g;
  const poolFor = (code: string, exclude: number[]) => {
    const g = groupOf(code);
    const exact = approvedSubs.filter((s) => hasCat(s.id, code));
    const sameGroup = approvedSubs.filter((s) => !exact.includes(s) && one("SELECT 1 FROM subcontractor_categories sc JOIN supplier_categories c ON c.id = sc.category_id WHERE sc.subcontractor_id = ? AND c.group_name = ? AND sc.status = 'approved'", s.id, g));
    const rest = approvedSubs.filter((s) => !exact.includes(s) && !sameGroup.includes(s));
    return [...exact, ...sameGroup, ...rest].filter((s) => !exclude.includes(s.id));
  };
  const winnerCats = (subId: number) => all<{ code: string }>("SELECT c.code FROM subcontractor_categories sc JOIN supplier_categories c ON c.id = sc.category_id WHERE sc.subcontractor_id = ? AND sc.status = 'approved' ORDER BY c.id", subId).map((x) => x.code);

  /* ---- tender documents + bid documents */
  const writeDoc = (entityType: "rfx" | "rfx_bid", id: number, category: string, filename: string, label: string, lines: string[], when: string, uploader: number | null): number => {
    const stored = `seed-${nanoid(8)}-${filename.replace(/[^\w.\-]+/g, "_").slice(-60)}`;
    const buf = miniPdf(label, lines);
    fs.writeFileSync(path.join(uploads, stored), buf);
    return Number(db.prepare("INSERT INTO attachments(entity_type, entity_id, category, filename, stored_path, mime, size, uploaded_by, note, created_at) VALUES (?,?,?,?,?, 'application/pdf',?,?,?,?)")
      .run(entityType, id, category, filename, stored, buf.length, uploader, "Demo file", sqlOf(when)).lastInsertRowid);
  };

  /* ---- the generic builder: one tender with its bids, answers, prices, marks, scores, events */
  function build(sp: TenderSpec): number {
    const stagesCsv = sp.stageIds.length ? sp.stageIds.join(",") : "NULL";
    void stagesCsv;
    const rfxId = createDraft(db, { entityId, userId: sp.ownerId, projectId: sp.projectId, scopeKind: sp.scopeKind, stageIds: sp.stageIds, title: sp.title, description: sp.description, categoryId: catId(sp.catCode),
      templateId: tpl[sp.tpl], procedure: sp.procedure, ownerId: sp.ownerId, createdAt: sp.createdAt, force: true });
    const rfx0 = one<RfxRow>("SELECT * FROM rfx_tenders WHERE id = ?", rfxId)!;
    const steps = all<any>("SELECT * FROM rfx_steps WHERE rfx_id = ? ORDER BY sort", rfxId);
    const stepOf = (kind: string) => steps.find((s) => s.kind === kind);
    const reqs = all<any>("SELECT * FROM rfx_requirements WHERE rfx_id = ? ORDER BY sort", rfxId);
    const criteria = all<any>("SELECT c.* FROM rfx_criteria c JOIN rfx_steps s ON s.id = c.step_id WHERE s.rfx_id = ? ORDER BY s.sort, c.sort", rfxId);

    /* BOQ: historic awards get a balancing lump-sum line so that the winner's total equals the contract value exactly */
    if (sp.exact !== null) {
      const lines = prefillBoq(db, sp.stageIds, dec).slice(0, sp.ref < (one<{ b: number }>(`SELECT COALESCE(SUM(budget_amount), 0) b FROM stages WHERE id IN (${sp.stageIds.join(",") || "NULL"})`)?.b ?? 0) * 0.2 ? 3 : 99);
      const sumEst = lines.reduce((a, l) => a + l.quantity * l.estimate_rate, 0) || 1;
      const k = (0.9 * sp.ref) / sumEst;
      const scaled = lines.map((l) => ({ ...l, estimate_rate: niceRate(l.estimate_rate * k, dec) }));
      const body = scaled.reduce((a, l) => a + roundTo(l.quantity * l.estimate_rate, dec), 0);
      scaled.push({ item_no: String(scaled.length + 1), description: "Mobilisation, demobilisation, supervision & provisional sums", unit: "lumpsum", quantity: 1, stage_id: null, estimate_rate: roundTo(sp.ref - body, dec) });
      replaceBoq(db, rfxId, scaled, dec);
    }
    const boq = boqOf(db, rfxId);
    const estimate = one<{ e: number }>("SELECT estimate e FROM rfx_tenders WHERE id = ?", rfxId)!.e;

    /* dates + terms + status fields */
    const live = !!sp.pending || !["awarded"].includes(sp.progress) ? true : false;
    void live;
    db.prepare(`UPDATE rfx_tenders SET publish_at = ?, clarification_deadline = ?, closing_at = ?, opening_at = ?, site_visit_at = ?, site_visit_note = ?, advance_pct = ?, retention_pct = ?, payment_days = ?, payment_terms = COALESCE(?, payment_terms),
      contract_start = COALESCE(?, contract_start), contract_end = COALESCE(?, contract_end), validity_days = ?, owner_id = ? WHERE id = ?`)
      .run(sp.publishAt, sp.clarAt, sp.closingAt, sp.openingAt, sp.siteAt, sp.siteAt ? "Meet at the site office at the start of the section; safety induction is mandatory." : null, sp.terms.adv, sp.terms.ret, sp.terms.days, sp.terms.payment, sp.terms.start, sp.terms.end, rfx0.validity_days, sp.ownerId, rfxId);

    /* committee: chair, secretary (owner: compliance gates), PM, engineer, HSE, finance */
    db.prepare("DELETE FROM rfx_committee WHERE rfx_id = ?").run(rfxId);
    const pm = one<{ manager_id: number | null }>("SELECT manager_id FROM projects WHERE id = ?", sp.projectId)?.manager_id ?? U[2];
    const idsOf = (pred: (s: any) => boolean) => JSON.stringify(steps.filter(pred).map((s) => s.id));
    const scoredTech = (s: any) => s.gate === "scored" && s.kind !== "commercial";
    const addMember = (user: number, role: string, stepsJson: string | null, declared: string) =>
      db.prepare("INSERT OR IGNORE INTO rfx_committee(rfx_id, user_id, role, steps, coi_declared_at, coi_conflict) VALUES (?,?,?,?,?,0)").run(rfxId, user, role, stepsJson, declared);
    const declared = sp.pending === "draft" || sp.pending === "pending" || sp.pending === "scheduled" ? null : at(-1);
    addMember(sp.chairId, "chair", "[]", declared as string);
    addMember(sp.ownerId, "secretary", idsOf((s) => s.gate === "pass_fail" && s.kind === "compliance"), declared as string);
    addMember(pm, "member", idsOf((s) => scoredTech(s) && s.kind === "technical"), declared as string);
    if (sp.tpl === "telecom" || sp.tpl === "pipeline") {
      addMember(sp.engId, "member", idsOf((s) => s.kind === "technical" && scoredTech(s)), declared as string);
      addMember(sp.hseId, "member", idsOf((s) => s.kind === "hse"), declared as string);
    }
    addMember(sp.finId, "member", "[]", declared as string);

    /* attachments: tender documents visible to bidders */
    const docs: [string, string, string][] = [["Specifications", "Technical specification", "Scope, standards and acceptance criteria."], ["BOQ", "Bill of quantities", "Items, units and quantities to be priced."]];
    if (sp.tpl !== "plant") docs.push(["Drawings", "Route drawings", "Alignment and typical details."]);
    if (sp.tpl === "telecom" || sp.tpl === "pipeline") docs.push(["Conditions of contract", "Conditions of contract", "General and particular conditions."]);
    docs.forEach(([cat, label, line]) => writeDoc("rfx", rfxId, cat, `${rfx0.code}-${cat.replace(/\s+/g, "-").toLowerCase()}.pdf`, `${rfx0.code} ${label}`, [sp.title, line, "Placeholder document generated by the demo seed."], sp.publishAt, sp.ownerId));

    /* bids */
    const submitted: { id: number; spec: BidderSpec; code: string }[] = [];
    const winnerSpec = sp.bidders.find((b) => b.role === "winner");
    sp.bidders.forEach((b, i) => {
      const code = rfx0.code;
      const subAt = b.submittedAt ?? new Date(Date.parse(sp.closingAt) - (1 + ((i * 5 + 3) % 17) * 0.6) * DAY * 0.5 - (b.role === "winner" ? 3_600_000 * 4 : 3_600_000 * (6 + i * 7))).toISOString();
      const isDraft = b.role === "draft";
      const id = Number(db.prepare(`INSERT INTO rfx_bids(rfx_id, subcontractor_id, status, submitted_at, receipt_hash, revision, validity_days, bid_bond_ref, created_at, price_version)
        VALUES (?,?,?,?,?,?,?,?,?,1)`).run(rfxId, b.sub, isDraft ? "draft" : "submitted", isDraft ? null : subAt, isDraft ? null : sha(receiptPayload(code, b.sub, b.revised ? 2 : 1, subAt, { seed: i })), isDraft ? 0 : b.revised ? 2 : 1,
        rfx0.validity_days + (i % 3) * 30, rfx0.bid_bond_pct > 0 ? `BG-${ent.code}-${(7000 + b.sub * 13 + i).toString()}` : null, sqlOf(isDraft ? at(-2) : new Date(Date.parse(subAt) - DAY).toISOString())).lastInsertRowid);
      if (b.revised && !isDraft) db.prepare("INSERT INTO rfx_bid_history(bid_id, revision, submitted_at, receipt_hash, total_amount, note) VALUES (?,?,?,?,?, 'Replaced by a revision')").run(id, 1, new Date(Date.parse(subAt) - 2 * DAY).toISOString(), sha(`${code}|${b.sub}|1`), null);
      /* answers */
      const supplier = approvedSubs.find((s) => s.id === b.sub);
      reqs.forEach((q, qi) => {
        if (isDraft && qi % 2 === 1) return; // a draft bid is only half filled
        const okMark = b.role === "dq_compliance" && q.step_id === stepOf("compliance")?.id && qi === 0 ? 0 : b.role === "dq_hse" && q.step_id === stepOf("hse")?.id && q.id === reqs.find((x: any) => x.step_id === q.step_id)?.id ? 0 : 1;
        let text: string | null = null, num: number | null = null, att: number | null = null;
        if (q.kind === "document") att = writeDoc("rfx_bid", id, "Bid document", `${(supplier?.portal_slug ?? "bid")}-${qi + 1}.pdf`, q.name, [supplier?.name ?? "Bidder", sp.title, "Placeholder bid document generated by the demo seed."], isDraft ? at(-2) : new Date(Date.parse(subAt) - DAY).toISOString(), null);
        else if (q.kind === "yes_no") text = "yes";
        else if (q.kind === "number") num = 7 + (i % 6);
        else if (q.kind === "date") text = addDays(TODAY, 30);
        else text = `We will mobilise two crews with our own plant and complete the work in the stated period (${supplier?.name ?? "bidder"}).`;
        const mark = isDraft || !q.step_id || q.envelope === "commercial" ? null : okMark;
        const comment = mark === 0 ? (b.role === "dq_hse" ? "HSE plan did not cover confined-space work" : "Trade licence expired before the closing date") : null;
        db.prepare("INSERT INTO rfx_bid_responses(bid_id, requirement_id, value_text, value_number, attachment_id, compliant, eval_comment) VALUES (?,?,?,?,?,?,?)").run(id, q.id, text, num, att, mark, comment);
      });
      submitted.push({ id, spec: b, code });
      void winnerSpec;
    });

    /* prices (version 1; BAFO version 2) + terms + totals */
    const vat = one<{ v: number }>("SELECT vat_rate v FROM entities WHERE id = ?", entityId)!.v;
    const qtyLines = boq.filter((l) => l.unit !== "lumpsum" || sp.exact === null);
    const priceBid = (bidId: number, target: number, version: number, errorLine: boolean, noiseSeed: number) => {
      const lump = sp.exact !== null ? boq[boq.length - 1] : null;
      const body = qtyLines.filter((l) => l !== lump);
      const sumEst = body.reduce((a, l) => a + l.quantity * l.estimate_rate, 0) || 1;
      const f = (lump ? 0.9 * target : target) / sumEst;
      let total = 0;
      const rows: { l: any; rate: number; amount: number }[] = [];
      body.forEach((l, k) => {
        const noise = lump ? 0.96 + ((Math.sin(noiseSeed * 13 + k * 7) + 1) / 2) * 0.08 : 0.97 + ((Math.sin(noiseSeed * 13 + k * 7) + 1) / 2) * 0.06;
        const rate = niceRate(l.estimate_rate * f * noise, dec);
        const amount = roundTo(l.quantity * rate, dec);
        rows.push({ l, rate, amount }); total += amount;
      });
      if (lump) { const amount = roundTo(target - total, dec); rows.push({ l: lump, rate: amount, amount }); total += amount; }
      rows.forEach((x, k) => {
        const amount = errorLine && k === 1 ? roundTo(x.amount + Math.max(1, x.amount * 0.012), dec) : x.amount; // planted arithmetic error (the check flags it)
        db.prepare("INSERT INTO rfx_bid_prices(bid_id, boq_line_id, version, unit_rate, amount, created_at) VALUES (?,?,?,?,?,?)").run(bidId, x.l.id, version, x.rate, amount, sqlOf(at(-1)));
      });
      return roundTo(errorLine ? total + Math.max(1, rows[1].amount * 0.012) : total, dec);
    };
    for (const b of submitted) {
      if (b.spec.role === "draft") {
        // half-priced draft
        const lines = boq.slice(0, Math.ceil(boq.length / 2));
        lines.forEach((l) => db.prepare("INSERT INTO rfx_bid_prices(bid_id, boq_line_id, version, unit_rate, amount, created_at) VALUES (?,?,1,?,?,?)").run(b.id, l.id, niceRate(l.estimate_rate * 1.02, dec), roundTo(l.quantity * niceRate(l.estimate_rate * 1.02, dec), dec), sqlOf(at(-2))));
        continue;
      }
      const base = sp.ref * (1 + b.spec.delta);
      const target = b.spec.role === "winner" && sp.exact !== null ? (b.spec.bafo ? sp.exact * (1.04 + rnd() * 0.05) : sp.exact) : sp.exact !== null ? base : estimate * (1 + b.spec.delta);
      let total = priceBid(b.id, target, 1, !!b.spec.errorLine, b.id);
      let version = 1;
      if (b.spec.bafo && sp.exact !== null) { total = priceBid(b.id, sp.exact, 2, false, b.id + 100); version = 2; }
      const net = total, discount = 0, vatAmt = roundTo(net * (vat / 100), dec);
      db.prepare("UPDATE rfx_bids SET total_amount = ?, discount_amount = ?, vat_amount = ?, price_version = ?, deviations = ?, alternative_offer = NULL WHERE id = ?")
        .run(net, discount, vatAmt, version, b.spec.delta > 0.15 ? "Prices exclude traffic-management permits; subject to site access in the first week." : null, b.id);
      db.prepare("UPDATE rfx_bid_history SET total_amount = ? WHERE bid_id = ? AND total_amount IS NULL").run(net, b.id);
    }

    /* openings */
    const method = rfx0.evaluation_method;
    const two = method === "two_envelope_weighted";
    const attendeesOf = (kind: string) => {
      const names = [sp.chairId, sp.ownerId, pm, sp.finId, ...(two ? [sp.hseId] : [])].map((id) => one<{ name: string }>("SELECT name FROM users WHERE id = ?", id)?.name).filter(Boolean);
      return JSON.stringify({ userIds: [sp.chairId, sp.ownerId, pm, sp.finId], names, observers: kind === "opening" ? "" : "Client representative (observer)" });
    };
    const ev = (kind: string, when: string, minutes: string) => db.prepare("INSERT INTO rfx_events(rfx_id, kind, at, attendees_json, minutes, created_by) VALUES (?,?,?,?,?,?)").run(rfxId, kind, when, attendeesOf(kind), minutes, sp.ownerId);
    const stage = ["sealed"].includes(sp.progress) ? 0 : 1;
    if (stage) {
      const openAt = sp.openingAt;
      ev(two ? "tech_opening" : "opening", openAt, `${submitted.filter((x) => x.spec.role !== "draft").length} bids received before the closing time. ${two ? "Technical envelopes opened; price envelopes remain sealed." : "All envelopes opened; bidders and prices read out."} Bid bonds checked and recorded in the register.`);
      for (const b of submitted) if (b.spec.role !== "draft") db.prepare("UPDATE rfx_bids SET bid_bond_received = ?, register_note = ? WHERE id = ?").run(rfx0.bid_bond_pct > 0 ? 1 : 0, rfx0.bid_bond_pct > 0 ? "Bid bond received" : null, b.id);
    }
    if (["comm_eval", "recommended", "award_pending", "awarded"].includes(sp.progress) && two) ev("commercial_opening", new Date(Date.parse(sp.openingAt) + (sp.evalDays ?? 6) * DAY).toISOString(), "Commercial envelopes of the technically qualified bids opened; arithmetic check carried out.");

    /* marks + scores */
    const complianceSteps = steps.filter((s) => s.gate === "pass_fail" && s.kind !== "commercial");
    const scoredSteps = steps.filter((s) => s.gate === "scored" && s.kind !== "commercial");
    const evalAt = new Date(Date.parse(sp.openingAt) + 2 * DAY).toISOString();
    const memberIds = (stepId: number) => all<any>("SELECT user_id FROM rfx_committee WHERE rfx_id = ? AND role <> 'observer' AND steps LIKE ?", rfxId, `%${stepId}%`).filter((m) => (JSON.parse(all<any>("SELECT steps FROM rfx_committee WHERE rfx_id = ? AND user_id = ?", rfxId, m.user_id)[0].steps) as number[]).includes(stepId)).map((m) => m.user_id as number);
    const insScore = db.prepare("INSERT OR REPLACE INTO rfx_scores(bid_id, step_id, criterion_id, evaluator_id, score, comment, created_at) VALUES (?,?,?,?,?,?,?)");
    const doScoring = ["tech_eval", "comm_eval", "recommended", "award_pending", "awarded"].includes(sp.progress);
    const scoreBid = (b: { id: number; spec: BidderSpec }, step: any, target: number, how: "full" | "partial") => {
      const cr = criteria.filter((c) => c.step_id === step.id);
      const evs = memberIds(step.id);
      evs.forEach((u, ei) => {
        if (how === "partial" && ei > 0) return; // only the first evaluator has scored so far
        cr.forEach((c, k) => {
          if (how === "partial" && k >= Math.ceil(cr.length / 2)) return;
          const pct = Math.min(0.99, Math.max(0.2, target / 100 + (Math.sin(b.id * 3 + ei * 5 + k * 11) * 0.05)));
          const score = Math.min(c.max_score, Math.round(c.max_score * pct * 2) / 2);
          const note = target < 70 && c.criterion.startsWith("Resources") ? "Insufficient HDD equipment: one rig declared, two required for the programme." : target < 70 && c.criterion.startsWith("Method") ? "Method statement does not address reinstatement or traffic phasing." : null;
          insScore.run(b.id, step.id, c.id, u, score, ei === 0 ? note : null, sqlOf(new Date(Date.parse(evalAt) + (ei + k / 4) * 3_600_000 * 5).toISOString()));
        });
      });
    };
    const techTarget = (b: BidderSpec, i: number) => b.tech ?? (b.role === "winner" ? 84 + (i % 5) : b.role === "dq_tech" ? 58 + (i % 6) : 70 + ((i * 7) % 11));
    const hseTarget = (b: BidderSpec, i: number) => b.hse ?? (b.role === "dq_hse" ? 62 : 78 + ((i * 3) % 10));
    if (doScoring) {
      submitted.forEach((b, i) => {
        if (b.spec.role === "draft") return;
        // pass/fail steps already carry marks; scored steps get scores. A bid that failed an earlier gate is never scored on the later steps.
        const failedGate = b.spec.role === "dq_compliance" || (b.spec.role === "dq_hse" && stepOf("hse")?.gate === "pass_fail");
        if (failedGate) return;
        for (const s of scoredSteps) {
          const target = s.kind === "hse" ? hseTarget(b.spec, i) : techTarget(b.spec, i);
          if (b.spec.role === "dq_hse" && s.kind !== "hse") return;
          const how = sp.progress === "tech_eval" && s.kind === "technical" && !b.spec.partial && i % 2 === 1 ? "partial" : sp.progress === "tech_eval" && b.spec.partial ? "partial" : "full";
          scoreBid(b, s, target, how);
        }
      });
      // marks of the pass / fail steps that have not been evaluated yet (a bid that failed an earlier gate is not marked further); winners always pass
      void complianceSteps;
    } else {
      // sealed / opened: no marks yet
      db.prepare("UPDATE rfx_bid_responses SET compliant = NULL, eval_comment = NULL WHERE bid_id IN (SELECT id FROM rfx_bids WHERE rfx_id = ?)").run(rfxId);
    }

    /* the application's own evaluation: statuses, scores, ranks; make sure the intended winner is rank 1 */
    if (doScoring) {
      let res = evaluate(db, rfxId, true);
      if (winnerSpec && ["recommended", "award_pending", "awarded"].includes(sp.progress)) {
        const wid = submitted.find((x) => x.spec === winnerSpec)!.id;
        for (let n = 0; n < 6 && res.rows.find((x) => x.rank === 1)?.bidId !== wid; n++) {
          for (const s of scoredSteps) for (const sc of all<any>("SELECT * FROM rfx_scores WHERE bid_id = ? AND step_id = ?", wid, s.id)) {
            const mx = criteria.find((c) => c.id === sc.criterion_id)!.max_score;
            db.prepare("UPDATE rfx_scores SET score = ? WHERE id = ?").run(Math.min(mx, sc.score + mx * 0.04), sc.id);
          }
          res = evaluate(db, rfxId, true);
        }
        if (res.rows.find((x) => x.rank === 1)?.bidId !== wid) {
          // still behind on price: lower the competitors' technical marks a little
          for (const o of submitted) if (o.id !== wid) for (const s of scoredSteps) db.prepare("UPDATE rfx_scores SET score = MAX(0, score - 1.5) WHERE bid_id = ? AND step_id = ?").run(o.id, s.id);
          res = evaluate(db, rfxId, true);
        }
      }
    } else if (stage) evaluate(db, rfxId, true);

    /* clarifications, addendum, invitations */
    const Qs: [string, string][] = [
      ["Please confirm whether the existing duct bank may be reused for the first 500 m.", "Reuse is permitted where the duct passes the mandrel test; the subcontractor remains responsible for rectification."],
      ["Is a bid bond in the form of a bank guarantee from any local bank acceptable?", "Yes, from any bank licensed in the country; the wording is in the conditions of contract."],
      ["Can the programme assume night working in the built-up sections?", "Night working is allowed subject to the permit conditions; allow for the permit lead time of 10 days."],
      ["Who obtains the traffic management plan approval?", "The subcontractor prepares the plan; the Company submits it to the authority and tracks the approval."],
      ["What reinstatement standard applies to asphalt (layer thickness)?", "Match the existing pavement build-up with a minimum 100 mm binder and 50 mm wearing course."],
    ];
    const askers = submitted.map((x) => x.spec.sub);
    for (let k = 0; k < sp.clar; k++) {
      const asked = new Date(Date.parse(sp.publishAt) + (2 + k * 2) * DAY).toISOString();
      db.prepare("INSERT INTO rfx_clarifications(rfx_id, subcontractor_id, question, asked_at, answer, answered_by, published_at) VALUES (?,?,?,?,?,?,?)")
        .run(rfxId, pickIdx(askers.length ? askers : [sp.draftBidFor ?? 0], k + 1) || null, Qs[(k + rfxId) % Qs.length][0], sqlOf(asked), Qs[(k + rfxId) % Qs.length][1], sp.ownerId, sqlOf(new Date(Date.parse(asked) + 6 * 3_600_000).toISOString()));
    }
    let finalClosing = sp.closingAt;
    if (sp.addendum) {
      const issued = new Date(Date.parse(sp.publishAt) + 9 * DAY).toISOString();
      const newClosing = sp.extend ? new Date(Date.parse(sp.closingAt)).toISOString() : null;
      const attId = writeDoc("rfx", rfxId, "Addendum", `${rfx0.code}-addendum-1.pdf`, `Addendum 1 to ${rfx0.code}`, ["Clarification of BOQ items and revised drawing revision B.", "Placeholder document generated by the demo seed."], issued, sp.ownerId);
      const aid = Number(db.prepare("INSERT INTO rfx_addenda(rfx_id, no, title, description, attachment_id, new_closing_at, issued_by, issued_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(rfxId, 1, sp.extend ? "Extension of the closing date and revised BOQ notes" : "Clarification of BOQ items and revised drawings", "Item descriptions clarified; drawing revision B replaces revision A.", attId, newClosing, sp.ownerId, sqlOf(issued)).lastInsertRowid);
      for (const b of submitted) if (b.spec.role !== "draft" || sp.tag === "ack-all") db.prepare("INSERT OR IGNORE INTO rfx_addendum_acks(addendum_id, subcontractor_id, acked_at, acked_by_name) VALUES (?,?,?,?)").run(aid, b.spec.sub, sqlOf(new Date(Date.parse(issued) + DAY).toISOString()), "Bid team");
      finalClosing = sp.closingAt;
    }
    void finalClosing;
    const invitedAt = sqlOf(sp.publishAt);
    const everyone = new Set<number>([...sp.bidders.map((b) => b.sub), ...sp.invitedExtra]);
    for (const sid of everyone) {
      const bid = sp.bidders.find((b) => b.sub === sid);
      const declined = !bid && sp.invitedExtra.indexOf(sid) % 2 === 1;
      db.prepare("INSERT OR IGNORE INTO rfx_invitations(rfx_id, subcontractor_id, invited_at, viewed_at, intent, decline_reason, source) VALUES (?,?,?,?,?,?,?)")
        .run(rfxId, sid, invitedAt, bid || sp.invitedExtra.indexOf(sid) < 2 ? sqlOf(new Date(Date.parse(sp.publishAt) + DAY).toISOString()) : null, bid ? "interested" : declined ? "declined" : "pending", declined ? "Fully committed on other projects during the tender period." : null, sp.procedure === "selective" ? "invited" : "eligible");
    }
    return rfxId;
  }

  /* ================================================================ historic awarded tenders */
  const asg = all<any>(`SELECT a.*, p.category pcat, p.manager_id pm, s.code scode, s.name sname, s.budget_amount sbudget, s.planned_start, s.planned_end FROM assignments a JOIN projects p ON p.id = a.project_id
    LEFT JOIN stages s ON s.id = a.stage_id WHERE p.entity_id = ? ORDER BY a.id`, entityId);
  // 32 of 40 come through tendering, 8 stay direct: 3 drafts, 1 suspended, 2 completed, 2 active - spread over the list
  const direct = new Set<number>();
  const spread = (status: string, n: number) => { const l = asg.filter((a) => a.status === status); for (let i = 0; i < n; i++) direct.add(l[Math.min(l.length - 1, Math.floor((i + 0.5) * l.length / n))].id); };
  spread("draft", 3); spread("suspended", 1); spread("completed", 2); spread("active", 2);
  const tendered = asg.filter((a) => !direct.has(a.id)).sort((x, y) => String(x.start_date ?? "").localeCompare(String(y.start_date ?? "")) || x.id - y.id);

  const catFor = (a: any): string => {
    const t = `${a.scope ?? ""} ${a.sname ?? ""}`.toLowerCase();
    let want: string;
    if (/survey|testing|qa\/qc|gis/.test(t)) want = "oth-survey";
    else if (/traffic|signage|safety/.test(t)) want = "oth-traffic";
    else if (/manpower|rigging|labour supply/.test(t)) want = "oth-manpower";
    else if (/plant|equipment hire|crane|hire/.test(t)) want = "oth-plant";
    else if (a.pcat === "pipeline") want = /weld|coat|hydro|test/.test(t) ? (/coat/.test(t) ? "og-coat" : /hydro|test/.test(t) ? "og-hydro" : "og-weld") : "og-weld";
    else if (a.pcat === "cable" || a.pcat === "telecom") want = /splic/.test(t) ? "tel-splice" : /hdd|drill|bor/.test(t) ? "tel-hdd" : /duct|manhole/.test(t) ? "tel-duct" : "tel-cable";
    else if (/asphalt|paving|reinstat|landscap|finishing/.test(t)) want = "civ-reinst";
    else want = "civ-works";
    const mine = winnerCats(a.subcontractor_id);
    if (mine.includes(want)) return want;
    const g = groupOf(want);
    return mine.find((c) => groupOf(c) === g) ?? mine[0] ?? want;
  };
  const tplFor = (cat: string): TplKey => cat.startsWith("tel-") ? "telecom" : cat.startsWith("og-") ? "pipeline" : cat === "oth-plant" || cat === "oth-manpower" ? "plant" : "small";

  tendered.forEach((a, idx) => {
    const cat = catFor(a), tk = tplFor(cat);
    const owner = pickIdx(owners.length ? owners : [U[8]], idx);
    const sd = a.start_date ?? a.planned_start ?? addDays(TODAY, 20);
    const publish = addDays(sd, -Math.round(35 + rnd() * 25));
    const closing = addDays(publish, 21 + Math.round(rnd() * 2));
    let award = addDays(sd, -Math.round(7 + rnd() * 7));
    if (award < addDays(closing, 6)) award = addDays(closing, 6);
    let shift = 0;
    if (award > addDays(TODAY, -2 - (idx % 5))) shift = Math.round((Date.parse(award) - Date.parse(addDays(TODAY, -2 - (idx % 5)))) / DAY);
    const d = (iso: string) => addDays(iso, -shift);
    const T = (iso: string, hh = 10) => `${d(iso)}T${String(hh - 4).padStart(2, "0")}:00:00.000Z`;
    const cv = a.contract_value as number;
    const n = [4, 3, 5, 4, 6, 3, 4, 5][idx % 8];
    const winner = a.subcontractor_id as number;
    const pool = poolFor(cat, [winner]);
    const others = Array.from({ length: n - 1 }, (_, k) => pool[(idx * 3 + k * 2) % Math.max(pool.length, 1)]).filter(Boolean).filter((s, k, arr) => arr.findIndex((x) => x.id === s.id) === k);
    while (others.length < n - 1 && pool.length > others.length) { const c = pool.find((s) => !others.includes(s)); if (!c) break; others.push(c); }
    const dqKind: BidderSpec["role"] | null = idx % 3 === 0 ? (tk === "telecom" ? "dq_tech" : tk === "pipeline" ? "dq_hse" : "dq_compliance") : idx % 7 === 2 ? "dq_tech" : null;
    const lowerDq = dqKind && (tk === "small" || tk === "plant" ? dqKind === "dq_compliance" : true);
    const bidders: BidderSpec[] = [{ sub: winner, role: "winner", delta: 0, bafo: idx % 4 === 1, revised: idx % 5 === 2 }];
    others.forEach((s, k) => {
      let role: BidderSpec["role"] = "qualified"; let delta = 0.02 + ((k * 7 + idx * 3) % 25) / 100 * 1.0;
      if (k === 0 && lowerDq) { role = dqKind!; delta = -(0.03 + ((idx * 5) % 6) / 100); }
      else if (tk === "small" || tk === "plant") delta = Math.max(0.01, delta);
      else if (k === 1 && idx % 4 === 0) delta = -0.04; // a cheaper, technically weaker bid (still qualified, loses on score)
      bidders.push({ sub: s.id, role, delta: Math.min(0.28, delta), tech: role === "qualified" && delta < 0 ? 71 : undefined });
    });
    if (tk === "telecom" || tk === "pipeline") bidders.forEach((b) => { if (b.role === "qualified" && b.delta < 0) b.tech = 71.5; });
    const stageIds = a.stage_id ? [a.stage_id] : [];
    const extra = pool.filter((s) => !bidders.some((b) => b.sub === s.id)).slice(idx % 3, (idx % 3) + 2).map((s) => s.id);
    const hist: TenderSpec = {
      projectId: a.project_id, stageIds, scopeKind: stageIds.length ? "stages" : "project", title: `${a.scope ?? a.sname ?? "Subcontract works"}${a.scode ? ` (${a.scode})` : ""}`.slice(0, 160),
      description: `${a.scope ?? "Subcontract works"} for ${a.sname ?? "the project"}. Supplier tender for subcontract ${a.code}.`, catCode: cat, tpl: tk, procedure: idx % 7 === 3 ? "selective" : "open",
      ownerId: owner, chairId: CHAIR, hseId: HSE, engId: ENG, finId: FIN, createdAt: `${d(publish)}T05:00:00.000Z`,
      publishAt: T(publish), clarAt: T(addDays(closing, -7)), closingAt: T(closing), openingAt: T(closing, 14), siteAt: T(addDays(publish, 7), 9),
      bidders, progress: "awarded", ref: cv * (1.03 + ((idx * 7) % 13) / 100), exact: cv, clar: idx % 4, addendum: idx % 3 === 0, extend: idx % 6 === 0,
      invitedExtra: extra, terms: { adv: a.advance_pct, ret: a.retention_pct, days: a.payment_days, payment: a.payment_terms, start: a.start_date, end: a.end_date }, assignmentId: a.id,
      evalDays: 4, awardAt: T(award, 15),
    };
    const rfxId = build(hist);
    // outcome: recommendation, award, the existing assignment keeps every value and only receives the tender link
    const rfx = one<RfxRow>("SELECT * FROM rfx_tenders WHERE id = ?", rfxId)!;
    const win = one<any>("SELECT * FROM rfx_bids WHERE rfx_id = ? AND subcontractor_id = ?", rfxId, winner)!;
    const recAt = new Date(Date.parse(hist.awardAt!) - 2 * DAY).toISOString();
    const rank1 = evaluate(db, rfxId).rows.find((x) => x.rank === 1)?.bidId;
    db.prepare("UPDATE rfx_tenders SET status = 'awarded', recommended_bid_id = ?, recommendation_note = ?, recommended_by = ?, recommended_at = ?, award_value = ?, awarded_bid_id = ?, assignment_id = ?, awarded_at = ?, published_at = ?, closed_at = ? WHERE id = ?")
      .run(win.id, rank1 === win.id ? "Highest ranked bidder: best combined technical and commercial score." : "Recommended although not rank 1: best technical score and credible programme; price negotiated.", owner, recAt, cv, win.id, a.id, hist.awardAt, hist.publishAt, hist.closingAt, rfxId);
    db.prepare("UPDATE rfx_bids SET status = 'awarded' WHERE id = ?").run(win.id);
    db.prepare("UPDATE rfx_bids SET status = 'unsuccessful' WHERE rfx_id = ? AND id <> ? AND status IN ('submitted', 'qualified')").run(rfxId, win.id);
    db.prepare("UPDATE assignments SET source = 'tender', rfx_id = ?, rfx_bid_id = ? WHERE id = ?").run(rfxId, win.id, a.id);
    for (const m of all<any>("SELECT user_id FROM rfx_committee WHERE rfx_id = ? AND role IN ('chair', 'member')", rfxId)) db.prepare("INSERT OR IGNORE INTO rfx_signoffs(rfx_id, user_id, decision, comment, decided_at) VALUES (?,?, 'concur', NULL, ?)").run(rfxId, m.user_id, sqlOf(recAt));
    seedRequest(db, "rfx_award", rfxId, { requestedBy: owner, hoursAgo: Math.max(6, (Date.now() - Date.parse(hist.awardAt!)) / 3_600_000 + 8), outcome: "approved", note: "Recommendation report attached." });
    sendAwardLetters(db, rfxId, { assignmentCode: a.code, assignmentId: a.id, baseUrl, at: hist.awardAt });
    const logs: [string, string, string][] = [
      [rfx.created_at, "created", `Supplier tender ${rfx.code} created as a draft`], [hist.publishAt, "published", `Published to ${bidders.length + extra.length} invited suppliers`],
      [hist.closingAt, "closed", "Bidding closed (closing date reached)"], [hist.openingAt, "opening", `${bidders.length} sealed bids opened by the tender board`],
      [new Date(Date.parse(hist.openingAt) + 3 * DAY).toISOString(), "evaluation", "Evaluation completed; ranking issued"], [recAt, "recommendation", "Recommendation issued by the procurement officer"],
      [hist.awardAt!, "awarded", `Awarded; subcontract ${a.code} created`],
    ];
    for (const [when, act, msg] of logs) logRfx(db, rfxId, act, msg, owner, when);
    db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES ('assignment',?, 'tender', ?, ?, ?)").run(a.id, `Subcontract awarded through supplier tender ${rfx.code}`, owner, sqlOf(hist.awardAt!));
  });

  /* ================================================================ live tenders */
  const projId = (n: number) => one<{ id: number }>("SELECT id FROM projects WHERE entity_id = ? AND code LIKE ?", entityId, `%-${String(n).padStart(3, "0")}`)!.id;
  const sid = (slug: string) => one<{ id: number }>("SELECT id FROM subcontractors WHERE portal_slug = ?", slug)?.id;
  const isAE = ent.code === "AE";
  // the demo supplier of the country: Gulf Trench (UAE, telecom) / Al Hajar (Oman, civil)
  const demoSlug = isAE ? "gulf-trench" : "al-hajar";
  const demo = sid(demoSlug)!;
  type LiveDef = { status: string; p: number; stage: string; tpl: TplKey; cat: string; progress: Progress; note: string; extra?: Partial<TenderSpec> };
  const LIVE: LiveDef[] = isAE ? [
    { status: "draft", p: 12, stage: "S1", tpl: "telecom", cat: "tel-cable", progress: "sealed", note: "ready to submit for approval" },
    { status: "pending_approval", p: 12, stage: "S2", tpl: "telecom", cat: "tel-cable", progress: "sealed", note: "open approval task (procurement manager, then management)" },
    { status: "scheduled", p: 12, stage: "S3", tpl: "telecom", cat: "tel-duct", progress: "sealed", note: "approved, goes live in 2 days" },
    { status: "published", p: 6, stage: "S1", tpl: "telecom", cat: "tel-cable", progress: "sealed", note: "closes in ~5 days: 2 submitted bids + 1 draft bid (Gulf Trench), clarification, addendum" },
    { status: "published", p: 6, stage: "S2", tpl: "telecom", cat: "tel-cable", progress: "sealed", note: "selective, closes in ~14 days: invitations only (Gulf Trench invited)" },
    { status: "closed", p: 11, stage: "S1", tpl: "small", cat: "civ-works", progress: "sealed", note: "closed, awaiting the opening: bids sealed" },
    { status: "opening", p: 11, stage: "S2", tpl: "small", cat: "civ-works", progress: "opened", note: "opened by the board; evaluation not started" },
    { status: "evaluation", p: 3, stage: "S5", tpl: "pipeline", cat: "og-weld", progress: "tech_eval", note: "technical evaluation, partially scored (prices sealed)" },
    { status: "evaluation", p: 8, stage: "S3", tpl: "telecom", cat: "tel-duct", progress: "comm_eval", note: "commercial evaluation: comparison sheet, arithmetic check, open BAFO request (Gulf Trench submitted a bid)" },
    { status: "recommended", p: 11, stage: "S3", tpl: "small", cat: "civ-works", progress: "recommended", note: "recommended, sign-off pending" },
    { status: "award_pending", p: 4, stage: "S4", tpl: "small", cat: "civ-works", progress: "award_pending", note: "award sent for approval (open rfx_award task)" },
    { status: "cancelled", p: 1, stage: "S6", tpl: "small", cat: "civ-works", progress: "sealed", note: "cancelled after publication" },
  ] : [
    { status: "draft", p: 12, stage: "S1", tpl: "telecom", cat: "tel-cable", progress: "sealed", note: "ready to submit for approval" },
    { status: "pending_approval", p: 12, stage: "S2", tpl: "telecom", cat: "tel-cable", progress: "sealed", note: "open approval task (escalated to the administrator)" },
    { status: "scheduled", p: 12, stage: "S3", tpl: "telecom", cat: "tel-duct", progress: "sealed", note: "approved, goes live in 2 days" },
    { status: "published", p: 11, stage: "S1", tpl: "small", cat: "civ-works", progress: "sealed", note: "closes in ~5 days: 2 submitted bids + 1 draft bid (Al Hajar), clarification, addendum" },
    { status: "published", p: 11, stage: "S2", tpl: "small", cat: "civ-works", progress: "sealed", note: "selective, closes in ~14 days: invitations only (Al Hajar invited)" },
    { status: "closed", p: 6, stage: "S1", tpl: "telecom", cat: "tel-cable", progress: "sealed", note: "closed, awaiting the opening: bids sealed" },
    { status: "opening", p: 6, stage: "S2", tpl: "telecom", cat: "tel-cable", progress: "opened", note: "technical envelopes opened; evaluation not started, prices sealed" },
    { status: "evaluation", p: 3, stage: "S5", tpl: "pipeline", cat: "og-weld", progress: "tech_eval", note: "technical evaluation, partially scored (prices sealed)" },
    { status: "evaluation", p: 8, stage: "S3", tpl: "telecom", cat: "tel-duct", progress: "comm_eval", note: "commercial evaluation: comparison sheet, arithmetic check, open BAFO request" },
    { status: "recommended", p: 11, stage: "S3", tpl: "small", cat: "civ-works", progress: "recommended", note: "recommended, sign-off pending (Al Hajar submitted a bid)" },
    { status: "award_pending", p: 4, stage: "S4", tpl: "small", cat: "civ-works", progress: "award_pending", note: "award sent for approval (open rfx_award task)" },
    { status: "cancelled", p: 1, stage: "S6", tpl: "small", cat: "civ-works", progress: "sealed", note: "cancelled after publication" },
  ];
  /* a technical-evaluation tender needs a stage nobody holds: PRJ-003 gets a new stage S5 "Tie-ins & reinstatement" (appended; nothing existing changes) */
  { const p3 = projId(3);
    const s4 = one<any>("SELECT * FROM stages WHERE project_id = ? AND code = 'S4'", p3);
    if (s4 && !one("SELECT 1 FROM stages WHERE project_id = ? AND code = 'S5'", p3)) {
      const coords = (JSON.parse(s4.geometry).geometry.coordinates as [number, number][]);
      const last = coords[coords.length - 1], prev = coords[coords.length - 2];
      const dx = (last[0] - prev[0]) * 0.35, dy = (last[1] - prev[1]) * 0.35;
      const geom = JSON.stringify({ type: "Feature", properties: { stage: "S5" }, geometry: { type: "LineString", coordinates: [last, [last[0] + dx, last[1] + dy], [last[0] + 2 * dx, last[1] + 2 * dy], [last[0] + 3 * dx, last[1] + 3 * dy]] } });
      const proj = one<any>("SELECT end_date FROM projects WHERE id = ?", p3);
      const s4Lines = all<any>("SELECT * FROM project_budget_lines WHERE stage_id = ? ORDER BY id", s4.id);
      const shares: [string, string, number][] = [["manpower", "Tie-in and reinstatement crew", 0.22], ["material", "Fittings, flanges and backfill materials", 0.3], ["equipment", "Excavators and compaction plant", 0.18], ["subcontract", "Road reinstatement and asphalt", 0.22], ["services", "Hydrotest of tie-ins and as-builts", 0.08]];
      const target = Math.round(s4.budget_amount * 0.06);
      const rows = shares.map(([cat, desc, sh]) => { const ref = s4Lines.find((l) => l.category === cat) ?? s4Lines[0]; const qty = Math.max(1, Math.round((target * sh) / ref.unit_cost)); return { cat, desc, unit: ref.unit, qty, uc: ref.unit_cost, amount: roundTo(qty * ref.unit_cost, dec) }; });
      const sid = Number(db.prepare(`INSERT INTO stages(project_id, code, name, description, sort, geometry, planned_quantity, quantity_unit, chainage_from, chainage_to, planned_start, planned_end, budget_amount, status)
        VALUES (?, 'S5', 'Tie-ins & reinstatement', ?, ?, ?, 0.5, 'km', ?, ?, ?, ?, ?, 'not_started')`).run(p3, "Tie-ins to the existing network, hydrotest of the tie-ins and road reinstatement at the end of the line.", s4.sort + 1, geom, s4.chainage_to, roundTo(s4.chainage_to + 0.5, 2),
        addDays(proj.end_date, -32), proj.end_date, rows.reduce((a, x) => a + x.amount, 0)).lastInsertRowid);
      for (const x of rows) db.prepare("INSERT INTO project_budget_lines(project_id, stage_id, category, description, unit, quantity, unit_cost, budget_amount) VALUES (?,?,?,?,?,?,?,?)").run(p3, sid, x.cat, x.desc, x.unit, x.qty, x.uc, x.amount);
    } }
  const stageCodeInfo = (p: number, stage: string) => one<any>("SELECT s.*, p.name pname FROM stages s JOIN projects p ON p.id = s.project_id WHERE s.project_id = ? AND s.code = ?", projId(p), stage)!;
  const liveOut: TenderingDemo["live"] = [];
  LIVE.forEach((L, i) => {
    const st = stageCodeInfo(L.p, L.stage);
    const owner = pickIdx(owners.length ? owners : [U[8]], i + 3);
    const stat = L.status;
    const pool = poolFor(L.cat, []);
    const pickSubs = (n: number, avoidDemo = true) => pool.filter((s) => !avoidDemo || s.id !== demo).slice(i % 2, (i % 2) + n);
    const verb = L.tpl === "telecom" ? "Fibre / duct works" : L.tpl === "pipeline" ? "Pipeline construction" : "Civil & road works";
    const closingOffset = stat === "published" ? (i === 3 ? 5 : 14) : stat === "closed" ? -1 : stat === "opening" ? -4 : stat === "evaluation" ? -(L.progress === "tech_eval" ? 9 : 16) : stat === "recommended" ? -22 : stat === "award_pending" ? -26
      : stat === "cancelled" ? 6 : stat === "scheduled" ? 23 : stat === "pending_approval" ? 21 : 24;
    const publishOffset = stat === "published" ? (i === 3 ? -16 : -7) : stat === "scheduled" ? 2 : stat === "draft" ? 3 : stat === "pending_approval" ? 1 : stat === "cancelled" ? -8 : closingOffset - 21;
    const selective = i === 4;
    const demoBidder = (isAE && ((i === 8) || i === 3)) || (!isAE && ((i === 9) || i === 3));
    const bidders: BidderSpec[] = [];
    const nBids = stat === "published" ? (i === 3 ? 2 : 0) : ["closed", "opening"].includes(stat) ? 4 : stat === "evaluation" ? 4 : stat === "recommended" ? 4 : stat === "award_pending" ? 4 : stat === "cancelled" ? 1 : 0;
    const subs = pickSubs(nBids + 1);
    if (stat === "evaluation" && L.progress === "comm_eval") {
      // gulf-trench (UAE) is one of the qualified bidders with the rank-1 price; one bid fails the technical step, one the HSE gate; one carries a planted arithmetic error
      bidders.push({ sub: isAE ? demo : subs[0].id, role: "winner", delta: -0.02, tech: 88 }, { sub: subs[1].id, role: "qualified", delta: 0.05, tech: 80, errorLine: true },
        { sub: subs[2].id, role: "dq_tech", delta: -0.06 }, { sub: subs[3].id, role: "qualified", delta: 0.11, tech: 76 });
    } else if (stat === "evaluation") {
      subs.slice(0, 4).forEach((s, k) => bidders.push({ sub: s.id, role: k === 3 ? "dq_hse" : "qualified", delta: (k - 1) * 0.06, partial: k === 2 }));
    } else if (stat === "recommended" || stat === "award_pending") {
      subs.slice(0, 4).forEach((s, k) => bidders.push({ sub: !isAE && stat === "recommended" && k === 1 ? demo : s.id, role: k === 3 ? "dq_compliance" : k === 0 ? "winner" : "qualified", delta: k === 3 ? -0.07 : 0.02 + k * 0.05 }));
    } else if (stat === "published" && i === 3) {
      subs.slice(0, 2).forEach((s, k) => bidders.push({ sub: s.id, role: "qualified", delta: k * 0.07 }));
      bidders.push({ sub: demo, role: "draft", delta: 0 });
    } else if (nBids) {
      subs.slice(0, nBids).forEach((s, k) => bidders.push({ sub: s.id, role: "qualified", delta: (k - 1) * 0.05 }));
    }
    void demoBidder;
    const closing = at(closingOffset), publishAt = at(publishOffset, 9);
    const extraInv = stat === "published" && i === 4 ? [demo, ...pickSubs(3)] .map((s: any) => (typeof s === "number" ? s : s.id)) : stat === "published" && i === 3 ? pickSubs(3).slice(0, 2).map((s) => s.id) : [];
    const sp: TenderSpec = {
      projectId: projId(L.p), stageIds: [st.id], scopeKind: "stages", title: `${verb} - ${st.name}`.slice(0, 150), description: `${verb} for ${st.name} of ${st.pname}. Supplier tender: ${L.note}.`, catCode: L.cat, tpl: L.tpl, procedure: selective ? "selective" : "open",
      ownerId: owner, chairId: CHAIR, hseId: HSE, engId: ENG, finId: FIN, createdAt: new Date(Date.parse(publishAt) - 4 * DAY).toISOString(), publishAt, clarAt: at(closingOffset - 7, 17), closingAt: closing,
      openingAt: new Date(Date.parse(closing) + 4 * 3_600_000).toISOString(), siteAt: at(publishOffset + 5, 9), bidders: bidders.filter(Boolean), progress: L.progress, ref: st.budget_amount * 0.62, exact: null,
      clar: stat === "published" && i === 3 ? 1 : ["closed", "opening", "evaluation", "recommended", "award_pending"].includes(stat) ? 1 : 0, addendum: stat === "published" && i === 3, extend: false, invitedExtra: extraInv,
      terms: { adv: 10, ret: 5, days: 30, payment: null, start: null, end: null }, evalDays: 3, pending: ["draft", "pending_approval", "scheduled", "cancelled"].includes(stat) ? (stat as any) : null, tag: undefined,
    };
    if (["draft", "pending_approval", "scheduled"].includes(stat)) { sp.bidders = []; sp.clar = 0; sp.invitedExtra = []; sp.siteAt = at(publishOffset + 8, 9); }
    if (selective && stat === "published") sp.bidders = [];
    const rfxId = build(sp);
    const rfx = one<RfxRow>("SELECT * FROM rfx_tenders WHERE id = ?", rfxId)!;
    const upd = (sql: string, ...a: unknown[]) => db.prepare(sql).run(...(a as any[]));
    const log = (when: string, act: string, msg: string) => logRfx(db, rfxId, act, msg, owner, when);
    if (stat === "draft") {
      // nothing else
    } else if (stat === "pending_approval") {
      upd("UPDATE rfx_tenders SET status = 'pending_approval' WHERE id = ?", rfxId);
      seedRequest(db, "rfx_publish", rfxId, { requestedBy: owner, hoursAgo: 20, outcome: "pending", atLevel: 1, note: "Scope, BOQ and board are complete." });
      log(at(-1), "approval", "Submitted for publication approval");
    } else if (stat === "scheduled") {
      upd("UPDATE rfx_tenders SET status = 'scheduled' WHERE id = ?", rfxId);
      seedRequest(db, "rfx_publish", rfxId, { requestedBy: owner, hoursAgo: 30, outcome: "approved" });
      log(at(-1), "scheduled", `Approved; publication scheduled for ${publishAt}`);
    } else {
      upd("UPDATE rfx_tenders SET status = ?, published_at = ?, closed_at = ? WHERE id = ?", ["published", "cancelled"].includes(stat) ? (stat === "cancelled" ? "published" : "published") : "closed", publishAt, new Date(Date.parse(closing)) <= new Date() ? closing : null, rfxId);
      seedRequest(db, "rfx_publish", rfxId, { requestedBy: owner, hoursAgo: Math.max(30, (Date.now() - Date.parse(publishAt)) / 3_600_000 + 12), outcome: "approved" });
      log(publishAt, "published", "Published; invitations sent by e-mail and portal notification");
      // invitation mails + notifications for the live tenders (the outbox proves the flow); back-dated to the publication
      const subsInvited = new Set<number>([...sp.bidders.map((b) => b.sub), ...sp.invitedExtra, ...(selective || stat !== "published" || true ? [] : [])]);
      if (stat === "published" && !selective) for (const s of poolFor(L.cat, []).slice(0, 5)) subsInvited.add(s.id);
      if (selective) subsInvited.add(demo);
      if (L.progress !== "sealed" || stat === "closed" || (stat === "published" && i === 3) || stat === "published") {
        for (const sId of subsInvited) {
          db.prepare("INSERT OR IGNORE INTO rfx_invitations(rfx_id, subcontractor_id, invited_at, intent, source) VALUES (?,?,?, 'pending', ?)").run(rfxId, sId, sqlOf(publishAt), selective ? "invited" : "eligible");
          const slug = one<{ portal_slug: string }>("SELECT portal_slug FROM subcontractors WHERE id = ?", sId)!.portal_slug;
          mailSupplier(db, sId, "tender_invitation", { code: rfx.code, title: rfx.title, category: one<{ name: string }>("SELECT name FROM supplier_categories WHERE id = ?", rfx.category_id)?.name ?? null, closingAt: closing, procedure: selective ? "Selective tender (invited suppliers)" : "Open tender", tenderHref: `/p/${slug}/tenders/${rfxId}` },
            { baseUrl, related: { type: "rfx", id: rfxId }, createdAt: sqlOf(publishAt) });
        }
      }
      // bid receipts (e-mail + portal notification) of the submitted bids
      for (const b of all<any>("SELECT * FROM rfx_bids WHERE rfx_id = ? AND status <> 'draft' AND submitted_at IS NOT NULL", rfxId)) {
        const slug = one<{ portal_slug: string }>("SELECT portal_slug FROM subcontractors WHERE id = ?", b.subcontractor_id)!.portal_slug;
        mailSupplier(db, b.subcontractor_id, "bid_received", { code: rfx.code, title: rfx.title, submittedAt: b.submitted_at, receiptHash: b.receipt_hash, revision: b.revision || 1, tenderHref: `/p/${slug}/tenders/${rfxId}` }, { baseUrl, related: { type: "rfx", id: rfxId }, createdAt: sqlOf(b.submitted_at) });
        logRfx(db, rfxId, "bid", `A sealed bid was received - receipt ${String(b.receipt_hash).slice(0, 12)}`, null, b.submitted_at);
      }
      // clarification + addendum mails (live tenders only)
      for (const c of all<any>("SELECT * FROM rfx_clarifications WHERE rfx_id = ? AND answer IS NOT NULL", rfxId))
        for (const sId of new Set<number>([...sp.bidders.map((b) => b.sub), ...sp.invitedExtra])) {
          const slug = one<{ portal_slug: string }>("SELECT portal_slug FROM subcontractors WHERE id = ?", sId)!.portal_slug;
          mailSupplier(db, sId, "clarification_answered", { code: rfx.code, title: rfx.title, question: c.question, answer: c.answer, tenderHref: `/p/${slug}/tenders/${rfxId}` }, { baseUrl, related: { type: "rfx", id: rfxId }, createdAt: c.published_at });
        }
      for (const ad of all<any>("SELECT * FROM rfx_addenda WHERE rfx_id = ?", rfxId))
        for (const sId of new Set<number>([...sp.bidders.map((b) => b.sub), ...sp.invitedExtra])) {
          const slug = one<{ portal_slug: string }>("SELECT portal_slug FROM subcontractors WHERE id = ?", sId)!.portal_slug;
          mailSupplier(db, sId, "addendum_issued", { code: rfx.code, title: rfx.title, no: ad.no, addendumTitle: ad.title, description: ad.description, newClosingAt: ad.new_closing_at, tenderHref: `/p/${slug}/tenders/${rfxId}` }, { baseUrl, related: { type: "rfx", id: rfxId }, createdAt: ad.issued_at });
        }
      if (stat === "closed") { log(closing, "closed", "Bidding closed (closing date reached); bids are sealed until the opening"); }
      if (stat === "opening") { log(closing, "closed", "Bidding closed"); log(sp.openingAt, "opening", "Technical envelopes opened by the tender board"); upd("UPDATE rfx_tenders SET status = 'opening' WHERE id = ?", rfxId); }
      if (stat === "evaluation") { log(closing, "closed", "Bidding closed"); log(sp.openingAt, "opening", "Envelopes opened by the tender board"); log(at(closingOffset + 2), "evaluation", "Evaluation started"); upd("UPDATE rfx_tenders SET status = 'evaluation' WHERE id = ?", rfxId); }
      if (stat === "recommended" || stat === "award_pending") {
        const res = evaluate(db, rfxId, true);
        const rank = (n: number) => res.rows.find((x) => x.rank === n)?.bidId;
        const pickBid = stat === "award_pending" ? (rank(2) ?? rank(1)!) : rank(1)!;
        const b = one<any>("SELECT * FROM rfx_bids WHERE id = ?", pickBid)!;
        const note = pickBid === rank(1) ? "Lowest compliant price; all compliance gates passed." : "Recommended although not rank 1: the lowest bidder cannot mobilise within the programme; second bidder keeps the programme and the price gap is small.";
        upd("UPDATE rfx_tenders SET status = ?, recommended_bid_id = ?, recommendation_note = ?, recommended_by = ?, recommended_at = ?, award_value = ? WHERE id = ?", stat, pickBid, note, owner, at(-2, 16), b.total_amount, rfxId);
        log(closing, "closed", "Bidding closed"); log(sp.openingAt, "opening", "Envelopes opened by the tender board"); log(at(-3), "evaluation", "Evaluation completed"); log(at(-2, 16), "recommendation", "Recommendation issued by the procurement officer");
        const members = all<any>("SELECT user_id FROM rfx_committee WHERE rfx_id = ? AND role IN ('chair', 'member')", rfxId);
        members.forEach((m: any, k: number) => { if (stat === "award_pending" || k < 2) db.prepare("INSERT OR IGNORE INTO rfx_signoffs(rfx_id, user_id, decision, comment, decided_at) VALUES (?,?, 'concur', ?, ?)").run(rfxId, m.user_id, k === 1 ? "Concur; mobilisation date to be confirmed in the contract." : null, sqlOf(at(-1, 11 + k))); });
        if (stat === "award_pending") { seedRequest(db, "rfx_award", rfxId, { requestedBy: owner, hoursAgo: 26, outcome: "pending", atLevel: 1, note: "Recommendation report and committee sign-off attached." }); log(at(-1), "approval", "Submitted for award approval"); }
      }
      if (stat === "cancelled") {
        upd("UPDATE rfx_tenders SET status = 'cancelled', cancel_reason = ? WHERE id = ?", "Scope re-baselined after the client changed the section limits; the section will be re-tendered.", rfxId);
        upd("UPDATE rfx_bids SET status = 'withdrawn' WHERE rfx_id = ?", rfxId);
        log(at(-2), "cancelled", "Tender cancelled: scope re-baselined after the client changed the section limits");
      }
      if (L.progress === "comm_eval") {
        const top = evaluate(db, rfxId).rows.find((x) => x.rank === 1);
        if (top) {
          const rid = Number(db.prepare("INSERT INTO rfx_bid_requests(rfx_id, bid_id, kind, message, due_at, requested_by, requested_at, status) VALUES (?,?, 'bafo', ?, ?, ?, ?, 'open')")
            .run(rfxId, top.bidId, "Please confirm your best and final offer for the whole BOQ, including traffic management, by the date shown.", at(2, 16), owner, at(-1, 10)).lastInsertRowid);
          db.prepare("INSERT INTO rfx_events(rfx_id, kind, at, minutes, created_by, data_json) VALUES (?, 'bafo_request', ?, ?, ?, ?)").run(rfxId, at(-1, 10), "BAFO requested from the top-ranked bidder", owner, JSON.stringify({ bidId: top.bidId, requestId: rid }));
          const sub = one<any>("SELECT b.subcontractor_id s, su.portal_slug slug FROM rfx_bids b JOIN subcontractors su ON su.id = b.subcontractor_id WHERE b.id = ?", top.bidId)!;
          db.prepare("INSERT INTO portal_notifications(subcontractor_id, portal_user_id, kind, title, body, href, created_at) VALUES (?,NULL, 'tender_bafo', ?, ?, ?, ?)").run(sub.s, `Revised price requested - ${rfx.code}`, "Please confirm your best and final offer for the whole BOQ.", `/p/${sub.slug}/tenders/${rfxId}`, at(-1, 10));
        }
      }
    }
    if (stat === "evaluation" && L.progress === "tech_eval") log(at(closingOffset + 2), "evaluation", "Evaluation started");
    liveOut.push({ status: stat, code: rfx.code, project: one<{ code: string }>("SELECT code FROM projects WHERE id = ?", sp.projectId)!.code, stage: `${st.code} ${st.name}`, note: L.note });
  });

  /* the demo supplier also has an award: its own historic tender is listed in the Awarded tab (see walkthrough) */
  const demoRow = one<any>("SELECT s.portal_slug slug, u.email email, s.name company FROM subcontractors s JOIN portal_users u ON u.subcontractor_id = s.id AND u.portal_role = 'owner' WHERE s.id = ? ORDER BY u.id LIMIT 1", demo);
  return {
    entityId, code: ent.code, historic: tendered.length, live: liveOut,
    demo: demoRow ? { slug: demoRow.slug, email: demoRow.email, company: demoRow.company, notes: "open opportunities, a draft bid, a submitted bid and an award" } : null,
  };
}

export type { TenderingDemo as TenderingSummary };
void goLive; void invite;
