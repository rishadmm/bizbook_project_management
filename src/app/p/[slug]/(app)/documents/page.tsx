import { Download, ExternalLink, Pencil } from "lucide-react";
import { Badge, CardSection, EmptyState, ModalButton, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { statusLabel, statusOptions } from "@/lib/status";
import { docWarning } from "@/features/subcontractors/queries";
import { listCompanyDocuments, listSharedDocuments } from "@/features/portal/data";
import { ChangeRequestForm, DocumentUploadForm } from "@/features/portal/components/DocForms";
import type { Subcontractor } from "@/lib/types";

export const metadata = { title: "Documents" };
const maskIban = (v: string | null) => { const c = (v ?? "").replace(/\s+/g, ""); return c.length > 4 ? `${"*".repeat(c.length - 4)}${c.slice(-4)}` : c || "—"; };
const sizeLabel = (n: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function PortalDocuments({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug, "documents");
  const docs = listCompanyDocuments(s);
  const shared = listSharedDocuments(s);
  const sub = getDb().prepare("SELECT * FROM subcontractors WHERE id = ?").get(s.sub.id) as Subcontractor;
  const pending = getDb().prepare("SELECT kind, created_at FROM portal_change_requests WHERE subcontractor_id = ? AND status = 'pending'").all(s.sub.id) as { kind: string; created_at: string }[];
  const canUpload = portalCan(s.user.role, "documents_upload"), canChange = portalCan(s.user.role, "request_change");
  return (
    <>
      <PageHeader title="Documents" description="Company compliance documents, profile and files shared with you."
        actions={canUpload ? <ModalButton label="Upload document" title="Upload a new or renewed document" variant="primary" wide><DocumentUploadForm types={statusOptions("docType")} /></ModalButton> : undefined} />
      <CardSection title="Company documents" subtitle="Uploads are reviewed by the project team before they are verified" flush className="mb-5">
        {docs.length === 0 ? <div className="p-4"><EmptyState title="No documents on file" /></div> : (
          <Table>
            <THead><TR><TH>Type</TH><TH>Ref</TH><TH>Issued</TH><TH>Expiry</TH><TH>Status</TH><TH>File</TH></TR></THead>
            <TBody>
              {docs.map((d) => {
                const w = d.status === "rejected" ? null : docWarning(d.expiry_date, d.status);
                return (
                  <TR key={d.id} data-testid="doc-row">
                    <TD>{statusLabel("docType", d.doc_type)}{d.source === "portal" && <Badge tone="violet" className="ml-1.5">Uploaded by you</Badge>}</TD>
                    <TD>{d.ref_no ?? "—"}</TD><TD>{formatDate(d.issue_date)}</TD>
                    <TD className="whitespace-nowrap">{formatDate(d.expiry_date)} {w === "expired" && <Badge tone="red">expired</Badge>}{w === "expiring" && <Badge tone="amber">expiring</Badge>}</TD>
                    <TD><StatusBadge kind="docStatus" value={d.status} />{d.status === "rejected" && d.review_note && <div className="mt-1 max-w-[220px] text-xs text-red-700">{d.review_note}</div>}</TD>
                    <TD>{d.attachment_id ? <a className="inline-flex items-center gap-1 font-semibold text-primary-dark hover:underline" target="_blank" rel="noreferrer" href={`/api/files/${d.attachment_id}`}>{d.filename}<ExternalLink size={11} /></a> : <span className="text-slate-400">—</span>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardSection>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Company profile" subtitle="Read only — request a change below"
          actions={canChange ? <><ModalButton label="Bank details" title="Request a bank details change" size="sm" icon={<Pencil size={12} />}><ChangeRequestForm kind="bank" current={{ bank_name: sub.bank_name ?? "" }} /></ModalButton>
            <ModalButton label="Contact details" title="Request a contact details change" size="sm" icon={<Pencil size={12} />}><ChangeRequestForm kind="contact" current={{ contact_person: sub.contact_person ?? "", email: sub.email ?? "", phone: sub.phone ?? "", address: sub.address ?? "" }} /></ModalButton></> : undefined}>
          {pending.length > 0 && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" data-testid="pending-change">{pending.length} change request{pending.length === 1 ? "" : "s"} waiting for approval ({pending.map((p) => p.kind).join(", ")}).</p>}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[["Company", sub.name], ["Trade", sub.trade ?? "—"], ["Trade licence", `${sub.trade_license_no ?? "—"}${sub.trade_license_expiry ? ` (exp. ${formatDate(sub.trade_license_expiry)})` : ""}`], ["TRN", sub.tax_no ?? "—"],
              ["Contact", sub.contact_person ?? "—"], ["E-mail", sub.email ?? "—"], ["Phone", sub.phone ?? "—"], ["Address", sub.address ?? "—"], ["Bank", sub.bank_name ?? "—"], ["IBAN", maskIban(sub.iban)]].map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="font-semibold text-dark">{v}</dd></div>
            ))}
          </dl>
        </CardSection>
        <CardSection title="Shared with you" subtitle="Contract files and drawings of your subcontracts" flush>
          {shared.length === 0 ? <p className="p-5 text-sm text-slate-400">Nothing shared yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">{shared.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-5 py-2.5"><div className="min-w-0 flex-1"><a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="block truncate font-semibold text-primary-dark hover:underline">{d.filename}</a>
                <div className="text-xs text-slate-400">{d.context} · {d.source}{d.category ? ` · ${d.category}` : ""} · {sizeLabel(d.size)}</div></div>
                <a href={`/api/files/${d.id}?download=1`} aria-label={`Download ${d.filename}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><Download size={15} /></a></li>
            ))}</ul>
          )}
        </CardSection>
      </div>
    </>
  );
}
