import { CheckCircle2, LinkIcon, LogIn, TriangleAlert } from "lucide-react";
import { Badge, Card, CardSection, Field, Input, ProgressBar, Select, StatusBadge, Textarea } from "@/components/ui";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import type { MapFeature } from "@/components/map/types";
import { formatDate, formatMoney, formatNumber, formatRatio, pct, todayISO } from "@/lib/format";
import { getAssignmentProgress } from "@/lib/metrics";
import { statusHex, statusLabel, statusOptions } from "@/lib/status";
import { extractGeometries } from "@/features/dashboard/geo";
import { portalCertificates, portalInvoices, portalProgressReports, resolvePortal } from "@/features/portal/queries";
import { requestPortalCertificate, submitProgressReport } from "@/features/portal/actions";
import { LineRows } from "@/features/portal/components/LineRows";
import { SubmitButton } from "@/features/portal/components/SubmitButton";
import PortalInvoiceForm from "@/features/portal/components/PortalInvoiceForm";

import { getAssignmentBoq } from "@/features/invoices/lines";
import { getDb } from "@/lib/db";
import { getEntityById } from "@/lib/entities";
import { setRequestCurrency } from "@/lib/request-context";
import MapCenterInit from "@/components/map/MapCenterInit";
import { BRAND, MAP_COLORS } from "@/lib/theme";

type SP = { sent?: string; error?: string };
const SENT: Record<string, string> = { progress: "Progress report submitted. It will be verified by the project team.", invoice: "Invoice submitted for review.", certificate: "Completion certificate requested." };

function Unavailable() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <LinkIcon className="mx-auto mb-3 text-slate-400" size={32} />
      <h1 className="text-lg font-semibold text-slate-900">This link is not available</h1>
      <p className="mt-2 text-sm text-slate-500">The portal link is invalid or has been disabled. Please contact the project team to get a new link.</p>
    </div>
  );
}

