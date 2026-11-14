// Schedule health, map features and series for the portal (reuses the Live Ops Map geometry + maths; always restricted to the session's company).
import * as turf from "@turf/turf";
import { getDb } from "@/lib/db";
import { addDays, daysBetween, todayISO } from "@/lib/format";
import { getAssignmentProgress } from "@/lib/metrics";
import { visibleAssignmentIds, type PortalSession } from "@/lib/portal-auth";
import { STATUS_COLOR, STATUS_LABEL, computeSegment, pctAt, plannedPctFor } from "@/features/ops-map/calc";
import { getOpsMapData } from "@/features/ops-map/queries";
import type { HistPt, OpsSegment, SegDerived } from "@/features/ops-map/types";
import type { MapFeature } from "@/components/map/types";
import type { PortalAsg } from "./data";

export type Rag = "green" | "amber" | "red" | "grey";
export interface Health {
  assignmentId: number; code: string | null; project: string; stage: string | null; status: string; actualPct: number; plannedPct: number; spi: number | null;
  plannedEnd: string | null; projectedEnd: string | null; slipDays: number; rag: Rag; reqPctWk: number | null; ratePctWk: number | null; unit: string; qty: number | null;
}
const ragOf = (status: string, spi: number | null, slip: number): Rag => {
  if (status === "not_started" || spi === null) return "grey";
  if (status === "behind" || slip > 14 || spi < 0.85) return "red";
  if (status === "at_risk" || slip > 0 || spi < 0.95) return "amber";
  return "green";
};

export interface Segs { segments: Map<number, { seg: OpsSegment; d: SegDerived }> }
/** Ops-map segments of the visible subcontracts (computed with the shared Live Ops Map maths as of today). */
export function companySegments(s: PortalSession): Segs {
  const ids = new Set(visibleAssignmentIds(s));
  const data = getOpsMapData();
  const today = data.today;
  const segments = new Map<number, { seg: OpsSegment; d: SegDerived }>();
  for (const seg of data.segments) {
    // company filter twice: the segment's subcontractor AND the visible assignment ids
    if (!seg.assignmentId || seg.sub?.id !== s.sub.id || !ids.has(seg.assignmentId)) continue;
    segments.set(seg.assignmentId, { seg, d: computeSegment(seg, today, today, data.issues.filter((i) => i.segKeys.includes(seg.key))) });
  }
  return { segments };
}

export function scheduleHealth(asgs: PortalAsg[], segs: Segs): Health[] {
  return asgs.filter((a) => a.status === "active" || a.status === "suspended" || a.status === "completed").map((a) => {
    const g = segs.segments.get(a.id);
    const p = getAssignmentProgress(a.id);
    const unit = a.quantity_unit && a.quantity_unit !== "lumpsum" ? a.quantity_unit : "";
    if (g) {
      return { assignmentId: a.id, code: a.code, project: a.project_code, stage: a.stage_name, status: g.d.status, actualPct: g.d.actualPct, plannedPct: g.d.plannedPct, spi: g.d.spi, plannedEnd: a.end_date,
        projectedEnd: g.d.status === "completed" ? g.d.endedOn : g.d.projectedEnd, slipDays: g.d.slipDays, rag: ragOf(g.d.status, g.d.spi, g.d.slipDays), reqPctWk: g.d.reqPctWk, ratePctWk: g.d.ratePctWk, unit, qty: a.quantity };
    }
    const status = a.status === "completed" ? "completed" : p.spi === null ? "not_started" : p.spi >= 0.95 ? "on_track" : p.spi >= 0.85 ? "at_risk" : "behind";
    return { assignmentId: a.id, code: a.code, project: a.project_code, stage: a.stage_name, status, actualPct: p.actualPct, plannedPct: p.plannedPct, spi: p.spi, plannedEnd: a.end_date, projectedEnd: null, slipDays: 0,
      rag: ragOf(status, p.spi, 0), reqPctWk: null, ratePctWk: null, unit, qty: a.quantity };
  });
}
export const healthLabel = (status: string) => (STATUS_LABEL as Record<string, string>)[status] ?? status;

/* ------------------------------------------------------------------ map */
const fmt = (n: number) => n.toFixed(0);
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function geometryOf(seg: OpsSegment): GeoJSON.Geometry | null {
  if (seg.kind === "line" && seg.coords.length > 1) return { type: "LineString", coordinates: seg.coords };
  if (seg.rings && seg.rings.length) return { type: "Polygon", coordinates: seg.rings };
  return null;
}
/** Dashboard mini map: each section coloured by its health status (green on track, amber at risk, red behind) with a plan tick marker. */
export function dashboardMapFeatures(segs: Segs, slug: string): MapFeature[] {
  const out: MapFeature[] = [];
  for (const { seg, d } of segs.segments.values()) {
    const g = geometryOf(seg);
    if (!g) continue;
    out.push({ id: `s${seg.key}`, kind: "stage", geometry: g, color: STATUS_COLOR[d.status], label: `${seg.stageCode ?? ""} ${seg.stageName}`.trim(),
      popupHtml: `${esc(healthLabel(d.status))} · actual ${fmt(d.actualPct)}% vs plan ${fmt(d.plannedPct)}%`, href: seg.assignmentId ? `/p/${slug}/projects/${seg.assignmentId}` : undefined, editable: false });
    const tick = planTick(seg, d);
    if (tick) out.push(tick);
  }
  return out;
}
/** Detail map of one subcontract: remaining (grey) + completed slice (green, the work front) + a marker where the plan says the work should be. */
export function detailMapFeatures(seg: OpsSegment, d: SegDerived): MapFeature[] {
  const g = geometryOf(seg);
  if (!g) return [];
  const f: MapFeature[] = [{ id: `d${seg.key}`, kind: "stage", geometry: g, color: STATUS_COLOR[d.status], label: `${seg.stageCode ?? ""} ${seg.stageName}`.trim(), progressPct: d.actualPct,
    popupHtml: `${esc(healthLabel(d.status))} · plan ${fmt(d.plannedPct)}%`, editable: false }];
  const tick = planTick(seg, d);
  if (tick) f.push(tick);
  return f;
}
function planTick(seg: OpsSegment, d: SegDerived): MapFeature | null {
  if (seg.kind !== "line" || seg.coords.length < 2 || d.plannedPct <= 0) return null;
  try {
    const line = turf.lineString(seg.coords);
    const len = turf.length(line, { units: "kilometers" });
    const p = turf.along(line, (len * Math.min(100, d.plannedPct)) / 100, { units: "kilometers" }).geometry.coordinates;
    return { id: `t${seg.key}`, kind: "stage", geometry: { type: "Point", coordinates: p }, label: "Plan position", popupHtml: `Where the plan says the work should be today (${fmt(d.plannedPct)}%)`, editable: false };
  } catch { return null; }
}

