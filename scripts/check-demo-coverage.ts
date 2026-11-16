// Demo-data coverage check (DEMO_DATA_SPEC.md). Run after `npm run seed`:  npm run check:demo
// Loads the DB + getOpsMapData() + computeAll(today), asserts every rule and prints a coverage table. Exit code 1 on any gap.
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/format";
import { DEMO_ADMIN_EMAIL } from "@/lib/migrate";
import { ENUMS } from "@/lib/status";
import { docWarning } from "@/features/subcontractors/queries";
import { getDelayAttribution, getProjectSCurve, getSubcontractorPerformance } from "@/lib/metrics";
import { activeProjectHealth, expiringDocuments, pendingApprovals, portfolioTotals, tenderFunnel, upcomingDeadlines } from "@/features/dashboard/queries";
import { computeAll, computeKpis, computeParties } from "@/features/ops-map/calc";
import { getOpsMapData } from "@/features/ops-map/queries";
import type { OpsSegment, Rag, Resp, SegStatus } from "@/features/ops-map/types";

const db = getDb();
const rows: { area: string; check: string; value: string; need: string; ok: boolean }[] = [];
function check(area: string, name: string, value: number | string, need: string, ok: boolean) { rows.push({ area, check: name, value: String(value), need, ok }); }
const atLeast = (area: string, name: string, v: number, n: number) => check(area, name, v, `>= ${n}`, v >= n);
const all = <T = Record<string, unknown>>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as T[];
const one = <T = Record<string, unknown>>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as never[])) as T;

const data = getOpsMapData();
const today = data.today;
const d = computeAll(data, today);
const projById = new Map(data.projects.map((p) => [p.id, p]));

/* ---------------------------------------------------------------- Live Ops Map */
const rag: Record<Rag, number> = { green: 0, amber: 0, red: 0, grey: 0 };
for (const p of data.projects) rag[d.proj.get(p.id)!.rag]++;
atLeast("Map", "projects green", rag.green, 2);
atLeast("Map", "projects amber", rag.amber, 2);
atLeast("Map", "projects red", rag.red, 2);
atLeast("Map", "projects grey (mobilizing / not started)", rag.grey, 1);

const st: Record<SegStatus, number> = { not_started: 0, on_track: 0, at_risk: 0, behind: 0, completed: 0, suspended: 0 };
for (const s of data.segments) st[d.seg.get(s.key)!.status]++;
for (const k of Object.keys(st) as SegStatus[]) atLeast("Map", `segments ${k}`, st[k], 2);

for (const p of data.projects) {
  const pd = d.proj.get(p.id)!;
  if (pd.rag === "red" || pd.rag === "amber") {
    check("Map", `${p.code} (${pd.rag}) mix on_track + behind`, `${pd.counts.on_track} / ${pd.counts.behind}`, ">= 1 / >= 1", pd.counts.on_track >= 1 && pd.counts.behind >= 1);
  }
}
atLeast("Map", "stages with 2+ assignments (sliced line)", new Set(data.segments.filter((s) => s.shared && s.shared.count >= 2).map((s) => s.stageId)).size, 1);
check("Map", "polygon project present", data.segments.some((s) => s.kind === "polygon") ? 1 : 0, ">= 1", data.segments.some((s) => s.kind === "polygon"));

const RESPS: Resp[] = ["subcontractor", "company", "client", "authority", "weather", "utility_clash", "other"];
for (const r of RESPS) atLeast("Map", `dominant delay cause ${r} (segments)`, data.segments.filter((s) => d.seg.get(s.key)!.dominantCause === r).length, 1);

const cpis = data.segments.map((s) => d.seg.get(s.key)!.cpi).filter((c): c is number => c !== null);
atLeast("Map", "segment CPI < 0.9 (overrun)", cpis.filter((c) => c < 0.9).length, 2);
atLeast("Map", "segment CPI 0.9 - 1.0", cpis.filter((c) => c >= 0.9 && c <= 1.0).length, 2);
atLeast("Map", "segment CPI > 1.0", cpis.filter((c) => c > 1.0).length, 2);

