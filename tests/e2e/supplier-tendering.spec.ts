/**
 * Supplier tendering e2e (SUPPLIER_TENDERING_SPEC Part B / C2): a procurement officer floats a tender from a project stage and publishes it through the approval inbox; three
 * suppliers bid in the portal; a late submission after "Close bidding now" is refused on the server; internal users see no names / prices / bid files before the opening; the board
 * opens, evaluates, compares, recommends; the award is approved (the recommender cannot approve) and creates the assignment automatically (source tender, right value); the winner sees
 * "Awarded" + the Letter of Award, the loser "Not successful" without competitor data; direct assignment still works.
 * Mutates data: run against the isolated DB described in README (seed first).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const dbPath = () => process.env.OPS_DB_PATH ?? path.join(process.cwd(), "data", "ops.db");
const q = <T,>(sql: string, ...p: unknown[]) => { const d = new Database(dbPath(), { readonly: true }); try { return d.prepare(sql).all(...p) as T[]; } finally { d.close(); } };
const one = <T,>(sql: string, ...p: unknown[]) => q<T>(sql, ...p)[0];
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const STAMP = Date.now();
const SUPPLIERS = [{ slug: "al-marmoom", factor: 0.9, name: "Al Marmoom" }, { slug: "jebel-ali", factor: 1.1, name: "Jebel Ali" }, { slug: "dubai-sands", factor: 1.2, name: "Dubai Sands" }];
const problems: string[] = [];

async function fresh(browser: Browser, width = 1280): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  p.on("console", (m) => { if ((m.type() === "error" && !/status of (401|403|409)|Failed to load resource/i.test(m.text())) || /hydrat/i.test(m.text())) problems.push(`[${m.type()}] ${p.url()} :: ${m.text().slice(0, 200)}`); });
  return p;
}
async function internalLogin(page: Page, email: string, password = "Password@123") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
}
async function supplierLogin(page: Page, slug: string) {
  const email = one<{ email: string }>("select u.email from portal_users u join subcontractors s on s.id = u.subcontractor_id where s.portal_slug = ? and u.portal_role = 'owner' order by u.id", slug).email;
  await page.goto(`/p/${slug}/login`);
  await page.locator("[name=email]").fill(email);
  await page.locator("[name=password]").fill("Portal@123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(new RegExp(`/p/${slug}(/|$)`));
  await page.waitForLoadState("networkidle");
}
const settle = async (p: Page) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };

/** Fills + saves the technical envelope and the commercial envelope of a bid in the portal (step 1 and 2). */
async function prepareBid(p: Page, slug: string, rfxId: number, factor: number) {
  await p.goto(`/p/${slug}/tenders/${rfxId}/bid?step=1`);
  await settle(p);
  for (const f of await p.locator("input[type=file]").all()) await f.setInputFiles({ name: "doc.pdf", mimeType: "application/pdf", buffer: PDF });
  for (const t of await p.locator("textarea[name^=text_]").all()) await t.fill("Two crews, own plant, mobilise within a week.");
  for (const n of await p.locator("input[type=number][name^=text_]").all()) await n.fill("7");
  await p.getByTestId("save-technical").click();
  await expect(p.getByText("Technical envelope saved.")).toBeVisible();
  await p.goto(`/p/${slug}/tenders/${rfxId}/bid?step=2`);
  await settle(p);
  const rates = await p.locator("input[data-testid^=rate-]").all();
  for (const [i, r] of rates.entries()) await r.fill(String(((10 + i * 3) * factor).toFixed(2)));
  for (const s of await p.locator("select[name^=text_]").all()) await s.selectOption("yes");
  await expect(p.getByTestId("bid-net")).not.toHaveText("0.00");
  await p.getByTestId("save-commercial").click();
  await expect(p.getByText("Commercial envelope saved.")).toBeVisible();
}

