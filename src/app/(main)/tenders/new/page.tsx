import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { requirePage } from "@/lib/auth";
import { createTender } from "@/features/tenders/actions";
import { lookups } from "@/features/tenders/queries";
import { TenderForm } from "@/features/tenders/components/TenderForm";

export default async function NewTenderPage() {
  const { clients, users } = lookups();
  const me = await requirePage("tenders", "create");
  return (
    <>
      <PageHeader title="New tender" breadcrumbs={[{ label: "Tenders", href: "/tenders" }, { label: "New" }]} description="Creates revision R0 and the default department sections." />
      <Card className="max-w-4xl p-5"><TenderForm action={createTender} clients={clients} users={users} defaultOwner={me.id} submitLabel="Create tender" /></Card>
    </>
  );
}