const live = data.segments.filter((s) => ["on_track", "at_risk", "behind"].includes(d.seg.get(s.key)!.status) && d.seg.get(s.key)!.staleDays !== null);
const ages = live.map((s) => d.seg.get(s.key)!.staleDays as number);
atLeast("Map", "in-progress last report <= 7 d", ages.filter((a) => a <= 7).length, 2);
atLeast("Map", "in-progress last report 8 - 14 d", ages.filter((a) => a > 7 && a <= 14).length, 2);
atLeast("Map", "in-progress last report > 14 d (stale)", ages.filter((a) => a > 14).length, 2);

// realistic delays
const delays = data.projects.map((p) => d.proj.get(p.id)!.delayDays);
check("Delay", "largest project delay (days)", Math.max(...delays), "<= 200", Math.max(...delays) <= 200);
atLeast("Delay", "projects with delay 10 - 120 d", delays.filter((x) => x >= 10 && x <= 120).length, 3);
check("Delay", "green projects with delay > 30 d", data.projects.filter((p) => d.proj.get(p.id)!.rag === "green" && d.proj.get(p.id)!.delayDays > 30).length, "= 0", data.projects.every((p) => d.proj.get(p.id)!.rag !== "green" || d.proj.get(p.id)!.delayDays <= 30));
check("Delay", "projects with delay > 90 d that are not red", data.projects.filter((p) => d.proj.get(p.id)!.delayDays > 90 && d.proj.get(p.id)!.rag !== "red").length, "= 0", data.projects.every((p) => d.proj.get(p.id)!.delayDays <= 90 || d.proj.get(p.id)!.rag === "red"));
check("Delay", "segment slip over 365 d", data.segments.filter((s) => d.seg.get(s.key)!.slipDays > 365).length, "= 0", data.segments.every((s) => d.seg.get(s.key)!.slipDays <= 365));

// rail dropdowns
const catsInData = new Set(data.projects.map((p) => p.category));
for (const c of Object.keys(ENUMS.category)) check("Rail", `category ${c} -> projects`, data.projects.filter((p) => p.category === c).length, ">= 1", catsInData.has(c));
for (const c of Object.keys(ENUMS.projectStatus)) check("Rail", `status ${c} -> projects`, data.projects.filter((p) => p.status === c).length, ">= 1", data.projects.some((p) => p.status === c));
for (const sub of data.subs) atLeast("Rail", `subcontractor ${sub.name} -> projects`, new Set(data.segments.filter((s) => s.sub?.id === sub.id).map((s) => s.projectId)).size, 1);
for (const r of RESPS) {
  const n = data.projects.filter((p) => data.segments.some((s) => s.projectId === p.id && s.delays.some((e) => e.resp === r && e.d <= today)) || data.issues.some((i) => i.projectId === p.id && i.resp === r)).length;
  atLeast("Rail", `delay cause ${r} -> projects`, n, 1);
}

// KPI strip
const kp = computeKpis(data.projects, data.segments, d);
check("KPI", "behind-plan km", kp.behindKm.toFixed(1), "> 0", kp.behindKm > 0);
check("KPI", "at risk", kp.atRisk, "> 0", kp.atRisk > 0);
check("KPI", "behind", kp.behind, "> 0", kp.behind > 0);
check("KPI", "worst slip (days)", kp.worstSlip, "> 0", kp.worstSlip > 0);
check("KPI", "completed km", kp.doneKm.toFixed(1), "> 0", kp.doneKm > 0);

// who is causing the delay
const parties = computeParties(data, new Set(data.projects.map((p) => p.id)), today);
atLeast("Parties", "portfolio parties", parties.length, 4);
for (const p of data.projects) {
  const pr = d.proj.get(p.id)!.rag;
  if (pr === "red" || pr === "amber") atLeast("Parties", `${p.code} (${pr}) parties`, computeParties(data, new Set([p.id]), today).length, 2);
}

