/**
 * Subcontractor portal e2e (PORTAL_SPEC section 5): credentials flow, company isolation, progress + invoice submission, lock-outs, read-only admin view.
 * Mutates data: run against the isolated DB described in README (seed first). Needs OPS_DB_PATH when the server uses a non-default database.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const db = () => new Database(process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db"), { readonly: true });
const q = <T,>(sql: string, ...p: unknown[]) => { const d = db(); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];

const DEMO_PW = "Portal@123";
const GULF = { slug: "gulf-trench", subId: 3, owner: "bilal.siddiqui@gulftrenchcabl-demo.ae", accounts: "neha.kapoor@gulftrenchcabl-demo.ae" };
const BLUE = { slug: "blue-horizon", subId: 7 };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function fresh(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}
async function adminLogin(page: Page) {
  await page.goto("/login");
  await page.locator("[name=email]").fill("admin@alnoor.demo");
  await page.locator("[name=password]").fill("Admin@12345");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function portalLogin(page: Page, slug: string, email: string, password: string) {
  await page.goto(`/p/${slug}/login`);
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: /Sign in/ }).click();
}
async function portalSignedIn(page: Page, slug: string, email: string) {
  await portalLogin(page, slug, email, DEMO_PW);
  await page.waitForURL(new RegExp(`/p/${slug}$`));
}

test.describe.serial("subcontractor portal", () => {
  let admin: Page;
  test.beforeAll(async ({ browser }) => { admin = await fresh(browser); await adminLogin(admin); });
  test.afterAll(async () => { await admin.context().close(); });

  test("admin creates a portal user, credentials are shown once, first sign-in forces a password change", async ({ browser }) => {
    await admin.goto(`/subcontractors/${BLUE.subId}?tab=portal`);
    await expect(admin.getByTestId("portal-url")).toContainText(`/p/${BLUE.slug}`);
    await admin.getByRole("button", { name: "Add portal user" }).click();
    const email = `qa.portal.${Date.now()}@bluehorizon-qa.test`;
    await admin.locator("[name=name]").fill("QA Portal User");
    await admin.locator("[name=email]").fill(email);
    await admin.locator("[name=portal_role]").selectOption("accounts");
    const temp = await admin.locator("input[name=password]").inputValue();
    expect(temp).toMatch(/^[A-Za-z2-9]{10}-\d\d$/);
    await admin.getByRole("button", { name: "Create user" }).click();
    const card = admin.getByTestId("credentials-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("cred-url")).toContainText(`/p/${BLUE.slug}`);
    await expect(card.getByTestId("cred-email")).toHaveText(email);
    await expect(card.getByTestId("cred-password")).toHaveText(temp);
    await expect(card.getByText("shown only once")).toBeVisible();
    await expect(card.getByRole("button", { name: "Copy all" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Email credentials" })).toBeDisabled();
    // the clear-text password is never stored
    const row = one<{ password_hash: string; must_change_password: number }>("select password_hash, must_change_password from portal_users where email = ?", email);
    expect(row.password_hash).not.toContain(temp);
    expect(row.must_change_password).toBe(1);
    await admin.keyboard.press("Escape");
    await expect(admin.getByTestId(`portal-user-${email}`)).toContainText("Must change password");

    const p = await fresh(browser);
    await portalLogin(p, BLUE.slug, email, temp);
    await expect(p).toHaveURL(new RegExp(`/p/${BLUE.slug}/change-password`));
    await p.goto(`/p/${BLUE.slug}/invoices`); // everything else is blocked until the password is changed
    await expect(p).toHaveURL(/change-password/);
    await p.locator("#current").fill(temp);
    await p.locator("#next").fill("QaPortal@456");
    await p.locator("#confirm").fill("QaPortal@456");
    await p.getByRole("button", { name: /Save password/ }).click();
    await p.waitForURL(new RegExp(`/p/${BLUE.slug}$`));
    await expect(p.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    await expect(p.getByTestId("portal-company")).toContainText("Blue Horizon");
    // accounts role: invoices yes, team no
    await p.goto(`/p/${BLUE.slug}/team`);
    await expect(p).toHaveURL(/forbidden/);
    expect(one<{ must_change_password: number }>("select must_change_password from portal_users where email = ?", email).must_change_password).toBe(0);
    await p.context().close();
    // audit trail on the internal tab
    await admin.goto(`/subcontractors/${BLUE.subId}?tab=portal`);
    await expect(admin.getByTestId("portal-events")).toContainText("Password changed");
  });

  test("company isolation: foreign records are 404, foreign slugs redirect, foreign files are refused", async ({ browser }) => {
    const foreign = one<{ id: number; assignment_id: number }>("select i.id, i.assignment_id from sub_invoices i join assignments a on a.id=i.assignment_id where a.subcontractor_id=? order by i.id limit 1", BLUE.subId);
    const foreignFile = one<{ id: number }>("select a.id from attachments a where a.entity_type='sub_invoice' and a.entity_id=? limit 1", foreign.id);
    const foreignDoc = one<{ attachment_id: number }>("select attachment_id from subcontractor_documents where subcontractor_id=? and attachment_id is not null limit 1", BLUE.subId);
    const ownInvoice = one<{ id: number }>("select i.id from sub_invoices i join assignments a on a.id=i.assignment_id where a.subcontractor_id=? order by i.id limit 1", GULF.subId);
    const ownFile = one<{ id: number }>("select a.id from attachments a where a.entity_type='sub_invoice' and a.entity_id=? limit 1", ownInvoice.id);
    const foreignIssue = one<{ id: number }>("select i.id from issues i join assignments a on a.id=i.assignment_id where a.subcontractor_id=? limit 1", BLUE.subId);
    expect(foreignFile && ownFile && foreignDoc && foreignIssue).toBeTruthy();

    const p = await fresh(browser);
    await portalSignedIn(p, GULF.slug, GULF.owner);
    // the URL slug of another company never grants anything: back to the own portal
    await p.goto(`/p/${BLUE.slug}/invoices`);
    await expect(p).toHaveURL(new RegExp(`/p/${GULF.slug}$`));
    await p.goto(`/p/${BLUE.slug}`, { waitUntil: "domcontentloaded" });
    await expect(p).toHaveURL(new RegExp(`/p/${GULF.slug}$`));
    // foreign ids under the own slug: 404
    for (const url of [`/p/${GULF.slug}/invoices/${foreign.id}`, `/p/${GULF.slug}/projects/${foreign.assignment_id}`, `/p/${GULF.slug}/issues/${foreignIssue.id}`, `/p/${GULF.slug}/progress/${one<{ id: number }>("select id from progress_reports where assignment_id=? limit 1", foreign.assignment_id).id}`]) {
      const r = await p.goto(url);
      expect(r?.status(), url).toBe(404);
    }
    expect((await p.request.get(`/p/${GULF.slug}/invoices/${foreign.id}/pdf`)).status()).toBe(404);
    expect((await p.request.get(`/p/${GULF.slug}/invoices/${ownInvoice.id}/pdf`)).status()).toBe(200);
    // files
    expect([401, 403, 404]).toContain((await p.request.get(`/api/files/${foreignFile.id}`)).status());
    expect((await p.request.get(`/api/files/${foreignFile.id}`)).status()).toBe(403);
    expect((await p.request.get(`/api/files/${foreignDoc.attachment_id}`)).status()).toBe(403);
    expect((await p.request.get(`/api/files/${ownFile.id}`)).status()).toBe(200);
    // an internal route is not reachable with a portal session
    expect((await p.goto("/subcontractors"))?.url()).toContain("/login");
    await p.context().close();
    // and an internal session does not open the portal
    const staff = await fresh(browser);
    await adminLogin(staff);
    await staff.goto(`/p/${GULF.slug}`);
    await expect(staff).toHaveURL(new RegExp(`/p/${GULF.slug}/login`));
    await staff.context().close();
  });

  test("progress update with a photo: visible internally with the Portal badge, rejected, then resubmitted", async ({ browser }) => {
    const a = one<{ id: number; project_id: number }>("select id, project_id from assignments where subcontractor_id=? and status='active' order by id limit 1", GULF.subId);
    const p = await fresh(browser);
    await portalSignedIn(p, GULF.slug, GULF.owner);
    await p.goto(`/p/${GULF.slug}/progress/new?assignment=${a.id}`);
    // guard against exceeding the contract quantity
    await p.locator("[name=quantity_done]").fill("99999");
    await p.getByRole("button", { name: "Submit progress update" }).click();
    await expect(p.getByRole("alert").first()).toContainText(/exceed/i);
    await p.locator("[name=quantity_done]").fill("0.05");
    await p.locator("[name=mp_trade]").first().fill("Labour");
    await p.locator("[name=mp_count]").first().fill("8");
    await p.locator("[name=mp_hours]").first().fill("72");
    await p.locator("[name=work_done]").fill("QA portal laid ducts");
    await p.getByTestId("photo-gallery").setInputFiles({ name: "site.png", mimeType: "image/png", buffer: PNG });
    await p.getByRole("button", { name: "Submit progress update" }).click();
    await p.waitForURL(/\/progress\?sent=submitted/);
    const r = one<{ id: number; status: string; source: string; submitted_by_name: string; portal_user_id: number }>("select id, status, source, submitted_by_name, portal_user_id from progress_reports where work_done='QA portal laid ducts'");
    expect(r).toMatchObject({ status: "submitted", source: "portal", submitted_by_name: "Bilal Siddiqui" });
    expect(one<{ n: number }>("select count(*) n from attachments where entity_type='progress' and entity_id=?", r.id).n).toBe(1);

    // internal: badge + reject with a reason
    await admin.goto(`/projects/${a.project_id}?tab=progress`);
    const row = admin.locator("tr", { hasText: "QA portal laid ducts" });
    await expect(row).toContainText("Portal");
    await row.getByLabel("Rejection reason").fill("Please re-measure the section");
    await row.getByRole("button", { name: "Reject" }).click();
    await expect.poll(() => one<{ status: string }>("select status from progress_reports where id=?", r.id).status).toBe("rejected");
    expect(one<{ reject_reason: string }>("select reject_reason from progress_reports where id=?", r.id).reject_reason).toBe("Please re-measure the section");

    // portal: the rejection is an action item; correct and resubmit
    await p.goto(`/p/${GULF.slug}`, { waitUntil: "domcontentloaded" });
    await expect(p.getByTestId("action-items").locator('[data-action-type="report_rejected"]').first()).toContainText("Resubmit progress report");
    await p.goto(`/p/${GULF.slug}/progress/${r.id}`);
    await expect(p.getByTestId("reject-banner")).toContainText("Please re-measure the section");
    await p.locator("[name=work_done]").fill("QA portal laid ducts (corrected)");
    await p.getByRole("button", { name: "Resubmit report" }).click();
    await p.waitForURL(/\/progress\?sent=resubmitted/);
    expect(one<{ status: string; reject_reason: string | null; work_done: string }>("select status, reject_reason, work_done from progress_reports where id=?", r.id)).toEqual({ status: "submitted", reject_reason: null, work_done: "QA portal laid ducts (corrected)" });
    await p.context().close();
  });

  test("invoice with lines and a tax invoice attachment is visible internally", async ({ browser }) => {
    const a = one<{ id: number; code: string }>("select id, code from assignments where subcontractor_id=? and status='active' order by id limit 1", GULF.subId);
    const p = await fresh(browser);
    await portalSignedIn(p, GULF.slug, GULF.accounts);
    await p.goto(`/p/${GULF.slug}/invoices/new?assignment=${a.id}`);
    await p.getByRole("button", { name: "Submit invoice" }).click();
    expect(await p.locator("[name=sub_invoice_ref]").evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true); // required
    await p.locator("[name=sub_invoice_ref]").fill("QA-PORTAL-INV-1");
    await p.locator("[name=line_this_qty]").first().fill("0.02");
    await p.locator("[name=att_file]").first().setInputFiles({ name: "qa-tax-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 qa tax invoice") });
    await p.getByRole("button", { name: "Submit invoice" }).click();
    await p.waitForURL(/\/invoices\/\d+\?sent=1/);
    await expect(p.getByTestId("invoice-timeline")).toHaveAttribute("data-status", "submitted");
    await expect(p.getByTestId("invoice-paper")).toBeVisible();
    const inv = one<{ id: number; invoice_no: string; status: string; source: string; submitted_by_name: string }>("select id, invoice_no, status, source, submitted_by_name from sub_invoices where sub_invoice_ref='QA-PORTAL-INV-1'");
    expect(inv).toMatchObject({ status: "submitted", source: "portal", submitted_by_name: "Neha Kapoor" });
    expect(one<{ n: number }>("select count(*) n from sub_invoice_lines where invoice_id=?", inv.id).n).toBeGreaterThan(0);
    expect(one<{ n: number }>("select count(*) n from attachments where entity_type='sub_invoice' and entity_id=? and category='tax_invoice'", inv.id).n).toBe(1);
    // the PDF download of the portal invoice
    const pdf = await p.request.get(`/p/${GULF.slug}/invoices/${inv.id}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    // viewer role cannot submit
    await p.context().close();
    await admin.goto("/invoices");
    await expect(admin.getByText(inv.invoice_no).first()).toBeVisible();
    await admin.goto(`/invoices/${inv.id}`);
    await expect(admin.getByText("Portal").first()).toBeVisible();
  });

  test("issue thread: portal raises an issue, internal replies, portal sees the response request", async ({ browser }) => {
    const a = one<{ id: number; project_id: number }>("select id, project_id from assignments where subcontractor_id=? and status='active' order by id limit 1", GULF.subId);
    const p = await fresh(browser);
    await portalSignedIn(p, GULF.slug, GULF.owner);
    await p.goto(`/p/${GULF.slug}/issues/new?assignment=${a.id}`);
    await p.locator("[name=title]").fill("QA gate access issue");
    await p.locator("textarea[name=description]").fill("The gate was locked");
    await p.getByRole("button", { name: "Send to project team" }).click();
    await p.waitForURL(/\/issues\/\d+$/);
    const issue = one<{ id: number; source: string; awaiting_party: string }>("select id, source, awaiting_party from issues where title='QA gate access issue'");
    expect(issue).toMatchObject({ source: "portal", awaiting_party: "internal" });
    await p.locator("[name=body]").fill("Any update?");
    await p.getByRole("button", { name: "Post comment" }).click();
    await expect(p.getByTestId("thread")).toContainText("Any update?");
    // internal reply
    await admin.goto(`/projects/${a.project_id}?tab=delays`);
    const row = admin.locator("tr", { hasText: "QA gate access issue" });
    await expect(row).toContainText("Awaiting reply");
    await row.getByRole("button", { name: /Thread/ }).click();
    await admin.getByLabel("Reply").fill("Please send photos of the gate");
    await admin.getByRole("button", { name: "Post reply" }).click();
    await expect.poll(() => one<{ n: number }>("select count(*) n from issue_comments where issue_id=? and author_type='internal'", issue.id).n).toBe(1);
    expect(one<{ awaiting_party: string }>("select awaiting_party from issues where id=?", issue.id).awaiting_party).toBe("portal");
    await p.goto(`/p/${GULF.slug}`, { waitUntil: "domcontentloaded" });
    await expect(p.getByTestId("action-items").locator('[data-action-type="issue_response"]').first()).toBeVisible();
    await p.goto(`/p/${GULF.slug}/issues/${issue.id}`);
    await expect(p.getByTestId("thread")).toContainText("Please send photos of the gate");
    await p.context().close();
  });

  test("disabled portal, disabled user and lock-out after 5 failures", async ({ browser }) => {
    // disabled portal (Sahara Civil)
    await admin.goto("/subcontractors/6?tab=portal");
    await admin.getByTestId("portal-toggle").click();
    await expect(admin.getByTestId("portal-toggle")).toHaveText("Enable portal");
    const p = await fresh(browser);
    await portalLogin(p, "sahara-civil", "vikram.nair@saharacivilsho-demo.ae", DEMO_PW);
    await expect(p.getByRole("alert").first()).toContainText(/disabled/i);
    await expect(p).toHaveURL(/login/);
    await admin.getByTestId("portal-toggle").click();
    await expect(admin.getByTestId("portal-toggle")).toHaveText("Disable portal");
    await portalLogin(p, "sahara-civil", "vikram.nair@saharacivilsho-demo.ae", DEMO_PW);
    await p.waitForURL(/\/p\/sahara-civil$/);
    // disabled user
    const d = await fresh(browser);
    await portalLogin(d, "sahara-civil", "faisal.anwar@saharacivilsho-demo.ae", DEMO_PW);
    await expect(d.getByRole("alert").first()).toContainText(/disabled/i);
    await expect(d).toHaveURL(/login/);
    // lock-out (Blue Horizon viewer): 5 wrong passwords, the correct one is then refused, admin unlocks
    const l = await fresh(browser);
    const lockEmail = "basel.iqbal@bluehorizonsur-demo.ae";
    for (let i = 0; i < 5; i++) { await portalLogin(l, BLUE.slug, lockEmail, "wrong-Password1"); await expect(l.getByRole("alert").first()).toBeVisible(); }
    await expect(l.getByRole("alert").first()).toContainText(/locked/i);
    await portalLogin(l, BLUE.slug, lockEmail, DEMO_PW);
    await expect(l.getByRole("alert").first()).toContainText(/locked/i);
    await expect(l).toHaveURL(/login/);
    await admin.goto(`/subcontractors/${BLUE.subId}?tab=portal`);
    const row = admin.getByTestId(`portal-user-${lockEmail}`);
    await expect(row).toContainText("Locked");
    await row.getByRole("button", { name: "Unlock" }).click();
    await expect(admin.getByTestId(`portal-user-${lockEmail}`)).not.toContainText("Locked");
    await portalLogin(l, BLUE.slug, lockEmail, DEMO_PW);
    await l.waitForURL(new RegExp(`/p/${BLUE.slug}$`));
    // sign out all sessions from the internal tab ends that session
    await admin.getByTestId(`portal-user-${lockEmail}`).getByRole("button", { name: "Sign out all" }).click();
    await expect.poll(() => one<{ n: number }>("select count(*) n from portal_auth_events where event='session_revoked' and subcontractor_id=?", BLUE.subId).n).toBeGreaterThan(0);
    await l.goto(`/p/${BLUE.slug}/projects`);
    await expect(l).toHaveURL(/login/);
    for (const ctx of [p, d, l]) await ctx.context().close();
  });

  test("admin view is read-only and audited", async ({ browser }) => {
    void browser;
    await admin.goto(`/subcontractors/${GULF.subId}?tab=portal`);
    const [popup] = await Promise.all([admin.context().waitForEvent("page"), admin.getByTestId("view-as-sub").click()]);
    await popup.waitForURL(new RegExp(`/p/${GULF.slug}$`));
    const banner = popup.getByTestId("admin-view-banner");
    await expect(banner).toContainText("Viewing as Gulf Trench & Cable Works");
    await expect(banner).toContainText("read only");
    await expect(popup.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    // actions are refused
    await popup.goto(`/p/${GULF.slug}/issues/new`);
    await popup.locator("[name=title]").fill("QA read-only attempt");
    await popup.getByRole("button", { name: "Send to project team" }).click();
    await expect(popup.getByRole("alert").first()).toContainText(/read-only/i);
    expect(one<{ n: number }>("select count(*) n from issues where title='QA read-only attempt'").n).toBe(0);
    await popup.goto(`/p/${GULF.slug}/progress/new`);
    await popup.locator("[name=quantity_done]").fill("0.01");
    await popup.getByRole("button", { name: "Submit progress update" }).click();
    await expect(popup.getByRole("alert").first()).toContainText(/read-only/i);
    await popup.goto(`/p/${GULF.slug}/account`);
    await expect(popup.getByRole("button", { name: "Change password" })).toBeDisabled();
    expect(one<{ n: number }>("select count(*) n from portal_auth_events where event='impersonation_started' and subcontractor_id=?", GULF.subId).n).toBeGreaterThan(0);
    // a non-admin staff user cannot start it
    await popup.getByRole("button", { name: "Exit" }).click();
    await popup.waitForURL(new RegExp(`/subcontractors/${GULF.subId}\\?tab=portal`));
    await popup.close();
    expect(one<{ n: number }>("select count(*) n from portal_auth_events where event='impersonation_ended' and subcontractor_id=?", GULF.subId).n).toBeGreaterThan(0);
  });

  test("documents and change requests: upload goes to review, bank change is approved internally", async ({ browser }) => {
    const p = await fresh(browser);
    await portalSignedIn(p, GULF.slug, GULF.accounts);
    await p.goto(`/p/${GULF.slug}/documents`);
    await p.getByRole("button", { name: "Upload document" }).click();
    await p.locator("[name=doc_type]").selectOption("insurance");
    await p.locator("[name=expiry_date]").fill("2027-12-31");
    await p.locator("input[name=file]").setInputFiles({ name: "qa-insurance.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 qa insurance") });
    await p.getByRole("button", { name: "Upload for review" }).click();
    await expect(p.getByText("will be reviewed")).toBeVisible();
    await p.keyboard.press("Escape");
    expect(one<{ status: string; source: string }>("select status, source from subcontractor_documents where subcontractor_id=? and ref_no is null order by id desc limit 1", GULF.subId)).toEqual({ status: "pending_review", source: "portal" });
    await p.getByRole("button", { name: "Bank details" }).click();
    await p.locator("[name=bank_name]").fill("QA Test Bank");
    await p.locator("[name=iban]").fill("AE070331234567890123456");
    await p.getByRole("button", { name: "Send change request" }).click();
    await expect(p.getByText("sent for approval")).toBeVisible();
    await p.keyboard.press("Escape");
    await admin.goto(`/subcontractors/${GULF.subId}?tab=portal`);
    const req = admin.locator('[data-testid^="change-request-"]', { hasText: "QA Test Bank" });
    await req.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => one<{ bank_name: string }>("select bank_name from subcontractors where id=?", GULF.subId).bank_name).toBe("QA Test Bank");
    await p.context().close();
  });
});
