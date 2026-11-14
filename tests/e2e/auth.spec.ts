/**
 * Auth / RBAC e2e. Requires a running server and a freshly seeded DB (mutates data/ops.db; re-seed afterwards).
 *   npm run seed && E2E_BASE_URL=http://localhost:3100 npm run test:e2e
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const one = <T,>(sql: string, ...p: unknown[]) => { const d = new Database((process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db")), { readonly: true }); try { return d.prepare(sql).get(...p) as T; } finally { d.close(); } };

async function fresh(browser: Browser): Promise<Page> {
  const c = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  return c.newPage();
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const VIEWER = () => one<{ email: string }>("select email from users where role='viewer' order by id limit 1").email;

test.describe.serial("authentication and access control", () => {
  test("unauthenticated users are redirected to /login", async ({ browser }) => {
    const page = await fresh(browser);
    await page.goto("/tenders");
    await expect(page).toHaveURL(/\/login\?next=%2Ftenders/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    const r = await page.request.get("/api/files/1", { maxRedirects: 0 });
    expect(r.status()).toBe(401);
    await page.context().close();
  });

  test("wrong password shows a generic error", async ({ browser }) => {
    const page = await fresh(browser);
    await login(page, "admin@alnoor.demo", "nope-nope");
    await expect(page.locator("p[role=alert]")).toContainText("Invalid email or password");
    await login(page, "ghost@nowhere.test", "nope-nope");
    await expect(page.locator("p[role=alert]")).toContainText("Invalid email or password");
    await page.context().close();
  });

  test("account locks after 5 failed attempts and an admin can unlock it", async ({ browser }) => {
    const email = VIEWER();
    const page = await fresh(browser);
    for (let i = 0; i < 5; i++) { await login(page, email, "wrong-Password1"); await expect(page.locator("p[role=alert]")).toBeVisible(); }
    await expect(page.locator("p[role=alert]")).toContainText(/locked/i);
    await login(page, email, "Password@123"); // correct password is refused while locked
    await expect(page.locator("p[role=alert]")).toContainText(/locked/i);
    await expect(page).toHaveURL(/\/login/);
    // admin unlocks
    const admin = await fresh(browser);
    await login(admin, "admin@alnoor.demo", "Admin@12345");
    await admin.waitForURL((u) => !u.pathname.startsWith("/login"));
    const uid = one<{ id: number }>("select id from users where lower(email)=lower(?)", email).id;
    await admin.goto(`/admin/users/${uid}`);
    await expect(admin.getByText("Locked").first()).toBeVisible();
    await admin.getByRole("button", { name: "Unlock" }).click();
    await admin.waitForLoadState("networkidle");
    await expect(admin.getByRole("button", { name: "Unlock" })).toHaveCount(0);
    await admin.context().close();
    await login(page, email, "Password@123");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.context().close();
  });

  test("viewer has no Settings in the sidebar and is sent to /forbidden", async ({ browser }) => {
    const page = await fresh(browser);
    await login(page, VIEWER(), "Password@123");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await expect(sidebar(page).getByRole("link", { name: "Tenders" })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(sidebar(page).getByRole("link", { name: "Users" })).toHaveCount(0);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/forbidden/);
    await expect(page.getByText(/don.t have access/i)).toBeVisible();
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/forbidden/);
    await page.context().close();
  });

  test("admin creates a user with a temporary password; first login forces a password change", async ({ browser }) => {
    const admin = await fresh(browser);
    await login(admin, "admin@alnoor.demo", "Admin@12345");
    await admin.waitForURL((u) => !u.pathname.startsWith("/login"));
    await admin.goto("/admin/users/new");
    const email = `qa.user${Date.now()}@alnoor.demo`;
    await admin.locator("[name=name]").fill("QA Temp User");
    await admin.locator("[name=email]").fill(email);
    await admin.locator("[name=role_id]").selectOption({ label: "Viewer" });
    await admin.getByRole("button", { name: "Create user" }).click();
    const temp = (await admin.getByTestId("temp-password").textContent())!.trim();
    expect(temp.length).toBeGreaterThanOrEqual(8);
    expect(one<{ must_change_password: number }>("select must_change_password from users where email=?", email).must_change_password).toBe(1);
    await admin.context().close();

    const page = await fresh(browser);
    await login(page, email, temp);
    await expect(page).toHaveURL(/\/account\/password/);
    await page.goto("/tenders");
    await expect(page).toHaveURL(/\/account\/password/);
    await page.locator("[name=current]").fill(temp);
    await page.locator("[name=next]").fill("Brand-New1pass");
    await page.locator("[name=confirm]").fill("Brand-New1pass");
    await page.getByRole("button", { name: "Change password" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await page.goto("/tenders");
    await expect(page).toHaveURL(/\/tenders/);
    await page.context().close();
  });

  test("editing a role's permissions hides the menu item", async ({ browser }) => {
    const roleId = one<{ id: number }>("select id from roles where code='viewer'").id;
    const admin = await fresh(browser);
    await login(admin, "admin@alnoor.demo", "Admin@12345");
    await admin.waitForURL((u) => !u.pathname.startsWith("/login"));
    const toggleClients = async () => {
      await admin.goto(`/admin/roles/${roleId}`);
      await admin.locator('[data-perm="clients:view"]').click();
      await admin.getByRole("button", { name: "Save permissions" }).click();
      await admin.waitForLoadState("networkidle");
      await admin.waitForTimeout(400);
    };
    await toggleClients(); // remove clients:view
    const v = await fresh(browser);
    await login(v, VIEWER(), "Password@123");
    await v.waitForURL((u) => !u.pathname.startsWith("/login"));
    await expect(sidebar(v).getByRole("link", { name: "Tenders" })).toBeVisible();
    await expect(sidebar(v).getByRole("link", { name: "Clients" })).toHaveCount(0);
    await v.goto("/clients");
    await expect(v).toHaveURL(/\/forbidden/);
    await toggleClients(); // restore
    await v.goto("/");
    await expect(sidebar(v).getByRole("link", { name: "Clients" })).toBeVisible();
    await v.context().close();
    await admin.context().close();
  });
});