/* ------------------------------------------------------------------ series */
interface Rep { report_date: string; quantity_done: number; percent_complete: number; manpower_count: number }
function reports(assignmentId: number, verifiedOnly: boolean): Rep[] {
  return getDb().prepare(`SELECT report_date, quantity_done, percent_complete, manpower_count FROM progress_reports WHERE assignment_id = ? AND status ${verifiedOnly ? "= 'verified'" : "<> 'rejected'"} ORDER BY report_date, id`).all(assignmentId) as Rep[];
}
/** Cumulative step history (verified reports) of one subcontract. */
export function historyOf(a: Pick<PortalAsg, "id" | "quantity" | "status">): HistPt[] {
  const out: HistPt[] = [];
  let cum = 0;
  for (const r of reports(a.id, true)) {
    cum += r.quantity_done || 0;
    const pct = a.quantity && a.quantity > 0 && cum > 0 ? Math.min(100, (cum / a.quantity) * 100) : Math.min(100, Math.max(0, r.percent_complete || 0));
    out.push({ d: r.report_date, pct: Math.max(pct, out.length ? out[out.length - 1].pct : 0), qty: cum, mp: r.manpower_count || 0 });
  }
  if (a.status === "completed" && out.length && out[out.length - 1].pct < 99.5) out[out.length - 1].pct = 100;
  return out;
}

function weekDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) out.push(d);
  if (out[out.length - 1] !== to) out.push(to);
  return out.length > 120 ? out.filter((_, i) => i % Math.ceil(out.length / 120) === 0) : out;
}

/** Contract-value weighted planned vs actual progress of the whole company (S-curve). */
export function companySCurve(asgs: PortalAsg[]): { date: string; planned: number; actual: number | null }[] {
  const list = asgs.filter((a) => a.start_date && a.end_date && a.contract_value > 0 && (a.status === "active" || a.status === "completed" || a.status === "suspended"));
  if (!list.length) return [];
  const today = todayISO();
  const from = list.reduce((m, a) => (a.start_date! < m ? a.start_date! : m), list[0].start_date!);
  const to = list.reduce((m, a) => (a.end_date! > m ? a.end_date! : m), list[0].end_date!);
  const total = list.reduce((t, a) => t + a.contract_value, 0);
  const hist = new Map(list.map((a) => [a.id, historyOf(a)]));
  return weekDates(from, to > today ? to : today).map((date) => {
    let planned = 0, actual = 0;
    for (const a of list) { const w = a.contract_value / total; planned += w * plannedPctFor(a.start_date, a.end_date, date); actual += w * pctAt(hist.get(a.id)!, date); }
    return { date, planned: Math.round(planned * 10) / 10, actual: date <= today ? Math.round(actual * 10) / 10 : null };
  });
}

/** Cumulative quantity planned vs actual for one subcontract (progress history chart). */
export function qtySeries(a: PortalAsg): { date: string; planned: number; actual: number | null }[] {
  if (!a.start_date || !a.end_date || !a.quantity || a.quantity <= 0) return [];
  const today = todayISO();
  const h = historyOf(a);
  const from = h.length && h[0].d < a.start_date ? h[0].d : a.start_date;
  return weekDates(from, a.end_date > today ? a.end_date : today).map((date) => {
    let q = 0;
    for (const p of h) { if (p.d <= date) q = p.qty; else break; }
    return { date, planned: Math.round(((a.quantity! * plannedPctFor(a.start_date, a.end_date, date)) / 100) * 100) / 100, actual: date <= today ? Math.round(q * 100) / 100 : null };
  });
}

/** Weekly average headcount (all non-rejected reports), last 12 weeks. */
export function manpowerSeries(assignmentId: number): { label: string; value: number }[] {
  const reps = reports(assignmentId, false);
  const today = todayISO();
  const out: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const hi = addDays(today, -7 * i), lo = addDays(today, -7 * (i + 1));
    const pts = reps.filter((r) => r.report_date > lo && r.report_date <= hi && r.manpower_count > 0);
    out.push({ label: hi.slice(5), value: pts.length ? Math.round(pts.reduce((x, r) => x + r.manpower_count, 0) / pts.length) : 0 });
  }
  return out;
}

export const daysLabel = (d: number) => (d === 0 ? "on time" : d > 0 ? `${d} d late` : `${-d} d early`);
export { daysBetween };
