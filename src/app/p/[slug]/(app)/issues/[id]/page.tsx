import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { Badge, CardSection, PageHeader, StatusBadge } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { getIssue, getIssueComments } from "@/features/portal/data";
import { CommentForm } from "@/features/portal/components/IssueForms";

export const metadata = { title: "Issue" };

export default async function PortalIssue({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const s = await requirePortalUser(slug, "issues");
  const i = getIssue(s, Number(id));
  if (!i) notFound();
  const comments = getIssueComments(i.id);
  const files = getDb().prepare("SELECT id, filename FROM attachments WHERE entity_type = 'issue' AND entity_id = ? ORDER BY id").all(i.id) as { id: number; filename: string }[];
  return (
    <>
      <PageHeader title={i.title} breadcrumbs={[{ label: "Issues & RFIs", href: `/p/${slug}/issues` }, { label: `#${i.id}` }]} description={`${i.assignment_code} · ${i.project_code} · raised ${formatDate(i.raised_on)}${i.raised_by_name ? ` by ${i.raised_by_name}` : ""}`}
        badges={<><Badge tone={i.status === "closed" ? "green" : i.status === "mitigating" ? "amber" : "red"}>{i.status === "mitigating" ? "In progress" : i.status}</Badge>{i.kind === "rfi" && <Badge tone="blue">RFI</Badge>}<StatusBadge kind="responsibility" value={i.responsibility} /></>} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <CardSection title="Details">
            {i.description ? <p className="whitespace-pre-line text-sm text-slate-700">{i.description}</p> : <p className="text-sm text-slate-400">No description.</p>}
            {files.length > 0 && <ul className="mt-3 space-y-1 text-sm">{files.map((f) => <li key={f.id} className="flex items-center gap-2"><FileText size={14} className="text-primary" /><a className="font-semibold text-primary-dark hover:underline" target="_blank" rel="noreferrer" href={`/api/files/${f.id}`}>{f.filename}</a></li>)}</ul>}
          </CardSection>
          <CardSection title="Thread" subtitle={i.awaiting_party === "portal" && i.status !== "closed" ? "The project team is waiting for your response" : undefined}>
            {comments.length === 0 ? <p className="mb-4 text-sm text-slate-400">No comments yet.</p> : (
              <ul className="mb-4 space-y-2" data-testid="thread">
                {comments.map((c) => (
                  <li key={c.id} className={c.author_type === "portal" ? "rounded-xl bg-violet-50 p-3" : "rounded-xl bg-primary-50 p-3"}>
                    <div className="flex items-center gap-2 text-xs"><b className="text-dark">{c.author_name}</b><Badge tone={c.author_type === "portal" ? "violet" : "blue"}>{c.author_type === "portal" ? "Subcontractor" : "Project team"}</Badge><span className="ml-auto text-slate-400">{formatDateTime(c.created_at)}</span></div>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {i.status !== "closed" && portalCan(s.user.role, "issues_raise") ? <CommentForm issueId={i.id} /> : i.status === "closed" ? <p className="text-sm text-slate-400">This issue is closed.</p> : null}
          </CardSection>
        </div>
        <CardSection title="Summary">
          <dl className="space-y-3 text-sm">
            {[["Impact", i.impact_days ? `${i.impact_days} days` : "—"], ["Category", i.category ?? "—"], ["Waiting for", i.status === "closed" ? "—" : i.awaiting_party === "portal" ? "You" : i.awaiting_party === "internal" ? "Project team" : "—"]].map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="font-semibold text-dark">{v}</dd></div>
            ))}
          </dl>
        </CardSection>
      </div>
    </>
  );
}
