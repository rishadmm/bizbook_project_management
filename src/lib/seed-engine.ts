/* eslint-disable @typescript-eslint/no-explicit-any */
// Seed engine (region-neutral). `seedRegion(profile)` seeds ONE country operation of the company into the shared database: the UAE profile first
// (ids identical to the single-country dataset), then Oman, each with its own entity, codes (doc prefix), currency and amounts.
// Every region-specific value lives in src/lib/seed-regions/<region>.ts. Called by src/lib/seed.ts. Run from the project root.
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import * as turf from "@turf/turf";
import { getDb } from "./db";
import { addDays, daysBetween, todayISO } from "./format";
import { getProjectMetrics, refreshRevisionTotals, syncInvoiceCost, syncProgressMaterialCosts } from "./metrics";
import { ensureSystemRoles, ensureEntities, ensureProcurementReference, DEMO_ADMIN_PASSWORD, DEMO_USER_PASSWORD } from "./migrate";
import { setActiveRegion } from "./seed-regions";
import type { GeoDef, ProjKey, ProjectDef, RegionProfile, TenderDef, Tpl } from "./seed-regions/types";
import { hashPassword } from "./password";
import { DEFAULT_ONBOARDING_ITEMS, DEFAULT_TENDER_SECTIONS, DEPARTMENTS } from "./status";
import { installDefaultWorkflows } from "./approvals/defaults";
import { seedApprovalDemo } from "./approvals/seed-demo";
import { seedInvoiceDetails, seedInvoiceDocuments } from "./seed-invoices";
import { seedPortal } from "./seed-portal";
import { seedClientPortal } from "./seed-client-portal";
import type { PortalSeedResult } from "./seed-portal";
import type { ClientSeedResult } from "./seed-client-portal";

// state of the region being seeded (seeding is strictly sequential)
let P: RegionProfile;
let RET = 5;
let rp = (n: number) => Math.round(n); // unit-cost rounding (whole units for AED, cents for OMR)
let UPLOADS = "";
let ENTITY_ID = 1;
let PREFIX = "";

const db = getDb();

/** Wipes every table IN PLACE (a running dev/prod server keeps a valid connection to the same DB), the uploads folder and re-creates the reference data (currencies, FX pegs, entities). */
export function wipeDatabase(uploads: string): void {
  fs.rmSync(uploads, { recursive: true, force: true });
  fs.mkdirSync(uploads, { recursive: true });
  db.pragma("foreign_keys = OFF");
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]) db.exec(`DELETE FROM "${t.name}"`);
  db.exec("DELETE FROM sqlite_sequence");
  db.pragma("foreign_keys = ON");
  ensureEntities(db);
  // the seed writes the per-user country access itself: the one-time migration backfill must not run over it later
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('migr_multi_country_users', '1')").run();
  // supplier trade list + registration document types (SCHEMA_VERSION 9); the seeded roles already carry the procurement permissions
  ensureProcurementReference(db);
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('migr_procurement_perm', '1')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('migr_procurement_ref', '1')").run();
}
const TODAY = todayISO();
const off = (n: number) => addDays(TODAY, n);

// deterministic PRNG
let _s = 20260;
function rnd(): number { _s |= 0; _s = (_s + 0x6d2b79f5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const jit = (a: number, b: number) => a + rnd() * (b - a);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

const ENTITY_ROOTS = new Set(["clients", "subcontractors", "tenders", "projects"]);
function ins(table: string, row: Record<string, unknown>): number {
  if (ENTITY_ROOTS.has(table) && row.entity_id === undefined) row = { ...row, entity_id: ENTITY_ID }; // root rows belong to the region's entity; children inherit through their parent
  const keys = Object.keys(row);
  const r = db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => (row[k] === undefined ? null : row[k]) as any));
  return Number(r.lastInsertRowid);
}
const q = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
const q1 = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as any[])) as T | undefined;
function log(entityType: string, entityId: number, action: string, message: string, userId: number | null, createdAt?: string) {
  ins("activity_log", { entity_type: entityType, entity_id: entityId, action, message, user_id: userId, created_at: (createdAt ?? TODAY) + " 09:00:00" });
}
function saveSeedFile(entityType: string, entityId: number, category: string, filename: string, content: string, uploader: number, date: string): number {
  const stored = `seed-${nanoid(8)}-${filename}`;
  fs.writeFileSync(path.join(UPLOADS, stored), content);
  return ins("attachments", { entity_type: entityType, entity_id: entityId, category, filename, stored_path: stored, mime: "text/plain", size: Buffer.byteLength(content), uploaded_by: uploader, note: "Demo file", created_at: date + " 10:00:00" });
}

/* ---------------------------------------------------------------- geometry helpers */
type Pt = [number, number];
function route(start: Pt, end: Pt, n: number, amp: number, phase = 0): Pt[] {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, w = i === 0 || i === n ? 0 : Math.sin(t * Math.PI * 3 + phase) * amp + Math.sin(t * Math.PI * 7 + phase) * amp * 0.3;
    pts.push([r2e(start[0] + dx * t + nx * w), r2e(start[1] + dy * t + ny * w)]);
  }
  return pts;
}
const r2e = (n: number) => Math.round(n * 1e6) / 1e6;
const lineKm = (c: Pt[]) => turf.length(turf.lineString(c), { units: "kilometers" });
function sliceLine(c: Pt[], a: number, b: number): Pt[] {
  return turf.lineSliceAlong(turf.lineString(c), a, b, { units: "kilometers" }).geometry.coordinates as Pt[];
}
const feat = (geometry: any, properties: Record<string, unknown> = {}) => ({ type: "Feature", properties, geometry });
const fc = (features: any[]) => ({ type: "FeatureCollection", features });
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[][] => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];

export interface RegionResult {
  profile: RegionProfile; entityId: number; /** user ids by 1-based slot (index 0 unused) */ U: number[]; DEPT: Record<string, number>;
  portalDemo: PortalSeedResult; clientDemo: ClientSeedResult; invoiceDemo: { longId: number | null; showcaseId: number | null }; invoiceFiles: number; projectIds: number[];
}

/** Seeds one country operation. `first` = the result of the first region (shared staff and departments are reused by later regions). */
export async function seedRegion(profile: RegionProfile, uploads: string, first: RegionResult | null): Promise<RegionResult> {
P = profile;
setActiveRegion(profile);
RET = P.tenant.retentionPct;
rp = (n: number) => (P.tenant.priceDecimals ? Math.round(n * 10 ** P.tenant.priceDecimals) / 10 ** P.tenant.priceDecimals : Math.round(n));
UPLOADS = uploads;
const FIRST = first === null;
const ent = db.prepare("SELECT * FROM entities WHERE code = ?").get(P.entity) as { id: number; doc_prefix: string };
ENTITY_ID = ent.id;
PREFIX = ent.doc_prefix;
/* ---------------------------------------------------------------- core: entity, departments, users, clients, settings */
// the entity (country operation) takes its legal details from the profile; the group-level settings are written once
db.prepare(`UPDATE entities SET legal_name = ?, address = ?, tax_no = ?, tax_label = ?, currency = ?, vat_rate = ?, country = COALESCE(country, ?),
  map_center = COALESCE(?, map_center), cr_no = COALESCE(?, cr_no), approval_cost_threshold = COALESCE(?, approval_cost_threshold) WHERE id = ?`)
  .run(P.tenant.companyName, P.tenant.address, P.tenant.taxNo, P.tenant.taxLabel, P.tenant.currency, P.tenant.vatRate, P.tenant.country,
    P.tenant.extraSettings.map_center ?? null, P.tenant.extraSettings.company_cr ?? null, P.tenant.extraSettings.approval_cost_threshold ? Number(P.tenant.extraSettings.approval_cost_threshold) : null, ENTITY_ID);
if (FIRST) {
  const setSetting = db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)");
  setSetting.run("company_name", "Al Noor Infrastructure LLC");
  setSetting.run("demo_admin_email", P.tenant.adminEmail);
}
const DEPT: Record<string, number> = FIRST ? {} : first!.DEPT;
if (FIRST) for (const [name, code] of DEPARTMENTS) DEPT[name] = ins("departments", { name, code });

