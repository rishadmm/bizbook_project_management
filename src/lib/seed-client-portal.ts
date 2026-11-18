/* eslint-disable @typescript-eslint/no-explicit-any */
// Demo data for the client portal (CLIENT_PORTAL_SPEC section 4): slugs, portal users per client with projects (password Portal@123), auth history,
// verified site photos for the "recent progress" feed and the gallery. Called from seed.ts. Relative imports only (runs under tsx).
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { DEMO_CLIENT_PASSWORD, insertClientUser } from "./client-portal-core";
import { getRegionProfile } from "./seed-regions";

interface Ctx { today: string; uploads: string; admin: number; /** only this country's clients are seeded */ entityId: number; /** document prefix of the country (project codes in the profile are unprefixed) */ prefix: string }
const SVG = (label: string, hue: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,82%)"/><stop offset="1" stop-color="hsl(${hue},25%,92%)"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><rect y="270" width="640" height="150" fill="#94a3b8"/><rect x="40" y="236" width="560" height="26" fill="#475569"/><rect x="120" y="150" width="90" height="86" fill="#f59e0b"/><rect x="210" y="190" width="120" height="14" fill="#f59e0b"/><circle cx="540" cy="80" r="36" fill="#fbbf24"/><text x="24" y="44" font-family="sans-serif" font-size="22" fill="#0f172a">${label}</text></svg>`;

export interface ClientSeedResult { rows: { client: string; slug: string | null; enabled: boolean; admin: string | null; note: string }[] }

