import Link from "next/link";
import { CheckCircle2, Clock, Gauge, Plus, RotateCcw } from "lucide-react";
import { CardSection, ClickRow, EmptyState, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { ENUMS, statusLabel } from "@/lib/status";
import { getAssignmentProgress } from "@/lib/metrics";
import { canWorkOn, listAssignments, listCertificates } from "@/features/portal/data";
import { Flash } from "@/features/portal/components/bits";

export const metadata = { title: "Certificates" };

const Bar = ({ value, tone = "bg-primary", h = "h-1.5" }: { value: number; tone?: string; h?: string }) => (
  <span className={`relative block ${h} w-full overflow-hidden rounded-full bg-slate-200`} role="img" aria-label={`${Math.round(value)} percent`}><span className={`absolute inset-y-0 left-0 rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
);
const chipCls = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${on ? "border-primary bg-primary text-white shadow-brand-sm" : "border-line bg-white text-slate-600 hover:border-primary hover:text-primary"}`;

export default async function PortalCertificates({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ sent?: string; status?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "certificates");
  const certs = listCertificates(s);
  const base = `/p/${slug}/certificates`;
  const canRequest = portalCan(s.user.role, "certificates_request");
  const active = listAssignments(s).filter(canWorkOn).map((a) => ({ a, pct: getAssignmentProgress(a.id).actualPct, latest: certs.find((c) => c.assignment_id === a.id) ?? null }));
  const count = (st: string) => certs.filter((c) => c.status === st).length;
  const avg = active.length ? active.reduce((t, x) => t + x.pct, 0) / active.length : 0;
  const present = Object.keys(ENUMS.certStatus).filter((k) => count(k) > 0);
  const filter = sp.status && present.includes(sp.status) ? sp.status : "";
  const shown = filter ? certs.filter((c) => c.status === filter) : certs;
  return (
    <>
      <PageHeader title="Completion certificates" description="Partial and final completion certificates for your work."
        actions={canRequest && active.length > 0 ? <LinkButton href={`${base}/new`} variant="primary"><Plus size={15} />Request certificate</LinkButton> : undefined} />
      <Flash ok={sp.sent ? "Certificate requested. The project team will review it." : undefined} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Issued" value={count("issued")} hint="Certificates issued" tone={count("issued") ? "good" : "default"} icon={<CheckCircle2 />} />
        <Stat label="Under review" value={count("requested")} hint="Requested, awaiting the team" tone={count("requested") ? "warn" : "default"} icon={<Clock />} />
        <Stat label="Rejected" value={count("rejected")} hint="Returned by the team" tone={count("rejected") ? "bad" : "default"} icon={<RotateCcw />} />
        <Stat label="Avg. completion" value={`${avg.toFixed(0)}%`} hint={`${active.length} active subcontract${active.length === 1 ? "" : "s"}`} icon={<Gauge />} />
      </div>

      {active.length > 0 && (
        <section className="mb-5" aria-labelledby="your-subs">
          <h2 id="your-subs" className="mb-2 text-sm font-extrabold tracking-tight text-dark">Your subcontracts</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map(({ a, pct, latest }) => (
              <div key={a.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-3.5 shadow-card" data-testid="cert-asg-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="truncate text-sm font-extrabold text-dark">{a.code ?? `#${a.id}`}</div><div className="truncate text-xs text-slate-500">{a.project_code}{a.stage_name ? ` · ${a.stage_name}` : ""}</div></div>
                  <span className="shrink-0 text-lg font-extrabold tabular-nums text-dark">{pct.toFixed(0)}%</span>
                </div>
                <Bar value={pct} />
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="min-w-0 text-xs text-slate-500">{latest ? <span className="inline-flex flex-wrap items-center gap-1.5">Latest <StatusBadge kind="certStatus" value={latest.status} /></span> : "No certificate yet"}</span>
                  {canRequest && <Link href={`${base}/new?assignment=${a.id}`} className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-primary hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">Request</Link>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {certs.length > 0 && (
        <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1.5">
          <Link href={base} aria-current={!filter ? "page" : undefined} className={chipCls(!filter)}>All <span className="tabular-nums opacity-80">{certs.length}</span></Link>
          {present.map((k) => (
            <Link key={k} href={`${base}?status=${k}`} aria-current={filter === k ? "page" : undefined} className={chipCls(filter === k)}>{statusLabel("certStatus", k)} <span className="tabular-nums opacity-80">{count(k)}</span></Link>
          ))}
        </nav>
      )}

      <CardSection flush>
        {certs.length === 0 ? <div className="p-4"><EmptyState title="No certificates yet" description={canRequest && active.length > 0 ? "Request your first completion certificate when work is ready to certify." : undefined} /></div>
          : shown.length === 0 ? <div className="p-4"><EmptyState title="No certificates with this status" /></div> : (
          <table className="block w-full text-sm md:table">
            <thead className="sr-only bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted md:not-sr-only md:table-header-group">
              <tr>{["No.", "Subcontract", "Type", "Date", "Completion", "Status"].map((h) => <th key={h} className="border-b border-line px-3 py-2.5 font-bold">{h}</th>)}</tr>
            </thead>
            <tbody className="block divide-y divide-[#f1f5f9] md:table-row-group">
              {shown.map((c) => (
                <ClickRow key={c.id} data-testid="cert-row" href={`${base}/${c.id}`} className="block px-4 py-3 md:table-row md:p-0">
                  <td className="mb-1 flex items-center justify-between gap-2 md:table-cell md:px-3 md:py-3 md:align-middle">
                    <Link href={`${base}/${c.id}`} className="whitespace-nowrap font-bold text-primary-dark hover:underline">{c.cert_no ?? `Request #${c.id}`}</Link>
                    <span className="md:hidden"><StatusBadge kind="certStatus" value={c.status} /></span>
                  </td>
                  <td className="block text-slate-700 md:table-cell md:px-3 md:py-3 md:align-middle"><span className="font-semibold">{c.assignment_code}</span> <span className="text-xs text-slate-400">{c.project_code}</span></td>
                  <td className="mt-1.5 inline-block md:mt-0 md:table-cell md:px-3 md:py-3 md:align-middle"><StatusBadge kind="certType" value={c.cert_type} /></td>
                  <td className="ml-2 inline-block whitespace-nowrap text-xs text-slate-500 md:ml-0 md:table-cell md:px-3 md:py-3 md:align-middle md:text-sm md:text-slate-700">{formatDate(c.cert_date)}</td>
                  <td className="mt-2 flex items-center gap-2 md:mt-0 md:table-cell md:w-40 md:px-3 md:py-3 md:align-middle">
                    {c.percent === null ? <span className="text-slate-400">—</span> : (
                      <span className="flex w-full items-center gap-2"><Bar value={c.percent} /><span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums text-dark">{c.percent}%</span></span>
                    )}
                  </td>
                  <td className="hidden md:table-cell md:px-3 md:py-3 md:align-middle"><StatusBadge kind="certStatus" value={c.status} /></td>
                </ClickRow>
              ))}
            </tbody>
          </table>
        )}
      </CardSection>
    </>
  );
}
