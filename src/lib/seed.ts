/* eslint-disable @typescript-eslint/no-explicit-any */
// `npm run seed` — wipes data/ops.db and uploads/, then seeds realistic UAE-style demo data (SPEC section 7).
// Run from the project root (db.ts resolves data/ and schema.sql from process.cwd()).
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import * as turf from "@turf/turf";
import { getDb } from "./db";
import { addDays, daysBetween, todayISO } from "./format";
import { getProjectMetrics, refreshRevisionTotals, syncInvoiceCost, syncProgressMaterialCosts } from "./metrics";
import { ensureSystemRoles, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, DEMO_USER_PASSWORD } from "./migrate";
import { hashPassword } from "./password";
import { DEFAULT_ONBOARDING_ITEMS, DEFAULT_TENDER_SECTIONS, DEPARTMENTS } from "./status";
import { installDefaultWorkflows } from "./approvals/defaults";
import { seedApprovalDemo } from "./approvals/seed-demo";

const UPLOADS = process.env.OPS_UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
fs.rmSync(UPLOADS, { recursive: true, force: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const db = getDb();
// Wipe IN PLACE (do not unlink the file): a running dev/prod server keeps a valid connection to the same DB.
db.pragma("foreign_keys = OFF");
for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]) db.exec(`DELETE FROM "${t.name}"`);
db.exec("DELETE FROM sqlite_sequence");
db.pragma("foreign_keys = ON");
const TODAY = todayISO();
const off = (n: number) => addDays(TODAY, n);

// deterministic PRNG
let _s = 20260;
function rnd(): number { _s |= 0; _s = (_s + 0x6d2b79f5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const jit = (a: number, b: number) => a + rnd() * (b - a);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

function ins(table: string, row: Record<string, unknown>): number {
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

/* ---------------------------------------------------------------- core: departments, users, clients, settings */
db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('company_name','Al Noor Infrastructure LLC')").run();
db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('currency','AED')").run();
const DEPT: Record<string, number> = {};
for (const [name, code] of DEPARTMENTS) DEPT[name] = ins("departments", { name, code });

// [name, legacy role text, department, role code, manager (1-based user index)]
const USERS = [
  ["Omar Al Farsi", "admin", "Management", "super_admin", 0], ["Layla Hassan", "manager", "Operations", "project_manager", 1], ["Rahul Menon", "estimator", "Commercial", "estimator", 1],
  ["Sara Khalid", "engineer", "Technical", "engineer", 2], ["Imran Qureshi", "finance", "Finance", "finance", 1], ["Fatima Al Ali", "hr", "HR", "hr", 1],
  ["Daniel Cruz", "engineer", "Operations", "engineer", 2], ["Aisha Rahman", "manager", "Procurement", "procurement", 1], ["Tariq Mahmood", "engineer", "HSE", "engineer", 2], ["Noura Saeed", "viewer", "Management", "viewer", 1],
  // approval approvers: a Management-role user (GM level) and a second finance user (so finance requests have a different approver)
  ["Hamdan Al Zaabi", "manager", "Management", "management", 1], ["Mariam Khoury", "finance", "Finance", "finance", 5],
] as const;
ensureSystemRoles(db);
const ROLE_ID: Record<string, number> = Object.fromEntries(q<{ id: number; code: string }>("SELECT id, code FROM roles").map((r) => [r.code, r.id]));
const U: number[] = [0];
const NOW_ISO = new Date().toISOString();
for (const [name, , dept, roleCode] of USERS) {
  const isAdmin = roleCode === "super_admin";
  const email = isAdmin ? DEMO_ADMIN_EMAIL : `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@alnoor.demo`;
  U.push(ins("users", {
    name, email, department_id: DEPT[dept], role: roleCode, role_id: ROLE_ID[roleCode], status: "active", must_change_password: 0, failed_attempts: 0,
    password_hash: hashPassword(isAdmin ? DEMO_ADMIN_PASSWORD : DEMO_USER_PASSWORD), password_changed_at: NOW_ISO,
    job_title: isAdmin ? "General Manager" : `${USERS.find((x) => x[0] === name)![3].replace(/_/g, " ")}`,
  }));
}
USERS.forEach((u, i) => { if (u[4]) db.prepare("UPDATE users SET manager_id = ? WHERE id = ?").run(U[u[4]], U[i + 1]); });
const deptUser: Record<string, number> = { Technical: U[4], Commercial: U[3], Finance: U[5], Operations: U[2], HR: U[6], Procurement: U[8], HSE: U[9], Management: U[1] };
for (const [name, uid] of Object.entries(deptUser)) db.prepare("UPDATE departments SET head_user_id = ? WHERE id = ?").run(uid, DEPT[name]);
// Department heads that decide tender reviews (legacy review flow) get an explicit per-user override.
for (const uid of [U[4], U[5], U[2]]) ins("user_permission_overrides", { user_id: uid, module: "tenders", action: "approve", effect: "allow" });

const CL = {
  rta: ins("clients", { name: "Roads & Transport Authority (demo)", type: "road_authority", contact_person: "Eng. Khalid Al Mansoori", email: "projects@rta-demo.ae", phone: "+971 4 000 1100", address: "Business Bay, Dubai", notes: "Primary road client; strict NOC process." }),
  tel: ins("clients", { name: "Etisalat-like Telecom (demo)", type: "telecom", contact_person: "Mona Al Suwaidi", email: "network.build@telco-demo.ae", phone: "+971 4 000 2200", address: "Al Barsha, Dubai", notes: "Fibre roll-out programme." }),
  wea: ins("clients", { name: "Water & Electricity Authority (demo)", type: "utility", contact_person: "Eng. Yousef Rahimi", email: "capital.works@wea-demo.ae", phone: "+971 4 000 3300", address: "Al Wasl Road, Dubai", notes: "Utility NOCs required for every crossing." }),
  mun: ins("clients", { name: "Dubai Municipality (demo)", type: "government", contact_person: "Hind Al Maktoum", email: "contracts@dm-demo.ae", phone: "+971 4 000 4400", address: "Deira, Dubai", notes: null }),
  dev: ins("clients", { name: "Skyline Developments (demo)", type: "private", contact_person: "James Whitfield", email: "pm@skyline-demo.ae", phone: "+971 4 000 5500", address: "Downtown Dubai", notes: "Master developer, Dubai South." }),
  adm: ins("clients", { name: "Abu Dhabi Mobility (demo)", type: "road_authority", contact_person: "Saeed Al Dhaheri", email: "tenders@admobility-demo.ae", phone: "+971 2 000 6600", address: "Abu Dhabi", notes: null }),
};

/* ---------------------------------------------------------------- budget templates */
interface Item { cat: string; desc: string; unit: string; uc: number; share: number }
interface Tpl { items: Item[]; unit: string }
const TPL: Record<string, Tpl> = {
  road: { unit: "km", items: [
    { cat: "manpower", desc: "Road crew labour", unit: "man-day", uc: 185, share: 0.10 },
    { cat: "material", desc: "Asphalt wearing & binder course", unit: "ton", uc: 310, share: 0.24 },
    { cat: "material", desc: "Aggregate base & sub-base", unit: "m3", uc: 95, share: 0.14 },
    { cat: "equipment", desc: "Paving & compaction fleet", unit: "day", uc: 4200, share: 0.14 },
    { cat: "subcontract", desc: "Earthworks & excavation", unit: "m3", uc: 65, share: 0.30 },
    { cat: "services", desc: "Survey, testing & QA/QC", unit: "month", uc: 90000, share: 0.08 }] },
  cable: { unit: "km", items: [
    { cat: "manpower", desc: "Cable pulling crew", unit: "man-day", uc: 175, share: 0.10 },
    { cat: "material", desc: "Fibre optic cable 96F", unit: "m", uc: 14, share: 0.30 },
    { cat: "material", desc: "HDPE duct & accessories", unit: "m", uc: 11, share: 0.16 },
    { cat: "equipment", desc: "Trenching & HDD rigs", unit: "day", uc: 3800, share: 0.14 },
    { cat: "subcontract", desc: "Trenching, ducting & reinstatement", unit: "m", uc: 48, share: 0.22 },
    { cat: "services", desc: "OTDR testing & as-builts", unit: "month", uc: 60000, share: 0.08 }] },
  pipeline: { unit: "km", items: [
    { cat: "manpower", desc: "Pipe-laying crew", unit: "man-day", uc: 190, share: 0.09 },
    { cat: "material", desc: "DI pipe 600mm", unit: "m", uc: 1450, share: 0.34 },
    { cat: "material", desc: "Valves, fittings & bedding", unit: "lot", uc: 140000, share: 0.13 },
    { cat: "equipment", desc: "Excavators & side-booms", unit: "day", uc: 4600, share: 0.14 },
    { cat: "subcontract", desc: "Trenching, shoring & road crossings", unit: "m", uc: 520, share: 0.22 },
    { cat: "services", desc: "Hydrotest & commissioning", unit: "month", uc: 80000, share: 0.08 }] },
  civil: { unit: "sqm", items: [
    { cat: "manpower", desc: "Civil works labour", unit: "man-day", uc: 170, share: 0.12 },
    { cat: "material", desc: "Concrete & rebar", unit: "m3", uc: 640, share: 0.28 },
    { cat: "material", desc: "Precast & utilities fittings", unit: "lot", uc: 95000, share: 0.16 },
    { cat: "equipment", desc: "Heavy plant hire", unit: "day", uc: 3900, share: 0.12 },
    { cat: "subcontract", desc: "Earthworks & grading", unit: "m3", uc: 58, share: 0.24 },
    { cat: "services", desc: "Testing & surveying", unit: "month", uc: 70000, share: 0.08 }] },
};
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
      const uc = r0(it.uc * jit(0.94, 1.06));
      out.push({ category: it.cat, item_code: `${String.fromCharCode(65 + si)}.${ii + 1}`, description: it.desc, unit: it.unit, quantity: qty(stageCost * it.share, uc), unit_cost: uc,
        margin_pct: r1(MARGIN[it.cat] + jit(-1.5, 1.5)), department_id: DEPT[CAT_DEPT[it.cat]], wbs_stage: st, notes: null });
    });
  });
  out.push({ category: "overhead", item_code: "G.1", description: "Site establishment, supervision & insurance", unit: "month", quantity: 12, unit_cost: r0((targetCost * 0.05) / 12), margin_pct: 20, department_id: DEPT.Finance, wbs_stage: "General", notes: "Project-wide" });
  out.push({ category: "contingency", item_code: "G.2", description: "Contingency allowance", unit: "lot", quantity: 1, unit_cost: r0(targetCost * 0.05), margin_pct: 0, department_id: DEPT.Management, wbs_stage: "General", notes: "Project-wide" });
  return out;
}