// [name, legacy role text, department, role code, manager (1-based user index)]
const UN = P.userNames;
const USERS = [
  [UN[0], "admin", "Management", "super_admin", 0], [UN[1], "manager", "Operations", "project_manager", 1], [UN[2], "estimator", "Commercial", "estimator", 1],
  [UN[3], "engineer", "Technical", "engineer", 2], [UN[4], "finance", "Finance", "finance", 1], [UN[5], "hr", "HR", "hr", 1],
  [UN[6], "engineer", "Operations", "engineer", 2], [UN[7], "manager", "Procurement", "procurement", 1], [UN[8], "engineer", "HSE", "engineer", 2], [UN[9], "viewer", "Management", "viewer", 1],
  // approval approvers: a Management-role user (GM level) and a second finance user (so finance requests have a different approver)
  [UN[10], "manager", "Management", "management", 1], [UN[11], "finance", "Finance", "finance", 5],
] as const;
ensureSystemRoles(db);
const ROLE_ID: Record<string, number> = Object.fromEntries(q<{ id: number; code: string }>("SELECT id, code FROM roles").map((r) => [r.code, r.id]));
const U: number[] = [0];
const NOW_ISO = new Date().toISOString();
const isShared = (slot: number) => !FIRST && P.sharedUserSlots.includes(slot);
USERS.forEach(([name, , dept, roleCode], i) => {
  const slot = i + 1;
  if (isShared(slot)) { U.push(first!.U[slot]); return; } // shared internal staff: one account, access to both countries
  const isAdmin = roleCode === "super_admin";
  const email = isAdmin ? P.tenant.adminEmail : `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${P.tenant.emailDomain}`;
  U.push(ins("users", {
    name, email, department_id: DEPT[dept], role: roleCode, role_id: ROLE_ID[roleCode], status: "active", must_change_password: 0, failed_attempts: 0,
    password_hash: hashPassword(isAdmin ? DEMO_ADMIN_PASSWORD : DEMO_USER_PASSWORD), password_changed_at: NOW_ISO,
    job_title: P.jobTitles?.[slot] ?? (isAdmin ? "General Manager" : `${roleCode.replace(/_/g, " ")}`),
  }));
});
USERS.forEach((u, i) => { if (u[4] && !isShared(i + 1)) db.prepare("UPDATE users SET manager_id = ? WHERE id = ?").run(U[u[4]], U[i + 1]); });
// Country access (must exist before the approval demo: approvers have to be allowed to work in the country).
// First region: everybody -> its entity. Later regions: shared staff and the region's own staff -> this entity, plus the first region's management approver (11)
// and second finance user (12), who approve documents of every country.
{
  const grant = db.prepare("INSERT OR IGNORE INTO user_entities(user_id, entity_id) VALUES (?,?)");
  const setDefault = db.prepare("UPDATE users SET default_entity_id = ? WHERE id = ?");
  if (FIRST) U.slice(1).forEach((u) => { grant.run(u, ENTITY_ID); setDefault.run(ENTITY_ID, u); });
  else {
    USERS.forEach((_, i) => { const slot = i + 1; grant.run(U[slot], ENTITY_ID); if (!isShared(slot)) setDefault.run(ENTITY_ID, U[slot]); });
    for (const slot of [11, 12]) if (!isShared(slot)) grant.run(first!.U[slot], ENTITY_ID);
  }
}
if (FIRST) {
  const deptUser: Record<string, number> = { Technical: U[4], Commercial: U[3], Finance: U[5], Operations: U[2], HR: U[6], Procurement: U[8], HSE: U[9], Management: U[1] };
  for (const [name, uid] of Object.entries(deptUser)) db.prepare("UPDATE departments SET head_user_id = ? WHERE id = ?").run(uid, DEPT[name]);
  // Department heads that decide tender reviews (legacy review flow) get an explicit per-user override.
  for (const uid of [U[4], U[5], U[2]]) ins("user_permission_overrides", { user_id: uid, module: "tenders", action: "approve", effect: "allow" });
}
const deptUser: Record<string, number> = { Technical: U[4], Commercial: U[3], Finance: U[5], Operations: U[2], HR: U[6], Procurement: U[8], HSE: U[9], Management: U[1] };

const CLID: number[] = [0]; // 1-based: CLID[n] = database id of the n-th profile client
for (const c of P.clients) CLID.push(ins("clients", { name: c.name, type: c.type, contact_person: c.contact_person, email: c.email, phone: c.phone, address: c.address, notes: c.notes }));

/* ---------------------------------------------------------------- budget templates */
const TPL: Record<string, Tpl> = { ...P.templates };
TPL.telecom = TPL.cable; TPL.other = TPL.civil;
const MARGIN: Record<string, number> = { manpower: 15, material: 12, equipment: 14, services: 18, subcontract: 10, overhead: 20, contingency: 0 };
const CAT_DEPT: Record<string, string> = { manpower: "HR", material: "Procurement", equipment: "Operations", services: "Technical", subcontract: "Procurement", overhead: "Finance", contingency: "Management" };

interface LineSpec { category: string; item_code: string; description: string; unit: string; quantity: number; unit_cost: number; margin_pct: number; department_id: number; wbs_stage: string; notes: string | null }
function genLines(targetCost: number, stages: string[], tplKey: string): LineSpec[] {
  const tpl = TPL[tplKey] ?? TPL.civil;
  const out: LineSpec[] = [];
  const stageCost = (targetCost * 0.9) / stages.length;
  const qty = (cost: number, uc: number) => { const raw = cost / uc; const v = raw > 200 ? Math.round(raw) : Math.round(raw * 10) / 10; return Math.max(1, v); };
  stages.forEach((st, si) => {
    tpl.items.forEach((it, ii) => {
      const uc = rp(it.uc * jit(0.94, 1.06));
      out.push({ category: it.cat, item_code: `${String.fromCharCode(65 + si)}.${ii + 1}`, description: it.desc, unit: it.unit, quantity: qty(stageCost * it.share, uc), unit_cost: uc,
        margin_pct: r1(MARGIN[it.cat] + jit(-1.5, 1.5)), department_id: DEPT[CAT_DEPT[it.cat]], wbs_stage: st, notes: null });
    });
  });
  out.push({ category: "overhead", item_code: "G.1", description: "Site establishment, supervision & insurance", unit: "month", quantity: 12, unit_cost: r0((targetCost * 0.05) / 12), margin_pct: 20, department_id: DEPT.Finance, wbs_stage: "General", notes: "Project-wide" });
  out.push({ category: "contingency", item_code: "G.2", description: "Contingency allowance", unit: "lot", quantity: 1, unit_cost: r0(targetCost * 0.05), margin_pct: 0, department_id: DEPT.Management, wbs_stage: "General", notes: "Project-wide" });
  return out;
}

