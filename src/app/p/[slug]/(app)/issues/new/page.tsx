import { CardSection, EmptyState, PageHeader } from "@/components/ui";
import { requirePortalUser } from "@/lib/portal-auth";
import { statusOptions } from "@/lib/status";
import { listAssignments } from "@/features/portal/data";
import { RaiseIssueForm } from "@/features/portal/components/IssueForms";
import { ReadOnlyNote } from "@/features/portal/components/bits";

export const metadata = { title: "Raise issue / RFI" };

export default async function NewIssue({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignment?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "issues_raise");
  const asgs = listAssignments(s).filter((a) => a.status !== "terminated").map((a) => ({ value: a.id, label: `${a.code ?? `#${a.id}`} · ${a.project_code}${a.stage_name ? ` · ${a.stage_name}` : ""}` }));
  return (
    <>
      <PageHeader title="Raise an issue or RFI" breadcrumbs={[{ label: "Issues & RFIs", href: `/p/${slug}/issues` }, { label: "New" }]} description="The project team is notified and replies in the thread." />
      {s.readOnly && <ReadOnlyNote />}
      {asgs.length === 0 ? <EmptyState title="No subcontract" /> : <CardSection><RaiseIssueForm assignments={asgs} defaultAssignment={Number(sp.assignment) || undefined} responsibilities={statusOptions("responsibility")} /></CardSection>}
    </>
  );
}
