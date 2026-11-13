import { CheckCircle2, LinkIcon, TriangleAlert } from "lucide-react";
import { Badge, Card, CardSection, Field, Input, ProgressBar, Select, StatusBadge, Textarea } from "@/components/ui";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import type { MapFeature } from "@/components/map/types";
import { formatDate, formatMoney, formatNumber, formatRatio, pct, todayISO } from "@/lib/format";
import { getAssignmentProgress } from "@/lib/metrics";
import { statusHex, statusLabel, statusOptions } from "@/lib/status";
import { extractGeometries } from "@/features/dashboard/geo";
import { portalCertificates, portalInvoices, portalProgressReports, resolvePortal } from "@/features/portal/queries";
import { requestPortalCertificate, submitPortalInvoice, submitProgressReport } from "@/features/portal/actions";
import { LineRows } from "@/features/portal/components/LineRows";
import { SubmitButton } from "@/features/portal/components/SubmitButton";

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
  const prog = getAssignmentProgress(a.id);
  const unit = a.quantity_unit ?? "";

  const geoms = stage?.geometry ? extractGeometries(stage.geometry) : extractGeometries(project.geometry);
  const features: MapFeature[] = geoms.map((g, i) => ({
    id: `g${i}`, kind: "stage", geometry: g, color: "#2563eb", label: stage ? `${stage.code ?? ""} ${stage.name}`.trim() : project.name, progressPct: prog.actualPct,
  }));
  const reports = portalProgressReports(a.id), invoices = portalInvoices(a.id), certs = portalCertificates(a.id);
  const today = todayISO();

  return (
    <div className="space-y-5">
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
          <ProjectMapLazy features={features} height={300} legend={[{ label: "Remaining", color: "#94a3b8" }, { label: "Completed", color: "#16a34a" }]} />
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

      <CardSection title="Submit invoice">
        <form action={submitPortalInvoice} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Invoice no."><Input name="invoice_no" required /></Field>
            <Field label="Invoice date"><Input type="date" name="invoice_date" defaultValue={today} required /></Field>
            <Field label="Period from"><Input type="date" name="period_from" /></Field>
            <Field label="Period to"><Input type="date" name="period_to" /></Field>
            <Field label="Claimed amount"><Input type="number" name="claimed_amount" step="0.01" min="0" inputMode="decimal" required /></Field>
            <Field label="Claimed % of contract"><Input type="number" name="claimed_percent" step="0.1" min="0" max="100" /></Field>
          </div>
          <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
          <Field label="Invoice file"><Input type="file" name="file" /></Field>
          <SubmitButton>Submit invoice</SubmitButton>
        </form>
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
                <li key={i.id} className="flex items-center justify-between gap-2 py-2"><span>{i.invoice_no ?? `#${i.id}`} · {formatMoney(i.claimed_amount)}{i.certified_amount ? ` (certified ${formatMoney(i.certified_amount)})` : ""}</span><StatusBadge kind="invoiceStatus" value={i.status} /></li>
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