export default async function PortalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<SP> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ctx = resolvePortal(token);
  if (!ctx) return <Unavailable />;
  const { assignment: a, project, stage, subcontractor } = ctx;
  const entity = getEntityById(project.entity_id)!;
  setRequestCurrency(entity.currency); // the legacy token portal has no session: the currency comes from the project's country
  const prog = getAssignmentProgress(a.id);
  const unit = a.quantity_unit ?? "";

  const geoms = stage?.geometry ? extractGeometries(stage.geometry) : extractGeometries(project.geometry);
  const features: MapFeature[] = geoms.map((g, i) => ({
    id: `g${i}`, kind: "stage", geometry: g, color: BRAND.primary, label: stage ? `${stage.code ?? ""} ${stage.name}`.trim() : project.name, progressPct: prog.actualPct,
  }));
  const reports = portalProgressReports(a.id), invoices = portalInvoices(a.id), certs = portalCertificates(a.id);
  const today = todayISO();
  // The company now has a full login portal: point the quick-update link at it.
  const fullPortal = !!subcontractor.portal_slug && subcontractor.portal_enabled === 1
    && (getDb().prepare("SELECT COUNT(*) c FROM portal_users WHERE subcontractor_id = ? AND status = 'active'").get(subcontractor.id) as { c: number }).c > 0;

  return (
    <div className="space-y-5">
      <MapCenterInit value={entity.map_center ?? ""} />
      {fullPortal && (
        <a href={`/p/${subcontractor.portal_slug}/login`} data-testid="full-portal-banner" className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary-50 p-3 text-sm font-semibold text-slate-700 hover:bg-primary-100">
          <LogIn size={18} className="shrink-0 text-primary" /><span className="flex-1">Your company now has a full portal with progress history, invoices, payments and more.</span><span className="rounded-md bg-primary px-3 py-1 text-xs font-bold text-white">Sign in</span>
        </a>
      )}
      {sp.sent && SENT[sp.sent] && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{SENT[sp.sent]}</div>
      )}
      {sp.error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><TriangleAlert size={18} className="mt-0.5 shrink-0" />{sp.error}</div>
      )}

      <Card className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{subcontractor.name}</div>
        <h1 className="mt-0.5 text-lg font-semibold text-slate-900">{project.name}</h1>
        <div className="mt-0.5 text-sm text-slate-600">{project.code}{stage ? ` · Stage ${stage.code ?? ""} ${stage.name}` : ""}</div>
        <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge kind="assignmentStatus" value={a.status} />{a.code && <Badge>{a.code}</Badge>}</div>
        {a.scope && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{a.scope}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Contract value</dt><dd className="font-semibold tabular-nums">{formatMoney(a.contract_value)}</dd></div>
          <div><dt className="text-xs text-slate-500">Quantity</dt><dd className="font-semibold tabular-nums">{a.quantity ? `${formatNumber(a.quantity, 2)} ${unit}` : "—"}</dd></div>
          <div><dt className="text-xs text-slate-500">Start</dt><dd className="font-semibold">{formatDate(a.start_date)}</dd></div>
          <div><dt className="text-xs text-slate-500">End</dt><dd className="font-semibold">{formatDate(a.end_date)}</dd></div>
        </dl>
      </Card>

      <CardSection title="Progress to date" subtitle={prog.lastReportDate ? `Last verified report ${formatDate(prog.lastReportDate)}` : "No verified reports yet"}>
        <ProgressBar value={prog.actualPct} planned={prog.plannedPct} showLabel tone={prog.spi === null ? "blue" : prog.spi >= 0.95 ? "green" : prog.spi >= 0.85 ? "amber" : "red"} />
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <span>Actual {pct(prog.actualPct, 1)}</span><span>Planned {pct(prog.plannedPct, 1)}</span><span>SPI {formatRatio(prog.spi)}</span>
          <span>Quantity done {formatNumber(prog.cumulativeQty, 2)} {unit}</span><span>Certified {formatMoney(prog.certified)}</span>
        </div>
      </CardSection>

      {features.length > 0 && (
        <CardSection title="Stage map" flush>
          <ProjectMapLazy features={features} height={300} legend={[{ label: "Remaining", color: MAP_COLORS.remaining }, { label: "Completed", color: MAP_COLORS.completed }]} />
        </CardSection>
      )}

      <CardSection title="Submit progress report" subtitle="Reports are verified by the project team before they count towards progress.">
        <form action={submitProgressReport} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Report date"><Input type="date" name="report_date" defaultValue={today} max={today} required /></Field>
            <Field label={`Quantity this period${unit ? ` (${unit})` : ""}`}><Input type="number" name="quantity_done" step="any" min="0" inputMode="decimal" required /></Field>
          </div>
          <LineRows title="Manpower" addLabel="Add trade" cols={[{ name: "mp_trade", label: "Trade", width: "2" }, { name: "mp_count", label: "Headcount", type: "number" }, { name: "mp_hours", label: "Total hours", type: "number" }]} />
          <LineRows title="Materials used" addLabel="Add material" cols={[{ name: "mat_name", label: "Material", width: "2" }, { name: "mat_unit", label: "Unit" }, { name: "mat_qty", label: "Qty", type: "number" }]} />
          <Field label="Equipment used"><Input name="equipment_used" placeholder="e.g. 2 excavators, 1 paver" /></Field>
          <Field label="Work done"><Textarea name="work_done" rows={3} /></Field>
          <Field label="Issues / constraints"><Textarea name="issues" rows={2} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Delay days"><Input type="number" name="delay_days" min="0" step="any" defaultValue={0} /></Field>
            <Field label="Delay responsibility"><Select name="delay_responsibility" defaultValue="none" options={statusOptions("responsibility")} /></Field>
            <Field label="Delay cause"><Input name="delay_cause" /></Field>
          </div>
          <Field label="Photos"><Input type="file" name="photos" multiple accept="image/*" /></Field>
          <SubmitButton>Submit progress report</SubmitButton>
        </form>
      </CardSection>

      <CardSection title="Submit invoice" subtitle="Enter this period's quantities against your subcontract items. Rates are fixed by the contract; VAT is added automatically.">
        <PortalInvoiceForm token={token} today={today} boq={getAssignmentBoq(a.id)} vatRate={entity.vat_rate} currency={entity.currency} defaults={{ name: subcontractor.contact_person ?? "", email: subcontractor.email ?? "" }} />
      </CardSection>

      <CardSection title="Request completion certificate">
        <form action={requestPortalCertificate} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Certificate type"><Select name="cert_type" defaultValue="partial" options={statusOptions("certType")} /></Field>
            <Field label="Completion %"><Input type="number" name="percent" step="0.1" min="0" max="100" required defaultValue={Math.round(prog.actualPct)} /></Field>
          </div>
          <Field label="Remarks"><Textarea name="remarks" rows={2} /></Field>
          <Field label="Supporting file"><Input type="file" name="file" /></Field>
          <SubmitButton>Request certificate</SubmitButton>
        </form>
      </CardSection>

      <CardSection title="Your submissions" subtitle="Status of everything submitted for this assignment">
        <div className="space-y-5 text-sm">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Progress reports</h3>
            {reports.length === 0 ? <p className="text-slate-400">None yet</p> : (
              <ul className="divide-y divide-slate-100">{reports.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2"><span>{formatDate(r.report_date)} · {formatNumber(r.quantity_done, 2)} {unit}{r.source === "portal" ? "" : " (internal)"}</span><StatusBadge kind="progressStatus" value={r.status} /></li>
              ))}</ul>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Invoices</h3>
            {invoices.length === 0 ? <p className="text-slate-400">None yet</p> : (
              <ul className="divide-y divide-slate-100">{invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2"><span>{i.invoice_no ?? `#${i.id}`}{i.sub_invoice_ref ? ` (${i.sub_invoice_ref})` : ""} · {formatMoney(i.claimed_amount)}{i.certified_amount ? ` (certified ${formatMoney(i.certified_amount)})` : ""}</span><StatusBadge kind="invoiceStatus" value={i.status} /></li>
              ))}</ul>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Certificates</h3>
            {certs.length === 0 ? <p className="text-slate-400">None yet</p> : (
              <ul className="divide-y divide-slate-100">{certs.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2"><span>{statusLabel("certType", c.cert_type)} · {c.percent ?? "—"}% · {formatDate(c.cert_date)}</span>
                  <span style={{ color: statusHex("certStatus", c.status) }}><StatusBadge kind="certStatus" value={c.status} /></span></li>
              ))}</ul>
            )}
          </div>
        </div>
      </CardSection>
    </div>
  );
}
