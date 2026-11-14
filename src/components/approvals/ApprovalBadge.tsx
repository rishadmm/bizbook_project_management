import { Badge } from "@/components/ui/Badge";
import { REQUEST_STATUS, TASK_STATUS } from "@/lib/approvals/meta";
import type { ApprovalRequestStatus, ApprovalTaskStatus } from "@/lib/types";

/** Approval request status pill (labels/tones are local to the approvals module). */
export function ApprovalStatusBadge({ status }: { status: ApprovalRequestStatus | "auto_approved" }) {
  if (status === "auto_approved") return <Badge tone="green">Auto-approved</Badge>;
  const d = REQUEST_STATUS[status];
  return <Badge tone={d.tone}>{d.label}</Badge>;
}
export function TaskStatusBadge({ status }: { status: ApprovalTaskStatus }) {
  const d = TASK_STATUS[status];
  return <Badge tone={d.tone}>{d.label}</Badge>;
}
