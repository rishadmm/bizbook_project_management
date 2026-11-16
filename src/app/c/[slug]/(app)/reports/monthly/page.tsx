import { EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { getClientView } from "@/features/client-portal/data";
import { monthlyReport } from "@/features/client-portal/reports";
import ReportFrame from "@/features/client-portal/components/ReportFrame";
import { DateParam, SelectParam } from "@/features/client-portal/components/Controls";
import PhotoGallery from "@/features/client-portal/components/PhotoGallery";
import { fmtQty, unitLabel } from "@/features/client-portal/components/bits";

export const metadata = { title: "Monthly progress summary" };

export default async function MonthlyReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string; month?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const r = monthlyReport(s, sp.project, sp.month);
  const qs = new URLSearchParams({ report: "monthly", month: r.month, ...(sp.project ? { project: sp.project } : {}) });
  return (
    <ReportFrame slug={slug} title="Monthly progress summary" subtitle={r.label} clientName={s.client.name} csvHref={`/c/${slug}/reports/export?${qs}`}
      controls={<><SelectParam name="project" label="Project" value={sp.project ?? ""} options={v.projects.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))} all="All projects" /><DateParam name="month" label="Month" type="month" value={r.month} max={v.today.slice(0, 7)} /></>}>
      {r.items.length === 0 && <EmptyState title="No projects to report" />}
      {r.items.map((it) => (
        <section key={it.project.id} className="break-inside-avoid rounded-2xl border border-line bg-white p-5 shadow-card" data-testid="report-project">
          <div className="mb-3"><div className="text-[11px] font-extrabold tracking-wide text-muted">{it.project.code}</div><h2 className="text-lg font-extrabold text-dark">{it.project.name}</h2></div>
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {([["Progress gained", `+${it.gained.toFixed(1)} pts`], ["Start of month", `${it.startPct.toFixed(1)}%`], ["End of month", `${it.endPct.toFixed(1)}%`], ["Reported crew-days", it.manDays ? it.manDays.toLocaleString("en-US") : "—"]] as const).map(([k, val]) => (
              <div key={k}><div className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</div><div className="font-extrabold text-dark">{val}</div></div>
            ))}
          </div>
          <h3 className="mb-2 text-sm font-extrabold text-dark">Quantities done in {r.label}</h3>
          {it.stageQty.length === 0 ? <p className="text-sm text-slate-400">No verified quantities this month.</p> : (
            <div className="overflow-x-auto"><table className="w-full max-w-xl text-sm"><thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr><th className="border-b border-line px-3 py-2">Stage</th><th className="border-b border-line px-3 py-2 text-right">Quantity</th></tr></thead>
              <tbody className="divide-y divide-[#f1f5f9]">{it.stageQty.map((q) => <tr key={q.stage}><td className="px-3 py-2">{q.stage}</td><td className="px-3 py-2 text-right tabular-nums">{fmtQty(q.qty)} {unitLabel(q.unit)}</td></tr>)}</tbody></table></div>
          )}
          <h3 className="mb-2 mt-5 text-sm font-extrabold text-dark">Key photos</h3>
          {it.photos.length === 0 ? <p className="text-sm text-slate-400">No verified photos this month ({formatDate(r.from)} – {formatDate(r.to)}).</p> : <PhotoGallery compact photos={it.photos.map((f) => ({ id: f.id, caption: `${f.projectCode}${f.stageName ? ` · ${f.stageName}` : ""}`, date: formatDate(f.date) }))} />}
        </section>
      ))}
    </ReportFrame>
  );
}
