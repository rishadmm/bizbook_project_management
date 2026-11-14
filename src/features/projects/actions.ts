"use server";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { getDb, getSetting } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { getCurrentUser } from "@/lib/session";
import { saveUploadsFromForm } from "@/lib/files";
import { todayISO } from "@/lib/format";
import { syncInvoiceCost, syncProgressMaterialCosts } from "@/lib/metrics";
import { ENUMS } from "@/lib/status";
import type { Assignment, Project, Stage, SubInvoice } from "@/lib/types";
import { firstLine, lineLengthKm, measureGeometry, sliceLine } from "./geo";
import { requireAnyPermission, requirePermission } from "@/lib/auth";
import { hasOpenRequest, submitForApproval, withdrawOpenRequest } from "@/lib/approvals/engine";
import { DEFAULT_VAT_RATE, deductions, fromGross, fromSubtotal } from "@/features/invoices/calc";
import { applyCertificationToLines, dueDate, getAssignmentBoq, getAssignmentFacts, insertInvoiceLines, lumpLine, parseInvoiceLines, previousCertified } from "@/features/invoices/lines";
import { guard, type ActionResult } from "@/lib/action-result";
import { readInvoiceUploads, saveInvoiceUploads } from "@/features/invoices/attachments";

/* ---------------------------------------------------------------- helpers */

const str = (f: FormData, k: string): string => String(f.get(k) ?? "").trim();
const strOrNull = (f: FormData, k: string): string | null => str(f, k) || null;
const numOrNull = (f: FormData, k: string): number | null => {
  const v = str(f, k);
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${k}`);
  return n;
};
const num = (f: FormData, k: string, d = 0): number => numOrNull(f, k) ?? d;
const idOrNull = (f: FormData, k: string): number | null => { const n = Number(f.get(k)); return Number.isFinite(n) && n > 0 ? n : null; };
const dateOrNull = (f: FormData, k: string): string | null => {
  const v = str(f, k);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Invalid date for ${k}`);
  return v;
};
const oneOf = (kind: keyof typeof ENUMS, v: string, label: string): string => {
  if (!(v in ENUMS[kind])) throw new Error(`Invalid ${label}`);
  return v;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const lines = (f: FormData, k: string): string[] => f.getAll(k).map((v) => String(v ?? "").trim());

function project(id: number): Project {
  const p = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
  if (!p) throw new Error("Project not found");
  return p;
}
function refresh(projectId: number, tab?: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/invoices");
  revalidatePath("/");
  if (tab) revalidatePath(`/projects/${projectId}?tab=${tab}`);
}

/* ---------------------------------------------------------------- project */

export async function updateProjectStatus(form: FormData): Promise<void> {
  await requirePermission("projects", "edit");
  const id = Number(form.get("id"));
  const status = oneOf("projectStatus", str(form, "status"), "status");
  const p = project(id);
  getDb().prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, id);
  await logActivity("project", id, "status", `Status changed ${p.status} → ${status}`);
  refresh(id);
}

export async function createSubProject(form: FormData): Promise<void> {
  await requirePermission("projects", "create");
  const parentId = Number(form.get("parent_id"));
  const parent = project(parentId);
  const name = str(form, "name");
  if (!name) throw new Error("Name is required");
  const db = getDb();
  const from = numOrNull(form, "chainage_from"), to = numOrNull(form, "chainage_to");
  let geometry: string | null = null;
  let qty = numOrNull(form, "total_quantity");
  let unit = parent.quantity_unit;
  if (from !== null && to !== null) {
    const line = firstLine(parent.geometry);
    if (!line) throw new Error("Parent project has no route to cut a sub-project from");
    const total = lineLengthKm(line);
    if (!(to > from) || from < 0 || from >= total) throw new Error(`Chainage range must lie within 0–${total.toFixed(2)} km`);
    const seg = sliceLine(line, [from, Math.min(to, total)])[0];
    if (seg) {
      geometry = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { kind: "project" }, geometry: seg.feature.geometry }] });
      if (qty === null) { qty = r2(seg.to - seg.from); unit = "km"; }
    }
  }
  const year = new Date().getFullYear();
  const maxN = (db.prepare("SELECT code FROM projects WHERE code LIKE ?").all(`PRJ-${year}-%`) as { code: string }[])
    .reduce((m, r) => Math.max(m, Number(r.code.split("-").pop()) || 0), 0);
  const code = `PRJ-${year}-${String(maxN + 1).padStart(3, "0")}`;
  const id = Number(db.prepare(
    `INSERT INTO projects(code, name, tender_id, client_id, parent_id, category, region, location, contract_value, budget_cost, start_date, end_date, status, manager_id, total_quantity, quantity_unit, geometry, description)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    code, name, null, parent.client_id, parentId, parent.category, strOrNull(form, "region") ?? parent.region, strOrNull(form, "location") ?? parent.location,
    num(form, "contract_value"), num(form, "budget_cost"), dateOrNull(form, "start_date") ?? parent.start_date, dateOrNull(form, "end_date") ?? parent.end_date,
    "planning", idOrNull(form, "manager_id") ?? parent.manager_id, qty, unit, geometry, strOrNull(form, "description")).lastInsertRowid);
  await logActivity("project", id, "created", `Sub-project ${code} created under ${parent.code}`);
  await logActivity("project", parentId, "sub_project", `Sub-project ${code} – ${name} added`);
  refresh(parentId);
}

/* ---------------------------------------------------------------- stages */

export async function saveStage(form: FormData): Promise<void> {
  await requirePermission("projects", "edit");
  const projectId = Number(form.get("project_id"));
  project(projectId);
  const id = Number(form.get("id")) || 0;
  const name = str(form, "name");
  if (!name) throw new Error("Stage name is required");
  const status = oneOf("stageStatus", str(form, "status") || "not_started", "status");
  const db = getDb();
  const vals = [
    strOrNull(form, "code"), name, strOrNull(form, "description"), num(form, "planned_quantity"), strOrNull(form, "quantity_unit"),
    numOrNull(form, "chainage_from"), numOrNull(form, "chainage_to"), dateOrNull(form, "planned_start"), dateOrNull(form, "planned_end"),
    dateOrNull(form, "actual_start"), dateOrNull(form, "actual_end"), num(form, "budget_amount"), status, numOrNull(form, "weight_pct"),
  ];
  const ps = vals[7] as string | null, pe = vals[8] as string | null;
  if (ps && pe && pe < ps) throw new Error("Planned end is before planned start");
  if (id) {
    db.prepare(`UPDATE stages SET code=?, name=?, description=?, planned_quantity=?, quantity_unit=?, chainage_from=?, chainage_to=?, planned_start=?, planned_end=?, actual_start=?, actual_end=?, budget_amount=?, status=?, weight_pct=? WHERE id=? AND project_id=?`)
      .run(...vals, id, projectId);
    await logActivity("stage", id, "updated", `Stage ${vals[0] ?? ""} ${name} updated`);
  } else {
    const sort = (db.prepare("SELECT COALESCE(MAX(sort),-1)+1 s FROM stages WHERE project_id = ?").get(projectId) as { s: number }).s;
    const rid = Number(db.prepare(`INSERT INTO stages(code, name, description, planned_quantity, quantity_unit, chainage_from, chainage_to, planned_start, planned_end, actual_start, actual_end, budget_amount, status, weight_pct, project_id, sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals, projectId, sort).lastInsertRowid);
    await logActivity("stage", rid, "created", `Stage ${vals[0] ?? ""} ${name} created`);
  }
  await logActivity("project", projectId, "stage", `Stage "${name}" ${id ? "updated" : "added"}`);
  revalidatePath(`/projects/${projectId}/stages/${id}`);
  refresh(projectId);
}

