# Phase 2 — Authentication, Access Control & Multi-Level Approval Workflows (build contract)

Extends SPEC.md. Read SPEC.md and docs/FOUNDATION.md first. The existing "user switcher" (`ops_user_id` cookie, `components/shell/UserSwitcher.tsx`, `lib/session-actions.ts`) is **replaced** by real login. The existing Settings → Users section moves to a dedicated **Administration** area.

## A. Authentication

**Libraries:** `bcryptjs` (pure JS) for password hashes; `crypto.randomBytes(32)` for session tokens. No external auth provider.

**Schema changes** (`lib/schema.sql` for new DBs + idempotent `ALTER TABLE` migrations in `lib/db.ts` guarded by `PRAGMA table_info` so existing `data/ops.db` upgrades without re-seed):
- `users` add: `password_hash TEXT`, `status TEXT NOT NULL DEFAULT 'active'` (`active|disabled|locked`), `role_id INTEGER REFERENCES roles(id)`, `phone TEXT`, `job_title TEXT`, `must_change_password INTEGER DEFAULT 0`, `failed_attempts INTEGER DEFAULT 0`, `locked_until TEXT`, `last_login_at TEXT`, `password_changed_at TEXT`. Keep legacy `role` text column (mirror role code) for backward compatibility. `email` becomes the login id — unique index on `lower(email)`.
- `sessions(id, token_hash TEXT UNIQUE, user_id, created_at, expires_at, last_seen_at, ip, user_agent, revoked_at)` — store SHA-256 of the token, never the token.
- `auth_events(id, user_id NULL, email, event, ip, user_agent, detail, created_at)` — event ∈ `login_success|login_failed|logout|locked|password_changed|password_reset|session_revoked|user_created|user_disabled`.

**Flow:**
- `/login` (outside the `(main)` shell, own minimal branded layout with company name): email + password + "Remember me". Generic error message ("Invalid email or password"). Success → cookie `ops_session` (httpOnly, sameSite=lax, secure in production, path=/; 12 h, or 30 days with Remember me) → redirect to `?next=` (only same-origin relative paths) or `/`.
- Lockout: 5 consecutive failures → `locked_until = now + 15 min`, event `locked`. Disabled users cannot log in.
- `must_change_password = 1` → after login, force `/account/password` before anything else.
- `/account` (in shell): profile (name, phone, job title), change password (current + new + confirm; policy: ≥ 8 chars, upper, lower, digit), list own active sessions with "sign out other sessions".
- Logout: topbar user menu → revoke session row, clear cookie, redirect `/login`.
- `src/middleware.ts`: edge-safe — only checks presence of `ops_session` cookie; redirects to `/login?next=…` for everything except `/login`, `/portal/**`, `/api/files/**` (files route does its own check), `/_next/**`, static assets. Real validation happens server-side.
- `lib/auth.ts` (server-only) — the single API every module uses:
  - `getSession(): Promise<{ user: AuthUser; sessionId: number } | null>` (validates token hash, expiry, user status; slides `last_seen_at`; cached per request with React `cache`)
  - `requireUser(): Promise<AuthUser>` → redirects to `/login` if none.
  - `getCurrentUser()` in `lib/session.ts` keeps its signature but now returns the logged-in user (calls requireUser) — so existing module code keeps working.
  - `can(user, module, action): boolean`, `requirePermission(module, action): Promise<AuthUser>` (throws a typed `ForbiddenError` in actions; in pages renders `/forbidden` via `notFound`-style helper `forbidden()` page component).
  - `AuthUser = User & { roleCode, roleName, permissions: Record<ModuleKey, ActionKey[]>, isSuperAdmin }`.
- `/api/files/[id]` must require a valid session OR a valid portal token query param for files attached to that portal's assignment.
- Portal (`/portal/[token]`) stays public (token-based) — no change.

## B. Roles & access control (menu + action level)

**Schema:**
- `roles(id, code UNIQUE, name, description, is_system INTEGER, created_at)` — system roles seeded: `super_admin`, `admin`, `management`, `project_manager`, `estimator`, `engineer`, `finance`, `hr`, `procurement`, `viewer`. `super_admin` bypasses all checks and cannot be edited/deleted.
- `role_permissions(role_id, module, action, PRIMARY KEY(role_id, module, action))`
- `user_permission_overrides(user_id, module, action, effect TEXT 'allow'|'deny', PRIMARY KEY(user_id, module, action))` — per-user grant/deny on top of role.

