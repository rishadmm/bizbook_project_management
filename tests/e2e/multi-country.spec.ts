/**
 * Multi-country e2e (MULTI_COUNTRY_SPEC section 6): one company, two countries (UAE = AE / AED, Oman = OM / OMR).
 * Requires a running server and a freshly seeded DB (npm run seed). The test that records a cost mutates the DB; re-seed afterwards.
 *   E2E_BASE_URL=http://localhost:3150 OPS_DB_PATH=... npx playwright test tests/e2e/multi-country.spec.ts
 * Set E2E_SHOTS_DIR to also write the top-bar screenshots (1024 and 1280 px).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const DB = () => new Database(process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db"), { readonly: true });
const q = <T,>(sql: string, ...p: unknown[]) => { const d = DB(); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];

async function fresh(browser: Browser, width = 1440): Promise<Page> {
  const c = await browser.newContext({ baseURL: BASE, viewport: { width, height: 900 } });
  return c.newPage();
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
}
const admin = (page: Page) => login(page, "admin@alnoor.demo", "Admin@12345");
async function switchTo(page: Page, code: "AE" | "OM") {
  await page.getByTestId("country-switcher").click();
  await page.getByTestId(`country-option-${code}`).click();
  await expect(page.getByTestId("country-switcher")).toHaveAttribute("aria-label", code === "OM" ? /Oman/ : /United Arab Emirates/);
  await page.waitForLoadState("networkidle");
}

/** Codes in the first column of the main table (sub-projects are prefixed with a tree glyph). */
const codesOf = async (page: Page) => (await page.locator("main table tbody tr td:first-child a").allTextContents()).map((c) => c.replace(/^[^A-Z]+/, "").trim());

const OM_ONLY = "aisha.al.lawati@alnoor.demo";
const ids = () => ({
  uaeProject: one<{ id: number; code: string }>("select p.id, p.code from projects p join entities e on e.id = p.entity_id where e.code = 'AE' order by p.id limit 1"),
  omProject: one<{ id: number; code: string }>("select p.id, p.code from projects p join entities e on e.id = p.entity_id where e.code = 'OM' and p.status = 'active' order by p.id limit 1"),
  omInvoice: one<{ id: number }>("select i.id from sub_invoices i join projects p on p.id = i.project_id join entities e on e.id = p.entity_id where e.code = 'OM' and i.status in ('certified','approved','paid') order by i.id desc limit 1"),
  uaeInvoice: one<{ id: number }>("select i.id from sub_invoices i join projects p on p.id = i.project_id join entities e on e.id = p.entity_id where e.code = 'AE' order by i.id limit 1"),
  uaeFile: one<{ id: number }>("select a.id from attachments a where a.entity_type = 'project' and a.entity_id = (select id from projects where entity_id = (select id from entities where code = 'AE') order by id limit 1) limit 1"),
});