// per-segment content
const subSegs = data.segments.filter((s) => s.sub && s.history.length);
const noSpark = subSegs.filter((s) => {
  const x = d.seg.get(s.key)!;
  if (x.status === "completed" || x.status === "not_started") {
    const last = s.history[s.history.length - 1].d;
    return !s.history.some((h) => h.mp > 0 && daysBetween(h.d, last) <= 28);
  }
  return !x.manpower.some((m) => m > 0);
});
check("Segments", "segments with a sub but no manpower sparkline", noSpark.length, "= 0", noSpark.length === 0);
const needInv = data.segments.filter((s: OpsSegment) => s.sub && d.seg.get(s.key)!.actualPct > 30 && s.assignmentStatus !== "terminated");
const noInv = needInv.filter((s) => s.invoices.certified <= 0);
check("Segments", "segments >30% without a certified invoice", noInv.length ? noInv.map((s) => s.key).join(",") : 0, "= 0", noInv.length === 0);
atLeast("Segments", "segments with a paid invoice", data.segments.filter((s) => s.invoices.paid > 0).length, 3);

// history spread (time machine replays visibly)
const weeks = new Set<string>();
for (const s of data.segments) for (const h of s.history) weeks.add(h.d);
atLeast("History", "distinct report dates", weeks.size, 40);
const avg = (date: string) => { const x = computeAll(data, date); return [...x.proj.values()].reduce((a, p) => a + p.actualPct, 0) / x.proj.size; };
const a0 = avg(today), a30 = avg(addDays(today, -30)), a90 = avg(addDays(today, -90)), a180 = avg(addDays(today, -180));
check("History", "avg progress today / -30 / -90 / -180 d", [a0, a30, a90, a180].map((x) => x.toFixed(1)).join(" / "), "strictly decreasing", a0 > a30 && a30 > a90 && a90 > a180);

// forecast mode
const fut = computeAll(data, addDays(today, 400));
const fr: Record<Rag, number> = { green: 0, amber: 0, red: 0, grey: 0 };
for (const p of data.projects) fr[fut.proj.get(p.id)!.rag]++;
check("Forecast", "today+400 d RAG green / amber / red / grey", `${fr.green} / ${fr.amber} / ${fr.red} / ${fr.grey}`, "red >= 1, amber >= 1", fr.red >= 1 && fr.amber >= 1);
const lateToday = data.projects.filter((p) => d.proj.get(p.id)!.delayDays > 0 || ["red"].includes(d.proj.get(p.id)!.rag));
check("Forecast", "projects late today that turn green in forecast", lateToday.filter((p) => fut.proj.get(p.id)!.rag === "green").length, "= 0", lateToday.every((p) => fut.proj.get(p.id)!.rag !== "green"));
check("Forecast", "forecast CPI equals today's CPI", data.projects.filter((p) => d.proj.get(p.id)!.cpi !== fut.proj.get(p.id)!.cpi).length, "= 0 differences", data.projects.every((p) => d.proj.get(p.id)!.cpi === fut.proj.get(p.id)!.cpi));

