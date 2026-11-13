# Operations Module — Tender-to-Project Management (SPEC / build contract)

Single-company app for a contractor that bids on infrastructure work (road laying, cable laying, pipe laying, telecom, civil) for government, road/telecom authorities and private clients, then executes won work through subcontractors.

Lifecycle: **Tender/Proposal → departmental preparation → detailed budget (BOQ) with line-by-line margin → internal review & approval → submission → negotiation & revisions → Won / Lost → (Lost: loss analysis & lessons) / (Won: Project) → map plotting, sub-projects, stages → subcontract assignment → progress, materials, manpower, invoices, completion certificates (internal + subcontractor self-service link) → budget/schedule control dashboards with delay attribution.**

## 1. Stack (fixed)

- Next.js 15 App Router, TypeScript, `src/` dir, Tailwind CSS v4 (already scaffolded in this folder).
- SQLite via `better-sqlite3` (synchronous). DB file: `data/ops.db` (gitignored). `next.config.ts` → `serverExternalPackages: ["better-sqlite3"]`.
- Mutations: **Server Actions** (`"use server"` files under `src/features/<module>/actions.ts`) + `revalidatePath`. Reads: server components calling query functions in `src/features/<module>/queries.ts`.
- Maps: Leaflet + OpenStreetMap tiles (no API key) via `react-leaflet` v5, drawing via `@geoman-io/leaflet-geoman-free`, measurement via `@turf/turf`. Map components must be client-only (`dynamic(() => import(...), { ssr: false })`). Satellite layer option: Esri World Imagery tiles. (Google Maps can be swapped in later — keep map code in `src/components/map/`.)
- Charts: `recharts`. Icons: `lucide-react`. IDs: integer autoincrement; portal tokens: `nanoid(24)`.
- Files: uploaded to `uploads/` (gitignored), metadata in `attachments`, served by `GET /api/files/[id]`.
- No real auth in v1. A "current user" cookie (`ops_user_id`) chosen from a switcher in the top bar; `getCurrentUser()` defaults to user 1. Every mutation records `user_id` in `activity_log`.
- Currency + company name come from `settings` table (defaults: `AED`, "Al Noor Infrastructure LLC"). Use `formatMoney()` everywhere.

## 2. Folder layout

```
src/
  app/
    layout.tsx                 shell: sidebar + topbar (user switcher)
    page.tsx                   Executive dashboard
    tenders/                   pipeline, list, new, [id] (tabs)
    lost-analysis/             loss register & lessons learned
    projects/                  list, [id] (tabs), [id]/stages/[stageId]
    subcontractors/            directory, new, [id]
    invoices/                  all subcontractor invoices (approval queue)
    clients/                   client master
    settings/                  company, currency, users, departments
    portal/[token]/            PUBLIC subcontractor self-service (no sidebar layout)
    api/files/[id]/route.ts    file download
  lib/
    db.ts        getDb() singleton, runs schema.sql + migrations, WAL on
    schema.sql   full schema (section 3)
    seed.ts      `npm run seed` → wipes & seeds demo data (section 7)
    format.ts    formatMoney, formatNumber, formatDate, pct
    session.ts   getCurrentUser(), setCurrentUser action
    activity.ts  logActivity(entityType, entityId, action, message)
    files.ts     saveUpload(file: File, entityType, entityId, category) → attachment row
    metrics.ts   budget & EVM calculations (section 5) — single source of truth
    status.ts    status enums + label + badge colour maps for every status
  components/
    ui/          Button, Card, Badge(StatusBadge), Table, Tabs (URL ?tab=), Stat, Modal, Field/Input/Select/Textarea, EmptyState, ProgressBar, PageHeader
    AttachmentsPanel.tsx   list + upload for any (entityType, entityId)
    ActivityTimeline.tsx   activity_log for an entity
    map/ProjectMap.tsx     view/draw map (section 6)
  features/<module>/actions.ts, queries.ts, components/
```

Module agents only create files inside their own `app/<route>` and `features/<module>` folders, plus additions to `lib/metrics.ts` only if section 5 is missing something (coordinate via comment). Shared files belong to the foundation.

## 3. Database schema (all tables; `created_at TEXT DEFAULT CURRENT_TIMESTAMP` on every table; dates as ISO `YYYY-MM-DD` text; money as REAL)