test.describe.serial("multi-country operations", () => {
  test("admin sees the switcher, switches to Oman (OMR, Oman data only) and back", async ({ browser }) => {
    const page = await fresh(browser);
    await admin(page);
    // default context = UAE
    await expect(page.getByTestId("country-switcher")).toBeVisible();
    await expect(page.getByTestId("country-switcher")).toContainText("UAE");
    await expect(page.getByTestId("country-switcher")).toContainText("AED");
    await expect(page.locator("main")).toContainText("AED");

    await switchTo(page, "OM");
    await expect(page.getByTestId("country-switcher")).toContainText("Oman");
    await expect(page.getByTestId("country-switcher")).toContainText("OMR");
    // dashboard: OMR everywhere, no AED
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toContainText("OMR");
    await expect(page.locator("main")).not.toContainText("AED");
    await expect(page.locator("main")).toContainText("Oman portfolio");

    // projects: Oman codes only
    await page.goto("/projects?view=table");
    await page.waitForLoadState("networkidle");
    const codes = await codesOf(page);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const c of codes) expect(c).toMatch(/^OM-PRJ-2026-\d{3}$/);
    // tenders / clients / subcontractors / invoices: no UAE codes either
    for (const url of ["/tenders?view=table", "/subcontractors", "/clients"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/(^|[^A-Z-])(PRJ|TND|SUB)-\d/);
      expect(text).not.toContain("(demo)");
    }
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toContainText("OMR");
    expect(await page.locator("main").innerText()).not.toMatch(/(^|[^A-Z-])SC-0\d\d/);

    // map payload: Oman project ids only (the page props carry every project of the active country)
    const html = await (await page.request.get("/map")).text();
    expect(html).toContain("OM-PRJ-2026-001");
    expect(html).not.toMatch(/(?<!OM-)PRJ-2026-\d{3}/);

    // search is scoped to the active country
    await page.goto("/search?q=Muscat");
    await expect(page.locator("main")).toContainText("Muscat");
    await page.goto("/search?q=Dubai");
    await expect(page.locator("main")).toContainText("No matches");

    await switchTo(page, "AE");
    await page.goto("/projects?view=table");
    await page.waitForLoadState("networkidle");
    const uae = await codesOf(page);
    for (const c of uae) expect(c).toMatch(/^PRJ-2026-\d{3}$/);
    await page.context().close();
  });

  test("a record of another country shows the info bar and switches country on demand", async ({ browser }) => {
    const { omInvoice, omProject } = ids();
    const page = await fresh(browser);
    await admin(page); // active country = UAE
    await page.goto(`/invoices/${omInvoice.id}`);
    await expect(page.getByTestId("entity-bar")).toContainText("belongs to Oman");
    // the invoice is shown in the RECORD's currency, with its USD equivalent
    await expect(page.getByTestId("inv-gross")).toContainText("OMR");
    await expect(page.getByTestId("inv-usd")).toContainText("≈ USD");
    await expect(page.getByTestId("inv-usd")).toContainText("rate 2.600780");
    await page.goto(`/projects/${omProject.id}`);
    await expect(page.getByTestId("entity-bar")).toBeVisible();
    await expect(page.locator("main")).toContainText("OMR");
    await page.getByRole("button", { name: "Switch to Oman" }).click();
    await expect(page.getByTestId("entity-bar")).toHaveCount(0);
    await expect(page.getByTestId("country-switcher")).toContainText("Oman");
    // detail page of the other country -> section list after a switch from the top bar
    await switchTo(page, "AE");
    await expect(page).toHaveURL(/\/projects$/);
    await page.context().close();
  });

  test("an Oman-only user has no switcher, no UAE data and cannot reach UAE records", async ({ browser }) => {
    const { uaeProject, uaeInvoice, uaeFile } = ids();
    const page = await fresh(browser);
    await login(page, OM_ONLY, "Password@123");
    await expect(page.getByTestId("country-switcher")).toHaveCount(0);
    await expect(page.getByTestId("country-chip")).toContainText("Oman");
    await page.goto("/");
    await expect(page.locator("main")).toContainText("OMR");
    await expect(page.locator("main")).not.toContainText("AED");

    // UAE records: 404 (pages) / 404 (files, ERP, PDF)
    for (const url of [`/projects/${uaeProject.id}`, `/invoices/${uaeInvoice.id}`]) {
      const r = await page.goto(url);
      expect(r?.status()).toBe(404);
    }
    expect((await page.request.get(`/api/files/${uaeFile.id}`)).status()).toBe(404);
    expect((await page.request.get(`/api/erp/invoices/${uaeInvoice.id}`)).status()).toBe(404);
    expect((await page.request.get(`/invoices/${uaeInvoice.id}/pdf`)).status()).toBe(404);

    // approvals: only Oman documents
    await page.goto("/approvals?tab=completed");
    await page.waitForLoadState("networkidle");
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/(^|[^M-])\b(PRJ|TND|SUB|SC)-(2026-)?\d/);
    // a forged country cookie does not unlock the UAE
    await page.context().addCookies([{ name: "bbp_entity", value: "AE", url: BASE }]);
    await page.goto("/projects?view=table");
    const codes = await codesOf(page);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c).toMatch(/^OM-/);
    await page.context().close();
  });

  test("a cost entered in Oman is stored in OMR with the locked USD rate 2.60078", async ({ browser }) => {
    const { omProject } = ids();
    const page = await fresh(browser);
    await admin(page);
    await switchTo(page, "OM");
    await page.goto(`/projects/${omProject.id}?tab=budget`);
    await page.getByRole("button", { name: "Add manual cost" }).click();
    const dlg = page.locator("div.fixed.inset-0"); // the modal overlay
    await dlg.locator("[name=description]").fill("E2E Muscat site cabin hire");
    await dlg.locator("[name=amount]").fill("1000");
    await dlg.getByRole("button", { name: "Add cost" }).click();
    await expect(page.getByText("E2E Muscat site cabin hire")).toBeVisible();
    const row = one<{ currency: string; fx_rate_usd: number; amount: number; amount_usd: number }>("select currency, fx_rate_usd, amount, amount_usd from project_costs where description = 'E2E Muscat site cabin hire'");
    expect(row.currency).toBe("OMR");
    expect(row.fx_rate_usd).toBe(2.60078);
    expect(row.amount).toBe(1000);
    expect(row.amount_usd).toBeCloseTo(2600.78, 2);
    await page.context().close();
  });

  test("Settings: countries and FX rates are listed for administrators", async ({ browser }) => {
    const page = await fresh(browser);
    await admin(page);
    await page.goto("/settings");
    await expect(page.getByText("Countries", { exact: true }).first()).toBeVisible();
    await expect(page.locator("[data-entity=OM]")).toContainText("OMR");
    await expect(page.locator("[data-entity=OM]")).toContainText("VATIN");
    await expect(page.getByText("Currencies & FX rates")).toBeVisible();
    await expect(page.locator("main")).toContainText("2.600780");
    await page.context().close();
  });

  test("the top-bar switcher fits at 1024 px and 1280 px wide", async ({ browser }) => {
    const shots = process.env.E2E_SHOTS_DIR;
    if (shots) fs.mkdirSync(shots, { recursive: true });
    for (const width of [1024, 1280]) {
      const page = await fresh(browser, width);
      await admin(page);
      await switchTo(page, "OM");
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      const hdr = page.locator("header").first();
      const box = await hdr.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(65); // one line: no wrapping
      const dims = await hdr.evaluate((h) => ({ sw: h.scrollWidth, cw: h.clientWidth }));
      expect(dims.sw).toBeLessThanOrEqual(dims.cw); // nothing overflows horizontally
      const sw = await page.getByTestId("country-switcher").boundingBox();
      const search = await page.locator("header input[name=q]").boundingBox();
      const user = await page.getByTestId("user-menu").boundingBox();
      expect(sw!.height).toBeGreaterThanOrEqual(34);
      expect(search!.x + search!.width).toBeLessThanOrEqual(sw!.x + 1); // switcher sits right of the search box
      expect(sw!.x + sw!.width).toBeLessThanOrEqual(user!.x); // and left of the user menu
      expect(search!.width).toBeGreaterThan(160); // search box stays usable
      if (shots) {
        await page.screenshot({ path: path.join(shots, `topbar-${width}.png`), clip: { x: 0, y: 0, width, height: 72 } });
        await page.getByTestId("country-switcher").click();
        await page.screenshot({ path: path.join(shots, `topbar-${width}-open.png`), clip: { x: 0, y: 0, width, height: 190 } });
      }
      await page.context().close();
    }
  });
});
