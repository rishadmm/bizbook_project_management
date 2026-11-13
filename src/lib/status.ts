// Single source for every status/enum: label + Tailwind badge classes. Use via the helpers at the bottom.
export type Tone = "slate" | "blue" | "indigo" | "violet" | "amber" | "orange" | "emerald" | "green" | "red" | "rose" | "cyan" | "teal";

export const TONE_CLASSES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  green: "bg-green-50 text-green-700 ring-green-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  cyan: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
};

/** Solid hex colours per tone (maps, charts). */
export const TONE_HEX: Record<Tone, string> = {
  slate: "#64748b", blue: "#2563eb", indigo: "#4f46e5", violet: "#7c3aed", amber: "#d97706", orange: "#ea580c",
  emerald: "#059669", green: "#16a34a", red: "#dc2626", rose: "#e11d48", cyan: "#0891b2", teal: "#0d9488",
};

export interface EnumDef { label: string; tone: Tone }
type EnumMap = Record<string, EnumDef>;
const e = (label: string, tone: Tone): EnumDef => ({ label, tone });

export const ENUMS = {
  role: {
    super_admin: e("Super admin", "violet"), admin: e("Admin", "violet"), management: e("Management", "indigo"), project_manager: e("Project manager", "blue"),
    procurement: e("Procurement", "orange"), manager: e("Manager", "blue"), engineer: e("Engineer", "cyan"), estimator: e("Estimator", "indigo"),
    finance: e("Finance", "emerald"), hr: e("HR", "orange"), viewer: e("Viewer", "slate"),
  },
  clientType: {
    government: e("Government", "blue"), road_authority: e("Road authority", "indigo"), telecom: e("Telecom", "violet"),
    utility: e("Utility", "cyan"), private: e("Private", "slate"), other: e("Other", "slate"),
  },
  tenderKind: { tender: e("Tender", "blue"), proposal: e("Proposal", "violet"), rfq: e("RFQ", "cyan"), eoi: e("EOI", "slate") },
  category: {
    road: e("Road", "slate"), cable: e("Cable", "violet"), pipeline: e("Pipeline", "cyan"), telecom: e("Telecom", "indigo"),
    civil: e("Civil", "orange"), other: e("Other", "slate"),
  },
  quantityUnit: { km: e("km", "slate"), m: e("m", "slate"), sqm: e("sqm", "slate"), nos: e("nos", "slate"), lumpsum: e("lump sum", "slate") },
  tenderStatus: {
    draft: e("Draft", "slate"), in_preparation: e("In preparation", "blue"), under_review: e("Under review", "amber"),
    approved: e("Approved", "teal"), submitted: e("Submitted", "indigo"), negotiation: e("Negotiation", "violet"),
    won: e("Won", "green"), lost: e("Lost", "red"), cancelled: e("Cancelled", "slate"), no_bid: e("No bid", "slate"),
  },
  sectionStatus: { not_started: e("Not started", "slate"), in_progress: e("In progress", "blue"), completed: e("Completed", "green") },
  revisionStatus: { draft: e("Draft", "slate"), submitted: e("Submitted", "indigo"), superseded: e("Superseded", "amber"), final: e("Final", "green") },
  budgetCategory: {
    manpower: e("Manpower", "blue"), material: e("Material", "emerald"), equipment: e("Equipment", "orange"), services: e("Services", "cyan"),
    subcontract: e("Subcontract", "violet"), overhead: e("Overhead", "slate"), contingency: e("Contingency", "rose"),
  },
  reviewDecision: {
    pending: e("Pending", "amber"), approved: e("Approved", "green"), changes_requested: e("Changes requested", "orange"), rejected: e("Rejected", "red"),
  },
  negotiationChannel: { meeting: e("Meeting", "blue"), email: e("Email", "slate"), call: e("Call", "cyan"), letter: e("Letter", "indigo"), site_visit: e("Site visit", "teal") },
  lossReason: {
    price: e("Price", "red"), technical: e("Technical", "orange"), timeline: e("Timeline", "amber"), experience: e("Experience", "violet"),
    compliance: e("Compliance", "indigo"), relationship: e("Relationship", "cyan"), scope: e("Scope", "teal"), other: e("Other", "slate"),
  },
  lossStatus: { open: e("Open", "amber"), in_review: e("In review", "blue"), closed: e("Closed", "green") },
  projectStatus: {
    planning: e("Planning", "slate"), mobilizing: e("Mobilizing", "cyan"), active: e("Active", "green"),
    on_hold: e("On hold", "amber"), completed: e("Completed", "blue"), closed: e("Closed", "slate"),
  },
  stageStatus: {
    not_started: e("Not started", "slate"), in_progress: e("In progress", "blue"), delayed: e("Delayed", "red"),
    on_hold: e("On hold", "amber"), completed: e("Completed", "green"),
  },
  subcontractorStatus: {
    prospect: e("Prospect", "slate"), onboarding: e("Onboarding", "blue"), approved: e("Approved", "green"),
    suspended: e("Suspended", "amber"), blacklisted: e("Blacklisted", "red"),
  },
  docType: {
    trade_license: e("Trade license", "blue"), tax_certificate: e("Tax certificate", "indigo"), insurance: e("Insurance", "teal"),
    hse_certificate: e("HSE certificate", "emerald"), bank_letter: e("Bank letter", "slate"), company_profile: e("Company profile", "slate"),
    iso: e("ISO", "violet"), other: e("Other", "slate"),
  },
  docStatus: { pending: e("Pending", "amber"), verified: e("Verified", "green"), expired: e("Expired", "red"), rejected: e("Rejected", "rose") },
  assignmentStatus: {
    draft: e("Draft", "slate"), active: e("Active", "green"), suspended: e("Suspended", "amber"),
    completed: e("Completed", "blue"), terminated: e("Terminated", "red"),
  },
  responsibility: {
    none: e("None", "slate"), subcontractor: e("Subcontractor", "red"), company: e("Company", "orange"), client: e("Client", "violet"),
    authority: e("Authority", "indigo"), weather: e("Weather", "cyan"), utility_clash: e("Utility clash", "amber"), other: e("Other", "slate"),
  },
  progressSource: { internal: e("Internal", "slate"), portal: e("Portal", "violet") },
  progressStatus: { submitted: e("Submitted", "amber"), verified: e("Verified", "green"), rejected: e("Rejected", "red") },
  invoiceStatus: {
    submitted: e("Submitted", "amber"), under_review: e("Under review", "blue"), certified: e("Certified", "indigo"),
    approved: e("Approved", "teal"), paid: e("Paid", "green"), rejected: e("Rejected", "red"),
  },
  certType: { partial: e("Partial", "blue"), substantial: e("Substantial", "indigo"), final: e("Final", "green"), taking_over: e("Taking over", "teal") },
  certStatus: { draft: e("Draft", "slate"), requested: e("Requested", "amber"), issued: e("Issued", "green"), rejected: e("Rejected", "red") },
  issueStatus: { open: e("Open", "red"), mitigating: e("Mitigating", "amber"), closed: e("Closed", "green") },
  rag: { green: e("On track", "green"), amber: e("At risk", "amber"), red: e("Critical", "red"), grey: e("No data", "slate") },
} satisfies Record<string, EnumMap>;

