// Client-safe Live Ops Map payload (CLIENT_PORTAL_SPEC section 1, "data hygiene"). PURE: shared by the server (which builds it) and the client (which hydrates it).
// The payload deliberately has NO cost keys at all (no budget / actual cost / CPI inputs / subcontract values / invoices / portal tokens / ratings); `hydrateClientMap`
// fills neutral defaults client-side so the unchanged Live Ops Map maths and components keep working (budget = a neutral weight of 100, cost = 0 => CPI "—").
import type { DelayEvent, HistPt, OpsIssue, OpsMapData, OpsProject, OpsSegment, Resp } from "@/features/ops-map/types";

export interface CSeg {
  key: string; assignmentId: number | null; projectId: number; stageId: number; stageCode: string | null; stageName: string; chainFrom: number | null; chainTo: number | null;
  sub: { id: number; name: string } | null; assignmentStatus: string | null; qty: number | null; unit: string; planQty: number; kind: "line" | "polygon";
  coords: number[][]; rings: number[][][] | null; lengthKm: number; bbox: [number, number, number, number]; mid: [number, number];
  plannedStart: string | null; plannedEnd: string | null; weight: number; shared: { index: number; count: number } | null; history: HistPt[];
  delays: { d: string; days: number; resp: Resp; src: "report" | "issue"; issueId?: number; title?: string }[];
}
export interface CProject {
  id: number; code: string; name: string; client: string | null; category: string | null; status: string; parentId: number | null; region: string | null;
  bbox: [number, number, number, number]; startDate: string | null; endDate: string | null; totalQty: number | null; unit: string | null; lengthKm: number;
  forecastFinish: string | null; managerName: string | null;
}
export interface CIssue {
  id: number; projectId: number; stageId: number | null; assignmentId: number | null; title: string; resp: Resp; impactDays: number; status: string;
  raisedOn: string | null; resolvedOn: string | null; lat: number; lng: number; segKeys: string[]; subId: number | null;
}
export interface ClientMapPayload {
  today: string; projects: CProject[]; segments: CSeg[]; issues: CIssue[]; subs: { id: number; name: string }[]; categories: string[];
  /** portal base path, e.g. /c/rta */
  base: string; showSubs: boolean; showFinancials: boolean;
}

/** Neutral budget weight used for every project so SPI / RAG work without exposing the real budget. */
export const NEUTRAL_BAC = 100;

export function hydrateClientMap(p: ClientMapPayload): OpsMapData {
  const projects: OpsProject[] = p.projects.map((x) => ({ ...x, contractValue: 0, bac: NEUTRAL_BAC, ac: 0, acHistory: [] }));
  const segments: OpsSegment[] = p.segments.map((s) => ({
    ...s, sub: s.sub ? { id: s.sub.id, name: s.sub.name, rating: null, trade: null } : null, scope: null, contractValue: 0, invoices: { claimed: 0, certified: 0, paid: 0 }, portalToken: null,
    delays: s.delays.map((d): DelayEvent => ({ ...d, cost: 0 })),
  }));
  const issues: OpsIssue[] = p.issues.map((i) => ({ ...i, impactCost: 0 }));
  return { today: p.today, projects, segments, issues, subs: p.subs, categories: p.categories };
}
