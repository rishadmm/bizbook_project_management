// Region profile of the demo seed: every region-specific value (tenant, people, clients, geometry, money, texts) lives in a profile
// (uae.ts, oman.ts); the seed engine (seed.ts + seed-portal / seed-client-portal / seed-invoices / approvals/seed-demo) is region-neutral.
// Pure data + tiny builders; relative imports only (the seed runs under tsx).
export type Pt = [number, number]; // [lng, lat]
export type ProjKey = "P1" | "P2" | "P3" | "P4" | "P2A" | "P2B" | "P7" | "P8" | "P9" | "P10" | "P11" | "P12";
export type RegionCode = "uae" | "oman";

export interface TenantProfile {
  companyName: string; address: string; taxNo: string; currency: string;
  /** label of the tax registration number on invoices (TRN / VATIN) */ taxLabel: string;
  vatRate: number; country: string;
  /** internal admin login */ adminEmail: string; emailDomain: string;
  /** demo-link port */ port: number;
  /** extra settings rows written by the seed (empty for the legacy UAE dataset: its defaults stay implicit) */ extraSettings: Record<string, string>;
  /** multiplies the amount conditions of the default approval workflows (UAE 1) */ workflowScale: number;
  /** default subcontract retention % when an assignment does not set one */ retentionPct: number;
  /** decimals of budget unit costs and material prices (0 = whole currency units as in the AED dataset, 2 for OMR) */ priceDecimals: number;
}

export interface ClientDef { name: string; type: string; contact_person: string; email: string; phone: string; address: string; notes: string | null }

export interface TplItem { cat: string; desc: string; unit: string; uc: number; share: number }
export interface Tpl { items: TplItem[]; unit: string }

export type GeoDef =
  | { kind: "line"; from: Pt; to: Pt; n: number; amp: number; phase: number; sections: number; prefix: string }
  /** a sub-project re-using the head (first `head` km) or the tail (last `tail` km) of another project's route */
  | { kind: "slice"; of: ProjKey; head?: number; tail?: number; sections: number; prefix: string }
  /** x0,y0,dx,dy rectangle; "quad" = 2x2 zones, "strip" = vertical strips */
  | { kind: "poly"; x0: number; y0: number; dx: number; dy: number; zones: string[]; weights: number[]; split: "quad" | "strip" };

export interface RevCfg { status: string; mDelta: number; cFactor: number; reason: string; submitted: number | null; feedback?: string }
export const rev = (status: string, mDelta: number, cFactor: number, reason: string, submitted: number | null, feedback?: string): RevCfg => ({ status, mDelta, cFactor, reason, submitted, feedback });

export interface TenderDef {
  title: string; client: number; kind: string; category: string; location: string; scope: string; qty: number | null; unit: string | null;
  issue: number; clar: number; submit: number; cost: number; status: string; prob: number; revs: RevCfg[];
  /** won tenders: quantity + stage names come from the geometry of this project */ project?: ProjKey;
  decided?: number; submittedAt?: number; bond?: number;
  /** client's own reference (shown in the tender code suffix of the title block / scope) */ ref?: string;
}
export interface LossDef { idx: number; reason: string; secondary: string; winner: string; gap: number; score: number; fb: string; root: string; lessons: string; actions: string; status: string }

export interface SubDef {
  name: string; trade: string; cats: string; status: string; rating: number | null; checklist: number; docs: [string, number | null, string][];
  contact: string; address: string; notes: string | null;
}

export interface ProjectDef {
  key: ProjKey; code: string; name: string; tender: number | null; client: number; parent: ProjKey | null; category: string; region: string; location: string; start: number; end: number; status: string;
  /** 1-based index of the internal user managing the project */ manager: number; desc: string; budget?: number; contract?: number; cpi: number; /** CPI the manual costs are calibrated to (default `cpi`) */ cpiTarget?: number; tpl?: string;
}

export interface StallDef { from: number; to: number; resp: string; cause: string }
export const stall = (from: number, to: number, resp: string, cause: string): StallDef => ({ from, to, resp, cause });
export interface AsgDef {
  project: ProjKey; stageIdx: number; /** 1-based subcontractor index */ sub: number; kind: "primary" | "secondary" | "draft"; a0?: number; a1?: number; pct?: number; stalls?: StallDef[];
  cvFactor?: number; portal?: boolean; retention?: number; advance?: number; days?: number; scope: string; overclaim?: number; pendingLast?: number; crew?: number; status?: string;
  stageStatus?: string; rejectInvoice?: boolean; lumpsum?: boolean; ccType?: string[]; qtyShare?: number; cpi?: number; rejected?: number; tag?: string;
}
export interface IssueDef { p: ProjKey; stage: number | null; asg: string | null; title: string; desc: string; resp: string; days: number; cost: number; status: string; raised: number; resolved?: number }