**Core**
- `settings(key PK, value)`
- `departments(id, name UNIQUE, code)` — Technical, Commercial, Finance, Operations, HR, Procurement, HSE, Management
- `users(id, name, email, department_id, role)` — role ∈ `admin|manager|engineer|estimator|finance|hr|viewer`
- `clients(id, name, type, contact_person, email, phone, address, notes)` — type ∈ `government|road_authority|telecom|utility|private|other`
- `attachments(id, entity_type, entity_id, category, filename, stored_path, mime, size, uploaded_by, note)` — entity_type ∈ `tender|revision|project|stage|subcontractor|assignment|progress|invoice|certificate|loss`
- `activity_log(id, entity_type, entity_id, action, message, user_id)`

**Tendering**
- `tenders(id, code UNIQUE e.g. TND-2026-001, title, client_id, kind, category, location, scope_summary, technical_spec TEXT, quantity REAL, quantity_unit, issue_date, clarification_deadline, submission_deadline, bid_bond_amount, estimated_value, status, current_revision_id, owner_id, probability_pct, submitted_at, decided_at, won_value, project_id)`
  - kind ∈ `tender|proposal|rfq|eoi`; category ∈ `road|cable|pipeline|telecom|civil|other`; quantity_unit ∈ `km|m|sqm|nos|lumpsum`
  - status ∈ `draft → in_preparation → under_review → approved → submitted → negotiation → won | lost | cancelled | no_bid`
- `tender_sections(id, tender_id, department_id, title, content TEXT, status, assignee_id, due_date, completed_at)` — department contributions (technical spec, method statement, manpower plan, finance/cashflow, HSE plan, etc.). status ∈ `not_started|in_progress|completed`. On tender creation auto-create default sections: Technical (Technical spec & method statement), Operations (Execution plan & equipment), HR (Manpower plan), Procurement (Material sourcing), Finance (Cost & cash-flow), HSE (HSE plan), Commercial (Pricing & terms).
- `tender_revisions(id, tender_id, rev_no, label e.g. "R0", reason, status, total_cost, total_price, margin_pct, submitted_at, client_feedback, created_by)` — status ∈ `draft|submitted|superseded|final`. Rev 0 created with tender. "New revision" copies all budget lines from current revision, marks old `superseded` when the new one is submitted.
- `budget_lines(id, revision_id, tender_id, sort, category, item_code, description, unit, quantity, unit_cost, margin_pct, department_id, notes, wbs_stage)`
  - category ∈ `manpower|material|equipment|services|subcontract|overhead|contingency`
  - cost = quantity × unit_cost; price = cost × (1 + margin_pct/100). `wbs_stage` free-text grouping (e.g. "Section A km 0–5") reused when converting to project.
- `margin_changes(id, budget_line_id, revision_id, old_margin, new_margin, reason, user_id)` — every margin edit (line or bulk) is logged → negotiation trail.
- `tender_reviews(id, tender_id, revision_id, department_id, reviewer_id, decision, comment, decided_at)` — decision ∈ `pending|approved|changes_requested|rejected`. "Send for review" creates one pending row per reviewing department (Technical, Finance, Operations, Management). All approved → tender `approved`; any changes_requested → back to `in_preparation`.
- `negotiations(id, tender_id, revision_id, date, channel, summary, client_position, our_position, client_target_price, outcome, next_step)` — channel ∈ `meeting|email|call|letter|site_visit`
- `loss_analyses(id, tender_id, primary_reason, secondary_reasons, winner_name, winner_price, our_price, price_gap_pct, technical_score, client_feedback, root_cause, lessons_learned, action_items, owner_id, status)` — primary_reason ∈ `price|technical|timeline|experience|compliance|relationship|scope|other`; status ∈ `open|in_review|closed`.

**Projects**
- `projects(id, code UNIQUE PRJ-2026-001, name, tender_id, client_id, parent_id NULL (sub-project), category, region, location, contract_value, budget_cost, start_date, end_date, status, manager_id, total_quantity, quantity_unit, geometry TEXT GeoJSON FeatureCollection, description)`
  - status ∈ `planning|mobilizing|active|on_hold|completed|closed`