/* ---------------------------------------------------------------- status coverage per table */
const COV: [string, string, keyof typeof ENUMS, string[]?][] = [
  ["tenders", "status", "tenderStatus"], ["tenders", "kind", "tenderKind"], ["tender_sections", "status", "sectionStatus"], ["tender_revisions", "status", "revisionStatus"],
  ["tender_reviews", "decision", "reviewDecision"], ["negotiations", "channel", "negotiationChannel"], ["loss_analyses", "status", "lossStatus"],
  ["clients", "type", "clientType"], ["projects", "status", "projectStatus"], ["stages", "status", "stageStatus"], ["subcontractors", "status", "subcontractorStatus"],
  ["subcontractor_documents", "status", "docStatus"], ["assignments", "status", "assignmentStatus"], ["progress_reports", "status", "progressStatus"],
  ["progress_reports", "source", "progressSource"], ["sub_invoices", "status", "invoiceStatus"], ["completion_certificates", "status", "certStatus"],
  ["completion_certificates", "cert_type", "certType"], ["issues", "status", "issueStatus"], ["issues", "responsibility", "responsibility", ["none"]],
];
for (const [table, col, kind, skip] of COV) {
  const have = new Map(all<{ v: string; n: number }>(`SELECT ${col} AS v, COUNT(*) n FROM ${table} GROUP BY ${col}`).map((r) => [r.v, r.n]));
  for (const v of Object.keys(ENUMS[kind])) {
    if (skip?.includes(v)) continue;
    check("Status", `${table}.${col} = ${v}`, have.get(v) ?? 0, ">= 1", (have.get(v) ?? 0) >= 1);
  }
}
// "nice to have" breadth: show how many loss reasons are used (informational)
check("Status", "loss reasons used", all("SELECT DISTINCT primary_reason FROM loss_analyses").length, ">= 5", all("SELECT DISTINCT primary_reason FROM loss_analyses").length >= 5);
for (const [label, sql] of [
  ["tenders with 2+ revisions", "SELECT COUNT(*) n FROM (SELECT tender_id FROM tender_revisions GROUP BY tender_id HAVING COUNT(*) > 1)"],
  ["tenders with negotiation rounds", "SELECT COUNT(DISTINCT tender_id) n FROM negotiations"],
  ["tenders with department sections", "SELECT COUNT(DISTINCT tender_id) n FROM tender_sections"],
  ["tender attachments", "SELECT COUNT(*) n FROM attachments WHERE entity_type = 'tender'"],
  ["lost tenders with lessons learned", "SELECT COUNT(*) n FROM loss_analyses WHERE lessons_learned IS NOT NULL AND lessons_learned <> ''"],
  ["documents expiring within 30 days (valid)", `SELECT COUNT(*) n FROM subcontractor_documents WHERE status = 'verified' AND expiry_date BETWEEN '${today}' AND '${addDays(today, 30)}'`],
  ["documents expired (date passed)", `SELECT COUNT(*) n FROM subcontractor_documents WHERE expiry_date < '${today}'`],
  ["portal reports awaiting verification", "SELECT COUNT(*) n FROM progress_reports WHERE status = 'submitted' AND source = 'portal'"],
  ["rejected progress reports", "SELECT COUNT(*) n FROM progress_reports WHERE status = 'rejected'"],
] as const) atLeast("Status", label, one<{ n: number }>(sql).n, 1);
const missing = all<{ id: number }>("SELECT s.id FROM subcontractors s WHERE s.status IN ('approved','onboarding','suspended') AND NOT EXISTS (SELECT 1 FROM subcontractor_documents d WHERE d.subcontractor_id = s.id AND d.doc_type = 'hse_certificate')").length;
atLeast("Status", "subcontractors missing a required document (HSE)", missing, 1);

/* ---------------------------------------------------------------- approvals */
const pend = all<{ uid: number; level_no: number; document_type: string; overdue: number }>(
  `SELECT t.assignee_user_id uid, t.level_no, r.document_type, (t.due_at < ?) overdue FROM approval_tasks t JOIN approval_requests r ON r.id = t.request_id WHERE t.status = 'pending' AND r.status = 'pending'`, new Date().toISOString());
atLeast("Approvals", "pending tasks at L1", pend.filter((p) => p.level_no === 1).length, 3);
atLeast("Approvals", "pending tasks at L2", pend.filter((p) => p.level_no === 2).length, 3);
atLeast("Approvals", "document types with pending requests", new Set(pend.map((p) => p.document_type)).size, 5);
atLeast("Approvals", "overdue pending tasks", pend.filter((p) => p.overdue).length, 3);
for (const s of ["approved", "rejected", "returned"]) atLeast("Approvals", `requests ${s}`, one<{ n: number }>("SELECT COUNT(*) n FROM approval_requests WHERE status = ?", s).n, 1);
atLeast("Approvals", "active delegations", one<{ n: number }>("SELECT COUNT(*) n FROM approval_delegations WHERE is_active = 1").n, 1);
const admin = one<{ id: number }>("SELECT id FROM users WHERE email = ?", DEMO_ADMIN_EMAIL);
atLeast("Approvals", "pending for admin", pend.filter((p) => p.uid === admin.id).length, 3);
for (const f of all<{ id: number; name: string }>("SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'finance'")) atLeast("Approvals", `pending for finance user ${f.name}`, pend.filter((p) => p.uid === f.id).length, 3);

