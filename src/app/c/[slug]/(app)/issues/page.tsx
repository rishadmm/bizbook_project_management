import Link from "next/link";
import { Badge, CardSection, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { AlertTriangle, CheckCircle2, TimerReset } from "lucide-react";
import { formatDate } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { CAUSE_LABEL, getClientView, listIssues } from "@/features/client-portal/data";

export const metadata = { title: "Issues & delays" };
const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${on ? "border-primary bg-primary text-white shadow-brand-sm" : "border-line bg-white text-slate-600 hover:border-primary hover:text-primary"}`;

export default async function ClientIssues({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ project?: string; status?: string; resp?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const all = listIssues(s);
  const project = v.projects.find((p) => String(p.id) === sp.project)?.id;
  const status = sp.status === "open" || sp.status === "closed" ? sp.status : "";
  const resps = Object.keys(CAUSE_LABEL).filter((k) => k !== "none" && all.some((i) => i.resp === k));
  const resp = resps.find((r) => r === sp.resp) ?? "";
  const shown = listIssues(s, { projectId: project, status, resp });
  const base = `/c/${slug}/issues`;
  const href = (o: { project?: string; status?: string; resp?: string }) => {
    const q = new URLSearchParams();
    const m = { project: o.project ?? (project ? String(project) : ""), status: o.status ?? status, resp: o.resp ?? resp };
    for (const [k, val] of Object.entries(m)) if (val) q.set(k, val);
    return `${base}${q.size ? `?${q}` : ""}`;
  };
  const open = all.filter((i) => i.status !== "closed");
  return (
    <>
      <PageHeader title="Issues & delays" description="Issues affecting the programme of your projects, with the responsible party category and impact on the schedule." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open" value={open.length} tone={open.length ? "warn" : "good"} icon={<AlertTriangle />} />
        <Stat label="Closed" value={all.length - open.length} icon={<CheckCircle2 />} />
        <Stat label="Open impact" value={`${open.reduce((t, i) => t + i.impactDays, 0)} d`} hint="days on open issues" icon={<TimerReset />} />
        <Stat label="Total impact" value={`${all.reduce((t, i) => t + i.impactDays, 0)} d`} hint="all issues" icon={<TimerReset />} />
      </div>
      {all.length > 0 && (
        <nav aria-label="Filters" className="mb-4 flex flex-wrap gap-1.5">
          <Link href={href({ project: "", status: "", resp: "" })} className={chip(!project && !status && !resp)}>All <span className="tabular-nums opacity-80">{all.length}</span></Link>
          {(["open", "closed"] as const).map((x) => <Link key={x} href={href({ status: status === x ? "" : x })} aria-current={status === x} className={chip(status === x)}>{x === "open" ? "Open" : "Closed"}</Link>)}
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
          {resps.map((r) => <Link key={r} href={href({ resp: resp === r ? "" : r })} aria-current={resp === r} className={chip(resp === r)}>{CAUSE_LABEL[r]}</Link>)}
          {v.projects.length > 1 && <><span className="mx-1 hidden h-6 w-px bg-line sm:block" />{v.projects.filter((p) => all.some((i) => i.projectId === p.id)).map((p) => <Link key={p.id} href={href({ project: project === p.id ? "" : String(p.id) })} aria-current={project === p.id} className={chip(project === p.id)}>{p.code}</Link>)}</>}
        </nav>
      )}
      <CardSection flush>
        {all.length === 0 ? <div className="p-4"><EmptyState title="No issues recorded" description="Issues that affect the programme of your projects will be listed here." /></div>
          : shown.length === 0 ? <div className="p-4"><EmptyState title="No issues match these filters" /></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="issues-list">
            <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>{["Issue", "Project", "Status", "Responsibility", "Impact", "Raised", "Resolved"].map((h) => <th key={h} className="border-b border-line px-3 py-2.5">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#f1f5f9]">{shown.map((i) => (
              <tr key={i.id} className="hover:bg-[#f8fafc]" data-testid="issue-row"><td className="px-3 py-2.5"><Link href={`${base}/${i.id}`} className="font-bold text-primary-dark hover:underline">{i.title}</Link>{i.stageName && <div className="text-xs text-slate-500">{i.stageName}</div>}</td>
                <td className="px-3 py-2.5 text-xs font-bold">{i.projectCode}</td><td className="px-3 py-2.5"><StatusBadge kind="issueStatus" value={i.status} /></td><td className="px-3 py-2.5"><Badge tone="slate">{CAUSE_LABEL[i.resp] ?? i.resp}</Badge></td>
                <td className="px-3 py-2.5 tabular-nums">{i.impactDays ? `${i.impactDays} d` : "—"}</td><td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(i.raisedOn)}</td><td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(i.resolvedOn)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </CardSection>
    </>
  );
}