export interface PortalIssueDef { sub: number; kind: "issue" | "rfi"; title: string; desc: string; category: string; resp: string; raised: number; status: "open" | "mitigating" | "closed"; awaiting: "internal" | "portal" | null; thread: [boolean, string, number][] }
export interface PortalUserDef { name: string; role: "owner" | "manager" | "site" | "accounts" | "viewer"; title: string; state?: "must_change" | "locked" | "disabled" }
export interface ClientUserDef { name: string; role: "admin" | "viewer"; title: string; state?: "must_change" | "disabled"; scopeCode?: string }
export interface ClientPortalDef { slug: string; users: ClientUserDef[]; showSubs?: boolean; showFin?: boolean; note: string }

export type CatalogItem = [desc: string, unit: string, price: number, share: number];

/** A fictional supplier of the registration seed (SUPPLIER_TENDERING_SPEC C1). `cats` are supplier_categories codes. */
export interface SupplierSeed { name: string; trade: string; cats: string[]; contact: string; address: string; legalForm: string; year: number; employees: number; turnover: string; regions: string[] }
/** Region content of the procurement seed phase (src/lib/seed-procurement.ts). */
export interface ProcurementProfile {
  /** additional internal user created by the phase with the procurement role (UAE: Rashid Al Mazrouei); the first region's slot-8 user already has the role */ reviewer?: { name: string; title: string; email: string };
  /** fictional names for signatory / finance / HSE contacts */ people: string[];
  /** client names quoted in the references (besides the profile's own clients) */ clients: string[];
  /** typical reference project names by trade group */ projects: Record<"telecom" | "civil" | "oilgas" | "other", string[]>;
  /** 8 more approved suppliers (they bid on tenders, mostly without winning) */ extra: SupplierSeed[];
  /** 8 suppliers of the registration pipeline in this order: draft, submitted, submitted, under review, referred back, resubmitted, rejected, approved this week */ pipeline: SupplierSeed[];
  /** reasons of the demo queries / rejection */ texts: { hseQuery: string; insuranceQuery: string; bankQuery: string; licenceQuery: string; experienceQuery: string; rejectReason: string };
}

export interface RegionProfile {
  code: RegionCode;
  /** the company's country operation (entities.code) this profile seeds */ entity: "AE" | "OM";
  /** 1-based slots of `userNames` that reuse the user of the same slot created by the first profile (shared internal staff); their name here is ""  */ sharedUserSlots: number[];
  /** job titles by 1-based user slot (default: the role name; slot 1 = "General Manager") */ jobTitles?: Record<number, string>;
  tenant: TenantProfile;
  /** the 12 internal users (id order; the first is the super admin, 11th = management approver, 12th = second finance user) */ userNames: string[];
  clients: ClientDef[];
  templates: Record<"road" | "cable" | "pipeline" | "civil", Tpl>;
  matPlan: Record<string, [string, string, number, number][]>;
  geometry: Partial<Record<ProjKey, GeoDef>>;
  tenders: TenderDef[];
  /** 'Standards' sentence of the technical specification of every tender */ standardsText: string;
  sectionText: Record<string, string>;
  loss: LossDef[];
  subs: SubDef[];
  subDoc: { label: Record<string, string>; fileLabel: (type: string) => string };
  subGen: {
    licenseNo: (i: number) => string; taxNo: (i: number) => string; bank: (i: number) => string; iban: (i: number) => string; phone: (i: number) => string; emailSuffix: string; addressSuffix: string;
    /** local part of the company e-mail domain (default: letters of the name, first 14) */ emailLocal?: (name: string) => string;
  };
  projects: ProjectDef[];
  assignments: AsgDef[];
  issues: IssueDef[];
  approvals: { awardNote: string; costRequests: { category: string; description: string; amount: number }[] };
  portal: { teams: Record<number, PortalUserDef[]>; phone: (subId: number, k: number) => string; issues: PortalIssueDef[]; bankChange: { bank_name: string; iban: string; reason: string }; contactChange: { phone: string; reason: string }; defaultDomain: string };
  clientPortal: { cfg: Record<number, ClientPortalDef>; phone: (clientId: number, k: number) => string; defaultDomain: string };
  invoices: { catalog: Record<string, CatalogItem[]>; erpError: string };
  procurement: ProcurementProfile;
  /** coverage-check expectations */
  expect: { clientSlugs: Record<string, string>; skipCoverage: string[]; bbox: [number, number, number, number] | null };
}
