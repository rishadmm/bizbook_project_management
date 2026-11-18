// Supplier tendering (RFx): pure constants, date helpers and evaluation maths. NO db / next imports (shared by the actions, the seed, the checks and client components).
// Naming: UI = "Procurement" / "supplier tender"; code and tables use the prefix `rfx_`.

export const RFX_STATUSES = ["draft", "pending_approval", "scheduled", "published", "closed", "opening", "evaluation", "recommended", "award_pending", "awarded", "cancelled"] as const;
export type RfxStatus = (typeof RFX_STATUSES)[number];
/** Tenders that still occupy their scope (everything between a draft and the award, cancelled tenders free it again). */
export const LIVE_RFX_STATUSES: RfxStatus[] = ["draft", "pending_approval", "scheduled", "published", "closed", "opening", "evaluation", "recommended", "award_pending"];
/** Statuses from which the portal shows a tender to eligible suppliers. */
export const PORTAL_VISIBLE_STATUSES: RfxStatus[] = ["published", "closed", "opening", "evaluation", "recommended", "award_pending", "awarded"];
export const BID_STATUSES = ["draft", "submitted", "withdrawn", "late_refused", "disqualified", "qualified", "awarded", "unsuccessful"] as const;
export type BidStatus = (typeof BID_STATUSES)[number];
/** Bids that count as received (a content-bearing, valid submission). */
export const RECEIVED_BID_STATUSES: BidStatus[] = ["submitted", "disqualified", "qualified", "awarded", "unsuccessful"];

