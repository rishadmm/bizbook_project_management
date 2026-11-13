import Link from "next/link";
import { AlertTriangle, Banknote, CalendarClock, FileCheck2, FolderKanban, Gauge, Trophy, Wallet } from "lucide-react";
import { Badge, CardSection, EmptyState, PageHeader, ProgressBar, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import type { MapFeature } from "@/components/map/types";
import { getCurrency, countdownLabel, daysUntil, formatDate, formatMoney, formatNumber, formatRatio, pct } from "@/lib/format";
import { getDelayAttribution, getSubcontractorPerformance } from "@/lib/metrics";
import { requirePage } from "@/lib/auth";
import { RAG_HEX, statusHex, statusLabel } from "@/lib/status";
import {
  activeProjectHealth, expiringDocuments, pendingApprovals, portfolioTotals, tenderFunnel, upcomingDeadlines,
} from "@/features/dashboard/queries";
import { extractGeometries } from "@/features/dashboard/geo";
import { BudgetActualChart, DelayChart, FunnelChart } from "@/features/dashboard/DashboardCharts";

const idxTone = (v: number | null) => (v === null ? "default" : v >= 0.95 ? "good" : v >= 0.85 ? "warn" : "bad") as "good" | "warn" | "bad" | "default";
const idxText = (v: number | null) => (v === null ? "text-slate-400" : v >= 0.95 ? "text-emerald-600" : v >= 0.85 ? "text-amber-600" : "text-red-600");

function Pending({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500"><span>{title}</span><Badge tone={count ? "amber" : "slate"}>{count}</Badge></div>
      {count === 0 ? <p className="py-1 text-xs text-slate-400">Nothing pending</p> : <ul className="divide-y divide-slate-100 text-sm">{children}</ul>}
    </div>
  );
}

export default async function DashboardPage() {
  const me = await requirePage("dashboard");
  const currency = getCurrency();
  const funnel = tenderFunnel();
  const deadlines = upcomingDeadlines();
  const health = activeProjectHealth();
  const port = portfolioTotals(health);
  const delays = getDelayAttribution(null);
  const late = getSubcontractorPerformance().filter((s) => s.delayDays > 0).sort((a, b) => b.delayDays - a.delayDays).slice(0, 6);
  const pending = pendingApprovals(me.department_id);
  const docs = expiringDocuments();
  const pendingTotal = pending.reviews.length + pending.progress.length + pending.invoices.length + pending.certs.length;

  const features: MapFeature[] = health.flatMap(({ project: p, m }) =>
    extractGeometries(p.geometry).map((g, i) => ({
      id: `${p.id}-${i}`, kind: "project" as const, geometry: g, color: RAG_HEX[m.rag], label: `${p.code} · ${p.name}`, progressPct: m.actualPct, href: `/projects/${p.id}`,
    })));

  const funnelData = funnel.rows.map((r) => ({ label: statusLabel("tenderStatus", r.status), count: r.count, value: r.value, color: statusHex("tenderStatus", r.status) }));
  const budgetData = health.map(({ project: p, m }) => ({ name: p.code.replace(/^PRJ-/, ""), budget: m.bac, earned: m.ev, actual: m.ac }));
  const delayData = delays.byResponsibility.filter((r) => r.days > 0).map((r) => ({ label: statusLabel("responsibility", r.responsibility), days: Math.round(r.days), color: statusHex("responsibility", r.responsibility) }));
  const variance = port.bac - port.ac;

  return (
    <>
      <PageHeader title="Executive dashboard" description={`Welcome back, ${me.name.split(" ")[0]}. Portfolio snapshot as of ${formatDate(new Date().toISOString())}.`} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Open pipeline" value={formatMoney(funnel.openValue, { compact: true })} hint={`${funnel.openCount} open bids`} icon={<FileCheck2 size={15} />} />
        <Stat label="Win rate" value={pct(funnel.winRate.byCount, 0)} hint={`${funnel.winRate.won} won / ${funnel.winRate.lost} lost · ${pct(funnel.winRate.byValue, 0)} by value`} icon={<Trophy size={15} />} tone={funnel.winRate.byCount !== null && funnel.winRate.byCount >= 40 ? "good" : "default"} />
        <Stat label="Active projects" value={port.count} hint={`${health.filter((h) => h.m.rag === "red").length} red · ${health.filter((h) => h.m.rag === "amber").length} amber`} icon={<FolderKanban size={15} />} />
        <Stat label="Contract value" value={formatMoney(port.contractValue, { compact: true })} icon={<Banknote size={15} />} />
        <Stat label="Budget vs actual" value={formatMoney(port.ac, { compact: true })} hint={`of ${formatMoney(port.bac, { compact: true })} budget`} tone={port.ac > port.bac ? "bad" : "default"} icon={<Wallet size={15} />} />
        <Stat label="Portfolio SPI / CPI" value={`${formatRatio(port.spi)} / ${formatRatio(port.cpi)}`} tone={idxTone(Math.min(port.spi ?? 9, port.cpi ?? 9) === 9 ? null : Math.min(port.spi ?? 9, port.cpi ?? 9))} icon={<Gauge size={15} />} />
        <Stat label="Delay days" value={formatNumber(delays.total.days)} hint={`impact ${formatMoney(delays.total.cost, { compact: true })}`} tone={delays.total.days > 30 ? "warn" : "default"} icon={<AlertTriangle size={15} />} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <CardSection title="Tender pipeline" subtitle="Bars show count; hover for value" className="lg:col-span-2">
          <FunnelChart data={funnelData} currency={currency} />
        </CardSection>
        <CardSection title="Upcoming submission deadlines" flush>
          {deadlines.length === 0 ? <div className="p-4"><EmptyState title="No upcoming deadlines" /></div> : (
            <ul className="divide-y divide-slate-100">
              {deadlines.map((d) => {
                const n = daysUntil(d.submission_deadline) ?? 99;
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg text-[10px] font-semibold ${n <= 7 ? "bg-red-50 text-red-700" : n <= 14 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                      <span className="text-sm leading-none">{n}</span>days
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/tenders/${d.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-blue-700">{d.code} · {d.title}</Link>
                      <div className="truncate text-xs text-slate-500">{formatDate(d.submission_deadline)} · {countdownLabel(d.submission_deadline)} · {formatMoney(d.value, { compact: true })}</div>
                    </div>
                    <StatusBadge kind="tenderStatus" value={d.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardSection>
      </div>

      <CardSection title="Active project health" subtitle="RAG from SPI and CPI (green at or above 0.95)" flush className="mb-5">
        {health.length === 0 ? <div className="p-4"><EmptyState title="No active projects" /></div> : (
          <Table>
            <THead><TR><TH>Project</TH><TH>Status</TH><TH className="w-48">Progress (actual vs planned)</TH><TH num>SPI</TH><TH num>CPI</TH><TH num>Budget</TH><TH num>Actual cost</TH><TH num>EAC</TH><TH num>Delay</TH><TH>Health</TH></TR></THead>
            <TBody>
              {health.map(({ project: p, m }) => (
                <TR key={p.id}>
                  <TD><Link href={`/projects/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.code}</Link><div className="max-w-64 truncate text-xs text-slate-500">{p.name}</div></TD>
                  <TD><StatusBadge kind="projectStatus" value={p.status} /></TD>
                  <TD><ProgressBar value={m.actualPct} planned={m.plannedPct} showLabel tone={m.rag === "grey" ? "blue" : m.rag === "green" ? "green" : m.rag === "amber" ? "amber" : "red"} /></TD>
                  <TD num className={`font-medium ${idxText(m.spi)}`}>{formatRatio(m.spi)}</TD>
                  <TD num className={`font-medium ${idxText(m.cpi)}`}>{formatRatio(m.cpi)}</TD>
                  <TD num>{formatMoney(m.bac, { compact: true })}</TD>
                  <TD num>{formatMoney(m.ac, { compact: true })}</TD>
                  <TD num className={m.eac > m.bac ? "text-red-600" : ""}>{formatMoney(m.eac, { compact: true })}</TD>
                  <TD num>{m.delayDays > 0 ? `${formatNumber(m.delayDays)} d` : "—"}</TD>
                  <TD><StatusBadge kind="rag" value={m.rag} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <CardSection title="Portfolio budget vs actual" subtitle={`Variance ${variance >= 0 ? "under" : "over"} budget: ${formatMoney(Math.abs(variance), { compact: true })} (actual cost vs BAC)`}>
          {budgetData.length ? <BudgetActualChart data={budgetData} currency={currency} /> : <EmptyState title="No data" />}
        </CardSection>
        <CardSection title="Active projects map" subtitle="Routes coloured by health; green shows completed portion" flush>
          {features.length ? <ProjectMapLazy features={features} height={310} legend={[{ label: "Green", color: RAG_HEX.green }, { label: "Amber", color: RAG_HEX.amber }, { label: "Red", color: RAG_HEX.red }]} /> : <div className="p-4"><EmptyState title="No project geometry" /></div>}
        </CardSection>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <CardSection title="Delay days by responsibility" subtitle={`${formatNumber(delays.total.days)} days across the portfolio`}>
          {delayData.length ? <DelayChart data={delayData} /> : <EmptyState title="No delays recorded" />}
        </CardSection>
        <CardSection title="Top late subcontractors" subtitle="Delay days attributed to the subcontractor" flush>
          {late.length === 0 ? <div className="p-4"><EmptyState title="No subcontractor delays" /></div> : (
            <Table>
              <THead><TR><TH>Subcontractor</TH><TH num>Delay days</TH><TH num>Progress</TH><TH num>SPI</TH></TR></THead>
              <TBody>
                {late.map((s) => (
                  <TR key={s.subcontractorId}>
                    <TD><Link href={`/subcontractors/${s.subcontractorId}`} className="font-medium text-blue-700 hover:underline">{s.name}</Link><div className="text-xs text-slate-500">{s.trade}</div></TD>
                    <TD num className="font-semibold text-red-600">{formatNumber(s.delayDays)}</TD>
                    <TD num>{pct(s.progressPct, 0)} <span className="text-slate-400">/ {pct(s.plannedPct, 0)}</span></TD>
                    <TD num className={idxText(s.spi)}>{formatRatio(s.spi)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CardSection title="My pending approvals" subtitle={`${me.name} · ${pendingTotal} item${pendingTotal === 1 ? "" : "s"}`}>
          <div className="space-y-4">
            <Pending title="Tender reviews (my department)" count={pending.reviews.length}>
              {pending.reviews.map((r) => <li key={r.id} className="py-1.5"><Link className="text-blue-700 hover:underline" href={`/tenders/${r.tender_id}?tab=reviews`}>{r.code}</Link> <span className="text-slate-600">{r.title}</span></li>)}
            </Pending>
            <Pending title="Portal progress to verify" count={pending.progress.length}>
              {pending.progress.slice(0, 5).map((r) => <li key={r.id} className="py-1.5"><Link className="text-blue-700 hover:underline" href={`/projects/${r.project_id}?tab=progress`}>{r.project_code}</Link> <span className="text-slate-600">{r.subcontractor_name} · {formatDate(r.report_date)}</span></li>)}
            </Pending>
            <Pending title="Invoices to certify" count={pending.invoices.length}>
              {pending.invoices.slice(0, 5).map((i) => <li key={i.id} className="flex justify-between py-1.5"><Link className="text-blue-700 hover:underline" href={`/invoices?status=${i.status}`}>{i.invoice_no ?? `#${i.id}`} · {i.subcontractor_name}</Link><span className="tabular-nums text-slate-600">{formatMoney(i.claimed_amount, { compact: true })}</span></li>)}
            </Pending>
            <Pending title="Certificate requests" count={pending.certs.length}>
              {pending.certs.slice(0, 5).map((c) => <li key={c.id} className="py-1.5"><Link className="text-blue-700 hover:underline" href={`/subcontractors`}>{c.assignment_code ?? c.project_code}</Link> <span className="text-slate-600">{c.subcontractor_name} · {statusLabel("certType", c.cert_type)} {c.percent ?? ""}%</span></li>)}
            </Pending>
          </div>
        </CardSection>
        <CardSection title="Expiring subcontractor documents" subtitle="Expired or due within 30 days" flush>
          {docs.length === 0 ? <div className="p-4"><EmptyState title="All documents valid" /></div> : (
            <Table>
              <THead><TR><TH>Subcontractor</TH><TH>Document</TH><TH>Expiry</TH></TR></THead>
              <TBody>
                {docs.slice(0, 10).map((d) => (
                  <TR key={d.id}>
                    <TD><Link href={`/subcontractors/${d.subcontractor_id}?tab=documents`} className="text-blue-700 hover:underline">{d.name}</Link></TD>
                    <TD>{statusLabel("docType", d.doc_type)}</TD>
                    <TD>{formatDate(d.expiry_date)} {d.days < 0 ? <Badge tone="red">expired {-d.days}d ago</Badge> : <Badge tone="amber">in {d.days}d</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {docs.length > 10 && <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500"><CalendarClock size={12} className="mr-1 inline" />{docs.length - 10} more</div>}
        </CardSection>
      </div>
    </>
  );
}
