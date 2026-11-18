import { Badge, EmptyState, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { CAUSE_LABEL, getClientView } from "@/features/client-portal/data";
import { issuesReport } from "@/features/client-portal/reports";
import ReportFrame from "@/features/client-portal/components/ReportFrame";
import { DateParam, SelectParam } from "@/features/client-portal/components/Controls";

export const metadata = { title: "Issues & delays report" };

export default async function IssuesReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string; status?: string; resp?: string; from?: string; to?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const r = issuesReport(s, sp);
  const qs = new URLSearchParams({ report: "issues", ...Object.fromEntries(Object.entries(sp).filter(([, x]) => x)) as Record<string, string> });
  const total = r.issues.reduce((t, i) => t + i.impactDays, 0);
  return (
    <ReportFrame slug={slug} title="Issues & delays" subtitle={`${r.issues.length} issue${r.issues.length === 1 ? "" : "s"} · ${total} days of impact`} clientName={s.client.name} tenant={s.entity.legal_name} csvHref={`/c/${slug}/reports/export?${qs}`}
      controls={<>
        <SelectParam name="project" label="Project" value={sp.project ?? ""} options={v.projects.map((p) => ({ value: String(p.id), label: p.code }))} all="All projects" />
        <SelectParam name="status" label="Status" value={r.filters.status ?? ""} options={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }]} all="Any status" />
        <SelectParam name="resp" label="Responsibility" value={r.filters.resp ?? ""} options={Object.entries(CAUSE_LABEL).filter(([k]) => k !== "none").map(([value, label]) => ({ value, label }))} all="Any responsibility" />
        <DateParam name="from" label="Raised from" value={r.filters.from ?? ""} /><DateParam name="to" label="Raised to" value={r.filters.to ?? ""} />
      </>}>
      {r.issues.length === 0 ? <EmptyState title="No issues match these filters" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-card"><table className="w-full text-sm" data-testid="issues-report">
          <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>{["Project", "Issue", "Stage", "Status", "Responsibility", "Impact", "Raised", "Resolved"].map((h) => <th key={h} className="border-b border-line px-3 py-2.5">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#f1f5f9]">{r.issues.map((i) => (
            <tr key={i.id}><td className="px-3 py-2 text-xs font-bold">{i.projectCode}</td><td className="px-3 py-2 font-semibold text-dark">{i.title}</td><td className="px-3 py-2 text-xs">{i.stageName ?? "—"}</td><td className="px-3 py-2"><StatusBadge kind="issueStatus" value={i.status} /></td>
              <td className="px-3 py-2"><Badge tone="slate">{CAUSE_LABEL[i.resp] ?? i.resp}</Badge></td><td className="px-3 py-2 tabular-nums">{i.impactDays ? `${i.impactDays} d` : "—"}</td><td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(i.raisedOn)}</td><td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(i.resolvedOn)}</td></tr>))}</tbody></table></div>
      )}
    </ReportFrame>
  );
}