/* ---------------------------------------------------------------- geometry & stage plans (from the region profile) */
interface StagePlan { code: string; name: string; geometry: any; qty: number; unit: string; from: number | null; to: number | null; weight: number | null }
function lineStages(coords: Pt[], n: number, prefix: string): StagePlan[] {
  const L = lineKm(coords);
  const step = L / n;
  return Array.from({ length: n }, (_, i) => {
    const a = i * step, b = i === n - 1 ? L : (i + 1) * step;
    const g = sliceLine(coords, a, b);
    const name = `${prefix} ${String.fromCharCode(65 + i)} (km ${a.toFixed(1)}–${b.toFixed(1)})`;
    return { code: `S${i + 1}`, name, geometry: feat({ type: "LineString", coordinates: g }, { stage: `S${i + 1}` }), qty: r2(b - a), unit: "km", from: r2(a), to: r2(b), weight: null };
  });
}
// polygon split into n vertical strips (zones)
function polyStages(x0: number, y0: number, dx: number, dy: number, names: string[], weights: number[]): StagePlan[] {
  return names.map((name, i) => {
    const r = rect(r2e(x0 + (dx * i) / names.length), y0, r2e(x0 + (dx * (i + 1)) / names.length), y0 + dy);
    return { code: `S${i + 1}`, name, geometry: feat({ type: "Polygon", coordinates: r }, { stage: `S${i + 1}` }), qty: r0(turf.area(turf.polygon(r))), unit: "sqm", from: null, to: null, weight: weights[i] };
  });
}
interface Geo { qty: number; unit: string; geometry: any; stages: StagePlan[]; line: Pt[] | null }
const GEO: Partial<Record<ProjKey, Geo>> = {};
const geoKm: Partial<Record<ProjKey, number>> = {};
function buildGeo(key: ProjKey, g: GeoDef): Geo {
  if (g.kind === "poly") {
    const poly = rect(g.x0, g.y0, g.x0 + g.dx, g.y0 + g.dy);
    let stages: StagePlan[];
    if (g.split === "quad") {
      const { x0, y0, dx, dy } = g;
      const zoneRects = [rect(x0, y0, x0 + dx / 2, y0 + dy / 2), rect(x0 + dx / 2, y0, x0 + dx, y0 + dy / 2), rect(x0, y0 + dy / 2, x0 + dx / 2, y0 + dy), rect(x0 + dx / 2, y0 + dy / 2, x0 + dx, y0 + dy)];
      stages = zoneRects.map((r, i) => ({ code: `S${i + 1}`, name: g.zones[i], geometry: feat({ type: "Polygon", coordinates: r }, { stage: `S${i + 1}` }), qty: r0(turf.area(turf.polygon(r))), unit: "sqm", from: null, to: null, weight: g.weights[i] }));
    } else stages = polyStages(g.x0, g.y0, g.dx, g.dy, g.zones, g.weights);
    return { qty: r0(turf.area(turf.polygon(poly))), unit: "sqm", geometry: fc([feat({ type: "Polygon", coordinates: poly }, { kind: "project" })]), stages, line: null };
  }
  let line: Pt[];
  if (g.kind === "slice") {
    const parent = GEO[g.of]!.line!, km = geoKm[g.of]!;
    line = g.head !== undefined ? sliceLine(parent, 0, g.head) : sliceLine(parent, km - g.tail!, km);
  } else line = route(g.from, g.to, g.n, g.amp, g.phase);
  const km = r1(lineKm(line));
  geoKm[key] = km;
  return { qty: km, unit: "km", geometry: fc([feat({ type: "LineString", coordinates: line }, { kind: "project" })]), stages: lineStages(line, g.sections, g.prefix), line };
}
for (const key of Object.keys(P.geometry) as ProjKey[]) GEO[key] = buildGeo(key, P.geometry[key]!);
const gq = (k: ProjKey) => GEO[k]!.qty;
console.log(`Geometry: P1 ${gq("P1")} km, P2 ${gq("P2")} km, P3 ${gq("P3")} km, P4 ${(gq("P4") / 10000).toFixed(0)} ha, P7 ${gq("P7")} km, P8 ${gq("P8")} km, P9 ${gq("P9")} km, P11 ${gq("P11")} km`);

/* ---------------------------------------------------------------- tenders */
interface TenderCfg extends TenderDef { owner: number; stages: string[] }
const pkgs = ["Package A", "Package B", "Package C", "Package D"];
const TENDERS: TenderCfg[] = P.tenders.map((t) => ({
  ...t, owner: U[3], qty: t.project ? gq(t.project) : t.qty, unit: t.project ? GEO[t.project]!.unit : t.unit, stages: t.project ? GEO[t.project]!.stages.map((x) => x.name) : pkgs,
}));

const SECTION_TEXT: Record<string, string> = P.sectionText;

const tenderIds: number[] = [];
const tenderRevs: Record<number, { id: number; rev_no: number; status: string; lines: number[]; specs: LineSpec[] }[]> = {};

TENDERS.forEach((t, idx) => {
  const code = `${PREFIX}TND-2026-${String(idx + 1).padStart(3, "0")}`;
  const tid = ins("tenders", {
    code, title: t.title, client_id: CLID[t.client], kind: t.kind, category: t.category, location: t.location, scope_summary: t.scope,
    technical_spec: `${t.ref ? `Client reference: ${t.ref}\n` : ""}Scope per RFP: ${t.scope}\nStandards: ${P.standardsText}`,
    quantity: t.qty, quantity_unit: t.unit, issue_date: off(t.issue), clarification_deadline: off(t.clar), submission_deadline: off(t.submit),
    bid_bond_amount: t.bond ?? null, estimated_value: r0(t.cost * 1.12), status: t.status, owner_id: t.owner, probability_pct: t.prob,
    submitted_at: t.submittedAt !== undefined ? off(t.submittedAt) : null, decided_at: t.decided !== undefined ? off(t.decided) : null,
    created_at: off(t.issue + 1) + " 08:00:00",
  });
  tenderIds.push(tid);
  log("tender", tid, "create", `Tender ${code} created`, t.owner, off(t.issue + 1));

  // sections
  const done = ["submitted", "negotiation", "won", "lost", "approved", "under_review"].includes(t.status);
  DEFAULT_TENDER_SECTIONS.forEach(([dept, title], si) => {
    let status = "not_started";
    if (done) status = "completed";
    else if (t.status === "in_preparation") status = si < 4 ? "completed" : si === 4 ? "in_progress" : "not_started";
    else if (t.status === "draft") status = si === 0 ? "in_progress" : "not_started";
    else if (["no_bid", "cancelled"].includes(t.status)) status = si < 2 ? "completed" : "not_started";
    ins("tender_sections", {
      tender_id: tid, department_id: DEPT[dept], title, content: status === "not_started" ? null : SECTION_TEXT[dept], status, assignee_id: deptUser[dept],
      due_date: off(t.submit - 7 - si), completed_at: status === "completed" ? off(Math.min(t.submit - 8, -1)) : null,
    });
  });

  // revisions + lines
  const base = genLines(t.cost, t.stages, t.category);
  tenderRevs[tid] = [];
  let prev: LineSpec[] = base;
  let prevIds: number[] = [];
  t.revs.forEach((rc, ri) => {
    const specs: LineSpec[] = ri === 0 ? base : prev.map((l) => ({ ...l, margin_pct: Math.max(2, r1(l.margin_pct + rc.mDelta - (ri > 1 ? t.revs[ri - 1].mDelta : 0) + jit(-0.3, 0.3))), unit_cost: rp(l.unit_cost * (rc.cFactor / (ri > 1 ? t.revs[ri - 1].cFactor : 1))) }));
    const revId = ins("tender_revisions", {
      tender_id: tid, rev_no: ri, label: `R${ri}`, reason: rc.reason, status: rc.status, submitted_at: rc.submitted !== null ? off(rc.submitted) : null,
      client_feedback: rc.feedback ?? null, created_by: U[3], created_at: off((rc.submitted ?? t.issue + 20) - 3) + " 09:00:00",
    });
    const ids = specs.map((l, i) => ins("budget_lines", { revision_id: revId, tender_id: tid, sort: i, ...l }));
    refreshRevisionTotals(revId);
    if (ri > 0) {
      specs.forEach((l, i) => {
        const o = prev[i];
        if (Math.abs(o.margin_pct - l.margin_pct) > 0.05)
          ins("margin_changes", { budget_line_id: ids[i], revision_id: revId, old_margin: o.margin_pct, new_margin: l.margin_pct, reason: rc.reason, user_id: U[3], created_at: off((rc.submitted ?? -2) - 2) + " 11:00:00" });
      });
    }
    tenderRevs[tid].push({ id: revId, rev_no: ri, status: rc.status, lines: ids, specs });
    prev = specs; prevIds = ids;
    if (ri > 0) log("revision", revId, "create", `Revision R${ri} created: ${rc.reason}`, U[3], off((rc.submitted ?? -2) - 3));
  });
  void prevIds;
  const lastRev = tenderRevs[tid][tenderRevs[tid].length - 1];
  const finalRev = tenderRevs[tid].find((r) => r.status === "final") ?? lastRev;
  const useRev = t.status === "won" ? finalRev : lastRev;
  db.prepare("UPDATE tenders SET current_revision_id = ?, won_value = ? WHERE id = ?").run(useRev.id, t.status === "won" ? q1<any>("SELECT total_price p FROM tender_revisions WHERE id=?", finalRev.id)!.p : null, tid);

  // reviews
  const revDepts = ["Technical", "Finance", "Operations", "Management"];
  if (["under_review", "approved", "submitted", "negotiation", "won", "lost"].includes(t.status)) {
    revDepts.forEach((d, di) => {
      let decision = "approved";
      if (t.status === "under_review") decision = di < 2 ? "approved" : "pending";
      if (t.status === "under_review" && di === 1) decision = "changes_requested";
      if (t.status === "under_review" && di === 2) decision = "rejected";
      ins("tender_reviews", { tender_id: tid, revision_id: tenderRevs[tid][0].id, department_id: DEPT[d], reviewer_id: deptUser[d],
        decision, comment: decision === "approved" ? "Reviewed and approved." : decision === "changes_requested" ? "Cash-flow assumptions need a 60-day payment cycle; please revisit contingency." : decision === "rejected" ? "Crew histogram cannot be supported with current commitments; resubmit with phased mobilisation." : null,
        decided_at: decision === "pending" ? null : off(Math.min(t.submit - 3, -1)) + " 15:00:00" });
    });
    log("tender", tid, "review", "Sent for internal review", U[3], off(Math.min(t.submit - 5, -2)));
  }
  // negotiations
  if (["negotiation", "won"].includes(t.status) || (t.status === "lost" && idx === 4)) {
    const revs = tenderRevs[tid];
    const nCount = t.status === "negotiation" ? 5 : 1 + (idx % 2);
    for (let n = 0; n < nCount; n++) {
      const rev = revs[Math.min(n, revs.length - 1)];
      const price = q1<any>("SELECT total_price p FROM tender_revisions WHERE id=?", rev.id)!.p;
      ins("negotiations", { tender_id: tid, revision_id: rev.id, date: off((t.decided ?? -10) - 25 + n * (t.status === "negotiation" ? 6 : 9)), channel: ["meeting", "email", "call", "letter", "site_visit"][n % 5],
        summary: `Round ${n + 1}: commercial discussion on price, retention and programme.`, client_position: "Requests price reduction and shorter programme.", our_position: "Offered VE options; programme driven by permit durations.",
        client_target_price: r0(price * (0.94 + n * 0.012)), outcome: n === nCount - 1 ? "Converging" : "Open", next_step: n === nCount - 1 ? "Finalise BAFO" : "Submit revised pricing" });
    }
  }
  // status log
  if (t.submittedAt !== undefined) log("tender", tid, "status", "Submitted to client", t.owner, off(t.submittedAt));
  if (t.decided !== undefined) log("tender", tid, "status", `Marked ${t.status.replace("_", " ")}`, t.owner, off(t.decided));
});