export function seedClientPortal(db: DB, c: Ctx): ClientSeedResult {
  const P = getRegionProfile().clientPortal;
  const CFG = P.cfg;
  const iso = (daysAgo: number, hh = 8, mm = 0) => { const d = new Date(Date.now() - daysAgo * 86_400_000); d.setUTCHours(hh, mm, 0, 0); return d.toISOString(); };
  const all = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
  const one = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as any[])) as T | undefined;
  const ev = (clientId: number, userId: number | null, email: string | null, event: string, daysAgo: number, detail: string | null = null, hh = 8, mm = 0, ip = "10.40.2.31") =>
    db.prepare("INSERT INTO client_auth_events(client_id, client_user_id, email, event, ip, user_agent, detail, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(clientId, userId, email, event, ip, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", detail, iso(daysAgo, hh, mm));
  const adminName = one<{ name: string }>("SELECT name FROM users WHERE id = ?", c.admin)?.name ?? "Administrator";
  const rows: ClientSeedResult["rows"] = [];

  const localIdx = new Map(all<{ id: number }>("SELECT id FROM clients WHERE entity_id = ? ORDER BY id", c.entityId).map((r, i) => [r.id, i + 1]));
  for (const cl of all<{ id: number; name: string; email: string | null }>("SELECT id, name, email FROM clients WHERE entity_id = ? ORDER BY id", c.entityId)) {
    const cfg = CFG[localIdx.get(cl.id)!]; // the profile config is keyed by the client's 1-based position within its country
    const projects = all<{ id: number; code: string }>("SELECT id, code FROM projects WHERE client_id = ? ORDER BY id", cl.id);
    if (!cfg || projects.length === 0) { rows.push({ client: cl.name, slug: null, enabled: false, admin: null, note: "no projects: no portal" }); continue; }
    db.prepare("UPDATE clients SET portal_slug = ?, portal_enabled = 1, portal_show_subcontractors = ?, portal_show_financials = ? WHERE id = ?").run(cfg.slug, cfg.showSubs === false ? 0 : 1, cfg.showFin === false ? 0 : 1, cl.id);
    const domain = (cl.email ?? `x@${P.defaultDomain}`).split("@")[1] ?? P.defaultDomain;
    let adminEmail: string | null = null;
    cfg.users.forEach((u, k) => {
      const local = u.name.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter((w, i, a) => i === 0 || i === a.length - 1).join(".");
      const email = `${local}@${domain}`;
      const created = iso(45 - k * 4 - cl.id);
      const scope = u.scopeCode ? projects.filter((p) => p.code === c.prefix + u.scopeCode).map((p) => p.id) : null;
      const id = insertClientUser(db, { clientId: cl.id, name: u.name, email, jobTitle: u.title, phone: P.phone(localIdx.get(cl.id)!, k), role: u.role, password: DEMO_CLIENT_PASSWORD,
        mustChange: u.state === "must_change", createdBy: c.admin, createdAt: created, status: u.state === "disabled" ? "disabled" : "active", scope });
      if (u.role === "admin" && !adminEmail) adminEmail = email;
      ev(cl.id, id, email, "user_created", 45 - k * 4 - cl.id, `Created by ${adminName} (${u.role})`, 9, 10 + k);
      const upd = db.prepare("UPDATE client_users SET last_login_at = ?, previous_login_at = ?, failed_attempts = 0, locked_until = NULL, password_changed_at = ? WHERE id = ?");
      if (u.state === "must_change") { upd.run(null, null, null, id); ev(cl.id, id, email, "password_reset", 2, `Temporary password issued by ${adminName}`, 10, 5); return; }
      if (u.state === "disabled") { upd.run(iso(10), iso(14), created, id); ev(cl.id, id, email, "login_success", 10, null, 7, 40); ev(cl.id, id, email, "user_disabled", 7, `Disabled by ${adminName} (left the project)`, 11, 20); return; }
      const recent = (k + cl.id) % 3, before = 4 + ((k * 2 + cl.id) % 6);
      upd.run(iso(recent, 6 + (k % 5), 20 + k), iso(before, 7, 15), created, id);
      ev(cl.id, id, email, "password_changed", 43 - k - cl.id, null, 8, 5);
      for (let n = 0; n < 5; n++) ev(cl.id, id, email, "login_success", recent + n * 2 + (n ? 1 : 0), n === 1 ? "Remembered session" : null, 5 + ((n + k) % 6), 10 + n * 7);
      if ((k + cl.id) % 3 === 1) ev(cl.id, id, email, "login_failed", before, "bad password (1)", 7, 11);
      if (k === 0) ev(cl.id, id, email, "logout", recent, null, 15, 40);
    });
    rows.push({ client: cl.name, slug: cfg.slug, enabled: true, admin: adminEmail, note: cfg.note });

    // verified site photos on recent verified reports (feed + gallery + monthly report)
    const reps = all<any>(`SELECT r.id, r.report_date, r.project_id, st.name sname, p.code FROM progress_reports r JOIN projects p ON p.id = r.project_id LEFT JOIN stages st ON st.id = r.stage_id
      WHERE r.status = 'verified' AND p.client_id = ? AND r.quantity_done > 0 ORDER BY r.report_date DESC, r.id DESC LIMIT 140`, cl.id);
    const perProject = new Map<number, number>();
    reps.forEach((r, i) => {
      const n = perProject.get(r.project_id) ?? 0;
      if (n >= 7 || i % 4 !== 0) return;
      perProject.set(r.project_id, n + 1);
      const filename = `site-${r.code}-${r.report_date}.svg`;
      const stored = `seed-${nanoid(8)}-${filename}`;
      const content = SVG(`${r.code} · ${r.sname ?? "site"} · ${r.report_date}`, (r.project_id * 47 + n * 13) % 360);
      fs.writeFileSync(path.join(c.uploads, stored), content);
      db.prepare("INSERT INTO attachments(entity_type, entity_id, category, filename, stored_path, mime, size, uploaded_by, note, created_at) VALUES ('progress',?,?,?,?,?,?,NULL,?,?)")
        .run(r.id, "Photos", filename, stored, "image/svg+xml", Buffer.byteLength(content), "Site photo", `${r.report_date} 10:30:00`);
    });
  }
  return { rows };
}
