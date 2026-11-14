import { EmptyState, PageHeader } from "@/components/ui";
import { requirePortalUser } from "@/lib/portal-auth";
import { statusOptions } from "@/lib/status";
import { getAssignmentProgress } from "@/lib/metrics";
import { canWorkOn, listAssignments, listCertificates } from "@/features/portal/data";
import CertificateRequestForm from "@/features/portal/components/CertificateRequestForm";
import { ReadOnlyNote } from "@/features/portal/components/bits";

export const metadata = { title: "Request certificate" };

export default async function NewCertificate({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignment?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "certificates_request");
  const certs = listCertificates(s);
  const asgs = listAssignments(s).filter(canWorkOn).map((a) => {
    const mine = certs.filter((c) => c.assignment_id === a.id);
    const p = mine.find((c) => c.status === "requested");
    return {
      id: a.id, code: a.code ?? `#${a.id}`, label: `${a.code ?? `#${a.id}`} · ${a.project_code}${a.stage_name ? ` · ${a.stage_name}` : ""}`,
      projectCode: a.project_code, projectName: a.project_name, stageName: a.stage_name, actualPct: getAssignmentProgress(a.id).actualPct,
      pending: p ? { id: p.id, certNo: p.cert_no, type: p.cert_type } : null, issued: mine.filter((c) => c.status === "issued").length,
    };
  });
  return (
    <>
      <PageHeader title="Request completion certificate" breadcrumbs={[{ label: "Certificates", href: `/p/${slug}/certificates` }, { label: "Request" }]}
        description="Ask the project team to certify completed work. They will verify the percentage against reported progress." />
      {s.readOnly && <ReadOnlyNote />}
      {asgs.length === 0 ? <EmptyState title="No active subcontract" description="Certificates can only be requested on active subcontracts." /> : (
        <CertificateRequestForm assignments={asgs} certTypes={statusOptions("certType")} defaultAssignment={Number(sp.assignment) || undefined} cancelHref={`/p/${slug}/certificates`} />
      )}
    </>
  );
}