export async function deleteStage(form: FormData): Promise<void> {
  await requirePermission("projects", "edit");
  const id = Number(form.get("id"));
  const db = getDb();
  const s = db.prepare("SELECT * FROM stages WHERE id = ?").get(id) as Stage | undefined;
  if (!s) return;
  const used = (db.prepare("SELECT (SELECT COUNT(*) FROM progress_reports WHERE stage_id=?) + (SELECT COUNT(*) FROM assignments WHERE stage_id=?) c").get(id, id) as { c: number }).c;
  if (used > 0) throw new Error("Stage has progress reports or subcontracts; remove them first");
  db.prepare("DELETE FROM stages WHERE id = ?").run(id);
  await logActivity("project", s.project_id, "stage", `Stage "${s.name}" deleted`);
  refresh(s.project_id);
}

/* ---------------------------------------------------------------- map */

/**
 * Persist the map editor result. `fc` holds all editable layers: existing ones carry properties {id, kind};
 * new ones {kind, isNew:true}. Project-kind shapes replace the project geometry; stage-kind shapes update the stage
 * with that id or create a new stage (when isNew).
 */
export async function saveMapGeometry(projectId: number, fc: GeoJSON.FeatureCollection): Promise<{ updatedStages: number; createdStages: number; projectUpdated: boolean }> {
  await requirePermission("project_map", "edit");
  const p = project(projectId);
  const db = getDb();
  const res = { updatedStages: 0, createdStages: 0, projectUpdated: false };
  const projectFeats: GeoJSON.Feature[] = [];
  const stageFeats: GeoJSON.Feature[] = [];
  for (const f of fc.features ?? []) {
    if (!f.geometry) continue;
    const kind = (f.properties?.kind as string | undefined) ?? "project";
    (kind === "stage" ? stageFeats : projectFeats).push(f);
  }
  db.transaction(() => {
    if (projectFeats.length) {
      const geometry = JSON.stringify({ type: "FeatureCollection", features: projectFeats.map((f) => ({ type: "Feature", properties: { kind: "project" }, geometry: f.geometry })) });
      db.prepare("UPDATE projects SET geometry = ? WHERE id = ?").run(geometry, projectId);
      const m = measureGeometry(geometry);
      if (!p.total_quantity) {
        if (m.km !== null) db.prepare("UPDATE projects SET total_quantity = ?, quantity_unit = 'km' WHERE id = ?").run(r2(m.km), projectId);
        else if (m.sqm !== null) db.prepare("UPDATE projects SET total_quantity = ?, quantity_unit = 'sqm' WHERE id = ?").run(Math.round(m.sqm), projectId);
      }
      res.projectUpdated = true;
    }
    let next = (db.prepare("SELECT COALESCE(MAX(sort),-1)+1 s FROM stages WHERE project_id = ?").get(projectId) as { s: number }).s;
    for (const f of stageFeats) {
      const gj = JSON.stringify({ type: "Feature", properties: {}, geometry: f.geometry });
      const sid = Number(f.properties?.id);
      if (sid && !f.properties?.isNew) {
        const r = db.prepare("UPDATE stages SET geometry = ? WHERE id = ? AND project_id = ?").run(gj, sid, projectId);
        if (r.changes) res.updatedStages += 1;
      } else {
        const m = measureGeometry(gj);
        const unit = m.km !== null ? "km" : m.sqm !== null ? "sqm" : null;
        const q = m.km !== null ? r2(m.km) : m.sqm !== null ? Math.round(m.sqm) : 0;
        db.prepare("INSERT INTO stages(project_id, code, name, sort, geometry, planned_quantity, quantity_unit, status) VALUES (?,?,?,?,?,?,?, 'not_started')")
          .run(projectId, `S${next + 1}`, `New stage ${next + 1}`, next, gj, q, unit);
        next += 1; res.createdStages += 1;
      }
    }
  })();
  await logActivity("project", projectId, "map", `Map saved (route ${res.projectUpdated ? "updated" : "unchanged"}, ${res.updatedStages} stage shapes updated, ${res.createdStages} created)`);
  refresh(projectId);
  return res;
}

