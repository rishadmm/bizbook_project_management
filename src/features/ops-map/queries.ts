import * as turf from "@turf/turf";
import { getDb } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { getAssignmentProgress, getProjectMetrics, stageWeights } from "@/lib/metrics";
import type { DelayEvent, HistPt, OpsIssue, OpsMapData, OpsProject, OpsSegment, Resp } from "./types";

interface ProjectRow {
  id: number; code: string; name: string; client_name: string | null; category: string | null; status: string; parent_id: number | null; region: string | null;
  contract_value: number; budget_cost: number; start_date: string | null; end_date: string | null; total_quantity: number | null; quantity_unit: string | null;
  geometry: string | null; manager_name: string | null;
}
interface StageRow {
  id: number; project_id: number; code: string | null; name: string; geometry: string | null; planned_quantity: number; quantity_unit: string | null;
  chainage_from: number | null; chainage_to: number | null; planned_start: string | null; planned_end: string | null; budget_amount: number; weight_pct: number | null;
  status: string; sort: number;
}
interface AsgRow {
  id: number; project_id: number; stage_id: number | null; subcontractor_id: number; scope: string | null; contract_value: number; quantity: number | null;
  quantity_unit: string | null; start_date: string | null; end_date: string | null; status: string; portal_token: string | null; portal_enabled: number; sub_name: string; rating: number | null; trade: string | null;
}
interface RepRow {
  assignment_id: number | null; stage_id: number | null; report_date: string; quantity_done: number; percent_complete: number; manpower_count: number;
  delay_days: number; delay_responsibility: string;
}

type Geom = GeoJSON.Geometry;
const parseGeom = (s: string | null): Geom | null => {
  if (!s) return null;
  try {
    const g = JSON.parse(s);
    if (g.type === "Feature") return g.geometry;
    if (g.type === "FeatureCollection") return g.features?.[0]?.geometry ?? null;
    return g;
  } catch { return null; }
};
const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;
const r5 = (c: number[]) => [round(c[0], 5), round(c[1], 5)];

function historyOf(reps: RepRow[], qty: number | null, completed: boolean): HistPt[] {
  const out: HistPt[] = [];
  let cum = 0;
  for (const r of [...reps].sort((a, b) => a.report_date.localeCompare(b.report_date))) {
    cum += r.quantity_done || 0;
    const pct = qty && qty > 0 && cum > 0 ? Math.min(100, (cum / qty) * 100) : Math.min(100, Math.max(0, r.percent_complete || 0));
    out.push({ d: r.report_date, pct: Math.max(pct, out.length ? out[out.length - 1].pct : 0), qty: cum, mp: r.manpower_count || 0 });
  }
  if (completed && out.length && out[out.length - 1].pct < 99.5) out[out.length - 1].pct = 100;
  return out;
}

