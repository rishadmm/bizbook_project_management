// Supplier registration + prequalification: pure constants and validators (SUPPLIER_TENDERING_SPEC Part A). No node/next imports: safe in client components.
import type { Tone } from "./status";

export type RegistrationStatus = "draft" | "submitted" | "under_review" | "referred_back" | "approved" | "rejected";
export const REGISTRATION_STATUSES: Record<RegistrationStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  submitted: { label: "Submitted", tone: "blue" },
  under_review: { label: "Under review", tone: "violet" },
  referred_back: { label: "Referred back", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};
export const isRegistrationStatus = (s: string): s is RegistrationStatus => s in REGISTRATION_STATUSES;
/** The supplier may edit its registration while the status is one of these. */
export const EDITABLE_STATUSES: RegistrationStatus[] = ["draft", "referred_back"];

/** Wizard steps (the review step is the last). Step 1 (account) is the public form. */
export const WIZARD_STEPS = [
  { n: 1, key: "account", label: "Account" },
  { n: 2, key: "company", label: "Company" },
  { n: 3, key: "categories", label: "Categories & regions" },
  { n: 4, key: "contacts", label: "Contacts & bank" },
  { n: 5, key: "hse", label: "HSE & quality" },
  { n: 6, key: "experience", label: "Experience" },
  { n: 7, key: "documents", label: "Documents" },
  { n: 8, key: "review", label: "Review & declare" },
] as const;

/** Reviewable sections (per-section Accept / Query) and the wizard step that edits each. */
export const REVIEW_SECTIONS = [
  { key: "company", label: "Company details", step: 2 },
  { key: "categories", label: "Categories & regions", step: 3 },
  { key: "contacts", label: "Contacts & bank", step: 4 },
  { key: "hse", label: "HSE & quality", step: 5 },
  { key: "experience", label: "Experience", step: 6 },
] as const;
export type SectionKey = (typeof REVIEW_SECTIONS)[number]["key"];
export const sectionLabel = (k: string) => REVIEW_SECTIONS.find((s) => s.key === k)?.label ?? k;
export const sectionStep = (k: string) => REVIEW_SECTIONS.find((s) => s.key === k)?.step ?? 8;

export const LEGAL_FORMS = ["LLC", "Sole proprietorship", "Free zone company (FZE / FZCO)", "SAOC", "SAOG", "Partnership", "Branch of a foreign company", "Other"];
export const TURNOVER_BANDS = ["Under 1 million", "1 - 5 million", "5 - 25 million", "25 - 100 million", "Over 100 million"];
export const CONTACT_ROLES = ["primary", "signatory", "finance", "hse"] as const;
export const GRADES = [
  { value: "A", label: "A - Strong (large / critical packages)" },
  { value: "B", label: "B - Good (standard packages)" },
  { value: "C", label: "C - Conditional (small packages, close supervision)" },
];

/** Documents expiring within this many days get a warning chip. */
export const EXPIRY_WARNING_DAYS = 30;
/** Review SLA chip thresholds (days waiting since submission). */
export const SLA_AMBER_DAYS = 5;
export const SLA_RED_DAYS = 10;
export const slaTone = (days: number): "green" | "amber" | "red" => (days > SLA_RED_DAYS ? "red" : days > SLA_AMBER_DAYS ? "amber" : "green");

/** IBAN length per country (both countries: 23 characters). */
export const IBAN_LENGTH: Record<string, number> = { AE: 23, OM: 23 };

/** Returns an error message, or null when the IBAN has the country format (AE / OM: 2 letters country code, 2 check digits, 19 alphanumerics = 23). */
export function ibanError(iban: string, countryCode: string): string | null {
  const v = iban.replace(/\s+/g, "").toUpperCase();
  const want = IBAN_LENGTH[countryCode] ?? 23;
  if (!v) return "IBAN is required.";
  if (!/^[A-Z0-9]+$/.test(v)) return "IBAN may only contain letters and digits.";
  if (!v.startsWith(countryCode)) return `A ${countryCode === "AE" ? "UAE" : "Omani"} IBAN starts with ${countryCode}.`;
  if (v.length !== want) return `A ${countryCode === "AE" ? "UAE" : "Omani"} IBAN has ${want} characters (yours has ${v.length}).`;
  if (!/^[A-Z]{2}\d{2}/.test(v)) return "IBAN check digits (characters 3-4) must be numbers.";
  return null;
}
export const normalizeIban = (iban: string) => iban.replace(/\s+/g, "").toUpperCase();
export function swiftError(swift: string): string | null {
  const v = swift.replace(/\s+/g, "").toUpperCase();
  if (!v) return "SWIFT / BIC is required.";
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v) ? null : "SWIFT / BIC has 8 or 11 characters (e.g. EBILAEAD).";
}
export function emailError(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? null : "Enter a valid email address.";
}

/** Document type of the legacy `subcontractor_documents.doc_type` enum that a registration document code maps to. */
export const LEGACY_DOC_TYPE: Record<string, string> = {
  trade_licence: "trade_license", cr: "registration", vat_certificate: "tax_certificate", chamber: "chamber", occi: "chamber", bank_letter: "bank_letter",
  insurance_wc: "insurance", insurance_tpl: "insurance", insurance_car: "insurance", company_profile: "company_profile", iso_certs: "iso", hse_policy: "hse_certificate",
};
export const legacyDocType = (code: string) => LEGACY_DOC_TYPE[code] ?? "other";

