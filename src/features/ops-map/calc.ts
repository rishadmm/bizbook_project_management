// Pure Live Ops Map maths (MAP_SPEC §2). No DB / server imports: safe in client components and tsx tests.
import { addDays, daysBetween } from "@/lib/format";
import type {
  Derived, HistPt, Kpis, OpsIssue, OpsMapData, OpsProject, OpsSegment, Party, ProjectDerived, Rag, Resp, SegDerived, SegStatus,
} from "./types";

/* ------------------------------------------------------------------ geometry */

export interface LineGeom { pts: [number, number][]; cum: number[]; total: number }
const RAD = Math.PI / 180;

/** coords = [lng,lat][]; pts are [lat,lng]. Distances in metres (equirectangular, fine at map scale). */
export function buildLine(coords: number[][]): LineGeom {
  const pts = coords.map((c) => [c[1], c[0]] as [number, number]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dy = (pts[i][0] - pts[i - 1][0]) * 111_320;
    const dx = (pts[i][1] - pts[i - 1][1]) * 111_320 * Math.cos(((pts[i][0] + pts[i - 1][0]) / 2) * RAD);
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

function at(l: LineGeom, f: number): [number, number] {
  if (l.pts.length === 1 || l.total === 0) return l.pts[0];
  const t = Math.max(0, Math.min(1, f)) * l.total;
  let i = 1;
  while (i < l.cum.length - 1 && l.cum[i] < t) i++;
  const seg = l.cum[i] - l.cum[i - 1] || 1;
  const k = (t - l.cum[i - 1]) / seg;
  return [l.pts[i - 1][0] + (l.pts[i][0] - l.pts[i - 1][0]) * k, l.pts[i - 1][1] + (l.pts[i][1] - l.pts[i - 1][1]) * k];
}

/** Point on the line at fraction f (0-1) plus local bearing (deg, clockwise from north). */
export function pointAt(l: LineGeom, f: number): { lat: number; lng: number; bearing: number } {
  const p = at(l, f);
  const a = at(l, Math.max(0, f - 0.01)), b = at(l, Math.min(1, f + 0.01));
  const dy = b[0] - a[0], dx = (b[1] - a[1]) * Math.cos(p[0] * RAD);
  return { lat: p[0], lng: p[1], bearing: (Math.atan2(dx, dy) / RAD + 360) % 360 };
}

/** Sub-polyline between fractions f0..f1 as [lat,lng][] */
export function sliceLine(l: LineGeom, f0: number, f1: number): [number, number][] {
  const a = Math.max(0, Math.min(1, Math.min(f0, f1))), b = Math.max(0, Math.min(1, Math.max(f0, f1)));
  if (l.total === 0) return [l.pts[0], l.pts[0]];
  const out: [number, number][] = [at(l, a)];
  const t0 = a * l.total, t1 = b * l.total;
  for (let i = 1; i < l.pts.length - 1; i++) if (l.cum[i] > t0 && l.cum[i] < t1) out.push(l.pts[i]);
  out.push(at(l, b));
  return out;
}

/* ------------------------------------------------------------------ helpers */

export const STATUS_LABEL: Record<SegStatus, string> = {
  not_started: "Not started", on_track: "On track", at_risk: "At risk", behind: "Behind", completed: "Completed", suspended: "Suspended",
};
export const STATUS_COLOR: Record<SegStatus, string> = {
  not_started: "#94A3B8", on_track: "#22C55E", at_risk: "#F59E0B", behind: "#EF4444", completed: "#8B5CF6", suspended: "#64748B",
};
export const RESP_LABEL: Record<string, string> = {
  none: "No delay", subcontractor: "Subcontractor", company: "Company", client: "Client", authority: "Authority", weather: "Weather", utility_clash: "Utility clash", other: "Other",
};
export const RESP_COLOR: Record<string, string> = {
  none: "#22C55E", subcontractor: "#EF4444", company: "#F97316", client: "#A855F7", authority: "#2563EB", weather: "#06B6D4", utility_clash: "#F59E0B", other: "#64748B",
};
export const SUB_PALETTE = ["#635BFF", "#2563EB", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#A855F7", "#EC4899", "#14B8A6", "#84CC16", "#F97316", "#64748B"];
export const SELF_COLOR = "#94A3B8";

export const ragFrom = (spi: number | null, cpi: number | null): Rag => {
  if (spi === null && cpi === null) return "grey";
  const w = Math.min(spi ?? 1, cpi ?? 1);
  return w >= 0.95 ? "green" : w >= 0.85 ? "amber" : "red";
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Cumulative % at `date` from step history (0 before the first report). */
export function pctAt(h: HistPt[], date: string): number {
  let v = 0;
  for (const p of h) { if (p.d <= date) v = p.pct; else break; }
  return v;
}
function lastPointOnOrBefore(h: HistPt[], date: string): HistPt | null {
  let r: HistPt | null = null;
  for (const p of h) { if (p.d <= date) r = p; else break; }
  return r;
}
export function plannedPctFor(start: string | null, end: string | null, date: string): number {
  if (!start || !end) return 0;
  if (date <= start) return 0;
  if (date >= end) return 100;
  const total = daysBetween(start, end);
  return total <= 0 ? 100 : (daysBetween(start, date) / total) * 100;
}

const maxIso = (a: string, b: string) => (a >= b ? a : b);

/* ------------------------------------------------------------------ segment maths */

/**
 * Derived state of one segment at `asOf`. `today` splits history from forecast: for asOf > today the work front is extrapolated
 * (recent rate, or planned pace for crews that have not started) and `forecast` is true.
 */
export function computeSegment(seg: OpsSegment, asOf: string, today: string, issues: OpsIssue[] = []): SegDerived {
  const e = asOf < today ? asOf : today; // evidence date
  const forecast = asOf > today;
  const h = seg.history;
  const pS = seg.plannedStart, pE = seg.plannedEnd;
  const planDays = pS && pE ? Math.max(1, daysBetween(pS, pE)) : 1;
  const base = pctAt(h, e);
  const completedNow = base >= 99.5;
  const lastPt = lastPointOnOrBefore(h, e);
  const first = h.length ? h[0].d : null;

  // recent weekly rate over the last 4 weeks, fallback overall since first report / planned start
  let rate = (base - pctAt(h, addDays(e, -28))) / 4;
  if (rate <= 0.0001 && base > 0) {
    const from = first ?? pS ?? e;
    const weeks = Math.max(1, daysBetween(from, e)) / 7;
    rate = base / weeks;
  }
  if (rate < 0) rate = 0;

  // actual % at asOf
  let actual = base;
  if (forecast && !completedNow) {
    if (rate > 0) actual = base + (rate * daysBetween(e, asOf)) / 7;
    else if (base === 0 && pS && pE) {
      const from = maxIso(e, pS);
      actual = asOf > from ? (100 / (planDays / 7)) * (daysBetween(from, asOf) / 7) : 0;
    }
    actual = clamp(actual, 0, 100);
  }
  if (completedNow) actual = 100;

  const planned = plannedPctFor(pS, pE, asOf);
  const spi = planned > 0 ? actual / planned : null;

  // projected end (evidence-based, as of e)
  let projectedEnd: string;
  let endedOn: string | null = null;
  if (completedNow) {
    const done = h.find((p) => p.pct >= 99.5) ?? lastPt;
    endedOn = done ? done.d : pE;
    projectedEnd = endedOn ?? e;
  } else if (rate > 0) {
    projectedEnd = addDays(e, Math.min(1500, Math.ceil(((100 - base) / rate) * 7)));
  } else if (pE) {
    const lagDays = Math.max(0, ((plannedPctFor(pS, pE, e) - base) / 100) * planDays);
    projectedEnd = addDays(pE, Math.round(lagDays));
  } else projectedEnd = e;
  const slipDays = pE ? daysBetween(pE, projectedEnd) : 0;

  const lastReport = lastPt ? lastPt.d : null;
  const staleDays = lastReport ? daysBetween(lastReport, e) : null;

  const rem = 100 - actual;
  const weeksLeft = pE ? daysBetween(asOf, pE) / 7 : 0;
  const overdue = !!pE && weeksLeft <= 0 && rem > 0.5;
  const reqPctWk = rem <= 0 ? 0 : overdue ? rem : rem / Math.max(0.5, weeksLeft);

  // status
  let status: SegStatus;
  if (actual >= 99.5) status = "completed";
  else if (seg.assignmentStatus === "suspended") status = "suspended";
  else if (actual <= 0 && (!pS || pS > asOf)) status = "not_started";
  else {
    const s = spi ?? 1;
    if (s < 0.85 || slipDays > 14) status = "behind";
    else if (s < 0.95 || slipDays > 0 || (staleDays !== null && staleDays > 10)) status = "at_risk";
    else status = "on_track";
  }

  // manpower: weekly average headcount over the last 4 weeks (oldest -> newest)
  const manpower: number[] = [];
  for (let i = 3; i >= 0; i--) {
    const hi = addDays(e, -7 * i), lo = addDays(e, -7 * (i + 1));
    const pts = h.filter((p) => p.d > lo && p.d <= hi && p.mp > 0);
    manpower.push(pts.length ? Math.round(pts.reduce((a, p) => a + p.mp, 0) / pts.length) : 0);
  }

  // delay by responsibility up to asOf (reports + attached issues)
  const delayByResp: Record<string, number> = {};
  for (const ev of seg.delays) if (ev.d <= asOf && ev.days > 0) delayByResp[ev.resp] = (delayByResp[ev.resp] ?? 0) + ev.days;
  const openIssues = issues.filter((i) => i.raisedOn && i.raisedOn <= asOf && i.status !== "closed" && (!i.resolvedOn || i.resolvedOn > asOf));
  let dominant: Resp = "none", best = 0;
  for (const [r, d] of Object.entries(delayByResp)) if (d > best) { best = d; dominant = r as Resp; }

  const earned = seg.contractValue * (actual / 100);
  const cpi = seg.invoices.certified > 0 ? earned / seg.invoices.certified : null;

  const active = !forecast && staleDays !== null && staleDays <= 7 && actual < 99.5 && status !== "suspended";
  return {
    actualPct: actual, basePct: base, plannedPct: planned, spi, status, projectedEnd, slipDays, lastReport, staleDays, ratePctWk: rate, reqPctWk, overdue,
    manpower, openIssues, delayByResp, dominantCause: dominant, cpi, active, forecast, startedOn: first, endedOn, earned,
  };
}

/* ------------------------------------------------------------------ project / portfolio maths */

export function computeAll(data: OpsMapData, asOf: string): Derived {
  const today = data.today;
  const byKey = new Map<string, OpsIssue[]>();
  for (const i of data.issues) for (const k of i.segKeys) { const a = byKey.get(k) ?? []; a.push(i); byKey.set(k, a); }
  const seg = new Map<string, SegDerived>();
  for (const s of data.segments) seg.set(s.key, computeSegment(s, asOf, today, byKey.get(s.key) ?? []));
  const proj = new Map<number, ProjectDerived>();
  for (const p of data.projects) proj.set(p.id, computeProject(p, data.segments.filter((s) => s.projectId === p.id), seg, asOf, today, data.issues));
  return { asOf, forecast: asOf > today, seg, proj };
}

export function computeProject(
  p: OpsProject, segs: OpsSegment[], seg: Map<string, SegDerived>, asOf: string, today: string, issues: OpsIssue[],
): ProjectDerived {
  let a = 0, pl = 0, wsum = 0, completedQty = 0, behindQty = 0, behindKm = 0, doneKm = 0, proj: string | null = null;
  const counts: Record<SegStatus, number> = { not_started: 0, on_track: 0, at_risk: 0, behind: 0, completed: 0, suspended: 0 };
  for (const s of segs) {
    const d = seg.get(s.key);
    if (!d) continue;
    a += s.weight * d.actualPct; pl += s.weight * d.plannedPct; wsum += s.weight;
    completedQty += (s.planQty * d.actualPct) / 100;
    behindQty += (s.planQty * Math.max(0, d.plannedPct - d.actualPct)) / 100;
    if (s.kind === "line") { doneKm += (s.lengthKm * d.actualPct) / 100; behindKm += (s.lengthKm * Math.max(0, d.plannedPct - d.actualPct)) / 100; }
    counts[d.status]++;
    if (!proj || d.projectedEnd > proj) proj = d.projectedEnd;
  }
  if (wsum > 0 && Math.abs(wsum - 1) > 1e-6) { a /= wsum; pl /= wsum; }
  const e = asOf < today ? asOf : today;
  if (asOf >= today && p.forecastFinish && (!proj || p.forecastFinish > proj)) proj = p.forecastFinish;
  const bac = p.bac;
  const evBac = bac * (a / 100), pv = bac * (pl / 100);
  let ac = 0;
  for (const c of p.acHistory) if (c.d <= e) ac = c.cum;
  if (asOf > today) ac = p.ac;
  const spi = pv > 0 ? evBac / pv : null;
  const cpi = ac > 0 ? evBac / ac : null;
  const delayDays = p.endDate && proj ? Math.max(0, daysBetween(p.endDate, proj)) : 0;
  const openIssues = issues.filter((i) => i.projectId === p.id && i.status !== "closed" && i.raisedOn && i.raisedOn <= asOf && (!i.resolvedOn || i.resolvedOn > asOf)).length;
  return { actualPct: a, plannedPct: pl, spi, cpi, rag: bac === 0 && !segs.length ? "grey" : ragFrom(spi, cpi), projectedFinish: proj, delayDays, ev: evBac, pv, ac, completedQty, behindQty, openIssues, behindKm, doneKm, counts };
}

export function computeKpis(projects: OpsProject[], segs: OpsSegment[], d: Derived): Kpis {
  const ids = new Set(projects.map((p) => p.id));
  let totalKm = 0, doneKm = 0, behindKm = 0, atRisk = 0, behind = 0, n = 0, pvs = 0, evs = 0, acs = 0, worst = 0;
  let worstProject: string | null = null;
  for (const s of segs) {
    if (!ids.has(s.projectId)) continue;
    const x = d.seg.get(s.key)!;
    n++;
    if (x.status === "at_risk") atRisk++;
    if (x.status === "behind") behind++;
    if (s.kind === "line") {
      totalKm += s.lengthKm; doneKm += (s.lengthKm * x.actualPct) / 100; behindKm += (s.lengthKm * Math.max(0, x.plannedPct - x.actualPct)) / 100;
    }
  }
  let active = 0;
  for (const p of projects) {
    const pd = d.proj.get(p.id)!;
    if (!p.startDate || p.startDate <= d.asOf) active++;
    pvs += pd.pv; evs += pd.ev; acs += pd.ac;
    if (pd.delayDays > worst) { worst = pd.delayDays; worstProject = p.code; }
  }
  return { activeProjects: active, totalKm, doneKm, behindKm, atRisk, behind, segments: n, spi: pvs > 0 ? evs / pvs : null, cpi: acs > 0 ? evs / acs : null, worstSlip: worst, worstProject };
}

/** Delay attribution (parties) across the given projects at `asOf`. */
export function computeParties(data: OpsMapData, projectIds: Set<number>, asOf: string): Party[] {
  const m = new Map<string, Party>();
  const subName = new Map(data.subs.map((s) => [s.id, s.name]));
  const add = (resp: Resp, subId: number | null, days: number, cost: number, segKeys: string[]) => {
    if (days <= 0 && cost <= 0) return;
    const r: Resp = resp === "none" ? "other" : resp;
    const isSub = r === "subcontractor" && subId !== null;
    const key = isSub ? `sub:${subId}` : `resp:${r}`;
    const x = m.get(key) ?? { key, label: isSub ? (subName.get(subId!) ?? `Sub #${subId}`) : RESP_LABEL[r], kind: isSub ? "sub" : "resp", resp: r, subId: isSub ? subId : null, days: 0, cost: 0, count: 0, segKeys: [] };
    x.days += days; x.cost += cost; x.count++;
    for (const k of segKeys) if (!x.segKeys.includes(k)) x.segKeys.push(k);
    m.set(key, x);
  };
  for (const s of data.segments) {
    if (!projectIds.has(s.projectId)) continue;
    for (const ev of s.delays) if (ev.src === "report" && ev.d <= asOf) add(ev.resp, s.sub?.id ?? null, ev.days, 0, [s.key]);
  }
  for (const i of data.issues) {
    if (!projectIds.has(i.projectId) || !i.raisedOn || i.raisedOn > asOf) continue;
    add(i.resp, i.subId, i.impactDays, i.impactCost, i.segKeys);
  }
  return [...m.values()].sort((a, b) => b.days - a.days || b.cost - a.cost);
}

/* ------------------------------------------------------------------ colouring */

export function stalenessColor(d: number | null): string {
  if (d === null) return "#94A3B8";
  return d <= 3 ? "#22C55E" : d <= 7 ? "#84CC16" : d <= 14 ? "#F59E0B" : "#EF4444";
}
export function costColor(cpi: number | null): string {
  if (cpi === null) return "#94A3B8";
  return cpi >= 0.98 ? "#22C55E" : cpi >= 0.9 ? "#F59E0B" : "#EF4444";
}
