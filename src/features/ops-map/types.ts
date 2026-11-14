// Shared payload + derived types for the Live Ops Map (MAP_SPEC §2). Pure types: safe for client and server.

export type Resp = "none" | "subcontractor" | "company" | "client" | "authority" | "weather" | "utility_clash" | "other";
export type SegStatus = "not_started" | "on_track" | "at_risk" | "behind" | "completed" | "suspended";
export type Rag = "green" | "amber" | "red" | "grey";
export type ColorMode = "health" | "sub" | "cause" | "cost" | "stale";

/** One verified progress point (cumulative). */
export interface HistPt { d: string; pct: number; qty: number; mp: number }
export interface DelayEvent { d: string; days: number; resp: Resp; cost: number; src: "report" | "issue"; issueId?: number; title?: string }

export interface OpsIssue {
  id: number; projectId: number; stageId: number | null; assignmentId: number | null;
  title: string; resp: Resp; impactDays: number; impactCost: number; status: string;
  raisedOn: string | null; resolvedOn: string | null;
  lat: number; lng: number;
  /** segments this issue is attached to (assignment segment, or every segment of the stage) */
  segKeys: string[];
  subId: number | null;
}

export interface OpsSegment {
  key: string;
  assignmentId: number | null;
  projectId: number;
  stageId: number;
  stageCode: string | null;
  stageName: string;
  chainFrom: number | null;
  chainTo: number | null;
  sub: { id: number; name: string; rating: number | null; trade: string | null } | null;
  scope: string | null;
  assignmentStatus: string | null;
  contractValue: number;
  /** assignment quantity (null = lump sum) */
  qty: number | null;
  unit: string;
  /** this segment's share of the stage planned quantity (for aggregates) */
  planQty: number;
  kind: "line" | "polygon";
  /** line: [lng,lat][] ; polygon: rings of [lng,lat][] */
  coords: number[][];
  rings: number[][][] | null;
  lengthKm: number;
  bbox: [number, number, number, number];
  mid: [number, number];
  plannedStart: string | null;
  plannedEnd: string | null;
  /** share of the project's overall progress (sums to 1 per project) */
  weight: number;
  /** slice index inside a shared stage */
  shared: { index: number; count: number } | null;
  history: HistPt[];
  delays: DelayEvent[];
  invoices: { claimed: number; certified: number; paid: number };
  /** subcontractor portal token (only when the viewer may see portal links) */
  portalToken: string | null;
}

export interface OpsProject {
  id: number; code: string; name: string; client: string | null; category: string | null; status: string;
  parentId: number | null; region: string | null;
  bbox: [number, number, number, number];
  contractValue: number; bac: number; ac: number;
  startDate: string | null; endDate: string | null;
  totalQty: number | null; unit: string | null;
  lengthKm: number;
  forecastFinish: string | null;
  acHistory: { d: string; cum: number }[];
  managerName: string | null;
}

export interface OpsMapData {
  today: string;
  projects: OpsProject[];
  segments: OpsSegment[];
  issues: OpsIssue[];
  subs: { id: number; name: string }[];
  categories: string[];
}

/** Everything the UI needs about one segment at a given date. */
export interface SegDerived {
  actualPct: number;
  /** evidence-based % (equals actualPct unless forecasting) */
  basePct: number;
  plannedPct: number;
  spi: number | null;
  status: SegStatus;
  projectedEnd: string;
  slipDays: number;
  lastReport: string | null;
  staleDays: number | null;
  /** pct points per week */
  ratePctWk: number;
  reqPctWk: number;
  overdue: boolean;
  manpower: number[];
  openIssues: OpsIssue[];
  delayByResp: Record<string, number>;
  dominantCause: Resp;
  cpi: number | null;
  active: boolean;
  forecast: boolean;
  startedOn: string | null;
  endedOn: string | null;
  /** on-the-ground earned value */
  earned: number;
}

export interface ProjectDerived {
  actualPct: number; plannedPct: number; spi: number | null; cpi: number | null; rag: Rag;
  projectedFinish: string | null; delayDays: number;
  ev: number; pv: number; ac: number;
  completedQty: number; behindQty: number;
  openIssues: number; behindKm: number; doneKm: number;
  counts: Record<SegStatus, number>;
}

export interface Party { key: string; label: string; kind: "sub" | "resp"; resp: Resp; subId: number | null; days: number; cost: number; count: number; segKeys: string[] }

export interface Kpis {
  activeProjects: number; totalKm: number; doneKm: number; behindKm: number;
  atRisk: number; behind: number; segments: number; spi: number | null; cpi: number | null; worstSlip: number; worstProject: string | null;
}

export interface Derived {
  asOf: string;
  forecast: boolean;
  seg: Map<string, SegDerived>;
  proj: Map<number, ProjectDerived>;
}