/* ---------------------------------------------------------------- geometry & stage plans for the 4 won projects */
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
// P1: Emirates Road (E611) widening
const P1_LINE = route([55.3000, 25.0500], [55.4300, 25.1550], 14, 0.0035, 0.4);
const P1_KM = r1(lineKm(P1_LINE));
const P1_STAGES = lineStages(P1_LINE, 6, "Section");
// P2: fibre route along Sheikh Mohammed Bin Zayed Rd (E311)
const P2_LINE = route([55.0450, 24.9950], [55.3350, 25.2650], 24, 0.0040, 1.1);
const P2_KM = r1(lineKm(P2_LINE));
const P2_STAGES = lineStages(P2_LINE, 5, "Segment");
// sub-projects of P2 re-use two slices of the route each
const P2A_LINE = sliceLine(P2_LINE, 0, 8);
const P2B_LINE = sliceLine(P2_LINE, P2_KM - 7, P2_KM);
const P2A_STAGES = lineStages(P2A_LINE, 2, "Link A");
const P2B_STAGES = lineStages(P2B_LINE, 2, "Link B");
// P3: pipeline near Al Ain road (E66)
const P3_LINE = route([55.5650, 24.9020], [55.6540, 24.8300], 12, 0.0030, 2.0);
const P3_KM = r1(lineKm(P3_LINE));
const P3_STAGES = lineStages(P3_LINE, 4, "Reach");
// P4: Dubai South polygon (utilities & civil)
const X0 = 55.1560, Y0 = 24.8900, DX = 0.0180, DY = 0.0090;
const P4_POLY = rect(X0, Y0, X0 + DX, Y0 + DY);
const P4_AREA = r0(turf.area(turf.polygon(P4_POLY)));
const zoneNames = ["Zone A – Utilities corridor", "Zone B – Logistics yard", "Zone C – Access roads", "Zone D – Drainage & landscaping"];
const zoneRects = [rect(X0, Y0, X0 + DX / 2, Y0 + DY / 2), rect(X0 + DX / 2, Y0, X0 + DX, Y0 + DY / 2), rect(X0, Y0 + DY / 2, X0 + DX / 2, Y0 + DY), rect(X0 + DX / 2, Y0 + DY / 2, X0 + DX, Y0 + DY)];
const P4_STAGES: StagePlan[] = zoneRects.map((r, i) => ({
  code: `S${i + 1}`, name: zoneNames[i], geometry: feat({ type: "Polygon", coordinates: r }, { stage: `S${i + 1}` }), qty: r0(turf.area(turf.polygon(r))), unit: "sqm", from: null, to: null, weight: [30, 25, 25, 20][i],
}));
console.log(`Geometry: P1 ${P1_KM} km, P2 ${P2_KM} km, P3 ${P3_KM} km, P4 ${(P4_AREA / 10000).toFixed(0)} ha`);

