// Server side of the client portal map: builds the Live Ops Map data for the session's client ONLY and strips everything a client must not see BEFORE
// it is serialised to the browser (costs, CPI inputs, subcontract values, invoices, portal tokens, ratings, other clients' projects, internal RFIs).
import { cache } from "react";
import { getDb } from "@/lib/db";
import { visibleProjectIds, type ClientSession } from "@/lib/client-portal-auth";
import { getOpsMapData } from "@/features/ops-map/queries";
import type { OpsMapData } from "@/features/ops-map/types";
import { hydrateClientMap, type ClientMapPayload } from "./map-payload";

export interface ClientMapBundle { payload: ClientMapPayload; data: OpsMapData }

const crewLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

export const clientMapFor = cache((clientId: number, ids: string, showSubs: boolean, showFin: boolean, base: string): ClientMapBundle => {
  const projectIds = ids ? ids.split(",").map(Number) : [];
  const full = getOpsMapData({ projectIds: projectIds.length ? projectIds : [-1] });
  // defence in depth: re-check every project against the client id
  const own = new Set((getDb().prepare(`SELECT id FROM projects WHERE client_id = ? AND id IN (${projectIds.length ? projectIds.join(",") : "NULL"})`).all(clientId) as { id: number }[]).map((r) => r.id));
  const projects = full.projects.filter((p) => own.has(p.id));
  const segs = full.segments.filter((s) => own.has(s.projectId));
  const rfi = new Set((getDb().prepare("SELECT id FROM issues WHERE kind = 'rfi'").all() as { id: number }[]).map((r) => r.id));
  const issues = full.issues.filter((i) => own.has(i.projectId) && !rfi.has(i.id));
  // subcontractor identity: real names only when the client may see them, otherwise stable "Contractor crew A/B" labels with fake ids
  const subIds = [...new Set(segs.flatMap((s) => (s.sub ? [s.sub.id] : [])))].sort((a, b) => a - b);
  const subMap = new Map(subIds.map((id, i) => [id, { id: showSubs ? id : i + 1, name: showSubs ? (full.subs.find((x) => x.id === id)?.name ?? `Contractor ${i + 1}`) : `Contractor crew ${crewLetter(i)}` }]));
  const parentOk = new Set(projects.map((p) => p.id));
  const payload: ClientMapPayload = {
    today: full.today, base, showSubs, showFinancials: showFin, categories: [...new Set(projects.map((p) => p.category).filter((c): c is string => !!c))].sort(),
    subs: [...subMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    projects: projects.map((p) => ({
      id: p.id, code: p.code, name: p.name, client: p.client, category: p.category, status: p.status, parentId: p.parentId && parentOk.has(p.parentId) ? p.parentId : null, region: p.region,
      bbox: p.bbox, startDate: p.startDate, endDate: p.endDate, totalQty: p.totalQty, unit: p.unit, lengthKm: p.lengthKm, forecastFinish: p.forecastFinish, managerName: p.managerName,
    })),
    segments: segs.map((s) => ({
      key: s.key, assignmentId: s.assignmentId, projectId: s.projectId, stageId: s.stageId, stageCode: s.stageCode, stageName: s.stageName, chainFrom: s.chainFrom, chainTo: s.chainTo,
      sub: s.sub ? (subMap.get(s.sub.id) ?? null) : null, assignmentStatus: s.assignmentStatus, qty: s.qty, unit: s.unit, planQty: s.planQty, kind: s.kind, coords: s.coords, rings: s.rings,
      lengthKm: s.lengthKm, bbox: s.bbox, mid: s.mid, plannedStart: s.plannedStart, plannedEnd: s.plannedEnd, weight: s.weight, shared: s.shared, history: s.history,
      delays: s.delays.map((d) => ({ d: d.d, days: d.days, resp: d.resp, src: d.src, ...(d.issueId !== undefined ? { issueId: d.issueId } : {}), ...(d.title !== undefined ? { title: d.title } : {}) }))
        .filter((d) => d.issueId === undefined || !rfi.has(d.issueId)),
    })),
    issues: issues.map((i) => ({
      id: i.id, projectId: i.projectId, stageId: i.stageId, assignmentId: i.assignmentId, title: i.title, resp: i.resp, impactDays: i.impactDays, status: i.status, raisedOn: i.raisedOn,
      resolvedOn: i.resolvedOn, lat: i.lat, lng: i.lng, segKeys: i.segKeys, subId: i.subId !== null ? (subMap.get(i.subId)?.id ?? null) : null,
    })),
  };
  return { payload, data: hydrateClientMap(payload) };
});

/** Client-safe map bundle for this session: `payload` goes to the browser, `data` (hydrated) feeds server-side calculations. */
export function getClientMap(s: ClientSession): ClientMapBundle {
  const ids = visibleProjectIds(s);
  return clientMapFor(s.client.id, ids.join(","), !!s.client.portal_show_subcontractors, !!s.client.portal_show_financials, `/c/${s.client.portal_slug}`);
}
