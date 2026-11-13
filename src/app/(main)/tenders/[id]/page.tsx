import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Tabs, resolveTab } from "@/components/ui/Tabs";
import { StatusBadge } from "@/components/ui/Badge";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { can, requirePage } from "@/lib/auth";
import { getCurrency } from "@/lib/format";
import { getRevisions, getBudgetLines, getMarginChanges, getNegotiations, getReviews, getSections, getTender, lookups } from "@/features/tenders/queries";
import { TERMINAL } from "@/features/tenders/workflow";
import { OverviewTab } from "@/features/tenders/components/OverviewTab";
import { DepartmentsTab } from "@/features/tenders/components/DepartmentsTab";
import { BudgetWorkspace } from "@/features/tenders/components/BudgetWorkspace";
import { CommercialTab } from "@/features/tenders/components/CommercialTab";
import { ReviewsTab } from "@/features/tenders/components/ReviewsTab";

export default async function TenderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage("tenders");
  const { id: idStr } = await params;
  const id = Number(idStr);
  const tender = Number.isInteger(id) ? getTender(id) : undefined;
  if (!tender) notFound();
  const sp = await searchParams;
  const sections = getSections(id);
  const reviews = getReviews(id);
  const revisions = getRevisions(id);
  const tabs = [
    { key: "overview", label: "Overview" }, { key: "departments", label: "Departments", count: sections.length },
    ...(can(me, "tender_budget", "view") ? [{ key: "budget", label: "Budget / BOQ" }] : []), { key: "commercial", label: "Commercial & Negotiation" },
    { key: "reviews", label: "Reviews", count: reviews.filter((r) => r.revision_id === tender.current_revision_id).length }, { key: "documents", label: "Documents" }, { key: "activity", label: "Activity" },
  ];
  const tab = resolveTab(sp, tabs, "overview");
  const { clients, users, departments } = lookups();
  const revision = revisions.find((r) => r.id === tender.current_revision_id) ?? null;
  const closed = TERMINAL.includes(tender.status);

  return (
    <>
      <PageHeader title={tender.title} breadcrumbs={[{ label: "Tenders", href: "/tenders" }, { label: tender.code }]}
        badges={<><StatusBadge kind="tenderStatus" value={tender.status} />{revision && <StatusBadge kind="revisionStatus" value={revision.status} className="opacity-80" />}</>}
        description={`${tender.code} · ${tender.client_name ?? "No client"}${revision ? ` · current revision ${revision.label}` : ""}`} />
      <Tabs tabs={tabs} active={tab} basePath={`/tenders/${id}`} />
      {tab === "overview" && <OverviewTab tender={tender} revision={revision} users={users} clients={clients} currentUser={me}
        incompleteSections={sections.filter((s) => s.status !== "completed").length} totalSections={sections.length} />}
      {tab === "departments" && <DepartmentsTab tenderId={id} sections={sections} users={users} departments={departments} locked={closed || !can(me, "tenders", "edit")} />}
      {tab === "budget" && (revision
        ? <BudgetWorkspace key={revision.id} initialLines={getBudgetLines(revision.id)} revisionId={revision.id} revisionLabel={revision.label ?? `R${revision.rev_no}`}
            editable={revision.status === "draft" && !closed && can(me, "tender_budget", "edit")} readOnlyReason={closed ? `tender is ${tender.status}` : `revision ${revision.label} is ${revision.status}`} tenderCode={tender.code} currency={getCurrency()} />
        : <p className="text-sm text-slate-500">This tender has no revision.</p>)}
      {tab === "commercial" && <CommercialTab tender={tender} revisions={revisions} negotiations={getNegotiations(id)} changes={getMarginChanges(id)} currency={getCurrency()} />}
      {tab === "reviews" && <ReviewsTab tender={tender} reviews={reviews} currentUser={me} />}
      {tab === "documents" && <AttachmentsPanel entityType="tender" entityId={id} revalidate={`/tenders/${id}`} />}
      {tab === "activity" && <ActivityTimeline entityType="tender" entityId={id} />}
    </>
  );
}
