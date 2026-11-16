import { Camera } from "lucide-react";
import { CardSection, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/format";
import { requireClientUser, visibleProjectIds } from "@/lib/client-portal-auth";
import { getDb } from "@/lib/db";
import { getClientView, listPhotos } from "@/features/client-portal/data";
import { isIso } from "@/features/client-portal/reports";
import PhotoGallery from "@/features/client-portal/components/PhotoGallery";
import { DateParam, SelectParam } from "@/features/client-portal/components/Controls";

export const metadata = { title: "Photos" };

export default async function ClientPhotos({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string; stage?: string; from?: string; to?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const project = v.projects.find((p) => String(p.id) === sp.project)?.id;
  const stages = (getDb().prepare(`SELECT id, name, project_id FROM stages WHERE project_id IN (${visibleProjectIds(s).join(",") || "NULL"}) ${project ? "AND project_id = ?" : ""} ORDER BY project_id, sort, id`).all(...(project ? [project] : [])) as { id: number; name: string; project_id: number }[]);
  const stage = stages.find((x) => String(x.id) === sp.stage)?.id;
  const from = isIso(sp.from) ? sp.from : "", to = isIso(sp.to) ? sp.to : "";
  const photos = listPhotos(s, { projectId: project, stageId: stage, from: from || undefined, to: to || undefined, limit: 200 });
  const code = new Map(v.projects.map((p) => [p.id, p.code]));
  return (
    <>
      <PageHeader title="Photos" description="Site photos from progress reports verified by the project team." />
      <div className="no-print mb-4 flex flex-wrap items-end gap-3" data-testid="photo-filters">
        <SelectParam name="project" label="Project" value={project ? String(project) : ""} options={v.projects.map((p) => ({ value: String(p.id), label: p.code }))} all="All projects" />
        <SelectParam name="stage" label="Stage" value={stage ? String(stage) : ""} options={stages.map((x) => ({ value: String(x.id), label: project ? x.name : `${code.get(x.project_id)} · ${x.name}` }))} all="All stages" />
        <DateParam name="from" label="From" value={from} max={todayISO()} />
        <DateParam name="to" label="To" value={to} max={todayISO()} />
      </div>
      <CardSection title={`${photos.length} photo${photos.length === 1 ? "" : "s"}`} subtitle="Newest first">
        {photos.length === 0 ? <EmptyState title="No photos match" description="Photos appear here once progress reports with photos are verified." action={<Camera className="text-slate-300" size={20} />} />
          : <PhotoGallery photos={photos.map((f) => ({ id: f.id, caption: `${f.projectCode}${f.stageName ? ` · ${f.stageName}` : ""}`, date: formatDate(f.date) }))} />}
      </CardSection>
    </>
  );
}
