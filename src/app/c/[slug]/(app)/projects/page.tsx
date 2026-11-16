import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import { CardSection, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { requireClientUser } from "@/lib/client-portal-auth";
import { getClientView } from "@/features/client-portal/data";
import { ActualPlanBar, ProjectCard, RAG_LABEL, RagBadge, slipClass, slipText } from "@/features/client-portal/components/bits";
import type { Rag } from "@/features/ops-map/types";

export const metadata = { title: "Projects" };

const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${on ? "border-primary bg-primary text-white shadow-brand-sm" : "border-line bg-white text-slate-600 hover:border-primary hover:text-primary"}`;

export default async function ClientProjects({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; rag?: string; status?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requireClientUser(slug);
  const v = getClientView(s);
  const base = `/c/${slug}/projects`;
  const view = sp.view === "table" ? "table" : "cards";
  const rags = (["green", "amber", "red", "grey"] as Rag[]).filter((r) => v.projects.some((p) => p.rag === r));
  const statuses = [...new Set(v.projects.map((p) => p.status))];
  const rag = rags.find((r) => r === sp.rag) ?? "";
  const status = statuses.find((x) => x === sp.status) ?? "";
  const shown = v.projects.filter((p) => (!rag || p.rag === rag) && (!status || p.status === status));
  const href = (o: { view?: string; rag?: string; status?: string }) => {
    const q = new URLSearchParams();
    const m = { view: o.view ?? view, rag: o.rag ?? rag, status: o.status ?? status };
    for (const [k, val] of Object.entries(m)) if (val && !(k === "view" && val === "cards")) q.set(k, val);
    return `${base}${q.size ? `?${q}` : ""}`;
  };
  return (
    <>
      <PageHeader title="Projects" description={`${v.projects.length} project${v.projects.length === 1 ? "" : "s"} with ${s.client.name}`}
        actions={<div className="flex gap-1.5" role="group" aria-label="View">
          <Link href={href({ view: "cards" })} aria-current={view === "cards"} className={chip(view === "cards")}><LayoutGrid size={13} />Cards</Link>
          <Link href={href({ view: "table" })} aria-current={view === "table"} className={chip(view === "table")}><Table2 size={13} />Table</Link>
        </div>} />
      {v.projects.length > 0 && (
        <nav aria-label="Filters" className="mb-4 flex flex-wrap gap-1.5">
          <Link href={href({ rag: "", status: "" })} className={chip(!rag && !status)}>All <span className="tabular-nums opacity-80">{v.projects.length}</span></Link>
          {rags.map((r) => <Link key={r} href={href({ rag: rag === r ? "" : r })} aria-current={rag === r} className={chip(rag === r)}>{RAG_LABEL[r]} <span className="tabular-nums opacity-80">{v.projects.filter((p) => p.rag === r).length}</span></Link>)}
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
          {statuses.map((x) => <Link key={x} href={href({ status: status === x ? "" : x })} aria-current={status === x} className={chip(status === x)}>{x.replace(/_/g, " ")}</Link>)}
        </nav>
      )}
      {v.projects.length === 0 ? <EmptyState title="No projects yet" description="Projects appear here once your project manager has set them up for you." />
        : shown.length === 0 ? <EmptyState title="No projects match these filters" />
        : view === "cards" ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shown.map((p) => <ProjectCard key={p.id} p={p} base={`/c/${slug}`} showFin={v.showFin} />)}</div>
        : (
          <CardSection flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="projects-table">
                <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr>
                  {["Project", "Status", "Health", "Progress", "Planned finish", "Projected finish", "Slip", ...(v.showFin ? ["Contract value"] : [])].map((h) => <th key={h} className={`border-b border-line px-3 py-2.5 ${h === "Contract value" ? "text-right" : ""}`}>{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {shown.map((p) => (
                    <tr key={p.id} className="hover:bg-[#f8fafc]" data-testid="project-row">
                      <td className="px-3 py-2.5"><Link href={`${base}/${p.id}`} className="font-bold text-primary-dark hover:underline">{p.code}</Link><div className="text-xs text-slate-500">{p.name}</div></td>
                      <td className="px-3 py-2.5"><StatusBadge kind="projectStatus" value={p.status} /></td>
                      <td className="px-3 py-2.5"><RagBadge rag={p.rag} /></td>
                      <td className="w-48 px-3 py-2.5"><div className="mb-1 text-xs font-bold tabular-nums">{p.actualPct.toFixed(0)}% <span className="font-medium text-slate-400">/ plan {p.plannedPct.toFixed(0)}%</span></div><ActualPlanBar actual={p.actualPct} planned={p.plannedPct} rag={p.rag} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(p.endDate)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDate(p.projectedFinish)}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-xs font-extrabold ${slipClass(p.slipDays)}`}>{slipText(p.slipDays)}</td>
                      {v.showFin && <td className="px-3 py-2.5 text-right tabular-nums">{p.contractValue !== null ? formatMoney(p.contractValue, { compact: true }) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardSection>
        )}
    </>
  );
}
