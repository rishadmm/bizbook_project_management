import { notFound } from "next/navigation";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { Button, PageHeader, Select, StatusBadge, Tabs, resolveTab, type TabDef } from "@/components/ui";
import { getProjectMetrics } from "@/lib/metrics";
import { statusOptions } from "@/lib/status";
import { updateProjectStatus } from "@/features/projects/actions";
import { countByTab, getProjectRow, getStages } from "@/features/projects/queries";
import { RagChip } from "@/features/projects/components/common";
import { InvoicesTab, DelaysTab } from "@/features/projects/components/tabs3";
import { BudgetTab, ProgressTab, SubcontractsTab } from "@/features/projects/components/tabs2";
import { MapTab, OverviewTab, StagesTab, SubProjectsTab } from "@/features/projects/components/tabs1";
import { requirePage } from "@/lib/auth";

type SP = { tab?: string; edit?: string; stage?: string; sub?: string; status?: string };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await requirePage("projects");
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  const project = Number.isInteger(id) ? getProjectRow(id) : undefined;
  if (!project) notFound();

  const metrics = getProjectMetrics(id);
  const stages = getStages(id, metrics);
  const counts = countByTab(id);
  const tabs: TabDef[] = [
    { key: "overview", label: "Overview" },
    { key: "map", label: "Map" },
    { key: "stages", label: "Stages", count: counts.stages },
    { key: "subprojects", label: "Sub-projects", count: counts.subprojects },
    { key: "subcontracts", label: "Subcontracts", count: counts.subcontracts },
    { key: "progress", label: "Progress", count: counts.progress || undefined },
    { key: "budget", label: "Budget & Cost" },
    { key: "invoices", label: "Invoices & Certificates" },
    { key: "delays", label: "Delays & Issues", count: counts.issues || undefined },
    { key: "documents", label: "Documents" },
    { key: "activity", label: "Activity" },
  ];
  const tab = resolveTab(sp, tabs, "overview");
  const base = `/projects/${id}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, ...(project.parent_id ? [{ label: project.parent_code ?? "Parent", href: `/projects/${project.parent_id}` }] : []), { label: project.code }]}
        title={`${project.code} · ${project.name}`}
        description={[project.client_name, project.region, project.manager_name ? `PM ${project.manager_name}` : null, project.tender_code ? `Tender ${project.tender_code}` : null].filter(Boolean).join(" · ")}
        badges={<><StatusBadge kind="projectStatus" value={project.status} /><RagChip rag={metrics.rag} /></>}
        actions={
          <form action={updateProjectStatus} className="flex items-center gap-2">
            <input type="hidden" name="id" value={id} />
            <Select name="status" defaultValue={project.status} options={statusOptions("projectStatus")} className="!w-36 !py-1.5" />
            <Button type="submit" size="sm">Set status</Button>
          </form>
        }
      />
      <Tabs tabs={tabs} active={tab} basePath={base} />

      {tab === "overview" && <OverviewTab project={project} stages={stages} metrics={metrics} />}
      {tab === "map" && <MapTab project={project} stages={stages} edit={sp.edit === "1"} />}
      {tab === "stages" && <StagesTab project={project} stages={stages} />}
      {tab === "subprojects" && <SubProjectsTab project={project} />}
      {tab === "subcontracts" && <SubcontractsTab project={project} stages={stages} />}
      {tab === "progress" && <ProgressTab project={project} stages={stages} filters={{ stageId: Number(sp.stage) || undefined, subcontractorId: Number(sp.sub) || undefined, status: sp.status || undefined }} />}
      {tab === "budget" && <BudgetTab project={project} stages={stages} />}
      {tab === "invoices" && <InvoicesTab project={project} />}
      {tab === "delays" && <DelaysTab project={project} stages={stages} />}
      {tab === "documents" && <AttachmentsPanel entityType="project" entityId={id} revalidate={base} />}
      {tab === "activity" && <ActivityTimeline entityType="project" entityId={id} />}
    </>
  );
}
