// Row types for every table (SPEC section 3). Dates are ISO YYYY-MM-DD text; booleans are 0/1.
import type { RegistrationStatus } from "./registration";
export type Nullable<T> = T | null;

/** Role code (mirrors roles.code; legacy values admin/manager/... still occur in old rows). */
export type Role = string;
export type ClientType = "government" | "road_authority" | "telecom" | "utility" | "oil_gas" | "private" | "other";
export type EntityType =
  | "tender" | "revision" | "project" | "stage" | "subcontractor" | "assignment"
  | "progress" | "invoice" | "sub_invoice" | "certificate" | "loss" | "issue" | "rfx" | "rfx_bid";
export type TenderKind = "tender" | "proposal" | "rfq" | "eoi";
export type Category = "road" | "cable" | "pipeline" | "telecom" | "civil" | "other";
export type QuantityUnit = "km" | "m" | "sqm" | "nos" | "lumpsum";
export type TenderStatus =
  | "draft" | "in_preparation" | "under_review" | "approved" | "submitted"
  | "negotiation" | "won" | "lost" | "cancelled" | "no_bid";
export type SectionStatus = "not_started" | "in_progress" | "completed";
export type RevisionStatus = "draft" | "submitted" | "superseded" | "final";
export type BudgetCategory = "manpower" | "material" | "equipment" | "services" | "subcontract" | "overhead" | "contingency";
export type ReviewDecision = "pending" | "approved" | "changes_requested" | "rejected";
export type NegotiationChannel = "meeting" | "email" | "call" | "letter" | "site_visit";
export type LossReason = "price" | "technical" | "timeline" | "experience" | "compliance" | "relationship" | "scope" | "other";
export type LossStatus = "open" | "in_review" | "closed";
export type ProjectStatus = "planning" | "mobilizing" | "active" | "on_hold" | "completed" | "closed";
export type StageStatus = "not_started" | "in_progress" | "delayed" | "on_hold" | "completed";
export type SubcontractorStatus = "prospect" | "onboarding" | "approved" | "suspended" | "blacklisted";
export type DocType = "trade_license" | "tax_certificate" | "insurance" | "hse_certificate" | "bank_letter" | "company_profile" | "iso" | "registration" | "chamber" | "labour" | "other";
export type DocStatus = "pending" | "pending_review" | "verified" | "expired" | "rejected";
export type AssignmentStatus = "draft" | "active" | "suspended" | "completed" | "terminated";
export type DelayResponsibility = "none" | "subcontractor" | "company" | "client" | "authority" | "weather" | "utility_clash" | "other";
export type ProgressSource = "internal" | "portal";
export type ProgressStatus = "submitted" | "verified" | "rejected";
export type InvoiceStatus = "submitted" | "under_review" | "certified" | "approved" | "paid" | "rejected";
export type CertType = "partial" | "substantial" | "final" | "taking_over";
export type CertStatus = "draft" | "requested" | "issued" | "rejected";
export type IssueStatus = "open" | "mitigating" | "closed";
export type RagStatus = "green" | "amber" | "red" | "grey";

interface Base { id: number; created_at: string }

