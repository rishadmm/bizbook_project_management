# Subcontractor Portal with credentials (build contract)

Today the portal is a single token page per assignment (`/portal/[token]`). Goal: a **proper, login-based portal per subcontractor company**, with its own URL, users, dashboard, project monitoring, progress updates, invoice submission and more. Internal staff create and manage the credentials from the subcontractor page (`/subcontractors/[id]`).

Read first: THEME_SPEC.md, AUTH_SPEC.md (internal auth patterns to mirror), INVOICE_SPEC.md, DEMO_DATA_SPEC.md, docs/FOUNDATION.md, README.md, the current `src/app/portal/**`, `src/features/portal/**`, `src/lib/auth.ts`, `src/middleware.ts`, `src/app/api/files/[id]/route.ts`, `src/app/(main)/subcontractors/[id]/page.tsx`.

## 1. Identity & security model (separate from internal users)
- New tables (migration, bump SCHEMA_VERSION):
  - `subcontractors.portal_slug` (unique, e.g. `gulf-trench`), `subcontractors.portal_enabled` (0/1).
  - `portal_users`: id, subcontractor_id FK, name, email (unique per sub), phone, job_title, portal_role (`owner` | `manager` | `site` | `accounts` | `viewer`), password_hash (bcrypt), status (`active` | `disabled`), must_change_password, failed_attempts, locked_until, last_login_at, password_changed_at, created_by (internal user id), created_at. Optional `assignment_scope` JSON (null = all of the company's subcontracts).
  - `portal_sessions`: same shape as `sessions` but `portal_user_id`; token stored as SHA-256 hash.
  - `portal_auth_events`: login_success/failed/locked/logout/password_changed/password_reset/user_created/user_disabled/session_revoked, with ip, user agent.
- Cookie `bbp_portal` (httpOnly, sameSite=lax, path `/p`), 12 h session, "Remember me" 30 d, lockout after 5 failures for 15 min, forced password change on first login and after reset. Reuse password policy/helpers from `lib/password.ts`.
- `src/lib/portal-auth.ts`: `getPortalSession()`, `requirePortalUser(slug, perm?)`. **The subcontractor id always comes from the session, never from the URL or form.** If the slug in the URL does not match the session's company, redirect to that company's own portal. Every query/action is filtered by `subcontractor_id` (+ `assignment_scope`); requesting another company's record returns 404.
- Portal role permissions (simple matrix in code): owner = everything incl. team; manager = all but team; site = dashboard, projects, progress, issues, documents (read); accounts = dashboard, projects (read), invoices, statements, certificates, company documents; viewer = read-only.
- Middleware: `/p/` paths are open at the edge (server guards them). Internal session never grants portal access and vice versa.
- Files: `/api/files/[id]` also accepts a valid portal session but only for attachments owned by that company (its assignments' progress reports, invoices, certificates, its own subcontractor documents, documents shared to it). Invoice PDF for portal: `/p/[slug]/invoices/[id]/pdf` (reuse InvoicePdf).
- Legacy `/portal/[token]` links: keep working (quick-update link). Its page shows a banner "Your company now has a full portal — Sign in" linking to `/p/<slug>/login` when the company has portal users.

## 2. Internal side: `/subcontractors/[id]` → new **Portal access** tab
Permission: new action `portal` on module `subcontractors` (add to permissions.ts, role defaults: admin, super admin, procurement/contracts manager roles that already edit subcontractors).
- **Portal URL card**: `http://<host>/p/<slug>` with Copy + Open, slug editable (validated, unique), Enable/Disable portal switch (disabled → login refused with message).
- **Users table**: name, email, role, status, last login, failed attempts/locked, created by/at. Row actions: Reset password, Disable/Enable, Unlock, Sign out all sessions, Edit (role, scope), Delete (if never logged in).
- **Create user** modal: name, email, phone, job title, role, scope (all subcontracts or pick assignments), password = auto-generated strong temp password (with "regenerate") or manual; must change on first login (default on).
- After create/reset: **credentials card** shown once: portal URL, email, temporary password, with "Copy all" (formatted message ready to paste into email/WhatsApp) and a "Print credentials" button; note "Password is shown only once". "Email credentials" button present but disabled with tooltip "Email not configured".
- **Login activity** list (last 20 portal auth events for this company).
- **Open portal as subcontractor** (admins only): read-only impersonation in a new tab with a fixed amber banner "Viewing as <company> — read only · Exit"; all portal actions refused in this mode; audited.
- Subcontractors list page: column/badge "Portal: Active (n users) / Off".

## 3. Portal app `/p/[slug]/...` (BizBook look, own shell)
- **Login `/p/[slug]/login`**: same split layout as the internal login (THEME_SPEC §5) but the left panel says "Subcontractor Portal", shows the **subcontractor's company name** and the client (tenant) name "for Al Noor Infrastructure LLC", benefits list (submit progress, invoices, track payments). Unknown slug → 404. Forgot password → "contact your Al Noor project contact" with the PM's name/phone if available. Forced password change page.
- **Shell**: dark sidebar (as internal) with sub company name + "Subcontractor Portal · BizBook"; nav: Dashboard, Projects, Progress updates, Invoices, Certificates, Payments & statement, Issues & RFIs, Documents, Team (owner), My account. Topbar: company pill, notifications bell (count of action items), user menu. Responsive (mobile-friendly — site staff use phones): sidebar becomes a bottom/off-canvas nav < md.
- **Dashboard**: KPI tiles (active subcontracts, total contract value, work done %, certified, paid, outstanding, retention held); **Action items** (reports due — no report in 7 days on active work; rejected reports to resubmit; invoices returned/rejected; documents expiring ≤30 d or expired; issues awaiting their response); **Schedule health** per subcontract (actual vs planned bar, SPI, planned vs projected finish, slip days, RAG); **mini map** of their sections (reuse ops-map geometry/colours: green on track, amber, red behind, plan tick vs work front); S-curve planned vs actual (recharts); recent activity (verifications, certifications, payments).
- **Projects** → list of their subcontracts; **subcontract detail** `/p/[slug]/projects/[assignmentId]`: header (project, stage, scope, contract value, dates, payment terms, retention), map of their section(s) with plan vs actual, progress history chart (cum qty planned vs actual), required rate vs recent rate ("needs 0.48 km/wk"), manpower chart, quantities table, issues on their scope, documents shared (scope/drawings attachments of the stage/assignment), their invoices and certificates for this subcontract.
- **Progress updates**: list (date, subcontract, qty, %, status submitted/verified/rejected with reason) + **New update** form: subcontract, report date, quantity this period (unit, cumulative shown, guard against exceeding contract qty), manpower by trade (rows), equipment (rows), materials used (rows), weather, remarks, issues encountered (optional → creates an issue with responsibility), **photos/attachments** (multiple, phone camera friendly `accept="image/*"` capture). Rejected reports can be corrected and resubmitted. Creates `progress_reports` with `source='portal'` and the portal user name; appears internally for verification as today.
- **Invoices**: list with status timeline chips (Submitted → Under review → Certified → Approved → Paid; Rejected with reason); **New invoice** (reuse PortalInvoiceForm with line items, VAT, required tax invoice attachment + other categories); **invoice detail** (reuse InvoicePaper read-only, attachments viewer, status timeline, certification remarks visible to the sub, Download PDF). Only `owner/manager/accounts` can submit.
- **Certificates**: list + detail (partial/final completion certificates issued to them), download.
- **Payments & statement**: per subcontract statement of account (contract value, claimed, certified, retention held, advance recovered, paid, outstanding) + payment history (date, invoice, amount, method/ref); export CSV.
- **Issues & RFIs**: list of issues on their scope + issues they raised; raise new issue/RFI (subcontract, title, description, category, responsibility suggestion, impact days, attachments); comment thread both sides (new `issue_comments` table: issue_id, author_type internal|portal, author id/name, body, created_at; internal project Issues tab shows the thread and allows replies).
- **Documents**: company compliance documents (trade licence, insurance, HSE cert, etc.) with expiry status; upload new/renewed document → `subcontractor_documents` with status `pending_review` (internal subcontractor page shows them for approval); company profile read-only, **request change** of bank details/contact (stores a change request shown on the internal Portal access tab with Approve/Reject; approve updates the subcontractor record).
- **Team** (owner): view company users; owner can invite users with roles manager/site/accounts/viewer (temp password shown once), disable them, reset their passwords. Internal staff see these users in the Portal access tab (created_by = "portal owner").
- **My account**: profile, change password, active sessions (sign out others).
- Notifications bell = action items count + recent events since last login.

## 4. Seed (keep `npm run check:demo` passing; extend it)
- Every subcontractor with status approved/onboarding gets a slug; approved ones get portal enabled + users: 1 owner + 1–2 others (site engineer, accountant) with demo password **`Portal@123`** (no forced change for demo users; one user with must_change to show the flow; one locked; one disabled).
- Portal auth events history, some portal-submitted progress reports (incl. 1 rejected awaiting resubmission per a few subs), portal-raised issues with comment threads, 2–3 documents pending review uploaded via portal, 1 pending bank-details change request, documents expiring soon for action items.
- README + login page hint: demo portal e.g. `http://localhost:3100/p/gulf-trench` → `owner email` / `Portal@123` (print the list of slugs and owner emails at the end of seed).
- check:demo additions: every approved sub has slug + ≥1 active owner; every portal user's company has ≥1 assignment; each action-item type appears for at least one company.

## 5. Quality
- tsc, lint, calc.check, check:demo, full e2e pass. New `tests/e2e/portal-auth.spec.ts`:
  1. Internal admin creates a portal user on a subcontractor → credentials card shows URL + temp password → sign in at `/p/<slug>/login` → forced change → dashboard.
  2. Cross-company isolation: user of company A gets 404 for company B's invoice/assignment ids and is redirected away from `/p/<B-slug>`; file of company B returns 403/404.
  3. Submit a progress update with a photo → visible internally with Portal badge; reject it internally → appears in the portal action items → resubmit.
  4. Submit an invoice with lines + tax invoice attachment → visible internally.
  5. Disabled portal / disabled user / lockout after 5 failures.
  6. Impersonation is read-only.
- Update the existing flow spec if the legacy portal changed.
