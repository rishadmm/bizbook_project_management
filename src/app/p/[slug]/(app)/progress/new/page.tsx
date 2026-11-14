import { EmptyState, PageHeader } from "@/components/ui";
import { todayISO } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { statusOptions } from "@/lib/status";
import ProgressUpdateForm from "@/features/portal/components/ProgressUpdateForm";
import { ReadOnlyNote } from "@/features/portal/components/bits";
import { progressOptions } from "@/features/portal/progress-helpers";

export const metadata = { title: "New progress update" };

export default async function NewProgress({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignment?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "progress_submit");
  const options = progressOptions(s);
  return (
    <>
      <PageHeader title="New progress update" breadcrumbs={[{ label: "Progress updates", href: `/p/${slug}/progress` }, { label: "New" }]} description="Reports are verified by the project team before they count towards progress." />
      {s.readOnly && <ReadOnlyNote />}
      {options.length === 0 ? <EmptyState title="No active subcontract" description="Progress can only be reported on active subcontracts." /> : (
        <ProgressUpdateForm assignments={options} defaultAssignment={Number(sp.assignment) || undefined} today={todayISO()} responsibilities={statusOptions("responsibility")} cancelHref={`/p/${slug}/progress`} />
      )}
    </>
  );
}
