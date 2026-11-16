import Link from "next/link";
import { AlertTriangle, BriefcaseBusiness, CalendarClock, CheckCircle2, Gauge, Landmark, Percent, Route, TimerReset, TrendingDown, Wallet } from "lucide-react";
import { CardSection, PageHeader, Stat } from "@/components/ui";
import { SCurveChart } from "@/features/projects/components/Charts";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { dashboardKpis, delaysByCause, getClientView, portfolioSCurve, recentProgress, upcomingMilestones } from "@/features/client-portal/data";
import { getClientMap } from "@/features/client-portal/map-server";
import ClientPortfolioMap from "@/features/client-portal/components/ClientPortfolioMap";
import PhotoGallery from "@/features/client-portal/components/PhotoGallery";
import { ProjectCard, fmtQty, unitLabel } from "@/features/client-portal/components/bits";

export const metadata = { title: "Dashboard" };

export default async function ClientDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const k = dashboardKpis(s);
  const curve = portfolioSCurve(s);
  const causes = delaysByCause(s);
  const miles = upcomingMilestones(s, 60);
  const feed = recentProgress(s, 8);
  const maxDays = Math.max(1, ...causes.map((c) => c.days));
  const base = `/c/${slug}`;
  return (
    <>
      <PageHeader title={`Welcome, ${s.user.name.split(" ")[0]}`} description={`${s.client.name} · ${formatDate(todayISO())}`} />
      {v.projects.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No projects are available to your account yet. Please contact your project manager.</p>
      ) : (<>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-5" data-testid="kpis">
          <Stat label="Active projects" value={k.activeProjects} hint={`${k.totalProjects} in total`} icon={<BriefcaseBusiness />} />
          <Stat label="Overall complete" value={`${k.overallPct.toFixed(0)}%`} hint="weighted, verified progress" icon={<Percent />} />
          <Stat label="On track" value={k.onTrack} tone={k.onTrack ? "good" : "default"} hint="projects" icon={<CheckCircle2 />} />
          <Stat label="At risk" value={k.atRisk} tone={k.atRisk ? "warn" : "default"} hint="projects" icon={<AlertTriangle />} />
          <Stat label="Behind" value={k.behind} tone={k.behind ? "bad" : "default"} hint="projects" icon={<TrendingDown />} />
          <Stat label="Total length" value={`${k.totalKm.toFixed(1)} km`} hint="linear works" icon={<Route />} />
          <Stat label="Completed length" value={`${k.doneKm.toFixed(1)} km`} hint={`${k.totalKm ? ((k.doneKm / k.totalKm) * 100).toFixed(0) : 0}% of length`} icon={<Gauge />} />
          <Stat label="Open issues" value={k.openIssues} tone={k.openIssues ? "warn" : "default"} icon={<AlertTriangle />} />
          <Stat label="Worst projected slip" value={k.worstSlip > 0 ? `+${k.worstSlip} d` : "On plan"} tone={k.worstSlip > 14 ? "bad" : k.worstSlip > 0 ? "warn" : "good"} hint={k.worstProject ?? "all projects"} icon={<TimerReset />} />
          {k.contractValue !== null && <Stat label="Contract value" value={formatMoney(k.contractValue, { compact: true })} hint={`${k.totalProjects} project${k.totalProjects === 1 ? "" : "s"}`} icon={<Landmark />} />}
          {k.valueDone !== null && <Stat label="Value of work done" value={formatMoney(k.valueDone, { compact: true })} hint="verified progress × contract value" icon={<Wallet />} />}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
          <CardSection title="Portfolio map" subtitle="Colour = schedule health · marker = where the plan says the work should be" flush className="overflow-hidden xl:col-span-3">
            <ClientPortfolioMap payload={getClientMap(s).payload} height={400} />
          </CardSection>
          <CardSection title="Portfolio S-curve" subtitle="Planned vs actual progress, all projects" className="xl:col-span-2">
            {curve.length === 0 ? <p className="text-sm text-slate-400">Not enough schedule data.</p> : <SCurveChart data={curve} today={todayISO()} />}
          </CardSection>
        </div>

        <section className="mb-5" aria-labelledby="health-h">
          <h2 id="health-h" className="mb-2 text-sm font-extrabold tracking-tight text-dark">Project health</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{v.projects.map((p) => <ProjectCard key={p.id} p={p} base={base} showFin={v.showFin} />)}</div>
        </section>

        <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CardSection title="Delays by cause" subtitle="Delay days recorded on verified reports and issues">
            {causes.length === 0 ? <p className="text-sm text-slate-400">No delays recorded.</p> : (
              <ul className="space-y-2.5" data-testid="delay-causes">
                {causes.map((c) => (
                  <li key={c.key}><div className="mb-1 flex justify-between text-xs font-bold text-slate-700"><span>{c.label}</span><span className="tabular-nums">{c.days} d</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(c.days / maxDays) * 100}%`, background: c.color }} /></div></li>
                ))}
              </ul>
            )}
          </CardSection>
          <CardSection title="Upcoming milestones" subtitle="Stage completions planned in the next 60 days" flush>
            {miles.length === 0 ? <p className="p-5 text-sm text-slate-400">No milestones in the next 60 days.</p> : (
              <ul className="divide-y divide-slate-100 text-sm" data-testid="milestones">
                {miles.slice(0, 8).map((m) => (
                  <li key={`${m.projectId}-${m.stageName}-${m.date}`}><Link href={`${base}/projects/${m.projectId}?tab=schedule`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#f8fafc]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary-50 text-primary"><CalendarClock size={15} /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-bold text-dark">{m.stageCode ? `${m.stageCode} · ` : ""}{m.stageName}</span><span className="block truncate text-xs text-slate-500">{m.projectCode}</span></span>
                    <span className="text-right text-xs"><span className="block font-bold text-slate-700">{formatDate(m.date)}</span><span className="text-slate-400">{m.inDays === 0 ? "today" : `in ${m.inDays} d`}</span></span>
                  </Link></li>
                ))}
              </ul>
            )}
          </CardSection>
        </div>

        <CardSection title="Recent verified progress" subtitle="Latest site progress confirmed by the project team">
          {feed.length === 0 ? <p className="text-sm text-slate-400">No verified progress yet.</p> : (
            <ul className="divide-y divide-slate-100" data-testid="progress-feed">
              {feed.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`${base}/projects/${f.projectId}?tab=progress`} className="font-bold text-primary-dark hover:underline">{f.projectCode}</Link>
                    <span className="text-sm text-slate-600"> · {f.stageName ?? "General"}</span>
                    <div className="text-xs text-slate-500">{formatDate(f.date)} · {fmtQty(f.qty)} {unitLabel(f.unit)} completed · {f.pct.toFixed(0)}% cumulative</div>
                  </div>
                  {f.photos.length > 0 && <div className="shrink-0"><PhotoGallery compact photos={f.photos.map((id) => ({ id, caption: `${f.projectCode} · ${f.stageName ?? "progress"}`, date: formatDate(f.date) }))} /></div>}
                </li>
              ))}
            </ul>
          )}
        </CardSection>
        <p className="mt-6 text-xs text-slate-400">Progress counts only reports verified by the project team.</p>
      </>)}
    </>
  );
}