/* ---------------------------------------------------------------- tenders */
interface RevCfg { status: string; mDelta: number; cFactor: number; reason: string; submitted: number | null; feedback?: string }
interface TenderCfg {
  title: string; client: number; kind: string; category: string; location: string; scope: string; qty: number | null; unit: string | null;
  issue: number; clar: number; submit: number; cost: number; status: string; prob: number; owner: number; stages: string[]; revs: RevCfg[];
  decided?: number; submittedAt?: number; bond?: number;
}
const pkgs = ["Package A", "Package B", "Package C", "Package D"];
const R = (status: string, mDelta: number, cFactor: number, reason: string, submitted: number | null, feedback?: string): RevCfg => ({ status, mDelta, cFactor, reason, submitted, feedback });
const TENDERS: TenderCfg[] = [
  { title: "Emirates Road (E611) widening – 18 km, 2 to 4 lanes", client: CL.rta, kind: "tender", category: "road", location: "Emirates Road, Dubai", scope: "Widening of Emirates Road from 2 to 4 lanes per direction incl. drainage, street lighting and ITS ducts.", qty: P1_KM, unit: "km", issue: -340, clar: -325, submit: -310, cost: 78e6, status: "won", prob: 100, owner: U[3], stages: P1_STAGES.map((s) => s.name), decided: -255, submittedAt: -310, bond: 1.5e6,
    revs: [R("superseded", 0, 1, "Initial submission", -310, "Price high vs. budget; request VE options."), R("superseded", -1.5, 0.985, "Value-engineering on base course and earthworks", -280, "Closer. Final BAFO requested."), R("final", -2.5, 0.975, "BAFO after negotiation", -262)] },
  { title: "Dubai–Sharjah fibre backbone along E311 – 42 km duct & fibre", client: CL.tel, kind: "tender", category: "cable", location: "Sheikh Mohammed Bin Zayed Road", scope: "Supply and installation of 96F fibre and HDPE duct backbone with hand-holes every 250 m, incl. testing and as-builts.", qty: P2_KM, unit: "km", issue: -400, clar: -385, submit: -370, cost: 52e6, status: "won", prob: 100, owner: U[3], stages: P2_STAGES.map((s) => s.name), decided: -320, submittedAt: -370, bond: 1.0e6,
    revs: [R("superseded", 0, 1, "Initial submission", -370, "Technical OK, negotiate price."), R("final", -2, 0.98, "Negotiated price", -340)] },
  { title: "Al Ain Road trunk water pipeline – 12 km DI 600mm", client: CL.wea, kind: "tender", category: "pipeline", location: "Dubai–Al Ain Road (E66)", scope: "Laying 12 km DI 600mm trunk main incl. 3 road crossings by thrust boring, valves, hydrotest and commissioning.", qty: P3_KM, unit: "km", issue: -270, clar: -255, submit: -245, cost: 61e6, status: "won", prob: 100, owner: U[3], stages: P3_STAGES.map((s) => s.name), decided: -200, submittedAt: -245, bond: 1.2e6,
    revs: [R("final", 0, 1, "Initial submission", -245, "Accepted with minor clarifications.")] },
  { title: "Dubai South utilities & civil enabling works – 180 ha", client: CL.dev, kind: "tender", category: "civil", location: "Dubai South", scope: "Utility corridor, logistics yard, access roads and drainage for a 180 ha plot including landscaping.", qty: P4_AREA, unit: "sqm", issue: -160, clar: -148, submit: -140, cost: 44e6, status: "won", prob: 100, owner: U[3], stages: P4_STAGES.map((s) => s.name), decided: -95, submittedAt: -140, bond: 0.8e6,
    revs: [R("superseded", 0, 1, "Initial submission", -140, "Phasing discussion required."), R("final", -1, 0.99, "Phased pricing", -118)] },
  { title: "Sharjah–Kalba road dualisation – 22 km", client: CL.adm, kind: "tender", category: "road", location: "Sharjah–Kalba corridor", scope: "Dualisation of a 22 km single carriageway incl. two interchanges.", qty: 22, unit: "km", issue: -200, clar: -185, submit: -170, cost: 56e6, status: "lost", prob: 0, owner: U[3], stages: pkgs, decided: -120, submittedAt: -170,
    revs: [R("superseded", 0, 1, "Initial submission", -170, "Price 13% above lowest bid."), R("submitted", -1, 0.99, "Revised price after clarification", -150, "Awarded to another bidder.")] },
  { title: "5G backhaul fibre ring – Abu Dhabi Island", client: CL.tel, kind: "proposal", category: "cable", location: "Abu Dhabi", scope: "Design & build of a metro fibre ring supporting 5G backhaul.", qty: 16, unit: "km", issue: -150, clar: -140, submit: -130, cost: 31e6, status: "lost", prob: 0, owner: U[3], stages: pkgs, decided: -80, submittedAt: -130,
    revs: [R("submitted", 0, 1, "Initial submission", -130, "Technical score below threshold on HDD methodology.")] },
  { title: "Hamdan Street stormwater upgrade", client: CL.mun, kind: "tender", category: "civil", location: "Hamdan Street, Abu Dhabi", scope: "Upgrade of 3.5 km stormwater network incl. pump station.", qty: 3.5, unit: "km", issue: -90, clar: -80, submit: -70, cost: 24e6, status: "lost", prob: 0, owner: U[3], stages: pkgs, decided: -35, submittedAt: -70,
    revs: [R("superseded", 0, 1, "Initial submission", -70), R("submitted", -0.5, 0.995, "Programme compression", -55, "Our programme was 4 months longer than awardee.")] },
  { title: "Al Qudra Road resurfacing & shoulder widening", client: CL.rta, kind: "tender", category: "road", location: "Al Qudra Road", scope: "Resurfacing 14 km and widening shoulders; night works.", qty: 14, unit: "km", issue: -80, clar: -68, submit: -42, cost: 38e6, status: "negotiation", prob: 65, owner: U[3], stages: pkgs, submittedAt: -42,
    revs: [R("superseded", 0, 1, "Initial submission", -42, "Client target ~6% below our price."), R("submitted", -1.5, 0.985, "Revised after round 1", -20, "Close; one more round on retention."), R("draft", -2.5, 0.975, "Draft BAFO – under internal review", null)] },
  { title: "Fibre-to-the-home Dubai Hills – phase 2", client: CL.tel, kind: "tender", category: "telecom", location: "Dubai Hills Estate", scope: "FTTH distribution network for 2,400 villas.", qty: 2400, unit: "nos", issue: -45, clar: -35, submit: -12, cost: 27e6, status: "submitted", prob: 45, owner: U[3], stages: pkgs, submittedAt: -12,
    revs: [R("submitted", 0, 1, "Initial submission", -12)] },
  { title: "Jebel Ali water trunk main – 9 km", client: CL.wea, kind: "tender", category: "pipeline", location: "Jebel Ali", scope: "9 km DI 800mm trunk main with 2 crossings.", qty: 9, unit: "km", issue: -25, clar: -15, submit: 4, cost: 49e6, status: "approved", prob: 55, owner: U[3], stages: pkgs, bond: 0.9e6,
    revs: [R("draft", 0, 1, "Initial bid – approved internally, awaiting submission", null)] },
  { title: "Ras Al Khor service road upgrade", client: CL.rta, kind: "tender", category: "road", location: "Ras Al Khor", scope: "Upgrade of 5 km service road, utility relocation, lighting.", qty: 5, unit: "km", issue: -20, clar: -10, submit: 6, cost: 19e6, status: "under_review", prob: 50, owner: U[3], stages: pkgs,
    revs: [R("draft", 0, 1, "Initial bid", null)] },
  { title: "Mussafah industrial roads package", client: CL.adm, kind: "tender", category: "road", location: "Mussafah, Abu Dhabi", scope: "New internal roads for an industrial zone, 8 km.", qty: 8, unit: "km", issue: -14, clar: 0, submit: 21, cost: 33e6, status: "in_preparation", prob: 35, owner: U[3], stages: pkgs,
    revs: [R("draft", 0, 1, "Initial bid", null)] },
  { title: "Yas Island duct bank expansion", client: CL.tel, kind: "tender", category: "cable", location: "Yas Island", scope: "Multi-way duct bank, 4.2 km, with manholes.", qty: 4.2, unit: "km", issue: -4, clar: 12, submit: 33, cost: 14e6, status: "draft", prob: 20, owner: U[3], stages: pkgs,
    revs: [R("draft", 0, 1, "Initial bid", null)] },
  { title: "Sharjah–Ajman pipeline relocation (RFQ)", client: CL.wea, kind: "rfq", category: "pipeline", location: "Sharjah–Ajman", scope: "Relocation of 2 km existing pipeline; short RFQ.", qty: 2, unit: "km", issue: -30, clar: -22, submit: -2, cost: 9e6, status: "no_bid", prob: 0, owner: U[3], stages: pkgs, decided: -20,
    revs: [R("draft", 0, 1, "Pricing started before no-bid decision", null)] },
  { title: "Palm Jumeirah utility corridor (EOI)", client: CL.dev, kind: "eoi", category: "civil", location: "Palm Jumeirah", scope: "Expression of interest for a utility corridor; programme cancelled by client.", qty: null, unit: "lumpsum", issue: -60, clar: -50, submit: -25, cost: 21e6, status: "cancelled", prob: 0, owner: U[3], stages: pkgs, decided: -18,
    revs: [R("draft", 0, 1, "Initial EOI pricing", null)] },
];