// loss analyses
const LOSS = P.loss;
for (const l of LOSS) {
  const tid = tenderIds[l.idx];
  const last = tenderRevs[tid][tenderRevs[tid].length - 1];
  const ourPrice = q1<any>("SELECT total_price p FROM tender_revisions WHERE id=?", last.id)!.p;
  const lid = ins("loss_analyses", { tender_id: tid, primary_reason: l.reason, secondary_reasons: l.secondary, winner_name: l.winner, winner_price: r0(ourPrice / (1 + l.gap / 100)), our_price: r0(ourPrice),
    price_gap_pct: l.gap, technical_score: l.score, client_feedback: l.fb, root_cause: l.root, lessons_learned: l.lessons, action_items: l.actions, owner_id: U[2], status: l.status });
  log("loss", lid, "create", "Loss analysis opened", U[2], off((TENDERS[l.idx].decided ?? -30) + 2));
}
console.log(`Seeded ${tenderIds.length} tenders`);

/* ---------------------------------------------------------------- subcontractors */
const SUBS = P.subs;
const SUB: number[] = [0];
SUBS.forEach((s, i) => {
  const id = ins("subcontractors", { code: `${PREFIX}SUB-${String(i + 1).padStart(3, "0")}`, name: s.name, trade: s.trade, categories: s.cats, contact_person: s.contact,
    email: `info@${P.subGen.emailLocal ? P.subGen.emailLocal(s.name) : s.name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14)}${P.subGen.emailSuffix}`, phone: P.subGen.phone(i), address: s.address + P.subGen.addressSuffix,
    trade_license_no: P.subGen.licenseNo(i), trade_license_expiry: off(s.docs.find((d) => d[0] === "trade_license")?.[1] ?? 300), tax_no: P.subGen.taxNo(i), bank_name: P.subGen.bank(i), iban: P.subGen.iban(i),
    status: s.status, rating: s.rating, notes: s.notes, created_at: off(-420 + i * 15) + " 09:00:00" });
  SUB.push(id);
  DEFAULT_ONBOARDING_ITEMS.forEach((item, k) => {
    const done = k < s.checklist;
    ins("onboarding_checklist", { subcontractor_id: id, item, done: done ? 1 : 0, done_by: done ? U[8] : null, done_at: done ? off(-400 + i * 15 + k * 3) + " 12:00:00" : null });
  });
  s.docs.forEach(([type, exp, status], di) => {
    let att: number | null = null;
    if (status === "verified" && di < 2) att = saveSeedFile("subcontractor", id, type, `${type}-${id}.txt`, `Demo ${P.subDoc.fileLabel(type)} for ${s.name}\n(placeholder document)`, U[8], off(-380));
    ins("subcontractor_documents", { subcontractor_id: id, doc_type: type, ref_no: `${type.slice(0, 3).toUpperCase()}-${5000 + id * 13 + di}`, issue_date: exp !== null ? off(exp - 365) : off(-200), expiry_date: exp !== null ? off(exp) : null, attachment_id: att, status });
  });
  log("subcontractor", id, "create", `Subcontractor ${s.name} registered (${s.status})`, U[8], off(-420 + i * 15));
});

/* ---------------------------------------------------------------- projects, stages, budget */
const PID: Partial<Record<ProjKey, number>> = {};
const projectIds: number[] = [];
const stageIds: Record<number, number[]> = {};
const stageInfo: Record<number, { id: number; plan: StagePlan; budget: number; pstart: string; pend: string }[]> = {};

