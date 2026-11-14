import Link from "next/link";
import { CardSection, EmptyState, ModalButton, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { statusOptions } from "@/lib/status";
import { getAssignmentProgress } from "@/lib/metrics";
import { canWorkOn, listAssignments, listCertificates } from "@/features/portal/data";
import { RequestCertificateForm } from "@/features/portal/components/small";
import { Flash } from "@/features/portal/components/bits";

export const metadata = { title: "Certificates" };

export default async function PortalCertificates({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "certificates");
  const certs = listCertificates(s);
  const active = listAssignments(s).filter(canWorkOn).map((a) => ({ value: a.id, label: `${a.code ?? `#${a.id}`} · ${a.project_code}`, pct: Math.round(getAssignmentProgress(a.id).actualPct) }));
  return (
    <>
      <PageHeader title="Completion certificates" description="Partial and final completion certificates for your work."
        actions={portalCan(s.user.role, "certificates_request") && active.length > 0 ? <ModalButton label="Request certificate" title="Request a completion certificate" variant="primary" wide><RequestCertificateForm assignments={active} certTypes={statusOptions("certType")} /></ModalButton> : undefined} />
      <Flash ok={sp.sent ? "Certificate requested. The project team will review it." : undefined} />
      <CardSection flush>
        {certs.length === 0 ? <div className="p-4"><EmptyState title="No certificates yet" /></div> : (
          <Table>
            <THead><TR><TH>No.</TH><TH>Subcontract</TH><TH>Type</TH><TH>Date</TH><TH num>Completion</TH><TH>Status</TH></TR></THead>
            <TBody>
              {certs.map((c) => (
                <TR key={c.id} data-testid="cert-row">
                  <TD><Link href={`/p/${slug}/certificates/${c.id}`} className="font-bold text-primary-dark hover:underline">{c.cert_no ?? `Request #${c.id}`}</Link></TD>
                  <TD>{c.assignment_code} <span className="text-xs text-slate-400">{c.project_code}</span></TD>
                  <TD><StatusBadge kind="certType" value={c.cert_type} /></TD><TD>{formatDate(c.cert_date)}</TD><TD num>{c.percent ?? "—"}%</TD><TD><StatusBadge kind="certStatus" value={c.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}
