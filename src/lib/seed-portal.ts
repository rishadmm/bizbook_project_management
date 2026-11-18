/* eslint-disable @typescript-eslint/no-explicit-any */
// Demo data for the subcontractor login portal (PORTAL_SPEC section 4): slugs, portal users per approved company (password Portal@123), auth history,
// portal-submitted progress (incl. rejected awaiting resubmission), portal-raised issues with comment threads, documents pending review, a change request.
// Called from seed.ts. Relative imports only (runs under tsx).
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { addDays } from "./format";
import { DEMO_PORTAL_PASSWORD, insertPortalUser, uniqueSlug } from "./portal-core";
import { getRegionProfile } from "./seed-regions";

interface Ctx { today: string; uploads: string; admin: number; clerk: number; /** only this country's subcontractors are seeded */ entityId: number }
const SVG = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="#e2e8f0"/><rect y="250" width="640" height="170" fill="#94a3b8"/><rect x="40" y="220" width="560" height="26" fill="#475569"/><circle cx="520" cy="80" r="38" fill="#fbbf24"/><text x="24" y="44" font-family="sans-serif" font-size="22" fill="#0f172a">${label}</text></svg>`;

export interface PortalSeedResult { slugs: { sub: string; slug: string; owner: string | null; enabled: boolean }[] }

export function seedPortal(db: DB, c: Ctx): PortalSeedResult {
  const P = getRegionProfile().portal;
  const TEAMS = P.teams;
  const iso = (daysAgo: number, hh = 8, mm = 0) => { const d = new Date(Date.now() - daysAgo * 86_400_000); d.setUTCHours(hh, mm, 0, 0); return d.toISOString(); };
  const one = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).get(...(a as any[])) as T | undefined;
  const all = <T = any>(sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as any[])) as T[];
  const file = (entity: string, id: number, category: string, filename: string, content: string, mime: string, uploader: string, daysAgo: number) => {
    const stored = `seed-${nanoid(8)}-${filename}`;
    fs.writeFileSync(path.join(c.uploads, stored), content);
    return Number(db.prepare("INSERT INTO attachments(entity_type, entity_id, category, filename, stored_path, mime, size, uploaded_by, note, created_at) VALUES (?,?,?,?,?,?,?,NULL,?,?)")
      .run(entity, id, category, filename, stored, mime, Buffer.byteLength(content), `Uploaded via portal by ${uploader}`, iso(daysAgo).replace("T", " ").slice(0, 19)).lastInsertRowid);
  };
  const ev = (subId: number, userId: number | null, email: string | null, event: string, daysAgo: number, detail: string | null = null, hh = 8, mm = 0, ip = "10.30.8.14") =>
    db.prepare("INSERT INTO portal_auth_events(subcontractor_id, portal_user_id, email, event, ip, user_agent, detail, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(subId, userId, email, event, ip, "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36", detail, iso(daysAgo, hh, mm));

  // 1. slugs for every subcontractor (approved ones are enabled below)
  // 1-based position of each subcontractor within its country: the profile's portal teams / phones are keyed by it (equals the id in the first region)
  const subPos = new Map(all<{ id: number }>("SELECT id FROM subcontractors WHERE entity_id = ? ORDER BY id", c.entityId).map((r, i) => [r.id, i + 1]));
  for (const s of all<{ id: number; name: string }>("SELECT id, name FROM subcontractors WHERE entity_id = ? ORDER BY id", c.entityId)) db.prepare("UPDATE subcontractors SET portal_slug = ? WHERE id = ?").run(uniqueSlug(db, s.name, s.id), s.id);

  const adminName = one<{ name: string }>("SELECT name FROM users WHERE id = ?", c.admin)?.name ?? "Administrator";
  const emails = new Map<number, { owner: string; site?: string; accounts?: string }>();
  const userIds = new Map<string, number>(); // `${subId}:${role}` -> id of the first user with that role
  const subs = all<{ id: number; name: string; email: string; contact_person: string }>("SELECT id, name, email, contact_person FROM subcontractors WHERE entity_id = ? AND status = 'approved' ORDER BY id", c.entityId);
  subs.forEach((s, idx) => {
    db.prepare("UPDATE subcontractors SET portal_enabled = 1 WHERE id = ?").run(s.id);
    const team = TEAMS[subPos.get(s.id)!] ?? TEAMS[(idx % 7) + 1];
    const domain = s.email.split("@")[1] ?? P.defaultDomain;
    team.forEach((u, k) => {
      const name = u.name || s.contact_person;
      const local = name.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter((w, i, a) => i === 0 || i === a.length - 1).join(".");
      const email = `${local}@${domain}`;
      const created = iso(60 - k * 3 - idx);
      const id = insertPortalUser(db, { subcontractorId: s.id, name, email, jobTitle: u.title, phone: P.phone(subPos.get(s.id)!, k), role: u.role, password: DEMO_PORTAL_PASSWORD,
        mustChange: u.state === "must_change", createdBy: c.admin, createdAt: created, status: u.state === "disabled" ? "disabled" : "active" });
      userIds.set(`${s.id}:${u.role}`, userIds.get(`${s.id}:${u.role}`) ?? id);
      if (u.role === "owner") emails.set(s.id, { ...(emails.get(s.id) ?? { owner: email }), owner: email });
      const upd = db.prepare("UPDATE portal_users SET last_login_at = ?, previous_login_at = ?, failed_attempts = ?, locked_until = ?, password_changed_at = ? WHERE id = ?");
      ev(s.id, id, email, "user_created", 60 - k * 3 - idx, `Created by ${adminName} (${u.role})`, 9, 10 + k);
      if (u.state === "must_change") { upd.run(null, null, 0, null, null, id); ev(s.id, id, email, "password_reset", 2, `Temporary password issued by ${adminName}`, 10, 5); return; }
      const recent = (k + idx) % 3, before = 4 + ((k * 2 + idx) % 6);
      if (u.state === "disabled") { upd.run(iso(12), iso(15), 0, null, created, id); ev(s.id, id, email, "login_success", 12, null, 7, 40); ev(s.id, id, email, "user_disabled", 9, `Disabled by ${adminName} (left the company)`, 11, 20); return; }
      if (u.state === "locked") {
        upd.run(iso(6), iso(9), 5, new Date(Date.now() + 6 * 3_600_000).toISOString(), created, id);
        for (let n = 0; n < 5; n++) ev(s.id, id, email, "login_failed", 0, `bad password (${n + 1})`, 6, 12 + n, "82.114.37.9");
        ev(s.id, id, email, "locked", 0, "locked for 15 minutes", 6, 17, "82.114.37.9");
        return;
      }
      upd.run(iso(recent, 6 + (k % 5), 20 + k), iso(before, 7, 15), 0, null, created, id);
      ev(s.id, id, email, "password_changed", 58 - k - idx, null, 8, 5);
      for (let n = 0; n < 5; n++) ev(s.id, id, email, "login_success", recent + n * 2 + (n ? 1 : 0), n === 1 ? "Remembered session" : null, 5 + ((n + k) % 6), 10 + n * 7);
      if ((k + idx) % 4 === 1) ev(s.id, id, email, "login_failed", before, "bad password (1)", 7, 11);
      if (k === 0 && idx % 2 === 0) ev(s.id, id, email, "logout", recent, null, 15, 40);
    });
  });

  // 2. portal-submitted progress: one pending report per company, a rejected one awaiting resubmission for a few companies
  const activeAsg = (subId: number) => all<any>("SELECT * FROM assignments WHERE subcontractor_id = ? AND status = 'active' AND quantity > 0 ORDER BY id", subId);
  const prior = (aid: number) => (one<{ q: number }>("SELECT COALESCE(SUM(quantity_done),0) q FROM progress_reports WHERE assignment_id = ? AND status <> 'rejected'", aid)?.q ?? 0);
  const insertReport = (a: any, who: string, userId: number | null, daysAgo: number, share: number, status: "submitted" | "rejected", reason: string | null, photo: boolean) => {
    const remaining = Math.max(0, a.quantity - prior(a.id));
    const qty = Math.round(Math.min(remaining * 0.5, a.quantity * share) * 100) / 100;
    if (qty <= 0) return;
    const cum = prior(a.id) + qty, date = addDays(c.today, -daysAgo);
    const crew = 9 + ((a.id * 7) % 14);
    const rid = Number(db.prepare(`INSERT INTO progress_reports(assignment_id, stage_id, project_id, report_date, quantity_done, cumulative_quantity, percent_complete, manpower_count, man_hours, equipment_used, work_done, issues,
      delay_days, delay_cause, delay_responsibility, source, status, reject_reason, submitted_by_name, portal_user_id, weather, verified_by, verified_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,'none','portal',?,?,?,?,?,?,?,?)`).run(a.id, a.stage_id, a.project_id, date, qty, cum, Math.min(100, (cum / a.quantity) * 100), crew, crew * 9,
      "1 excavator, 2 tipper trucks", status === "rejected" ? "Backfill and compaction of the trench section" : "Excavation and installation progressed as per the programme; traffic management in place.",
      status === "rejected" ? "Weather" : null, status, reason, who, userId, "Hot / humid", status === "rejected" ? c.clerk : null, status === "rejected" ? iso(daysAgo - 1 < 0 ? 0 : daysAgo - 1).replace("T", " ").slice(0, 19) : null, iso(daysAgo, 12, 30).replace("T", " ").slice(0, 19)).lastInsertRowid);
    db.prepare("INSERT INTO progress_manpower(progress_report_id, trade, headcount, hours) VALUES (?,?,?,?)").run(rid, "Labour", Math.ceil(crew * 0.6), Math.ceil(crew * 0.6) * 9);
    db.prepare("INSERT INTO progress_manpower(progress_report_id, trade, headcount, hours) VALUES (?,?,?,?)").run(rid, "Operators", crew - Math.ceil(crew * 0.6), (crew - Math.ceil(crew * 0.6)) * 9);
    db.prepare("INSERT INTO progress_materials(progress_report_id, material, unit, quantity, unit_cost) VALUES (?,?,?,?,0)").run(rid, "Sand bedding", "m3", Math.round(qty * 40));
    if (photo) file("progress", rid, "Photos", `site-photo-${date}.svg`, SVG(`${a.code} · ${date}`), "image/svg+xml", who, daysAgo);
    db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES ('progress',?,?,?,NULL,?)").run(rid, status === "rejected" ? "rejected" : "submitted", `Progress report ${date} ${status === "rejected" ? `rejected: ${reason}` : "submitted via portal"} (${who})`, iso(daysAgo, 12, 31).replace("T", " ").slice(0, 19));
  };
  const siteUser = (subId: number) => one<{ id: number; name: string }>("SELECT id, name FROM portal_users WHERE subcontractor_id = ? AND portal_role = 'site' AND status = 'active' ORDER BY id LIMIT 1", subId) ?? one<{ id: number; name: string }>("SELECT id, name FROM portal_users WHERE subcontractor_id = ? ORDER BY id LIMIT 1", subId)!;
  subs.forEach((s, idx) => {
    const asg = activeAsg(s.id);
    if (!asg.length) return;
    const u = siteUser(s.id);
    insertReport(asg[0], u.name, u.id, 1, 0.012, "submitted", null, idx % 2 === 0);
    if ([1, 3, 6].includes(idx)) insertReport(asg[asg.length - 1], u.name, u.id, 3, 0.01, "rejected", ["Quantity does not match the joint measurement of that day. Please re-measure and correct.", "Photos missing for the reinstated section. Attach photos and resubmit.", "Report date overlaps an existing report for this section."][[1, 3, 6].indexOf(idx)], false);
  });

  // 3. portal-raised issues / RFIs with comment threads
  const pmName = (projectId: number) => one<{ name: string }>("SELECT u.name FROM projects p JOIN users u ON u.id = p.manager_id WHERE p.id = ?", projectId)?.name ?? "Project team";
  const comment = (issueId: number, type: "portal" | "internal", name: string, authorId: number | null, body: string, daysAgo: number, hh: number) =>
    db.prepare("INSERT INTO issue_comments(issue_id, author_type, author_id, author_name, body, created_at) VALUES (?,?,?,?,?,?)").run(issueId, type, authorId, name, body, iso(daysAgo, hh, 15));
  const issue = (subIdx: number, kind: "issue" | "rfi", title: string, desc: string, category: string, resp: string, raised: number, status: "open" | "mitigating" | "closed", awaiting: "internal" | "portal" | null, thread: [boolean, string, number][]) => {
    const s = subs[subIdx];
    if (!s) return;
    const a = all<any>("SELECT * FROM assignments WHERE subcontractor_id = ? AND status = 'active' ORDER BY id", s.id)[0];
    if (!a) return;
    const u = siteUser(s.id);
    const last = thread.length ? thread[thread.length - 1][2] : raised;
    const id = Number(db.prepare(`INSERT INTO issues(project_id, stage_id, assignment_id, title, description, responsibility, impact_days, impact_cost, status, raised_on, resolved_on, source, kind, category,
      raised_by_name, raised_by_portal_user, awaiting_party, last_activity_at) VALUES (?,?,?,?,?,?,0,0,?,?,?,'portal',?,?,?,?,?,?)`).run(a.project_id, a.stage_id, a.id, title, desc, resp, status, addDays(c.today, -raised),
      status === "closed" ? addDays(c.today, -Math.max(0, last)) : null, kind, category, u.name, u.id, awaiting, iso(last, 11, 15)).lastInsertRowid);
    for (const [fromPortal, body, d] of thread) comment(id, fromPortal ? "portal" : "internal", fromPortal ? u.name : pmName(a.project_id), fromPortal ? u.id : null, body, d, fromPortal ? 8 : 14);
    if (kind === "issue") file("issue", id, "Portal", `issue-photo-${id}.svg`, SVG(title.slice(0, 40)), "image/svg+xml", u.name, raised);
    db.prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id, created_at) VALUES ('project',?,?,?,NULL,?)").run(a.project_id, "issue", `${kind === "rfi" ? "RFI" : "Issue"} "${title}" raised via portal by ${u.name} (${a.code})`, iso(raised, 8, 20).replace("T", " ").slice(0, 19));
  };
  for (const x of P.issues) issue(x.sub, x.kind, x.title, x.desc, x.category, x.resp, x.raised, x.status, x.awaiting, x.thread);

  // 4. documents uploaded through the portal waiting for review
  const doc = (subIdx: number, type: string, ref: string, issued: number, expiry: number, daysAgo: number) => {
    const s = subs[subIdx];
    if (!s) return;
    const u = one<{ name: string }>("SELECT name FROM portal_users WHERE subcontractor_id = ? AND portal_role IN ('accounts','owner') AND status = 'active' ORDER BY (portal_role = 'accounts') DESC, id LIMIT 1", s.id)!;
    const att = file("subcontractor", s.id, type, `${type}-renewal-${s.id}.txt`, `Renewed ${type.replace(/_/g, " ")} for ${s.name}\n(placeholder document uploaded via portal)`, "text/plain", u.name, daysAgo);
    db.prepare("INSERT INTO subcontractor_documents(subcontractor_id, doc_type, ref_no, issue_date, expiry_date, attachment_id, status, source, uploaded_by_name, created_at) VALUES (?,?,?,?,?,?,'pending_review','portal',?,?)")
      .run(s.id, type, ref, addDays(c.today, issued), addDays(c.today, expiry), att, u.name, iso(daysAgo, 10).replace("T", " ").slice(0, 19));
  };
  doc(1, "insurance", "INS-2026-RENEW-0412", -2, 363, 2);
  doc(3, "iso", "ISO9001-2026-8815", -5, 1090, 5);
  doc(0, "company_profile", "PROFILE-2026", -1, 700, 1);

  // 5. change requests: one pending bank change, one decided contact change
  const falcon = subs[3], desert = subs[0];
  if (falcon) db.prepare("INSERT INTO portal_change_requests(subcontractor_id, requested_by, requested_by_name, kind, payload, reason, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)")
    .run(falcon.id, userIds.get(`${falcon.id}:owner`) ?? null, falcon.contact_person, "bank", JSON.stringify({ bank_name: P.bankChange.bank_name, iban: P.bankChange.iban }), P.bankChange.reason, iso(1, 9, 30));
  if (desert) db.prepare("INSERT INTO portal_change_requests(subcontractor_id, requested_by, requested_by_name, kind, payload, reason, status, decided_by, decided_at, decision_note, created_at) VALUES (?,?,?,?,?,?, 'approved', ?,?,?,?)")
    .run(desert.id, userIds.get(`${desert.id}:owner`) ?? null, desert.contact_person, "contact", JSON.stringify({ phone: P.contactChange.phone }), P.contactChange.reason, c.clerk, iso(14, 13), "Verified by phone.", iso(15, 9));

  return {
    slugs: all<{ id: number; name: string; portal_slug: string; portal_enabled: number }>("SELECT id, name, portal_slug, portal_enabled FROM subcontractors WHERE entity_id = ? ORDER BY id", c.entityId)
      .map((s) => ({ sub: s.name, slug: s.portal_slug, owner: emails.get(s.id)?.owner ?? null, enabled: !!s.portal_enabled })),
  };
}