async function createSegments(projectId: number, bounds: number[], replace: boolean): Promise<number> {
  const p = project(projectId);
  const line = firstLine(p.geometry);
  if (!line) throw new Error("The project has no route (LineString). Draw the route first.");
  const db = getDb();
  const segs = sliceLine(line, bounds);
  if (!segs.length) throw new Error("No stages could be created from these chainages");
  const existing = db.prepare("SELECT id FROM stages WHERE project_id = ?").all(projectId) as { id: number }[];
  if (replace && existing.length) {
    const used = (db.prepare("SELECT (SELECT COUNT(*) FROM progress_reports WHERE project_id=? AND stage_id IS NOT NULL) + (SELECT COUNT(*) FROM assignments WHERE project_id=? AND stage_id IS NOT NULL) c").get(projectId, projectId) as { c: number }).c;
    if (used > 0) throw new Error("Cannot replace stages that already have progress reports or subcontracts");
  }
  const total = lineLengthKm(line);
  const keepBudget = replace || existing.length === 0;
  db.transaction(() => {
    if (replace) db.prepare("DELETE FROM stages WHERE project_id = ?").run(projectId);
    let sort = replace ? 0 : (db.prepare("SELECT COALESCE(MAX(sort),-1)+1 s FROM stages WHERE project_id = ?").get(projectId) as { s: number }).s;
    const startMs = p.start_date ? Date.parse(p.start_date) : NaN, endMs = p.end_date ? Date.parse(p.end_date) : NaN;
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    for (const s of segs) {
      const len = r2(s.to - s.from);
      const ps = Number.isNaN(startMs) || Number.isNaN(endMs) ? null : iso(startMs + (endMs - startMs) * (s.from / total));
      const pe = Number.isNaN(startMs) || Number.isNaN(endMs) ? null : iso(startMs + (endMs - startMs) * (s.to / total));
      const budget = keepBudget && p.budget_cost ? Math.round(p.budget_cost * (len / total)) : 0;
      db.prepare(`INSERT INTO stages(project_id, code, name, sort, geometry, planned_quantity, quantity_unit, chainage_from, chainage_to, planned_start, planned_end, budget_amount, status)
        VALUES (?,?,?,?,?,?, 'km', ?,?,?,?,?, 'not_started')`)
        .run(projectId, `S${sort + 1}`, `Section ${sort + 1} (km ${s.from.toFixed(1)}–${s.to.toFixed(1)})`, sort, JSON.stringify(s.feature), len, s.from, s.to, ps, pe, budget);
      sort += 1;
    }
  })();
  return segs.length;
}

export async function splitRouteEqual(form: FormData): Promise<void> {
  await requirePermission("project_map", "edit");
  const projectId = Number(form.get("project_id"));
  const n = Math.floor(num(form, "n"));
  if (n < 2 || n > 100) throw new Error("Number of stages must be between 2 and 100");
  const line = firstLine(project(projectId).geometry);
  if (!line) throw new Error("The project has no route (LineString). Draw the route first.");
  const total = lineLengthKm(line);
  const bounds = Array.from({ length: n + 1 }, (_, i) => (total * i) / n);
  const made = await createSegments(projectId, bounds, form.get("replace") === "on");
  await logActivity("project", projectId, "stages", `Route split into ${made} equal stages`);
  refresh(projectId);
}

export async function splitRouteAtChainages(form: FormData): Promise<void> {
  await requirePermission("project_map", "edit");
  const projectId = Number(form.get("project_id"));
  const line = firstLine(project(projectId).geometry);
  if (!line) throw new Error("The project has no route (LineString). Draw the route first.");
  const total = lineLengthKm(line);
  const cuts = str(form, "chainages").split(/[\s,;]+/).filter(Boolean).map(Number);
  if (!cuts.length || cuts.some((c) => !Number.isFinite(c))) throw new Error("Enter chainages in km separated by commas, e.g. 5, 12.5, 20");
  const inner = [...new Set(cuts.filter((c) => c > 0.0005 && c < total - 0.0005))].sort((a, b) => a - b);
  if (!inner.length) throw new Error(`Chainages must lie inside the route (0–${total.toFixed(2)} km)`);
  const made = await createSegments(projectId, [0, ...inner, total], form.get("replace") === "on");
  await logActivity("project", projectId, "stages", `Route split at chainages ${inner.join(", ")} km into ${made} stages`);
  refresh(projectId);
}

/* ---------------------------------------------------------------- subcontracts (assignments) */

