import { PageHeader, CardSection } from "@/components/ui";
import { createSubcontractor } from "@/features/subcontractors/actions";
import { ProfileForm } from "@/features/subcontractors/components/ProfileForm";
import { requirePage } from "@/lib/auth";

export default async function NewSubcontractorPage() {
  await requirePage("subcontractors", "create");
  return (
    <>
      <PageHeader title="New subcontractor" description="Creates the record and the default onboarding checklist." breadcrumbs={[{ label: "Subcontractors", href: "/subcontractors" }, { label: "New" }]} />
      <CardSection><ProfileForm action={createSubcontractor} submitLabel="Create subcontractor" /></CardSection>
    </>
  );
}