/* ---------------------------------------------------------------- dashboard widgets */
const fun = tenderFunnel();
atLeast("Dashboard", "pipeline: stages with tenders", fun.rows.filter((r) => r.count > 0).length, 6);
check("Dashboard", "win/loss: won and lost", `${fun.winRate.won} / ${fun.winRate.lost}`, ">= 1 / >= 1", fun.winRate.won >= 1 && fun.winRate.lost >= 1);
atLeast("Dashboard", "upcoming deadlines", upcomingDeadlines().length, 3);
const health = activeProjectHealth();
atLeast("Dashboard", "project health rows", health.length, 6);
const pt = portfolioTotals(health);
check("Dashboard", "budget vs actual (BAC / AC)", `${Math.round(pt.bac / 1e6)}M / ${Math.round(pt.ac / 1e6)}M`, "both > 0", pt.bac > 0 && pt.ac > 0);
const dl = getDelayAttribution(null);
atLeast("Dashboard", "delay by responsibility: groups", dl.byResponsibility.length, 6);
atLeast("Dashboard", "top late subcontractors", getSubcontractorPerformance().filter((s) => s.delayDays > 0).length, 2);
const sc = getProjectSCurve(health.find((h) => h.m.actualPct > 0)!.project.id);
check("Dashboard", "S-curve points (planned / actual)", `${sc.length} / ${sc.filter((x) => x.actual !== null).length}`, ">= 10 / >= 5", sc.length >= 10 && sc.filter((x) => x.actual !== null).length >= 5);
const pa = pendingApprovals();
atLeast("Dashboard", "pending progress reports", pa.progress.length, 1);
atLeast("Dashboard", "pending invoices", pa.invoices.length, 1);
atLeast("Dashboard", "pending certificate requests", pa.certs.length, 1);
atLeast("Dashboard", "expiring documents", expiringDocuments().length, 3);

/* ---------------------------------------------------------------- audit + activity */
const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
atLeast("Audit", "auth events (last 7 days)", one<{ n: number }>("SELECT COUNT(*) n FROM auth_events WHERE created_at >= ?", since).n, 10);
atLeast("Audit", "distinct auth event types", one<{ n: number }>("SELECT COUNT(DISTINCT event) n FROM auth_events").n, 8);
atLeast("Audit", "activity entries (last 7 days)", one<{ n: number }>("SELECT COUNT(*) n FROM activity_log WHERE created_at >= ?", since.replace("T", " ").slice(0, 19)).n, 10);

/* ---------------------------------------------------------------- invoice documents (INVOICE_SPEC section 6) */
{
  const uploads = process.env.OPS_UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
  const invs = all<{ id: number; subtotal: number; vat_amount: number; claimed_amount: number }>("SELECT id, subtotal, vat_amount, claimed_amount FROM sub_invoices");
  const noLines = invs.filter((i) => one<{ n: number }>("SELECT COUNT(*) n FROM sub_invoice_lines WHERE invoice_id = ?", i.id).n === 0);
  check("Invoices", "invoices without any line", noLines.length ? noLines.map((i) => i.id).join(",") : 0, "= 0", noLines.length === 0);
  const noTax = invs.filter((i) => !all<{ stored_path: string }>("SELECT stored_path FROM attachments WHERE entity_type = 'sub_invoice' AND entity_id = ? AND category = 'tax_invoice'", i.id)
    .some((a) => fs.existsSync(path.join(uploads, a.stored_path))));
  check("Invoices", "invoices without a tax_invoice file on disk", noTax.length ? noTax.map((i) => i.id).join(",") : 0, "= 0", noTax.length === 0);
  const badTotals = invs.filter((i) => Math.abs(i.subtotal + i.vat_amount - i.claimed_amount) > 0.011
    || Math.abs((one<{ s: number }>("SELECT COALESCE(SUM(amount),0) s FROM sub_invoice_lines WHERE invoice_id = ?", i.id).s) - i.subtotal) > 0.006);
  check("Invoices", "invoices where lines + VAT do not equal claimed", badTotals.length, "= 0", badTotals.length === 0);
  const lineCounts = all<{ n: number }>("SELECT COUNT(*) n FROM sub_invoice_lines GROUP BY invoice_id").map((r) => r.n);
  atLeast("Invoices", "long invoices (>= 25 lines, multi-page PDF)", lineCounts.filter((n) => n >= 25).length, 1);
  atLeast("Invoices", "invoices with certified < claimed lines and remarks", one<{ n: number }>("SELECT COUNT(DISTINCT invoice_id) n FROM sub_invoice_lines WHERE remarks IS NOT NULL AND certified_amount < amount").n, 5);
  atLeast("Invoices", "invoices with photos", one<{ n: number }>("SELECT COUNT(DISTINCT entity_id) n FROM attachments WHERE entity_type = 'sub_invoice' AND category = 'progress_photos'").n, 20);
  atLeast("Invoices", "invoices with measurement sheet", one<{ n: number }>("SELECT COUNT(DISTINCT entity_id) n FROM attachments WHERE entity_type = 'sub_invoice' AND category = 'measurement_sheet'").n, 20);
  atLeast("Invoices", "invoices with timesheet", one<{ n: number }>("SELECT COUNT(DISTINCT entity_id) n FROM attachments WHERE entity_type = 'sub_invoice' AND category = 'timesheet'").n, 5);
}

