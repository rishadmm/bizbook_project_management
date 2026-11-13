import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

/** Placeholder: replaced by the workflow designer (AUTH_SPEC section D). */
export default async function ApprovalWorkflowsPage() {
  await requirePage("approval_setup");
  return (<><PageHeader title="Approval workflows" description="Design multi-level approval workflows." /><EmptyState title="Coming soon" description="The workflow designer is being built." /></>);
}
