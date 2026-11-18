# Supplier registration + Supplier tendering (build contract)

Today the flow is: client tender (Sales) → won → project → sub-projects/stages → a subcontractor is **assigned directly** on the project's Subcontracts tab → progress, invoices, certificates and payments.

This contract adds two things:

1. **Supplier registration and prequalification.** Subcontractors, also called *suppliers*, register themselves on a public page and upload their company documents. Al Noor reviews each registration and approves it, refers it back for corrections or rejects it. The supplier is notified by email and in the portal, fixes what is missing and resubmits. Only approved suppliers can bid.
2. **Supplier tendering (RFx).** This is an **optional** stage between the project or sub-project and the assignment. Al Noor floats a tender for a project, a sub-project or a set of stages, and the tender follows a configurable workflow of steps. Approved suppliers bid in the portal. Al Noor holds the tender board opening, evaluates (compliance, HSE, technical, commercial and so on), recommends a bidder and approves the award. **On award approval the assignment is created automatically**, and from there everything works as it does today.

Direct assignment stays exactly as it is. Tendering is the second route, not a replacement.

**Read first:**
- SPEC.md, AUTH_SPEC.md (RBAC and the approval engine), PORTAL_SPEC.md, MULTI_COUNTRY_SPEC.md, DEMO_DATA_SPEC.md, THEME_SPEC.md, docs/FOUNDATION.md
- `src/lib/{schema.sql,migrate.ts,db.ts,permissions.ts,role-defaults.ts,status.ts,types.ts,files.ts,portal-auth.ts,portal-core.ts,portal-perms.ts,entity-context.ts,fx.ts,seed-engine.ts,seed-portal.ts}`
- `src/lib/approvals/**`, `src/lib/seed-regions/**`
- `src/features/{subcontractors,portal,portal-admin,projects,tenders}/**`
- `src/app/p/[slug]/**`, `scripts/check-demo-*.ts`, `tests/e2e/**`

**Naming.** In the UI, the existing *Tenders* stay the client-facing sales tenders. The new module is **Procurement** and its tenders are **supplier tenders**. In code use the prefix `rfx_`. Codes are `RFX-2026-001`, and Oman's are `OM-RFX-2026-001` (doc_prefix plus a per-entity sequence, like the other codes).

Everything is **entity-scoped** per MULTI_COUNTRY_SPEC. `rfx_tenders.entity_id` is the root, and registrations carry `entity_id` because a supplier registers with one country. Amounts are in the entity currency and get USD columns: add the new money tables to the FX layer (`fx-tables.ts` triggers and `_usd` virtual columns).

---

## Part A — Supplier registration and prequalification

### A1. Data model (SCHEMA_VERSION 9, migrated in place)

**`subcontractors` gets new columns:**
- Registration state:
  - `registration_status` is one of: `draft | submitted | under_review | referred_back | approved | rejected`. Backfill existing rows to `approved`, except the current `prospect` and `onboarding` rows, which become `under_review`.
  - `registration_no` (`REG-2026-0001`, per entity), `registered_at`, `submitted_at`, `reviewed_by`, `reviewed_at`, `review_note`, `reject_reason`.
- Company details: `legal_form`, `year_established`, `employees`, `turnover_band`, `website`, `cr_no`, `cr_expiry`, `vat_no`, `country_of_registration`.
- Qualification and bank: `prequal_grade` (A/B/C), `prequal_valid_until`, `account_name`, `swift`.
- HSE and declarations:
  - `hse_lti_rate`, `hse_has_policy`, `iso_9001`, `iso_14001`, `iso_45001` (0/1)
  - `icv_score` (Oman In-Country Value certificate, optional)
  - `declaration_accepted_at`
- `slug` already exists for the portal; generate it on registration.

**New tables:**
- `supplier_categories` is a master list (id, entity_id nullable, code, name, group, active). Seed realistic trades:
  - Telecom: fibre/copper cable laying, fibre splicing & testing, HDD/micro-trenching, ducting & manholes.
  - Civil: civil works/excavation, reinstatement & asphalt.
  - Oil and gas: pipeline welding, coating & wrapping, hydrotest & pre-commissioning, cathodic protection.
  - Others: electrical/LV/MV cabling, surveying & GIS, traffic management, plant & equipment hire, manpower supply, HSE services, materials supply (pipes, ducts, cables).