- `project_budget_lines(id, project_id, stage_id NULL, category, description, unit, quantity, unit_cost, budget_amount, source_budget_line_id)` — copied from final tender revision on conversion (budget_amount = cost, not price).
- `stages(id, project_id, code e.g. S1, name, description, sort, geometry TEXT GeoJSON Feature, planned_quantity, quantity_unit, chainage_from, chainage_to, planned_start, planned_end, actual_start, actual_end, budget_amount, status, weight_pct)`
  - status ∈ `not_started|in_progress|delayed|on_hold|completed`. Stage length auto-computed from geometry (turf length km / area sqm) but editable.
- `subcontractors(id, code, name, trade, categories, contact_person, email, phone, address, trade_license_no, trade_license_expiry, tax_no, bank_name, iban, status, rating, notes)` — status ∈ `prospect|onboarding|approved|suspended|blacklisted`
- `subcontractor_documents(id, subcontractor_id, doc_type, ref_no, issue_date, expiry_date, attachment_id, status)` — doc_type ∈ `trade_license|tax_certificate|insurance|hse_certificate|bank_letter|company_profile|iso|other`; status ∈ `pending|verified|expired|rejected`
- `onboarding_checklist(id, subcontractor_id, item, done, done_by, done_at)` — default items: Registration form, Trade license verified, Insurance verified, HSE pre-qualification, Bank details verified, Framework agreement signed.
- `assignments(id, code e.g. SC-001, project_id, stage_id, subcontractor_id, scope, contract_value, quantity, quantity_unit, unit_rate, start_date, end_date, payment_terms TEXT, advance_pct, retention_pct, payment_days, status, portal_token UNIQUE, portal_enabled INTEGER)` — a stage can have multiple assignments. status ∈ `draft|active|suspended|completed|terminated`.
- `progress_reports(id, assignment_id, stage_id, project_id, report_date, quantity_done REAL (this period), cumulative_quantity, percent_complete, manpower_count, man_hours, equipment_used TEXT, work_done TEXT, issues TEXT, delay_days, delay_cause, delay_responsibility, geometry TEXT optional, source, status, verified_by, verified_at)`
  - delay_responsibility ∈ `none|subcontractor|company|client|authority|weather|utility_clash|other`; source ∈ `internal|portal`; status ∈ `submitted|verified|rejected`. Only `verified` reports count toward progress (internal entries auto-verified).
- `progress_materials(id, progress_report_id, material, unit, quantity, unit_cost)`
- `progress_manpower(id, progress_report_id, trade, headcount, hours)`
- `sub_invoices(id, assignment_id, project_id, invoice_no, invoice_date, period_from, period_to, claimed_amount, claimed_percent, certified_amount, retention_amount, advance_recovery, net_payable, status, paid_amount, paid_date, source, notes)` — status ∈ `submitted|under_review|certified|approved|paid|rejected`
- `completion_certificates(id, assignment_id, project_id, stage_id, cert_type, cert_no, cert_date, percent, quantity, remarks, status, issued_by, source)` — cert_type ∈ `partial|substantial|final|taking_over`; status ∈ `draft|requested|issued|rejected`
- `project_costs(id, project_id, stage_id, category, description, amount, cost_date, source_type, source_id)` — actual cost ledger. Auto-posted: approved/paid sub_invoices (category subcontract, amount = certified_amount), verified progress materials (category material, qty × unit_cost). Manual entries allowed (manpower, equipment, overhead).
- `issues(id, project_id, stage_id, assignment_id, title, description, responsibility, impact_days, impact_cost, status, raised_on, resolved_on)` — status ∈ `open|mitigating|closed`; responsibility same enum as delay_responsibility.

Indexes on every FK. `PRAGMA foreign_keys=ON`.

## 4. Screens

**Shell**: left sidebar (Dashboard, Tenders, Loss Analysis, Projects, Subcontractors, Invoices, Clients, Settings), topbar with page title, global search box (tenders/projects/subcontractors by code/name), current-user switcher. Clean, dense, enterprise look (slate/white, blue accent), responsive.

