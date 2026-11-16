import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarCheck, FileBarChart, Gauge, Landmark, Percent, Route, TimerReset, Wallet } from "lucide-react";
import { Badge, CardSection, EmptyState, PageHeader, Stat, StatusBadge, Tabs, resolveTab, type TabDef } from "@/components/ui";
import { SCurveChart } from "@/features/projects/components/Charts";
import { formatDate, formatMoney, formatRatio, todayISO } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { CAUSE_LABEL, getClientProject, listIssues, listPhotos, projectSCurve, stageRows, weeklyProgress } from "@/features/client-portal/data";
import { getClientMap } from "@/features/client-portal/map-server";
import ClientPortfolioMap from "@/features/client-portal/components/ClientPortfolioMap";
import PhotoGallery from "@/features/client-portal/components/PhotoGallery";
import Gantt from "@/features/client-portal/components/Gantt";
import { ActualPlanBar, RAG_HEX, RagBadge, Ring, SegBadge, fmtQty, slipClass, slipText, unitLabel } from "@/features/client-portal/components/bits";

export const metadata = { title: "Project" };

export default async function ClientProjectPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug, id: idStr } = await params;
  const s = await requireClientUser(slug);
  const id = Number(idStr);
  // another client's project (or one outside this user's scope) is simply "not found"
  const p = Number.isInteger(id) ? getClientProject(s, id) : undefined;
  if (!p) notFound();
  const base = `/c/${slug}`;
  const here = `${base}/projects/${id}`;
  const stages = stageRows(s, id);
  const issues = listIssues(s, { projectId: id });
  const photos = listPhotos(s, { projectId: id, limit: 60 });
  const openIssues = issues.filter((i) => i.status !== "closed");
  const tabs: TabDef[] = [
    { key: "overview", label: "Overview" }, { key: "map", label: "Map" }, { key: "schedule", label: "Schedule", count: stages.length || undefined }, { key: "progress", label: "Progress" },
    { key: "photos", label: "Photos", count: photos.length || undefined }, { key: "issues", label: "Issues & delays", count: openIssues.length || undefined }, { key: "reports", label: "Reports" },
  ];
  const tab = resolveTab(await searchParams, tabs, "overview");
  const today = todayISO();
  const ragHex = RAG_HEX[p.rag] === "#94A3B8" ? "#635BFF" : RAG_HEX[p.rag];
  const q = `project=${id}`;

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Projects", href: `${base}/projects` }, { label: p.code }]} title={`${p.code} · ${p.name}`}
        description={[p.region, p.category?.replace(/_/g, " "), p.managerName ? `Project manager ${p.managerName}` : null].filter(Boolean).join(" · ")}
        badges={<><StatusBadge kind="projectStatus" value={p.status} /><RagBadge rag={p.rag} /></>} />
      <Tabs tabs={tabs} active={tab} basePath={here} />

      {tab === "overview" && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-6" data-testid="project-kpis">
            <Stat label="Complete" value={`${p.actualPct.toFixed(0)}%`} hint={`plan ${p.plannedPct.toFixed(0)}%`} icon={<Percent />} />
            <Stat label="Schedule index" value={formatRatio(p.spi)} tone={p.spi === null ? "default" : p.spi >= 0.95 ? "good" : p.spi >= 0.85 ? "warn" : "bad"} hint="actual ÷ planned" icon={<Gauge />} />
            <Stat label="Projected slip" value={p.slipDays > 0 ? `+${p.slipDays} d` : "On plan"} tone={p.slipDays > 14 ? "bad" : p.slipDays > 0 ? "warn" : "good"} icon={<TimerReset />} />
            <Stat label="Length" value={p.lengthKm ? `${p.lengthKm.toFixed(1)} km` : "—"} hint={p.lengthKm ? `${p.doneKm.toFixed(1)} km completed` : undefined} icon={<Route />} />
            <Stat label="Open issues" value={p.openIssues} tone={p.openIssues ? "warn" : "default"} icon={<AlertTriangle />} />
            {p.contractValue !== null && <Stat label="Contract value" value={formatMoney(p.contractValue, { compact: true })} icon={<Landmark />} />}
            {p.valueDone !== null && <Stat label="Value of work done" value={formatMoney(p.valueDone, { compact: true })} icon={<Wallet />} />}
          </div>
          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <CardSection title="Completion forecast" subtitle="Planned vs projected finish" className="lg:col-span-2">
              <div className="flex flex-wrap items-center gap-6">
                <Ring actual={p.actualPct} planned={p.plannedPct} color={ragHex} />
                <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3" data-testid="forecast">
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-muted">Planned start</div><div className="text-sm font-extrabold text-dark">{formatDate(p.startDate)}</div></div>
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-muted">Planned finish</div><div className="text-sm font-extrabold text-dark">{formatDate(p.endDate)}</div></div>
                  <div><div className="text-[11px] font-bold uppercase tracking-wider text-muted">Projected finish</div><div className="text-sm font-extrabold text-dark">{formatDate(p.projectedFinish)}</div></div>
                  <div className="col-span-2 sm:col-span-3"><span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-extrabold ${p.slipDays > 14 ? "bg-red-50" : p.slipDays > 0 ? "bg-amber-50" : "bg-green-50"} ${slipClass(p.slipDays)}`}><CalendarCheck size={14} />{p.slipDays > 0 ? `${p.slipDays} days behind the planned finish` : "On plan"}</span></div>
                  <div className="col-span-2 sm:col-span-3"><ActualPlanBar actual={p.actualPct} planned={p.plannedPct} rag={p.rag} /></div>
                </div>
              </div>
            </CardSection>
            <CardSection title="Project details">
              <dl className="space-y-3 text-sm">
                {([["Location", p.location], ["Region", p.region], ["Category", p.category?.replace(/_/g, " ") ?? null], ["Project manager", p.managerName], ["Contact", [p.managerPhone, p.managerEmail].filter(Boolean).join(" · ") || null]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="font-semibold text-slate-700">{v ?? "—"}</dd></div>
                ))}
              </dl>
            </CardSection>
          </div>
        </>
      )}

      {tab === "map" && (
        <CardSection title="Project map" subtitle="Colour = schedule health · marker = where the plan says the work should be" flush className="overflow-hidden">
          <ClientPortfolioMap payload={getClientMap(s).payload} projectId={id} height={520} />
          <div className="border-t border-line p-3 text-right"><Link href={`${base}/map?project=${id}`} className="text-xs font-extrabold text-primary hover:underline">Open in the live map (time machine, delay causes) →</Link></div>
        </CardSection>
      )}

      {tab === "schedule" && (
        <div className="space-y-5">
          <CardSection title="Programme" subtitle="Planned bar, actual progress and projected overrun per stage"><Gantt rows={stages} today={today} /></CardSection>
          <CardSection title="Stages" flush>
            {stages.length === 0 ? <div className="p-4"><EmptyState title="No stages defined yet" /></div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="schedule-table">
                <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>{["Stage", "Contractor", "Planned", "Plan %", "Actual %", "Projected end", "Slip", "Status"].map((h) => <th key={h} className="border-b border-line px-3 py-2.5">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-[#f1f5f9]">{stages.map((r) => (
                  <tr key={r.id} className="hover:bg-[#f8fafc]">
                    <td className="px-3 py-2.5"><span className="mr-1.5 text-xs font-bold text-muted">{r.code}</span><span className="font-bold text-dark">{r.name}</span></td>
                    <td className="px-3 py-2.5 text-xs">{r.contractors.length ? r.contractors.join(", ") : <span className="text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(r.plannedStart)} – {formatDate(r.plannedEnd)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{r.plannedPct.toFixed(0)}%</td>
                    <td className="px-3 py-2.5 font-bold tabular-nums">{r.actualPct.toFixed(0)}%</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(r.projectedEnd)}</td>
                    <td className={`whitespace-nowrap px-3 py-2.5 text-xs font-extrabold ${slipClass(r.slipDays)}`}>{r.projectedEnd ? slipText(r.slipDays) : "—"}</td>
                    <td className="px-3 py-2.5">{r.segStatus ? <SegBadge status={r.segStatus} /> : <StatusBadge kind="stageStatus" value={r.status} />}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </CardSection>
        </div>
      )}

      {tab === "progress" && (() => {
        const curve = projectSCurve(s, id);
        const weeks = weeklyProgress(s, id);
        return (
          <div className="space-y-5">
            <CardSection title="S-curve" subtitle="Planned vs actual cumulative progress (verified reports)">
              {curve.length === 0 ? <p className="text-sm text-slate-400">Not enough schedule data.</p> : <SCurveChart data={curve} today={today} />}
            </CardSection>
            <CardSection title="Quantities by stage" subtitle="Verified quantity done vs total" flush>
              {stages.length === 0 ? <p className="p-5 text-sm text-slate-400">No stages defined yet.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="quantities-table">
                  <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr><th className="border-b border-line px-3 py-2.5">Stage</th><th className="border-b border-line px-3 py-2.5 text-right">Done</th><th className="border-b border-line px-3 py-2.5 text-right">Total</th><th className="w-48 border-b border-line px-3 py-2.5">Progress</th></tr></thead>
                  <tbody className="divide-y divide-[#f1f5f9]">{stages.map((r) => {
                    const pct = r.qty > 0 ? Math.min(100, (r.doneQty / r.qty) * 100) : r.actualPct;
                    return (<tr key={r.id}><td className="px-3 py-2.5"><span className="mr-1.5 text-xs font-bold text-muted">{r.code}</span>{r.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.qty > 0 ? `${fmtQty(r.doneQty)} ${unitLabel(r.unit)}` : "—"}</td><td className="px-3 py-2.5 text-right tabular-nums">{r.qty > 0 ? `${fmtQty(r.qty)} ${unitLabel(r.unit)}` : "—"}</td>
                      <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div><span className="w-10 text-right text-xs tabular-nums text-slate-600">{pct.toFixed(0)}%</span></div></td></tr>);
                  })}</tbody>
                </table></div>
              )}
            </CardSection>
            <CardSection title="Weekly progress" subtitle="Last 16 weeks · verified reports only" flush>
              {weeks.length === 0 ? <p className="p-5 text-sm text-slate-400">No verified progress yet.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="weekly-table">
                  <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>{["Week ending", "Reports", "Quantity", "Progress gained", "Cumulative", "Avg. crew"].map((h) => <th key={h} className="border-b border-line px-3 py-2.5">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-[#f1f5f9]">{weeks.map((w) => (
                    <tr key={w.weekEnd}><td className="whitespace-nowrap px-3 py-2">{formatDate(w.weekEnd)}</td><td className="px-3 py-2 tabular-nums">{w.reports}</td>
                      <td className="px-3 py-2 tabular-nums">{w.qty > 0 ? `${fmtQty(w.qty)} ${w.unit ? unitLabel(w.unit) : ""}`.trim() : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{w.gained > 0 ? `+${w.gained.toFixed(1)} pts` : "—"}</td><td className="px-3 py-2 font-bold tabular-nums">{w.cumulative.toFixed(1)}%</td><td className="px-3 py-2 tabular-nums">{w.avgManpower || "—"}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </CardSection>
          </div>
        );
      })()}

      {tab === "photos" && (
        <CardSection title="Site photos" subtitle="From verified progress reports">
          {photos.length === 0 ? <EmptyState title="No photos yet" description="Photos appear here once progress reports with photos are verified by the project team." /> : <PhotoGallery photos={photos.map((f) => ({ id: f.id, caption: `${f.projectCode}${f.stageName ? ` · ${f.stageName}` : ""}`, date: formatDate(f.date) }))} />}
        </CardSection>
      )}

      {tab === "issues" && (
        <CardSection title="Issues & delays" subtitle={`${openIssues.length} open of ${issues.length}`} flush>
          {issues.length === 0 ? <div className="p-4"><EmptyState title="No issues recorded" /></div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="issues-table">
              <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>{["Issue", "Stage", "Status", "Responsibility", "Impact", "Raised", "Resolved"].map((h) => <th key={h} className="border-b border-line px-3 py-2.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#f1f5f9]">{issues.map((i) => (
                <tr key={i.id} className="hover:bg-[#f8fafc]"><td className="px-3 py-2.5"><Link href={`${base}/issues/${i.id}`} className="font-bold text-primary-dark hover:underline">{i.title}</Link></td><td className="px-3 py-2.5 text-xs">{i.stageName ?? "—"}</td>
                  <td className="px-3 py-2.5"><StatusBadge kind="issueStatus" value={i.status} /></td><td className="px-3 py-2.5"><Badge tone="slate">{CAUSE_LABEL[i.resp] ?? i.resp}</Badge></td>
                  <td className="px-3 py-2.5 tabular-nums">{i.impactDays ? `${i.impactDays} d` : "—"}</td><td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(i.raisedOn)}</td><td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(i.resolvedOn)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </CardSection>
      )}

      {tab === "reports" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {([["progress", "Project progress report", "Summary, stage table, S-curve and photos as of a date."], ["schedule", "Schedule & forecast", "Planned vs projected finish per stage, with slip."],
            ["issues", "Issues & delays", "All issues of this project, filterable by status and responsibility."], ["monthly", "Monthly progress summary", "Quantities, progress gained and key photos for a month."]] as const).map(([k, t, d]) => (
            <Link key={k} href={`${base}/reports/${k}?${q}`} className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 shadow-card hover:border-primary">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary"><FileBarChart size={18} /></span>
              <span><span className="block text-sm font-extrabold text-dark">{t}</span><span className="block text-xs text-slate-500">{d}</span></span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
