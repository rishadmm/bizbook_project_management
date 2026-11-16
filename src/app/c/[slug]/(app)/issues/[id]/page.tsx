import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, CardSection, PageHeader, StatusBadge } from "@/components/ui";
import { daysBetween, formatDate, todayISO } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { CAUSE_LABEL, getIssue } from "@/features/client-portal/data";

export const metadata = { title: "Issue" };

export default async function ClientIssue({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id: idStr } = await params;
  const s = await requireClientUser(slug);
  const i = Number.isInteger(Number(idStr)) ? getIssue(s, Number(idStr)) : undefined;
  if (!i) notFound();
  const age = i.raisedOn ? daysBetween(i.raisedOn, i.resolvedOn ?? todayISO()) : null;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Issues & delays", href: `/c/${slug}/issues` }, { label: `#${i.id}` }]} title={i.title} badges={<StatusBadge kind="issueStatus" value={i.status} />}
        description={`${i.projectCode}${i.stageName ? ` · ${i.stageName}` : ""}`} />
      <CardSection title="Details">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {([["Project", <Link key="p" href={`/c/${slug}/projects/${i.projectId}`} className="font-bold text-primary-dark hover:underline">{i.projectCode}</Link>], ["Stage", i.stageName ?? "—"], ["Responsibility", <Badge key="r" tone="slate">{CAUSE_LABEL[i.resp] ?? i.resp}</Badge>],
            ["Impact on programme", i.impactDays ? `${i.impactDays} days` : "None recorded"], ["Raised", formatDate(i.raisedOn)], ["Resolved", i.resolvedOn ? formatDate(i.resolvedOn) : "Not yet"], ["Open for", age === null ? "—" : `${age} days`]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5 font-semibold text-slate-700">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-5 text-xs text-slate-400">Read-only view. Questions about this issue? Contact your project manager.</p>
      </CardSection>
    </>
  );
}