- `subcontractor_categories` (subcontractor_id, category_id, `status` = requested | approved | declined). Approval can grant a subset.
- `subcontractor_experience` (subcontractor_id, client, project, value, currency, year, description).
- `subcontractor_contacts` (role = primary | signatory | finance | hse, name, title, email, phone).
- `registration_doc_types` is configurable per entity (entity_id, code, name, mandatory, needs_expiry, category_condition nullable, sort). Seed these:
  - **AE:** Trade licence*, VAT/TRN certificate*, Chamber of Commerce membership, bank letter with IBAN*, owner/partner passport & Emirates ID*, insurance (WC*, third-party liability*, CAR), company profile*, ISO certificates, HSE policy*, audited financials (last 2 years).
  - **OM:** Commercial Registration (CR)*, OCCI membership*, VAT certificate*, Riyada/SME card, ICV certificate, Omanisation compliance letter (MoL), PDO/OQ vendor registration (only for oil & gas categories), bank letter*, and the shared ones above.
  - `*` = mandatory.
- `subcontractor_documents` already exists: reuse it. Add `doc_type_code`, `review_status` (pending | accepted | query), `review_comment`, `reviewed_by`, `reviewed_at`, `version`. A re-upload after a query creates a new version and keeps the old one.
- `registration_reviews` holds one row per review decision: subcontractor_id, decision (refer_back | approve | reject), note, items_json (the queried sections and documents), decided_by, decided_at. This is the history shown to both sides.
- `email_outbox` (id, entity_id, to_email, to_name, subject, body_html, body_text, template, related_type, related_id, status = queued | sent | logged | failed, error, created_at, sent_at).
- `portal_notifications` (id, subcontractor_id, portal_user_id nullable, kind, title, body, href, read_at, created_at).

### A2. Email (new infrastructure)
- `src/lib/mailer.ts` exposes `sendMail({to, subject, html, text, template, related, entityId})`. It always writes to `email_outbox`.
  - If `SMTP_URL` (plus `MAIL_FROM`) is set in env, it sends through `nodemailer` (add the dependency) and marks the row `sent` or `failed`.
  - Otherwise the status is `logged`, which is demo mode: nothing leaves the machine.
  - Never block the user action on mail failure.
- Templates live in `src/lib/mail-templates.ts`: plain BizBook-styled HTML with the entity's legal name, logo text and footer. Templates:
  - registration received
  - referred back (lists the items to fix, with a "Open supplier portal" button)
  - approved
  - rejected
  - tender invitation
  - addendum issued
  - clarification answered
  - bid received (receipt with a hash of the submission and its timestamp)
  - award (Letter of Award)
  - regret
- Admin page `/admin/email-outbox`, gated by `settings.view`: a filterable list and a preview of the rendered HTML. Add it to the admin nav. It is the demo proof that the emails exist.
- Every email also creates a `portal_notifications` row when the recipient is a supplier, so a supplier with no email still sees the message in the portal bell.

### A3. Public pages (no login)
- **`/suppliers`** is the landing page "Become an Al Noor supplier". It has:
  - a hero
  - a country picker (active entities: flag + legal name)
  - the categories list
  - "How it works": Register → Review → Approved → Bid on tenders
  - a **public tender notice board** showing published *open* tenders with title, category, country and closing date only (no documents or prices), and a "Register / sign in to bid" button.

  Buttons are "Register your company" and "Sign in". Use the BizBook look, shared with the login page style, and make it responsive (check 1024 and 390).
