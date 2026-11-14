import { getDb } from "@/lib/db";
import { todayISO } from "@/lib/format";
import type { PortalSession } from "@/lib/portal-auth";
import { canWorkOn, listAssignments } from "./data";
import type { AsgOption } from "./components/ProgressUpdateForm";

/** Linear planned % complete today from the start/end dates (null when the dates are missing or invalid). */
function plannedToday(start: string | null, end: string | null, today: string): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start), e = Date.parse(end), t = Date.parse(today);
  if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(t) || e <= s) return null;
  return Math.max(0, Math.min(100, ((t - s) / (e - s)) * 100));
}

/** Subcontracts the user can report on, with the quantity already reported (excluding rejected reports and, when correcting, the report itself). */
export function progressOptions(s: PortalSession, excludeReportId = 0): AsgOption[] {
  const db = getDb();
  const q = db.prepare("SELECT COALESCE(SUM(quantity_done),0) q, MAX(report_date) d FROM progress_reports WHERE assignment_id = ? AND status <> 'rejected' AND id <> ?");
  const today = todayISO();
  return listAssignments(s).filter(canWorkOn).map((a) => {
    const r = q.get(a.id, excludeReportId) as { q: number; d: string | null };
    return {
      id: a.id, label: `${a.code ?? `#${a.id}`} · ${a.project_code}${a.stage_name ? ` · ${a.stage_name}` : ""}`, unit: a.quantity_unit && a.quantity_unit !== "lumpsum" ? a.quantity_unit : "", quantity: a.quantity,
      reported: r.q, code: a.code ?? `#${a.id}`, projectCode: a.project_code, projectName: a.project_name, stageName: a.stage_name, plannedPct: plannedToday(a.start_date, a.end_date, today), lastReportDate: r.d,
    };
  });
}