/* ---------------------------------------------------------------- Subcontractor portal (PORTAL_SPEC section 4) */
{
  const approved = all<{ id: number; name: string; portal_slug: string | null; portal_enabled: number }>("SELECT id, name, portal_slug, portal_enabled FROM subcontractors WHERE status = 'approved'");
  check("Portal", "approved subcontractors with slug + portal enabled", approved.filter((s) => s.portal_slug && s.portal_enabled).length, `= ${approved.length}`, approved.every((s) => s.portal_slug && s.portal_enabled));
  const noOwner = approved.filter((s) => !one<{ n: number }>("SELECT COUNT(*) n FROM portal_users WHERE subcontractor_id = ? AND portal_role = 'owner' AND status = 'active'", s.id).n);
  check("Portal", "approved subcontractors without an active owner", noOwner.length, "= 0", noOwner.length === 0);
  const openSubs = all<{ id: number; status: string }>("SELECT id, status FROM subcontractors WHERE status IN ('approved', 'onboarding')");
  check("Portal", "approved/onboarding subcontractors with a slug", openSubs.filter((s) => one<{ s: string | null }>("SELECT portal_slug s FROM subcontractors WHERE id = ?", s.id).s).length, `= ${openSubs.length}`, openSubs.every((s) => one<{ s: string | null }>("SELECT portal_slug s FROM subcontractors WHERE id = ?", s.id).s));
  const orphan = all("SELECT DISTINCT u.subcontractor_id FROM portal_users u WHERE NOT EXISTS (SELECT 1 FROM assignments a WHERE a.subcontractor_id = u.subcontractor_id)");
  check("Portal", "portal users whose company has no subcontract", orphan.length, "= 0", orphan.length === 0);
  atLeast("Portal", "portal users", one<{ n: number }>("SELECT COUNT(*) n FROM portal_users").n, 14);
  atLeast("Portal", "user who must change the password", one<{ n: number }>("SELECT COUNT(*) n FROM portal_users WHERE must_change_password = 1").n, 1);
  atLeast("Portal", "locked user", one<{ n: number }>("SELECT COUNT(*) n FROM portal_users WHERE failed_attempts >= 5 AND locked_until IS NOT NULL").n, 1);
  atLeast("Portal", "disabled user", one<{ n: number }>("SELECT COUNT(*) n FROM portal_users WHERE status = 'disabled'").n, 1);
  atLeast("Portal", "portal auth events", one<{ n: number }>("SELECT COUNT(*) n FROM portal_auth_events").n, 30);
  atLeast("Portal", "portal-submitted progress awaiting verification", one<{ n: number }>("SELECT COUNT(*) n FROM progress_reports WHERE source = 'portal' AND status = 'submitted' AND portal_user_id IS NOT NULL").n, 3);
  atLeast("Portal", "portal progress rejected (awaiting resubmission)", one<{ n: number }>("SELECT COUNT(*) n FROM progress_reports WHERE source = 'portal' AND status = 'rejected' AND reject_reason IS NOT NULL").n, 2);
  atLeast("Portal", "portal-raised issues with comment threads", one<{ n: number }>("SELECT COUNT(DISTINCT i.id) n FROM issues i JOIN issue_comments c ON c.issue_id = i.id WHERE i.source = 'portal'").n, 3);
  atLeast("Portal", "documents pending review (uploaded via portal)", one<{ n: number }>("SELECT COUNT(*) n FROM subcontractor_documents WHERE status = 'pending_review' AND source = 'portal'").n, 2);
  atLeast("Portal", "pending bank-details change requests", one<{ n: number }>("SELECT COUNT(*) n FROM portal_change_requests WHERE status = 'pending' AND kind = 'bank'").n, 1);
  // each action-item type appears for at least one company (SQL mirror of features/portal/data.ts getActionItems)
  const today0 = data.today;
  const companies = all<{ id: number }>("SELECT DISTINCT subcontractor_id AS id FROM portal_users");
  const kinds: Record<string, number> = { report_due: 0, report_rejected: 0, invoice_returned: 0, doc_expiry: 0, issue_response: 0 };
  for (const c of companies) {
    const asg = all<{ id: number; start_date: string | null }>("SELECT id, start_date FROM assignments WHERE subcontractor_id = ? AND status = 'active'", c.id);
    const ids = asg.map((a) => a.id).concat([-1]).join(",");
    if (asg.some((a) => { const last = one<{ d: string | null }>("SELECT MAX(report_date) d FROM progress_reports WHERE assignment_id = ? AND status <> 'rejected'", a.id).d ?? a.start_date; return !!last && last <= addDays(today0, -7); })) kinds.report_due++;
    if (one<{ n: number }>(`SELECT COUNT(*) n FROM progress_reports WHERE status = 'rejected' AND assignment_id IN (SELECT id FROM assignments WHERE subcontractor_id = ${c.id})`).n) kinds.report_rejected++;
    if (one<{ n: number }>(`SELECT COUNT(*) n FROM sub_invoices WHERE status = 'rejected' AND assignment_id IN (SELECT id FROM assignments WHERE subcontractor_id = ${c.id})`).n) kinds.invoice_returned++;
    if (all<{ expiry_date: string | null; status: string }>("SELECT expiry_date, status FROM subcontractor_documents WHERE subcontractor_id = ? AND status <> 'pending_review'", c.id).some((d) => docWarning(d.expiry_date, d.status))) kinds.doc_expiry++;
    if (one<{ n: number }>(`SELECT COUNT(*) n FROM issues WHERE awaiting_party = 'portal' AND status <> 'closed' AND assignment_id IN (${ids})`).n) kinds.issue_response++;
  }
  for (const [k, n] of Object.entries(kinds)) atLeast("Portal", `companies with action item: ${k}`, n, 1);
}

