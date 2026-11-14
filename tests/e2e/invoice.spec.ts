/**
 * Subcontractor invoice document e2e (INVOICE_SPEC): project Invoices tab -> invoice page (lines, totals, attachments, viewer), PDF route, ERP payload,
 * internal line-item recording and a portal submission with lines + attachments.
 * Mutates data (adds two invoices): run against the isolated DB as described in README.
 */
import { test, expect, request, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const db = () => new Database(process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db"), { readonly: true });
const q = <T,>(sql: string, ...p: unknown[]) => { const d = db(); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];

const problems: string[] = [];
const real = () => problems.filter((p) => !/tile\.openstreetmap|arcgisonline|Failed to load resource/i.test(p));

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("[name=email]").fill("admin@alnoor.demo");
  await page.locator("[name=password]").fill("Admin@12345");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test.describe.serial("subcontractor invoice document", () => {
  let page: Page;
  // a certified/paid invoice of project 2 with several lines (the seed's showcase invoice)
  const inv = one<{ id: number; invoice_no: string; claimed_amount: number; net_payable: number; lines: number }>(
    `select i.id, i.invoice_no, i.claimed_amount, i.net_payable, (select count(*) from sub_invoice_lines l where l.invoice_id=i.id) lines
     from sub_invoices i where i.project_id=2 and i.status in ('paid','approved') and (select count(*) from sub_invoice_lines l where l.invoice_id=i.id) >= 3
       and (select count(*) from attachments a where a.entity_type='sub_invoice' and a.entity_id=i.id and a.category='progress_photos') >= 2 order by i.id limit 1`);

  test.beforeAll(async ({ browser }) => {
    expect(inv, "seed must contain a multi-line paid invoice with photos on project 2").toBeTruthy();
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) problems.push(`[${m.type()}] ${page.url()} :: ${m.text().slice(0, 250)}`); });
    page.on("pageerror", (e) => problems.push(`[pageerror] ${page.url()} :: ${e.message.slice(0, 250)}`));
    await login(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test("project 2 Invoices tab: click an invoice to open the invoice page with lines, totals and attachments", async () => {
    await page.goto("/projects/2?tab=invoices");
    await page.waitForLoadState("networkidle");
    // the whole row is clickable (click on a plain cell, not on the number link)
    await page.locator("tr", { hasText: inv.invoice_no }).first().locator("td").nth(2).click();
    await page.waitForURL(new RegExp(`/invoices/${inv.id}$`));
    await expect(page.getByTestId("invoice-title")).toHaveText(inv.invoice_no);
    const paper = page.getByTestId("invoice-paper");
    await expect(paper.getByText("TAX INVOICE")).toBeVisible();
    await expect(paper.getByTestId("invoice-lines").locator("tbody tr")).toHaveCount(inv.lines);
    await expect(paper.getByTestId("inv-gross")).toContainText(money(inv.claimed_amount));
    await expect(paper.getByTestId("inv-net")).toContainText(money(inv.net_payable));
    await expect(paper.getByTestId("certification")).toContainText("Net payable");
    await expect(paper.getByTestId("signatures")).toContainText("Certified by");
    await expect(page.getByTestId("invoice-kpis")).toContainText("Outstanding");
    const files = q<{ filename: string; category: string }>("select filename, category from attachments where entity_type='sub_invoice' and entity_id=?", inv.id);
    expect(files.some((f) => f.category === "tax_invoice")).toBe(true);
    for (const f of files) await expect(page.locator("[data-attachment]").filter({ hasText: f.filename }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview ERP payload" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send to ERP" })).toBeDisabled();
  });

  test("attachments open in the in-page viewer (PDF iframe, image lightbox with next/prev)", async () => {
    const files = q<{ filename: string; category: string }>("select filename, category from attachments where entity_type='sub_invoice' and entity_id=? order by id", inv.id);
    const pdf = files.find((f) => f.category === "tax_invoice")!;
    await page.getByRole("button", { name: pdf.filename }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.locator("iframe")).toHaveAttribute("src", /\/api\/files\/\d+/);
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);

    const photos = files.filter((f) => f.category === "progress_photos");
    await page.getByRole("button", { name: photos[0].filename }).click();
    await expect(dlg.locator("img")).toBeVisible();
    const first = await dlg.locator("img").getAttribute("src");
    await dlg.getByRole("button", { name: "Next file" }).click();
    await expect.poll(async () => dlg.locator("img, iframe").first().getAttribute("src")).not.toBe(first);
    await dlg.getByRole("button", { name: "Close preview" }).click();
    await expect(dlg).toHaveCount(0);
  });

  test("PDF route returns a real PDF (inline and download), long invoices span pages, anonymous access is refused", async () => {
    const res = await page.request.get(`/invoices/${inv.id}/pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect(res.headers()["content-disposition"]).toContain("inline");
    const body = await res.body();
    expect(body.length).toBeGreaterThan(5 * 1024);
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    const dl = await page.request.get(`/invoices/${inv.id}/pdf?download=1`);
    expect(dl.headers()["content-disposition"]).toContain(`attachment; filename="${inv.invoice_no}.pdf"`);

    const long = one<{ invoice_id: number; n: number }>("select invoice_id, count(*) n from sub_invoice_lines group by invoice_id having n >= 25 order by n desc limit 1");
    expect(long, "seed must contain a >= 25 line invoice").toBeTruthy();
    const lres = await page.request.get(`/invoices/${long.invoice_id}/pdf`);
    expect(lres.status()).toBe(200);
    const lbuf = (await lres.body()).toString("latin1");
    const pages = (lbuf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages, "a 25+ line invoice must produce a multi-page PDF").toBeGreaterThanOrEqual(2);

    const anon = await request.newContext({ baseURL: BASE });
    const r = await anon.get(`/invoices/${inv.id}/pdf`, { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(r.status());
    const r2 = await anon.get(`/api/erp/invoices/${inv.id}`, { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(r2.status());
    await anon.dispose();
  });

  test("ERP payload route and the preview modal expose bizbook.ap_invoice.v1", async () => {
    const res = await page.request.get(`/api/erp/invoices/${inv.id}`);
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.schema).toBe("bizbook.ap_invoice.v1");
    expect(j.lines).toHaveLength(inv.lines);
    expect(j.header.invoiceNo).toBe(inv.invoice_no);
    expect(j.totals.gross).toBeCloseTo(inv.claimed_amount, 2);
    expect(j.lines[0].vatCode).toBe("SR5");
    expect(j.attachments.length).toBeGreaterThan(0);
    expect(j.attachments[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await page.request.get("/api/erp/invoices/99999999")).status()).toBe(404);

    await page.goto(`/invoices/${inv.id}`);
    await page.getByRole("button", { name: "Preview ERP payload" }).click();
    await expect(page.getByTestId("erp-json")).toContainText("bizbook.ap_invoice.v1");
  });

  test("internal Record invoice with line items computes VAT and saves lines + attachments", async () => {
    const asg = one<{ id: number; code: string }>("select id, code from assignments where project_id=2 and status='active' and quantity is not null order by id limit 1");
    await page.goto("/projects/2?tab=invoices");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Record invoice" }).first().click();
    const modal = page.locator("div.fixed.inset-0").first();
    await modal.locator("[name=assignment_id]").selectOption(String(asg.id));
    await modal.locator("[name=sub_invoice_ref]").fill("E2E-REC-1");
    const qty = modal.locator("[name=line_this_qty]");
    await expect(qty.first()).toBeVisible();
    await qty.first().fill("1.5");
    const gross = modal.getByTestId("lines-gross");
    await expect(gross).not.toHaveText("0.00");
    await expect(modal.locator("[name=claimed_amount]")).toHaveJSProperty("readOnly", true);
    await modal.locator("[name=att_file]").first().setInputFiles({ name: "e2e-rec.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") });
    await modal.getByRole("button", { name: "Record invoice" }).click();
    await expect.poll(() => one<{ id: number }>("select id from sub_invoices where sub_invoice_ref='E2E-REC-1'")?.id ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
    const row = one<{ id: number; subtotal: number; vat_amount: number; claimed_amount: number; source: string }>("select * from sub_invoices where sub_invoice_ref='E2E-REC-1'");
    expect(row.source).toBe("internal");
    expect(row.subtotal + row.vat_amount).toBeCloseTo(row.claimed_amount, 2);
    expect(row.vat_amount).toBeCloseTo(row.subtotal * 0.05, 1);
    expect(q("select id from sub_invoice_lines where invoice_id=?", row.id).length).toBeGreaterThanOrEqual(1);
    expect(q("select id from attachments where entity_type='sub_invoice' and entity_id=?", row.id).length).toBe(1);
  });

  test("portal submission with lines and attachments appears with the Portal badge", async () => {
    const a = one<{ id: number; code: string; portal_token: string; project_id: number }>("select id, code, portal_token, project_id from assignments where project_id=2 and portal_enabled=1 and status='active' and quantity is not null order by id limit 1");
    expect(a, "seed must contain an active portal assignment on project 2").toBeTruthy();
    const portal = await page.context().newPage();
    portal.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) problems.push(`[portal ${m.type()}] ${m.text().slice(0, 250)}`); });
    await portal.goto(`/portal/${a.portal_token}`);
    await portal.waitForLoadState("networkidle");
    const ref = `E2E-PORTAL-${Date.now() % 100000}`;
    await portal.locator("[name=sub_invoice_ref]").fill(ref);
    const qty = portal.locator("[name=line_this_qty]");
    await qty.nth(0).fill("0.5");
    if ((await qty.count()) > 1) await qty.nth(1).fill("2");
    // tax invoice copy is required: submitting without it shows an error and creates nothing
    await portal.getByRole("button", { name: "Submit invoice" }).click();
    await expect(portal.getByText(/Attach a copy of your tax invoice/)).toBeVisible();
    expect(q("select id from sub_invoices where sub_invoice_ref=?", ref)).toHaveLength(0);
    await portal.locator("[name=sub_invoice_ref]").fill(ref);
    await portal.locator("[name=line_this_qty]").nth(0).fill("0.5");
    await portal.locator("[name=att_file]").first().setInputFiles({ name: "portal-tax-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 portal tax invoice") });
    await portal.getByRole("button", { name: "Add attachment" }).click();
    await portal.locator("[name=att_category]").nth(1).selectOption("measurement_sheet");
    await portal.locator("[name=att_file]").nth(1).setInputFiles({ name: "portal-measurement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 portal measurement") });
    await portal.getByRole("button", { name: "Submit invoice" }).click();
    await expect.poll(() => one<{ id: number }>("select id from sub_invoices where sub_invoice_ref=?", ref)?.id ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
    await portal.close();
    const row = one<{ id: number; source: string; status: string; submitted_at: string | null; subtotal: number; vat_amount: number }>("select * from sub_invoices where sub_invoice_ref=?", ref);
    expect(row).toMatchObject({ source: "portal", status: "submitted" });
    expect(row.submitted_at).toBeTruthy();
    expect(row.vat_amount).toBeCloseTo(row.subtotal * 0.05, 1);
    expect(q<{ category: string }>("select category from attachments where entity_type='sub_invoice' and entity_id=? order by id", row.id).map((x) => x.category)).toEqual(["tax_invoice", "measurement_sheet"]);
    expect(q("select id from sub_invoice_lines where invoice_id=?", row.id).length).toBeGreaterThanOrEqual(1);

    await page.goto(`/projects/${a.project_id}?tab=invoices`);
    await page.waitForLoadState("networkidle");
    const r = page.locator("tr", { hasText: row ? (one<{ invoice_no: string }>("select invoice_no from sub_invoices where id=?", row.id).invoice_no) : "" }).first();
    await expect(r.getByText("Portal", { exact: true })).toBeVisible();
    await page.goto(`/invoices/${row.id}`);
    await expect(page.getByTestId("invoice-title")).toBeVisible();
    await expect(page.getByText("Portal", { exact: true }).first()).toBeVisible();
    await expect(page.locator("[data-attachment]")).toHaveCount(2);
  });

  test("no console errors or hydration warnings", async () => {
    expect(real(), real().join("\n")).toEqual([]);
  });
});