/** One JSON payload for the Live Ops Map: projects, subcontract segments (sliced geometry), issues, delay events. */
export function getOpsMapData(opts: { includePortal?: boolean } = {}): OpsMapData {
  const db = getDb();
  const today = todayISO();
  const projectsRaw = db.prepare(
    `SELECT p.*, c.name AS client_name, u.name AS manager_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.manager_id
     WHERE p.status NOT IN ('cancelled') ORDER BY p.code`,
  ).all() as ProjectRow[];
  const stages = db.prepare("SELECT * FROM stages ORDER BY project_id, sort, id").all() as StageRow[];
  const asgs = db.prepare(
    `SELECT a.*, s.name AS sub_name, s.rating, s.trade FROM assignments a JOIN subcontractors s ON s.id = a.subcontractor_id WHERE a.status <> 'terminated' ORDER BY a.id`,
  ).all() as AsgRow[];
  const reps = db.prepare(
    "SELECT assignment_id, stage_id, report_date, quantity_done, percent_complete, manpower_count, delay_days, delay_responsibility FROM progress_reports WHERE status = 'verified'",
  ).all() as RepRow[];
  const issuesRaw = db.prepare("SELECT * FROM issues ORDER BY id").all() as {
    id: number; project_id: number; stage_id: number | null; assignment_id: number | null; title: string; responsibility: string | null; impact_days: number; impact_cost: number;
    status: string; raised_on: string | null; resolved_on: string | null;
  }[];
  const costs = db.prepare("SELECT project_id, cost_date, amount FROM project_costs WHERE cost_date IS NOT NULL ORDER BY cost_date").all() as { project_id: number; cost_date: string; amount: number }[];
  const subs = db.prepare("SELECT id, name FROM subcontractors WHERE id IN (SELECT DISTINCT subcontractor_id FROM assignments) ORDER BY name").all() as { id: number; name: string }[];

  const segments: OpsSegment[] = [];
  const projects: OpsProject[] = [];
  const stagesByProject = new Map<number, StageRow[]>();
  for (const s of stages) { const a = stagesByProject.get(s.project_id) ?? []; a.push(s); stagesByProject.set(s.project_id, a); }

  for (const p of projectsRaw) {
    const pStages = stagesByProject.get(p.id) ?? [];
    const metrics = getProjectMetrics(p.id, today);
    const weights = stageWeights(pStages);
    const projSegs: OpsSegment[] = [];

    for (const st of pStages) {
      const sa = asgs.filter((a) => a.stage_id === st.id);
      const g = parseGeom(st.geometry) ?? parseGeom(p.geometry);
      if (!g) continue;
      const stageW = weights.get(st.id) ?? 0;
      const unit = st.quantity_unit ?? p.quantity_unit ?? "";
      // shares for slicing: assignment quantity; lump-sum scopes get a modest slice (60% of the mean measured quantity)
      const known = sa.map((a) => a.quantity ?? 0).filter((q) => q > 0);
      const mean = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 1;
      const raw = sa.map((a) => (a.quantity && a.quantity > 0 ? a.quantity : mean * 0.6));
      const sum = raw.reduce((x, y) => x + y, 0) || 1;
      const n = Math.max(1, sa.length);
      const shares = sa.length ? raw.map((x) => x / sum) : [1];
      let cursor = 0;
      for (let i = 0; i < n; i++) {
        const a = sa[i] ?? null;
        const f0 = cursor, f1 = sa.length ? cursor + shares[i] : 1;
        cursor = f1;
        const isLine = g.type === "LineString" || g.type === "MultiLineString";
        let coords: number[][] = [];
        let rings: number[][][] | null = null;
        let lengthKm = 0;
        let bbox: [number, number, number, number];
        let mid: [number, number];
        try {
          if (isLine) {
            const base = g.type === "LineString" ? g.coordinates : (g.coordinates[0] ?? []);
            const line = turf.lineString(base);
            const total = turf.length(line, { units: "kilometers" });
            if (n === 1 || total <= 0) coords = base.map(r5);
            else coords = turf.lineSliceAlong(line, total * f0, total * f1, { units: "kilometers" }).geometry.coordinates.map(r5);
            lengthKm = n === 1 ? total : total * (f1 - f0);
            const lf = turf.lineString(coords);
            const b = turf.bbox(lf);
            bbox = [b[0], b[1], b[2], b[3]];
            const m = turf.along(lf, turf.length(lf, { units: "kilometers" }) / 2, { units: "kilometers" }).geometry.coordinates;
            mid = [m[1], m[0]];
          } else {
            const poly = g.type === "Polygon" ? g.coordinates : (g.type === "MultiPolygon" ? g.coordinates[0] : []);
            const pb = turf.bbox(turf.polygon(poly));
            let clipped: number[][][] = poly;
            if (n > 1) {
              const horizontal = pb[2] - pb[0] >= pb[3] - pb[1];
              const box: [number, number, number, number] = horizontal
                ? [pb[0] + (pb[2] - pb[0]) * f0, pb[1], pb[0] + (pb[2] - pb[0]) * f1, pb[3]]
                : [pb[0], pb[1] + (pb[3] - pb[1]) * f0, pb[2], pb[1] + (pb[3] - pb[1]) * f1];
              clipped = turf.bboxClip(turf.polygon(poly), box).geometry.coordinates as number[][][];
            }
            rings = clipped.map((r) => r.map(r5));
            const b = turf.bbox(turf.polygon(rings));
            bbox = [b[0], b[1], b[2], b[3]];
            const c = turf.centroid(turf.polygon(rings)).geometry.coordinates;
            mid = [c[1], c[0]];
          }
        } catch { continue; }

        const myReps = a ? reps.filter((r) => r.assignment_id === a.id) : reps.filter((r) => r.stage_id === st.id && !r.assignment_id);
        const qty = a ? a.quantity : st.planned_quantity;
        const completed = a ? a.status === "completed" : st.status === "completed";
        const history = historyOf(myReps, qty && qty > 0 ? qty : null, completed);
        const delays: DelayEvent[] = myReps.filter((r) => (r.delay_days || 0) > 0).map((r) => ({
          d: r.report_date, days: r.delay_days, resp: ((r.delay_responsibility && r.delay_responsibility !== "none" ? r.delay_responsibility : "other") as Resp), cost: 0, src: "report" as const,
        }));
        const ap = a ? getAssignmentProgress(a.id, today) : null;
        const planQty = (st.planned_quantity || 0) * (f1 - f0);
        const chainFrom = st.chainage_from !== null && st.chainage_to !== null ? st.chainage_from + (st.chainage_to - st.chainage_from) * f0 : null;
        const chainTo = st.chainage_from !== null && st.chainage_to !== null ? st.chainage_from + (st.chainage_to - st.chainage_from) * f1 : null;
        const seg: OpsSegment = {
          key: a ? `a${a.id}` : `s${st.id}`, assignmentId: a?.id ?? null, projectId: p.id, stageId: st.id, stageCode: st.code, stageName: st.name,
          chainFrom, chainTo,
          sub: a ? { id: a.subcontractor_id, name: a.sub_name, rating: a.rating, trade: a.trade } : null,
          scope: a?.scope ?? null, assignmentStatus: a?.status ?? null, contractValue: a?.contract_value ?? st.budget_amount ?? 0,
          qty: a ? a.quantity : st.planned_quantity, unit: (a?.quantity_unit && a.quantity_unit !== "lumpsum" ? a.quantity_unit : unit) || "",
          planQty, kind: isLine ? "line" : "polygon", coords, rings, lengthKm: round(lengthKm, 4), bbox, mid,
          plannedStart: a?.start_date ?? st.planned_start, plannedEnd: a?.end_date ?? st.planned_end,
          weight: stageW * (f1 - f0), shared: n > 1 ? { index: i, count: n } : null,
          history, delays, invoices: { claimed: ap?.invoiced ?? 0, certified: ap?.certified ?? 0, paid: ap?.paid ?? 0 },
          portalToken: opts.includePortal && a?.portal_enabled ? a.portal_token : null,
        };
        projSegs.push(seg);
      }
    }

    // bbox of the project
    let bb: [number, number, number, number] | null = null;
    for (const s of projSegs) bb = bb ? [Math.min(bb[0], s.bbox[0]), Math.min(bb[1], s.bbox[1]), Math.max(bb[2], s.bbox[2]), Math.max(bb[3], s.bbox[3])] : [...s.bbox];
    if (!bb) {
      const pg = parseGeom(p.geometry);
      if (pg) { try { const b = turf.bbox(pg); bb = [b[0], b[1], b[2], b[3]]; } catch { /* ignore */ } }
    }
    if (!bb) continue;
    const pcosts = costs.filter((c) => c.project_id === p.id);
    const acHistory: { d: string; cum: number }[] = [];
    let cum = 0;
    for (const c of pcosts) { cum += c.amount; if (acHistory.length && acHistory[acHistory.length - 1].d === c.cost_date) acHistory[acHistory.length - 1].cum = cum; else acHistory.push({ d: c.cost_date, cum }); }
    projects.push({
      id: p.id, code: p.code, name: p.name, client: p.client_name, category: p.category, status: p.status, parentId: p.parent_id, region: p.region, bbox: bb,
      contractValue: p.contract_value || 0, bac: p.budget_cost || 0, ac: metrics.ac, startDate: p.start_date, endDate: p.end_date,
      totalQty: p.total_quantity, unit: p.quantity_unit, lengthKm: round(projSegs.filter((s) => s.kind === "line").reduce((x, s) => x + s.lengthKm, 0), 3),
      forecastFinish: metrics.forecastFinish, acHistory, managerName: p.manager_name,
    });
    segments.push(...projSegs);
  }

  // normalise weights per project so they sum to 1
  const sumW = new Map<number, number>();
  for (const s of segments) sumW.set(s.projectId, (sumW.get(s.projectId) ?? 0) + s.weight);
  for (const s of segments) { const t = sumW.get(s.projectId) ?? 0; if (t > 0) s.weight = round(s.weight / t, 6); }

  // issues -> markers + delay events
  const projectCentre = new Map(projects.map((p) => [p.id, [(p.bbox[1] + p.bbox[3]) / 2, (p.bbox[0] + p.bbox[2]) / 2] as [number, number]]));
  const issues: OpsIssue[] = [];
  for (const i of issuesRaw) {
    if (!projectCentre.has(i.project_id)) continue;
    const stageSegs = segments.filter((s) => s.stageId === i.stage_id);
    const own = i.assignment_id ? segments.find((s) => s.assignmentId === i.assignment_id) : null;
    const segKeys = own ? [own.key] : stageSegs.map((s) => s.key);
    const anchor = own?.mid ?? (stageSegs.length ? stageSegs[Math.floor(stageSegs.length / 2)].mid : projectCentre.get(i.project_id)!);
    const jx = Math.sin(i.id * 12.9898) * 0.0007, jy = Math.cos(i.id * 78.233) * 0.0007;
    const resp = ((i.responsibility ?? "other") as Resp);
    const subId = own?.sub?.id ?? null;
    issues.push({
      id: i.id, projectId: i.project_id, stageId: i.stage_id, assignmentId: i.assignment_id, title: i.title, resp, impactDays: i.impact_days || 0, impactCost: i.impact_cost || 0,
      status: i.status, raisedOn: i.raised_on, resolvedOn: i.resolved_on, lat: round(anchor[0] + jy, 6), lng: round(anchor[1] + jx, 6), segKeys, subId,
    });
    for (const s of segments.filter((x) => segKeys.includes(x.key))) {
      if (i.impact_days > 0 && i.raised_on) s.delays.push({ d: i.raised_on, days: i.impact_days, resp, cost: i.impact_cost || 0, src: "issue", issueId: i.id, title: i.title });
    }
  }

  const categories = [...new Set(projects.map((p) => p.category).filter((c): c is string => !!c))].sort();
  return { today, projects, segments, issues, subs, categories };
}