export async function saveAssignment(form: FormData): Promise<void> {
  const user = await requirePermission("subcontractors", "edit");
  const projectId = Number(form.get("project_id"));
  project(projectId);
  const id = Number(form.get("id")) || 0;
  const subId = idOrNull(form, "subcontractor_id");
  if (!subId) throw new Error("Subcontractor is required");
  const status = oneOf("assignmentStatus", str(form, "status") || "draft", "status");
  const qty = numOrNull(form, "quantity"), rate = numOrNull(form, "unit_rate");
  let value = num(form, "contract_value");
  if (!value && qty && rate) value = r2(qty * rate);
  const adv = num(form, "advance_pct"), ret = num(form, "retention_pct");
  if (adv < 0 || adv > 100 || ret < 0 || ret > 100) throw new Error("Percentages must be between 0 and 100");
  const sd = dateOrNull(form, "start_date"), ed = dateOrNull(form, "end_date");
  if (sd && ed && ed < sd) throw new Error("End date is before start date");
  const db = getDb();
  const prev = id ? (db.prepare("SELECT status FROM assignments WHERE id = ? AND project_id = ?").get(id, projectId) as { status: string } | undefined) : undefined;
  if (id && !prev) throw new Error("Subcontract not found");
  // Activating a draft subcontract goes through the subcontract_award approval workflow (status stays draft until approved).
  const activate = status === "active" && (!id || prev?.status === "draft");
  const effective = activate ? "draft" : status;
  const vals = [idOrNull(form, "stage_id"), subId, strOrNull(form, "scope"), value, qty, strOrNull(form, "quantity_unit"), rate, sd, ed,
    strOrNull(form, "payment_terms"), adv, ret, Math.floor(num(form, "payment_days", 30)), effective];
  let savedId = id; let created = false;
  db.transaction(() => {
    if (id) {
      db.prepare("UPDATE assignments SET stage_id=?, subcontractor_id=?, scope=?, contract_value=?, quantity=?, quantity_unit=?, unit_rate=?, start_date=?, end_date=?, payment_terms=?, advance_pct=?, retention_pct=?, payment_days=?, status=? WHERE id=? AND project_id=?")
        .run(...vals, id, projectId);
    } else {
      const maxN = (db.prepare("SELECT code FROM assignments WHERE code LIKE 'SC-%'").all() as { code: string }[]).reduce((m, r) => Math.max(m, Number(r.code.slice(3)) || 0), 0);
      const code = `SC-${String(maxN + 1).padStart(3, "0")}`;
      savedId = Number(db.prepare(`INSERT INTO assignments(stage_id, subcontractor_id, scope, contract_value, quantity, quantity_unit, unit_rate, start_date, end_date, payment_terms, advance_pct, retention_pct, payment_days, status, project_id, code, portal_token, portal_enabled)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(...vals, projectId, code, nanoid(24)).lastInsertRowid);
      created = true;
    }
    if (activate && !hasOpenRequest("subcontract_award", savedId)) submitForApproval("subcontract_award", savedId, { userId: user.id });
  })();
  const code = (db.prepare("SELECT code FROM assignments WHERE id = ?").get(savedId) as { code: string }).code;
  if (created) {
    await logActivity("assignment", savedId, "created", `Subcontract ${code} created`);
    await logActivity("project", projectId, "subcontract", `Subcontract ${code} assigned`);
  } else await logActivity("assignment", savedId, "updated", "Subcontract updated");
  refresh(projectId);
  revalidatePath("/", "layout");
}

export async function deleteAssignment(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const id = Number(form.get("id"));
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(id) as Assignment | undefined;
  if (!a) return;
  const used = (db.prepare("SELECT (SELECT COUNT(*) FROM progress_reports WHERE assignment_id=?) + (SELECT COUNT(*) FROM sub_invoices WHERE assignment_id=?) c").get(id, id) as { c: number }).c;
  if (used > 0) throw new Error("Subcontract has progress reports or invoices; terminate it instead of deleting");
  db.prepare("DELETE FROM assignments WHERE id = ?").run(id);
  await logActivity("project", a.project_id, "subcontract", `Subcontract ${a.code} deleted`);
  refresh(a.project_id);
}

export async function setPortalEnabled(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const id = Number(form.get("id"));
  const enable = form.get("enable") === "1";
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(id) as Assignment | undefined;
  if (!a) throw new Error("Subcontract not found");
  if (enable && a.status !== "active") throw new Error("The portal can be enabled only for an active (approved) subcontract");
  if (enable && !a.portal_token) db.prepare("UPDATE assignments SET portal_token = ? WHERE id = ?").run(nanoid(24), id);
  db.prepare("UPDATE assignments SET portal_enabled = ? WHERE id = ?").run(enable ? 1 : 0, id);
  await logActivity("assignment", id, "portal", `Portal ${enable ? "enabled" : "disabled"} for ${a.code}`);
  refresh(a.project_id);
}

export async function regeneratePortalToken(form: FormData): Promise<void> {
  await requirePermission("subcontractors", "edit");
  const id = Number(form.get("id"));
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(id) as Assignment | undefined;
  if (!a) throw new Error("Subcontract not found");
  db.prepare("UPDATE assignments SET portal_token = ? WHERE id = ?").run(nanoid(24), id);
  await logActivity("assignment", id, "portal", `Portal link regenerated for ${a.code}`);
  refresh(a.project_id);
}

/* ---------------------------------------------------------------- progress */

export async function addProgressReport(form: FormData): Promise<void> {
  await requirePermission("progress", "create");
  const projectId = Number(form.get("project_id"));
  project(projectId);
  const db = getDb();
  const assignmentId = idOrNull(form, "assignment_id");
  let stageId = idOrNull(form, "stage_id");
  const date = dateOrNull(form, "report_date") ?? todayISO();
  const qtyDone = num(form, "quantity_done");
  if (qtyDone < 0) throw new Error("Quantity cannot be negative");
  const asg = assignmentId ? (db.prepare("SELECT * FROM assignments WHERE id = ? AND project_id = ?").get(assignmentId, projectId) as Assignment | undefined) : undefined;
  if (assignmentId && !asg) throw new Error("Subcontract does not belong to this project");
  if (!stageId && asg?.stage_id) stageId = asg.stage_id;
  if (!stageId && !assignmentId) throw new Error("Select a stage or a subcontract");
  const stage = stageId ? (db.prepare("SELECT * FROM stages WHERE id = ? AND project_id = ?").get(stageId, projectId) as Stage | undefined) : undefined;
  if (stageId && !stage) throw new Error("Stage does not belong to this project");
  const responsibility = oneOf("responsibility", str(form, "delay_responsibility") || "none", "responsibility");
  const delayDays = num(form, "delay_days");

  const trades = lines(form, "mp_trade"), heads = lines(form, "mp_headcount"), hours = lines(form, "mp_hours");
  const manpower = trades.map((t, i) => ({ trade: t, headcount: Math.floor(Number(heads[i]) || 0), hours: Number(hours[i]) || 0 })).filter((m) => m.trade);
  const mn = lines(form, "mat_name"), mu = lines(form, "mat_unit"), mq = lines(form, "mat_qty"), mc = lines(form, "mat_cost");
  const materials = mn.map((m, i) => ({ material: m, unit: mu[i] || null, quantity: Number(mq[i]) || 0, unit_cost: Number(mc[i]) || 0 })).filter((m) => m.material);

  const prior = (assignmentId
    ? db.prepare("SELECT COALESCE(SUM(quantity_done),0) v FROM progress_reports WHERE assignment_id = ? AND status <> 'rejected'").get(assignmentId)
    : db.prepare("SELECT COALESCE(SUM(quantity_done),0) v FROM progress_reports WHERE stage_id = ? AND status <> 'rejected'").get(stageId)) as { v: number };
  const cumulative = r2(prior.v + qtyDone);
  const denom = (asg?.quantity && asg.quantity > 0 ? asg.quantity : stage?.planned_quantity) || 0;
  const percent = denom > 0 ? Math.min(100, r2((cumulative / denom) * 100)) : num(form, "percent_complete");
  const user = await getCurrentUser();

  const rid = db.transaction(() => {
    const id = Number(db.prepare(
      `INSERT INTO progress_reports(assignment_id, stage_id, project_id, report_date, quantity_done, cumulative_quantity, percent_complete, manpower_count, man_hours, equipment_used, work_done, issues, delay_days, delay_cause, delay_responsibility, source, status, verified_by, verified_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'internal','verified',?,CURRENT_TIMESTAMP)`).run(
      assignmentId, stageId, projectId, date, qtyDone, cumulative, percent,
      manpower.reduce((a, m) => a + m.headcount, 0), manpower.reduce((a, m) => a + m.hours, 0),
      strOrNull(form, "equipment_used"), strOrNull(form, "work_done"), strOrNull(form, "issues"), delayDays, strOrNull(form, "delay_cause"), responsibility, user.id || null).lastInsertRowid);
    for (const m of manpower) db.prepare("INSERT INTO progress_manpower(progress_report_id, trade, headcount, hours) VALUES (?,?,?,?)").run(id, m.trade, m.headcount, m.hours);
    for (const m of materials) db.prepare("INSERT INTO progress_materials(progress_report_id, material, unit, quantity, unit_cost) VALUES (?,?,?,?,?)").run(id, m.material, m.unit, m.quantity, m.unit_cost);
    syncProgressMaterialCosts(id);
    if (stage && stage.status === "not_started") db.prepare("UPDATE stages SET status='in_progress', actual_start = COALESCE(actual_start, ?) WHERE id = ?").run(date, stage.id);
    return id;
  })();
  await saveUploadsFromForm(form, "photos", "progress", rid, "Photos");
  await logActivity("progress", rid, "created", `Progress report added for ${stage?.code ?? "project"} (${qtyDone} ${stage?.quantity_unit ?? ""})`);
  await logActivity("project", projectId, "progress", `Progress report ${date} added${stage ? ` for ${stage.code ?? stage.name}` : ""}`);
  revalidatePath(`/projects/${projectId}/stages/${stageId}`);
  refresh(projectId);
}

async function setReportStatus(form: FormData, status: "verified" | "rejected"): Promise<void> {
  const id = Number(form.get("id"));
  const db = getDb();
  await requirePermission("progress", "verify");
  const r = db.prepare("SELECT * FROM progress_reports WHERE id = ?").get(id) as { project_id: number; stage_id: number | null; report_date: string } | undefined;
  if (!r) throw new Error("Report not found");
  const user = await getCurrentUser();
  db.transaction(() => {
    const reason = status === "rejected" ? str(form, "reason") || null : null;
    db.prepare("UPDATE progress_reports SET status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP, reject_reason = ? WHERE id = ?").run(status, user.id || null, reason, id);
    syncProgressMaterialCosts(id);
  })();
  await logActivity("progress", id, status, `Progress report ${r.report_date} ${status}${status === "rejected" && str(form, "reason") ? `: ${str(form, "reason")}` : ""}`);
  await logActivity("project", r.project_id, "progress", `Progress report ${r.report_date} ${status}`);
  revalidatePath(`/projects/${r.project_id}/stages/${r.stage_id}`);
  refresh(r.project_id);
}
export async function verifyProgressReport(form: FormData): Promise<void> { await setReportStatus(form, "verified"); }
export async function rejectProgressReport(form: FormData): Promise<void> { await setReportStatus(form, "rejected"); }

/* ---------------------------------------------------------------- budget & cost */

export async function addManualCost(form: FormData): Promise<void> {
  const user = await requirePermission("project_costs", "create");
  const projectId = Number(form.get("project_id"));
  project(projectId);
  const category = oneOf("budgetCategory", str(form, "category"), "category");
  const amount = num(form, "amount");
  if (!(amount > 0)) throw new Error("Amount must be greater than zero");
  const description = str(form, "description");
  if (!description) throw new Error("Description is required");
  const stageId = idOrNull(form, "stage_id"); const date = dateOrNull(form, "cost_date") ?? todayISO();
  const threshold = Number(getSetting("approval_cost_threshold", "50000")) || 50000;
  const db = getDb();
  if (amount > threshold) {
    // Above the threshold the cost waits for the project_cost approval workflow before it is posted to the ledger.
    db.transaction(() => {
      const rid = Number(db.prepare("INSERT INTO project_cost_requests(project_id, stage_id, category, description, amount, cost_date, created_by, status) VALUES (?,?,?,?,?,?,?, 'pending')")
        .run(projectId, stageId, category, description, amount, date, user.id || null).lastInsertRowid);
      submitForApproval("project_cost", rid, { userId: user.id });
    })();
    await logActivity("project", projectId, "cost", `Manual cost ${description} (${amount}) submitted for approval (above ${threshold})`);
  } else {
    db.prepare("INSERT INTO project_costs(project_id, stage_id, category, description, amount, cost_date, source_type, source_id) VALUES (?,?,?,?,?,?, 'manual', NULL)")
      .run(projectId, stageId, category, description, amount, date);
    await logActivity("project", projectId, "cost", `Manual cost added: ${description} (${amount})`);
  }
  refresh(projectId);
  revalidatePath("/", "layout");
}

export async function deleteManualCost(form: FormData): Promise<void> {
  await requirePermission("project_costs", "create");
  const id = Number(form.get("id"));
  const db = getDb();
  const c = db.prepare("SELECT * FROM project_costs WHERE id = ?").get(id) as { project_id: number; source_type: string | null; description: string | null } | undefined;
  if (!c) return;
  if (c.source_type && c.source_type !== "manual") throw new Error("Auto-posted costs cannot be deleted; change the source record instead");
  db.prepare("DELETE FROM project_costs WHERE id = ?").run(id);
  await logActivity("project", c.project_id, "cost", `Manual cost deleted: ${c.description ?? id}`);
  refresh(c.project_id);
}

/* ---------------------------------------------------------------- invoices */

function invoice(id: number): SubInvoice {
  const i = getDb().prepare("SELECT * FROM sub_invoices WHERE id = ?").get(id) as SubInvoice | undefined;
  if (!i) throw new Error("Invoice not found");
  return i;
}
function terms(assignmentId: number): Assignment {
  return getDb().prepare("SELECT * FROM assignments WHERE id = ?").get(assignmentId) as Assignment;
}

export async function createInvoice(form: FormData): Promise<ActionResult> {
  return guard(async () => {
  const user = await requirePermission("invoices", "certify");
  const projectId = Number(form.get("project_id"));
  const assignmentId = idOrNull(form, "assignment_id");
  if (!assignmentId) throw new Error("Subcontract is required");
  const a = terms(assignmentId);
  if (!a || a.project_id !== projectId) throw new Error("Subcontract does not belong to this project");
  const facts = getAssignmentFacts(assignmentId)!;
  const fail = (m: string): never => { throw new Error(m); };
  // Lines (line editor) or a lump claim (gross amount incl. VAT). Server computes every total.
  const parsed = parseInvoiceLines(form, getAssignmentBoq(assignmentId), { allowCustom: true, fail });
  let subtotal: number, vat: number, gross: number;
  if (parsed.length) {
    ({ subtotal, vat, gross } = fromSubtotal(parsed.reduce((t, l) => t + l.amount, 0), DEFAULT_VAT_RATE));
  } else {
    const claimed = num(form, "claimed_amount");
    if (!(claimed > 0)) throw new Error("Enter the line quantities or a claimed amount greater than zero");
    ({ subtotal, vat, gross } = fromGross(claimed, DEFAULT_VAT_RATE));
  }
  const uploads = readInvoiceUploads(form, { requireTaxInvoice: false, fail });
  const db = getDb();
  const n = (db.prepare("SELECT COUNT(*) c FROM sub_invoices WHERE assignment_id = ?").get(assignmentId) as { c: number }).c + 1;
  const no = strOrNull(form, "invoice_no") ?? `${a.code}-INV-${String(n).padStart(2, "0")}`;
  const date = dateOrNull(form, "invoice_date") ?? todayISO();
  const lineRows = parsed.length ? parsed : [lumpLine(facts, subtotal, getAssignmentBoq(assignmentId)[0]?.prev_qty ?? 0)];
  const id = db.transaction(() => {
    const newId = Number(db.prepare(
      `INSERT INTO sub_invoices(assignment_id, project_id, invoice_no, invoice_date, period_from, period_to, claimed_amount, claimed_percent, status, source, notes,
         sub_invoice_ref, currency, vat_rate, subtotal, vat_amount, gross_amount, retention_percent, advance_recovery_percent, previous_certified,
         submitted_by_name, submitted_by_email, submitted_at, due_date)
       VALUES (?,?,?,?,?,?,?,?, 'submitted', 'internal', ?, ?,?,?,?,?,?,?,?,?, ?,?,?,?)`).run(
      assignmentId, projectId, no, date, dateOrNull(form, "period_from"), dateOrNull(form, "period_to"),
      gross, a.contract_value ? r2((subtotal / a.contract_value) * 100) : 0, strOrNull(form, "notes"),
      strOrNull(form, "sub_invoice_ref"), getSetting("currency", "AED"), DEFAULT_VAT_RATE, subtotal, vat, gross, a.retention_pct || 0, a.advance_pct || 0, previousCertified(assignmentId),
      user.name, user.email, new Date().toISOString(), dueDate(date, a.payment_days)).lastInsertRowid);
    insertInvoiceLines(db, newId, lineRows);
    return newId;
  })();
  await saveInvoiceUploads(id, uploads);
  await saveUploadsFromForm(form, "files", "sub_invoice", id, "other");
  await logActivity("invoice", id, "created", `Invoice ${no} recorded (${gross})`);
  refresh(projectId);
  });
}

export async function startInvoiceReview(form: FormData): Promise<void> {
  await requirePermission("invoices", "certify");
  const id = Number(form.get("id"));
  const i = invoice(id);
  if (i.status !== "submitted") throw new Error("Only submitted invoices can go under review");
  const reviewer = await getCurrentUser();
  getDb().prepare("UPDATE sub_invoices SET status='under_review', reviewed_by=? WHERE id=?").run(reviewer.id || null, id);
  await logActivity("invoice", id, "review", `Invoice ${i.invoice_no} under review`);
  refresh(i.project_id);
  revalidatePath(`/invoices/${id}`);
}

/** Certify: set certified amount, auto-compute retention & advance recovery from assignment terms. */
export async function certifyInvoice(form: FormData): Promise<void> {
  await requirePermission("invoices", "certify");
  const id = Number(form.get("id"));
  const i = invoice(id);
  if (!["submitted", "under_review", "certified"].includes(i.status)) throw new Error(`Cannot certify an invoice that is ${i.status}`);
  const certified = num(form, "certified_amount", i.claimed_amount);
  if (certified < 0) throw new Error("Certified amount cannot be negative");
  if (certified > i.claimed_amount * 1.0001 && i.claimed_amount > 0) throw new Error("Certified amount exceeds the claimed amount");
  const a = terms(i.assignment_id);
  const { retention, advance, net } = deductions(certified, a.retention_pct, a.advance_pct);
  const db = getDb();
  const user = await getCurrentUser();
  db.transaction(() => {
    withdrawOpenRequest("sub_invoice", id, user.id);
    db.prepare("UPDATE sub_invoices SET status='certified', certified_amount=?, retention_amount=?, advance_recovery=?, net_payable=?, certified_by=?, certified_at=? WHERE id=?")
      .run(certified, retention, advance, net, user.id || null, new Date().toISOString(), id);
    applyCertificationToLines(db, id, fromGross(certified, i.vat_rate || DEFAULT_VAT_RATE).subtotal);
    syncInvoiceCost(id);
    // Certification raises the multi-level sub_invoice approval; the invoice becomes approved (and cost is posted) on final approval.
    submitForApproval("sub_invoice", id, { userId: user.id });
  })();
  await logActivity("invoice", id, "certified", `Invoice ${i.invoice_no} certified ${certified} (retention ${retention}, advance recovery ${advance}, net ${net})`);
  refresh(i.project_id); revalidatePath("/", "layout"); revalidatePath(`/invoices/${id}`);
}

export async function approveInvoice(form: FormData): Promise<void> {
  await requirePermission("invoices", "approve");
  const id = Number(form.get("id"));
  const i = invoice(id);
  if (i.status !== "certified") throw new Error("Invoice must be certified before approval");
  const user = await getCurrentUser();
  if (hasOpenRequest("sub_invoice", id)) throw new Error("Invoice approval is already pending");
  submitForApproval("sub_invoice", id, { userId: user.id });
  await logActivity("invoice", id, "approval", `Invoice ${i.invoice_no} submitted for approval`);
  refresh(i.project_id); revalidatePath("/", "layout");
}

export async function payInvoice(form: FormData): Promise<void> {
  await requirePermission("invoices", "pay");
  const id = Number(form.get("id"));
  const i = invoice(id);
  if (i.status !== "approved") throw new Error("Invoice must be approved before payment");
  const amount = num(form, "paid_amount", i.net_payable);
  if (!(amount > 0)) throw new Error("Paid amount must be greater than zero");
  const user = await getCurrentUser();
  if (hasOpenRequest("invoice_payment", id)) throw new Error("Payment approval is already pending");
  submitForApproval("invoice_payment", id, { userId: user.id, payload: { paid_amount: amount, paid_date: dateOrNull(form, "paid_date") ?? todayISO(), payment_method: strOrNull(form, "payment_method") ?? "Bank transfer", payment_ref: strOrNull(form, "payment_ref") } });
  await logActivity("invoice", id, "approval", `Payment of invoice ${i.invoice_no} (${amount}) submitted for approval`);
  refresh(i.project_id); revalidatePath("/", "layout");
}

export async function rejectInvoice(form: FormData): Promise<void> {
  await requireAnyPermission("invoices", ["certify", "approve"]);
  const id = Number(form.get("id"));
  const i = invoice(id);
  if (i.status === "paid") throw new Error("A paid invoice cannot be rejected");
  const db = getDb();
  const actor = await getCurrentUser();
  db.transaction(() => {
    withdrawOpenRequest("sub_invoice", id, actor.id); withdrawOpenRequest("invoice_payment", id, actor.id);
    db.prepare("UPDATE sub_invoices SET status='rejected', notes = CASE WHEN ? <> '' THEN COALESCE(notes || char(10), '') || ? ELSE notes END WHERE id=?").run(str(form, "reason"), `Rejected: ${str(form, "reason")}`, id);
    syncInvoiceCost(id);
  })();
  await logActivity("invoice", id, "rejected", `Invoice ${i.invoice_no} rejected${str(form, "reason") ? `: ${str(form, "reason")}` : ""}`);
  refresh(i.project_id);
}

/* ---------------------------------------------------------------- certificates */

export async function saveCertificate(form: FormData): Promise<void> {
  await requirePermission("certificates", "issue");
  const projectId = Number(form.get("project_id"));
  const assignmentId = idOrNull(form, "assignment_id");
  if (!assignmentId) throw new Error("Subcontract is required");
  const a = terms(assignmentId);
  if (!a || a.project_id !== projectId) throw new Error("Subcontract does not belong to this project");
  const type = oneOf("certType", str(form, "cert_type") || "partial", "certificate type");
  const issueNow = form.get("issue_now") === "on";
  const db = getDb();
  const user = await getCurrentUser();
  const p = project(projectId);
  const n = (db.prepare("SELECT COUNT(*) c FROM completion_certificates WHERE project_id = ?").get(projectId) as { c: number }).c + 1;
  const no = strOrNull(form, "cert_no") ?? `CC-${p.code.replace("PRJ-", "")}-${String(n).padStart(2, "0")}`;
  const id = Number(db.prepare(
    `INSERT INTO completion_certificates(assignment_id, project_id, stage_id, cert_type, cert_no, cert_date, percent, quantity, remarks, status, issued_by, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'internal')`).run(
    assignmentId, projectId, a.stage_id, type, no, dateOrNull(form, "cert_date") ?? todayISO(), numOrNull(form, "percent"), numOrNull(form, "quantity"),
    strOrNull(form, "remarks"), "draft", null).lastInsertRowid);
  await saveUploadsFromForm(form, "files", "certificate", id, "Certificate");
  await logActivity("certificate", id, "created", `Certificate ${no} (${type}) drafted`);
  // Issuing goes through the completion_certificate approval workflow (auto-issued when no workflow applies).
  if (issueNow) { submitForApproval("completion_certificate", id, { userId: user.id }); await logActivity("certificate", id, "approval", `Certificate ${no} submitted for issue approval`); }
  refresh(projectId); revalidatePath("/", "layout");
}

async function setCertStatus(form: FormData, status: "issued" | "rejected"): Promise<void> {
  const id = Number(form.get("id"));
  const db = getDb();
  const user = await requirePermission("certificates", "issue");
  const c = db.prepare("SELECT * FROM completion_certificates WHERE id = ?").get(id) as { project_id: number; cert_no: string | null; status: string } | undefined;
  if (!c) throw new Error("Certificate not found");
  if (c.status === "issued" && status === "issued") return;
  if (status === "issued") {
    if (hasOpenRequest("completion_certificate", id)) throw new Error("Certificate approval is already pending");
    submitForApproval("completion_certificate", id, { userId: user.id });
    await logActivity("certificate", id, "approval", `Certificate ${c.cert_no} submitted for issue approval`);
  } else {
    db.transaction(() => {
      withdrawOpenRequest("completion_certificate", id, user.id);
      db.prepare("UPDATE completion_certificates SET status = 'rejected', issued_by = ? WHERE id = ?").run(user.id || null, id);
    })();
    await logActivity("certificate", id, "rejected", `Certificate ${c.cert_no} rejected`);
  }
  refresh(c.project_id); revalidatePath("/", "layout");
}
export async function issueCertificate(form: FormData): Promise<void> { await setCertStatus(form, "issued"); }
export async function rejectCertificate(form: FormData): Promise<void> { await setCertStatus(form, "rejected"); }

/* ---------------------------------------------------------------- issues */

export async function saveIssue(form: FormData): Promise<void> {
  await requirePermission("projects", "edit");
  const projectId = Number(form.get("project_id"));
  project(projectId);
  const id = Number(form.get("id")) || 0;
  const title = str(form, "title");
  if (!title) throw new Error("Title is required");
  const responsibility = oneOf("responsibility", str(form, "responsibility") || "other", "responsibility");
  const status = oneOf("issueStatus", str(form, "status") || "open", "status");
  const resolved = status === "closed" ? (dateOrNull(form, "resolved_on") ?? todayISO()) : null;
  const db = getDb();
  const vals = [idOrNull(form, "stage_id"), idOrNull(form, "assignment_id"), title, strOrNull(form, "description"), responsibility,
    num(form, "impact_days"), num(form, "impact_cost"), status, dateOrNull(form, "raised_on") ?? todayISO(), resolved];
  if (id) {
    db.prepare("UPDATE issues SET stage_id=?, assignment_id=?, title=?, description=?, responsibility=?, impact_days=?, impact_cost=?, status=?, raised_on=?, resolved_on=? WHERE id=? AND project_id=?").run(...vals, id, projectId);
  } else {
    db.prepare("INSERT INTO issues(stage_id, assignment_id, title, description, responsibility, impact_days, impact_cost, status, raised_on, resolved_on, project_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(...vals, projectId);
  }
  await logActivity("project", projectId, "issue", `Issue "${title}" ${id ? "updated" : "raised"} (${responsibility})`);
  refresh(projectId);
}

export async function deleteIssue(form: FormData): Promise<void> {
  await requirePermission("projects", "edit");
  const id = Number(form.get("id"));
  const db = getDb();
  const i = db.prepare("SELECT project_id, title FROM issues WHERE id = ?").get(id) as { project_id: number; title: string } | undefined;
  if (!i) return;
  db.prepare("DELETE FROM issues WHERE id = ?").run(id);
  await logActivity("project", i.project_id, "issue", `Issue "${i.title}" deleted`);
  refresh(i.project_id);
}

export async function setIssueStatus(form: FormData): Promise<void> {
  await requirePermission("projects", "edit");
  const id = Number(form.get("id"));
  const status = oneOf("issueStatus", str(form, "status"), "status");
  const db = getDb();
  const i = db.prepare("SELECT project_id, title FROM issues WHERE id = ?").get(id) as { project_id: number; title: string } | undefined;
  if (!i) return;
  db.prepare("UPDATE issues SET status = ?, resolved_on = CASE WHEN ? = 'closed' THEN ? ELSE NULL END WHERE id = ?").run(status, status, todayISO(), id);
  await logActivity("project", i.project_id, "issue", `Issue "${i.title}" → ${status}`);
  refresh(i.project_id);
}