const SECTION_TEXT: Record<string, string> = {
  Technical: "Method statement covers phasing, traffic management, QA/QC plan and key interfaces with existing utilities. Drawings reviewed against RFP spec revision C.",
  Operations: "Execution plan assumes two parallel crews with a dedicated survey team. Equipment list and mobilisation plan attached.",
  HR: "Manpower histogram prepared; peak 140 staff in months 4–7. Camp and transport arrangements confirmed.",
  Procurement: "Long-lead items (pipe / cable / asphalt plant slots) quoted by two approved suppliers each; rates valid 90 days.",
  Finance: "Cash-flow assumes 10% advance, 60-day payment cycle, 5% retention. Bid bond and performance bond capacity confirmed.",
  HSE: "HSE plan aligned with client requirements; risk register and emergency response plan included.",
  Commercial: "Pricing summary, validity, payment terms and exclusions reviewed; clarifications log updated.",
};

const tenderIds: number[] = [];
const tenderRevs: Record<number, { id: number; rev_no: number; status: string; lines: number[]; specs: LineSpec[] }[]> = {};

TENDERS.forEach((t, idx) => {
  const code = `TND-2026-${String(idx + 1).padStart(3, "0")}`;
  const tid = ins("tenders", {
    code, title: t.title, client_id: t.client, kind: t.kind, category: t.category, location: t.location, scope_summary: t.scope,
    technical_spec: `Scope per RFP: ${t.scope}\nStandards: UAE / authority specifications; QA/QC per ISO 9001; HSE per ISO 45001.`,
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
    const specs: LineSpec[] = ri === 0 ? base : prev.map((l) => ({ ...l, margin_pct: Math.max(2, r1(l.margin_pct + rc.mDelta - (ri > 1 ? t.revs[ri - 1].mDelta : 0) + jit(-0.3, 0.3))), unit_cost: r0(l.unit_cost * (rc.cFactor / (ri > 1 ? t.revs[ri - 1].cFactor : 1))) }));
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
      ins("tender_reviews", { tender_id: tid, revision_id: tenderRevs[tid][0].id, department_id: DEPT[d], reviewer_id: deptUser[d],
        decision, comment: decision === "approved" ? "Reviewed and approved." : decision === "changes_requested" ? "Cash-flow assumptions need a 60-day payment cycle; please revisit contingency." : null,
        decided_at: decision === "pending" ? null : off(Math.min(t.submit - 3, -1)) + " 15:00:00" });
    });
    log("tender", tid, "review", "Sent for internal review", U[3], off(Math.min(t.submit - 5, -2)));
  }
  // negotiations
  if (["negotiation", "won"].includes(t.status) || (t.status === "lost" && idx === 4)) {
    const revs = tenderRevs[tid];
    const nCount = t.status === "negotiation" ? 3 : 1 + (idx % 2);
    for (let n = 0; n < nCount; n++) {
      const rev = revs[Math.min(n, revs.length - 1)];
      const price = q1<any>("SELECT total_price p FROM tender_revisions WHERE id=?", rev.id)!.p;
      ins("negotiations", { tender_id: tid, revision_id: rev.id, date: off((t.decided ?? -10) - 25 + n * 9), channel: ["meeting", "email", "call"][n % 3],
        summary: `Round ${n + 1}: commercial discussion on price, retention and programme.`, client_position: "Requests price reduction and shorter programme.", our_position: "Offered VE options; programme driven by permit durations.",
        client_target_price: r0(price * (0.94 + n * 0.012)), outcome: n === nCount - 1 ? "Converging" : "Open", next_step: n === nCount - 1 ? "Finalise BAFO" : "Submit revised pricing" });
    }
  }
  // status log
  if (t.submittedAt !== undefined) log("tender", tid, "status", "Submitted to client", t.owner, off(t.submittedAt));
  if (t.decided !== undefined) log("tender", tid, "status", `Marked ${t.status.replace("_", " ")}`, t.owner, off(t.decided));
});

// loss analyses
const LOSS = [
  { idx: 4, reason: "price", secondary: "programme, relationship", winner: "Emirates Roadworks Group", gap: 13.2, score: 82, fb: "Technically compliant; commercial offer 13% above the awarded bid.", root: "Overhead and contingency set too conservatively; earthworks subcontract quotes not re-tendered.", lessons: "Re-tender major subcontract packages before final price; use benchmarking on earthworks rates.", actions: "1. Build rate benchmark library (Procurement). 2. Add a pre-submission price-gap check (Commercial).", status: "closed" },
  { idx: 5, reason: "technical", secondary: "experience", winner: "Gulf Fibre Networks", gap: 4.5, score: 61, fb: "HDD methodology and risk mitigation scored below threshold.", root: "Methodology section written late; no HDD specialist reviewed it.", lessons: "Involve specialist subcontractors in methodology early; allow 5 days for technical review.", actions: "1. Engage HDD specialist on retainer. 2. Technical peer review gate.", status: "in_review" },
  { idx: 6, reason: "timeline", secondary: "scope", winner: "Capital Civil Works", gap: -2.0, score: 74, fb: "Our programme was 4 months longer than awardee.", root: "Conservative productivity assumptions and sequential phasing.", lessons: "Challenge programme with overlapping phases; confirm crew availability early.", actions: "1. Programme workshop template. 2. Maintain productivity database from live projects.", status: "open" },
];
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
interface SubCfg { name: string; trade: string; cats: string; status: string; rating: number | null; checklist: number; docs: [string, number | null, string][] }
// docs: [type, expiry offset (days) or null, status]
const SUBS: SubCfg[] = [
  { name: "Desert Rock Earthworks LLC", trade: "Earthworks & excavation", cats: "road,civil,pipeline", status: "approved", rating: 4.4, checklist: 6, docs: [["trade_license", 210, "verified"], ["insurance", 160, "verified"], ["tax_certificate", 600, "verified"], ["hse_certificate", 18, "verified"]] },
  { name: "Emirates Asphalt & Paving Co.", trade: "Asphalt & paving", cats: "road", status: "approved", rating: 4.2, checklist: 6, docs: [["trade_license", 300, "verified"], ["insurance", 22, "verified"], ["tax_certificate", 500, "verified"], ["iso", 420, "verified"]] },
  { name: "Gulf Trench & Cable Works", trade: "Trenching & cable laying", cats: "cable,telecom", status: "approved", rating: 2.6, checklist: 6, docs: [["trade_license", 120, "verified"], ["insurance", 75, "verified"], ["tax_certificate", 480, "verified"], ["hse_certificate", 9, "verified"]] },
  { name: "Falcon Telecom Infrastructure", trade: "Fibre laying & splicing", cats: "cable,telecom", status: "approved", rating: 4.0, checklist: 6, docs: [["trade_license", 340, "verified"], ["insurance", 250, "verified"], ["tax_certificate", 530, "verified"], ["iso", 380, "verified"]] },
  { name: "Al Wasl Pipeline Contractors", trade: "Pipe laying", cats: "pipeline,civil", status: "approved", rating: 4.1, checklist: 6, docs: [["trade_license", 190, "verified"], ["insurance", 140, "verified"], ["tax_certificate", 470, "verified"], ["hse_certificate", 260, "verified"]] },
  { name: "Sahara Civil & Shoring", trade: "Civil works & shoring", cats: "civil,pipeline", status: "approved", rating: 3.8, checklist: 6, docs: [["trade_license", 25, "verified"], ["insurance", 200, "verified"], ["tax_certificate", 450, "verified"], ["bank_letter", null, "verified"]] },
  { name: "Blue Horizon Survey & Testing", trade: "Survey & materials testing", cats: "road,cable,pipeline,civil", status: "approved", rating: 4.5, checklist: 6, docs: [["trade_license", 400, "verified"], ["insurance", 310, "verified"], ["iso", 500, "verified"], ["company_profile", null, "verified"]] },
  { name: "Nexus Traffic & Safety Solutions", trade: "Traffic management & signage", cats: "road", status: "onboarding", rating: null, checklist: 3, docs: [["trade_license", 280, "verified"], ["insurance", 130, "pending"], ["hse_certificate", null, "pending"]] },
  { name: "Pinnacle Directional Drilling", trade: "HDD & thrust boring", cats: "cable,pipeline", status: "prospect", rating: null, checklist: 1, docs: [["trade_license", 330, "pending"], ["company_profile", null, "pending"]] },
  { name: "Marina Landscaping & Finishing", trade: "Landscaping & finishing", cats: "civil", status: "suspended", rating: 2.9, checklist: 6, docs: [["trade_license", -35, "expired"], ["insurance", -12, "expired"], ["tax_certificate", 200, "verified"]] },
];
const SUB: number[] = [0];
SUBS.forEach((s, i) => {
  const id = ins("subcontractors", { code: `SUB-${String(i + 1).padStart(3, "0")}`, name: s.name, trade: s.trade, categories: s.cats, contact_person: ["Mohammed Faisal", "Ahmed Younis", "Bilal Siddiqui", "Karim Haddad", "Rashid Al Zaabi", "Vikram Nair", "Ali Reza", "Omar Said", "Sandeep Kumar", "Hassan Jaber"][i],
    email: `info@${s.name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14)}-demo.ae`, phone: `+971 5${i} ${100 + i * 7} ${2000 + i * 111}`, address: ["Al Quoz", "Jebel Ali", "Ras Al Khor", "Sharjah Industrial", "Al Qusais", "Dubai Investment Park", "Al Quoz", "Mussafah", "Ajman", "Dubai Marina"][i] + ", UAE",
    trade_license_no: `CN-${1000000 + i * 8731}`, trade_license_expiry: off(s.docs.find((d) => d[0] === "trade_license")?.[1] ?? 300), tax_no: `1000${i}2345600003`, bank_name: ["Emirates NBD", "ADCB", "Mashreq", "FAB"][i % 4], iban: `AE07 0331 2345 6789 0123 ${400 + i}`,
    status: s.status, rating: s.rating, notes: i === 2 ? "Performance concerns on current assignments (crew shortage, equipment breakdowns)." : null, created_at: off(-420 + i * 15) + " 09:00:00" });
  SUB.push(id);
  DEFAULT_ONBOARDING_ITEMS.forEach((item, k) => {
    const done = k < s.checklist;
    ins("onboarding_checklist", { subcontractor_id: id, item, done: done ? 1 : 0, done_by: done ? U[8] : null, done_at: done ? off(-400 + i * 15 + k * 3) + " 12:00:00" : null });
  });
  s.docs.forEach(([type, exp, status], di) => {
    let att: number | null = null;
    if (status === "verified" && di < 2) att = saveSeedFile("subcontractor", id, type, `${type}-${id}.txt`, `Demo ${type.replace(/_/g, " ")} for ${s.name}\n(placeholder document)`, U[8], off(-380));
    ins("subcontractor_documents", { subcontractor_id: id, doc_type: type, ref_no: `${type.slice(0, 3).toUpperCase()}-${5000 + id * 13 + di}`, issue_date: exp !== null ? off(exp - 365) : off(-200), expiry_date: exp !== null ? off(exp) : null, attachment_id: att, status });
  });
  log("subcontractor", id, "create", `Subcontractor ${s.name} registered (${s.status})`, U[8], off(-420 + i * 15));
});
const [, SC_DESERT, SC_ASPHALT, SC_GULF, SC_FALCON, SC_WASL, SC_SAHARA, SC_BLUE] = SUB;