**Modules (= menu items) & actions** — defined once in `lib/permissions.ts` (shared constant, usable client-side):
```
dashboard: view
tenders: view, create, edit, delete, submit, approve, export
tender_budget: view, edit, edit_margin, export
lost_analysis: view, edit
projects: view, create, edit, delete
project_map: view, edit
progress: view, create, verify
project_costs: view, create
subcontractors: view, create, edit, approve
invoices: view, certify, approve, pay
certificates: view, issue
clients: view, create, edit, delete
approvals: view            (own inbox — everyone by default)
approval_setup: view, edit (workflow designer)
users: view, create, edit, disable, reset_password
roles: view, edit
settings: view, edit
audit: view
```
- Effective permission = role permissions ∪ user `allow` overrides − user `deny` overrides. Super admin = all.
- **Menu access:** sidebar and mobile nav render only modules where the user has `view`. Direct URL to a module without `view` → `/forbidden` page ("You don't have access to X. Contact your administrator.").
- **Action access:** every server action in every module starts with `await requirePermission(module, action)` (map each existing action to the right pair — e.g. tenders `markWon` → `tenders/approve`, budget line edits → `tender_budget/edit`, margin edits → `tender_budget/edit_margin`, invoice certify/approve/pay → `invoices/certify|approve|pay`, progress verify → `progress/verify`, settings actions → `settings/edit`). Buttons/forms the user may not use are hidden or disabled (pass booleans from server components; no client-side-only security).
- Existing `logActivity` keeps using the current user automatically.

## C. Administration area (`/admin`, sidebar group "Administration")

- `/admin/users` — table (name, email, department, role, status, last login, locked badge) with search/filter. Create user (name, email, department, role, job title, phone, initial password or "generate temporary password" shown once + `must_change_password`). Edit, disable/enable, unlock, reset password (temporary password shown once), revoke all sessions. Cannot disable yourself or the last super admin.
- `/admin/users/[id]` — profile + **Access** tab: effective permission matrix (modules × actions) showing source (role / allow override / deny override) with tri-state toggles to set overrides; **Sessions** tab; **Activity** tab (auth_events + activity_log by user).
- `/admin/roles` — list roles with user counts; create/clone/edit/delete (non-system, no users assigned). `/admin/roles/[id]` — **permission matrix editor**: rows = modules (grouped: Sales/Tendering, Projects, Subcontracting, Finance, Administration), columns = actions, checkboxes, "select row/column", save. Menu preview panel showing which sidebar items the role will see.
- `/admin/approval-workflows` — workflow designer (section D).
- `/admin/audit` — auth_events + activity_log combined, filter by user/event/date.
- `/settings` keeps company/currency/departments (remove the old users section; link to /admin/users).

## D. Multi-level approval workflow engine

**Document types** (registry in `lib/approvals/registry.ts`): each entry `{ type, label, module, getDocument(id) → { ref, title, amount, departmentId, projectId, url }, onApproved(id, ctx), onRejected(id, ctx), onReturned?(id, ctx) }`.

| type | when a request is raised | on final approval | on reject / return |
|---|---|---|---|
| `tender_submission` | tender "Send for review" (replaces the old fixed department review) | tender → `approved` | → `in_preparation` |
| `tender_revision` | "Submit revision R#" after the first submission (price revision) | revision `submitted`, previous `superseded` | revision stays draft |
| `tender_award` | "Mark Won" (amount = final value) | runs existing won → project conversion | tender stays in negotiation |
| `subcontractor_onboarding` | "Approve subcontractor" when checklist complete | subcontractor `approved` | stays `onboarding` |
| `subcontract_award` | assignment created/activated (amount = contract value) | assignment `active`, portal enabled allowed | assignment `draft` |
| `sub_invoice` | invoice certified (amount = certified amount) | invoice `approved` (+ syncInvoiceCost) | `under_review` (returned) / `rejected` |
| `invoice_payment` | "Pay" requested (amount = net payable) | invoice `paid` | stays `approved` |
| `completion_certificate` | certificate issue requested | certificate `issued` | `rejected` |
| `project_cost` | manual cost entry above threshold setting `approval_cost_threshold` | cost row posted | cost row deleted |
| `loss_analysis` | loss analysis "close" | status `closed` | `in_review` |

**Schema:**
- `approval_workflows(id, document_type, name, description, is_active, priority, condition_min_amount NULL, condition_max_amount NULL, condition_department_id NULL, condition_project_category NULL, created_by, updated_at)` — several workflows per type allowed; the engine picks the active one with matching conditions and highest priority (e.g. invoices < 100k: 2 levels; ≥ 100k: 4 levels). If none matches → auto-approve (configurable per type via setting `approval_required_<type>` = `1` → block with message "No approval workflow configured").
- `approval_levels(id, workflow_id, level_no, name, approver_type, approver_role_id, approver_user_id, approver_department_id, approval_mode, min_approvals, min_amount NULL, sla_hours, allow_self_approval INTEGER DEFAULT 0)`
  - approver_type ∈ `role|user|department|department_head|project_manager|requester_manager`
  - approval_mode ∈ `any` (first approver decides) | `all` (every resolved approver must approve) | `min` (min_approvals of N)
  - `min_amount`: level applies only if document amount ≥ value (lets one workflow skip upper levels for small amounts).