export interface Setting { key: string; value: Nullable<string>; created_at: string }
export interface Department extends Base { name: string; code: Nullable<string>; head_user_id?: Nullable<number> }
export interface User extends Base {
  name: string; email: Nullable<string>; department_id: Nullable<number>; role: Role;
  password_hash?: Nullable<string>; status?: "active" | "disabled" | "locked"; role_id?: Nullable<number>; phone?: Nullable<string>; job_title?: Nullable<string>;
  must_change_password?: number; failed_attempts?: number; locked_until?: Nullable<string>; last_login_at?: Nullable<string>;
  password_changed_at?: Nullable<string>; manager_id?: Nullable<number>; default_entity_id?: Nullable<number>;
}
export interface Client extends Base {
  /** country (entities.id) the client belongs to */ entity_id: number;
  name: string; type: ClientType; contact_person: Nullable<string>; email: Nullable<string>;
  phone: Nullable<string>; address: Nullable<string>; notes: Nullable<string>;
  portal_slug?: Nullable<string>; portal_enabled?: number; portal_show_subcontractors?: number; portal_show_financials?: number;
}
export interface Attachment extends Base {
  entity_type: EntityType; entity_id: number; category: Nullable<string>; filename: string;
  stored_path: string; mime: Nullable<string>; size: Nullable<number>; uploaded_by: Nullable<number>; note: Nullable<string>;
}
export interface ActivityLog extends Base {
  entity_type: EntityType; entity_id: number; action: string; message: Nullable<string>; user_id: Nullable<number>;
}
export interface Tender extends Base {
  entity_id: number;
  code: string; title: string; client_id: Nullable<number>; kind: TenderKind; category: Category;
  location: Nullable<string>; scope_summary: Nullable<string>; technical_spec: Nullable<string>;
  quantity: Nullable<number>; quantity_unit: Nullable<QuantityUnit>;
  issue_date: Nullable<string>; clarification_deadline: Nullable<string>; submission_deadline: Nullable<string>;
  bid_bond_amount: Nullable<number>; estimated_value: Nullable<number>; status: TenderStatus;
  current_revision_id: Nullable<number>; owner_id: Nullable<number>; probability_pct: Nullable<number>;
  submitted_at: Nullable<string>; decided_at: Nullable<string>; won_value: Nullable<number>; project_id: Nullable<number>;
}
export interface TenderSection extends Base {
  tender_id: number; department_id: Nullable<number>; title: string; content: Nullable<string>;
  status: SectionStatus; assignee_id: Nullable<number>; due_date: Nullable<string>; completed_at: Nullable<string>;
}
export interface TenderRevision extends Base {
  tender_id: number; rev_no: number; label: Nullable<string>; reason: Nullable<string>; status: RevisionStatus;
  total_cost: number; total_price: number; margin_pct: number; submitted_at: Nullable<string>;
  client_feedback: Nullable<string>; created_by: Nullable<number>;
}
export interface BudgetLine extends Base {
  revision_id: number; tender_id: number; sort: number; category: BudgetCategory; item_code: Nullable<string>;
  description: string; unit: Nullable<string>; quantity: number; unit_cost: number; margin_pct: number;
  department_id: Nullable<number>; notes: Nullable<string>; wbs_stage: Nullable<string>;
}
export interface MarginChange extends Base {
  budget_line_id: Nullable<number>; revision_id: number; old_margin: Nullable<number>; new_margin: Nullable<number>;
  reason: Nullable<string>; user_id: Nullable<number>;
}
export interface TenderReview extends Base {
  tender_id: number; revision_id: Nullable<number>; department_id: Nullable<number>; reviewer_id: Nullable<number>;
  decision: ReviewDecision; comment: Nullable<string>; decided_at: Nullable<string>;
}
export interface Negotiation extends Base {
  tender_id: number; revision_id: Nullable<number>; date: Nullable<string>; channel: Nullable<NegotiationChannel>;
  summary: Nullable<string>; client_position: Nullable<string>; our_position: Nullable<string>;
  client_target_price: Nullable<number>; outcome: Nullable<string>; next_step: Nullable<string>;
}
export interface LossAnalysis extends Base {
  tender_id: number; primary_reason: LossReason; secondary_reasons: Nullable<string>; winner_name: Nullable<string>;
  winner_price: Nullable<number>; our_price: Nullable<number>; price_gap_pct: Nullable<number>;
  technical_score: Nullable<number>; client_feedback: Nullable<string>; root_cause: Nullable<string>;
  lessons_learned: Nullable<string>; action_items: Nullable<string>; owner_id: Nullable<number>; status: LossStatus;
}
export interface Project extends Base {
  entity_id: number;
  code: string; name: string; tender_id: Nullable<number>; client_id: Nullable<number>; parent_id: Nullable<number>;
  category: Nullable<Category>; region: Nullable<string>; location: Nullable<string>;
  contract_value: number; budget_cost: number; start_date: Nullable<string>; end_date: Nullable<string>;
  status: ProjectStatus; manager_id: Nullable<number>; total_quantity: Nullable<number>;
  quantity_unit: Nullable<QuantityUnit>; geometry: Nullable<string>; description: Nullable<string>;
  /** USD equivalents locked at the project's start date (see fx-tables.ts) */ currency?: Nullable<string>; fx_rate_usd?: Nullable<number>; fx_date?: Nullable<string>;
  contract_value_usd?: Nullable<number>; budget_cost_usd?: Nullable<number>;
}
export interface Stage extends Base {
  project_id: number; code: Nullable<string>; name: string; description: Nullable<string>; sort: number;
  geometry: Nullable<string>; planned_quantity: number; quantity_unit: Nullable<QuantityUnit>;
  chainage_from: Nullable<number>; chainage_to: Nullable<number>;
  planned_start: Nullable<string>; planned_end: Nullable<string>; actual_start: Nullable<string>; actual_end: Nullable<string>;
  budget_amount: number; status: StageStatus; weight_pct: Nullable<number>;
}
export interface ProjectBudgetLine extends Base {
  project_id: number; stage_id: Nullable<number>; category: BudgetCategory; description: Nullable<string>;
  unit: Nullable<string>; quantity: number; unit_cost: number; budget_amount: number; source_budget_line_id: Nullable<number>;
}
export interface Subcontractor extends Base {
  entity_id: number;
  code: Nullable<string>; name: string; trade: Nullable<string>; categories: Nullable<string>;
  contact_person: Nullable<string>; email: Nullable<string>; phone: Nullable<string>; address: Nullable<string>;
  trade_license_no: Nullable<string>; trade_license_expiry: Nullable<string>; tax_no: Nullable<string>;
  bank_name: Nullable<string>; iban: Nullable<string>; status: SubcontractorStatus; rating: Nullable<number>; notes: Nullable<string>;
  portal_slug: Nullable<string>; portal_enabled: 0 | 1;
  /** supplier registration (SCHEMA_VERSION 9) */
  registration_status: RegistrationStatus; registration_no: Nullable<string>; registered_at: Nullable<string>; submitted_at: Nullable<string>;
  reviewed_by: Nullable<number>; reviewed_at: Nullable<string>; review_note: Nullable<string>; reject_reason: Nullable<string>; resubmit_count: number;
  legal_form: Nullable<string>; year_established: Nullable<number>; employees: Nullable<number>; turnover_band: Nullable<string>; website: Nullable<string>;
  cr_no: Nullable<string>; cr_expiry: Nullable<string>; vat_no: Nullable<string>; country_of_registration: Nullable<string>;
  regions_served: Nullable<string>; capacity_note: Nullable<string>;
  prequal_grade: Nullable<"A" | "B" | "C">; prequal_valid_until: Nullable<string>; account_name: Nullable<string>; swift: Nullable<string>;
  hse_lti_rate: Nullable<number>; hse_has_policy: Nullable<number>; iso_9001: number; iso_14001: number; iso_45001: number; icv_score: Nullable<number>;
  declaration_accepted_at: Nullable<string>;
}
export interface SubcontractorDocument extends Base {
  subcontractor_id: number; doc_type: DocType; ref_no: Nullable<string>; issue_date: Nullable<string>;
  expiry_date: Nullable<string>; attachment_id: Nullable<number>; status: DocStatus;
  source?: string; uploaded_by_name?: Nullable<string>; review_note?: Nullable<string>;
  /** registration document type code (registration_doc_types.code); NULL = legacy document */ doc_type_code?: Nullable<string>;
  review_status?: "pending" | "accepted" | "query"; review_comment?: Nullable<string>; reviewed_by?: Nullable<number>; reviewed_at?: Nullable<string>;
  version?: number; is_current?: number;
}
export interface OnboardingItem extends Base {
  subcontractor_id: number; item: string; done: 0 | 1; done_by: Nullable<number>; done_at: Nullable<string>;
}
export interface Assignment extends Base {
  code: Nullable<string>; project_id: number; stage_id: Nullable<number>; subcontractor_id: number;
  scope: Nullable<string>; contract_value: number; quantity: Nullable<number>; quantity_unit: Nullable<QuantityUnit>;
  unit_rate: Nullable<number>; start_date: Nullable<string>; end_date: Nullable<string>; payment_terms: Nullable<string>;
  advance_pct: number; retention_pct: number; payment_days: number; status: AssignmentStatus;
  portal_token: Nullable<string>; portal_enabled: 0 | 1;
  /** how the subcontract came about: direct assignment or supplier tender (RFx) */ source?: "direct" | "tender"; rfx_id?: Nullable<number>; rfx_bid_id?: Nullable<number>;
}
export interface ProgressReport extends Base {
  assignment_id: Nullable<number>; stage_id: Nullable<number>; project_id: number; report_date: string;
  quantity_done: number; cumulative_quantity: number; percent_complete: number; manpower_count: number; man_hours: number;
  equipment_used: Nullable<string>; work_done: Nullable<string>; issues: Nullable<string>;
  delay_days: number; delay_cause: Nullable<string>; delay_responsibility: DelayResponsibility;
  geometry: Nullable<string>; source: ProgressSource; status: ProgressStatus;
  verified_by: Nullable<number>; verified_at: Nullable<string>;
  submitted_by_name?: Nullable<string>; portal_user_id?: Nullable<number>; reject_reason?: Nullable<string>; weather?: Nullable<string>;
}
export interface ProgressMaterial extends Base {
  progress_report_id: number; material: string; unit: Nullable<string>; quantity: number; unit_cost: number;
}
export interface ProgressManpower extends Base {
  progress_report_id: number; trade: string; headcount: number; hours: number;
}
export interface SubInvoice extends Base {
  assignment_id: number; project_id: number; invoice_no: Nullable<string>; invoice_date: Nullable<string>;
  period_from: Nullable<string>; period_to: Nullable<string>; claimed_amount: number; claimed_percent: number;
  certified_amount: number; retention_amount: number; advance_recovery: number; net_payable: number;
  status: InvoiceStatus; paid_amount: number; paid_date: Nullable<string>; source: ProgressSource; notes: Nullable<string>;
  sub_invoice_ref: Nullable<string>; currency: string; vat_rate: number; subtotal: number; vat_amount: number; gross_amount: number;
  retention_percent: number; advance_recovery_percent: number; previous_certified: number;
  submitted_by_name: Nullable<string>; submitted_by_email: Nullable<string>; submitted_at: Nullable<string>; due_date: Nullable<string>;
  reviewed_by: Nullable<number>; certified_by: Nullable<number>; certified_at: Nullable<string>; payment_ref: Nullable<string>; payment_method: Nullable<string>;
  erp_doc_no: Nullable<string>; erp_sync_status: ErpSyncStatus; erp_synced_at: Nullable<string>; erp_error: Nullable<string>;
  /** USD equivalents (rate locked at the invoice date; `_usd` columns are virtual generated, see fx-tables.ts) */
  fx_rate_usd?: Nullable<number>; fx_date?: Nullable<string>; claimed_amount_usd?: Nullable<number>; certified_amount_usd?: Nullable<number>; net_payable_usd?: Nullable<number>; gross_amount_usd?: Nullable<number>;
}
export type ErpSyncStatus = "not_synced" | "queued" | "synced" | "failed";
export interface SubInvoiceLine {
  id: number; invoice_id: number; line_no: number; item_code: Nullable<string>; description: string; unit: Nullable<string>;
  contract_qty: number; rate: number; prev_qty: number; this_qty: number; cum_qty: number; amount: number;
  certified_qty: number; certified_amount: number; remarks: Nullable<string>; stage_id: Nullable<number>;
}
export interface CompletionCertificate extends Base {
  assignment_id: number; project_id: number; stage_id: Nullable<number>; cert_type: CertType; cert_no: Nullable<string>;
  cert_date: Nullable<string>; percent: Nullable<number>; quantity: Nullable<number>; remarks: Nullable<string>;
  status: CertStatus; issued_by: Nullable<number>; source: ProgressSource;
}
export interface ProjectCost extends Base {
  project_id: number; stage_id: Nullable<number>; category: string; description: Nullable<string>;
  amount: number; cost_date: Nullable<string>; source_type: Nullable<string>; source_id: Nullable<number>;
}
export interface Issue extends Base {
  project_id: number; stage_id: Nullable<number>; assignment_id: Nullable<number>; title: string;
  description: Nullable<string>; responsibility: DelayResponsibility; impact_days: number; impact_cost: number;
  status: IssueStatus; raised_on: Nullable<string>; resolved_on: Nullable<string>;
  source?: string; kind?: string; category?: Nullable<string>; raised_by_name?: Nullable<string>; raised_by_portal_user?: Nullable<number>; awaiting_party?: Nullable<string>; last_activity_at?: Nullable<string>;
}

