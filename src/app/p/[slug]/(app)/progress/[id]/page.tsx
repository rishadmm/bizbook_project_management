import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Badge, CardSection, PageHeader, StatusBadge } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDate, formatDateTime, formatNumber, pct, todayISO } from "@/lib/format";
import { portalCan } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { statusLabel, statusOptions } from "@/lib/status";
import { getReport } from "@/features/portal/data";
import ProgressUpdateForm from "@/features/portal/components/ProgressUpdateForm";
import { progressOptions } from "@/features/portal/progress-helpers";

export const metadata = { title: "Progress update" };

export default async function PortalReportPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const s = await requirePortalUser(slug, "progress");
  const r = getReport(s, Number(id));
  if (!r) notFound();
  const db = getDb();
  const manpower = db.prepare("SELECT trade, headcount, hours FROM progress_manpower WHERE progress_report_id = ?").all(r.id) as { trade: string; headcount: number; hours: number }[];
  const materials = db.prepare("SELECT material, unit, quantity FROM progress_materials WHERE progress_report_id = ?").all(r.id) as { material: string; unit: string | null; quantity: number }[];
  const photos = db.prepare("SELECT id, filename, mime FROM attachments WHERE entity_type = 'progress' AND entity_id = ? ORDER BY id").all(r.id) as { id: number; filename: string; mime: string | null }[];
  const canFix = r.status === "rejected" && r.source === "portal" && portalCan(s.user.role, "progress_submit");
  return (
    <>
      <PageHeader title={`Progress update · ${formatDate(r.report_date)}`} breadcrumbs={[{ label: "Progress updates", href: `/p/${slug}/progress` }, { label: formatDate(r.report_date) }]}
        description={`${r.assignment_code} · ${r.project_code}`} badges={<><StatusBadge kind="progressStatus" value={r.status} />{r.source === "portal" ? <Badge tone="violet">Portal</Badge> : <Badge tone="slate">Project team</Badge>}</>} />
      {r.status === "rejected" && (
        <div role="alert" data-testid="reject-banner" className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><TriangleAlert size={18} className="mt-0.5 shrink-0" />
          <div><div className="font-extrabold">This report was rejected</div><div>{r.reject_reason ?? "No reason was given."}</div>{canFix && <div className="mt-1 font-semibold">Correct it below and resubmit.</div>}</div></div>
      )}
      {canFix && !s.readOnly ? (
        <div>
          <h3 className="mb-3 text-sm font-extrabold tracking-tight text-dark">Correct and resubmit</h3>
          <ProgressUpdateForm cancelHref={`/p/${slug}/progress`} assignments={progressOptions(s, r.id)} today={todayISO()} responsibilities={statusOptions("responsibility")}
            prefill={{ id: r.id, assignment_id: r.assignment_id!, report_date: r.report_date, quantity_done: r.quantity_done, work_done: r.work_done, issues: r.issues, delay_days: r.delay_days, delay_cause: r.delay_cause,
              delay_responsibility: r.delay_responsibility, weather: r.weather ?? null, manpower, materials, equipment: r.equipment_used, reject_reason: r.reject_reason ?? null }} />
        </div>
      ) : (
        <CardSection title="Report">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[["Quantity this period", `${formatNumber(r.quantity_done, 2)} ${r.unit ?? ""}`], ["Cumulative", `${formatNumber(r.cumulative_quantity, 2)} ${r.unit ?? ""}`], ["Completion", pct(r.percent_complete, 0)], ["Weather", r.weather ?? "—"],
              ["Crew / hours", `${r.manpower_count} / ${formatNumber(r.man_hours)}`], ["Equipment", r.equipment_used ?? "—"], ["Delay", r.delay_days > 0 ? `${r.delay_days} d (${statusLabel("responsibility", r.delay_responsibility)})` : "—"], ["Submitted by", r.submitted_by_name ?? "—"]].map(([k, v]) => (
              <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="font-semibold text-dark">{v}</dd></div>
            ))}
          </dl>
          {r.work_done && <p className="mt-4 whitespace-pre-line text-sm text-slate-700"><b>Work done:</b> {r.work_done}</p>}
          {r.issues && <p className="mt-2 whitespace-pre-line text-sm text-slate-700"><b>Issues:</b> {r.issues}</p>}
          {manpower.length > 0 && <p className="mt-2 text-sm text-slate-700"><b>Manpower:</b> {manpower.map((m) => `${m.trade} ${m.headcount}`).join(", ")}</p>}
          {materials.length > 0 && <p className="mt-2 text-sm text-slate-700"><b>Materials:</b> {materials.map((m) => `${m.material} ${m.quantity}${m.unit ?? ""}`).join(", ")}</p>}
          {r.verified_at && <p className="mt-3 text-xs text-slate-400">{r.status === "verified" ? "Verified" : "Decided"} {formatDateTime(r.verified_at)}</p>}
          {photos.length > 0 && (
            <div className="mt-4"><div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Photos ({photos.length})</div>
              <div className="flex flex-wrap gap-2">{photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={p.id} href={`/api/files/${p.id}`} target="_blank" rel="noreferrer" title={p.filename}>{p.mime?.startsWith("image/") ? <img src={`/api/files/${p.id}`} alt={p.filename} className="h-24 w-24 rounded-lg border border-line object-cover" /> : <span className="text-sm font-semibold text-primary-dark">{p.filename}</span>}</a>
              ))}</div></div>
          )}
        </CardSection>
      )}
    </>
  );
}