/* ---------------------------------------------------------------- projects, stages, budget */
interface PCfg {
  code: string; name: string; tenderIdx: number | null; client: number; parent: number | null; category: string; region: string; location: string; start: number; end: number; status: string; manager: number;
  qty: number; unit: string; geometry: any; stages: StagePlan[]; desc: string; budget?: number; contract?: number; cpi: number;
}
const projectIds: number[] = [];
const stageIds: Record<number, number[]> = {};
const stageInfo: Record<number, { id: number; plan: StagePlan; budget: number; pstart: string; pend: string }[]> = {};

function createProject(c: PCfg): number {
  const tid = c.tenderIdx !== null ? tenderIds[c.tenderIdx] : null;
  let budget = c.budget ?? 0, contract = c.contract ?? 0;
  let lineRows: { spec: LineSpec; srcId: number }[] = [];
  if (tid) {
    const fr = tenderRevs[tid].find((r) => r.status === "final")!;
    const t = q1<any>("SELECT total_cost c, total_price p FROM tender_revisions WHERE id=?", fr.id)!;
    budget = r0(t.c); contract = r0(t.p);
    lineRows = fr.specs.map((spec, i) => ({ spec, srcId: fr.lines[i] }));
  }
  const pid = ins("projects", {
    code: c.code, name: c.name, tender_id: tid, client_id: c.client, parent_id: c.parent, category: c.category, region: c.region, location: c.location, contract_value: contract, budget_cost: budget,
    start_date: off(c.start), end_date: off(c.end), status: c.status, manager_id: c.manager, total_quantity: c.qty, quantity_unit: c.unit, geometry: JSON.stringify(c.geometry), description: c.desc,
    created_at: off(c.start - 14) + " 09:00:00",
  });
  projectIds.push(pid);
  if (tid) db.prepare("UPDATE tenders SET project_id = ? WHERE id = ?").run(pid, tid);
  // stages
  const dur = c.end - c.start, n = c.stages.length, win = dur / n;
  stageIds[pid] = []; stageInfo[pid] = [];
  const stageBudgets = new Map<string, number>();
  for (const l of lineRows) stageBudgets.set(l.spec.wbs_stage, (stageBudgets.get(l.spec.wbs_stage) ?? 0) + l.spec.quantity * l.spec.unit_cost);
  const eq = (budget * 0.9) / n;
  c.stages.forEach((s, i) => {
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
  log("project", pid, "create", `Project ${c.code} created${tid ? " from tender " + q1<any>("SELECT code FROM tenders WHERE id=?", tid)!.code : ""}`, c.manager, off(c.start - 14));
  return pid;
}

const P1 = createProject({ code: "PRJ-2026-001", name: "Emirates Road (E611) Widening", tenderIdx: 0, client: CL.rta, parent: null, category: "road", region: "Dubai", location: "Emirates Road, Dubai", start: -240, end: 120, status: "active", manager: U[2], qty: P1_KM, unit: "km",
  geometry: fc([feat({ type: "LineString", coordinates: P1_LINE }, { kind: "project" })]), stages: P1_STAGES, desc: "Widening of Emirates Road from 2 to 4 lanes per direction. On track and on budget.", cpi: 1.03 });
const P2 = createProject({ code: "PRJ-2026-002", name: "Dubai–Sharjah Fibre Backbone (E311)", tenderIdx: 1, client: CL.tel, parent: null, category: "cable", region: "Dubai–Sharjah", location: "Sheikh Mohammed Bin Zayed Road", start: -300, end: 60, status: "active", manager: U[7], qty: P2_KM, unit: "km",
  geometry: fc([feat({ type: "LineString", coordinates: P2_LINE }, { kind: "project" })]), stages: P2_STAGES, desc: "42 km duct & fibre backbone. Behind schedule and over budget — trenching subcontractor underperforming.", cpi: 0.74 });
const P3 = createProject({ code: "PRJ-2026-003", name: "Al Ain Road Trunk Water Pipeline", tenderIdx: 2, client: CL.wea, parent: null, category: "pipeline", region: "Dubai–Al Ain", location: "Dubai–Al Ain Road (E66)", start: -180, end: 90, status: "active", manager: U[2], qty: P3_KM, unit: "km",
  geometry: fc([feat({ type: "LineString", coordinates: P3_LINE }, { kind: "project" })]), stages: P3_STAGES, desc: "12 km DI 600mm trunk main. Delays driven by authority NOCs and client design changes, not by the contractor.", cpi: 0.97 });
const P4 = createProject({ code: "PRJ-2026-004", name: "Dubai South Utilities & Civil Enabling Works", tenderIdx: 3, client: CL.dev, parent: null, category: "civil", region: "Dubai South", location: "Dubai South", start: -75, end: 270, status: "active", manager: U[7], qty: P4_AREA, unit: "sqm",
  geometry: fc([feat({ type: "Polygon", coordinates: P4_POLY }, { kind: "project" })]), stages: P4_STAGES, desc: "180 ha enabling works in four zones. Slightly behind plan due to late design approval.", cpi: 0.94 });
const P2A = createProject({ code: "PRJ-2026-005", name: "Fibre Link A – Jebel Ali Handholes & Spurs", tenderIdx: null, client: CL.tel, parent: P2, category: "cable", region: "Dubai", location: "Jebel Ali section", start: -150, end: 90, status: "active", manager: U[7], qty: r1(lineKm(P2A_LINE)), unit: "km",
  geometry: fc([feat({ type: "LineString", coordinates: P2A_LINE }, { kind: "project" })]), stages: P2A_STAGES, desc: "Sub-project of PRJ-2026-002: spur links and handholes, southern sector.", budget: 6.2e6, contract: 7.0e6, cpi: 1.0 });
const P2B = createProject({ code: "PRJ-2026-006", name: "Fibre Link B – Sharjah Interconnect", tenderIdx: null, client: CL.tel, parent: P2, category: "cable", region: "Sharjah", location: "Sharjah section", start: 10, end: 170, status: "mobilizing", manager: U[7], qty: r1(lineKm(P2B_LINE)), unit: "km",
  geometry: fc([feat({ type: "LineString", coordinates: P2B_LINE }, { kind: "project" })]), stages: P2B_STAGES, desc: "Sub-project of PRJ-2026-002: northern sector interconnect to Sharjah exchange.", budget: 5.1e6, contract: 5.8e6, cpi: 1.0 });
console.log("Projects", projectIds.join(","));

/* ---------------------------------------------------------------- assignments + progress simulation */
interface Stall { from: number; to: number; resp: string; cause: string }
interface AsgCfg {
  project: number; stageIdx: number; sub: number; kind: "primary" | "secondary" | "draft"; a0?: number; a1?: number; pct?: number; stalls?: Stall[];
  cvFactor?: number; portal?: boolean; retention?: number; advance?: number; days?: number; scope: string; overclaim?: number; pendingLast?: number; crew?: number; status?: string;
  stageStatus?: string; rejectInvoice?: boolean; lumpsum?: boolean; ccType?: string[];
}
const MAT_PLAN: Record<string, [string, string, number, number][]> = {
  road: [["Asphalt wearing course", "ton", 310, 0.55], ["Aggregate base course", "m3", 95, 0.45]],
  cable: [["HDPE duct 40mm", "m", 11, 0.5], ["Fibre optic cable 96F", "m", 14, 0.5]],
  pipeline: [["DI pipe 600mm", "m", 1450, 0.8], ["Valves & fittings", "nos", 5200, 0.2]],
  civil: [["Ready-mix concrete C40", "m3", 640, 0.6], ["Rebar B500", "ton", 3100, 0.4]],
};
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
  const code = `SC-${String(++asgCounter).padStart(3, "0")}`;
  const cvFactor = cfg.cvFactor ?? (cfg.kind === "primary" ? 0.62 * jit(0.96, 1.04) : cfg.kind === "secondary" ? 0.08 : 0.6);
  const cv = r0(st.budget * cvFactor);
  const active = cfg.kind !== "draft";
  const complete = active && cfg.pct === 100 && (cfg.a1 ?? 0) < -1;
  const status = cfg.status ?? (cfg.kind === "draft" ? "draft" : complete ? "completed" : "active");
  const qty = cfg.lumpsum || cfg.kind === "secondary" ? null : st.plan.qty;
  const asgId = ins("assignments", {
    code, project_id: pid, stage_id: st.id, subcontractor_id: cfg.sub, scope: cfg.scope, contract_value: cv, quantity: qty, quantity_unit: qty ? st.plan.unit : "lumpsum", unit_rate: qty ? r2(cv / qty) : null,
    start_date: st.pstart, end_date: st.pend, payment_terms: `Monthly certified invoices, ${cfg.advance ?? 10}% advance recovered pro-rata, ${cfg.retention ?? 5}% retention, payment within ${cfg.days ?? 30} days of certification.`,
    advance_pct: cfg.advance ?? 10, retention_pct: cfg.retention ?? 5, payment_days: cfg.days ?? 30, status, portal_token: active ? nanoid(24) : null, portal_enabled: active && cfg.portal !== false && status === "active" ? 1 : 0,
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
        ins("progress_materials", { progress_report_id: rep, material: name, unit, quantity, unit_cost: r0(uc * jit(0.97, 1.05)) });
      }
      syncProgressMaterialCosts(rep);
    }
  });
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
    const ret = r0(certified * ((cfg.retention ?? 5) / 100)), adv = r0(certified * ((cfg.advance ?? 10) / 100));
    const net = certified - ret - adv;
    const invId = ins("sub_invoices", {
      assignment_id: asgId, project_id: pid, invoice_no: `${code}-INV-${String(k + 1).padStart(2, "0")}`, invoice_date: off(cut), period_from: off(cut - 30), period_to: off(cut - 1), claimed_amount: claimed, claimed_percent: r1(dPct),
      certified_amount: certified, retention_amount: ret, advance_recovery: adv, net_payable: net, status: statusI, paid_amount: statusI === "paid" ? net : 0, paid_date: statusI === "paid" ? off(cut + (cfg.days ?? 30)) : null,
      source: status === "active" && cfg.portal !== false && k % 2 === 0 ? "portal" : "internal", notes: statusI === "rejected" ? "Rejected: claimed quantities exceed verified progress." : cfg.overclaim && cfg.overclaim > 1.1 ? "Claim exceeds verified progress; certified at measured quantities." : null,
      created_at: off(cut) + " 12:00:00",
    });
    if (k === 0) saveSeedFile("invoice", invId, "Invoice", `${code}-INV-01.txt`, `Demo invoice ${code}-INV-01\nAmount: ${claimed}`, U[5], off(cut));
    syncInvoiceCost(invId);
  });

  // ---- certificates
  const mkCert = (type: string, st2: string, pctC: number, date: number, src = "internal", remarks = "") => {
    certCounter++;
    ins("completion_certificates", { assignment_id: asgId, project_id: pid, stage_id: st.id, cert_type: type, cert_no: `CC-${String(certCounter).padStart(3, "0")}`, cert_date: off(date), percent: pctC, quantity: qty ? r2(qty * pctC / 100) : null,
      remarks: remarks || `${type} completion for ${cfg.scope}`, status: st2, issued_by: st2 === "issued" ? managerId : null, source: src, created_at: off(date) + " 10:00:00" });
  };
  if (complete) { mkCert("substantial", "issued", 100, a1 + 3); mkCert("final", "issued", 100, a1 + 20, "internal", "Final acceptance, snag list closed."); }
  else if (pct >= 50) mkCert("partial", "issued", 50, Math.round((a0 + a1) / 2) + 10);
  if (!complete && pct >= 25 && status === "active") mkCert("partial", "requested", Math.round(pct * 0.9 / 5) * 5, -3, "portal", "Subcontractor requests partial completion certificate.");
  if (cfg.ccType?.includes("rejected")) mkCert("partial", "rejected", 80, -20, "portal", "Rejected: snag items outstanding.");
  if (cfg.ccType?.includes("draft")) mkCert("taking_over", "draft", 100, 5);
}

