import { notFound } from "next/navigation";
import { Check, Download, FileText, X } from "lucide-react";
import { Badge, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { statusLabel } from "@/lib/status";
import { getAssignment, getCertificate } from "@/features/portal/data";
import { PrintButton } from "@/features/portal/components/small";

export const metadata = { title: "Certificate" };

const size = (n: number | null) => (n == null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (ts: string | null | undefined) => (ts ? formatDate(ts.slice(0, 10)) : "");

function Ring({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value)), r = 52, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 128 128" className="h-32 w-32 shrink-0" role="img" aria-label={`${v} percent complete`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--color-primary, #6366f1)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 64 64)" />
      <text x="64" y="62" textAnchor="middle" className="fill-slate-900 text-[26px] font-extrabold">{v}%</text>
      <text x="64" y="82" textAnchor="middle" className="fill-slate-400 text-[10px] font-bold uppercase tracking-wider">complete</text>
    </svg>
  );
}

export default async function PortalCertificate({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const s = await requirePortalUser(slug, "certificates");
  const c = getCertificate(s, Number(id));
  if (!c) notFound();
  const db = getDb();
  const a = getAssignment(s, c.assignment_id);
  const files = db.prepare("SELECT id, filename, size FROM attachments WHERE entity_type = 'certificate' AND entity_id = ? ORDER BY id").all(c.id) as { id: number; filename: string; size: number | null }[];
  const log = db.prepare("SELECT action, created_at FROM activity_log WHERE entity_type = 'certificate' AND entity_id = ? ORDER BY id").all(c.id) as { action: string; created_at: string }[];
  const when = (...acts: string[]) => log.find((l) => acts.includes(l.action))?.created_at;
  const issuer = c.issued_by ? (db.prepare("SELECT name FROM users WHERE id = ?").get(c.issued_by) as { name: string } | undefined)?.name : undefined;
  const company = s.entity.legal_name || "Main contractor";
  const companyAddr = s.entity.address ?? "";
  const rejected = c.status === "rejected", issued = c.status === "issued";
  const requestedAt = day(when("requested", "created") ?? c.created_at);
  const steps: { label: string; date: string; state: "done" | "current" | "todo" | "bad" }[] = [
    { label: "Requested", date: requestedAt, state: "done" },
    { label: "Under review", date: day(when("approval")), state: issued || rejected ? "done" : "current" },
    rejected ? { label: "Rejected", date: day(when("rejected")), state: "bad" } : { label: "Issued", date: issued ? formatDate(c.cert_date) : "", state: issued ? "done" : "todo" },
  ];
  const typeName = statusLabel("certType", c.cert_type);
  const title = c.cert_no ?? `Certificate request #${c.id}`;
  const lbl = "text-[10px] font-bold uppercase tracking-wider text-slate-400";
  return (
    <>
      <div className="no-print">
        <PageHeader title={title} breadcrumbs={[{ label: "Certificates", href: `/p/${slug}/certificates` }, { label: c.cert_no ?? `#${c.id}` }]}
          description={`${c.assignment_code} · ${c.project_code} · ${c.project_name}`}
          badges={<><StatusBadge kind="certType" value={c.cert_type} /><StatusBadge kind="certStatus" value={c.status} />{c.source === "portal" && <Badge tone="violet">Requested via portal</Badge>}</>}
          actions={<><LinkButton href={`/p/${slug}/certificates`} variant="secondary">Back to list</LinkButton><PrintButton label="Print / save as PDF" /></>} />
      </div>

      <article className="print-paper mx-auto w-full max-w-[860px] rounded-2xl border border-line bg-white p-6 shadow-card sm:p-10" data-testid="certificate-paper">
        <header className="border-b-2 border-primary pb-5">
          <div className={lbl}>Issued by</div>
          <div className="text-xl font-extrabold tracking-tight text-dark">{company}</div>
          {companyAddr && <div className="mt-0.5 text-[12px] leading-5 text-slate-500">{companyAddr}</div>}
          <div className="mt-5 text-center">
            <div className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">COMPLETION CERTIFICATE</div>
            <div className="mt-1 text-[12px] font-semibold text-slate-500">{typeName} completion · {statusLabel("certStatus", c.status)}</div>
          </div>
        </header>

        <section className="mt-5 grid gap-5 sm:grid-cols-2">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-slate-400">Certificate no.</dt><dd className="font-semibold text-dark">{c.cert_no ?? `Pending (request #${c.id})`}</dd>
            <dt className="text-slate-400">Date</dt><dd>{formatDate(c.cert_date)}</dd>
            <dt className="text-slate-400">Type</dt><dd>{typeName}</dd>
            <dt className="text-slate-400">Status</dt><dd>{statusLabel("certStatus", c.status)}</dd>
          </dl>
          <div>
            <div className={`mb-1 ${lbl}`}>Subcontractor</div>
            <div className="text-[13px] leading-5 text-slate-700"><div className="font-bold text-dark">{s.sub.name}</div></div>
          </div>
        </section>

        <section className="mt-4 grid gap-3 rounded-xl bg-[#f8fafc] p-3 text-[13px] sm:grid-cols-2">
          <div><span className="text-slate-400">Project </span><b className="text-dark">{c.project_code}</b> · {c.project_name}</div>
          <div><span className="text-slate-400">Subcontract </span><b className="text-dark">{c.assignment_code ?? `#${c.assignment_id}`}</b></div>
          <div><span className="text-slate-400">Stage </span>{a?.stage_name ?? "—"}</div>
          <div><span className="text-slate-400">Scope </span>{a?.scope ?? "—"}</div>
        </section>

        <section className="mt-6 flex flex-wrap items-center gap-6 rounded-xl border border-line p-4 sm:flex-nowrap">
          {c.percent !== null ? <Ring value={c.percent} /> : <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-[12px] border-slate-200 text-slate-400">—</div>}
          <div className="min-w-0 flex-1 text-[13px] leading-6 text-slate-700">
            <p>This is to certify that the <b className="text-dark">{typeName.toLowerCase()}</b> completion of the works under subcontract <b className="text-dark">{c.assignment_code ?? `#${c.assignment_id}`}</b> has been {issued ? "assessed and accepted at" : rejected ? "reviewed; the request was not accepted at" : "requested at"} <b className="text-dark">{c.percent !== null ? `${c.percent}%` : "—"}</b> completion.</p>
            {c.remarks && <div className="mt-3"><div className={lbl}>Remarks</div><p className="whitespace-pre-line text-slate-700">{c.remarks}</p></div>}
          </div>
        </section>

        <section className="mt-6" aria-label="Status timeline">
          <div className={`mb-2 ${lbl}`}>Status timeline</div>
          <ol className="grid gap-3 sm:grid-cols-3" data-testid="cert-timeline">
            {steps.map((st) => (
              <li key={st.label} className="flex items-start gap-2.5" aria-current={st.state === "current" ? "step" : undefined}>
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${st.state === "done" ? "bg-success" : st.state === "bad" ? "bg-red-500" : st.state === "current" ? "bg-amber-500" : "bg-slate-200"}`}>
                  {st.state === "done" ? <Check size={13} strokeWidth={3} aria-hidden /> : st.state === "bad" ? <X size={13} strokeWidth={3} aria-hidden /> : <span className={`h-2 w-2 rounded-full ${st.state === "current" ? "bg-white" : "bg-slate-400"}`} />}
                </span>
                <span className="min-w-0"><span className={`block text-sm font-bold ${st.state === "todo" ? "text-slate-400" : "text-dark"}`}>{st.label}</span><span className="block text-xs text-slate-500">{st.date || (st.state === "current" ? "In progress" : st.state === "todo" ? "Pending" : "")}</span></span>
              </li>
            ))}
          </ol>
        </section>

        {files.length > 0 && (
          <section className="mt-6 no-print" aria-label="Attachments">
            <div className={`mb-2 ${lbl}`}>Attachments</div>
            <ul className="space-y-1.5 text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <FileText size={15} className="shrink-0 text-primary" aria-hidden />
                  <a className="min-w-0 truncate font-semibold text-primary-dark hover:underline" target="_blank" rel="noreferrer" href={`/api/files/${f.id}`}>{f.filename}</a>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">{size(f.size)}</span>
                  <a aria-label={`Download ${f.filename}`} href={`/api/files/${f.id}?download=1`} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Download size={14} /></a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-10 grid gap-8 sm:grid-cols-2">
          {[[`For ${company}`, issued ? (issuer ?? "Project team") : "Awaiting issue"], [`For ${s.sub.name}`, "Subcontractor"]].map(([who, role]) => (
            <div key={who}>
              <div className="h-12 border-b border-slate-400" />
              <div className="mt-1 text-[13px] font-bold text-dark">{who}</div>
              <div className="text-[12px] text-slate-500">{role}{issued && who.startsWith("For " + company) ? ` · ${formatDate(c.cert_date)}` : ""}</div>
            </div>
          ))}
        </footer>
      </article>
    </>
  );
}