export type EvalMethod = "lowest_compliant" | "weighted" | "two_envelope_weighted";
export const EVAL_METHODS: { value: EvalMethod; label: string }[] = [
  { value: "lowest_compliant", label: "Lowest compliant price" }, { value: "weighted", label: "Weighted technical / commercial (single envelope)" },
  { value: "two_envelope_weighted", label: "Two-envelope weighted (prices sealed until technical evaluation)" },
];
export const STEP_KINDS = ["compliance", "hse", "technical", "commercial", "legal", "custom"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_KIND_LABEL: Record<string, string> = { compliance: "Compliance", hse: "HSE", technical: "Technical", commercial: "Commercial", legal: "Legal", custom: "Custom" };
export const REQ_KINDS = ["document", "text", "number", "yes_no", "date"] as const;
export type ReqKind = (typeof REQ_KINDS)[number];
export const REQ_KIND_LABEL: Record<string, string> = { document: "Document", text: "Text", number: "Number", yes_no: "Yes / No", date: "Date" };
export const COMMITTEE_ROLES = ["chair", "member", "secretary", "observer"] as const;
export const COMMITTEE_ROLE_LABEL: Record<string, string> = { chair: "Chair", member: "Member", secretary: "Secretary", observer: "Observer" };
export const SCOPE_KINDS = [{ value: "stages", label: "Stages" }, { value: "subproject", label: "Sub-project" }, { value: "project", label: "Whole project" }] as const;

export const isTwoEnvelope = (method: string | null | undefined): boolean => method === "two_envelope_weighted";
export const isWeighted = (method: string | null | undefined): boolean => method === "weighted" || method === "two_envelope_weighted";

/** Share of the stage budget lines that a subcontractor typically carries (the BOQ estimate is prefilled with it). */
export const SUBCONTRACT_SHARE = 0.62;
export const EXCLUDED_BUDGET_CATEGORIES = ["overhead", "contingency"];

/* ------------------------------------------------------------------ dates (all demo countries are UTC+4; stored as UTC ISO strings) */
export const LOCAL_OFFSET_MIN = 240;
export const LOCAL_TZ_LABEL = "GST (UTC+4)";
/** "2026-11-23T10:00" (datetime-local input, local time) -> "2026-11-23T06:00:00.000Z". Empty -> null. */
export function localToIso(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec((v ?? "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)) - LOCAL_OFFSET_MIN * 60_000;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
/** UTC ISO -> "2026-11-23T10:00" for datetime-local inputs. */
export function isoToLocalInput(iso: string | null | undefined): string {
  const t = parseTime(iso);
  return Number.isNaN(t) ? "" : new Date(t + LOCAL_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}
export function parseTime(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.length <= 10 ? `${iso}T00:00:00Z` : `${iso.replace(" ", "T")}Z`);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "23 Nov 2026 10:00" in local (GST) time. */
export function formatLocal(iso: string | null | undefined, withTime = true): string {
  const t = parseTime(iso);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t + LOCAL_OFFSET_MIN * 60_000);
  const date = `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withTime ? `${date} ${d.toISOString().slice(11, 16)}` : date;
}
/** Local calendar day (YYYY-MM-DD) of an instant. */
export const localDay = (iso: string | null | undefined): string => { const t = parseTime(iso); return Number.isNaN(t) ? "" : new Date(t + LOCAL_OFFSET_MIN * 60_000).toISOString().slice(0, 10); };
/** "in 5 days 3 h", "closed 2 days ago", "closes today". */
export function countdown(iso: string | null | undefined, now = Date.now()): string {
  const t = parseTime(iso);
  if (Number.isNaN(t)) return "—";
  const diff = t - now, abs = Math.abs(diff), days = Math.floor(abs / 86_400_000), hours = Math.floor((abs % 86_400_000) / 3_600_000), mins = Math.floor((abs % 3_600_000) / 60_000);
  const span = days >= 1 ? `${days} day${days === 1 ? "" : "s"}${days < 4 && hours ? ` ${hours} h` : ""}` : hours >= 1 ? `${hours} h ${mins} min` : `${mins} min`;
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}
export const daysToClose = (iso: string | null | undefined, now = Date.now()): number | null => { const t = parseTime(iso); return Number.isNaN(t) ? null : (t - now) / 86_400_000; };

/** Dates of a draft: publish < clarification < closing <= opening (empty values are skipped, closing is required to publish). */
export function validateRfxDates(d: { publish_at?: string | null; clarification_deadline?: string | null; closing_at?: string | null; opening_at?: string | null }, forPublish = false): string | null {
  const t = (v: string | null | undefined) => parseTime(v);
  if (forPublish && !d.closing_at) return "Set the closing date and time.";
  if (d.publish_at && d.clarification_deadline && !(t(d.publish_at) < t(d.clarification_deadline))) return "The clarification deadline must be after the publish date.";
  if (d.clarification_deadline && d.closing_at && !(t(d.clarification_deadline) < t(d.closing_at))) return "The clarification deadline must be before the closing date.";
  if (d.publish_at && d.closing_at && !(t(d.publish_at) < t(d.closing_at))) return "The closing date must be after the publish date.";
  if (d.closing_at && d.opening_at && !(t(d.closing_at) <= t(d.opening_at))) return "The opening must be at or after the closing date.";
  return null;
}

/* ------------------------------------------------------------------ money + evaluation maths */
export const decimalsOf = (currency: string | null | undefined): number => (["OMR", "BHD", "KWD", "JOD"].includes((currency ?? "").toUpperCase()) ? 3 : 2);
export const roundTo = (n: number, d: number): number => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };

export interface BidTotals { subtotal: number; discount: number; net: number; vat: number; gross: number }
/** Subtotal of the priced lines, a discount (absolute), VAT on the net amount at the entity rate. `total_amount` of a bid = `net` (excl. VAT, comparable with the contract value). */
export function bidTotals(lines: { amount: number }[], discount: number, vatRate: number, dec: number): BidTotals {
  const subtotal = roundTo(lines.reduce((a, l) => a + (Number(l.amount) || 0), 0), dec);
  const disc = roundTo(Math.max(0, discount || 0), dec);
  const net = roundTo(subtotal - disc, dec);
  const vat = roundTo(net * (vatRate / 100), dec);
  return { subtotal, discount: disc, net, vat, gross: roundTo(net + vat, dec) };
}
/** Arithmetic check of a priced BOQ: recomputes quantity x rate for every line; returns the differing lines. */
export function arithmeticCheck(lines: { item_no: string; quantity: number; unit_rate: number; amount: number }[], dec: number): { item_no: string; computed: number; entered: number; diff: number }[] {
  const tol = 0.5 * 10 ** -dec + 1e-9;
  return lines.map((l) => { const computed = roundTo(l.quantity * l.unit_rate, dec); return { item_no: l.item_no, computed, entered: l.amount, diff: roundTo(l.amount - computed, dec) }; })
    .filter((x) => Math.abs(x.diff) > tol && Math.abs(x.diff) > Math.abs(x.entered) * 0.00002);
}

export interface StepDef { id: number; kind: string; gate: "pass_fail" | "scored"; weight: number | null; pass_mark: number | null; sort: number }
/** Score of one evaluator on one step in percent: sum(scores) / sum(max) * 100. */
export function evaluatorPercent(scores: { score: number; max: number }[]): number {
  const max = scores.reduce((a, s) => a + s.max, 0);
  return max > 0 ? (scores.reduce((a, s) => a + s.score, 0) / max) * 100 : 0;
}
/** Step score of a bid = average of the evaluators' percentages (each evaluator: criteria total normalised to 100). */
export const averagePercent = (percents: number[]): number | null => (percents.length ? percents.reduce((a, b) => a + b, 0) / percents.length : null);
/** Technical score = weighted average of the scored non-commercial steps (equal weights when none is set). */
export function technicalScore(parts: { score: number | null; weight: number | null }[]): number | null {
  const ok = parts.filter((p) => p.score !== null);
  if (!ok.length) return null;
  const tw = ok.reduce((a, p) => a + (p.weight && p.weight > 0 ? p.weight : 1), 0);
  return ok.reduce((a, p) => a + (p.score as number) * (p.weight && p.weight > 0 ? p.weight : 1), 0) / tw;
}
/** lowest price / bid price x 100 (null for an unpriced bid). */
export const commercialScore = (lowest: number, price: number): number | null => (price > 0 && lowest > 0 ? (lowest / price) * 100 : null);
export const finalScore = (tech: number | null, comm: number | null, tw: number, cw: number): number | null =>
  tech === null || comm === null || tw + cw <= 0 ? null : (tech * tw + comm * cw) / (tw + cw);

/** Ranking: highest final score first; lowest_compliant = lowest price first. Ties keep the earlier submission. */
export function rankBids<T extends { id: number; price: number | null; final: number | null; submitted_at: string | null }>(bids: T[], method: string): (T & { rank: number })[] {
  const byPrice = method === "lowest_compliant";
  const sorted = [...bids].sort((a, b) => {
    if (byPrice) return (a.price ?? Infinity) - (b.price ?? Infinity) || String(a.submitted_at).localeCompare(String(b.submitted_at));
    return (b.final ?? -1) - (a.final ?? -1) || (a.price ?? Infinity) - (b.price ?? Infinity) || String(a.submitted_at).localeCompare(String(b.submitted_at));
  });
  return sorted.map((b, i) => ({ ...b, rank: i + 1 }));
}

/** SHA-256 receipt string input: tender, bidder, revision, timestamp and the content digest (the hash itself is computed in core.ts). */
export const receiptPayload = (rfxCode: string, subId: number, revision: number, at: string, content: unknown): string => `${rfxCode}|${subId}|${revision}|${at}|${JSON.stringify(content)}`;

/** Realistic quantities: whole numbers for count / time / weight units, whole metres, at most 1 dp for areas, volumes and km (never below the smallest step). */
export function niceQty(unit: string | null | undefined, q: number): number {
  const u = (unit ?? "").toLowerCase().replace(/[²³]/g, (c) => (c === "²" ? "2" : "3"));
  if (["m", "day", "man-day", "month", "nos", "nr", "no", "ls", "lot", "set", "lumpsum", "ton", "hr", "week"].includes(u)) return Math.max(1, Math.round(q));
  if (["m2", "sqm", "m3", "km", "ha"].includes(u)) return Math.max(0.1, Math.round(q * 10) / 10);
  return Math.max(1, Math.round(q));
}
/** Round unit rates: at most 2 dp in AED-like currencies and 3 dp in OMR-like ones, preferring round values (113.50, 8.85). */
export function niceRate(v: number, dec: number): number {
  if (!(v > 0)) return 0;
  const step = v >= 100 ? 0.5 : v >= 10 ? 0.05 : dec >= 3 ? 0.005 : 0.01;
  return roundTo(Math.max(step, Math.round(v / step) * step), dec);
}