const R2 = (from: number, to: number, resp: string, cause: string): Stall => ({ from, to, resp, cause });

// ---- P1 (on track)
const P1A: AsgCfg[] = [
  { project: P1, stageIdx: 0, sub: SC_DESERT, kind: "primary", a0: -238, a1: -170, pct: 100, scope: "Earthworks, sub-grade preparation and widening", portal: true },
  { project: P1, stageIdx: 1, sub: SC_DESERT, kind: "primary", a0: -188, a1: -118, pct: 100, scope: "Earthworks, sub-grade preparation and widening", stalls: [R2(-150, -144, "weather", "Sandstorm – works suspended")] },
  { project: P1, stageIdx: 2, sub: SC_ASPHALT, kind: "primary", a0: -132, a1: -60, pct: 100, scope: "Base course and asphalt paving", stalls: [R2(-100, -95, "company", "Late approval of asphalt mix design")] },
  { project: P1, stageIdx: 3, sub: SC_ASPHALT, kind: "primary", a0: -74, a1: -8, pct: 100, scope: "Base course and asphalt paving", ccType: ["draft"] },
  { project: P1, stageIdx: 4, sub: SC_ASPHALT, kind: "primary", a0: -18, a1: 0, pct: 31, scope: "Base course and asphalt paving", pendingLast: 1, retention: 7.5 },
  { project: P1, stageIdx: 4, sub: SC_BLUE, kind: "secondary", a0: -16, a1: 0, pct: 30, scope: "Survey, density testing and QA/QC", lumpsum: true, retention: 0, advance: 0 },
  { project: P1, stageIdx: 5, sub: SC_DESERT, kind: "draft", scope: "Earthworks, sub-grade preparation and widening" },
];
P1A.forEach(createAssignment);
// ---- P2 (over budget & late – failing subcontractor)
const P2A_: AsgCfg[] = [
  { project: P2, stageIdx: 0, sub: SC_FALCON, kind: "primary", a0: -295, a1: -215, pct: 100, scope: "Trenching, duct laying, fibre pulling and splicing" },
  { project: P2, stageIdx: 0, sub: SC_BLUE, kind: "secondary", a0: -240, a1: -215, pct: 100, scope: "OTDR testing and as-builts", lumpsum: true, retention: 0, advance: 0 },
  { project: P2, stageIdx: 1, sub: SC_GULF, kind: "primary", a0: -232, a1: 0, pct: 86, cvFactor: 0.66, scope: "Trenching, duct laying and reinstatement", overclaim: 1.3, rejectInvoice: true, pendingLast: 2, crew: 22,
    stalls: [R2(-190, -170, "subcontractor", "Only 1 of 3 trenching crews mobilised – crew shortage"), R2(-140, -115, "subcontractor", "Trencher breakdown; replacement unit delayed"), R2(-100, -94, "utility_clash", "Unmarked live utility struck at CH 12+400"), R2(-31, -29, "weather", "Heavy rain – trench flooding")] },
  { project: P2, stageIdx: 2, sub: SC_GULF, kind: "primary", a0: -160, a1: 0, pct: 64, cvFactor: 0.66, scope: "Trenching, duct laying and reinstatement", overclaim: 1.25, crew: 20, ccType: ["rejected"],
    stalls: [R2(-120, -98, "subcontractor", "Crew redeployed to another client site"), R2(-60, -40, "subcontractor", "Ducts not ordered on time – material shortage")] },
  { project: P2, stageIdx: 3, sub: SC_GULF, kind: "primary", a0: -95, a1: 0, pct: 30, cvFactor: 0.66, scope: "Trenching, duct laying and reinstatement", overclaim: 1.2, crew: 18,
    stalls: [R2(-70, -45, "subcontractor", "Insufficient supervision; rework of 1.2 km of failed reinstatement")] },
  { project: P2, stageIdx: 4, sub: SC_FALCON, kind: "draft", scope: "Trenching, duct laying, fibre pulling and splicing" },
];
P2A_.forEach(createAssignment);
// ---- P3 (delayed by client / authority)
const P3A: AsgCfg[] = [
  { project: P3, stageIdx: 0, sub: SC_WASL, kind: "primary", a0: -178, a1: -80, pct: 100, scope: "Pipe laying, jointing and backfill",
    stalls: [R2(-150, -125, "authority", "NOC for road crossing pending from Road Authority"), R2(-110, -95, "client", "Late site handover of sector 1")] },
  { project: P3, stageIdx: 1, sub: SC_WASL, kind: "primary", a0: -120, a1: 0, pct: 60, scope: "Pipe laying, jointing and backfill", pendingLast: 1,
    stalls: [R2(-95, -60, "authority", "Road Authority NOC for crossing C2 not issued"), R2(-50, -32, "client", "Client design change at valve chamber VC-3"), R2(-20, -14, "utility_clash", "Existing telecom duct bank clash at CH 5+100")] },
  { project: P3, stageIdx: 1, sub: SC_SAHARA, kind: "secondary", a0: -90, a1: 0, pct: 55, scope: "Thrust boring and shoring for road crossings", lumpsum: true, advance: 15 },
  { project: P3, stageIdx: 2, sub: SC_WASL, kind: "primary", a0: -40, a1: 0, pct: 9, scope: "Pipe laying, jointing and backfill", stalls: [R2(-30, -14, "authority", "Permit for night works not yet issued")] },
  { project: P3, stageIdx: 3, sub: SC_WASL, kind: "draft", scope: "Pipe laying, jointing and backfill" },
];
P3A.forEach(createAssignment);
// ---- P4 (slightly behind)
const P4A: AsgCfg[] = [
  { project: P4, stageIdx: 0, sub: SC_SAHARA, kind: "primary", a0: -70, a1: 0, pct: 85, scope: "Utility corridor excavation, ducting and backfill", pendingLast: 2, stalls: [R2(-45, -38, "client", "Awaiting client approval of revised utility layout")] },
  { project: P4, stageIdx: 0, sub: SC_BLUE, kind: "secondary", a0: -60, a1: 0, pct: 70, scope: "Survey and materials testing", lumpsum: true, retention: 0, advance: 0 },
  { project: P4, stageIdx: 1, sub: SC_DESERT, kind: "draft", scope: "Earthworks and grading for logistics yard" },
];
P4A.forEach(createAssignment);
// ---- Sub-project A
const PAA: AsgCfg[] = [
  { project: P2A, stageIdx: 0, sub: SC_FALCON, kind: "primary", a0: -145, a1: -60, pct: 100, scope: "Spur ducts and handholes" },
  { project: P2A, stageIdx: 1, sub: SC_FALCON, kind: "primary", a0: -66, a1: 0, pct: 45, scope: "Spur ducts and handholes" },
];
PAA.forEach(createAssignment);
console.log(`Seeded ${asgIds.length} assignments`);