export type EnumKind = keyof typeof ENUMS;

/** Ordered tender pipeline (kanban columns). */
export const TENDER_PIPELINE = ["draft", "in_preparation", "under_review", "approved", "submitted", "negotiation", "won", "lost"] as const;
export const OPEN_TENDER_STATUSES = ["draft", "in_preparation", "under_review", "approved", "submitted", "negotiation"] as const;

/** Departments whose review is required when sending a tender for review. */
export const REVIEW_DEPARTMENTS = ["Technical", "Finance", "Operations", "Management"] as const;
/** Default tender sections created with a tender: [department, title]. */
export const DEFAULT_TENDER_SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["Technical", "Technical spec & method statement"],
  ["Operations", "Execution plan & equipment"],
  ["HR", "Manpower plan"],
  ["Procurement", "Material sourcing"],
  ["Finance", "Cost & cash-flow"],
  ["HSE", "HSE plan"],
  ["Commercial", "Pricing & terms"],
];
export const DEFAULT_ONBOARDING_ITEMS = [
  "Registration form", "Trade license verified", "Insurance verified", "HSE pre-qualification", "Bank details verified", "Framework agreement signed",
] as const;
export const DEPARTMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Technical", "TECH"], ["Commercial", "COM"], ["Finance", "FIN"], ["Operations", "OPS"],
  ["HR", "HR"], ["Procurement", "PRO"], ["HSE", "HSE"], ["Management", "MGT"],
];

/** Attachment categories per entity type (suggestions for AttachmentsPanel). */
export const ATTACHMENT_CATEGORIES: Record<string, string[]> = {
  tender: ["RFP", "Drawings", "Technical", "Commercial", "Submission", "Correspondence", "Bid bond"],
  project: ["Contract", "Drawings", "Reports", "Permits", "Correspondence", "Photos", "Other"],
  stage: ["Drawings", "Photos", "Reports", "Other"],
  subcontractor: ["Registration", "Trade license", "Insurance", "HSE", "Bank", "Agreement", "Other"],
  assignment: ["Contract", "Variation", "Correspondence", "Other"],
  progress: ["Photos", "Report", "Other"],
  invoice: ["Invoice", "Backup", "Other"],
  certificate: ["Certificate", "Backup", "Other"],
  loss: ["Feedback", "Competitor info", "Other"],
  revision: ["Submission", "Other"],
};

export function enumDef(kind: EnumKind, value: string | null | undefined): EnumDef {
  const map = ENUMS[kind] as EnumMap;
  if (value && map[value]) return map[value];
  return { label: value ? value.replace(/_/g, " ") : "—", tone: "slate" };
}
/** Human label for an enum value. */
export const statusLabel = (kind: EnumKind, value: string | null | undefined): string => enumDef(kind, value).label;
/** Tailwind classes (bg/text/ring) for a badge. */
export const statusBadgeClass = (kind: EnumKind, value: string | null | undefined): string => TONE_CLASSES[enumDef(kind, value).tone];
export const statusTone = (kind: EnumKind, value: string | null | undefined): Tone => enumDef(kind, value).tone;
/** Hex colour (maps/charts). */
export const statusHex = (kind: EnumKind, value: string | null | undefined): string => TONE_HEX[enumDef(kind, value).tone];
/** `[{value,label}]` for <Select> options. */
export function statusOptions(kind: EnumKind): { value: string; label: string }[] {
  return Object.entries(ENUMS[kind] as EnumMap).map(([value, d]) => ({ value, label: d.label }));
}
export const RAG_HEX = { green: "#16a34a", amber: "#d97706", red: "#dc2626", grey: "#94a3b8" } as const;
