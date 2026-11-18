/**
 * Supplier registration e2e (SUPPLIER_TENDERING_SPEC Part A, C2): a supplier registers on the public page, completes the wizard, uploads the documents and submits;
 * an internal reviewer queries one document and refers back; the outbox has the e-mail and the portal shows the banner + checklist; the supplier re-uploads and resubmits;
 * the reviewer approves (through the approval workflow) and the portal is unrestricted. Also: honeypot, restricted portal on the server, file isolation, global sign-in + reset.
 * Mutates data: run against the isolated DB described in README (seed first).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const db = () => new Database(process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db"), { readonly: true });
const q = <T,>(sql: string, ...p: unknown[]) => { const d = db(); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];

const STAMP = Date.now();
const COMPANY = `E2E Fibre Works ${STAMP} LLC`;
const EMAIL = `qa.supplier.${STAMP}@e2efibre-qa.test`;
const PASSWORD = "Supplier@123";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const MANDATORY = ["trade_licence", "vat_certificate", "bank_letter", "owner_id", "insurance_wc", "insurance_tpl", "company_profile", "hse_policy"];
const NEEDS_EXPIRY = ["trade_licence", "owner_id", "insurance_wc", "insurance_tpl"];

async function fresh(browser: Browser, width = 1440): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width, height: 900 } });
  return ctx.newPage();
}
async function internalLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe.serial("supplier registration and prequalification", () => {
  let sup: Page, reviewer: Page, admin: Page;
  let slug = "", subId = 0, regNo = "";
  const problems: string[] = [];

  test.beforeAll(async ({ browser }) => {
    sup = await fresh(browser);
    reviewer = await fresh(browser);
    admin = await fresh(browser);
    sup.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) problems.push(`[${m.type()}] ${sup.url()} :: ${m.text().slice(0, 200)}`); });
    await internalLogin(reviewer, "rashid.al.mazrouei@alnoor.demo", "Password@123");
    await internalLogin(admin, "admin@alnoor.demo", "Admin@12345");
  });
  test.afterAll(async () => { for (const p of [sup, reviewer, admin]) await p.context().close(); });

  test("public landing and the honeypot refuses bots", async ({ browser }) => {
    const p = await fresh(browser);
    await p.goto("/suppliers");
    await expect(p.getByRole("heading", { name: /Become an Al Noor supplier/ })).toBeVisible();
    await expect(p.getByTestId("country-picker")).toContainText("Oman");
    await expect(p.getByTestId("notice-board")).toBeVisible();
    await expect(p.getByRole("link", { name: /Register your company/ }).first()).toBeVisible();
    // honeypot: a bot fills the invisible field -> refused, nothing created
    const before = one<{ c: number }>("select count(*) c from subcontractors").c;
    await p.goto("/suppliers/register?country=AE");
    await p.waitForLoadState("networkidle");
    await p.locator("[name=company]").fill(`Bot Company ${STAMP} LLC`);
    await p.locator("[name=contact_name]").fill("Bot Master");
    await p.locator("[name=phone]").fill("+971500000000");
    await p.locator("[name=email]").fill(`bot.${STAMP}@bot-qa.test`);
    await p.locator("[name=password]").fill("Botpass@123");
    await p.locator("[name=confirm]").fill("Botpass@123");
    await p.locator("[name=terms]").check();
    await p.locator("[name=company_website]").evaluate((el: HTMLInputElement) => { el.value = "http://spam.example"; });
    await p.getByRole("button", { name: /Create account/ }).click();
    await expect(p.getByRole("alert").first()).toContainText(/could not process/i);
    expect(one<{ c: number }>("select count(*) c from subcontractors").c).toBe(before);
    await p.context().close();
  });

  test("step 1: register on /suppliers/register (friendly errors, then the wizard opens signed in)", async () => {
    await sup.goto("/suppliers/register?country=AE");
    await sup.waitForLoadState("networkidle");
    await expect(sup.getByTestId("wizard-progress")).toContainText("Step 1 of 8");
    await expect(sup.getByTestId("reg-country-AE")).toBeChecked();
    // an existing portal user's e-mail of the same country is refused with a friendly message
    const taken = one<{ email: string }>("select pu.email from portal_users pu join subcontractors s on s.id = pu.subcontractor_id where s.entity_id = 1 limit 1").email;
    await sup.locator("[name=company]").fill(COMPANY);
    await sup.locator("[name=contact_name]").fill("Khalid Qa Tester");
    await sup.locator("[name=phone]").fill("+971 50 123 4567");
    await sup.locator("[name=email]").fill(taken);
    await sup.locator("[name=password]").fill(PASSWORD);
    await sup.locator("[name=confirm]").fill(PASSWORD);
    await sup.locator("[name=terms]").check();
    await sup.getByRole("button", { name: /Create account/ }).click();
    await expect(sup.getByRole("alert").filter({ hasText: /already registered/i }).first()).toBeVisible();
    // weak password
    await sup.locator("[name=email]").fill(EMAIL);
    await sup.locator("[name=password]").fill("short");
    await sup.locator("[name=confirm]").fill("short");
    await sup.getByRole("button", { name: /Create account/ }).click();
    await expect(sup.getByText(/at least 8 characters/i).first()).toBeVisible();
    await sup.locator("[name=password]").fill(PASSWORD);
    await sup.locator("[name=confirm]").fill(PASSWORD);
    await sup.getByRole("button", { name: /Create account/ }).click();
    await sup.waitForURL(/\/p\/[^/]+\/registration\?step=2/);
    slug = new URL(sup.url()).pathname.split("/")[2];
    const row = one<{ id: number; registration_status: string; status: string; entity_id: number; portal_enabled: number }>("select id, registration_status, status, entity_id, portal_enabled from subcontractors where portal_slug = ?", slug);
    subId = row.id;
    expect(row).toMatchObject({ registration_status: "draft", status: "prospect", entity_id: 1, portal_enabled: 1 });
    expect(one<{ portal_role: string }>("select portal_role from portal_users where subcontractor_id = ?", subId).portal_role).toBe("owner");
    await expect(sup.getByTestId("reg-banner")).toHaveAttribute("data-status", "draft");
  });

  test("restricted portal: every page except dashboard / registration / documents / account is refused on the server (draft)", async () => {
    for (const area of ["projects", "invoices", "progress", "payments", "issues", "certificates", "team"]) {
      await sup.goto(`/p/${slug}/${area}`);
      await expect(sup, area).toHaveURL(/forbidden\?restricted=1/);
      await expect(sup.getByTestId("forbidden-reason")).toContainText(/once your supplier registration has been approved/i);
    }
    for (const ok of ["", "/registration", "/documents", "/account"]) {
      const r = await sup.goto(`/p/${slug}${ok}`);
      expect(r?.status(), ok).toBe(200);
      await expect(sup).not.toHaveURL(/forbidden/);
    }
    // the supplier nav only offers the allowed pages
    const nav = await sup.getByRole("navigation", { name: "Portal" }).first().innerText();
    expect(nav).toMatch(/Registration/);
    expect(nav).not.toMatch(/Invoices|Projects|Payments/);
  });

  test("steps 2-6: company, categories & regions, contacts & bank, HSE, experience (each step saves a draft)", async () => {
    await sup.goto(`/p/${slug}/registration?step=2`);
    await sup.waitForLoadState("networkidle");
    await sup.waitForTimeout(400);
    await sup.locator("[name=legal_form]").selectOption("LLC");
    await sup.locator("[name=year_established]").fill("2014");
    await sup.locator("[name=cr_no]").fill(`CN-${STAMP}`);
    await sup.locator("[name=cr_expiry]").fill("2027-09-30");
    await sup.locator("[name=vat_no]").fill("100299988800003");
    await sup.locator("[name=employees]").fill("64");
    await sup.locator("[name=turnover_band]").selectOption("5 - 25 million");
    await sup.locator("[name=phone]").fill("+971 4 555 0101");
    await sup.locator("[name=address]").fill("Warehouse 12, Al Quoz Industrial 3, Dubai");
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await sup.waitForURL(/step=3/);
    expect(one<{ legal_form: string; cr_no: string }>("select legal_form, cr_no from subcontractors where id = ?", subId)).toMatchObject({ legal_form: "LLC" });

    // step 3: validation first (nothing chosen), then the real choice
    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await expect(sup.getByTestId("reg-error")).toContainText(/at least one category/i);
    await sup.getByLabel("Fibre / copper cable laying").check();
    await sup.getByLabel("Fibre splicing & testing").check();
    await sup.getByLabel("Ducting & manholes").check();
    await sup.getByLabel("Dubai", { exact: true }).check();
    await sup.getByLabel("Sharjah", { exact: true }).check();
    await sup.locator("[name=capacity_note]").fill("Three crews, 8 km per month");
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await sup.waitForURL(/step=4/);
    expect(one<{ c: number }>("select count(*) c from subcontractor_categories where subcontractor_id = ? and status = 'requested'", subId).c).toBe(3);

    // step 4: an IBAN with the wrong length is refused
    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    for (const [role, name] of [["signatory", "Khalid Qa Tester"], ["finance", "Sana Finance"]]) {
      await sup.locator(`[name=${role}_name]`).fill(name);
      await sup.locator(`[name=${role}_title]`).fill(role === "signatory" ? "Managing Director" : "Finance Manager");
      await sup.locator(`[name=${role}_email]`).fill(`${role}@e2efibre-qa.test`);
      await sup.locator(`[name=${role}_phone]`).fill("+971 50 123 4567");
    }
    await sup.locator("[name=bank_name]").fill("Emirates NBD");
    await sup.locator("[name=account_name]").fill(COMPANY);
    await sup.locator("[name=swift]").fill("EBILAEAD");
    await sup.locator("[name=iban]").fill("AE07 0331 2345 6789 0123");
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await expect(sup.getByTestId("reg-error")).toContainText(/23 characters/i);
    await sup.locator("[name=iban]").fill("AE07 0331 2345 6789 0123 456");
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await sup.waitForURL(/step=5/);
    expect(one<{ iban: string }>("select iban from subcontractors where id = ?", subId).iban).toBe("AE070331234567890123456");

    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    await sup.locator("[name=hse_has_policy]").selectOption("yes");
    await sup.locator("[name=hse_lti_rate]").fill("0.4");
    await sup.locator("[name=iso_9001]").check();
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await sup.waitForURL(/step=6/);

    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    await sup.locator("[name=client_0]").fill("Dubai Municipality");
    await sup.locator("[name=project_0]").fill("Fibre backbone Al Quoz");
    await sup.locator("[name=year_0]").fill("2024");
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await expect(sup.getByTestId("reg-error")).toContainText(/at least 2 reference/i);
    await sup.locator("[name=client_1]").fill("Roads & Transport Authority");
    await sup.locator("[name=project_1]").fill("Duct bank Sheikh Zayed Road");
    await sup.locator("[name=year_1]").fill("2025");
    await sup.getByRole("button", { name: "Save and continue" }).click();
    await sup.waitForURL(/step=7/);
    expect(one<{ c: number }>("select count(*) c from subcontractor_experience where subcontractor_id = ?", subId).c).toBe(2);
  });

  test("step 7: documents (mandatory list of the country), step 8: submit is disabled until everything is present", async () => {
    await sup.goto(`/p/${slug}/registration?step=7`);
    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    for (const code of MANDATORY) await expect(sup.getByTestId(`doc-${code}`)).toBeVisible();
    await expect(sup.getByTestId("doc-pdo_registration")).toHaveCount(0); // Oman only
    // submit is disabled on the review step while documents are missing
    await sup.goto(`/p/${slug}/registration?step=8`);
    await sup.waitForLoadState("networkidle");
    await expect(sup.getByTestId("reg-submit")).toBeDisabled();
    await expect(sup.getByTestId("missing-list")).toContainText("Trade licence");
    await expect(sup.getByTestId("completeness-pct")).not.toHaveText("100%");
    await sup.goto(`/p/${slug}/registration?step=7`);
    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    // an expiry date is required where the type has one
    await sup.setInputFiles('[data-testid="doc-file-trade_licence"]', { name: "licence.pdf", mimeType: "application/pdf", buffer: PDF });
    await sup.getByTestId("doc-save-trade_licence").click();
    await expect(sup.getByTestId("doc-trade_licence").getByRole("alert")).toContainText(/expiry date/i);
    for (const code of MANDATORY) {
      await sup.setInputFiles(`[data-testid="doc-file-${code}"]`, { name: `${code}.pdf`, mimeType: "application/pdf", buffer: PDF });
      if (NEEDS_EXPIRY.includes(code)) await sup.locator(`[data-testid="doc-expiry-${code}"]`).fill("2027-12-31");
      await sup.getByTestId(`doc-save-${code}`).click();
      await expect(sup.getByTestId(`doc-form-${code}`).getByText("Saved.")).toBeVisible();
    }
    expect(one<{ c: number }>("select count(*) c from subcontractor_documents where subcontractor_id = ? and doc_type_code is not null and is_current = 1", subId).c).toBe(MANDATORY.length);
    // files are stored under the supplier
    const att = one<{ id: number; entity_type: string; entity_id: number }>("select a.id, a.entity_type, a.entity_id from attachments a join subcontractor_documents d on d.attachment_id = a.id where d.subcontractor_id = ? limit 1", subId);
    expect(att).toMatchObject({ entity_type: "subcontractor", entity_id: subId });
  });

  test("files API: a supplier only gets its own registration documents (other suppliers 403, anonymous 401)", async ({ browser }) => {
    const own = one<{ id: number }>("select attachment_id id from subcontractor_documents where subcontractor_id = ? and attachment_id is not null limit 1", subId).id;
    const foreign = one<{ id: number }>("select attachment_id id from subcontractor_documents where subcontractor_id = 3 and attachment_id is not null limit 1").id;
    const foreignReg = one<{ id: number }>("select d.attachment_id id from subcontractor_documents d where d.doc_type_code is not null and d.subcontractor_id <> ? and d.attachment_id is not null limit 1", subId).id;
    expect((await sup.request.get(`/api/files/${own}`)).status()).toBe(200);
    expect((await sup.request.get(`/api/files/${foreign}`)).status()).toBe(403);
    expect((await sup.request.get(`/api/files/${foreignReg}`)).status()).toBe(403);
    // a project file is not served to a restricted supplier either
    const projectFile = one<{ id: number }>("select id from attachments where entity_type = 'project' limit 1").id;
    expect((await sup.request.get(`/api/files/${projectFile}`)).status()).toBe(403);
    const anon = await fresh(browser);
    expect((await anon.request.get(`/api/files/${own}`)).status()).toBe(401);
    await anon.context().close();
  });

  test("step 8: declare and submit; reg number, received e-mail, portal notification and the internal topbar badge", async () => {
    await sup.goto(`/p/${slug}/registration?step=8`);
    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    await expect(sup.getByTestId("completeness-pct")).toHaveText("100%");
    await expect(sup.getByTestId("reg-submit")).toBeEnabled();
    await sup.getByRole("button", { name: "Submit registration" }).click();
    await expect(sup.getByTestId("reg-error")).toContainText(/three declarations/i);
    for (const t of ["decl-accuracy", "decl-coi", "decl-conduct"]) await sup.getByTestId(t).check();
    await sup.getByRole("button", { name: "Submit registration" }).click();
    await expect(sup.getByTestId("reg-banner")).toHaveAttribute("data-status", "submitted");
    const s = one<{ registration_status: string; registration_no: string; submitted_at: string; declaration_accepted_at: string }>("select registration_status, registration_no, submitted_at, declaration_accepted_at from subcontractors where id = ?", subId);
    expect(s.registration_status).toBe("submitted");
    expect(s.registration_no).toMatch(/^REG-\d{4}-\d{4}$/);
    regNo = s.registration_no;
    await expect(sup.getByTestId("reg-banner")).toContainText(regNo);
    const mail = one<{ to_email: string; status: string; subject: string }>("select to_email, status, subject from email_outbox where related_type='subcontractor' and related_id = ? and template = 'registration_received'", subId);
    expect(mail.to_email).toBe(EMAIL);
    expect(mail.status).toBe("logged"); // demo mode: nothing leaves the machine
    expect(mail.subject).toContain(regNo);
    expect(one<{ c: number }>("select count(*) c from portal_notifications where subcontractor_id = ? and kind = 'registration_received'", subId).c).toBe(1);
    expect(one<{ c: number }>("select count(*) c from activity_log where entity_type='subcontractor' and entity_id = ? and message like ?", subId, `%${regNo}%submitted%`).c).toBe(1);
    // submitted: the wizard is read-only
    await sup.goto(`/p/${slug}/registration?step=3`);
    await expect(sup.getByTestId("step-categories")).toHaveCount(0);
    await expect(sup.getByTestId("summary-company")).toBeVisible();
    // the reviewer's topbar shows the waiting registration, the queue lists it
    await reviewer.goto("/subcontractors/registrations");
    await expect(reviewer.getByTestId("reg-bell")).toBeVisible();
    await expect(reviewer.getByTestId("reg-queue-badge")).toBeVisible();
    await expect(reviewer.getByTestId(`reg-row-${subId}`)).toContainText(COMPANY);
    await expect(reviewer.getByTestId(`reg-row-${subId}`)).toContainText("100%");
  });

  test("reviewer starts the review, queries one document and refers back", async () => {
    await reviewer.goto(`/subcontractors/${subId}/registration`);
    await reviewer.waitForLoadState("networkidle"); await reviewer.waitForTimeout(300);
    await expect(reviewer.getByTestId("decision-card")).toContainText("waiting for a reviewer");
    await reviewer.getByTestId("start-review").click();
    await expect(reviewer.getByTestId("refer-back")).toBeVisible();
    expect(one<{ registration_status: string; reviewed_by: number | null }>("select registration_status, reviewed_by from subcontractors where id = ?", subId)).toMatchObject({ registration_status: "under_review" });
    expect(one<{ reviewed_by: number }>("select reviewed_by from subcontractors where id = ?", subId).reviewed_by).toBeTruthy();
    // refer back needs a query or a note
    await reviewer.getByTestId("refer-back").click();
    await expect(reviewer.getByRole("alert").first()).toContainText(/Query at least one item/i);
    // accept a section, query a document with a comment
    await reviewer.getByTestId("accept-company").click();
    await reviewer.waitForTimeout(600);
    await reviewer.getByTestId("comment-bank_letter").fill("The IBAN on the bank letter does not match your registration.");
    await reviewer.getByTestId("query-btn-bank_letter").click();
    await expect(reviewer.getByTestId("queried-items")).toContainText("Bank letter with IBAN");
    await reviewer.getByTestId("refer-note").fill("Please upload a corrected bank letter.");
    await reviewer.getByTestId("refer-back").click();
    await reviewer.waitForTimeout(800);
    const s = one<{ registration_status: string; review_note: string }>("select registration_status, review_note from subcontractors where id = ?", subId);
    expect(s).toMatchObject({ registration_status: "referred_back", review_note: "Please upload a corrected bank letter." });
    const r = one<{ decision: string; items_json: string }>("select decision, items_json from registration_reviews where subcontractor_id = ? order by id desc limit 1", subId);
    expect(r.decision).toBe("refer_back");
    expect(JSON.parse(r.items_json)).toEqual([expect.objectContaining({ kind: "document", ref: "bank_letter", label: "Bank letter with IBAN" })]);
  });

  test("outbox: the referred-back e-mail exists and renders; the supplier sees the banner, checklist and notification", async () => {
    await admin.goto("/admin/email-outbox?template=registration_referred_back");
    const row = admin.getByTestId("outbox-row").filter({ hasText: EMAIL });
    await expect(row).toHaveCount(1);
    await row.getByRole("link").first().click();
    await expect(admin.getByTestId("outbox-preview")).toContainText("Action required");
    const frame = admin.frameLocator('[data-testid="outbox-frame"]');
    await expect(frame.getByText("Bank letter with IBAN")).toBeVisible();
    await expect(frame.getByRole("link", { name: "Open supplier portal" })).toBeVisible();
    await expect(frame.getByText("Al Noor Infrastructure LLC").first()).toBeVisible();
    // supplier side
    await sup.goto(`/p/${slug}`);
    const banner = sup.getByTestId("reg-banner");
    await expect(banner).toHaveAttribute("data-status", "referred_back");
    await expect(banner).toContainText("Action required");
    await expect(sup.getByTestId("banner-note")).toContainText("corrected bank letter");
    await expect(sup.getByTestId("query-checklist")).toContainText("Bank letter with IBAN");
    await expect(sup.getByTestId("query-checklist")).toContainText("does not match your registration");
    await expect(sup.getByTestId("portal-bell-count")).toBeVisible();
    await sup.getByTestId("portal-bell").click();
    await expect(sup.getByTestId("portal-notice").filter({ hasText: /Action required/ })).toBeVisible();
    // the checklist item links to the document and the reviewer's comment shows inline
    await sup.getByTestId("query-checklist").getByRole("link", { name: "Bank letter with IBAN" }).click();
    await expect(sup).toHaveURL(/step=7/);
    await expect(sup.getByTestId("doc-query-bank_letter")).toContainText("does not match");
    // a notification click marks it read and lands on the registration
    await sup.getByTestId("portal-bell").click();
    await sup.getByTestId("portal-notice").filter({ hasText: /Action required/ }).first().click();
    await expect.poll(() => one<{ c: number }>("select count(*) c from portal_notifications where subcontractor_id = ? and kind = 'registration_referred_back' and read_at is not null", subId).c).toBe(1);
  });

  test("resubmit is only possible once the queried item was changed (new upload version keeps the old one)", async () => {
    await sup.goto(`/p/${slug}/registration?step=8`);
    await sup.waitForLoadState("networkidle");
    await expect(sup.getByTestId("reg-submit")).toBeDisabled();
    await expect(sup.getByTestId("unfixed-note")).toContainText("Bank letter with IBAN");
    await sup.goto(`/p/${slug}/registration?step=7`);
    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    await sup.setInputFiles('[data-testid="doc-file-bank_letter"]', { name: "bank-letter-v2.pdf", mimeType: "application/pdf", buffer: PDF });
    await sup.getByTestId("doc-save-bank_letter").click();
    await expect(sup.getByTestId("doc-form-bank_letter").getByText("Saved.")).toBeVisible();
    const versions = q<{ version: number; is_current: number }>("select version, is_current from subcontractor_documents where subcontractor_id = ? and doc_type_code = 'bank_letter' order by version", subId);
    expect(versions).toEqual([{ version: 1, is_current: 0 }, { version: 2, is_current: 1 }]);
    await sup.goto(`/p/${slug}/registration?step=8`);
    await sup.waitForLoadState("networkidle"); await sup.waitForTimeout(300);
    await expect(sup.getByTestId("reg-submit")).toBeEnabled();
    await expect(sup.getByTestId("query-checklist")).toBeVisible();
    await expect(sup.getByTestId("item-fixed")).toBeVisible(); // the tick next to the fixed item
    for (const t of ["decl-accuracy", "decl-coi", "decl-conduct"]) await sup.getByTestId(t).check();
    await sup.getByRole("button", { name: "Resubmit registration" }).click();
    await expect(sup.getByTestId("reg-banner")).toHaveAttribute("data-status", "submitted");
    const s = one<{ registration_status: string; resubmit_count: number }>("select registration_status, resubmit_count from subcontractors where id = ?", subId);
    expect(s).toMatchObject({ registration_status: "submitted", resubmit_count: 1 });
    // the review history is kept: refer_back + resubmit
    expect(q<{ decision: string }>("select decision from registration_reviews where subcontractor_id = ? order by id", subId).map((r) => r.decision)).toEqual(["refer_back", "resubmit"]);
  });

  test("reviewer sees round 2 and the fixed item, then approves; with a workflow the registration waits for the approvers", async ({ browser }) => {
    await reviewer.goto(`/subcontractors/${subId}/registration`);
    await reviewer.waitForLoadState("networkidle"); await reviewer.waitForTimeout(300);
    await expect(reviewer.getByTestId("review-meta")).toContainText("Round");
    await expect(reviewer.getByTestId("review-meta")).toContainText("2");
    await reviewer.getByTestId("start-review").click();
    await expect(reviewer.getByTestId("approve-registration")).toBeVisible();
    // approving with an open query is blocked: the engine's canSubmit refuses it; here nothing is open (fixed)
    await reviewer.locator("[name=grade]").selectOption("B");
    await reviewer.getByTestId("approve-registration").click();
    await reviewer.waitForTimeout(1000);
    const wf = one<{ id: number; status: string }>("select id, status from approval_requests where document_type = 'subcontractor_onboarding' and document_id = ? order by id desc limit 1", subId);
    expect(wf, "approval request created").toBeTruthy();
    if (wf.status === "pending") {
      expect(one<{ registration_status: string }>("select registration_status from subcontractors where id = ?", subId).registration_status).toBe("under_review");
      await reviewer.reload();
      await expect(reviewer.getByTestId("awaiting-approval")).toBeVisible();
      // approve every level with its approver (a dedicated page per approver)
      for (let i = 0; i < 5; i++) {
        const t = one<{ id: number; email: string; pw: string }>("select t.id, u.email, case when u.id = 1 then 'Admin@12345' else 'Password@123' end pw from approval_tasks t join users u on u.id = t.assignee_user_id where t.request_id = ? and t.status = 'pending' limit 1", wf.id);
        if (!t) break;
        const ap = await fresh(browser);
        await internalLogin(ap, t.email, t.pw);
        await ap.goto("/approvals");
        await ap.waitForLoadState("networkidle");
        const inbox = ap.locator("tbody tr", { hasText: regNo }).first();
        await expect(inbox).toBeVisible();
        await inbox.getByRole("button", { name: "Approve", exact: true }).click();
        await ap.waitForTimeout(1200);
        await ap.context().close();
      }
    }
    const s = one<{ registration_status: string; status: string; prequal_grade: string; prequal_valid_until: string }>("select registration_status, status, prequal_grade, prequal_valid_until from subcontractors where id = ?", subId);
    expect(s).toMatchObject({ registration_status: "approved", status: "approved", prequal_grade: "B" });
    expect(s.prequal_valid_until > new Date().toISOString().slice(0, 10)).toBe(true);
    expect(q<{ status: string }>("select status from subcontractor_categories where subcontractor_id = ?", subId).every((c) => c.status === "approved")).toBe(true);
    expect(one<{ c: number }>("select count(*) c from email_outbox where related_id = ? and template = 'registration_approved'", subId).c).toBe(1);
  });

  test("approved: the portal is unrestricted and shows the approved banner; the registration is read-only", async () => {
    await sup.goto(`/p/${slug}`);
    await expect(sup.getByTestId("reg-banner")).toHaveAttribute("data-status", "approved");
    await expect(sup.getByTestId("reg-banner")).toContainText(/prequalified grade B/);
    for (const area of ["projects", "invoices", "progress", "payments", "issues", "certificates"]) {
      const r = await sup.goto(`/p/${slug}/${area}`);
      expect(r?.status(), area).toBe(200);
      await expect(sup, area).not.toHaveURL(/forbidden/);
    }
    await sup.goto(`/p/${slug}/registration`);
    await expect(sup.getByTestId("summary-company")).toBeVisible();
    await expect(sup.getByTestId("review-history")).toContainText(/approve/i);
    const nav = await sup.getByRole("navigation", { name: "Portal" }).first().innerText();
    expect(nav).toMatch(/Projects/);
    // the internal detail page has the Registration tab
    await reviewer.goto(`/subcontractors/${subId}?tab=registration`);
    await expect(reviewer.getByTestId("open-review")).toBeVisible();
    expect(problems.filter((p) => !/Failed to load resource/i.test(p)), problems.join("\n")).toEqual([]);
  });

  test("global sign-in (/suppliers/login), forgot password (outbox) and reset link", async ({ browser }) => {
    const p = await fresh(browser);
    await p.goto("/suppliers/login");
    await p.waitForLoadState("networkidle");
    await p.locator("[name=email]").fill(EMAIL);
    await p.locator("[name=password]").fill("Wrong@12345");
    await p.getByRole("button", { name: /Sign in/ }).click();
    await expect(p.getByText("Invalid email or password.")).toBeVisible();
    await p.locator("[name=password]").fill(PASSWORD);
    await p.getByRole("button", { name: /Sign in/ }).click();
    await p.waitForURL(new RegExp(`/p/${slug}$`));
    await p.context().close();
    // forgot password: reset e-mail in the outbox, one-time link
    const f = await fresh(browser);
    await f.goto("/suppliers/login?forgot=1");
    await f.waitForLoadState("networkidle");
    await f.locator("[name=email]").fill(EMAIL);
    await f.getByRole("button", { name: "Send reset link" }).click();
    await expect(f.getByTestId("reset-sent")).toBeVisible();
    const mail = one<{ body_text: string }>("select body_text from email_outbox where to_email = ? and template = 'password_reset' order by id desc limit 1", EMAIL);
    const link = /https?:\/\/[^\s]+\/suppliers\/reset\/[a-f0-9]+/.exec(mail.body_text)![0];
    await f.goto(new URL(link).pathname);
    await f.waitForLoadState("networkidle");
    await f.locator("[name=password]").fill("NewSupplier@456");
    await f.locator("[name=confirm]").fill("NewSupplier@456");
    await f.getByRole("button", { name: "Set new password" }).click();
    await expect(f.getByTestId("reset-done")).toBeVisible();
    await f.goto(new URL(link).pathname); // second use: refused
    await expect(f.getByTestId("reset-invalid")).toBeVisible();
    await f.goto("/suppliers/login");
    await f.waitForLoadState("networkidle");
    await f.locator("[name=email]").fill(EMAIL);
    await f.locator("[name=password]").fill("NewSupplier@456");
    await f.getByRole("button", { name: /Sign in/ }).click();
    await f.waitForURL(new RegExp(`/p/${slug}$`));
    await f.context().close();
  });

  test("setup pages: categories and document types are editable by procurement (subcontractors/setup)", async () => {
    await reviewer.goto("/subcontractors/categories");
    await expect(reviewer.getByTestId("cat-row-tel-cable")).toContainText("Fibre / copper cable laying");
    await reviewer.goto("/subcontractors/document-types");
    await expect(reviewer.getByTestId("doctype-row-trade_licence")).toContainText("Mandatory");
    await expect(reviewer.getByTestId("doctype-row-insurance_car")).toContainText("Optional");
    // a user without subcontractors/setup is sent away
    const viewer = await reviewer.context().browser()!.newContext({ baseURL: BASE });
    const vp = await viewer.newPage();
    await internalLogin(vp, "noura.saeed@alnoor.demo", "Password@123");
    await vp.goto("/subcontractors/categories");
    await expect(vp).toHaveURL(/forbidden/);
    await vp.goto("/subcontractors/registrations");
    await expect(vp.getByRole("heading", { name: "Subcontractors" })).toBeVisible();
    await viewer.close();
  });

  test("public pages and the new internal pages fit at 1024 px (and /suppliers at 390 px)", async ({ browser }) => {
    const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const u of ["/suppliers", "/suppliers/register", "/suppliers/login"]) {
      for (const w of [1024, 390]) {
        const p = await fresh(browser, w);
        await p.goto(u);
        await p.waitForLoadState("networkidle");
        expect(await overflow(p), `${u} at ${w}px has horizontal scroll`).toBeLessThanOrEqual(0);
        await p.context().close();
      }
    }
    const pages: [Page, string[]][] = [[reviewer, ["/subcontractors/registrations", `/subcontractors/${subId}/registration`, "/subcontractors/categories", "/subcontractors/document-types"]], [admin, ["/admin/email-outbox"]]];
    for (const [pg, urls] of pages) {
      await pg.setViewportSize({ width: 1024, height: 900 });
      for (const u of urls) {
        await pg.goto(u);
        await pg.waitForLoadState("networkidle");
        expect(await overflow(pg), `${u} at 1024px has horizontal scroll`).toBeLessThanOrEqual(0);
      }
    }
    await sup.setViewportSize({ width: 1024, height: 900 });
    for (const u of [`/p/${slug}`, `/p/${slug}/registration`, `/p/${slug}/documents`]) {
      await sup.goto(u);
      await sup.waitForLoadState("networkidle");
      expect(await overflow(sup), `${u} at 1024px has horizontal scroll`).toBeLessThanOrEqual(0);
    }
  });
});