/* ---------------------------------------------------------------- Client portal (CLIENT_PORTAL_SPEC section 4) */
{
  const withProjects = all<{ id: number; name: string; portal_slug: string | null; portal_enabled: number }>("SELECT c.id, c.name, c.portal_slug, c.portal_enabled FROM clients c WHERE EXISTS (SELECT 1 FROM projects p WHERE p.client_id = c.id)");
  check("Client portal", "clients with projects that have a slug + portal enabled", withProjects.filter((c) => c.portal_slug && c.portal_enabled).length, `= ${withProjects.length}`, withProjects.every((c) => c.portal_slug && c.portal_enabled));
  const noAdmin = withProjects.filter((c) => !one<{ n: number }>("SELECT COUNT(*) n FROM client_users WHERE client_id = ? AND role = 'admin' AND status = 'active'", c.id).n);
  check("Client portal", "clients with projects without an active admin", noAdmin.length, "= 0", noAdmin.length === 0);
  const orphan = all("SELECT DISTINCT u.client_id FROM client_users u WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = u.client_id)");
  check("Client portal", "client users whose client has no project", orphan.length, "= 0", orphan.length === 0);
  const noProjPortal = all("SELECT id FROM clients c WHERE c.portal_enabled = 1 AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = c.id)");
  check("Client portal", "clients without projects that have the portal on", noProjPortal.length, "= 0", noProjPortal.length === 0);
  atLeast("Client portal", "clients without projects (no portal)", one<{ n: number }>("SELECT COUNT(*) n FROM clients c WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.client_id = c.id)").n, 2);
  atLeast("Client portal", "client users", one<{ n: number }>("SELECT COUNT(*) n FROM client_users").n, 8);
  atLeast("Client portal", "user who must change the password", one<{ n: number }>("SELECT COUNT(*) n FROM client_users WHERE must_change_password = 1").n, 1);
  atLeast("Client portal", "disabled user", one<{ n: number }>("SELECT COUNT(*) n FROM client_users WHERE status = 'disabled'").n, 1);
  atLeast("Client portal", "client with financials hidden", one<{ n: number }>("SELECT COUNT(*) n FROM clients WHERE portal_enabled = 1 AND portal_show_financials = 0").n, 1);
  atLeast("Client portal", "client with subcontractor names hidden", one<{ n: number }>("SELECT COUNT(*) n FROM clients WHERE portal_enabled = 1 AND portal_show_subcontractors = 0").n, 1);
  atLeast("Client portal", "viewer limited to one project (project_scope)", one<{ n: number }>("SELECT COUNT(*) n FROM client_users WHERE project_scope IS NOT NULL").n, 1);
  atLeast("Client portal", "client auth events", one<{ n: number }>("SELECT COUNT(*) n FROM client_auth_events").n, 25);
  const noPhotos = withProjects.filter((c) => !one<{ n: number }>(`SELECT COUNT(*) n FROM attachments a JOIN progress_reports r ON r.id = a.entity_id JOIN projects p ON p.id = r.project_id
    WHERE a.entity_type = 'progress' AND a.mime LIKE 'image/%' AND r.status = 'verified' AND p.client_id = ?`, c.id).n);
  check("Client portal", "clients with projects without a verified site photo", noPhotos.length, "= 0", noPhotos.length === 0);
  atLeast("Client portal", "clients with at least one open issue (kind=issue)", withProjects.filter((c) => one<{ n: number }>("SELECT COUNT(*) n FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.client_id = ? AND i.kind = 'issue' AND i.status <> 'closed'", c.id).n > 0).length, 3);
}

