/**
 * Multi-level approval workflow engine e2e (AUTH_SPEC section D). Requires a running server and a seeded DB (mutates data/ops.db):
 *   npm run seed && E2E_BASE_URL=http://localhost:3100 npm run test:e2e
 * Story: a designer builds a 2-level sub_invoice workflow, a certified invoice is approved by the PM (L1), returned by finance (L2),
 * re-certified and approved; a large amount picks the 3-level workflow; a delegation reroutes a task; a non-assignee cannot decide.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const q = <T,>(sql: string, ...p: unknown[]) => { const d = new Database((process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db")), { readonly: true }); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];

let ctx: BrowserContext;
let page: Page;
let currentUser = 0;
const problems: string[] = [];

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
async function go(url: string) { await page.goto(url); await page.waitForLoadState("networkidle"); }
async function settle() { await page.waitForLoadState("networkidle"); await page.waitForTimeout(500); }
const modal = () => page.locator("div.fixed.inset-0");
const inboxRow = (ref: string) => page.locator("tbody tr", { hasText: ref }).first();

async function certifyOnInvoicesPage(invoiceNo: string) {
  await go("/invoices");
  const row = page.locator("tr", { hasText: invoiceNo }).first();
  await row.getByRole("button", { name: "Certify" }).click();
  await modal().getByRole("button", { name: "Certify" }).click();
  await settle();
}
/** Records an invoice through the project's invoices tab (retries once if the form was submitted before hydration). */
async function recordInvoice(projectId: number, amount: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await go(`/projects/${projectId}?tab=invoices`);
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Record invoice" }).first().click();
    await modal().locator("[name=assignment_id]").selectOption({ index: 1 });
    await modal().locator("[name=claimed_amount]").fill(String(amount));
    await modal().getByRole("button", { name: "Record invoice" }).click();
    await settle();
    const row = q<{ id: number; invoice_no: string }>("select id, invoice_no from sub_invoices where project_id=? and claimed_amount=? order by id desc limit 1", projectId, amount)[0];
    if (row) return row;
  }
  throw new Error(`Invoice of ${amount} was not recorded`);
}
async function decideInInbox(userId: number, ref: string, decision: "Approve" | "Return" | "Reject", comment?: string) {
  await as(userId);
  await go("/approvals");
  const row = inboxRow(ref);
  await expect(row, `inbox of user ${userId} lists ${ref}`).toBeVisible();
  if (comment) await row.getByRole("textbox").fill(comment);
  await row.getByRole("button", { name: decision, exact: true }).click();
  await settle();
}
const request = (id: number) => one<{ id: number; status: string; current_level: number; workflow_id: number; levels_json: string; requested_by: number }>("select * from approval_requests where id=?", id);
const latestRequest = (type: string, docId: number) => one<{ id: number; status: string; current_level: number; workflow_id: number; levels_json: string; requested_by: number }>("select * from approval_requests where document_type=? and document_id=? order by id desc limit 1", type, docId);
const tasks = (requestId: number, status = "pending") => q<{ id: number; assignee_user_id: number; level_no: number; delegated_from_user_id: number | null; decision_comment: string | null; decided_by: number | null }>("select * from approval_tasks where request_id=? and status=? order by id", requestId, status);

