/**
 * Client portal e2e (CLIENT_PORTAL_SPEC section 5): credentials flow, client isolation, read-only by construction, visibility switches,
 * disabled portal / disabled user / lock-out, read-only admin view.
 * Mutates data: run against the isolated DB described in README (seed first). Needs OPS_DB_PATH when the server uses a non-default database.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const db = () => new Database(process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db"), { readonly: true });
const q = <T,>(sql: string, ...p: unknown[]) => { const d = db(); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];

const PW = "Portal@123";
const RTA = { slug: "rta", id: 1, admin: "khalid.mansoori@rta-demo.ae", viewer: "noor.hashimi@rta-demo.ae" };
const TEL = { slug: "etisalat-telecom", id: 2, admin: "mona.suwaidi@telco-demo.ae", scoped: "hassan.qureshi@telco-demo.ae" };
const WEA = { slug: "water-electricity", id: 3, admin: "yousef.rahimi@wea-demo.ae" };
const SKY = { slug: "skyline", id: 5, admin: "james.whitfield@skyline-demo.ae", disabled: "amelia.grant@skyline-demo.ae" };
const ADM = { slug: "ad-mobility", id: 6, admin: "saeed.dhaheri@admobility-demo.ae" };

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
async function clientLogin(page: Page, slug: string, email: string, password: string) {
  await page.goto(`/c/${slug}/login`);
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: /Sign in/ }).click();
}
async function clientSignedIn(page: Page, slug: string, email: string) {
  await clientLogin(page, slug, email, PW);
  await page.waitForURL(new RegExp(`/c/${slug}$`));
}
const projectCodes = (clientId: number) => q<{ code: string }>("select code from projects where client_id=? order by code", clientId).map((r) => r.code);

// generous timeouts: the first hit of a route can take long when the app runs in dev mode (on-demand compilation)
expect.configure({ timeout: 30_000 });

test.describe.serial("client portal", () => {
  test.describe.configure({ timeout: 180_000 });
  let admin: Page;
  test.beforeAll(async ({ browser }) => { test.setTimeout(180_000); admin = await fresh(browser); await adminLogin(admin); });
  test.afterAll(async () => { await admin.context().close(); });

  test("admin creates a client user, credentials are shown once, forced password change, dashboard shows only that client's projects", async ({ browser }) => {
    await admin.goto(`/clients/${SKY.id}?tab=portal`);
    await expect(admin.getByTestId("portal-url")).toContainText(`/c/${SKY.slug}`);
    await admin.getByRole("button", { name: "Add portal user" }).click();
    const email = `qa.client.${Date.now()}@skyline-qa.test`;
    await admin.locator("[name=name]").fill("QA Client User");
    await admin.locator("[name=email]").fill(email);
    await admin.locator("[name=role]").selectOption("viewer");
    const temp = await admin.locator("input[name=password]").inputValue();
    expect(temp).toMatch(/^[A-Za-z2-9]{10}-\d\d$/);
    await admin.getByRole("button", { name: "Create user" }).click();
    const card = admin.getByTestId("credentials-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("cred-url")).toContainText(`/c/${SKY.slug}`);
    await expect(card.getByTestId("cred-email")).toHaveText(email);
    await expect(card.getByTestId("cred-password")).toHaveText(temp);
    await expect(card.getByText("shown only once")).toBeVisible();
    await expect(card.getByRole("button", { name: "Copy all" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Email credentials" })).toBeDisabled();
    const row = one<{ password_hash: string; must_change_password: number }>("select password_hash, must_change_password from client_users where email = ?", email);
    expect(row.password_hash).not.toContain(temp);
    expect(row.must_change_password).toBe(1);
    await admin.keyboard.press("Escape");
    await expect(admin.getByTestId(`portal-user-${email}`)).toContainText("Must change password");

    const p = await fresh(browser);
    await clientLogin(p, SKY.slug, email, temp);
    await expect(p).toHaveURL(new RegExp(`/c/${SKY.slug}/change-password`));
    await p.goto(`/c/${SKY.slug}/reports`); // everything else is blocked until the password is changed
    await expect(p).toHaveURL(/change-password/);
    await p.locator("#current").fill(temp);
    await p.locator("#next").fill("QaClient@456");
    await p.locator("#confirm").fill("QaClient@456");
    await p.getByRole("button", { name: /Save password/ }).click();
    await p.waitForURL(new RegExp(`/c/${SKY.slug}$`));
    await expect(p.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    await expect(p.getByTestId("client-name")).toContainText("Skyline");
    await expect(p.getByTestId("read-only-pill")).toBeVisible();
    // only Skyline's projects, none of the other clients' codes
    const mine = projectCodes(SKY.id);
    const cards = await p.getByTestId("project-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-project-code")));
    expect(cards.sort()).toEqual(mine);
    const html = await p.content();
    for (const code of q<{ code: string }>("select code from projects where client_id <> ?", SKY.id).map((r) => r.code)) expect(html, code).not.toContain(code);
    // viewer role: no Team page
    await p.goto(`/c/${SKY.slug}/team`);
    await expect(p).toHaveURL(/forbidden/);
    expect(one<{ must_change_password: number }>("select must_change_password from client_users where email = ?", email).must_change_password).toBe(0);
    await p.context().close();
    await admin.goto(`/clients/${SKY.id}?tab=portal`);
    await expect(admin.getByTestId("portal-events")).toContainText("Password changed");
    // clients list shows the portal state
    await admin.goto("/clients");
    await expect(admin.locator("tr", { hasText: "Skyline" })).toContainText(/Active \(\d+ users?\)/);
    await expect(admin.locator("tr", { hasText: "Dubai Municipality" })).toContainText("Off");
    // a client without projects: empty state, no portal
    await admin.goto("/clients/4?tab=portal");
    await expect(admin.getByTestId("portal-access")).toContainText(/at least one project/i);
  });

  test("isolation: foreign projects are 404, foreign slugs redirect, foreign files 403, other sessions never open the portal", async ({ browser }) => {
    const foreignProject = one<{ id: number }>("select id from projects where client_id = ? limit 1", TEL.id);
    const foreignPhoto = one<{ id: number }>(`select a.id from attachments a join progress_reports r on r.id=a.entity_id join projects p on p.id=r.project_id
      where a.entity_type='progress' and r.status='verified' and p.client_id=? limit 1`, TEL.id);
    const ownPhoto = one<{ id: number }>(`select a.id from attachments a join progress_reports r on r.id=a.entity_id join projects p on p.id=r.project_id
      where a.entity_type='progress' and r.status='verified' and p.client_id=? limit 1`, RTA.id);
    const internalFile = one<{ id: number }>("select id from attachments where entity_type='sub_invoice' limit 1");
    const unverified = one<{ id: number }>(`select a.id from attachments a join progress_reports r on r.id=a.entity_id join projects p on p.id=r.project_id
      where a.entity_type='progress' and r.status <> 'verified' and p.client_id=? limit 1`, RTA.id);
    const contractFile = one<{ id: number }>("select a.id from attachments a join projects p on p.id=a.entity_id where a.entity_type='project' and a.category='Contract' limit 1");
    expect(foreignProject && foreignPhoto && ownPhoto && internalFile).toBeTruthy();

    const p = await fresh(browser);
    await clientSignedIn(p, RTA.slug, RTA.admin);
    await p.goto(`/c/${TEL.slug}/projects`);
    await expect(p).toHaveURL(new RegExp(`/c/${RTA.slug}$`));
    await p.goto(`/c/${TEL.slug}`, { waitUntil: "domcontentloaded" });
    await expect(p).toHaveURL(new RegExp(`/c/${RTA.slug}$`));
    expect((await p.goto(`/c/${RTA.slug}/projects/${foreignProject.id}`))?.status()).toBe(404);
    expect((await p.goto(`/c/${RTA.slug}/projects/999999`))?.status()).toBe(404);
    const foreignIssue = one<{ id: number }>("select i.id from issues i join projects p on p.id=i.project_id where p.client_id=? and i.kind='issue' limit 1", TEL.id);
    expect((await p.goto(`/c/${RTA.slug}/issues/${foreignIssue.id}`))?.status()).toBe(404);
    // CSV export and files
    expect((await p.request.get(`/c/${RTA.slug}/reports/export?report=progress&project=${foreignProject.id}`)).status()).toBe(200);
    const csv = await (await p.request.get(`/c/${RTA.slug}/reports/export?report=progress&project=${foreignProject.id}`)).text();
    expect(csv.split("\n").length).toBeLessThanOrEqual(2); // header only: a foreign project selects nothing
    expect((await p.request.get(`/c/${TEL.slug}/reports/export?report=progress`)).status()).toBe(401);
    expect((await p.request.get(`/api/files/${foreignPhoto.id}`)).status()).toBe(403);
    expect((await p.request.get(`/api/files/${ownPhoto.id}`)).status()).toBe(200);
    expect((await p.request.get(`/api/files/${internalFile.id}`)).status()).toBe(403);
    if (unverified) expect((await p.request.get(`/api/files/${unverified.id}`)).status()).toBe(403);
    if (contractFile) expect((await p.request.get(`/api/files/${contractFile.id}`)).status()).toBe(403);
    // a client session does not open internal pages or the subcontractor portal
    for (const url of ["/projects", "/clients", "/subcontractors", "/admin/users"]) {
      await p.goto(url);
      await expect(p, url).toHaveURL(/\/login/);
    }
    await p.goto("/p/gulf-trench");
    await expect(p).toHaveURL(/\/p\/gulf-trench\/login/);
    await p.context().close();

    // the internal session does not open the client portal
    await admin.goto(`/c/${RTA.slug}`);
    await expect(admin).toHaveURL(new RegExp(`/c/${RTA.slug}/login`));
    await admin.goto(`/c/${RTA.slug}/projects`);
    await expect(admin).toHaveURL(new RegExp(`/c/${RTA.slug}/login`));
    expect((await admin.request.get(`/c/${RTA.slug}/reports/export?report=schedule`)).status()).toBe(401);
    // a subcontractor portal session does not open it either
    const s = await fresh(browser);
    await s.goto("/p/gulf-trench/login");
    await s.locator("[name=email]").fill("bilal.siddiqui@gulftrenchcabl-demo.ae");
    await s.locator("[name=password]").fill(PW);
    await s.getByRole("button", { name: /Sign in/ }).click();
    await s.waitForURL(/\/p\/gulf-trench$/);
    await s.goto(`/c/${RTA.slug}`);
    await expect(s).toHaveURL(new RegExp(`/c/${RTA.slug}/login`));
    expect((await s.request.get(`/api/files/${ownPhoto.id}`)).status()).toBe(403);
    await s.context().close();

    // project scope: a viewer limited to one project only sees that one
    const sc = await fresh(browser);
    await clientSignedIn(sc, TEL.slug, TEL.scoped);
    const scoped = one<{ project_scope: string }>("select project_scope from client_users where email=?", TEL.scoped);
    const allowed = JSON.parse(scoped.project_scope) as number[];
    expect(allowed.length).toBe(1);
    const own = await sc.getByTestId("project-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-project-code")));
    expect(own).toEqual([one<{ code: string }>("select code from projects where id=?", allowed[0]).code]);
    const other = one<{ id: number }>("select id from projects where client_id=? and id<>? limit 1", TEL.id, allowed[0]);
    expect((await sc.goto(`/c/${TEL.slug}/projects/${other.id}`))?.status()).toBe(404);
    await sc.context().close();
  });

  test("read-only by construction: no forms except account/password/logout, no file inputs, stripped map payload", async ({ browser }) => {
    const p = await fresh(browser);
    await clientSignedIn(p, RTA.slug, RTA.admin);
    const proj = one<{ id: number }>("select id from projects where client_id=? order by id limit 1", RTA.id);
    const pages = ["", "/projects", `/projects/${proj.id}`, `/projects/${proj.id}?tab=map`, `/projects/${proj.id}?tab=schedule`, `/projects/${proj.id}?tab=progress`, `/projects/${proj.id}?tab=photos`,
      `/projects/${proj.id}?tab=issues`, `/projects/${proj.id}?tab=reports`, "/map", "/reports", "/reports/progress", "/reports/schedule", "/reports/issues", "/reports/monthly", "/photos", "/issues", "/team"];
    for (const url of pages) {
      const r = await p.goto(`/c/${RTA.slug}${url}`, { waitUntil: "domcontentloaded" });
      expect(r?.status(), url).toBe(200);
      await p.waitForTimeout(250);
      expect(await p.locator("form:not([data-readonly-ok])").count(), `${url}: unexpected form`).toBe(0);
      expect(await p.locator("input[type=file]").count(), `${url}: file input`).toBe(0);
      const allowed = await p.locator("form[data-readonly-ok]").evaluateAll((els) => els.map((e) => e.getAttribute("data-readonly-ok")));
      for (const a of allowed) expect(["logout", "password", "account"], url).toContain(a);
      // buttons that would change data
      expect(await p.getByRole("button", { name: /^(Save|Delete|Upload|Create|Add|Submit|Approve|Reject|Edit)\b/ }).count(), `${url}: write button`).toBe(0);
    }
    // account page: only the password + sessions + logout forms
    await p.goto(`/c/${RTA.slug}/account`);
    expect(await p.locator("form:not([data-readonly-ok])").count()).toBe(0);
    await expect(p.getByTestId("profile")).toContainText(RTA.admin);
    // map payload: no cost keys, no subcontract values, no other client's projects
    const forbiddenKeys = ["ac", "acHistory", "cpi", "bac", "contractValue", "invoices", "portalToken", "impactCost", "rating", "trade", "scope", "budget_cost", "claimed", "certified", "paid"];
    const others = q<{ code: string }>("select code from projects where client_id <> ?", RTA.id).map((r) => r.code);
    const otherIds = q<{ id: number }>("select id from projects where client_id <> ?", RTA.id).map((r) => r.id);
    for (const url of ["/map", "", `/projects/${proj.id}?tab=map`]) {
      const res = await p.request.get(`/c/${RTA.slug}${url}`);
      expect(res.status()).toBe(200);
      const body = (await res.text()).replace(/\\"/g, '"');
      // the map payload is what the browser receives for the client component (the dashboard's server-rendered cards may carry contract values when financials are on)
      if (url !== "") for (const k of forbiddenKeys) expect(body, `${url}: key ${k}`).not.toContain(`"${k}":`);
      for (const code of others) expect(body, `${url}: ${code}`).not.toContain(code);
      for (const id of otherIds) expect(body, `${url}: projectId ${id}`).not.toMatch(new RegExp(`"projectId":${id}[,}]`));
      // internal money amounts of the client's own subcontracts never travel in the payload
      const asgValues = q<{ v: number }>("select distinct a.contract_value v from assignments a join projects p on p.id=a.project_id where p.client_id=? and a.contract_value > 100000", RTA.id).map((r) => r.v);
      for (const v of asgValues) expect(body, `${url}: subcontract value ${v}`).not.toContain(`:${v},`);
    }
    // the live map loads in client mode: no Cost colour mode
    await p.goto(`/c/${RTA.slug}/map`);
    await expect(p.getByTestId("ops-map")).toBeVisible({ timeout: 30000 });
    await expect(p.getByRole("button", { name: "Health" })).toBeVisible();
    await expect(p.getByRole("button", { name: "Cost" })).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Delay cause" })).toBeVisible();
    await p.context().close();
  });

  test("visibility switch: financials off hides contract values", async ({ browser }) => {
    // seeded: WEA has financials off
    const w = await fresh(browser);
    await clientSignedIn(w, WEA.slug, WEA.admin);
    await expect(w.getByTestId("kpis")).not.toContainText("Contract value");
    await expect(w.getByTestId("kpis")).not.toContainText("Value of work done");
    expect(await w.locator("main").innerText()).not.toMatch(/AED/);
    const wp = one<{ id: number }>("select id from projects where client_id=? limit 1", WEA.id);
    await w.goto(`/c/${WEA.slug}/projects/${wp.id}`);
    await expect(w.getByTestId("project-kpis")).not.toContainText("Contract value");
    expect(await w.locator("main").innerText()).not.toMatch(/AED/);
    await w.goto(`/c/${WEA.slug}/projects?view=table`);
    await expect(w.getByTestId("projects-table")).not.toContainText("Contract value");
    await w.context().close();
  });

  test("visibility switch: subcontractor names off shows anonymised crew labels", async ({ browser }) => {
    // seeded: AD Mobility hides subcontractor names
    const subNames = q<{ name: string }>("select distinct s.name from assignments a join subcontractors s on s.id=a.subcontractor_id join projects p on p.id=a.project_id where p.client_id=?", ADM.id).map((r) => r.name);
    expect(subNames.length).toBeGreaterThan(0);
    const a = await fresh(browser);
    await clientSignedIn(a, ADM.slug, ADM.admin);
    const ap = q<{ id: number }>("select id from projects where client_id=? order by id", ADM.id);
    let crewSeen = false;
    for (const pr of ap) {
      for (const tab of ["schedule", "overview"]) {
        await a.goto(`/c/${ADM.slug}/projects/${pr.id}?tab=${tab}`);
        const text = await a.locator("main").innerText();
        for (const n of subNames) expect(text, `${tab}: ${n}`).not.toContain(n);
        if (/Contractor crew [A-Z]/.test(text)) crewSeen = true;
      }
    }
    expect(crewSeen).toBe(true);
    const mapBody = (await (await a.request.get(`/c/${ADM.slug}/map`)).text()).replace(/\\"/g, '"');
    for (const n of subNames) expect(mapBody, n).not.toContain(n);
    expect(mapBody).toContain("Contractor crew A");
    await a.goto(`/c/${ADM.slug}/map`);
    await expect(a.getByTestId("ops-map")).toBeVisible({ timeout: 30000 });
    await expect(a.getByRole("button", { name: "Subcontractor", exact: true })).toHaveCount(0);
    await a.context().close();
  });

  test("visibility switches on the internal Portal access tab drive the client view", async ({ browser }) => {
    // turn financials OFF for RTA, check, turn back ON
    await admin.goto(`/clients/${RTA.id}?tab=portal`);
    const sw = admin.getByTestId("switch-financials");
    await expect(sw).toContainText("On");
    await sw.click();
    await expect(sw).toContainText("Off");
    const r = await fresh(browser);
    await clientSignedIn(r, RTA.slug, RTA.admin);
    await expect(r.getByTestId("kpis")).not.toContainText("Contract value");
    await sw.click();
    await expect(sw).toContainText("On");
    await r.reload();
    await expect(r.getByTestId("kpis")).toContainText("Contract value");
    await r.context().close();
  });

  test("disabled portal, disabled user and lock-out after 5 failures", async ({ browser }) => {
    // disabled portal (Skyline)
    await admin.goto(`/clients/${SKY.id}?tab=portal`);
    await admin.getByTestId("portal-toggle").click();
    await expect(admin.getByTestId("portal-toggle")).toHaveText("Enable portal");
    const p = await fresh(browser);
    await clientLogin(p, SKY.slug, SKY.admin, PW);
    await expect(p.getByRole("alert").first()).toContainText(/disabled/i);
    await expect(p).toHaveURL(/login/);
    await admin.getByTestId("portal-toggle").click();
    await expect(admin.getByTestId("portal-toggle")).toHaveText("Disable portal");
    await clientLogin(p, SKY.slug, SKY.admin, PW);
    await p.waitForURL(new RegExp(`/c/${SKY.slug}$`));
    // disabling the portal signs the open session out
    await admin.getByTestId("portal-toggle").click();
    await expect(admin.getByTestId("portal-toggle")).toHaveText("Enable portal");
    await p.goto(`/c/${SKY.slug}/projects`);
    await expect(p).toHaveURL(/login/);
    await admin.getByTestId("portal-toggle").click();
    await expect(admin.getByTestId("portal-toggle")).toHaveText("Disable portal");
    // disabled user
    const d = await fresh(browser);
    await clientLogin(d, SKY.slug, SKY.disabled, PW);
    await expect(d.getByRole("alert").first()).toContainText(/disabled/i);
    await expect(d).toHaveURL(/login/);
    // lock-out (RTA viewer): 5 wrong passwords, the correct one is then refused, admin unlocks
    const l = await fresh(browser);
    for (let i = 0; i < 5; i++) { await clientLogin(l, RTA.slug, RTA.viewer, "wrong-Password1"); await expect(l.getByRole("alert").first()).toBeVisible(); }
    await expect(l.getByRole("alert").first()).toContainText(/locked/i);
    await clientLogin(l, RTA.slug, RTA.viewer, PW);
    await expect(l.getByRole("alert").first()).toContainText(/locked/i);
    await expect(l).toHaveURL(/login/);
    await admin.goto(`/clients/${RTA.id}?tab=portal`);
    const row = admin.getByTestId(`portal-user-${RTA.viewer}`);
    await expect(row).toContainText("Locked");
    await row.getByRole("button", { name: "Unlock" }).click();
    await expect(admin.getByTestId(`portal-user-${RTA.viewer}`)).not.toContainText("Locked");
    await clientLogin(l, RTA.slug, RTA.viewer, PW);
    await l.waitForURL(new RegExp(`/c/${RTA.slug}$`));
    await admin.getByTestId(`portal-user-${RTA.viewer}`).getByRole("button", { name: "Sign out all" }).click();
    await expect.poll(() => one<{ n: number }>("select count(*) n from client_auth_events where event='session_revoked' and client_id=?", RTA.id).n).toBeGreaterThan(0);
    await l.goto(`/c/${RTA.slug}/projects`);
    await expect(l).toHaveURL(/login/);
    for (const ctx of [p, d, l]) await ctx.context().close();
  });

  test("admin view is read-only, shows the banner and is audited", async () => {
    await admin.goto(`/clients/${TEL.id}?tab=portal`);
    const [popup] = await Promise.all([admin.context().waitForEvent("page"), admin.getByTestId("view-as-client").click()]);
    await popup.waitForURL(new RegExp(`/c/${TEL.slug}$`));
    const banner = popup.getByTestId("admin-view-banner");
    await expect(banner).toContainText("Viewing as Etisalat-like Telecom");
    await expect(banner).toContainText("read only");
    await expect(popup.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    await popup.goto(`/c/${TEL.slug}/team`);
    await expect(popup.getByTestId("team-row").first()).toBeVisible();
    await popup.goto(`/c/${TEL.slug}/account`);
    await expect(popup.getByRole("button", { name: "Change password" })).toBeDisabled();
    expect(one<{ n: number }>("select count(*) n from client_sessions where impersonated_by is not null and client_id=?", TEL.id).n).toBeGreaterThan(0);
    expect(one<{ n: number }>("select count(*) n from client_auth_events where event='impersonation_started' and client_id=?", TEL.id).n).toBeGreaterThan(0);
    await popup.getByRole("button", { name: "Exit" }).click();
    await popup.waitForURL(new RegExp(`/clients/${TEL.id}\\?tab=portal`));
    await popup.close();
    expect(one<{ n: number }>("select count(*) n from client_auth_events where event='impersonation_ended' and client_id=?", TEL.id).n).toBeGreaterThan(0);
  });
});
