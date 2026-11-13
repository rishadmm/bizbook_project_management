import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

/** Placeholder: replaced by the approval engine inbox (AUTH_SPEC section D). */
export default async function ApprovalsPage() {
  await requirePage("approvals");
  return (<><PageHeader title="Approvals" description="Your approval inbox." /><EmptyState title="Coming soon" description="The approval inbox is being built." /></>);
}