test.describe.serial("multi-level approvals", () => {
  // the invoice used for the main story (a submitted invoice of a project that has a project manager)
  const inv = one<{ id: number; invoice_no: string; claimed_amount: number; project_id: number; manager_id: number }>(
    `select i.id, i.invoice_no, i.claimed_amount, i.project_id, p.manager_id from sub_invoices i join projects p on p.id = i.project_id
     where i.status='submitted' and p.manager_id is not null and i.claimed_amount > 1000 order by i.id limit 1`);
  const pm = inv?.manager_id;
  const wfName = `E2E two-level invoice ${Date.now()}`;
  let wfId = 0;
  let firstRequest = 0;
  let bigInvoiceNo = "";
  let delegatedInvoiceNo = "";
  let delegatedInvoiceId = 0;
  const delegate = 6; // Fatima Al Ali (HR): not the PM, not the requester

  test.beforeAll(async ({ browser }) => {
    expect(inv, "seed must contain a submitted invoice on a managed project").toBeTruthy();
    ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) problems.push(`[${m.type()}] ${page.url()} :: ${m.text().slice(0, 200)}`); });
    page.on("pageerror", (e) => problems.push(`[pageerror] ${page.url()} :: ${e.message.slice(0, 200)}`));
    await as(1);
  });
  test.afterAll(async () => {
    const real = problems.filter((p) => !/tile\.openstreetmap|arcgisonline|Failed to load resource/i.test(p));
    console.log("CONSOLE PROBLEMS:\n" + (real.join("\n") || "(none)"));
    await ctx.close();
  });

  test("designer builds a 2-level sub_invoice workflow with a live preview", async () => {
    await go("/admin/approval-workflows");
    await expect(page.getByRole("heading", { name: "Subcontractor invoice" }).first()).toBeVisible();
    await page.getByRole("link", { name: /New workflow/ }).click();
    await page.waitForURL(/approval-workflows\/new/);
    await page.waitForLoadState("networkidle");
    await page.locator("[name=name]").fill(wfName);
    await page.locator("[name=priority]").fill("100");
    await page.locator("[name=condition_min_amount]").fill(String(inv.claimed_amount - 1));
    await page.locator("[name=condition_max_amount]").fill(String(inv.claimed_amount + 1));
    await page.getByLabel("Level 1 name").fill("PM check");
    await page.getByLabel("Level 1 approver type").selectOption("project_manager");
    await page.getByRole("button", { name: "Add level" }).click();
    await page.getByLabel("Level 2 name").fill("Finance check");
    await page.getByLabel("Level 2 role").selectOption({ label: "Finance" });
    await page.getByLabel("Level 2 minimum amount").fill("1000000");
    // preview: level 2 is skipped below its minimum amount, applies above it, and shows today's finance approvers
    await page.getByLabel("Preview sample amount").fill("100");
    const prev = page.getByTestId("workflow-preview");
    await expect(prev.locator("[data-applies=no]")).toHaveCount(1);
    await expect(prev).toContainText("Level 2: Finance check");
    await page.getByLabel("Preview sample amount").fill("2000000");
    await expect(prev.locator("[data-applies=yes]")).toHaveCount(2);
    await expect(prev).toContainText("Imran Qureshi");
    await page.getByLabel("Level 2 minimum amount").fill(""); // the story needs both levels for this amount
    await page.getByRole("button", { name: "Save workflow" }).click();
    await page.waitForURL(/approval-workflows\?saved=\d+/);
    wfId = Number(page.url().match(/saved=(\d+)/)![1]);
    const w = one<{ name: string; document_type: string; priority: number; is_active: number }>("select * from approval_workflows where id=?", wfId);
    expect(w).toMatchObject({ name: wfName, document_type: "sub_invoice", priority: 100, is_active: 1 });
    const lv = q<{ level_no: number; approver_type: string; approver_role_id: number | null; min_amount: number | null }>("select * from approval_levels where workflow_id=? order by level_no", wfId);
    expect(lv.map((l) => l.approver_type)).toEqual(["project_manager", "role"]);
    expect(lv[1].min_amount).toBeNull();
    await expect(page.locator("tr", { hasText: wfName })).toBeVisible();
  });

  test("certified invoice raises the request: L1 is assigned to the project manager", async () => {
    await as(1);
    await certifyOnInvoicesPage(inv.invoice_no);
    expect(one<{ status: string }>("select status from sub_invoices where id=?", inv.id).status).toBe("certified");
    const r = latestRequest("sub_invoice", inv.id);
    firstRequest = r.id;
    expect(r).toMatchObject({ status: "pending", current_level: 1, workflow_id: wfId, requested_by: 1 });
    expect(JSON.parse(r.levels_json)).toHaveLength(2);
    expect(tasks(r.id).map((t) => t.assignee_user_id)).toEqual([pm]);
    // the PM sees it in the sidebar badge and inbox, overdue flag absent
    await as(pm);
    await go("/approvals");
    await expect(page.getByTestId("approvals-badge").first()).toBeVisible();
    await expect(inboxRow(inv.invoice_no)).toContainText("L1/2");
  });

  test("PM approves L1; L2 finance user returns with a comment", async () => {
    await decideInInbox(pm, inv.invoice_no, "Approve");
    let r = request(firstRequest);
    expect(r).toMatchObject({ status: "pending", current_level: 2 });
    const l2 = tasks(r.id).map((t) => t.assignee_user_id).sort((a, b) => a - b);
    expect(l2).toEqual([5, 12]); // finance role: Imran and Mariam (requester Omar is not finance)
    // Return needs a comment (server-side rule)
    await as(5);
    await go("/approvals");
    await inboxRow(inv.invoice_no).getByRole("button", { name: "Return", exact: true }).click();
    await settle();
    expect(request(firstRequest).status).toBe("pending"); // blocked: a comment is required to return
    await decideInInbox(5, inv.invoice_no, "Return", "Retention deduction is missing, please re-certify.");
    r = request(firstRequest);
    expect(r.status).toBe("returned");
    expect(tasks(r.id, "returned")[0]).toMatchObject({ assignee_user_id: 5, decision_comment: "Retention deduction is missing, please re-certify." });
    expect(one<{ status: string }>("select status from sub_invoices where id=?", inv.id).status).toBe("under_review");
    expect(tasks(r.id)).toHaveLength(0); // no open task left
  });

  test("requester resubmits (re-certify) and both levels approve; invoice approved and cost posted", async () => {
    await as(1);
    await certifyOnInvoicesPage(inv.invoice_no);
    const r = latestRequest("sub_invoice", inv.id);
    expect(r.id).toBeGreaterThan(firstRequest);
    expect(r).toMatchObject({ status: "pending", current_level: 1 });
    await decideInInbox(pm, inv.invoice_no, "Approve");
    await decideInInbox(12, inv.invoice_no, "Approve"); // Mariam (finance) this time
    expect(request(r.id).status).toBe("approved");
    expect(one<{ status: string }>("select status from sub_invoices where id=?", inv.id).status).toBe("approved");
    const cost = one<{ amount: number }>("select amount from project_costs where source_type='sub_invoice' and source_id=?", inv.id);
    expect(cost.amount).toBeCloseTo(inv.claimed_amount, 1);
    const ev = q<{ event: string }>("select event from approval_events where request_id=? order by id", r.id).map((e) => e.event);
    expect(ev).toEqual(expect.arrayContaining(["submitted", "approved", "level_completed", "approved"]));
    // the history stays visible on the document
    await as(1);
    await go(`/projects/${inv.project_id}?tab=invoices`);
    await page.locator("tr", { hasText: inv.invoice_no }).getByRole("button", { name: /Invoice approval/ }).click();
    await expect(modal()).toContainText("Level 2");
    await expect(modal()).toContainText("Earlier request");
    await expect(modal()).toContainText("Retention deduction is missing"); // the returned request and its comment stay visible
  });

  test("an amount above 500k picks the 3-level workflow", async () => {
    await as(1);
    const big = await recordInvoice(inv.project_id, 650000);
    bigInvoiceNo = big.invoice_no;
    await certifyOnInvoicesPage(bigInvoiceNo);
    const r = latestRequest("sub_invoice", big.id);
    const wf = one<{ name: string }>("select name from approval_workflows where id=?", r.workflow_id);
    expect(wf.name).toMatch(/>= 500k/);
    expect(JSON.parse(r.levels_json)).toHaveLength(3);
    expect(r.current_level).toBe(1);
  });

  test("a delegation routes the task to the delegate", async () => {
    await as(pm);
    await go("/approvals?tab=delegations");
    await page.locator("[name=delegate_user_id]").selectOption(String(delegate));
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await page.locator("[name=end_date]").fill(end);
    await page.getByRole("button", { name: "Set delegation" }).click();
    await settle();
    expect(one<{ c: number }>("select count(*) c from approval_delegations where user_id=? and delegate_user_id=? and is_active=1", pm, delegate).c).toBe(1);
    // another invoice of the same project (below 500k -> seeded 2-level workflow, L1 = project manager)
    await as(1);
    const d = await recordInvoice(inv.project_id, 5000);
    delegatedInvoiceNo = d.invoice_no; delegatedInvoiceId = d.id;
    await certifyOnInvoicesPage(delegatedInvoiceNo);
    const r = latestRequest("sub_invoice", d.id);
    expect(r.status).toBe("pending");
    const t = tasks(r.id);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ assignee_user_id: delegate, delegated_from_user_id: pm });
    await as(delegate);
    await go("/approvals");
    await expect(inboxRow(delegatedInvoiceNo)).toContainText("delegated by");
  });

  test("a user who is not the assignee cannot decide (UI and server)", async () => {
    const r = latestRequest("sub_invoice", delegatedInvoiceId);
    const task = tasks(r.id)[0];
    await as(10); // Noura (viewer): can see invoices but has no task and is not a super administrator
    await go("/approvals");
    await expect(page.locator("tbody tr", { hasText: delegatedInvoiceNo })).toHaveCount(0);
    await go("/invoices");
    await page.locator("tr", { hasText: delegatedInvoiceNo }).first().getByRole("button", { name: /Invoice approval/ }).click();
    await expect(modal()).toContainText("Level 1");
    await expect(modal().getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // server-side rule enforced by the engine itself
    const { decide } = await import("../../src/lib/approvals/engine");
    expect(() => decide(task.id, "approve", null, 10)).toThrow(/Only the assigned approver/);
    expect(() => decide(task.id, "approve", null, pm)).toThrow(/Only the assigned approver/); // the delegator is not the assignee either
    expect(tasks(r.id)).toHaveLength(1);
    // a super administrator may approve on behalf (logged)
    await as(1);
    await go("/invoices");
    await page.locator("tr", { hasText: delegatedInvoiceNo }).first().getByRole("button", { name: /Invoice approval/ }).click();
    await expect(modal()).toContainText("on behalf");
    await modal().getByRole("button", { name: "Approve", exact: true }).click();
    await settle();
    expect(one<{ status: string; decided_by: number }>("select status, decided_by from approval_tasks where id=?", task.id)).toMatchObject({ status: "approved", decided_by: 1 });
    expect(one<{ c: number }>("select count(*) c from approval_events where request_id=? and event='approved_on_behalf'", r.id).c).toBe(1);
    expect(request(r.id).current_level).toBe(2);
  });

  test("designer pages and inbox render without console errors", async () => {
    problems.length = 0;
    for (const u of ["/approvals", "/approvals?tab=submitted", "/approvals?tab=completed", "/approvals?tab=delegations", "/admin/approval-workflows", `/admin/approval-workflows/${wfId}`]) await go(u);
    // clone + deactivate through the list
    await go("/admin/approval-workflows");
    await page.locator("tr", { hasText: wfName }).getByRole("button", { name: /Clone/ }).click();
    await page.waitForURL(/approval-workflows\/\d+$/);
    expect(one<{ c: number }>("select count(*) c from approval_workflows where name=?", `${wfName} (copy)`).c).toBe(1);
    await go("/admin/approval-workflows");
    await page.locator("tr", { hasText: wfName }).first().getByRole("button", { name: `Toggle ${wfName}` }).click();
    await settle();
    expect(one<{ is_active: number }>("select is_active from approval_workflows where id=?", wfId).is_active).toBe(0);
    const real = problems.filter((p) => !/tile\.openstreetmap|arcgisonline|Failed to load resource/i.test(p));
    expect(real, real.join("\n")).toEqual([]);
  });
});
