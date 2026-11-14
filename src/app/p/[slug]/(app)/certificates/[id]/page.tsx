import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { Badge, CardSection, PageHeader, StatusBadge } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { getCertificate } from "@/features/portal/data";
import { PrintButton } from "@/features/portal/components/small";

export const metadata = { title: "Certificate" };

export default async function PortalCertificate({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const s = await requirePortalUser(slug, "certificates");
  const c = getCertificate(s, Number(id));
  if (!c) notFound();
  const files = getDb().prepare("SELECT id, filename FROM attachments WHERE entity_type = 'certificate' AND entity_id = ? ORDER BY id").all(c.id) as { id: number; filename: string }[];
  return (
    <>
      <PageHeader title={c.cert_no ?? `Certificate request #${c.id}`} breadcrumbs={[{ label: "Certificates", href: `/p/${slug}/certificates` }, { label: c.cert_no ?? `#${c.id}` }]}
        description={`${c.assignment_code} · ${c.project_code} · ${c.project_name}`} badges={<><StatusBadge kind="certType" value={c.cert_type} /><StatusBadge kind="certStatus" value={c.status} />{c.source === "portal" && <Badge tone="violet">Requested via portal</Badge>}</>} actions={<PrintButton label="Print / save as PDF" />} />
      <CardSection title="Completion certificate">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[["Subcontractor", s.sub.name], ["Subcontract", c.assignment_code ?? `#${c.assignment_id}`], ["Date", formatDate(c.cert_date)], ["Completion", c.percent !== null ? `${c.percent}%` : "—"]].map(([k, v]) => (
            <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="font-bold text-dark">{v}</dd></div>
          ))}
        </dl>
        {c.remarks && <p className="mt-4 whitespace-pre-line text-sm text-slate-700"><b>Remarks:</b> {c.remarks}</p>}
        {files.length > 0 && <ul className="mt-4 space-y-1.5 text-sm">{files.map((f) => <li key={f.id} className="flex items-center gap-2"><FileText size={15} className="text-primary" /><a className="font-semibold text-primary-dark hover:underline" target="_blank" rel="noreferrer" href={`/api/files/${f.id}`}>{f.filename}</a><a aria-label={`Download ${f.filename}`} href={`/api/files/${f.id}?download=1`} className="rounded p-1 text-slate-400 hover:bg-slate-100"><Download size={14} /></a></li>)}</ul>}
      </CardSection>
    </>
  );
}
