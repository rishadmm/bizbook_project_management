import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText, Plus } from "lucide-react";
import { Badge, CardSection, LinkButton, PageHeader, ProgressBar, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import { formatDate, formatMoney, formatNumber, formatRatio, pct, todayISO } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { MAP_COLORS } from "@/lib/theme";
import { getAssignmentBoq } from "@/features/invoices/lines";
import { canWorkOn, getAssignment, listCertificates, listInvoices, listIssues, listSharedDocuments } from "@/features/portal/data";
import { companySegments, detailMapFeatures, daysLabel, manpowerSeries, qtySeries, scheduleHealth } from "@/features/portal/ops";
import { ManpowerChart, QtyChart } from "@/features/portal/components/PortalCharts";
import { RagBadge } from "@/features/portal/components/bits";

export const metadata = { title: "Subcontract" };
const sizeLabel = (n: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function PortalProjectDetail({ params }: { params: Promise<{ slug: string; assignmentId: string }> }) {
  const { slug, assignmentId } = await params;
  const s = await requirePortalUser(slug, "projects");
  const a = getAssignment(s, Number(assignmentId));
  if (!a) notFound();
  const segs = companySegments(s);
  const h = scheduleHealth([a], segs)[0];
  const g = segs.segments.get(a.id);
  const unit = a.quantity_unit && a.quantity_unit !== "lumpsum" ? a.quantity_unit : "";
  const qty = qtySeries(a);
  const mp = manpowerSeries(a.id);
  const boq = getAssignmentBoq(a.id);
  const invoices = listInvoices(s, a.id), certs = listCertificates(s, a.id), issues = listIssues(s, a.id), docs = listSharedDocuments(s, a.id);
  const toQty = (p: number | null) => (p !== null && a.quantity ? (a.quantity * p) / 100 : null);
  const need = h ? toQty(h.reqPctWk) : null, recent = h ? toQty(h.ratePctWk) : null;
  const can = (p: Parameters<typeof portalCan>[1]) => portalCan(s.user.role, p);
  return (
    <>
      <PageHeader title={`${a.code ?? `Subcontract #${a.id}`} · ${a.project_name}`} breadcrumbs={[{ label: "Projects", href: `/p/${slug}/projects` }, { label: a.code ?? `#${a.id}` }]}
        description={`${a.project_code}${a.stage_name ? ` · Stage ${a.stage_code ?? ""} ${a.stage_name}` : ""}`} badges={<><StatusBadge kind="assignmentStatus" value={a.status} />{h && <RagBadge rag={h.rag} />}</>}
        actions={canWorkOn(a) && can("progress_submit") ? <LinkButton href={`/p/${slug}/progress/new?assignment=${a.id}`} variant="primary"><Plus size={15} />Progress update</LinkButton> : undefined} />

      <CardSection title="Scope & terms" className="mb-5">
        {a.scope && <p className="mb-4 whitespace-pre-line text-sm text-slate-700">{a.scope}</p>}
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4 xl:grid-cols-6">
          {[["Contract value", formatMoney(a.contract_value)], ["Quantity", a.quantity ? `${formatNumber(a.quantity, 2)} ${a.quantity_unit ?? ""}` : "Lump sum"], ["Start", formatDate(a.start_date)], ["End", formatDate(a.end_date)],
            ["Payment terms", a.payment_terms ?? `${a.payment_days} days`], ["Retention / advance", `${a.retention_pct}% / ${a.advance_pct}%`]].map(([k, v]) => (
            <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="font-bold text-dark">{v}</dd></div>
          ))}
        </dl>
      </CardSection>

      {h && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Actual vs plan" value={pct(h.actualPct, 0)} hint={`plan ${pct(h.plannedPct, 0)}`} tone={h.rag === "red" ? "bad" : h.rag === "amber" ? "warn" : "default"} />
          <Stat label="SPI" value={formatRatio(h.spi)} />
          <Stat label="Projected finish" value={formatDate(h.projectedEnd)} hint={h.projectedEnd && h.plannedEnd ? `${daysLabel(h.slipDays)} vs ${formatDate(h.plannedEnd)}` : undefined} tone={h.slipDays > 0 ? "bad" : "default"} />
          <Stat label="Required rate" value={need !== null ? `${formatNumber(need, 2)} ${unit}/wk` : "—"} hint={recent !== null ? `recent rate ${formatNumber(recent, 2)} ${unit}/wk` : "no recent progress"} tone={need !== null && recent !== null && need > recent * 1.05 ? "warn" : "default"} />
        </div>
      )}
      {h && need !== null && recent !== null && h.status !== "completed" && (
        <p className="mb-5 rounded-xl bg-primary-50 px-4 py-3 text-sm font-semibold text-slate-700" data-testid="rate-hint">To finish on {formatDate(h.plannedEnd)} the work needs <b>{formatNumber(need, 2)} {unit}/week</b>; your recent rate is <b>{formatNumber(recent, 2)} {unit}/week</b>.</p>
      )}

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Your section on the map" subtitle="Green = completed (work front) · grey = remaining · marker = plan position" flush>
          {g && detailMapFeatures(g.seg, g.d).length ? <ProjectMapLazy features={detailMapFeatures(g.seg, g.d)} height={320} legend={[{ label: "Remaining", color: MAP_COLORS.remaining }, { label: "Completed", color: MAP_COLORS.completed }]} /> : <p className="p-5 text-sm text-slate-400">No map geometry for this subcontract.</p>}
        </CardSection>
        <CardSection title="Progress history" subtitle={`Cumulative quantity${unit ? ` (${unit})` : ""}, planned vs verified actual`}>
          {qty.length ? <QtyChart data={qty} unit={unit} today={todayISO()} /> : <p className="text-sm text-slate-400">Lump-sum scope: no quantity history.</p>}
        </CardSection>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Manpower" subtitle="Average headcount per week (last 12 weeks)"><ManpowerChart data={mp} /></CardSection>
        <CardSection title="Quantities" subtitle="Subcontract items and quantity invoiced to date" flush>
          <Table>
            <THead><TR><TH>Item</TH><TH>Unit</TH><TH num>Contract</TH><TH num>Rate</TH><TH num>Invoiced</TH><TH className="w-28">%</TH></TR></THead>
            <TBody>{boq.map((b) => (
              <TR key={b.item_code}><TD><div className="font-semibold">{b.item_code}</div><div className="max-w-[220px] truncate text-xs text-slate-500" title={b.description}>{b.description}</div></TD><TD>{b.unit}</TD>
                <TD num>{formatNumber(b.contract_qty, 2)}</TD><TD num>{formatNumber(b.rate, 2)}</TD><TD num>{formatNumber(b.prev_qty, 2)}</TD><TD><ProgressBar value={b.contract_qty ? (b.prev_qty / b.contract_qty) * 100 : 0} showLabel /></TD></TR>
            ))}</TBody>
          </Table>
        </CardSection>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Invoices" subtitle={`${invoices.length} on this subcontract`} flush>
          {invoices.length === 0 ? <p className="p-5 text-sm text-slate-400">None yet.</p> : (
            <Table><THead><TR><TH>Invoice</TH><TH>Date</TH><TH num>Claimed</TH><TH>Status</TH></TR></THead>
              <TBody>{invoices.map((i) => <TR key={i.id}><TD>{can("invoices") ? <Link className="font-bold text-primary-dark hover:underline" href={`/p/${slug}/invoices/${i.id}`}>{i.invoice_no}</Link> : i.invoice_no}</TD><TD>{formatDate(i.invoice_date)}</TD><TD num>{formatMoney(i.claimed_amount)}</TD><TD><StatusBadge kind="invoiceStatus" value={i.status} /></TD></TR>)}</TBody></Table>
          )}
        </CardSection>
        <CardSection title="Completion certificates" subtitle={`${certs.length} on this subcontract`} flush>
          {certs.length === 0 ? <p className="p-5 text-sm text-slate-400">None yet.</p> : (
            <Table><THead><TR><TH>No.</TH><TH>Type</TH><TH>Date</TH><TH num>%</TH><TH>Status</TH></TR></THead>
              <TBody>{certs.map((c) => <TR key={c.id}><TD>{can("certificates") ? <Link className="font-bold text-primary-dark hover:underline" href={`/p/${slug}/certificates/${c.id}`}>{c.cert_no ?? `#${c.id}`}</Link> : c.cert_no}</TD><TD><StatusBadge kind="certType" value={c.cert_type} /></TD><TD>{formatDate(c.cert_date)}</TD><TD num>{c.percent ?? "—"}</TD><TD><StatusBadge kind="certStatus" value={c.status} /></TD></TR>)}</TBody></Table>
          )}
        </CardSection>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Issues on your scope" subtitle={`${issues.filter((i) => i.status !== "closed").length} open`} flush>
          {issues.length === 0 ? <p className="p-5 text-sm text-slate-400">No issues.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">{issues.slice(0, 8).map((i) => (
              <li key={i.id}><Link href={`/p/${slug}/issues/${i.id}`} className="flex items-center gap-2 px-5 py-2.5 hover:bg-[#f8fafc]"><span className="flex-1 font-semibold text-slate-700">{i.title}</span><Badge tone={i.status === "closed" ? "green" : i.status === "mitigating" ? "amber" : "red"}>{i.status}</Badge></Link></li>
            ))}</ul>
          )}
        </CardSection>
        <CardSection title="Shared documents" subtitle="Scope, drawings and contract files" flush>
          {docs.length === 0 ? <p className="p-5 text-sm text-slate-400">Nothing shared yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">{docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-5 py-2.5"><FileText size={15} className="shrink-0 text-primary" /><div className="min-w-0 flex-1"><a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="block truncate font-semibold text-primary-dark hover:underline">{d.filename}</a>
                <div className="text-xs text-slate-400">{d.source}{d.category ? ` · ${d.category}` : ""} · {sizeLabel(d.size)} · {formatDate(d.created_at)}</div></div>
                <a href={`/api/files/${d.id}?download=1`} aria-label={`Download ${d.filename}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><Download size={15} /></a></li>
            ))}</ul>
          )}
        </CardSection>
      </div>
    </>
  );
}