export interface DocTypeDef { code: string; name: string; mandatory: 0 | 1; needs_expiry: 0 | 1; category_condition: string | null }
/** Seed list of document types per country (`*` = mandatory in the spec). */
export const DEFAULT_DOC_TYPES: Record<"AE" | "OM", DocTypeDef[]> = {
  AE: [
    { code: "trade_licence", name: "Trade licence", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "vat_certificate", name: "VAT / TRN certificate", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "chamber", name: "Chamber of Commerce membership", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "bank_letter", name: "Bank letter with IBAN", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "owner_id", name: "Owner / partner passport & Emirates ID", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "insurance_wc", name: "Workmen's compensation insurance", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "insurance_tpl", name: "Third-party liability insurance", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "insurance_car", name: "Contractor's all risks (CAR) insurance", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "company_profile", name: "Company profile", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "iso_certs", name: "ISO certificates", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "hse_policy", name: "HSE policy", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "audited_financials", name: "Audited financials (last 2 years)", mandatory: 0, needs_expiry: 0, category_condition: null },
  ],
  OM: [
    { code: "cr", name: "Commercial Registration (CR)", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "occi", name: "OCCI membership", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "vat_certificate", name: "VAT certificate", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "riyada", name: "Riyada / SME card", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "icv_certificate", name: "ICV certificate", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "omanisation", name: "Omanisation compliance letter (MoL)", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "pdo_registration", name: "PDO / OQ vendor registration", mandatory: 1, needs_expiry: 1, category_condition: "group:Oil and gas" },
    { code: "bank_letter", name: "Bank letter with IBAN", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "insurance_wc", name: "Workmen's compensation insurance", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "insurance_tpl", name: "Third-party liability insurance", mandatory: 1, needs_expiry: 1, category_condition: null },
    { code: "insurance_car", name: "Contractor's all risks (CAR) insurance", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "company_profile", name: "Company profile", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "iso_certs", name: "ISO certificates", mandatory: 0, needs_expiry: 1, category_condition: null },
    { code: "hse_policy", name: "HSE policy", mandatory: 1, needs_expiry: 0, category_condition: null },
    { code: "audited_financials", name: "Audited financials (last 2 years)", mandatory: 0, needs_expiry: 0, category_condition: null },
  ],
};

export interface CategoryDef { code: string; name: string; group: string }
/** Seed trades (entity NULL = every country). */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { code: "tel-cable", name: "Fibre / copper cable laying", group: "Telecom" },
  { code: "tel-splice", name: "Fibre splicing & testing", group: "Telecom" },
  { code: "tel-hdd", name: "HDD / micro-trenching", group: "Telecom" },
  { code: "tel-duct", name: "Ducting & manholes", group: "Telecom" },
  { code: "civ-works", name: "Civil works / excavation", group: "Civil" },
  { code: "civ-reinst", name: "Reinstatement & asphalt", group: "Civil" },
  { code: "og-weld", name: "Pipeline welding", group: "Oil and gas" },
  { code: "og-coat", name: "Coating & wrapping", group: "Oil and gas" },
  { code: "og-hydro", name: "Hydrotest & pre-commissioning", group: "Oil and gas" },
  { code: "og-cp", name: "Cathodic protection", group: "Oil and gas" },
  { code: "oth-elec", name: "Electrical / LV / MV cabling", group: "Others" },
  { code: "oth-survey", name: "Surveying & GIS", group: "Others" },
  { code: "oth-traffic", name: "Traffic management", group: "Others" },
  { code: "oth-plant", name: "Plant & equipment hire", group: "Others" },
  { code: "oth-manpower", name: "Manpower supply", group: "Others" },
  { code: "oth-hse", name: "HSE services", group: "Others" },
  { code: "oth-materials", name: "Materials supply (pipes, ducts, cables)", group: "Others" },
];
export const CATEGORY_GROUPS = ["Telecom", "Civil", "Oil and gas", "Others"];

/** True when a doc type's category condition holds for the groups of the supplier's requested categories. */
export function conditionHolds(condition: string | null, groups: string[]): boolean {
  if (!condition) return true;
  const m = /^group:(.+)$/.exec(condition);
  return m ? groups.includes(m[1]) : true;
}

/** Notification / email kinds sent to a supplier about its registration. */
export type RegistrationMailKind = "registration_received" | "registration_referred_back" | "registration_approved" | "registration_rejected";

/** Regions a supplier can say it serves, per country (entities.code). */
export const ENTITY_REGIONS: Record<string, string[]> = {
  AE: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"],
  OM: ["Muscat", "Al Batinah North", "Al Batinah South", "Al Dakhiliyah", "Al Dhahirah", "Al Sharqiyah North", "Al Sharqiyah South", "Dhofar", "Al Wusta", "Musandam", "Al Buraimi"],
};
export const regionsOf = (entityCode: string): string[] => ENTITY_REGIONS[entityCode] ?? [];
export function parseRegions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; } catch { return raw.split(",").map((x) => x.trim()).filter(Boolean); }
}
/** Country dialling hint shown on the mobile field. */
export const PHONE_HINT: Record<string, string> = { AE: "+971 5x xxx xxxx", OM: "+968 9xxx xxxx" };