/* ------------------------------------------------------------------ approvals (AUTH_SPEC section D) */
export type ApprovalDocType =
  | "tender_submission" | "tender_revision" | "tender_award" | "subcontractor_onboarding" | "subcontract_award"
  | "sub_invoice" | "invoice_payment" | "completion_certificate" | "project_cost" | "loss_analysis" | "rfx_publish" | "rfx_award";
export type ApproverType = "role" | "user" | "department" | "department_head" | "project_manager" | "requester_manager";
export type ApprovalMode = "any" | "all" | "min";
export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "returned" | "cancelled";
export type ApprovalTaskStatus = "pending" | "approved" | "rejected" | "returned" | "skipped";
export interface ApprovalWorkflow extends Base {
  document_type: ApprovalDocType; name: string; description: Nullable<string>; is_active: number; priority: number;
  condition_min_amount: Nullable<number>; condition_max_amount: Nullable<number>; condition_department_id: Nullable<number>;
  condition_project_category: Nullable<string>; created_by: Nullable<number>; updated_at: Nullable<string>;
  /** NULL = applies to every country */ entity_id?: Nullable<number>;
}
export interface ApprovalLevel extends Base {
  workflow_id: number; level_no: number; name: string; approver_type: ApproverType; approver_role_id: Nullable<number>;
  approver_user_id: Nullable<number>; approver_department_id: Nullable<number>; approval_mode: ApprovalMode; min_approvals: number;
  min_amount: Nullable<number>; sla_hours: number; allow_self_approval: number;
}
export interface ApprovalRequest extends Base {
  document_type: ApprovalDocType; document_id: number; document_ref: Nullable<string>; title: Nullable<string>; amount: number;
  workflow_id: Nullable<number>; current_level: number; status: ApprovalRequestStatus; requested_by: Nullable<number>;
  requested_at: string; completed_at: Nullable<string>; note: Nullable<string>; levels_json: Nullable<string>; payload: Nullable<string>; entity_id: number;
}
export interface ApprovalTask extends Base {
  request_id: number; level_no: number; assignee_user_id: number; status: ApprovalTaskStatus; decision_comment: Nullable<string>;
  decided_at: Nullable<string>; decided_by: Nullable<number>; delegated_from_user_id: Nullable<number>; due_at: Nullable<string>;
}
export interface ApprovalDelegation extends Base {
  user_id: number; delegate_user_id: number; start_date: string; end_date: string; document_types: Nullable<string>; is_active: number;
}
