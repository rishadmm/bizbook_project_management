/* eslint-disable @typescript-eslint/no-explicit-any */
// `npm run seed` — wipes the DB (data/ops.db) and uploads/, then seeds ONE company (Al Noor Infrastructure LLC) operating in two countries:
// the UAE profile first (ids identical to the single-country dataset), then the Oman profile, each into its own entity (AE / OM) with its own
// currency, codes (OM- prefix), clients, projects and approval workflows. Region data lives in src/lib/seed-regions/{uae,oman}.ts.
// Run from the project root (db.ts resolves data/ and schema.sql from process.cwd()).
import path from "node:path";
import { getDb } from "./db";
import { getProjectMetrics } from "./metrics";
import { DEMO_ADMIN_PASSWORD, DEMO_USER_PASSWORD } from "./migrate";
import { SEED_ORDER } from "./seed-regions";
import { seedRegion, wipeDatabase, type RegionResult } from "./seed-engine";
import { DEMO_PORTAL_PASSWORD } from "./portal-core";
import { DEMO_CLIENT_PASSWORD } from "./client-portal-perms";
import { seedProcurement, tendering } from "./seed-procurement";

const UPLOADS = process.env.OPS_UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
const PORT = process.env.SEED_PORT ?? "3100";
const db = getDb();
const q = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
const q1 = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as any[])) as T | undefined;

async function main() {
  wipeDatabase(UPLOADS);
  const results: RegionResult[] = [];
  for (const profile of SEED_ORDER) results.push(await seedRegion(profile, UPLOADS, results[0] ?? null));
  // procurement phase: supplier registration (and, with Part B, supplier tendering) on top of both countries; appends rows only
  const procurement = await seedProcurement(db, results, UPLOADS);

  const count = (t: string, where = "") => (q1<any>(`SELECT COUNT(*) c FROM ${t} ${where}`)!).c;
  console.log("\nSeed summary (all countries):");
  for (const t of ["entities", "currencies", "fx_rates", "user_entities", "departments", "users", "clients", "tenders", "tender_sections", "tender_revisions", "budget_lines", "margin_changes", "tender_reviews", "negotiations", "loss_analyses", "projects", "stages", "project_budget_lines",
    "subcontractors", "subcontractor_documents", "onboarding_checklist", "assignments", "progress_reports", "progress_materials", "progress_manpower", "sub_invoices", "completion_certificates", "project_costs", "issues", "attachments", "activity_log", "approval_workflows", "approval_levels", "approval_requests", "approval_tasks", "approval_delegations", "approval_events", "project_cost_requests",
    "supplier_categories", "subcontractor_categories", "subcontractor_contacts", "subcontractor_experience", "registration_doc_types", "registration_reviews", "registration_items", "email_outbox", "portal_notifications"])
    console.log(`  ${t.padEnd(26)} ${count(t)}`);
  for (const r of results) {
    const e = q1<any>("SELECT * FROM entities WHERE id = ?", r.entityId)!;
    console.log(`\n=== ${e.flag} ${e.country} (${e.code}, ${e.currency}) — ${e.legal_name} ===`);
    console.log("Approval requests by status:");
    for (const x of q<any>("SELECT status, COUNT(*) c FROM approval_requests WHERE entity_id = ? GROUP BY status", r.entityId)) console.log(`  ${String(x.status).padEnd(10)} ${x.c}`);
    console.log("Project health:");
    for (const pid of r.projectIds) {
      const p = q1<any>("SELECT code, name FROM projects WHERE id=?", pid)!;
      const m = getProjectMetrics(pid);
      console.log(`  ${p.code} actual ${m.actualPct.toFixed(1)}% planned ${m.plannedPct.toFixed(1)}% SPI ${m.spi?.toFixed(2) ?? "-"} CPI ${m.cpi?.toFixed(2) ?? "-"} RAG ${m.rag} delay ${m.delayDays}d  BAC ${Math.round(m.bac / 1e6)}M AC ${Math.round(m.ac / 1e6)}M  ${p.name}`);
    }
    console.log(`Subcontractor portals (login per company, password ${DEMO_PORTAL_PASSWORD} for every demo user; one user must change it, one is locked, one disabled):`);
    for (const p of r.portalDemo.slugs) console.log(`  ${p.sub.padEnd(40)} ${p.enabled ? `http://localhost:${PORT}/p/${p.slug}  owner: ${p.owner}` : `/p/${p.slug}  (portal off)`}`);
    console.log(`Client portals (read-only; password ${DEMO_CLIENT_PASSWORD} for every demo user; one user must change it, one is disabled; one client hides financials, one hides subcontractor names):`);
    for (const p of r.clientDemo.rows) console.log(`  ${p.client.padEnd(46)} ${p.enabled ? `http://localhost:${PORT}/c/${p.slug}  admin: ${p.admin}  (${p.note})` : `(${p.note})`}`);
    console.log(`Invoice documents: ${r.invoiceFiles} attachment files. Demo invoices: showcase http://localhost:${PORT}/invoices/${r.invoiceDemo.showcaseId}, long (multi-page) http://localhost:${PORT}/invoices/${r.invoiceDemo.longId}`);
  }
  console.log("\nSupplier registration (public pages: http://localhost:" + PORT + "/suppliers and /suppliers/login; password " + DEMO_PORTAL_PASSWORD + " for every supplier login):");
  for (const d of procurement) {
    console.log(`  ${d.code}: procurement users ${d.procurementUsers.map((u) => `${u.email} (${u.title})`).join(", ")}`);
    for (const [label, x] of [["referred back", d.referredBack], ["resubmitted", d.resubmitted], ["draft", d.draft], ["approved this week", d.approvedThisWeek], ["rejected", d.rejected]] as const)
      if (x) console.log(`    ${label.padEnd(20)} ${x.email.padEnd(44)} /p/${x.slug}  ${x.company}`);
  }
  console.log("\nSupplier tenders (Procurement: http://localhost:" + PORT + "/procurement; 32 of 40 subcontracts per country were awarded through tenders):");
  for (const d of tendering) {
    console.log(`  ${d.code}: ${d.historic} historic awarded tenders; live tenders (project / stage):`);
    for (const l of d.live) console.log(`    ${l.status.padEnd(17)} ${l.code.padEnd(17)} ${l.project} ${l.stage.slice(0, 34).padEnd(34)} ${l.note}`);
    if (d.demo) console.log(`    portal demo supplier: ${d.demo.email} (${d.demo.company}) /p/${d.demo.slug}: ${d.demo.notes}`);
  }
  console.log("\nDemo logins (local demo only). Countries: AE = United Arab Emirates, OM = Oman");
  for (const u of q<any>(`SELECT u.email, r.name role, u.job_title,
      (SELECT group_concat(e.code, '+') FROM user_entities ue JOIN entities e ON e.id = ue.entity_id WHERE ue.user_id = u.id) countries FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`))
    console.log(`  ${String(u.email).padEnd(34)} ${u.email === results[0].profile.tenant.adminEmail ? DEMO_ADMIN_PASSWORD : DEMO_USER_PASSWORD}   ${String(u.countries).padEnd(6)} (${u.role})`);
  console.log("\nDone.");
}
main().catch((e) => { console.error(e); process.exit(1); });
