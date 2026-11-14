import Link from "next/link";
import { Banknote, BriefcaseBusiness, CheckCircle2, Gauge, HandCoins, Landmark, Percent, Wallet } from "lucide-react";
import { Badge, CardSection, PageHeader, ProgressBar, Stat, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import { SCurveChart } from "@/features/projects/components/Charts";
import { formatDate, formatMoney, formatRatio, pct, todayISO } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { STATUS_COLOR } from "@/features/ops-map/calc";
import { getActionItems, getRecentEvents, getStatement, listAssignments } from "@/features/portal/data";
import { companySCurve, companySegments, dashboardMapFeatures, daysLabel, scheduleHealth } from "@/features/portal/ops";
import { getAssignmentProgress } from "@/lib/metrics";
import { ActionList, RagBadge } from "@/features/portal/components/bits";

export const metadata = { title: "Dashboard" };

export default async function PortalDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug, "dashboard");
  const asgs = listAssignments(s);
  const live = asgs.filter((a) => ["active", "suspended", "completed"].includes(a.status));
  const stmt = getStatement(s);
  const items = getActionItems(s);
  const segs = companySegments(s);
  const health = scheduleHealth(asgs, segs);
  const curve = companySCurve(asgs);
  const events = getRecentEvents(s, 8);
  const features = dashboardMapFeatures(segs, slug);
  const value = live.reduce((t, a) => t + a.contract_value, 0);
  const done = value > 0 ? live.reduce((t, a) => t + a.contract_value * getAssignmentProgress(a.id).actualPct, 0) / value : 0;
  const sum = (k: "certified" | "paid" | "retention" | "outstanding") => stmt.reduce((t, r) => t + r[k], 0);
  return (
    <>
      <PageHeader title={`Welcome, ${s.user.name.split(" ")[0]}`} description={`${s.sub.name} · ${formatDate(todayISO())}`} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7" data-testid="kpis">
        <Stat label="Active subcontracts" value={asgs.filter((a) => a.status === "active").length} hint={`${asgs.length} in total`} icon={<BriefcaseBusiness />} />
        <Stat label="Contract value" value={formatMoney(value, { compact: true })} icon={<Landmark />} />
        <Stat label="Work done" value={pct(done, 0)} hint="value weighted, verified" icon={<Percent />} />
        <Stat label="Certified" value={formatMoney(sum("certified"), { compact: true })} icon={<CheckCircle2 />} />
        <Stat label="Paid" value={formatMoney(sum("paid"), { compact: true })} tone="good" icon={<Banknote />} />
        <Stat label="Outstanding" value={formatMoney(sum("outstanding"), { compact: true })} tone={sum("outstanding") > 0 ? "warn" : "default"} hint="certified, not yet paid" icon={<HandCoins />} />
        <Stat label="Retention held" value={formatMoney(sum("retention"), { compact: true })} icon={<Wallet />} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CardSection title="Action items" subtitle={`${items.length} need${items.length === 1 ? "s" : ""} your attention`} className="lg:col-span-1"><ActionList items={items} /></CardSection>
        <CardSection title="Schedule health" subtitle="Actual vs planned per subcontract" flush className="lg:col-span-2">
          {health.length === 0 ? <p className="p-5 text-sm text-slate-400">No active subcontracts.</p> : (
            <Table>
              <THead><TR><TH>Subcontract</TH><TH className="w-48">Actual vs plan</TH><TH num>SPI</TH><TH>Finish (plan → projected)</TH><TH>Status</TH></TR></THead>
              <TBody>
                {health.map((h) => (
                  <TR key={h.assignmentId} data-testid="health-row">
                    <TD><Link href={`/p/${slug}/projects/${h.assignmentId}`} className="font-bold text-primary-dark hover:underline">{h.code ?? `#${h.assignmentId}`}</Link><div className="text-xs text-slate-500">{h.project}{h.stage ? ` · ${h.stage}` : ""}</div></TD>
                    <TD><ProgressBar value={h.actualPct} planned={h.plannedPct} showLabel tone={h.rag === "grey" ? "slate" : h.rag === "green" ? "green" : h.rag === "amber" ? "amber" : "red"} /><div className="text-[10px] text-slate-400">plan {pct(h.plannedPct, 0)}</div></TD>
                    <TD num>{formatRatio(h.spi)}</TD>
                    <TD className="whitespace-nowrap text-xs">{formatDate(h.plannedEnd)} → {formatDate(h.projectedEnd)}{h.projectedEnd && h.plannedEnd && <div className={h.slipDays > 0 ? "font-semibold text-red-600" : "text-slate-400"}>{daysLabel(h.slipDays)}</div>}</TD>
                    <TD><RagBadge rag={h.rag} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardSection>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Your sections" subtitle="Green on track · amber at risk · red behind · marker = plan position" flush>
          {features.length === 0 ? <p className="p-5 text-sm text-slate-400">No mapped sections yet.</p> : (
            <ProjectMapLazy features={features} height={320} legend={[{ label: "On track", color: STATUS_COLOR.on_track }, { label: "At risk", color: STATUS_COLOR.at_risk }, { label: "Behind", color: STATUS_COLOR.behind }, { label: "Not started", color: STATUS_COLOR.not_started }]} />
          )}
        </CardSection>
        <CardSection title="S-curve" subtitle="Planned vs actual progress, all subcontracts">
          {curve.length === 0 ? <p className="text-sm text-slate-400">Not enough schedule data.</p> : <SCurveChart data={curve} today={todayISO()} />}
        </CardSection>
      </div>

      <CardSection title="Recent activity" subtitle="Verifications, certifications and payments">
        {events.length === 0 ? <p className="text-sm text-slate-400">Nothing yet.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {events.map((e) => (
              <li key={e.key}><Link href={e.href} className="flex items-center gap-3 py-2 hover:bg-[#f8fafc]"><Badge tone={e.tone === "blue" ? "blue" : e.tone}>{formatDate(e.date)}</Badge><span className="flex-1 font-semibold text-slate-700">{e.text}</span></Link></li>
            ))}
          </ul>
        )}
      </CardSection>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400"><Gauge size={12} />Progress counts only reports verified by the project team.</p>
    </>
  );
}