**Tenders**
- `/tenders` — toggle Kanban (columns by status, card shows code, client, deadline countdown, value, probability) and Table (filters: status, category, client, owner; sort by deadline). KPI strip: open bids value, submitted, win rate (won/(won+lost)) by count & value, due in 7 days.
- `/tenders/new` — form.
- `/tenders/[id]` tabs:
  - **Overview**: details, status stepper, deadline countdown, current revision totals (cost, price, margin %, margin value), workflow buttons by status (Start preparation, Send for review, Submit to client, Move to negotiation, Mark Won, Mark Lost, Cancel/No-bid).
  - **Departments**: section cards per department with rich textarea content, assignee, due date, status; overall % completion. Cannot send for review until all sections completed (show warning; admin may override).
  - **Budget / BOQ**: editable grid for current revision grouped by category with subtotals; inline edit qty/unit cost/margin; per-line cost, price, margin value; bulk "set margin for category/all"; margin edits ask reason → `margin_changes`. Summary panel: cost by category (donut), total cost, total price, blended margin, contingency. Read-only when revision not draft. CSV import/export of lines.
  - **Commercial & Negotiation**: revision comparison table (R0 vs R1 vs R2: cost, price, margin, delta), margin change log, negotiation log CRUD, "Create new revision" (reason required), client target price vs our price chart.
  - **Reviews**: review matrix by department with decision + comment; current user acts on their department's row.
  - **Documents**: AttachmentsPanel (categories: RFP, drawings, technical, commercial, submission, correspondence, bid bond).
  - **Activity**: timeline.
  - Mark Won → modal (final value, award date, project start/end, project manager) → creates project with project_budget_lines from final revision and stages from distinct `wbs_stage` values (budget = sum of line costs) → redirect to project.
  - Mark Lost → modal (primary reason, winner, winner price) → creates `loss_analyses` row → link to it.
- `/lost-analysis` — register of lost tenders with reason, price gap; charts: losses by reason, by category, avg price gap; lessons-learned library (searchable). `/lost-analysis/[id]` edit form + status.

**Projects**
- `/projects` — cards/table: progress bar, planned vs actual %, budget vs actual cost, CPI/SPI chips, RAG health, length (km). Map view of all projects. Filter by status/category/region. Sub-projects nested under parent.
- `/projects/[id]` tabs:
  - **Overview**: KPI tiles (contract value, budget, actual cost, committed (sum assignment values), % complete planned vs actual, SPI, CPI, EAC, forecast finish, delay days), S-curve (planned vs actual cumulative % over time), cost by category budget vs actual bars, stage table with progress bars & RAG.
  - **Map**: full ProjectMap with project geometry + stages coloured by status/progress, legend, completed portion highlighted (line split by % using turf `lineSliceAlong`), click stage → popup with progress, subcontractor, % and link. Edit mode: draw/edit project route (polyline) or area (polygon), draw stage geometries, "Split route into N equal stages" or "split at chainages" helper that creates stages from the project polyline.
  - **Stages**: CRUD table (code, name, chainage, qty, dates, budget, weight, status, progress); click → stage detail.
  - **Sub-projects**: list child projects + create sub-project (inherits client, category; optional geometry subset).
  - **Subcontracts**: assignments CRUD (stage, subcontractor, scope, value, qty, rate, dates, payment terms, advance %, retention %), copy portal link button, enable/disable portal.
  - **Progress**: all reports (filter by stage/subcontractor/status), add report form (quantity, manpower lines, material lines, equipment, issues, delay days/cause/responsibility, photos), verify/reject portal submissions.
  - **Budget & Cost**: project budget lines vs actual cost ledger by category & stage, variance, add manual cost.
  - **Invoices & Certificates**: assignment invoices (certify → approve → pay; auto retention & advance recovery from assignment terms) and completion certificates (issue).
  - **Delays & Issues**: issues CRUD; delay attribution charts — delay days and cost impact by responsibility party and by subcontractor; "who is failing" table: subcontractors ranked by SPI, late days.
  - **Documents**, **Activity**.
- `/projects/[id]/stages/[stageId]` — stage map, assignments, progress history chart, materials/manpower consumed, invoices.

**Subcontractors**
- `/subcontractors` — directory with status, trade, rating, active assignments, doc expiry warnings.
- `/subcontractors/new`, `/subcontractors/[id]` tabs: Profile, Onboarding checklist (approve when complete), Documents (with expiry & status), Assignments (across projects) with performance (progress %, SPI, delay days caused), Invoices, Certificates.
- `/invoices` — cross-project invoice queue by status with approve/pay actions.