test.describe.serial("supplier tendering", () => {
  const sup: Record<string, Page> = {};
  let proc: Page;
  let rfxId = 0, code = "";
  // every seeded stage is either assigned or in a live tender (a tender and an assignment never share a stage): the test adds its own free stage to PRJ-2026-001
  let stageId = 0;

  test.beforeAll(async ({ browser }) => {
    const w = new Database(dbPath());
    try {
      stageId = Number(w.prepare(`insert into stages(project_id, code, name, description, sort, planned_quantity, quantity_unit, planned_start, planned_end, budget_amount, status)
        values (1, 'S7', 'Section G (E2E tender stage)', 'Added by the tendering e2e test', 99, 2, 'km', '2027-01-10', '2027-03-20', 800000, 'not_started')`).run().lastInsertRowid);
      const ins = w.prepare("insert into project_budget_lines(project_id, stage_id, category, description, unit, quantity, unit_cost, budget_amount) values (1, ?, ?, ?, ?, ?, ?, ?)");
      ins.run(stageId, "subcontract", "Reinstatement and paving", "m", 2000, 150, 300000);
      ins.run(stageId, "equipment", "Paving and compaction fleet", "day", 60, 4500, 270000);
      ins.run(stageId, "manpower", "Road crew", "man-day", 1000, 230, 230000);
    } finally { w.close(); }
    proc = await fresh(browser);
    await internalLogin(proc, "rashid.al.mazrouei@alnoor.demo");
    for (const s of SUPPLIERS) { sup[s.slug] = await fresh(browser); await supplierLogin(sup[s.slug], s.slug); }
  });
  test.afterAll(async () => { for (const p of [proc, ...Object.values(sup)]) await p.context().close(); });

  test("1. float a tender from a project stage, pick a template, submit for approval", async () => {
    await proc.goto("/projects/1?tab=stages");
    await settle(proc);
    // the stage list offers the row action and the Subcontracts tab has both primary actions
    await proc.locator(`a[href*="/procurement/new?project=1&stages=${stageId}"]`).first().click();
    await expect(proc).toHaveURL(/procurement\/new\?project=1/);
    await expect(proc.getByTestId(`stage-${stageId}`)).toBeChecked();
    const cat = one<{ id: number }>("select id from supplier_categories where code = 'civ-works'").id;
    const tpl = one<{ id: number }>("select id from rfx_templates where name like 'Small works RFQ%'").id;
    await proc.locator("input[name=title]").fill(`E2E road section F ${STAMP}`);
    await proc.locator("textarea[name=description]").fill("Reinstatement and paving of section F.");
    await proc.locator("[name=category_id]").selectOption(String(cat));
    await proc.locator("[name=template_id]").selectOption(String(tpl));
    await proc.getByRole("button", { name: "Create draft" }).click();
    await proc.waitForURL(/\/procurement\/\d+\/edit/);
    rfxId = Number(new URL(proc.url()).pathname.split("/")[2]);
    const r = one<{ code: string; status: string; scope_kind: string; estimate: number }>("select code, status, scope_kind, estimate from rfx_tenders where id = ?", rfxId);
    code = r.code;
    expect(r).toMatchObject({ status: "draft", scope_kind: "stages" });
    expect(r.estimate).toBeGreaterThan(0);
    expect(one<{ c: number }>("select count(*) c from rfx_scope where rfx_id = ? and stage_id = ?", rfxId, stageId).c).toBe(1);
    expect(one<{ c: number }>("select count(*) c from rfx_requirements where rfx_id = ?", rfxId).c).toBeGreaterThanOrEqual(5); // copied from the template
    // dates: closing in 3 days; blockers disappear
    const closing = new Date(Date.now() + 3 * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 16);
    await proc.waitForTimeout(500);
    await proc.getByTestId("closing-at").fill(closing);
    await proc.getByRole("button", { name: "Save dates" }).click();
    await expect(proc.getByText("Dates saved.")).toBeVisible();
    await proc.reload();
    await expect(proc.getByTestId("publish-blockers")).toHaveCount(0);
    await proc.getByTestId("submit-publish").click();
    await expect.poll(() => one<{ status: string }>("select status from rfx_tenders where id = ?", rfxId).status, { timeout: 20_000 }).toBe("pending_approval");
  });

  /** Decides the open approval request of the tender in the inbox, as whoever holds the pending task. */
  async function approveAll(type: string, approvers: string[] = []) {
    for (let i = 0; i < 8; i++) {
      const task = one<{ assignee_user_id: number; email: string; request_id: number }>(`select t.assignee_user_id, u.email, r.id request_id from approval_tasks t join approval_requests r on r.id = t.request_id join users u on u.id = t.assignee_user_id
        where r.document_type = ? and r.document_id = ? and r.status = 'pending' and t.status = 'pending' order by t.id limit 1`, type, rfxId);
      if (!task) return;
      approvers.push(task.email);
      await internalLogin(proc, task.email, task.assignee_user_id === 1 ? "Admin@12345" : "Password@123");
      await proc.goto("/approvals");
      await settle(proc);
      const row = proc.locator("tbody tr", { hasText: code }).first();
      await expect(row, `inbox of ${task.email} lists ${code}`).toBeVisible();
      await row.getByRole("button", { name: "Approve", exact: true }).click();
      await settle(proc);
    }
  }

  test("2. publication is approved through the inbox; eligible suppliers are invited by e-mail", async () => {
    await approveAll("rfx_publish");
    expect(one<{ status: string }>("select status from rfx_tenders where id = ?", rfxId).status).toBe("published");
    expect(one<{ status: string }>("select status from approval_requests where document_type = 'rfx_publish' and document_id = ? order by id desc", rfxId).status).toBe("approved");
    expect(one<{ c: number }>("select count(*) c from rfx_invitations where rfx_id = ?", rfxId).c).toBeGreaterThanOrEqual(3);
    expect(one<{ c: number }>("select count(*) c from email_outbox where template = 'tender_invitation' and related_type = 'rfx' and related_id = ?", rfxId).c).toBeGreaterThanOrEqual(3);
    await internalLogin(proc, "rashid.al.mazrouei@alnoor.demo");
    // the public notice board lists it (title, category, country, closing only)
    const pub = await fresh(proc.context().browser()!);
    await pub.goto("/suppliers");
    await expect(pub.getByTestId("notice-board")).toContainText(code);
    await pub.context().close();
  });

  test("3. suppliers see the opportunity (badge), ask a question, acknowledge and bid; the receipt is issued", async () => {
    const a = sup["al-marmoom"];
    await a.goto("/p/al-marmoom/tenders");
    await settle(a);
    await expect(a.getByTestId("nav-badge-tenders")).toBeVisible();
    await expect(a.getByTestId("portal-tender-row").filter({ hasText: code })).toBeVisible();
    await a.goto(`/p/al-marmoom/tenders/${rfxId}`);
    await settle(a);
    await expect(a.getByText("Tender documents")).toBeVisible();
    await expect(a.locator("body")).not.toContainText(/estimate/i);
    await a.getByTestId("question").fill("Is night working allowed in section F?");
    await a.getByTestId("ask-question").click();
    await expect(a.getByText(/Question sent/)).toBeVisible();
    // the officer answers; the answer is published anonymously
    await proc.goto(`/procurement/${rfxId}?tab=clarifications`);
    await settle(proc);
    await proc.locator("textarea[name=answer]").first().fill("Night working is allowed with the standard permit.");
    await proc.getByRole("button", { name: "Publish answer" }).click();
    await expect.poll(() => one<{ c: number }>("select count(*) c from rfx_clarifications where rfx_id = ? and answer is not null", rfxId).c).toBe(1);
    expect(one<{ c: number }>("select count(*) c from email_outbox where template = 'clarification_answered' and related_id = ?", rfxId).c).toBeGreaterThanOrEqual(1);
    // an addendum that must be acknowledged before bidding
    await proc.goto(`/procurement/${rfxId}?tab=addenda`);
    await settle(proc);
    await proc.locator("input[name=title]").first().fill("Clarified item descriptions");
    await proc.getByRole("button", { name: "Issue addendum" }).click();
    await expect.poll(() => one<{ c: number }>("select count(*) c from rfx_addenda where rfx_id = ?", rfxId).c).toBe(1);
    for (const s of SUPPLIERS.slice(0, 2)) {
      const p = sup[s.slug];
      await p.goto(`/p/${s.slug}/tenders/${rfxId}`);
      await settle(p);
      await expect(p.getByTestId("addendum")).toContainText("Not acknowledged");
      await p.getByTestId("ack-addendum").click();
      await expect(p.getByTestId("addendum")).toContainText("Acknowledged");
      await prepareBid(p, s.slug, rfxId, s.factor);
      await p.goto(`/p/${s.slug}/tenders/${rfxId}/bid?step=3`);
      await settle(p);
      await expect(p.getByTestId("checklist")).toContainText("Every mandatory item is present");
      await p.getByTestId("confirm-submit").check();
      await p.getByTestId("submit-bid").click();
      await expect(p.getByText(/Bid submitted/)).toBeVisible();
      await p.reload();
      await expect(p.getByTestId("receipt")).toContainText("Receipt hash");
    }
    const bids = q<{ status: string; receipt_hash: string; total_amount: number }>("select status, receipt_hash, total_amount from rfx_bids where rfx_id = ? and status = 'submitted'", rfxId);
    expect(bids).toHaveLength(2);
    expect(bids.every((b) => /^[0-9a-f]{64}$/.test(b.receipt_hash) && b.total_amount > 0)).toBe(true);
    expect(one<{ c: number }>("select count(*) c from email_outbox where template = 'bid_received' and related_id = ?", rfxId).c).toBe(2);
    // a revision replaces the previous one with history
    const b = sup["jebel-ali"];
    await b.goto(`/p/jebel-ali/tenders/${rfxId}/bid?step=2`);
    await settle(b);
    const first = b.locator("input[data-testid^=rate-]").first();
    await first.fill("9.99");
    await b.getByTestId("save-commercial").click();
    await expect(b.getByText("Commercial envelope saved.")).toBeVisible();
    await b.goto(`/p/jebel-ali/tenders/${rfxId}/bid?step=3`);
    await settle(b);
    await b.getByTestId("confirm-submit").check();
    await b.getByTestId("submit-bid").click();
    await expect(b.getByText(/Bid revised/)).toBeVisible();
    expect(one<{ revision: number }>("select revision from rfx_bids b join subcontractors s on s.id = b.subcontractor_id where b.rfx_id = ? and s.portal_slug = 'jebel-ali'", rfxId).revision).toBe(2);
    expect(one<{ c: number }>("select count(*) c from rfx_bid_history h join rfx_bids b on b.id = h.bid_id where b.rfx_id = ?", rfxId).c).toBe(1);
  });

  test("4. a late bid after 'Close bidding now' is refused on the server, with a clear message", async () => {
    const c = sup["dubai-sands"];
    await c.goto(`/p/dubai-sands/tenders/${rfxId}`);
    await settle(c);
    await c.getByTestId("ack-addendum").click();
    await expect(c.getByTestId("addendum")).toContainText("Acknowledged");
    await prepareBid(c, "dubai-sands", rfxId, 1.2);
    await c.goto(`/p/dubai-sands/tenders/${rfxId}/bid?step=3`); // stays open: the page is stale after the close
    await settle(c);
    await expect(c.getByTestId("checklist")).toContainText("Every mandatory item is present");
    await c.getByTestId("confirm-submit").check();
    await proc.goto(`/procurement/${rfxId}`);
    await settle(proc);
    await proc.getByTestId("close-bidding").click();
    await expect.poll(() => one<{ status: string }>("select status from rfx_tenders where id = ?", rfxId).status).toBe("closed");
    await c.getByTestId("submit-bid").click();
    await expect(c.getByText(/Bidding is closed. Late bids are not accepted/).first()).toBeVisible();
    expect(one<{ status: string }>("select b.status from rfx_bids b join subcontractors s on s.id = b.subcontractor_id where b.rfx_id = ? and s.portal_slug = 'dubai-sands'", rfxId).status).toBe("late_refused");
    // read-only after closing + a clear message for a supplier that never started
    await c.goto(`/p/dubai-sands/tenders/${rfxId}/bid?step=1`);
    await expect(c.getByTestId("deadline")).toContainText(/closed/i);
  });

  test("5. before the opening the internal pages show no bidder, no content and no prices", async () => {
    const names = SUPPLIERS.map((s) => s.name);
    await proc.goto(`/procurement/${rfxId}?tab=opening`);
    await settle(proc);
    await expect(proc.getByTestId("sealed-note")).toBeVisible();
    await expect(proc.getByTestId("bid-register-row")).toHaveCount(2);
    const body = await proc.locator("main, body").first().innerText();
    for (const n of names) expect(body).not.toContain(n);
    const totals = q<{ total_amount: number }>("select total_amount from rfx_bids where rfx_id = ? and status = 'submitted'", rfxId).map((r) => r.total_amount);
    for (const t of totals) expect(body.replace(/,/g, "")).not.toContain(String(Math.round(t)));
    for (const tab of ["comparison", "evaluation"]) { await proc.goto(`/procurement/${rfxId}?tab=${tab}`); await settle(proc); await expect(proc.getByTestId("sealed-note")).toBeVisible(); }
    // the files API enforces the same rule: a bid attachment is not served to internal users before the opening
    const att = one<{ id: number }>("select a.id from attachments a join rfx_bids b on b.id = a.entity_id where a.entity_type = 'rfx_bid' and b.rfx_id = ? limit 1", rfxId).id;
    expect((await proc.request.get(`/api/files/${att}`)).status()).toBe(403);
    // a competitor never gets it either
    const ownerOf = one<{ slug: string }>("select s.portal_slug slug from attachments a join rfx_bids b on b.id = a.entity_id join subcontractors s on s.id = b.subcontractor_id where a.id = ?", att).slug;
    const other = SUPPLIERS.find((s) => s.slug !== ownerOf)!;
    expect((await sup[other.slug].request.get(`/api/files/${att}`)).status()).toBe(403);
    expect((await sup[ownerOf].request.get(`/api/files/${att}`)).status()).toBe(200);
  });

  test("6. open (secretary), evaluate (committee member scores), compare", async () => {
    await proc.goto(`/procurement/${rfxId}?tab=opening`);
    await settle(proc);
    await proc.locator("[name=minutes]").fill("Two bids received before the closing time.");
    await proc.getByTestId("record-opening").click();
    await expect.poll(() => one<{ status: string }>("select status from rfx_tenders where id = ?", rfxId).status, { timeout: 20_000 }).toBe("opening");
    await proc.reload();
    await expect(proc.getByTestId("bid-register-row").first()).toContainText(/Al Marmoom|Jebel Ali/);
    await proc.getByTestId("start-evaluation").click();
    await expect.poll(() => one<{ status: string }>("select status from rfx_tenders where id = ?", rfxId).status).toBe("evaluation");
    // the secretary declares no conflict of interest, then marks the compliance gate
    await proc.goto(`/procurement/${rfxId}?tab=evaluation`);
    await settle(proc);
    await proc.getByTestId("declare-coi").click();
    await expect.poll(() => one<{ d: string | null }>("select coi_declared_at d from rfx_committee c join users u on u.id = c.user_id where c.rfx_id = ? and u.email = 'rashid.al.mazrouei@alnoor.demo'", rfxId).d).not.toBeNull();
    await proc.reload();
    await settle(proc);
    const marked = () => one<{ c: number }>("select count(*) c from rfx_bid_responses x join rfx_bids b on b.id = x.bid_id where b.rfx_id = ? and x.compliant = 1", rfxId).c;
    const n = await proc.getByTestId("mark-compliant").count();
    expect(n).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < n; i++) {
      const before = marked();
      await proc.getByTestId("mark-compliant").nth(i).click();
      await expect.poll(marked, { timeout: 15_000 }).toBeGreaterThanOrEqual(Math.min(before + 1, n));
      await settle(proc);
    }
    await expect.poll(() => one<{ c: number }>("select count(*) c from rfx_bids where rfx_id = ? and status = 'qualified'", rfxId).c, { timeout: 20_000 }).toBe(2);
    await proc.goto(`/procurement/${rfxId}?tab=comparison`);
    await settle(proc);
    await expect(proc.getByTestId("comparison-sheet")).toBeVisible();
    await expect(proc.getByTestId("rank-row").first()).toContainText("Al Marmoom"); // lowest compliant price wins
    const w = await proc.getByTestId("comparison-sheet").boundingBox();
    expect(w?.width).toBeGreaterThan(300);
  });

  test("7. recommend, submit the award; the recommender cannot approve; approvals create the assignment", async () => {
    await proc.goto(`/procurement/${rfxId}?tab=award`);
    await settle(proc);
    await proc.getByTestId("recommend").click();
    await expect.poll(() => one<{ status: string }>("select status from rfx_tenders where id = ?", rfxId).status).toBe("recommended");
    await proc.reload();
    await proc.getByTestId("submit-award").click();
    await expect.poll(() => one<{ status: string }>("select status from rfx_tenders where id = ?", rfxId).status, { timeout: 20_000 }).toBe("award_pending");
    const rec = one<{ recommended_by: number }>("select recommended_by from rfx_tenders where id = ?", rfxId).recommended_by;
    const first = one<{ assignee_user_id: number }>("select t.assignee_user_id from approval_tasks t join approval_requests r on r.id = t.request_id where r.document_type = 'rfx_award' and r.document_id = ? and t.status = 'pending'", rfxId);
    expect(first.assignee_user_id).not.toBe(rec);
    const who: string[] = [];
    await approveAll("rfx_award", who);
    expect(who.length).toBeGreaterThanOrEqual(2);
    const r = one<{ status: string; assignment_id: number; award_value: number; awarded_bid_id: number }>("select status, assignment_id, award_value, awarded_bid_id from rfx_tenders where id = ?", rfxId);
    expect(r.status).toBe("awarded");
    const a = one<{ source: string; rfx_id: number; rfx_bid_id: number; contract_value: number; status: string; project_id: number; stage_id: number; portal_token: string; code: string; subcontractor_id: number }>("select * from assignments where id = ?", r.assignment_id);
    expect(a).toMatchObject({ source: "tender", rfx_id: rfxId, rfx_bid_id: r.awarded_bid_id, status: "active", project_id: 1, stage_id: stageId });
    expect(a.contract_value).toBeCloseTo(r.award_value, 2);
    expect(a.portal_token).toBeTruthy();
    expect(a.code).toMatch(/^SC-\d{3}$/);
    expect(one<{ currency: string; contract_value_usd: number }>("select currency, contract_value_usd from assignments where id = ?", r.assignment_id)).toMatchObject({ currency: "AED" });
    expect(one<{ c: number }>("select count(*) c from rfx_bids where rfx_id = ? and status = 'awarded'", rfxId).c).toBe(1);
    expect(one<{ c: number }>("select count(*) c from email_outbox where related_id = ? and template = 'award_letter'", rfxId).c).toBe(1);
    expect(one<{ c: number }>("select count(*) c from email_outbox where related_id = ? and template = 'regret'", rfxId).c).toBeGreaterThanOrEqual(1);
    await internalLogin(proc, "rashid.al.mazrouei@alnoor.demo");
    await proc.goto("/projects/1?tab=subcontracts");
    await settle(proc);
    const row = proc.locator("tbody tr", { hasText: a.code }).first();
    await expect(row.getByTestId("asg-source")).toContainText(code);
    await proc.goto("/projects/1?tab=stages");
    await expect(proc.getByTestId("stage-tender-chip").filter({ hasText: `Awarded via ${code}` })).toBeVisible();
  });

  test("8. the winner sees Awarded + the Letter of Award, the loser Not successful, with no competitor data", async () => {
    const win = one<{ slug: string }>("select s.portal_slug slug from rfx_bids b join subcontractors s on s.id = b.subcontractor_id where b.rfx_id = ? and b.status = 'awarded'", rfxId).slug;
    const lose = SUPPLIERS.map((s) => s.slug).filter((s) => s !== win);
    const w = sup[win];
    await w.goto(`/p/${win}/tenders/${rfxId}`);
    await settle(w);
    await expect(w.getByTestId("award-banner")).toContainText("Awarded");
    const loa = await w.request.get(`/p/${win}/tenders/${rfxId}/loa`);
    expect(loa.status()).toBe(200);
    expect(loa.headers()["content-type"]).toContain("application/pdf");
    expect((await loa.body()).subarray(0, 4).toString()).toBe("%PDF");
    // the portal Projects list and the subcontract detail show the tender source
    await w.goto(`/p/${win}/projects`);
    await settle(w);
    await expect(w.locator("tbody tr", { hasText: "Awarded via tender" }).getByTestId("asg-source").filter({ hasText: code }).first()).toBeVisible();
    await w.locator("tbody tr", { hasText: code }).getByRole("link").first().click();
    await w.waitForURL(/\/projects\/\d+/);
    await expect(w.getByTestId("asg-source")).toContainText(`Awarded via tender ${code}`);
    await w.goto(`/p/${win}/tenders?tab=awarded`);
    await expect(w.getByTestId("portal-tender-row").filter({ hasText: code })).toBeVisible();
    const winnerName = SUPPLIERS.find((s) => s.slug === win)!.name;
    for (const l of lose) {
      const p = sup[l];
      await p.goto(`/p/${l}/tenders/${rfxId}`);
      await settle(p);
      await expect(p.getByTestId("result-banner")).toContainText("Not successful");
      const body = await p.locator("body").innerText();
      expect(body).not.toContain(winnerName);
      expect(body).not.toMatch(/Letter of Award/i);
      const price = one<{ total_amount: number }>("select total_amount from rfx_bids where rfx_id = ? and status = 'awarded'", rfxId).total_amount;
      expect(body.replace(/,/g, "")).not.toContain(String(Math.round(price)));
      expect((await p.request.get(`/p/${l}/tenders/${rfxId}/loa`)).status()).toBe(403);
    }
    expect(one<{ c: number }>("select count(*) c from email_outbox where related_id = ? and template = 'regret'", rfxId).c).toBe(1); // the refused late bid is not a bidder
  });

  test("9. direct assignment still works unchanged (source direct)", async () => {
    await internalLogin(proc, "admin@alnoor.demo", "Admin@12345");
    await proc.goto("/projects/2?tab=subcontracts");
    await settle(proc);
    await expect(proc.getByTestId("float-tender")).toBeVisible();
    await proc.getByRole("button", { name: "Assign directly" }).click();
    const modal = proc.locator("div.fixed.inset-0").last();
    await modal.locator("[name=subcontractor_id]").selectOption({ index: 1 });
    await modal.locator("[name=scope]").fill(`E2E direct assignment ${STAMP}`);
    await modal.locator("[name=contract_value]").fill("123456");
    await modal.locator("[name=stage_id]").selectOption({ index: 1 });
    await modal.getByRole("button", { name: "Create subcontract" }).click();
    await expect.poll(() => one<{ source: string; rfx_id: number | null }>("select source, rfx_id from assignments where scope = ?", `E2E direct assignment ${STAMP}`)?.source).toBe("direct");
    expect(one<{ rfx_id: number | null; rfx_bid_id: number | null }>("select rfx_id, rfx_bid_id from assignments where scope = ?", `E2E direct assignment ${STAMP}`)).toEqual({ rfx_id: null, rfx_bid_id: null });
  });

  test("10. layout at 1024 / 1280: no horizontal overflow on the new pages; portal pages too", async ({ browser }) => {
    for (const width of [1024, 1280]) {
      const p = await fresh(browser, width);
      await internalLogin(p, "admin@alnoor.demo", "Admin@12345");
      for (const u of ["/procurement", `/procurement/${rfxId}`, `/procurement/${rfxId}?tab=comparison`, `/procurement/${rfxId}?tab=evaluation`, `/procurement/${rfxId}?tab=award`, "/procurement/new?project=1", "/procurement/setup/templates", "/procurement/setup/templates/1", "/"]) {
        await p.goto(u);
        await settle(p);
        const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        expect(o.sw, `${u} at ${width}`).toBeLessThanOrEqual(o.iw + 1);
      }
      const draft = one<{ id: number }>("select id from rfx_tenders where status = 'draft' and entity_id = 1 limit 1");
      if (draft) { await p.goto(`/procurement/${draft.id}/edit`); await settle(p); const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); expect(o.sw, `edit at ${width}`).toBeLessThanOrEqual(o.iw + 1); }
      await p.context().close();
      const s = await fresh(browser, width);
      await supplierLogin(s, "al-marmoom");
      for (const u of ["/p/al-marmoom/tenders", `/p/al-marmoom/tenders/${rfxId}`, `/p/al-marmoom/tenders/${rfxId}/bid?step=2`, `/p/al-marmoom/tenders/${rfxId}/bid?step=3`]) {
        await s.goto(u);
        await settle(s);
        const o = await s.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        expect(o.sw, `${u} at ${width}`).toBeLessThanOrEqual(o.iw + 1);
      }
      await s.context().close();
    }
  });

  test("no console errors or hydration warnings", () => { expect(problems).toEqual([]); });
});
