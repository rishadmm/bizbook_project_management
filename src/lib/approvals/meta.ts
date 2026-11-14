// Pure approval constants and labels (safe to import from client components).
import type { ApprovalDocType, ApprovalMode, ApprovalRequestStatus, ApprovalTaskStatus, ApproverType } from "../types";
import type { Tone } from "../status";

export const DOC_TYPES: { type: ApprovalDocType; label: string }[] = [
  { type: "tender_submission", label: "Tender submission" },
  { type: "tender_revision", label: "Tender price revision" },
  { type: "tender_award", label: "Tender award (Mark Won)" },
  { type: "subcontractor_onboarding", label: "Subcontractor onboarding" },
  { type: "subcontract_award", label: "Subcontract award" },
  { type: "sub_invoice", label: "Subcontractor invoice" },
  { type: "invoice_payment", label: "Invoice payment" },
  { type: "completion_certificate", label: "Completion certificate" },
  { type: "project_cost", label: "Manual project cost" },
  { type: "loss_analysis", label: "Loss analysis closure" },
];
export const DOC_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES.map((d) => [d.type, d.label]));
export const isDocType = (t: string): t is ApprovalDocType => t in DOC_LABEL;

export const APPROVER_TYPES: { value: ApproverType; label: string }[] = [
  { value: "role", label: "Role" },
  { value: "user", label: "Specific user" },
  { value: "department", label: "Department (all members)" },
  { value: "department_head", label: "Department head" },
  { value: "project_manager", label: "Project manager of the document" },
  { value: "requester_manager", label: "Requester's manager" },
];
export const APPROVAL_MODES: { value: ApprovalMode; label: string }[] = [
  { value: "any", label: "Any one approver" },
  { value: "all", label: "All approvers" },
  { value: "min", label: "Minimum N approvers" },
];

export const REQUEST_STATUS: Record<ApprovalRequestStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "amber" }, approved: { label: "Approved", tone: "green" }, rejected: { label: "Rejected", tone: "red" },
  returned: { label: "Returned", tone: "orange" }, cancelled: { label: "Cancelled", tone: "slate" },
};
export const TASK_STATUS: Record<ApprovalTaskStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "amber" }, approved: { label: "Approved", tone: "green" }, rejected: { label: "Rejected", tone: "red" },
  returned: { label: "Returned", tone: "orange" }, skipped: { label: "Skipped", tone: "slate" },
};

export interface LevelSnapshot {
  level_no: number; name: string; approver_type: ApproverType; approver_role_id: number | null; approver_user_id: number | null;
  approver_department_id: number | null; approval_mode: ApprovalMode; min_approvals: number; min_amount: number | null; sla_hours: number;
  allow_self_approval: number; label: string;
}
