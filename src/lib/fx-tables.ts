// Reporting-currency layer (MULTI_COUNTRY_SPEC section 2): which tables hold money, how a row finds its entity and its natural date.
// Pure data + SQL builders (no db import) so migrate.ts can use it. Every money table gets
//   currency, fx_rate_usd, fx_date            (the row's transaction currency and the USD rate LOCKED at its date)
//   <money column>_usd  VIRTUAL generated      (= round(col * fx_rate_usd, 2); 4 decimals for per-unit rates)
// and an AFTER INSERT trigger that fills the three columns when the application did not (rate = latest fx_rates row with effective_date <= date).
//
// Entity inheritance rule (one rule for the whole schema): ROOT tables carry `entity_id` (clients, subcontractors, tenders, projects,
// approval_requests, rfx_tenders, approval_workflows [nullable = all countries]); every CHILD row belongs to the entity of its parent
// (tender children -> tenders, project children -> projects, invoice lines -> invoice -> project, subcontractor children -> subcontractors,
// client users -> clients). Children never repeat entity_id; the {ENT} expressions below resolve it through the parent.

export interface FxTable {
  table: string;
  /** money columns that get a `_usd` virtual column */ money: string[];
  /** per-unit rate columns (money, but kept with 4 decimals) */ rates?: string[];
  /** SQL expression (row alias `{r}`) -> entity id */ entity: string;
  /** SQL expression (row alias `{r}`) -> natural date of the row (any prefix of an ISO string) */ date: string;
}

const viaTender = "(SELECT entity_id FROM tenders WHERE id = {r}.tender_id)";
const viaProject = "(SELECT entity_id FROM projects WHERE id = {r}.project_id)";
const viaRfx = "(SELECT entity_id FROM rfx_tenders WHERE id = {r}.rfx_id)";

export const FX_TABLES: FxTable[] = [
  { table: "tenders", money: ["bid_bond_amount", "estimated_value", "won_value"], entity: "{r}.entity_id", date: "COALESCE({r}.submitted_at, {r}.issue_date, {r}.created_at)" },
  { table: "tender_revisions", money: ["total_cost", "total_price"], entity: viaTender, date: "COALESCE({r}.submitted_at, {r}.created_at)" },
  { table: "budget_lines", money: [], rates: ["unit_cost"], entity: viaTender, date: "{r}.created_at" },
  { table: "negotiations", money: ["client_target_price"], entity: viaTender, date: "COALESCE({r}.date, {r}.created_at)" },
  { table: "loss_analyses", money: ["winner_price", "our_price"], entity: viaTender, date: "{r}.created_at" },
  { table: "projects", money: ["contract_value", "budget_cost"], entity: "{r}.entity_id", date: "COALESCE({r}.start_date, {r}.created_at)" },
  { table: "stages", money: ["budget_amount"], entity: viaProject, date: "COALESCE({r}.planned_start, {r}.created_at)" },
  { table: "project_budget_lines", money: ["budget_amount"], rates: ["unit_cost"], entity: viaProject, date: "{r}.created_at" },
  { table: "assignments", money: ["contract_value"], rates: ["unit_rate"], entity: viaProject, date: "COALESCE({r}.start_date, {r}.created_at)" },
  { table: "progress_materials", money: [], rates: ["unit_cost"],
    entity: "(SELECT p.entity_id FROM progress_reports r JOIN projects p ON p.id = r.project_id WHERE r.id = {r}.progress_report_id)",
    date: "(SELECT report_date FROM progress_reports WHERE id = {r}.progress_report_id)" },
  { table: "sub_invoices", money: ["claimed_amount", "certified_amount", "retention_amount", "advance_recovery", "net_payable", "paid_amount", "subtotal", "vat_amount", "gross_amount", "previous_certified"],
    entity: viaProject, date: "COALESCE({r}.invoice_date, {r}.created_at)" },
  { table: "sub_invoice_lines", money: ["amount", "certified_amount"], rates: ["rate"],
    entity: "(SELECT p.entity_id FROM sub_invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = {r}.invoice_id)",
    date: "(SELECT COALESCE(invoice_date, created_at) FROM sub_invoices WHERE id = {r}.invoice_id)" },
  { table: "project_costs", money: ["amount"], entity: viaProject, date: "COALESCE({r}.cost_date, {r}.created_at)" },
  { table: "project_cost_requests", money: ["amount"], entity: viaProject, date: "COALESCE({r}.cost_date, {r}.created_at)" },
  { table: "issues", money: ["impact_cost"], entity: viaProject, date: "COALESCE({r}.raised_on, {r}.created_at)" },
  { table: "approval_requests", money: ["amount"], entity: "{r}.entity_id", date: "COALESCE({r}.requested_at, {r}.created_at)" },
  // supplier tendering (SUPPLIER_TENDERING_SPEC Part B): the tender is the root, its children inherit the country through it
  { table: "rfx_tenders", money: ["estimate", "award_value"], entity: "{r}.entity_id", date: "COALESCE({r}.published_at, {r}.created_at)" },
  { table: "rfx_boq_lines", money: [], rates: ["estimate_rate"], entity: viaRfx, date: "{r}.created_at" },
  { table: "rfx_bids", money: ["total_amount", "discount_amount", "vat_amount"], entity: viaRfx, date: "COALESCE({r}.submitted_at, {r}.created_at)" },
  { table: "rfx_bid_prices", money: ["amount"], rates: ["unit_rate"],
    entity: "(SELECT t.entity_id FROM rfx_bids b JOIN rfx_tenders t ON t.id = b.rfx_id WHERE b.id = {r}.bid_id)", date: "{r}.created_at" },
];

