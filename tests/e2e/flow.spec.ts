/**
 * End-to-end flow test: tender -> review -> negotiation -> won -> project -> subcontract -> portal -> invoice -> certificate.
 * Requires a running server and a freshly seeded DB:  npm run seed && E2E_BASE_URL=http://localhost:3101 npm run test:e2e
 * NOTE: this test MUTATES data/ops.db; re-run `npm run seed` afterwards.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const db = () => new Database((process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db")), { readonly: true });
const q = <T,>(sql: string, ...p: unknown[]) => { const d = db(); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];

const consoleProblems: string[] = [];
let ctx: BrowserContext;
let page: Page;

let currentUser = 0;
/** Sign in as a seeded user (id -> email from the DB; admin Admin@12345, others Password@123). */
async function as(userId: number) {
  if (currentUser === userId) return;
  const email = one<{ email: string }>("select email from users where id=?", userId).email;
  await ctx.clearCookies();
  await page.goto("/login");
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(userId === 1 ? "Admin@12345" : "Password@123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
  currentUser = userId;
}
async function go(url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}
/** Wait for the server action round trip (network idle) after a click. */
async function settle() {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
async function clickBtn(name: string | RegExp, scope: Page | ReturnType<Page["locator"]> = page) {
  await scope.getByRole("button", { name }).first().click();
  await settle();
}
const modal = () => page.locator("div.fixed.inset-0");
/** Sign in as `userId`, open the approval inbox and approve the pending task of document `ref` (exercises the quick-decision form). */
async function approveInInbox(userId: number, ref: string) {
  await as(userId);
  await go("/approvals");
  const row = page.locator("tbody tr", { hasText: ref }).first();
  await expect(row, `inbox of user ${userId} should list ${ref}`).toBeVisible();
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await settle();
}
const pendingTasks = (type: string, docId: number) => q<{ assignee_user_id: number; level_no: number }>(
  "select t.assignee_user_id, t.level_no from approval_tasks t join approval_requests r on r.id=t.request_id where r.document_type=? and r.document_id=? and r.status='pending' and t.status='pending'", type, docId);

test.describe.serial("tender-to-project flow", () => {
  let tenderId = 0;
  let projectId = 0;
  let lostTenderId = 0;
  let subId = 0;
  let token = "";
  let assignmentId = 0;
  let invNo = ""; // our invoice number of the portal invoice (the sub's own ref is QA-INV-1)

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" || /hydrat/i.test(m.text())) consoleProblems.push(`[${m.type()}] ${page.url()} :: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => consoleProblems.push(`[pageerror] ${page.url()} :: ${e.message.slice(0, 300)}`));
    page.on("dialog", (d) => d.accept());
    await as(1);
  });
  test.afterAll(async () => {
    console.log("CONSOLE PROBLEMS:\n" + (consoleProblems.join("\n") || "(none)"));
    await ctx.close();
  });

  test("create tender", async () => {
    await go("/tenders/new");
    await page.locator("[name=title]").fill("QA Road Widening Package");
    await page.locator("[name=category]").selectOption("road");
    await page.locator("[name=client_id]").selectOption({ index: 1 });
    await page.locator("[name=location]").fill("Dubai");
    await page.locator("[name=quantity]").fill("10");
    await page.locator("[name=quantity_unit]").selectOption("km");
    await page.locator("[name=estimated_value]").fill("5000000");
    await page.locator("[name=submission_deadline]").fill("2026-12-30");
    await page.getByRole("button", { name: "Create tender" }).click();
    await page.waitForURL(/\/tenders\/\d+/);
    tenderId = Number(page.url().match(/tenders\/(\d+)/)![1]);
    const t = one<{ status: string; code: string }>("select status, code from tenders where id=?", tenderId);
    expect(t.status).toBe("draft");
    expect(q("select id from tender_sections where tender_id=?", tenderId).length).toBe(7);
    expect(q("select id from tender_revisions where tender_id=?", tenderId).length).toBe(1);
  });

  test("start preparation", async () => {
    await go(`/tenders/${tenderId}`);
    await clickBtn("Start preparation");
    expect(one<{ status: string }>("select status from tenders where id=?", tenderId).status).toBe("in_preparation");
  });

  test("complete department sections", async () => {
    await go(`/tenders/${tenderId}?tab=departments`);
    const forms = page.locator("form").filter({ has: page.getByRole("button", { name: "Save section" }) });
    const n = await forms.count();
    expect(n).toBe(7);
    for (let i = 0; i < n; i++) {
      const f = forms.nth(i);
      await f.locator("textarea[name=content]").fill(`QA contribution ${i + 1}`);
      await f.locator("select[name=status]").selectOption("completed");
      await f.getByRole("button", { name: "Save section" }).click();
      await settle();
    }
    expect(one<{ c: number }>("select count(*) c from tender_sections where tender_id=? and status='completed'", tenderId).c).toBe(7);
  });

  test("budget lines, margin edit with reason, bulk margin", async () => {
    await go(`/tenders/${tenderId}?tab=budget`);
    const cats: [string, string, string, string, string][] = [
      ["Manpower", "Crew labour", "100", "50", "Stage A"],
      ["Material", "Asphalt", "200", "80", "Stage A"],
      ["Equipment", "Paver hire", "10", "1000", "Stage B"],
      ["Overhead", "Site overhead", "1", "20000", "General"],
    ];
    for (const [cat, desc, qty, cost, wbs] of cats) {
      const section = page.locator("tbody").filter({ hasText: new RegExp(`^\\s*${cat}`, "i") }).first();
      await section.getByRole("button", { name: "Add line" }).click();
      await settle();
      const row = section.locator("tr[data-line]").last();
      await row.locator('input[data-col="description"]').fill(desc);
      await row.locator('input[data-col="unit"]').fill("nos");
      await row.locator('input[data-col="quantity"]').fill(qty);
      await row.locator('input[data-col="unit_cost"]').fill(cost);
      await row.locator('input[data-col="wbs_stage"]').fill(wbs);
      await row.locator('input[data-col="wbs_stage"]').blur();
      await settle();
    }
    const lines = q<{ description: string; quantity: number; unit_cost: number; wbs_stage: string }>("select * from budget_lines where tender_id=? order by id", tenderId);
    expect(lines.length).toBe(4);
    expect(lines.map((l) => l.wbs_stage)).toEqual(["Stage A", "Stage A", "Stage B", "General"]);
    expect(lines[1].quantity).toBe(200);
    // margin edit -> reason prompt
    const first = page.locator("tr[data-line]").first();
    await first.locator('input[data-col="margin_pct"]').fill("12");
    await first.locator('input[data-col="margin_pct"]').blur();
    await expect(page.getByText("Reason for margin change")).toBeVisible();
    await page.locator("textarea").last().fill("QA line margin test");
    await clickBtn("Apply", modal());
    expect(one<{ c: number }>("select count(*) c from margin_changes where reason='QA line margin test'").c).toBe(1);
    // bulk
    await clickBtn("Bulk markup");
    await modal().getByRole("spinbutton").fill("15");
    await modal().locator("textarea").fill("QA bulk margin");
    await clickBtn("Apply", modal());
    const m = q<{ margin_pct: number }>("select margin_pct from budget_lines where tender_id=?", tenderId);
    expect(m.every((x) => x.margin_pct === 15)).toBeTruthy();
    const rev = one<{ total_cost: number; total_price: number }>("select total_cost,total_price from tender_revisions where tender_id=?", tenderId);
    // cost = 5000+16000+10000+20000 = 51000; price = 51000*1.15
    expect(Math.round(rev.total_cost)).toBe(51000);
    expect(Math.round(rev.total_price)).toBe(Math.round(51000 * 1.15));
    expect(one<{ c: number }>("select count(*) c from margin_changes where reason like '%QA bulk margin'").c).toBeGreaterThan(0);
  });

  test("send for review, approve through the 3-level workflow", async () => {
    await go(`/tenders/${tenderId}`);
    await clickBtn("Send for review");
    expect(one<{ status: string }>("select status from tenders where id=?", tenderId).status).toBe("under_review");
    const req = one<{ id: number; current_level: number; status: string }>("select id, current_level, status from approval_requests where document_type='tender_submission' and document_id=?", tenderId);
    expect(req.status).toBe("pending");
    expect(q("select id from tender_reviews where tender_id=?", tenderId).length).toBe(0); // legacy reviews are no longer created
    // L1 Technical head Sara(4) - or her delegate Daniel(7): the seed has Sara out of office - then L2 Finance head Imran(5), L3 Management role Hamdan(11)
    const first = q<{ assignee_user_id: number; delegated_from_user_id: number | null }>("select assignee_user_id, delegated_from_user_id from approval_tasks where request_id=? and status='pending'", req.id);
    expect(first).toHaveLength(1);
    expect([4, 7]).toContain(first[0].assignee_user_id);
    const approvers: number[] = [];
    for (let level = 1; level <= 3; level++) {
      const pend = pendingTasks("tender_submission", tenderId);
      expect(pend.length).toBeGreaterThan(0);
      expect(pend[0].level_no).toBe(level);
      approvers.push(pend[0].assignee_user_id);
      await as(pend[0].assignee_user_id);
      await go(`/tenders/${tenderId}?tab=approvals`);
      await clickBtn("Approve", page.locator("[data-approval-panel=tender_submission]"));
    }
    expect(approvers.slice(1)).toEqual([5, 11]);
    const done = q<{ status: string; decided_by: number }>("select t.status, t.decided_by from approval_tasks t join approval_requests r on r.id=t.request_id where r.document_type='tender_submission' and r.document_id=? and t.status='approved'", tenderId);
    expect(new Set(done.map((d) => d.decided_by))).toEqual(new Set(approvers));
    expect(one<{ status: string }>("select status from approval_requests where id=?", req.id).status).toBe("approved");
    expect(one<{ status: string }>("select status from tenders where id=?", tenderId).status).toBe("approved");
  });

  test("submit, negotiate, new revision, submit revision", async () => {
    await as(1);
    await go(`/tenders/${tenderId}`);
    await clickBtn("Submit to client");
    expect(one<{ status: string }>("select status from tenders where id=?", tenderId).status).toBe("submitted");
    await clickBtn("Move to negotiation");
    expect(one<{ status: string }>("select status from tenders where id=?", tenderId).status).toBe("negotiation");
    await go(`/tenders/${tenderId}?tab=commercial`);
    await clickBtn("Log negotiation");
    await modal().locator("[name=summary]").fill("QA negotiation meeting");
    await modal().locator("[name=client_target_price]").fill("55000");
    await clickBtn("Save", modal());
    expect(q("select id from negotiations where tender_id=?", tenderId).length).toBe(1);
    await clickBtn("Create new revision");
    await modal().locator("[name=reason]").fill("QA client wants lower price");
    await clickBtn("Create", modal());
    expect(q("select id from tender_revisions where tender_id=?", tenderId).length).toBe(2);
    const cur = one<{ rev_no: number; status: string; line_count: number }>(
      "select r.rev_no, r.status, (select count(*) from budget_lines b where b.revision_id=r.id) line_count from tender_revisions r join tenders t on t.current_revision_id=r.id where t.id=?", tenderId);
    expect(cur.rev_no).toBe(1);
    expect(cur.status).toBe("draft");
    expect(cur.line_count).toBe(4);
    // lower margin on R1
    await go(`/tenders/${tenderId}?tab=budget`);
    const first = page.locator("tr[data-line]").first();
    await first.locator('input[data-col="margin_pct"]').fill("8");
    await first.locator('input[data-col="margin_pct"]').blur();
    await page.locator("textarea").last().fill("QA R1 concession");
    await clickBtn("Apply", modal());
    await go(`/tenders/${tenderId}?tab=commercial`);
    await clickBtn(/Submit R1 for approval/);
    const r1 = one<{ id: number }>("select id from tender_revisions where tender_id=? and rev_no=1", tenderId);
    expect(one<{ status: string }>("select status from tender_revisions where id=?", r1.id).status).toBe("draft"); // stays draft until approved
    expect(pendingTasks("tender_revision", r1.id).map((t) => t.assignee_user_id)).toEqual([3]); // L1 Commercial head Rahul
    await approveInInbox(3, "R1");
    await approveInInbox(11, "R1"); // L2 management
    const revs = q<{ rev_no: number; status: string }>("select rev_no,status from tender_revisions where tender_id=? order by rev_no", tenderId);
    expect(revs[0].status).toBe("superseded");
    expect(revs[1].status).toBe("submitted");
    await as(1);
  });

  test("mark won creates project with budget lines and stages", async () => {
    await go(`/tenders/${tenderId}`);
    await clickBtn("Mark Won");
    await modal().locator("[name=start_date]").fill("2026-11-01");
    await modal().locator("[name=end_date]").fill("2027-03-01");
    await modal().locator("[name=manager_id]").selectOption({ index: 2 });
    await modal().getByRole("button", { name: "Mark won and create project" }).click();
    await page.waitForURL(/\/tenders\/\d+\?tab=approvals/, { timeout: 30000 });
    // the award waits for the tender_award workflow (L1 Management role; the GM level only applies from 20M)
    expect(one<{ status: string; project_id: number | null }>("select status, project_id from tenders where id=?", tenderId)).toMatchObject({ status: "negotiation", project_id: null });
    await approveInInbox(11, one<{ code: string }>("select code from tenders where id=?", tenderId).code);
    await as(1);
    const t = one<{ status: string; project_id: number }>("select status, project_id from tenders where id=?", tenderId);
    projectId = t.project_id;
    await go(`/projects/${projectId}`);
    expect(t.status).toBe("won");
    expect(t.project_id).toBe(projectId);
    expect(q("select id from project_budget_lines where project_id=?", projectId).length).toBe(4);
    const st = q<{ name: string; budget_amount: number }>("select name,budget_amount from stages where project_id=? order by sort", projectId);
    expect(st.map((s) => s.name).sort()).toEqual(["Stage A", "Stage B"]);
    expect(q("select id from project_budget_lines where project_id=? and stage_id is null", projectId).length).toBe(1);
    const p = one<{ contract_value: number; budget_cost: number }>("select contract_value,budget_cost from projects where id=?", projectId);
    expect(Math.round(p.budget_cost)).toBe(51000);
  });

  test("draw route on map and split into stages", async () => {
    await go(`/projects/${projectId}?tab=map&edit=1`);
    const map = page.locator(".leaflet-container").first();
    await expect(map).toBeVisible();
    await page.waitForSelector(".leaflet-pm-toolbar", { timeout: 20000 });
    await page.locator(".leaflet-pm-icon-polyline").first().click();
    const box = (await map.boundingBox())!;
    const pts = [[0.3, 0.5], [0.5, 0.4], [0.7, 0.55]];
    for (const [fx, fy] of pts) await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    // finish: click last vertex again
    const last = pts[pts.length - 1];
    await page.mouse.click(box.x + box.width * last[0], box.y + box.height * last[1]);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /save/i }).first().click();
    await settle();
    const g = one<{ geometry: string | null }>("select geometry from projects where id=?", projectId).geometry;
    expect(g).toBeTruthy();
    await go(`/projects/${projectId}?tab=stages`);
    await clickBtn("Split route");
    await modal().locator("[name=n]").fill("3");
    await modal().locator("input[name=replace]").first().check().catch(() => {});
    await modal().getByRole("button", { name: "Create stages" }).first().click();
    await settle();
    const stages = q<{ id: number; code: string; geometry: string | null }>("select id,code,geometry from stages where project_id=?", projectId);
    expect(stages.length).toBeGreaterThanOrEqual(3);
    expect(stages.filter((s) => s.geometry).length).toBeGreaterThanOrEqual(3);
  });

  test("create subcontract assignment", async () => {
    await go(`/projects/${projectId}?tab=subcontracts`);
    await clickBtn("New subcontract");
    await modal().locator("[name=subcontractor_id]").selectOption({ index: 1 });
    await modal().locator("[name=stage_id]").selectOption({ index: 1 });
    await modal().locator("[name=scope]").fill("QA paving works");
    await modal().locator("[name=quantity]").fill("100");
    await modal().locator("[name=unit_rate]").fill("500");
    await modal().locator("[name=start_date]").fill("2026-11-01");
    await modal().locator("[name=end_date]").fill("2027-02-01");
    await modal().locator("[name=status]").selectOption("active");
    await modal().getByRole("button", { name: /save|create|add/i }).last().click();
    await settle();
    let a = one<{ id: number; contract_value: number; portal_token: string; portal_enabled: number; status: string; code: string }>("select id,contract_value,portal_token,portal_enabled,status,code from assignments where project_id=?", projectId);
    expect(a).toBeTruthy();
    assignmentId = a.id; token = a.portal_token;
    expect(a.contract_value).toBe(50000);
    expect(token.length).toBeGreaterThan(10);
    // activation is gated by the subcontract_award workflow: L1 project manager, L2 management
    expect(a.status).toBe("draft");
    const pm = one<{ manager_id: number }>("select manager_id from projects where id=?", projectId).manager_id;
    await approveInInbox(pm, a.code);
    await approveInInbox(11, a.code);
    await as(1);
    a = one("select id,contract_value,portal_token,portal_enabled,status,code from assignments where project_id=?", projectId);
    expect(a.status).toBe("active");
    if (!a.portal_enabled) {
      // enable portal via UI
      for (let attempt = 0; attempt < 3; attempt++) {
        await go(`/projects/${projectId}?tab=subcontracts`);
        await page.waitForTimeout(800); // let React hydrate before submitting the server-action form
        await page.locator('button[title="Click to toggle"]').last().click();
        await settle();
        if (one<{ portal_enabled: number }>("select portal_enabled from assignments where id=?", assignmentId).portal_enabled === 1) break;
      }
    }
    expect(one<{ portal_enabled: number }>("select portal_enabled from assignments where id=?", assignmentId).portal_enabled).toBe(1);
  });

  test("portal: progress report, invoice, certificate request", async () => {
    const portal = await ctx.newPage();
    portal.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) consoleProblems.push(`[portal ${m.type()}] ${m.text().slice(0, 300)}`); });
    await portal.goto(`/portal/${token}`);
    await portal.waitForLoadState("networkidle");
    await expect(portal.getByText("QA paving works").first()).toBeVisible();
    // progress
    await portal.locator("[name=report_date]").fill("2026-11-12");
    await portal.locator("[name=quantity_done]").fill("40");
    await portal.locator("[name=work_done]").fill("QA laid asphalt");
    await portal.getByRole("button", { name: "Submit progress report" }).click();
    await portal.waitForLoadState("networkidle"); await portal.waitForTimeout(800);
    const r = one<{ source: string; status: string; quantity_done: number }>("select source,status,quantity_done from progress_reports where assignment_id=?", assignmentId);
    expect(r).toMatchObject({ source: "portal", status: "submitted", quantity_done: 40 });
    // invoice
    await portal.locator("[name=sub_invoice_ref]").fill("QA-INV-1");
    await portal.locator("[name=line_this_qty]").first().fill("5");
    await portal.locator("[name=att_file]").first().setInputFiles({ name: "qa-tax-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 qa tax invoice") });
    await portal.getByRole("button", { name: "Submit invoice" }).click();
    await portal.waitForLoadState("networkidle"); await portal.waitForTimeout(800);
    expect(one<{ status: string; source: string }>("select status,source from sub_invoices where assignment_id=?", assignmentId)).toMatchObject({ status: "submitted", source: "portal" });
    invNo = one<{ invoice_no: string }>("select invoice_no from sub_invoices where assignment_id=?", assignmentId).invoice_no;
    expect(invNo).toBeTruthy();
    // certificate
    await portal.locator("[name=percent]").fill("40");
    await portal.getByRole("button", { name: "Request certificate" }).click();
    await portal.waitForLoadState("networkidle"); await portal.waitForTimeout(800);
    expect(one<{ status: string; source: string }>("select status,source from completion_certificates where assignment_id=?", assignmentId)).toMatchObject({ status: "requested", source: "portal" });
    await portal.close();
  });

  test("verify report internally and metrics change", async () => {
    const before = one<{ c: number }>("select count(*) c from progress_reports where assignment_id=? and status='verified'", assignmentId).c;
    expect(before).toBe(0);
    await go(`/projects/${projectId}?tab=overview`);
    const overviewBefore = await page.locator("main").innerText();
    await go(`/projects/${projectId}?tab=progress`);
    await page.getByRole("button", { name: /verify/i }).first().click();
    await settle();
    expect(one<{ status: string }>("select status from progress_reports where assignment_id=?", assignmentId).status).toBe("verified");
    expect(one<{ c: number }>("select cumulative_quantity c from progress_reports where assignment_id=?", assignmentId).c).toBe(40);
    await go(`/projects/${projectId}?tab=overview`);
    const overviewAfter = await page.locator("main").innerText();
    expect(overviewAfter).not.toBe(overviewBefore); // actual % / SPI changed after verification
    await go(`/projects/${projectId}/stages/${one<{ stage_id: number }>("select stage_id from assignments where id=?", assignmentId).stage_id}`);
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test("invoice certify -> approve -> pay; issue certificate", async () => {
    await go(`/invoices`);
    const row = page.locator("tr", { hasText: invNo });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Start review/i }).click().catch(() => {});
    await settle();
    await go(`/invoices`);
    await clickBtn("Certify", page.locator("tr", { hasText: invNo }));
    await modal().locator("[name=certified_amount]").fill("18000");
    await modal().getByRole("button", { name: "Certify" }).click();
    await settle();
    let inv = one<{ status: string; certified_amount: number; retention_amount: number; net_payable: number }>("select status,certified_amount,retention_amount,net_payable from sub_invoices where assignment_id=?", assignmentId);
    expect(inv.status).toBe("certified");
    expect(inv.certified_amount).toBe(18000);
    expect(inv.retention_amount).toBeGreaterThan(0);
    // certification raised the sub_invoice request: L1 project manager, L2 finance role
    const invId = one<{ id: number }>("select id from sub_invoices where assignment_id=?", assignmentId).id;
    const pm = one<{ manager_id: number }>("select manager_id from projects where id=?", projectId).manager_id;
    expect(pendingTasks("sub_invoice", invId).map((t) => t.assignee_user_id)).toEqual([pm]);
    await approveInInbox(pm, invNo);
    await approveInInbox(5, invNo);
    await as(1);
    expect(one<{ status: string }>("select status from sub_invoices where assignment_id=?", assignmentId).status).toBe("approved");
    // auto-posted cost
    expect(one<{ c: number }>("select count(*) c from project_costs where project_id=? and source_type='sub_invoice'", projectId).c).toBe(1);
    await go(`/invoices`);
    await clickBtn("Mark paid", page.locator("tr", { hasText: invNo }));
    await modal().getByRole("button", { name: "Record payment" }).click();
    await settle();
    expect(one<{ status: string }>("select status from sub_invoices where assignment_id=?", assignmentId).status).toBe("approved"); // payment awaits approval
    await approveInInbox(5, invNo); // invoice_payment: finance role (L2 management only from 1M)
    await as(1);
    inv = one("select status,certified_amount,retention_amount,net_payable from sub_invoices where assignment_id=?", assignmentId);
    expect(inv.status).toBe("paid");
    // certificate
    await go(`/projects/${projectId}?tab=invoices`);
    await page.getByRole("button", { name: /^Issue/ }).first().click();
    await settle();
    expect(one<{ status: string }>("select status from completion_certificates where assignment_id=?", assignmentId).status).not.toBe("issued"); // awaits the PM
    const cert = one<{ id: number; cert_no: string | null }>("select id, cert_no from completion_certificates where assignment_id=?", assignmentId);
    await approveInInbox(one<{ manager_id: number }>("select manager_id from projects where id=?", projectId).manager_id, cert.cert_no ?? `#${cert.id}`);
    await as(1);
    expect(one<{ status: string }>("select status from completion_certificates where assignment_id=?", assignmentId).status).toBe("issued");
    // metrics
    await go(`/projects/${projectId}?tab=overview`);
    await expect(page.locator("body")).not.toContainText("NaN");
  });

  test("mark another tender lost and edit loss analysis", async () => {
    // use seeded negotiation/submitted tender
    const t = one<{ id: number }>("select id from tenders where status in ('negotiation','submitted') order by id desc limit 1");
    lostTenderId = t.id;
    await go(`/tenders/${lostTenderId}`);
    await clickBtn("Mark Lost");
    await modal().locator("[name=winner_name]").fill("QA Competitor LLC");
    await modal().locator("[name=winner_price]").fill("123456");
    await modal().getByRole("button", { name: "Mark lost and open analysis" }).click();
    await page.waitForURL(/lost-analysis\/\d+/, { timeout: 30000 });
    expect(one<{ status: string }>("select status from tenders where id=?", lostTenderId).status).toBe("lost");
    await page.locator("[name=lessons_learned]").fill("QA lesson text");
    await page.getByRole("button", { name: /save/i }).first().click();
    await settle();
    expect(one<{ lessons_learned: string }>("select lessons_learned from loss_analyses where tender_id=?", lostTenderId).lessons_learned).toContain("QA lesson");
  });

  test("subcontractor create, checklist, approve, document upload", async () => {
    await go("/subcontractors/new");
    await page.locator("[name=name]").fill("QA Subcontractor Co");
    await page.locator("[name=trade]").fill("Testing");
    await page.getByRole("button", { name: /create|save|add/i }).first().click();
    await page.waitForURL(/subcontractors\/\d+/, { timeout: 30000 });
    subId = Number(page.url().match(/subcontractors\/(\d+)/)![1]);
    await go(`/subcontractors/${subId}?tab=onboarding`);
    const n = q("select id from onboarding_checklist where subcontractor_id=?", subId).length;
    expect(n).toBe(6);
    for (let i = 0; i < n; i++) {
      await page.locator("li").filter({ has: page.locator("svg.lucide-circle") }).first().locator("button[title=Toggle]").click();
      await settle();
    }
    expect(one<{ c: number }>("select count(*) c from onboarding_checklist where subcontractor_id=? and done=1", subId).c).toBe(6);
    await clickBtn(/Approve subcontractor/);
    expect(one<{ status: string }>("select status from subcontractors where id=?", subId).status).toBe("onboarding"); // pending onboarding approval
    const subCode = one<{ code: string }>("select code from subcontractors where id=?", subId).code;
    await approveInInbox(8, subCode); // L1 Procurement head
    await approveInInbox(9, subCode); // L2 HSE head
    await as(1);
    expect(one<{ status: string }>("select status from subcontractors where id=?", subId).status).toBe("approved");
    await go(`/subcontractors/${subId}?tab=documents`);
    await clickBtn("Add document");
    await modal().locator("[name=ref_no]").fill("QA-DOC-1");
    await modal().locator("[name=expiry_date]").fill("2027-12-31");
    await modal().locator("input[type=file]").setInputFiles({ name: "licence.txt", mimeType: "text/plain", buffer: Buffer.from("qa licence") });
    await modal().getByRole("button", { name: "Add document" }).click();
    await settle();
    const d = one<{ attachment_id: number | null }>("select attachment_id from subcontractor_documents where subcontractor_id=?", subId);
    expect(d.attachment_id).toBeTruthy();
    const res = await page.request.get(`/api/files/${d.attachment_id}`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe("qa licence");
  });

  test("search, tender filters and CSV import", async () => {
    await go("/search?q=QA%20Road");
    await expect(page.locator("main")).toContainText("QA Road Widening Package");
    await go("/tenders?view=table");
    await expect(page.locator("main")).toContainText("QA Road Widening Package");
    await go(`/tenders/${lostTenderId}?tab=documents`);
    await expect(page.locator("main")).toContainText(/Documents|Upload/i);
    // CSV import into a draft revision of a fresh tender
    const draft = one<{ id: number; rev: number }>("select t.id id, t.current_revision_id rev from tenders t where status='draft' order by id desc limit 1");
    await go(`/tenders/${draft.id}?tab=budget`);
    await clickBtn("Import CSV");
    const csv = "category,item_code,description,unit,quantity,unit_cost,margin_pct,wbs_stage,notes\nmaterial,M1,CSV cable,m,100,5,10,Stage X,\n";
    await modal().locator("input[type=file]").setInputFiles({ name: "b.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await clickBtn("Import", modal());
    expect(one<{ c: number }>("select count(*) c from budget_lines where revision_id=? and description='CSV cable'", draft.rev).c).toBe(1);
  });

  test("no hydration/console errors on main pages", async () => {
    consoleProblems.length = 0;
    const urls = ["/", "/tenders", "/tenders?view=table", `/tenders/${tenderId}?tab=budget`, `/tenders/${tenderId}?tab=commercial`, "/lost-analysis", "/clients", "/projects", "/projects?view=map", `/projects/${projectId}?tab=overview`, `/projects/${projectId}?tab=map`, `/projects/${projectId}?tab=stages`, "/subcontractors", `/subcontractors/${subId}`, "/invoices", "/approvals", "/approvals?tab=submitted", "/approvals?tab=completed", "/approvals?tab=delegations", "/admin/approval-workflows", `/tenders/${tenderId}?tab=approvals`, "/settings", "/search?q=road", `/portal/${token}`];
    for (const u of urls) { await go(u); await page.waitForTimeout(500); }
    const real = consoleProblems.filter((p) => !/tile\.openstreetmap|arcgisonline|Failed to load resource.*(tile|net::ERR)/i.test(p));
    expect(real, real.join("\n")).toEqual([]);
  });
});