function createProject(c: ProjectDef): number {
  const geo = GEO[c.key]!;
  const tid = c.tender !== null ? tenderIds[c.tender] : null;
  let budget = c.budget ?? 0, contract = c.contract ?? 0;
  let lineRows: { spec: LineSpec; srcId: number | null }[] = [];
  if (tid) {
    const fr = tenderRevs[tid].find((r) => r.status === "final")!;
    const t = q1<any>("SELECT total_cost c, total_price p FROM tender_revisions WHERE id=?", fr.id)!;
    budget = r0(t.c); contract = r0(t.p);
    lineRows = fr.specs.map((spec, i) => ({ spec, srcId: fr.lines[i] }));
  } else if (c.tpl) {
    lineRows = genLines(budget, geo.stages.map((s) => s.name), c.tpl).map((spec) => ({ spec, srcId: null }));
  }
  const created = Math.min(c.start - 14, -10);
  const pid = ins("projects", {
    code: PREFIX + c.code, name: c.name, tender_id: tid, client_id: CLID[c.client], parent_id: c.parent ? PID[c.parent] : null, category: c.category, region: c.region, location: c.location, contract_value: contract, budget_cost: budget,
    start_date: off(c.start), end_date: off(c.end), status: c.status, manager_id: U[c.manager], total_quantity: geo.qty, quantity_unit: geo.unit, geometry: JSON.stringify(geo.geometry), description: c.desc,
    created_at: off(created) + " 09:00:00",
  });
  projectIds.push(pid);
  PID[c.key] = pid;
  if (tid) db.prepare("UPDATE tenders SET project_id = ? WHERE id = ?").run(pid, tid);
  // stages
  const dur = c.end - c.start, n = geo.stages.length, win = dur / n;
  stageIds[pid] = []; stageInfo[pid] = [];
  const stageBudgets = new Map<string, number>();
  for (const l of lineRows) stageBudgets.set(l.spec.wbs_stage, (stageBudgets.get(l.spec.wbs_stage) ?? 0) + l.spec.quantity * l.spec.unit_cost);
  const eq = (budget * 0.9) / n;
  geo.stages.forEach((s, i) => {
    const ps = c.start + Math.round(i * win * 0.92), pe = Math.min(c.end, ps + Math.round(win * 1.08));
    const b = r0(stageBudgets.get(s.name) ?? eq);
    const sid = ins("stages", { project_id: pid, code: s.code, name: s.name, description: `${s.name} – ${s.qty} ${s.unit}`, sort: i, geometry: JSON.stringify(s.geometry), planned_quantity: s.qty, quantity_unit: s.unit,
      chainage_from: s.from, chainage_to: s.to, planned_start: off(ps), planned_end: off(pe), budget_amount: b, status: "not_started", weight_pct: s.weight });
    stageIds[pid].push(sid);
    stageInfo[pid].push({ id: sid, plan: s, budget: b, pstart: off(ps), pend: off(pe) });
  });
  // project budget lines
  for (const l of lineRows) {
    const st = stageInfo[pid].find((s) => s.plan.name === l.spec.wbs_stage);
    ins("project_budget_lines", { project_id: pid, stage_id: st?.id ?? null, category: l.spec.category, description: l.spec.description, unit: l.spec.unit, quantity: l.spec.quantity, unit_cost: l.spec.unit_cost,
      budget_amount: r0(l.spec.quantity * l.spec.unit_cost), source_budget_line_id: l.srcId });
  }
  log("project", pid, "create", `Project ${c.code} created${tid ? " from tender " + q1<any>("SELECT code FROM tenders WHERE id=?", tid)!.code : ""}`, U[c.manager], off(created));
  return pid;
}

for (const pd of P.projects) createProject(pd);
const P2 = PID.P2!, P7 = PID.P7!;
console.log("Projects", projectIds.join(","));

/* ---------------------------------------------------------------- assignments + progress simulation */
interface Stall { from: number; to: number; resp: string; cause: string }
interface AsgCfg {
  project: number; stageIdx: number; sub: number; kind: "primary" | "secondary" | "draft"; a0?: number; a1?: number; pct?: number; stalls?: Stall[];
  cvFactor?: number; portal?: boolean; retention?: number; advance?: number; days?: number; scope: string; overclaim?: number; pendingLast?: number; crew?: number; status?: string;
  stageStatus?: string; rejectInvoice?: boolean; lumpsum?: boolean; ccType?: string[];
  /** measured quantity of a secondary scope as a share of the stage quantity (instead of a lump sum) */ qtyShare?: number;
  /** calibrate certified invoices so that the segment CPI (earned / certified) equals this */ cpi?: number;
  /** extra portal reports rejected by the project manager */ rejected?: number;
  /** label used by the issue seed to find this assignment */ tag?: string;
}
const MAT_PLAN = P.matPlan;
const TRADES: Record<string, string[]> = {
  road: ["Foreman", "Paving crew", "Operators", "Helpers"], cable: ["Foreman", "Cable pullers", "Trench crew", "Splicers"],
  pipeline: ["Foreman", "Pipe layers", "Operators", "Welders/Fitters"], civil: ["Foreman", "Steel fixers", "Operators", "Helpers"],
};
const EQUIP: Record<string, string> = {
  road: "Excavator x2, Dump trucks x6, Paver x1, Roller x2, Grader x1", cable: "Trencher x2, HDD rig x1, Cable drum trailer x2, Compressor x1",
  pipeline: "Excavator x3, Side-boom x2, Welding sets x2, Dump trucks x4", civil: "Excavator x2, Loader x1, Dump trucks x5, Concrete pump x1",
};
const ISSUES_TXT = ["Minor utility marker discrepancy, resolved on site", "Material delivery delayed by half a day", "Traffic diversion adjusted by client", "Dust control watering increased", "Survey re-check required at CH change", "Night shift added to recover time"];

const asgIds: { id: number; project: number; sub: number; stageId: number | null; cv: number; code: string; cfg: AsgCfg; a0?: number; a1?: number }[] = [];
let asgCounter = 0, certCounter = 0;
const projCat: Record<number, string> = {};
function pcat(pid: number): string { return projCat[pid] ??= q1<any>("SELECT category c FROM projects WHERE id=?", pid)!.c; }