const DEFAULT_ENTITY = "(SELECT id FROM entities ORDER BY sort_order, id LIMIT 1)";
const sub = (expr: string, row: string) => expr.split("{r}").join(row);
const entityOf = (t: FxTable, row: string) => `COALESCE(${sub(t.entity, row)}, ${DEFAULT_ENTITY})`;
const dateOf = (t: FxTable, row: string) => `COALESCE(substr(${sub(t.date, row)}, 1, 10), date('now'))`;
/** USD per unit of `cur` on `day` (latest rate effective on or before the day, else the earliest known rate, else 1). */
const rateSql = (cur: string, day: string) =>
  `COALESCE((SELECT rate_to_usd FROM fx_rates WHERE currency = ${cur} AND effective_date <= ${day} ORDER BY effective_date DESC LIMIT 1),
            (SELECT rate_to_usd FROM fx_rates WHERE currency = ${cur} ORDER BY effective_date ASC LIMIT 1), 1)`;

/** Statements that fill currency / fx_date / fx_rate_usd of the row(s) selected by `where` (trigger: NEW row; backfill: rows without a rate). */
export function fxFillSql(t: FxTable, row: string, where: string): string[] {
  return [
    `UPDATE ${t.table} SET currency = (SELECT currency FROM entities WHERE id = ${entityOf(t, row)}), fx_date = ${dateOf(t, row)} WHERE ${where};`,
    `UPDATE ${t.table} SET fx_rate_usd = ${rateSql(`${t.table}.currency`, `${t.table}.fx_date`)} WHERE ${where};`,
  ];
}

export function fxTriggerSql(t: FxTable): string {
  return `CREATE TRIGGER trg_fx_${t.table} AFTER INSERT ON ${t.table} WHEN NEW.fx_rate_usd IS NULL BEGIN
    ${fxFillSql(t, "NEW", `id = NEW.id`).join("\n    ")}
  END;`;
}

/** Re-values the locked rate of every row dated on or after `from` with the rate effective on that row's own date (explicit admin action). */
export function fxRevalueSql(t: FxTable): string {
  return `UPDATE ${t.table} SET fx_rate_usd = ${rateSql(`${t.table}.currency`, `${t.table}.fx_date`)} WHERE fx_date >= ?`;
}

export const usdColumn = (col: string) => `${col}_usd`;
export function usdDdl(col: string, rate: boolean): string {
  return `REAL GENERATED ALWAYS AS (round(${col} * fx_rate_usd, ${rate ? 4 : 2})) VIRTUAL`;
}