- `approval_requests(id, document_type, document_id, document_ref, title, amount, workflow_id, current_level, status, requested_by, requested_at, completed_at, note)` — status ∈ `pending|approved|rejected|returned|cancelled`. One open request per document (unique partial index on (document_type, document_id) where status='pending').
- `approval_tasks(id, request_id, level_no, assignee_user_id, status, decision_comment, decided_at, delegated_from_user_id)` — one row per resolved approver for the current level; status ∈ `pending|approved|rejected|returned|skipped`.
- `approval_delegations(id, user_id, delegate_user_id, start_date, end_date, document_types NULL (all), is_active)` — out-of-office: tasks created in the window go to the delegate (recorded in delegated_from_user_id).
- Users with no `department_head` set: add `departments.head_user_id` and `users.manager_id` (migration) for `department_head` / `requester_manager` resolution; `project_manager` = projects.manager_id of the document's project.

**Engine (`lib/approvals/engine.ts`, server-only, all in DB transactions, every step → activity_log on the document entity + approval history):**
- `submitForApproval(type, documentId, { note }) → { status: 'pending'|'auto_approved', requestId }` — resolves workflow + applicable levels (filter by min_amount), creates request at first applicable level, resolves approvers → tasks (excluding requester unless allow_self_approval; empty resolution → error naming the level), applies delegations. If no levels apply → auto-approve → calls `onApproved`.
- `decide(taskId, decision: 'approve'|'reject'|'return', comment)` — only the task assignee (or super admin "approve on behalf", logged). Comment required for reject/return. Level completion per mode; on level complete → next applicable level or final `approved` → `onApproved`. Reject → request `rejected` → `onRejected`. Return → request `returned` → `onReturned` (document goes back to requester for edits; can be resubmitted).
- `cancelRequest(requestId)` (requester or admin), `getApprovalStatus(type, id)` (request + levels + tasks for UI), `getMyPendingTasks(userId)`, `getPendingCount(userId)`.
- SLA: tasks older than `sla_hours` flagged overdue (computed, shown in red).

**UI:**
- `components/approvals/ApprovalPanel.tsx` (server component) — drop into any document page: shows current status, a horizontal level stepper (Level 1 Technical Manager ✓ by X on date → Level 2 Finance (pending: A, B) → Level 3 GM), history with comments, and for the current user's pending task: Approve / Return / Reject with comment. Also "Submit for approval" / "Cancel request" for the requester where applicable.
- Integrate the panel + engine into: tender (Reviews tab becomes "Approvals"; keep legacy `tender_reviews` read-only as "Legacy reviews" if rows exist), tender revisions (Commercial tab), Mark Won, subcontractor detail (Onboarding tab), project Subcontracts tab, Invoices (project tab + `/invoices` queue: Approve/Pay buttons now raise approval requests), certificates, manual costs, loss analysis.
- `/approvals` — **My approval inbox** (sidebar item with live pending-count badge): tabs Pending for me (with overdue flags, amount, document link, quick approve/return/reject with comment), Submitted by me, Completed (history), Delegations (set out-of-office delegate + date range).
- `/admin/approval-workflows` — list workflows grouped by document type (active toggle, conditions summary, level count). Editor `/admin/approval-workflows/[id]`: name, document type, conditions (amount range, department, project category), priority; **levels builder**: add/remove/reorder levels; per level name, approver type + picker (role / user / department), mode (any/all/min N), level min amount, SLA hours, allow self approval. Live "preview": choose a sample amount → shows which levels would apply and who would be the approvers today. Clone workflow.
- Dashboard "My pending approvals" card switches to `getMyPendingTasks`.

## E. Seed

- Roles with sensible permission sets (e.g. estimator: tenders view/create/edit/submit, tender_budget view/edit/edit_margin; finance: invoices certify/approve/pay, project_costs, tender_budget view; viewer: view only; project_manager: projects/progress/map/subcontractors view+edit, certificates issue).
- All 10 existing users get passwords + roles + managers; departments get heads. Demo credentials (local demo only, documented in README): `admin@alnoor.demo` / `Admin@12345` (super_admin) and every other seeded user `Password@123`; seed prints the list.
- Workflows: tender_submission (L1 Technical head, L2 Finance head, L3 Management role; all ≥ 0), tender_award (L1 Management, L2 super-admin/GM user if ≥ 20M), sub_invoice (two workflows: < 500k → L1 project_manager, L2 finance role; ≥ 500k → + L3 management), invoice_payment (finance role, then management if ≥ 1M), subcontract_award (PM → management), subcontractor_onboarding (procurement head → HSE head), completion_certificate (PM), project_cost threshold 50k (PM → finance), loss_analysis (management). Seed several open requests at different levels assigned to different users (some overdue), plus approved/rejected/returned history, and one active delegation.

## F. Non-negotiables

- No secrets in code beyond demo seed passwords; password hashes only; session tokens hashed in DB.
- All checks server-side; hidden buttons are cosmetic only.
- Existing features keep working; `npm run build`, `npx tsc --noEmit`, `npx eslint src` clean; e2e test updated to log in first and extended with an approval flow.
