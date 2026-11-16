import { EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { getClientView } from "@/features/client-portal/data";
import { scheduleReport } from "@/features/client-portal/reports";
import ReportFrame from "@/features/client-portal/components/ReportFrame";
import { SelectParam } from "@/features/client-portal/components/Controls";
import Gantt from "@/features/client-portal/components/Gantt";
import { RagBadge, SegBadge, slipClass, slipText } from "@/features/client-portal/components/bits";

export const metadata = { title: "Schedule & forecast report" };

export default async function ScheduleReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const r = scheduleReport(s, sp.project);
  const qs = new URLSearchParams({ report: "schedule", ...(sp.project ? { project: sp.project } : {}) });
  return (
    <ReportFrame slug={slug} title="Schedule & forecast" subtitle={`as of ${formatDate(r.today)}`} clientName={s.client.name} csvHref={`/c/${slug}/reports/export?${qs}`}
      controls={<SelectParam name="project" label="Project" value={sp.project ?? ""} options={v.projects.map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))} all="All projects" />}>
      {r.items.length === 0 && <EmptyState title="No projects to report" />}
      {r.items.map(({ project: p, stages }) => (
        <section key={p.id} className="break-inside-avoid rounded-2xl border border-line bg-white p-5 shadow-card" data-testid="report-project">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><div className="text-[11px] font-extrabold tracking-wide text-muted">{p.code}</div><h2 className="text-lg font-extrabold text-dark">{p.name}</h2></div>
            <div className="text-right text-sm"><div className="text-xs text-slate-500">Planned {formatDate(p.endDate)} → projected <b className="text-dark">{formatDate(p.projectedFinish)}</b></div><div className={`font-extrabold ${slipClass(p.slipDays)}`}>{slipText(p.slipDays)}</div></div>
          </div>
          <div className="mb-4"><Gantt rows={stages} today={r.today} /></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>{["Stage", "Contractor", "Planned start", "Planned end", "Projected end", "Slip", "Actual", "Status"].map((h) => <th key={h} className="border-b border-line px-3 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#f1f5f9]">{stages.map((st) => (
              <tr key={st.id}><td className="px-3 py-2"><span className="mr-1 text-xs font-bold text-muted">{st.code}</span>{st.name}</td><td className="px-3 py-2 text-xs">{st.contractors.join(", ") || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(st.plannedStart)}</td><td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(st.plannedEnd)}</td><td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(st.projectedEnd)}</td>
                <td className={`px-3 py-2 text-xs font-extrabold ${slipClass(st.slipDays)}`}>{st.projectedEnd ? slipText(st.slipDays) : "—"}</td><td className="px-3 py-2 tabular-nums">{st.actualPct.toFixed(0)}%</td><td className="px-3 py-2"><SegBadge status={st.segStatus} /></td></tr>))}</tbody></table></div>
          <div className="mt-2 hidden print:block"><RagBadge rag={p.rag} /></div>
        </section>
      ))}
    </ReportFrame>
  );
}