function createAssignment(cfg: AsgCfg): void {
  const pid = cfg.project, st = stageInfo[pid][cfg.stageIdx];
  const cat = pcat(pid);
  const code = `${PREFIX}SC-${String(++asgCounter).padStart(3, "0")}`;
  const cvFactor = cfg.cvFactor ?? (cfg.kind === "primary" ? 0.62 * jit(0.96, 1.04) : cfg.kind === "secondary" ? 0.08 : 0.6);
  const cv = r0(st.budget * cvFactor);
  const active = cfg.kind !== "draft";
  const complete = active && cfg.pct === 100 && (cfg.a1 ?? 0) < -1;
  const status = cfg.status ?? (cfg.kind === "draft" ? "draft" : complete ? "completed" : "active");
  const qty = cfg.lumpsum || (cfg.kind === "secondary" && !cfg.qtyShare) ? null : r2(st.plan.qty * (cfg.qtyShare ?? 1));
  const asgId = ins("assignments", {
    code, project_id: pid, stage_id: st.id, subcontractor_id: cfg.sub, scope: cfg.scope, contract_value: cv, quantity: qty, quantity_unit: qty ? st.plan.unit : "lumpsum", unit_rate: qty ? r2(cv / qty) : null,
    start_date: st.pstart, end_date: st.pend, payment_terms: `Monthly certified invoices, ${cfg.advance ?? 10}% advance recovered pro-rata, ${cfg.retention ?? RET}% retention, payment within ${cfg.days ?? 30} days of certification.`,
    advance_pct: cfg.advance ?? 10, retention_pct: cfg.retention ?? RET, payment_days: cfg.days ?? 30, status, portal_token: active ? nanoid(24) : null, portal_enabled: active && cfg.portal !== false && status === "active" ? 1 : 0,
    created_at: off(Math.min(0, daysBetween(TODAY, st.pstart)) - 10) + " 09:00:00",
  });
  log("assignment", asgId, "create", `Assignment ${code} created for ${SUBS[SUB.indexOf(cfg.sub) - 1].name}`, q1<any>("SELECT manager_id m FROM projects WHERE id=?", pid)!.m, off(Math.min(0, daysBetween(TODAY, st.pstart)) - 10));
  asgIds.push({ id: asgId, project: pid, sub: cfg.sub, stageId: st.id, cv, code, cfg });
  if (cfg.kind === "draft") return;

  // ---- progress reports
  const a0 = cfg.a0!, a1 = cfg.a1 ?? 0, pct = cfg.pct ?? 0;
  const span = a1 - a0;
  const step = Math.max(7, Math.ceil(span / 19));
  const dates: number[] = [];
  for (let d = a0; d < a1; d += step) dates.push(d);
  dates.push(a1);
  const K = dates.length;
  const stalls = cfg.stalls ?? [];
  const stalled = (d: number) => stalls.find((s) => d >= s.from && d <= s.to);
  const weights = dates.map((d, k) => { const x = (k + 0.5) / K; return (0.55 + 0.9 * Math.sin(Math.PI * x)) * jit(0.85, 1.15) * (stalled(d) ? 0.08 : 1); });
  const total = weights.reduce((a, b) => a + b, 0);
  let cum = 0;
  const managerId = q1<any>("SELECT manager_id m FROM projects WHERE id=?", pid)!.m;
  const crew = cfg.crew ?? (cat === "road" ? 38 : cat === "civil" ? 34 : 26);
  const mats = MAT_PLAN[cat] ?? MAT_PLAN.civil;
  const trades = TRADES[cat] ?? TRADES.civil;
  const primaryQtyReports = cfg.kind === "primary" && !cfg.lumpsum;
  const stageMat = st.budget * 0.10;
  dates.forEach((d, k) => {
    const delta = weights[k] / total;
    const prevCum = cum;
    cum += delta;
    const stall = stalled(d);
    const qDone = primaryQtyReports ? r2(delta * (pct / 100) * st.plan.qty) : 0;
    const cumQty = primaryQtyReports ? r2(cum * (pct / 100) * st.plan.qty) : 0;
    const headcount = Math.max(4, r0(crew * (stall ? 0.35 : 1) * jit(0.85, 1.12)));
    const isPending = cfg.pendingLast !== undefined && k >= K - cfg.pendingLast;
    const viaPortal = status === "active" && cfg.portal !== false && (k % 3 !== 2 || isPending);
    const delayDays = stall ? Math.round(step * 0.85) : 0;
    const rep = ins("progress_reports", {
      assignment_id: asgId, stage_id: st.id, project_id: pid, report_date: off(d), quantity_done: qDone, cumulative_quantity: cumQty, percent_complete: r1(cum * pct),
      manpower_count: headcount, man_hours: headcount * 9 * Math.min(step, 6), equipment_used: EQUIP[cat],
      work_done: primaryQtyReports ? `Completed ${qDone.toFixed(2)} ${st.plan.unit} (${st.plan.name}); cumulative ${cumQty.toFixed(2)} ${st.plan.unit}.` : `${cfg.scope}: progress ${r1(cum * pct)}% of scope.`,
      issues: stall ? stall.cause : rnd() < 0.18 ? ISSUES_TXT[Math.floor(rnd() * ISSUES_TXT.length)] : null,
      delay_days: delayDays, delay_cause: stall ? stall.cause : null, delay_responsibility: stall ? stall.resp : "none", source: viaPortal ? "portal" : "internal",
      status: isPending ? "submitted" : "verified", verified_by: isPending ? null : managerId, verified_at: isPending ? null : off(d + 1) + " 16:00:00", created_at: off(d) + " 17:00:00",
    });
    // manpower lines
    let rem = headcount;
    trades.forEach((tr, ti) => { const h = ti === trades.length - 1 ? rem : Math.max(1, r0(headcount * ([0.1, 0.35, 0.3][ti] ?? 0.1))); rem -= h; if (h > 0) ins("progress_manpower", { progress_report_id: rep, trade: tr, headcount: h, hours: h * 9 * Math.min(step, 6) }); });
    // material lines (primary reports only)
    if (primaryQtyReports && qDone > 0) {
      for (const [name, unit, uc, share] of mats) {
        const quantity = Math.max(1, r0(((cum - prevCum) * (pct / 100) * stageMat * share) / uc));
        ins("progress_materials", { progress_report_id: rep, material: name, unit, quantity, unit_cost: rp(uc * jit(0.97, 1.05)) });
      }
      syncProgressMaterialCosts(rep);
    }
  });
  // portal reports the project manager rejected (not backed by survey sheets)
  for (let i = 0; i < (cfg.rejected ?? 0); i++) {
    const d = a1 - 3 - i * 5;
    ins("progress_reports", {
      assignment_id: asgId, stage_id: st.id, project_id: pid, report_date: off(d), quantity_done: primaryQtyReports ? r2(st.plan.qty * 0.012) : 0, cumulative_quantity: 0, percent_complete: r1(Math.max(0, pct - 2)),
      manpower_count: Math.max(4, r0(crew * 0.6)), man_hours: Math.max(4, r0(crew * 0.6)) * 9, equipment_used: EQUIP[cat], work_done: `${cfg.scope}: progress claimed for the week.`,
      issues: "Rejected by the project manager: measured quantities are below the claim. Resubmit with signed survey sheets.", delay_days: 0, delay_cause: null, delay_responsibility: "none", source: "portal", status: "rejected",
      verified_by: managerId, verified_at: off(d + 1) + " 16:00:00", created_at: off(d) + " 17:00:00",
    });
  }
  // stage status/dates
  const sts = cfg.stageStatus ?? (pct >= 100 ? "completed" : stalls.some((s) => s.to >= -40) ? "delayed" : "in_progress");
  if (cfg.kind === "primary" || !db.prepare("SELECT actual_start FROM stages WHERE id=?").get(st.id)) {
    db.prepare("UPDATE stages SET status = ?, actual_start = COALESCE(actual_start, ?), actual_end = ? WHERE id = ?").run(sts, off(a0), pct >= 100 ? off(a1) : null, st.id);
  }
  asgIds[asgIds.length - 1].a0 = a0; asgIds[asgIds.length - 1].a1 = a1;

  // ---- invoices (monthly)
  const asgPct = (cut: number) => {
    const rows = q<any>("SELECT percent_complete p FROM progress_reports WHERE assignment_id=? AND status='verified' AND report_date<=? ORDER BY report_date DESC LIMIT 1", asgId, off(cut));
    return rows.length ? rows[0].p : 0;
  };
  const cuts: number[] = [];
  for (let c = a0 + 30; c <= Math.min(a1, 0); c += 30) cuts.push(c);
  if (complete) cuts.push(a1 + 5);
  else if (cuts.length === 0 || cuts[cuts.length - 1] < -10) cuts.push(Math.min(0, a1) - 2);
  let prevPct = 0;
  cuts.forEach((cut, k) => {
    const cumPct = asgPct(Math.min(cut, 0));
    const dPct = Math.max(0, cumPct - prevPct);
    if (dPct <= 0.01) return;
    prevPct = cumPct;
    const age = -cut;
    const fair = (dPct / 100) * cv;
    const claimed = r0(fair * (cfg.overclaim ?? jit(1.0, 1.03)));
    let statusI = age > 55 ? "paid" : age > 32 ? "approved" : age > 18 ? "certified" : age > 7 ? "under_review" : "submitted";
    if (cfg.rejectInvoice && k === 1) statusI = "rejected";
    const certified = ["certified", "approved", "paid"].includes(statusI) ? r0(fair * jit(0.96, 1.0)) : 0;
    const ret = r0(certified * ((cfg.retention ?? RET) / 100)), adv = r0(certified * ((cfg.advance ?? 10) / 100));
    const net = certified - ret - adv;
    const invId = ins("sub_invoices", {
      assignment_id: asgId, project_id: pid, invoice_no: `${code}-INV-${String(k + 1).padStart(2, "0")}`, invoice_date: off(cut), period_from: off(cut - 30), period_to: off(cut - 1), claimed_amount: claimed, claimed_percent: r1(dPct),
      certified_amount: certified, retention_amount: ret, advance_recovery: adv, net_payable: net, status: statusI, paid_amount: statusI === "paid" ? net : 0, paid_date: statusI === "paid" ? off(cut + (cfg.days ?? 30)) : null,
      source: status === "active" && cfg.portal !== false && k % 2 === 0 ? "portal" : "internal", notes: statusI === "rejected" ? "Rejected: claimed quantities exceed verified progress." : cfg.overclaim && cfg.overclaim > 1.1 ? "Claim exceeds verified progress; certified at measured quantities." : null,
      created_at: off(cut) + " 12:00:00",
    });
    syncInvoiceCost(invId);
  });
  if (cfg.cpi) {
    // over-/under-certification story: certified invoices = earned value / target CPI
    const invs = q<any>("SELECT * FROM sub_invoices WHERE assignment_id=? AND status IN ('certified','approved','paid')", asgId);
    const sum = invs.reduce((x: number, i: any) => x + i.certified_amount, 0);
    const earned = cv * (complete ? 1 : asgPct(0) / 100); // verified progress only
    if (sum > 0) {
      const f = earned / cfg.cpi / sum;
      for (const i of invs) {
        const c = r0(i.certified_amount * f), ret = r0(c * ((cfg.retention ?? RET) / 100)), adv = r0(c * ((cfg.advance ?? 10) / 100)), net = c - ret - adv;
        db.prepare("UPDATE sub_invoices SET certified_amount=?, retention_amount=?, advance_recovery=?, net_payable=?, claimed_amount=MAX(claimed_amount, ?), paid_amount=? WHERE id=?").run(c, ret, adv, net, c, i.status === "paid" ? net : 0, i.id);
        syncInvoiceCost(i.id);
      }
    }
  }

  // ---- certificates
  const mkCert = (type: string, st2: string, pctC: number, date: number, src = "internal", remarks = "") => {
    certCounter++;
    ins("completion_certificates", { assignment_id: asgId, project_id: pid, stage_id: st.id, cert_type: type, cert_no: `${PREFIX}CC-${String(certCounter).padStart(3, "0")}`, cert_date: off(date), percent: pctC, quantity: qty ? r2(qty * pctC / 100) : null,
      remarks: remarks || `${type} completion for ${cfg.scope}`, status: st2, issued_by: st2 === "issued" ? managerId : null, source: src, created_at: off(date) + " 10:00:00" });
  };
  if (complete) { mkCert("substantial", "issued", 100, a1 + 3); mkCert("final", "issued", 100, a1 + 20, "internal", "Final acceptance, snag list closed."); }
  else if (pct >= 50) mkCert("partial", "issued", 50, Math.round((a0 + a1) / 2) + 10);
  if (!complete && pct >= 25 && status === "active") mkCert("partial", "requested", Math.round(pct * 0.9 / 5) * 5, -3, "portal", "Subcontractor requests partial completion certificate.");
  if (cfg.ccType?.includes("rejected")) mkCert("partial", "rejected", 80, -20, "portal", "Rejected: snag items outstanding.");
  if (cfg.ccType?.includes("draft")) mkCert("taking_over", "draft", 100, 5);
}

