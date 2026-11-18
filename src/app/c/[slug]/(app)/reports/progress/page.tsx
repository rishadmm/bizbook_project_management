import { Badge, CardSection, EmptyState, StatusBadge } from "@/components/ui";
import { SCurveChart } from "@/features/projects/components/Charts";
import { formatDate, formatRatio } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { getClientView } from "@/features/client-portal/data";
import { progressReport } from "@/features/client-portal/reports";
import ReportFrame from "@/features/client-portal/components/ReportFrame";
import { DateParam, SelectParam } from "@/features/client-portal/components/Controls";
import PhotoGallery from "@/features/client-portal/components/PhotoGallery";
import { ActualPlanBar, RAG_LABEL, RagBadge, fmtQty, slipClass, slipText, unitLabel } from "@/features/client-portal/components/bits";

export const metadata = { title: "Project progress report" };

export default async function ProgressReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string; date?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const r = progressReport(s, sp.project, sp.date);
  const qs = new URLSearchParams({ report: "progress", ...(sp.project ? { project: sp.project } : {}), ...(sp.date ? { date: sp.date } : {}) });
  return (
    <ReportFrame slug={slug} title="Project progress report" subtitle={`as of ${formatDate(r.asOf)}`} clientName={s.client.name} tenant={s.entity.legal_name} csvHref={`/c/${slug}/reports/export?${qs}`}
      controls={<><SelectParam name="project" label="Project" value={sp.project ?? ""} options={v.projects.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))} all="All projects" /><DateParam name="date" label="As of" value={sp.date ?? ""} max={r.today} /></>}>
      {r.items.length === 0 && <EmptyState title="No projects to report" />}
      {r.items.map(({ project: p, stages, curve, photos }) => (
        <section key={p.id} className="break-inside-avoid rounded-2xl border border-line bg-white p-5 shadow-card" data-testid="report-project">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div><div className="text-[11px] font-extrabold tracking-wide text-muted">{p.code}</div><h2 className="text-lg font-extrabold text-dark">{p.name}</h2><div className="text-xs text-slate-500">{[p.region, p.managerName ? `Project manager ${p.managerName}` : null].filter(Boolean).join(" · ")}</div></div>
            <div className="flex items-center gap-2"><StatusBadge kind="projectStatus" value={p.status} /><RagBadge rag={p.asRag} label={RAG_LABEL[p.asRag as keyof typeof RAG_LABEL]} /></div>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {([["Complete", `${p.asActual.toFixed(1)}%`], ["Planned", `${p.asPlanned.toFixed(1)}%`], ["Schedule index", formatRatio(p.asSpi)], ["Planned finish", formatDate(p.endDate)], ["Projected finish", formatDate(p.asProjected)]] as const).map(([k, val]) => (
              <div key={k}><div className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</div><div className="font-extrabold text-dark">{val}</div></div>
            ))}
          </div>
          <div className="mb-1 flex items-center justify-between text-xs"><span className={`font-extrabold ${slipClass(p.asSlip)}`}>{slipText(p.asSlip)}</span></div>
          <ActualPlanBar actual={p.asActual} planned={p.asPlanned} rag={p.asRag as "green"} />
          <h3 className="mb-2 mt-5 text-sm font-extrabold text-dark">Stages</h3>
          {stages.length === 0 ? <p className="text-sm text-slate-400">No stages defined.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>{["Stage", "Planned", "Plan %", "Actual %", "Quantity done", "Projected end", "Slip"].map((h) => <th key={h} className="border-b border-line px-3 py-2">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#f1f5f9]">{stages.map((st) => (
                <tr key={st.id}><td className="px-3 py-2"><span className="mr-1 text-xs font-bold text-muted">{st.code}</span>{st.name}</td><td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(st.plannedStart)} – {formatDate(st.plannedEnd)}</td>
                  <td className="px-3 py-2 tabular-nums">{st.plannedPct.toFixed(0)}%</td><td className="px-3 py-2 font-bold tabular-nums">{st.actualPct.toFixed(0)}%</td>
                  <td className="px-3 py-2 tabular-nums">{st.qty > 0 ? `${fmtQty(st.doneQty)} / ${fmtQty(st.qty)} ${unitLabel(st.unit)}` : "—"}</td><td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(st.projectedEnd)}</td>
                  <td className={`px-3 py-2 text-xs font-extrabold ${slipClass(st.slipDays)}`}>{st.projectedEnd ? slipText(st.slipDays) : "—"}</td></tr>))}</tbody></table></div>
          )}
          {curve.length > 0 && <><h3 className="mb-2 mt-5 text-sm font-extrabold text-dark">S-curve</h3><SCurveChart data={curve} today={r.asOf} /></>}
          <h3 className="mb-2 mt-5 text-sm font-extrabold text-dark">Photos of the period <span className="text-xs font-medium text-slate-400">(last 30 days up to {formatDate(r.asOf)})</span></h3>
          {photos.length === 0 ? <p className="text-sm text-slate-400">No verified photos in this period.</p> : <PhotoGallery compact photos={photos.map((f) => ({ id: f.id, caption: `${f.projectCode}${f.stageName ? ` · ${f.stageName}` : ""}`, date: formatDate(f.date) }))} />}
        </section>
      ))}
      <CardSection><p className="text-xs text-slate-500"><Badge tone="slate">Note</Badge> Figures are based on progress reports verified by the project team up to the selected date.</p></CardSection>
    </ReportFrame>
  );
}