/* ---------------------------------------------------------------- manual costs (calibrated to the story CPIs) */
const CPI_TARGET: Record<number, number> = { [P1]: 1.03, [P2]: 0.74, [P3]: 0.97, [P4]: 0.94, [P2A]: 1.0, [P2B]: 1.0 };
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
interface IssueCfg { p: number; stage: number | null; asg: string | null; title: string; desc: string; resp: string; days: number; cost: number; status: string; raised: number; resolved?: number }
const asgByCode = (c: string) => asgIds.find((a) => a.code === c)?.id ?? null;
const ISSUES: IssueCfg[] = [
  { p: P1, stage: 2, asg: null, title: "Asphalt mix design approval delay", desc: "Authority took 6 days to approve the revised mix design.", resp: "company", days: 3, cost: 18000, status: "closed", raised: -102, resolved: -95 },
  { p: P1, stage: 4, asg: null, title: "Street-light cable clash at CH 14+200", desc: "Existing lighting cable not on as-built drawings; diversion agreed with client.", resp: "authority", days: 0, cost: 42000, status: "mitigating", raised: -9 },
  { p: P1, stage: 1, asg: null, title: "Sandstorm shutdown", desc: "Two days of lost production.", resp: "weather", days: 2, cost: 0, status: "closed", raised: -150, resolved: -144 },
  { p: P2, stage: 1, asg: "SC-009", title: "Trenching crew shortage – Gulf Trench", desc: "Subcontractor mobilised 1 of 3 crews. Formal notice issued.", resp: "subcontractor", days: 21, cost: 95000, status: "mitigating", raised: -190 },
  { p: P2, stage: 2, asg: "SC-010", title: "Ducts not ordered – material shortage", desc: "Subcontractor failed to place duct order; company supplied emergency stock.", resp: "subcontractor", days: 20, cost: 160000, status: "open", raised: -60 },
  { p: P2, stage: 3, asg: "SC-011", title: "Failed reinstatement – 1.2 km rework", desc: "Authority rejected reinstatement quality; rework at subcontractor cost, back-charge raised.", resp: "subcontractor", days: 12, cost: 210000, status: "open", raised: -70 },
  { p: P2, stage: 1, asg: null, title: "Unmarked utility strike at CH 12+400", desc: "Live water main hit; 6 days to repair and reinstate.", resp: "utility_clash", days: 6, cost: 55000, status: "closed", raised: -100, resolved: -93 },
  { p: P3, stage: 0, asg: null, title: "Road crossing NOC – Road Authority", desc: "NOC for crossings C1–C3 submitted 3 months ago; approval pending.", resp: "authority", days: 38, cost: 120000, status: "mitigating", raised: -150 },
  { p: P3, stage: 1, asg: null, title: "Design change at valve chamber VC-3", desc: "Client issued revised chamber drawings after excavation started.", resp: "client", days: 18, cost: 75000, status: "open", raised: -50 },
  { p: P3, stage: 2, asg: null, title: "Night works permit not issued", desc: "Permit required for work near the highway interchange.", resp: "authority", days: 10, cost: 30000, status: "open", raised: -30 },
  { p: P4, stage: 0, asg: null, title: "Utility layout re-approval", desc: "Client requested a revised utility corridor alignment.", resp: "client", days: 5, cost: 25000, status: "closed", raised: -46, resolved: -38 },
  { p: P4, stage: 1, asg: null, title: "Logistics yard drainage design pending", desc: "Awaiting client drainage design for Zone B.", resp: "client", days: 0, cost: 0, status: "open", raised: -8 },
];
// resolve assignment codes by looking up the Gulf assignments in creation order
const gulf = asgIds.filter((a) => a.sub === SC_GULF).map((a) => a.id);
ISSUES.forEach((i) => {
  const asg = i.asg === "SC-009" ? gulf[0] : i.asg === "SC-010" ? gulf[1] : i.asg === "SC-011" ? gulf[2] : i.asg ? asgByCode(i.asg) : null;
  const iid = ins("issues", { project_id: i.p, stage_id: i.stage !== null ? stageIds[i.p][i.stage] : null, assignment_id: asg, title: i.title, description: i.desc, responsibility: i.resp, impact_days: i.days, impact_cost: i.cost, status: i.status, raised_on: off(i.raised), resolved_on: i.resolved !== undefined ? off(i.resolved) : null });
  void iid;
});