// the story of every subcontract (numbers + texts come from the region profile)
P.assignments.forEach((a) => createAssignment({ ...a, project: PID[a.project]!, sub: SUB[a.sub] }));
// Section D of the street rehabilitation waits for the utility diversion approval (no work yet)
db.prepare("UPDATE stages SET status = 'on_hold' WHERE id = ?").run(stageIds[P7][3]);
console.log(`Seeded ${asgIds.length} assignments`);

/* ---------------------------------------------------------------- manual costs (calibrated to the story CPIs) */
const CPI_TARGET: Record<number, number> = Object.fromEntries(P.projects.map((pd) => [PID[pd.key]!, pd.cpiTarget ?? pd.cpi]));
for (const pid of projectIds) {
  const p = q1<any>("SELECT start_date s, manager_id m FROM projects WHERE id=?", pid)!;
  const m = getProjectMetrics(pid);
  const auto = (q1<any>("SELECT COALESCE(SUM(amount),0) v FROM project_costs WHERE project_id=?", pid)!).v;
  if (m.ev <= 0) continue;
  const target = m.ev / CPI_TARGET[pid];
  const manual = target - auto;
  if (manual <= 0) { console.warn(`  note: project ${pid} auto costs (${r0(auto)}) already exceed target AC (${r0(target)})`); continue; }
  const startOff = daysBetween(TODAY, p.s);
  const months: number[] = [];
  for (let d = startOff + 15; d <= -3; d += 30) months.push(d);
  if (!months.length) months.push(-5);
  const remedial = pid === P2 ? manual * 0.18 : 0;
  const normal = manual - remedial;
  const split: [string, number, string][] = [["manpower", 0.42, "Direct labour & supervision"], ["equipment", 0.33, "Company equipment & fuel"], ["overhead", 0.25, "Site overheads & logistics"]];
  const wts = months.map((_, i) => 0.7 + 0.6 * ((i + 1) / months.length));
  const wsum = wts.reduce((a, b) => a + b, 0);
  months.forEach((d, i) => {
    for (const [cat, share, desc] of split) {
      const amt = r0((normal * share * wts[i]) / wsum);
      if (amt > 0) ins("project_costs", { project_id: pid, stage_id: null, category: cat, description: `${desc} – ${off(d).slice(0, 7)}`, amount: amt, cost_date: off(d), source_type: "manual", source_id: null });
    }
  });
  if (remedial > 0) {
    const stg = stageIds[pid];
    [[-110, stg[1], "Remedial trenching – failed reinstatement (back-charge to subcontractor pending)", 0.4], [-60, stg[2], "Acceleration crew hired to recover delay", 0.35], [-25, stg[3], "Replacement trencher rental after subcontractor breakdown", 0.25]].forEach(([d, sid, desc, share]) =>
      ins("project_costs", { project_id: pid, stage_id: sid as number, category: "services", description: desc as string, amount: r0(remedial * (share as number)), cost_date: off(d as number), source_type: "manual", source_id: null }));
  }
}

/* ---------------------------------------------------------------- issues */
const asgByCode = (c: string) => asgIds.find((a) => a.code === PREFIX + c)?.id ?? null;
const ISSUES = P.issues;
// resolve assignment codes by looking up the Gulf assignments in creation order
const gulf = asgIds.filter((a) => a.sub === SUB[3]).map((a) => a.id);
ISSUES.forEach((i) => {
  const asg = i.asg?.startsWith("tag:") ? (asgIds.find((a) => a.cfg.tag === i.asg!.slice(4))?.id ?? null) : i.asg === "SC-009" ? gulf[0] : i.asg === "SC-010" ? gulf[1] : i.asg === "SC-011" ? gulf[2] : i.asg ? asgByCode(i.asg) : null;
  const iid = ins("issues", { project_id: PID[i.p]!, stage_id: i.stage !== null ? stageIds[PID[i.p]!][i.stage] : null, assignment_id: asg, title: i.title, description: i.desc, responsibility: i.resp, impact_days: i.days, impact_cost: i.cost, status: i.status, raised_on: off(i.raised), resolved_on: i.resolved !== undefined ? off(i.resolved) : null });
  void iid;
});

/* ---------------------------------------------------------------- invoice documents: lines, VAT, certification, people (attachment files are written at the end) */
const invoiceDemo = seedInvoiceDetails(db, { today: TODAY, entityId: ENTITY_ID, users: { clerk: U[8], finance: U[5], finance2: U[12] }, syncCost: syncInvoiceCost });

/* ---------------------------------------------------------------- project documents */
projectIds.slice(0, 4).forEach((pid, i) => {
  saveSeedFile("project", pid, "Contract", `Contract-summary-${i + 1}.txt`, `Demo contract summary for project ${pid}\nContract value and key dates are held in the system.`, U[2], off(-250));
  saveSeedFile("project", pid, "Reports", `Monthly-report-${i + 1}.txt`, `Demo monthly progress report for project ${pid}.`, U[2], off(-30));
});
tenderIds.forEach((tid, i) => {
  if (i < 9) saveSeedFile("tender", tid, "RFP", `RFP-${TENDERS[i].category}-${i + 1}.txt`, `Demo RFP summary: ${TENDERS[i].title}\n${TENDERS[i].ref ? `Ref: ${TENDERS[i].ref}\n` : ""}Scope: ${TENDERS[i].scope}`, U[3], off(TENDERS[i].issue + 1));
});