**Subcontractor portal** `/portal/[token]` (public, minimal branded layout, mobile-first): shows assignment scope, stage map, progress to date, then forms: submit progress report (date, quantity, manpower, materials, equipment, issues, delay cause, photos), submit invoice (with file), request completion certificate (with file), view status of own submissions. Everything saved with `source='portal'`, status `submitted`, needs internal verification. Invalid/disabled token → friendly message.

**Executive dashboard** `/`: Tender pipeline funnel by status (count & value), win rate, upcoming submission deadlines, active projects health table (RAG), total contract value, total budget vs actual, portfolio SPI/CPI, delay days by responsibility (portfolio), top late subcontractors, pending approvals (reviews assigned to current user's department, portal submissions to verify, invoices to certify), expiring subcontractor documents (30 days), map of all active projects.

## 5. Metrics (`lib/metrics.ts`) — single source of truth

- Tender revision totals: cost = Σ qty×unit_cost; price = Σ cost×(1+m/100); margin_value = price − cost; margin_pct (on price) = margin_value/price×100; markup_pct (on cost) = margin_value/cost×100. Show both, label clearly.
- Stage actual % = min(100, cumulative verified quantity / planned_quantity × 100) (fallback: latest verified percent_complete).
- Project actual % = Σ(stage % × stage weight) where weight = weight_pct if set else budget_amount share else quantity share.
- Planned % at date d for a stage = linear 0→100 between planned_start and planned_end. Project planned % = weighted.
- BAC = project budget_cost. EV = BAC × actual%. PV = BAC × planned%. AC = Σ project_costs. SPI = EV/PV, CPI = EV/AC (null if denominator 0). EAC = BAC/CPI. VAC = BAC − EAC. Forecast finish = start + (elapsed / actual%) duration.
- RAG: green SPI≥0.95 & CPI≥0.95; amber ≥0.85; red below.
- Delay attribution: Σ delay_days from verified progress reports + Σ impact_days from issues, grouped by responsibility (and by subcontractor where responsibility = subcontractor).
- S-curve: weekly points from project start to max(end, today): planned cumulative %, actual cumulative % (from verified report dates).

## 6. Map component (`components/map/ProjectMap.tsx`)

Props: `features` (array of {id, kind: 'project'|'stage', geometry, color, label, progressPct, popupHtml/href}), `editable`, `onSave(geojson)`, `center`, `height`. Base layers: OSM streets + Esri satellite switch. Geoman toolbar in edit mode (polyline, polygon, marker, edit, delete). Shows length (km) / area (sqm, hectares) live with turf. Fit bounds to features. Progress overlay: for a LineString stage, draw full line grey and the completed slice green.

## 7. Seed data (`npm run seed`)

Realistic UAE-style demo (currency AED, map around Dubai/Abu Dhabi, real-looking coordinates along existing roads):
- 8 departments, ~10 users across departments.
- 6 clients (e.g. "Roads & Transport Authority (demo)", "Etisalat-like Telecom (demo)", "Water & Electricity Authority (demo)", municipality, developer).
- 12 tenders across all statuses with 1–3 revisions, 25–40 budget lines each across all categories, department sections in mixed states, reviews, negotiations, margin changes; 3 lost with loss analyses; 4 won.
- 4 projects from won tenders: (1) 18 km road widening (LineString, 6 stages), (2) 42 km fibre-optic cable laying (LineString, 5 stages, has 2 sub-projects by region), (3) 12 km water pipeline (LineString, 4 stages), (4) a polygon-area utility/civil works project. Start dates 2–10 months ago.
- 10 subcontractors in varied onboarding states with documents (some expiring soon).
- Assignments on stages, 6–20 weekly progress reports per active assignment with materials/manpower, some delays attributed to different parties, some portal submissions pending verification; invoices in all statuses; certificates; manual costs; issues. Make one project clearly over budget & late (subcontractor failing), one on track, one delayed by client/authority.
Print portal links for active assignments at end of seed.

## 8. Conventions

- Strict TypeScript, no `any` in exported APIs. Types for rows in `src/lib/types.ts`.
- Every server action: validate input (manual checks fine), run in a transaction when multi-table, `logActivity`, `revalidatePath`.
- Status colours/labels only via `lib/status.ts`.
- Money right-aligned, tabular-nums. Dates `DD MMM YYYY`.
- `npm run build` must pass with no type errors. `npm run dev` on port 3100.