/* ---------------------------------------------------------------- report */
console.log(`\nDemo data coverage as of ${today}\n`);
const w = { area: 10, check: 62, value: 24, need: 22 };
const line = (a: string, c: string, v: string, n: string, s: string) => `${a.padEnd(w.area)} ${c.padEnd(w.check)} ${v.padStart(w.value)}  ${n.padEnd(w.need)} ${s}`;
console.log(line("AREA", "CHECK", "VALUE", "REQUIRED", ""));
console.log("-".repeat(w.area + w.check + w.value + w.need + 8));
for (const r of rows) console.log(line(r.area, r.check, r.value, r.need, r.ok ? "ok" : "FAIL"));
{
  const f = (x: number | null) => (x === null ? "-" : x.toFixed(2));
  console.log("\nPer project: today | today+400 d");
  console.log("CODE          STATUS      RAG    SPI   CPI  DELAY |  RAG    SPI   CPI  DELAY");
  for (const p of data.projects) {
    const a = d.proj.get(p.id)!, b = fut.proj.get(p.id)!;
    console.log(`${p.code}  ${p.status.padEnd(10)}  ${a.rag.padEnd(5)} ${f(a.spi).padStart(5)} ${f(a.cpi).padStart(5)} ${String(a.delayDays).padStart(5)} | ${b.rag.padEnd(5)} ${f(b.spi).padStart(5)} ${f(b.cpi).padStart(5)} ${String(b.delayDays).padStart(5)}`);
  }
}
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} checks passed.`);
if (bad.length) {
  console.log("\nGaps:");
  for (const r of bad) console.log(`  - [${r.area}] ${r.check}: got ${r.value}, need ${r.need}`);
  process.exit(1);
}
void projById;