/* ---------------------------------------------------------------- approval workflows + demo requests (AUTH_SPEC sections D/E) */
installDefaultWorkflows(db, U[1], P.tenant.workflowScale, FIRST ? null : ENTITY_ID);
seedApprovalDemo(db, { sara: U[4], daniel: U[7], imran: U[5], mariam: U[12], rahul: U[3], layla: U[2], omar: U[1], hamdan: U[11] }, ENTITY_ID);

/* ---------------------------------------------------------------- subcontractor login portal (PORTAL_SPEC section 4) */
const portalDemo = seedPortal(db, { today: TODAY, uploads: UPLOADS, admin: U[1], clerk: U[8], entityId: ENTITY_ID });

/* ---------------------------------------------------------------- client portal (CLIENT_PORTAL_SPEC section 4) */
const clientDemo = seedClientPortal(db, { today: TODAY, uploads: UPLOADS, admin: U[1], entityId: ENTITY_ID, prefix: PREFIX });

/* ---------------------------------------------------------------- recent audit trail + activity feed */
{
  const stamp = (daysAgo: number, hh: number, mm = 0) => { const d = new Date(Date.now() - daysAgo * 86_400_000); d.setUTCHours(hh, mm, 0, 0); return d; };
  const iso = (d: Date) => d.toISOString();
  const sql = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
  const IP = ["10.20.4.11", "10.20.4.23", "10.20.5.8", "10.20.6.40", "82.114.37.9"];
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Safari/605.1.15";
  const email = (uid: number) => (q1<any>("SELECT email e FROM users WHERE id = ?", uid)!).e as string;
  const uname = (uid: number) => (q1<any>("SELECT name n FROM users WHERE id = ?", uid)!).n as string;
  const ev = (when: Date, event: string, uid: number | null, detail: string | null, ip = IP[0], mail: string | null = null) =>
    ins("auth_events", { user_id: uid, email: mail ?? (uid ? email(uid) : null), event, ip, user_agent: UA, detail, created_at: iso(when) });
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((uid, k) => {
    if (isShared(uid)) return; // shared staff already have their sign-in history from the first region
    ev(stamp(k % 5, 4 + (k % 4), 10 + k), "login_success", U[uid], null, IP[k % 4]);
    if (k % 3 === 0) ev(stamp(k % 5, 13, 30 + k), "logout", U[uid], null, IP[k % 4]);
  });
  if (FIRST) {
  ev(stamp(0, 5, 52), "login_success", U[1], "Remembered session", IP[0]);
  ev(stamp(1, 7, 41), "login_failed", null, "Invalid email or password", IP[4], "j.smith@unknown-mail.example");
  ev(stamp(1, 8, 2), "login_failed", U[9], "Invalid email or password", IP[2]);
  ev(stamp(1, 8, 3), "login_failed", U[9], "Invalid email or password", IP[2]);
  ev(stamp(1, 8, 5), "locked", U[9], "Account locked after 5 failed sign-in attempts", IP[2]);
  ev(stamp(1, 9, 20), "user_unlocked", U[1], `Unlocked ${uname(U[9])}`, IP[0]);
  ev(stamp(2, 10, 5), "password_changed", U[7], "Password changed by the user", IP[1]);
  ev(stamp(2, 11, 15), "password_reset", U[1], `Temporary password issued to ${uname(U[8])}`, IP[0]);
  ev(stamp(3, 9, 30), "user_created", U[1], `Created user ${uname(U[11])}`, IP[0]);
  ev(stamp(3, 9, 34), "role_changed", U[1], `${uname(U[11])}: role set to Management`, IP[0]);
  ev(stamp(3, 9, 40), "user_created", U[1], `Created user ${uname(U[12])}`, IP[0]);
  ev(stamp(4, 14, 12), "permissions_changed", U[1], "Tender approve permission granted to the Technical, Finance and Operations heads", IP[0]);
  ev(stamp(4, 15, 3), "user_updated", U[1], `Updated profile of ${uname(U[6])} (department and job title)`, IP[0]);
  ev(stamp(5, 8, 45), "user_disabled", U[1], `Disabled ${uname(U[10])} during a leave of absence`, IP[0]);
  ev(stamp(4, 8, 10), "user_enabled", U[1], `Re-enabled ${uname(U[10])}`, IP[0]);
  ev(stamp(2, 16, 25), "session_revoked", U[1], `Revoked an idle session of ${uname(U[7])}`, IP[0]);
  }

  // business activity in the last days (shows in the audit log and the entity timelines)
  const act = (when: Date, type: string, id: number, action: string, msg: string, uid: number | null) =>
    ins("activity_log", { entity_type: type, entity_id: id, action, message: msg, user_id: uid, created_at: sql(when) });
  const recentReps = q<any>(`SELECT r.id, r.project_id, r.assignment_id, r.report_date FROM progress_reports r JOIN projects pp ON pp.id = r.project_id WHERE pp.entity_id = ${ENTITY_ID} AND r.status = 'verified' ORDER BY r.report_date DESC, r.id DESC LIMIT 6`);
  recentReps.forEach((r, i) => act(stamp(i % 3, 7 + i, 20 + i), "project", r.project_id, "progress", `Progress report of ${r.report_date} verified`, q1<any>("SELECT manager_id m FROM projects WHERE id = ?", r.project_id)!.m));
  q<any>(`SELECT id, invoice_no, status, project_id FROM sub_invoices WHERE project_id IN (SELECT id FROM projects WHERE entity_id = ${ENTITY_ID}) AND status IN ('certified','under_review','submitted') ORDER BY id DESC LIMIT 5`)
    .forEach((i, k) => act(stamp(k % 3, 9 + k, 5 * k), "invoice", i.id, "status", `Invoice ${i.invoice_no} ${i.status.replace("_", " ")}`, U[5]));
  q<any>(`SELECT id, title FROM issues WHERE project_id IN (SELECT id FROM projects WHERE entity_id = ${ENTITY_ID}) AND status <> 'closed' ORDER BY raised_on DESC, id DESC LIMIT 4`)
    .forEach((i, k) => act(stamp(k % 2, 8 + k, 15), "project", q1<any>("SELECT project_id p FROM issues WHERE id = ?", i.id)!.p, "issue", `Issue updated: ${i.title}`, U[2]));
  q<any>(`SELECT id, code, status FROM tenders WHERE entity_id = ${ENTITY_ID} AND status IN ('negotiation','submitted','under_review','in_preparation') ORDER BY id DESC LIMIT 4`)
    .forEach((t, k) => act(stamp(k % 3, 10 + k, 40), "tender", t.id, "status", `Tender ${t.code} reviewed (${t.status.replace("_", " ")})`, U[3]));
  q<any>(`SELECT id, name FROM subcontractors WHERE entity_id = ${ENTITY_ID} AND status IN ('onboarding','prospect') LIMIT 2`)
    .forEach((s, k) => act(stamp(k, 12, 10), "subcontractor", s.id, "document", `Compliance document uploaded for ${s.name}`, U[8]));
}

/* ---------------------------------------------------------------- invoice files + result */
const invoiceFiles = await seedInvoiceDocuments(db, { uploads: UPLOADS, entityId: ENTITY_ID, users: { clerk: U[8] }, company: { name: P.tenant.companyName, address: P.tenant.address, trn: P.tenant.taxNo } });
console.log(`Seeded ${P.entity}: ${projectIds.length} projects, ${asgIds.length} assignments, ${invoiceFiles} invoice files`);
return { profile: P, entityId: ENTITY_ID, U, DEPT, portalDemo, clientDemo, invoiceDemo, invoiceFiles, projectIds };
}