/* ---------------------------------------------------------------- project documents */
projectIds.slice(0, 4).forEach((pid, i) => {
  saveSeedFile("project", pid, "Contract", `Contract-summary-${i + 1}.txt`, `Demo contract summary for project ${pid}\nContract value and key dates are held in the system.`, U[2], off(-250));
  saveSeedFile("project", pid, "Reports", `Monthly-report-${i + 1}.txt`, `Demo monthly progress report for project ${pid}.`, U[2], off(-30));
});
tenderIds.forEach((tid, i) => {
  if (i < 9) saveSeedFile("tender", tid, "RFP", `RFP-${TENDERS[i].category}-${i + 1}.txt`, `Demo RFP summary: ${TENDERS[i].title}\nScope: ${TENDERS[i].scope}`, U[3], off(TENDERS[i].issue + 1));
});

/* ---------------------------------------------------------------- approval workflows + demo requests (AUTH_SPEC sections D/E) */
installDefaultWorkflows(db, U[1]);
seedApprovalDemo(db, { sara: U[4], daniel: U[7], imran: U[5], mariam: U[12], rahul: U[3], layla: U[2], omar: U[1], hamdan: U[11] });

/* ---------------------------------------------------------------- summary */
const count = (t: string) => (q1<any>(`SELECT COUNT(*) c FROM ${t}`)!).c;
console.log("\nSeed summary:");
for (const t of ["departments", "users", "clients", "tenders", "tender_sections", "tender_revisions", "budget_lines", "margin_changes", "tender_reviews", "negotiations", "loss_analyses", "projects", "stages", "project_budget_lines",
  "subcontractors", "subcontractor_documents", "onboarding_checklist", "assignments", "progress_reports", "progress_materials", "progress_manpower", "sub_invoices", "completion_certificates", "project_costs", "issues", "attachments", "activity_log", "approval_workflows", "approval_levels", "approval_requests", "approval_tasks", "approval_delegations", "approval_events", "project_cost_requests"])
  console.log(`  ${t.padEnd(26)} ${count(t)}`);
console.log("\nApproval requests by status:");
for (const r of q<any>("SELECT status, COUNT(*) c FROM approval_requests GROUP BY status")) console.log(`  ${String(r.status).padEnd(10)} ${r.c}`);
console.log(`  overdue pending tasks: ${q1<any>("SELECT COUNT(*) c FROM approval_tasks t JOIN approval_requests r ON r.id=t.request_id WHERE t.status='pending' AND r.status='pending' AND t.due_at < ?", new Date().toISOString())!.c}`);
console.log("\nProject health:");
for (const pid of projectIds) {
  const p = q1<any>("SELECT code, name FROM projects WHERE id=?", pid)!;
  const m = getProjectMetrics(pid);
  console.log(`  ${p.code} actual ${m.actualPct.toFixed(1)}% planned ${m.plannedPct.toFixed(1)}% SPI ${m.spi?.toFixed(2) ?? "-"} CPI ${m.cpi?.toFixed(2) ?? "-"} RAG ${m.rag} delay ${m.delayDays}d  BAC ${r0(m.bac / 1e6)}M AC ${r0(m.ac / 1e6)}M  ${p.name}`);
}
console.log("\nSubcontractor portal links (active assignments):");
for (const a of q<any>("SELECT a.code, a.portal_token t, s.name sn, p.code pc FROM assignments a JOIN subcontractors s ON s.id=a.subcontractor_id JOIN projects p ON p.id=a.project_id WHERE a.portal_enabled=1 ORDER BY a.id"))
  console.log(`  ${a.code} ${a.pc} ${a.sn}: http://localhost:3100/portal/${a.t}`);
console.log("\nDemo logins (local demo only):");
for (const u of q<any>("SELECT u.email, r.name role FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id"))
  console.log(`  ${String(u.email).padEnd(30)} ${u.email === DEMO_ADMIN_EMAIL ? DEMO_ADMIN_PASSWORD : DEMO_USER_PASSWORD}   (${u.role})`);
console.log("\nDone.");
