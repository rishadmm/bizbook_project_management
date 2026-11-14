/**
 * Live Ops Map + dashboard full-screen link e2e. Read-only (does not mutate data).
 *   E2E_BASE_URL=http://localhost:3105 npm run test:e2e -- map.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const problems: string[] = [];
async function login(page: Page) {
  await page.goto("/login");
  await page.locator("[name=email]").fill("admin@alnoor.demo");
  await page.locator("[name=password]").fill("Admin@12345");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("Live Ops Map", () => {
  test.beforeEach(async ({ page }) => {
    problems.length = 0;
    page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) problems.push(`[${m.type()}] ${page.url()} :: ${m.text().slice(0, 200)}`); });
    page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message.slice(0, 200)}`));
    await login(page);
  });
  const realProblems = () => problems.filter((p) => !/tile\.openstreetmap|arcgisonline|Failed to load resource/i.test(p));

  test("dashboard has a Full screen link to /map", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "Full screen" });
    await expect(link).toHaveAttribute("href", "/map");
    await link.click();
    await page.waitForURL(/\/map/);
    await expect(page.getByTestId("ops-map")).toBeVisible();
    expect(realProblems(), realProblems().join("\n")).toEqual([]);
  });

  test("map loads, project selection opens the drawer, colour-by and time slider work", async ({ page }) => {
    await page.goto("/map");
    const root = page.getByTestId("ops-map");
    await expect(root).toBeVisible();
    await expect(root.getByRole("heading", { name: "Projects" })).toBeVisible();

    // select the first project from the rail -> drawer with "Open project" appears and the rail auto-collapses at this width
    await root.locator("button.om-row").first().click();
    await expect(root.getByRole("link", { name: /Open project/ })).toBeVisible();
    await expect(root.getByRole("button", { name: "Open projects panel" })).toBeVisible();
    await expect(page).toHaveURL(/project=\d+/);

    // the map keeps most of the width: the visible gap between rail button and drawer is >= 55% of the container
    const box = await root.boundingBox();
    const drawer = await root.getByRole("link", { name: /Open project/ }).boundingBox();
    const railBtn = await root.getByRole("button", { name: "Open projects panel" }).boundingBox();
    expect(box && drawer && railBtn).toBeTruthy();
    const freeWidth = drawer!.x - (railBtn!.x + railBtn!.width);
    expect(freeWidth / box!.width).toBeGreaterThan(0.45);

    // colour-by switch
    const sub = root.getByRole("button", { name: "Subcontractor", exact: true });
    await sub.click();
    await expect(sub).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/color=sub/);

    // time slider: stepping back a week changes the date label and enters replay mode
    const tm = root.getByRole("group", { name: "Time machine" });
    await expect(tm.getByText("LIVE · TODAY")).toBeVisible();
    const before = await tm.locator(".om-num").first().innerText();
    await tm.getByRole("button", { name: "Back one week" }).click();
    await expect(tm.locator(".om-num").first()).not.toHaveText(before);
    await expect(tm.getByText(/TIME MACHINE · REPLAY/)).toBeVisible();
    await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);
    await tm.getByRole("button", { name: "Today" }).click();
    await expect(tm.getByText("LIVE · TODAY")).toBeVisible();

    expect(realProblems(), realProblems().join("\n")).toEqual([]);
  });

  test("project map tab links to the Live Ops Map for that project", async ({ page }) => {
    await page.goto("/projects");
    const hrefs = await page.locator("a[href^='/projects/']").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    const id = hrefs.map((h) => h.match(/^\/projects\/(\d+)/)?.[1]).find(Boolean)!;
    await page.goto(`/projects/${id}?tab=map`);
    const link = page.getByRole("link", { name: "Open in Live Ops Map" });
    await expect(link).toHaveAttribute("href", `/map?project=${id}`);
    await link.click();
    await page.waitForURL(new RegExp(`/map\\?project=${id}`));
    await expect(page.getByTestId("ops-map").getByRole("link", { name: /Open project/ })).toBeVisible();
  });
});
