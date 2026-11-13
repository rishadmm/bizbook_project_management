import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
/** Placeholder for modules still to be built. */
export function ComingSoon({ title }: { title: string }) {
  return (<><PageHeader title={title} /><EmptyState title="Coming soon" description="This module is being built." /></>);
}