- **`/suppliers/register`** is a multi-step wizard with a progress bar. Each step saves a draft on Next.
  1. **Account.** Country (entity), company legal name, the primary contact's name, email, mobile and password (policy from permissions.ts), and accept terms. This creates the `subcontractors` row (`registration_status = draft`, `status = prospect`, the entity of the chosen country) and a portal user with `portal_role = admin`, then logs them straight into the portal registration area.
     - Rate limit and honeypot the form.
     - The email must be unique among portal users of that entity, with a friendly error.
     - No CAPTCHA service.
  2. **Company.** Legal form, CR/licence number + expiry, VAT/TRN, year established, employees, turnover band, address, website, phone.
  3. **Categories & regions.** Multi-select categories, the regions served (from the entity's regions), and a capacity note.
  4. **Contacts & bank.** Signatory and finance contacts; bank, account name, IBAN (validate the format: AE = 23 chars, OM = 23 chars), SWIFT.
  5. **HSE & quality.** HSE policy yes/no, LTI rate, ISO certificates, ICV score (Oman).
  6. **Experience.** At least 2 reference projects.
  7. **Documents.** The required list comes from `registration_doc_types` for the entity and the chosen categories. Each row has an upload, ref no, issue/expiry date, a mandatory flag and a status. Uploads go through the existing files mechanism, stored under the subcontractor.
  8. **Review & declare.** A summary of all sections with "Edit" links, a completeness meter, and a declaration (accuracy, conflict of interest, code of conduct). **Submit** is only enabled when every mandatory field and document is present.

  On submit: `registration_status = submitted`, `submitted_at`, a `registration_no` is assigned, the received email is sent, an activity log entry is written, and internal users with `subcontractors.approve` for that entity get a notification in the existing topbar notifications.
- **`/suppliers/login`** is one global sign-in: email + password. It finds portal users by email. If the email belongs to more than one supplier or country, show a chooser. Then redirect to `/p/<slug>`. The existing `/p/<slug>/login` keeps working. Add "Forgot password?": generate a reset token, email it (outbox), and add a `/suppliers/reset/<token>` page.

### A4. Supplier portal while not approved
- A portal user whose subcontractor `registration_status <> 'approved'` sees a **restricted portal**: Dashboard (registration status), Registration (the wizard sections, editable when draft or referred_back), Documents, Account. Everything else is hidden and 403s on the server.
- A status banner on every page shows one of:
  - "Submitted on … — under review" (blue)
  - "**Action required** — Al Noor has referred your registration back" (amber), with the review note and a **checklist of the queried items**. Each item links to its section or document, the reviewer's comment is shown inline next to the field or document, and a ✓ appears once it is fixed.
  - "Rejected — reason …" (red)
  - "Approved — prequalified grade B until 30 Nov 2027, categories …" (green)
- **Resubmit** is only possible once every queried item has been changed (new upload version or edited field). Resubmitting sets `registration_status = submitted` again and keeps the review history. The resubmission count is shown to reviewers.
- Approved suppliers also get **Company profile → Request change**. The existing `portal_change_requests` flow stays as it is for approved suppliers.

### A5. Internal review
- **`/subcontractors/registrations`** is the queue. Add a sub-nav or tabs on the Subcontractors list page: *All suppliers · Registrations (badge) · Categories · Document types*.
  - Status tabs: New/Submitted · Under review · Referred back · Approved · Rejected · Drafts.
  - Columns: reg no, company, country flag, categories, submitted, days waiting (SLA chip: >5 days amber, >10 red), completeness, reviewer.
- **Review page `/subcontractors/[id]/registration`.** Also add a "Registration" tab on the subcontractor detail page.
  - "Start review" sets `under_review` and assigns the reviewer.
  - Left side: the sections, each with field values and per-section **Accept / Query (comment)**. Documents show a preview link, ref, expiry (expired documents flagged red automatically) and per-document **Accept / Query (comment)**.
  - Right side: the decision card.
    - **Refer back.** Lists the queried items automatically, plus a note. Requires at least one queried item or a note. Sends the email and portal notification. Status becomes `referred_back`.
    - **Approve.** Choose the approved categories (from the requested ones), prequalification grade and validity (default 1 year). The existing `subcontractor_onboarding` approval workflow is reused:
      - If an active workflow exists for the entity, approval submits it to the engine and the registration stays `under_review` with "Awaiting approval".
      - `onApproved` sets `registration_status = approved`, `status = approved`, grants the categories, and sends the email and notification.
      - Without a workflow, it approves immediately.
      - Update `canSubmit` so it accepts either a completed onboarding checklist or an accepted registration.
    - **Reject.** A reason is required. Sends the email. Status becomes `rejected`. The supplier can still log in and see the reason, but cannot resubmit unless an admin "Reopens" it.
  - The history timeline shows the `registration_reviews` and activity entries.
- **Expiry watch.** A document expiring within 30 days shows a warning chip to both sides. An expired *mandatory* document blocks new bids (part B) until it is renewed. This only blocks bidding: the supplier stays approved.

### A6. Permissions
- `subcontractors.approve` covers registration review.
- Add `subcontractors.setup` for categories and document types.
- Role defaults:
  - **admin:** all
  - **project_manager:** view
  - **finance:** view + approve bank changes (existing)
  - Add a new role **`procurement`** ("Procurement officer") that gets subcontractors view/create/edit/approve/setup plus all the procurement actions from part B. Give Asma Al Harthy (OM) and one UAE user (create *Rashid Al Mazrouei – Procurement Manager*, AE) this role in the seed.

---

## Part B — Supplier tendering (Procurement)

### B1. Tender templates (configurable workflow)
**`/procurement/setup/templates`**, gated by `procurement.setup`. A template defines how a type of tender runs.
- `rfx_templates` columns:
  - id, entity_id nullable (null = all countries), name, description, active
  - `evaluation_method`: `lowest_compliant` | `weighted` | `two_envelope_weighted`
  - `tech_weight`, `commercial_weight` (must total 100 for weighted methods)
  - `tech_pass_mark` (e.g. 70)
  - `bid_bond_pct`, `performance_bond_pct`, `default_validity_days`, `min_bidders` (warn below it), `clarification_days_before_close`
- `rfx_template_steps` are the evaluation steps in order: step_key, name, `kind` (compliance | hse | technical | commercial | legal | custom), `gate` (pass_fail | scored), weight within technical, pass mark, evaluator role hint, sort. **Commercial is always the last step.**
- `rfx_template_criteria` (step_id, criterion, max_score, guidance), for scored steps.
- `rfx_template_requirements` are what bidders must submit: name, `kind` (document | text | number | yes_no | date), mandatory, `envelope` (technical | commercial), step_id it feeds, instructions, sort.
- **Seed templates:**
  1. **Telecom civil & cable laying (two-envelope, 70/30).**
     - Steps: Compliance (pass/fail) → HSE (pass/fail) → Technical (scored: method statement 30, programme 20, resources & equipment 25, experience 25; pass 70) → Commercial.
     - Requirements: method statement, work programme (Gantt), equipment list, key staff CVs, HSE plan, valid licence, similar experience list, priced BOQ, payment terms acceptance, bid bond.
  2. **Oil & gas pipeline works (HSE-critical, 60/40).**
     - Steps: Compliance → HSE (scored, pass 75: HSE MS, LTI stats, PDO/ADNOC approval, emergency response) → Technical → Commercial.
     - Adds requirements: welding procedure (WPS/PQR), NDT plan, QA/QC plan, ICV plan (Oman).
  3. **Small works RFQ (lowest compliant).** Compliance → Commercial. Short requirement list.
  4. **Plant & equipment hire RFQ (lowest compliant).** Equipment list with year/model, insurance, operator certificates, priced hire rates.
- A template can be duplicated and edited. A floated tender **copies** the template steps, criteria and requirements into its own tables, so later template edits never change a live tender. The tender owner can also adjust them while the tender is still a draft.

### B2. Supplier tender (RFx) lifecycle
**`rfx_tenders`:**
- Identity and scope:
  - id, entity_id, code, title, description (scope of work)
  - `project_id` (required)
  - `scope_kind`: project | subproject | stages
  - Stage links in `rfx_scope(rfx_id, stage_id)` when the kind is stages. A sub-project is a `projects` row with parent_id, so project_id is the sub-project.
  - category_id
  - `procedure`: open (all approved suppliers in the category) | selective (invited only)
  - template_id, evaluation fields copied from the template
- Money: estimate (internal budget, never shown to bidders; prefill from the scope's stage budgets and budget lines), currency.
- Dates: `publish_at`, `clarification_deadline`, `site_visit_at` + `site_visit_note`, `closing_at` (a datetime), `opening_at`, `validity_days`.
- Contract terms (copied to the assignment on award): bid_bond_pct, performance_bond_pct, advance_pct, retention_pct, payment_days, payment_terms, contract_start, contract_end.
- People and outcome:
  - `owner_id` (procurement officer)
  - tender board: chair + members in `rfx_committee` (user_id, role = chair | member | secretary | observer, steps json of the steps they evaluate, `coi_declared_at`)
  - `status`, `awarded_bid_id`, `assignment_id`, `cancel_reason`, created_by, created_at
- **Statuses and transitions:**
  1. `draft` → **Submit for approval** (approval engine doc type **`rfx_publish`**: thresholds on the estimate in entity currency; add default workflows for AE and OM) → `pending_approval` → on approval → `published` (or `scheduled` if publish_at is in the future). On publish, send the **invitation email** and notification to every eligible supplier: approved, the category approved, the same entity, no blocking expired document; for the selective procedure, the invited ones only.
  2. `published`: bidding is open. While published:
     - suppliers ask questions until `clarification_deadline` (`rfx_clarifications`: question, asked_by subcontractor, answer, answered_by, published_at). Answers are published **anonymously to all bidders**.
     - the owner issues **addenda** (`rfx_addenda`: no, title, description, attachment, `new_closing_at` nullable). Each addendum notifies every bidder and invitee, and bidders must acknowledge it (`rfx_addendum_acks`) before submitting.
     - the owner can extend the closing date, which is always through an addendum.
  3. `closed`: set **lazily** whenever the tender is read or listed and `now >= closing_at` (a `refreshRfxStatuses()` helper, called from the queries), plus an audited admin action **"Close bidding now"** for tests and demos. Late submissions are refused **on the server**.
  4. `opening` → **Tender board opening.** On `/procurement/tenders/[id]?tab=opening` the secretary records the opening: date/time, attendees (committee members present plus a free-text observer), and a *bid register* (bidder, received at, receipt hash, bid bond yes/no, withdrawn/late notes). For two-envelope tenders, only the **technical envelope** is opened first and prices stay sealed. Minutes text, with a PDF of the opening register (react-pdf).
  5. `evaluation`. The steps run in order. Per bid and step:
     - pass_fail steps: each requirement is marked compliant / non-compliant, with a comment.
     - scored steps: each evaluator scores each criterion 0..max, with a comment. The step score per bid is the average across evaluators of the criteria total, normalised to 100.
     - A bid that fails a gate or scores below the pass mark is **disqualified from the next steps**, with a reason, and this is visible in the matrix.
     - The owner can request a **clarification from a bidder** during evaluation (a portal message with an optional document; answer by date).
     - **Commercial step:** for two-envelope tenders, a second opening event unseals the commercial envelopes of the technically qualified bids only. It includes:
       - an **arithmetic check** (the system recomputes the BOQ totals and flags differences)
       - a **comparison sheet**: BOQ lines × bidders, unit rates and amounts side by side, the lowest per line highlighted, the estimate column, the variance % vs the estimate, totals, VAT shown separately
       - a commercial score of `lowest_price / bid_price × 100`
       - a final weighted score of `tech × tech_weight + commercial × commercial_weight`
       - a ranking. Lowest_compliant tenders rank by price among compliant bids.
     - Optional **negotiation/BAFO** round with the top-ranked bidder(s): a portal request asking for a revised price by a date. The revised BOQ is stored as a new price version, and the original stays visible.
  6. `recommended`. The owner picks the recommended bid. A justification is required, and **mandatory if it is not rank 1**. The final contract value defaults to the bid total (or BAFO), with an optional negotiated value. A committee sign-off list asks each member to concur or dissent with a comment. A recommendation report (page + PDF) gives the summary, the scores matrix, the comparison, and the budget vs award with the variance.
  7. **Submit award for approval** (approval engine doc type **`rfx_award`**: amount = award value, thresholds in entity currency; add default AE/OM workflows, e.g. ≤ 250k: Procurement Mgr → PM; > 250k: + Finance Mgr → Country/GM; OMR thresholds scaled per the existing Oman approach). Then `award_pending`.
  8. `awarded`. **`onApproved` creates the assignment automatically**, inside the engine transaction, using the existing assignment-creation code path (refactor `saveAssignment`'s insert into a shared helper, so codes, the portal token, FX and the activity log stay identical):
     - project_id, stage_id (the first stage in scope, or null for project/sub-project scope; if the scope has several stages, store the stage list in `assignment_stages` or use the scope text, at your choice, but keep the existing single `stage_id` working)
     - subcontractor, scope text, contract_value = award value, quantity/unit/unit_rate from the BOQ when there is a single main line, dates, payment terms, advance, retention, payment days
     - `status = 'active'`, the portal enabled like a direct assignment
     - `assignments.source = 'tender'` (new column, default `'direct'`), `assignments.rfx_id`, `assignments.rfx_bid_id`

     It also:
     - sets the winning bid to `awarded` and the others to `unsuccessful`
     - emails the **Letter of Award** (PDF attachment link to the award letter route) to the winner and **regret letters** to the others, plus portal notifications
     - logs to the project, the assignment and the rfx

     `onRejected` / `onReturned` go back to `recommended`.
  9. `cancelled` is possible from any state before awarded, with a reason, and it notifies the bidders.
- **Sealed-bid rule (enforced in queries, not just the UI).** Until the relevant opening event, internal users see only that a bid exists, the submitted-at timestamp and the receipt hash. They see no prices, no technical documents and no bid content. Prices stay sealed until the commercial opening (two-envelope) or the single opening. Suppliers only ever see **their own** bid, and after the award only their own result: never competitors' names or prices. The files API must enforce the same rules for bid attachments.
- **Separation of duties.** A committee member who is linked to a bidder (a COI declaration "yes") cannot score that tender. The award approver cannot be the person who recommended. Reuse the engine's same-user rules if they exist; otherwise enforce it in the rfx actions.

### B3. Bids
- `rfx_bids` (id, rfx_id, subcontractor_id, status = draft | submitted | withdrawn | late_refused | disqualified | qualified | awarded | unsuccessful, submitted_at, receipt_hash (sha256 of the bid content plus the timestamp), total_amount, discount_amount, vat_amount, validity_days, deviations, alternative_offer, bid_bond_ref, `price_version`, disqualified_step, disqualify_reason, rank, tech_score, commercial_score, final_score).
- `rfx_bid_responses` (bid_id, requirement_id, value_text, value_number, attachment_id, compliant nullable, eval_comment).
- `rfx_boq_lines` (rfx_id, item_no, description, unit, quantity, stage_id nullable, estimate_rate (internal)). Prefill them from the scope's `project_budget_lines` and stage quantities. The owner can edit them in draft.
- `rfx_bid_prices` (bid_id, boq_line_id, version, unit_rate, amount).
- `rfx_scores` (bid_id, step_id, criterion_id nullable, evaluator_id, score, compliant nullable, comment, created_at).
- `rfx_invitations` (rfx_id, subcontractor_id, invited_at, viewed_at, intent = pending | interested | declined, decline_reason).
- `rfx_events` holds the openings and other board events (rfx_id, kind = tech_opening | commercial_opening | opening | bafo_request | clarification_request, at, attendees_json, minutes, created_by).

### B4. Internal UI
- **Sidebar:** add **Procurement** (module `procurement`) after Projects. Its pages:
  - `/procurement`, the supplier tenders list:
    - KPI tiles: open tenders, closing in 7 days, bids received, in evaluation, award pending, awarded value this year with savings vs estimate
    - status tabs and filters: project, category, owner, country
    - table columns: code, title, project / scope, category, procedure, closing (with countdown), bids, status chip, estimate
  - `/procurement/new?project=..&stages=..` and `/procurement/[id]/edit`, the draft editor (sections below)
  - `/procurement/[id]`, the detail page, with tabs:
    - **Overview:** a status stepper of the template steps and lifecycle, key dates, scope, terms, invitee/eligible count
    - **Requirements & BOQ**
    - **Suppliers:** eligible/invited, with viewed/interested/declined and bids
    - **Clarifications**
    - **Addenda**
    - **Opening**
    - **Evaluation:** a matrix of bids × steps, plus per-step score entry for the logged-in evaluator
    - **Comparison**
    - **Recommendation & award**
    - **Approvals**: the generic approval panel
    - **Documents**
    - **Activity**
  - `/procurement/setup/templates`
- **Draft editor sections:**
  1. Scope: project / sub-project / stages (multi-select from the project tree; stages that are already assigned or already in another live tender are disabled with a reason), title, scope of work, category.
  2. Procedure & template.
  3. Dates, validated: publish < clarification < closing ≤ opening.
  4. Terms.
  5. BOQ.
  6. Requirements and steps, copied from the template and editable.
  7. Committee.
  8. Tender documents: attachments such as drawings, specs, conditions of contract and the BOQ, all visible to bidders.
  9. Invitees (selective procedure).
- **Project integration:**
  - On the project **Subcontracts tab**, show two primary actions: **Assign directly** (the existing form, unchanged) and **Float a tender** (opens the new RFx prefilled with this project, or with this stage from a row action).
  - On the Stages list and the map stage popups, a stage that is in a live tender shows a chip "Out to tender · RFX-2026-007 · closes 12 Dec", and a stage awarded through a tender shows "Awarded via RFX-…".
  - Add a **Procurement** section to the project Overview (the tenders for this project).
  - The assignment detail and list show the source: a "Tender RFX-…" link or "Direct".
- **Dashboard:** add a compact "Procurement" card with open tenders, closing this week, pending registrations and awards pending approval. Keep the layout at 1024.
- The approvals inbox shows the `rfx_publish` and `rfx_award` doc types, with the country flag like the others.

### B5. Supplier portal (approved suppliers)
New nav: **Tenders** (badge = open opportunities not yet bid). Pages:
- `/p/<slug>/tenders` has these tabs:
  - **Opportunities:** published tenders the supplier is eligible for (invited, or open + a category match + the same entity)
  - **My bids:** draft / submitted / results
  - **Closed**
  - **Awarded**
- `/p/<slug>/tenders/[id]` shows the scope, dates with a countdown, tender documents (download), addenda (with acknowledge), the public Q&A, and **Ask a question** (until the clarification deadline). It also has **Interested / Decline (reason)**.
- **Bid workspace** `/p/<slug>/tenders/[id]/bid` has three steps:
  1. technical envelope requirements (upload, text, number, yes/no per requirement, with a mandatory indicator)
  2. commercial envelope: the priced BOQ table (unit rate inputs, live line amounts, subtotal, discount, VAT at the entity rate, total in the entity currency with 3 decimals for OMR, deviations, validity)
  3. a review & submit checklist: every mandatory item present, every addendum acknowledged, no blocking expired registration document, before the deadline

  **Submit** shows a confirmation, then a receipt (hash and timestamp) and sends the email. The bidder can **revise** (each revision replaces the previous one, with history) or **withdraw** until closing. After closing it is read-only. Show a clear message on a late attempt.
- After the award the supplier sees "Awarded — Letter of Award" (PDF) or "Not successful". The awarded tender links to the new assignment in the existing portal Projects pages.
- Respond to evaluation clarification and BAFO requests from the tender page, with notification badges.
- **Portal role permissions** (portal-perms.ts): `admin` and `estimator` (new portal role "Tendering") can bid. `viewer` can only view.

### B6. Permissions
New module `procurement` in the "Procurement" group, with actions: `view, create, edit, publish, open, evaluate, recommend, award, cancel, setup, export`. Role defaults:
- **admin:** all
- **procurement:** all except award
- **project_manager:** view, create, evaluate
- **engineer:** view, evaluate
- **finance:** view, evaluate (commercial), export
- **viewer:** view

Evaluation entry is further limited to committee members of that tender.

---

## Part C — Demo data (seed) and quality

### C1. Seed (both entities; keep the UAE identity of existing rows)
Run as a new **procurement phase after both regions** in `npm run seed`. It appends rows, so the existing ids stay the same. Region-specific content goes in `seed-regions` profiles (a `procurement` section) and the engine in `src/lib/seed-procurement.ts`.

- **Suppliers.**
  - Existing approved subcontractors get a full registration profile: categories, contacts, bank, 2–3 experience rows, the mandatory documents (placeholder PDFs generated like the existing seeded files), and a registration history row "approved".
  - Add **8 more approved suppliers per entity** that bid but did not win (or won only a few), using realistic fictional local company names (UAE: Emirati/Dubai-style LLCs; Oman: Omani SAOC/LLC names, e.g. "Al Batinah Fibre Works LLC"), with `-demo` email domains like the existing ones.
  - Add a **registration pipeline per entity**: 1 draft, 2 submitted, 1 under review (reviewer assigned, some items accepted), 1 referred back (3 queried items with comments, an email in the outbox), 1 resubmitted (second round), 1 rejected (reason), 1 approved this week.
- **Templates:** the 4 above (entity null), plus the default `rfx_publish` and `rfx_award` workflows per entity.
- **Historic tenders (the user's request: about 80 % of the existing assignments came through tendering).**
  - For each entity, pick **32 of the 40 assignments** (all statuses: completed, active, suspended, terminated, draft). Spread them across projects and keep the other 8 as `source = 'direct'`.
  - For each picked assignment, create an `awarded` RFx whose dates sit before the assignment's start: published 35–60 days before, closing about 21 days later, then opening, evaluation and award ~7–14 days before the assignment start.
  - Use the template that fits the category: telecom → template 1, pipelines → template 2, small → 3.
  - **3–6 bidders** each: the existing assignment's subcontractor is the winner. Its bid total equals the assignment `contract_value` (a BAFO version in ~25 % of cases where the original was higher). The other bidders' totals vary from −8 % to +28 % vs the winner. Occasionally a lower bidder failed technical or HSE, with a realistic reason ("HSE plan did not cover confined-space work", "insufficient HDD equipment").
  - Each tender also gets:
    - BOQ lines derived from the stage budget lines
    - priced lines for each bid
    - responses for every requirement
    - scores from 2–3 committee members that are consistent with the ranking
    - opening events with attendees
    - 0–3 clarifications
    - an addendum in ~30 %
    - an approved `rfx_award` approval request with its events
    - `assignments.source/rfx_id/rfx_bid_id` set
    - activity entries and outbox emails (award + regrets)
  - **Assignment rows must not change** apart from the new `source`/`rfx_*` columns.
- **Live tenders per entity** on currently unassigned stages (10 per entity exist; you may also create 1 new sub-project per entity for a project-level tender), so that every status is demoable:
  - 1 draft
  - 1 pending_approval (an open approval task for the admin)
  - 2 published (one closing in about 5 days with 2 bids submitted and 1 draft bid, a clarification and an acknowledged addendum; one closing in about 14 days with invitations only)
  - 1 closed awaiting opening (bids sealed)
  - 1 in technical evaluation (partially scored)
  - 1 in commercial evaluation (comparison sheet filled)
  - 1 recommended
  - 1 award_pending (an open `rfx_award` approval task)
  - 1 cancelled
  - Make sure the demo portal suppliers (e.g. `/p/gulf-trench`, `/p/al-hajar`) have open opportunities, a draft bid and a submitted bid, so a portal demo shows the full flow.
- **Demo logins:** document them in the README.
  - The new procurement users.
  - A pending-registration supplier login per entity, e.g. a referred-back one, password `Portal@123`.
  - The `/suppliers` landing and `/suppliers/login`.

### C2. Checks and tests
- `npm run check:demo` gets procurement coverage per entity:
  - every rfx status exists
  - every registration status exists
  - 80 % ±2 of assignments have `source = 'tender'`
  - every awarded RFx has exactly 1 awarded bid whose total equals the assignment contract value (or its BAFO version)
  - sealed tenders have no internal-visible prices (call the query layer)
  - the outbox has every template
  - FX/USD columns are filled on the new money tables
- Keep tsc, lint, calc.check, check:demo and the full e2e green. Run e2e isolated (own DB, uploads, dist and port). **Never touch :3100 and never `pkill next-server`.**
- Add **`tests/e2e/supplier-registration.spec.ts`**:
  1. Register on `/suppliers/register`, complete the steps, upload the docs and submit.
  2. An internal reviewer queries 1 doc and refers back.
  3. The outbox has the email, and the supplier portal shows the banner and checklist.
  4. The supplier re-uploads and resubmits.
  5. The reviewer approves, and the portal is unrestricted.
- Add **`tests/e2e/supplier-tendering.spec.ts`**:
  1. From a project stage, choose Float a tender, pick a template and publish (approve via the inbox).
  2. Two suppliers bid in the portal.
  3. A late bid after "Close bidding now" is refused.
  4. Before opening, the internal page shows no prices.
  5. Open, evaluate (score), compare, recommend, then approve the award.
  6. The assignment exists on the project with source tender and the right value.
  7. The winner sees "Awarded" and the loser "Not successful", with no competitor data.
  8. Direct assignment still works.
- Layout: check every new page at **1024px** (the user's screen) and 1280; check the public `/suppliers` pages at 390 too. Keep the BizBook look (THEME_SPEC).
- Update the README, docs/FOUNDATION.md (the entity rule for the new tables, the sealed-bid rule and the mail outbox) and DEMO_DATA_SPEC.md.
- Back up `data/ops.db` to `data/backup/ops-<date>-before-procurement.db` **before** the dev server hot-reloads the migration: copy it first, as the very first step of the work. Then reseed `data/ops.db` at the end.
