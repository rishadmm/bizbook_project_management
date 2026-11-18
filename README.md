# BizBook Project - Tender-to-Project Management (Project module of BizBook ERP)

Single-company web app for an infrastructure contractor (road, cable, pipeline, telecom, civil). It follows work from bid to delivery:

**Tender -> departmental preparation -> detailed budget (BOQ) with per-line margin -> internal review -> submission -> negotiation and revisions -> Won / Lost.**
Lost tenders get a loss analysis. Won tenders become **projects** with map, stages, subcontract assignments, progress, invoices, completion certificates and budget/schedule control dashboards (EVM, delay attribution). Subcontractors work through a **login-based portal** per company (`/p/<slug>`: dashboard, project monitoring, progress updates, invoices, payments, issues/RFIs, documents, team) and the legacy token quick-update link (`/portal/<token>`). Clients follow their projects through a **read-only client portal** (`/c/<slug>`: dashboard, live map, project pages, printable reports, photos, issues). Sensitive steps run through a configurable **approval engine**, and access is controlled by **roles and permissions (RBAC)**.

## Modules

| Module | Routes | What it does |
|---|---|---|
| Dashboard | `/` | Executive dashboard: pipeline funnel, win rate, deadlines, project health (RAG), portfolio SPI/CPI, delay attribution, late subcontractors, pending approvals, expiring documents, active-projects map (with a Full screen link to the Live Ops Map) |
| Tenders | `/tenders`, `/tenders/new`, `/tenders/[id]` | Kanban/table pipeline. Detail tabs: Overview (workflow actions, Mark Won/Lost), Departments, Budget/BOQ (inline edit, margin reason log, bulk markup, CSV import/export), Commercial & Negotiation (revisions, negotiation log), Reviews, Documents, Approvals, Activity |
| Loss analysis | `/lost-analysis`, `/lost-analysis/[id]` | Loss register, charts, lessons-learned library |
| Clients & client portal | `/clients`, `/clients/[id]` (tab `?tab=portal`), `/c/[slug]/…` | Client master with tender/project history. The **Portal access** tab manages the client's read-only portal: URL, visibility switches (subcontractor names, financials), users and project scope, one-time credentials, login activity and a read-only "open portal as client" |
| Projects | `/projects`, `/projects/[id]`, `/projects/[id]/stages/[stageId]` | Cards/table/map views; tabs Overview, Map (draw/edit, split a route into stages, open in Live Ops Map), Stages, Sub-projects, Subcontracts (portal links), Progress (verify portal reports), Budget & Cost, Invoices & Certificates, Delays & Issues, Documents, Activity |
| Live Ops Map | `/map` (`?project=<id>&segment=<key>&color=<mode>&date=YYYY-MM-DD`) | Full-screen operations map: projects rail, project drawer with line of balance and delay causes, colour-by (health, subcontractor, delay cause, cost, staleness), time slider with playback, plan-vs-actual comparison, shareable URL state |
| Subcontractors & portal | `/subcontractors`, `/subcontractors/[id]` (tab `?tab=portal`), `/p/[slug]/…`, `/portal/[token]` | Directory, onboarding checklist and approval, documents with expiry, assignments with performance, invoices, certificates. The **Portal access** tab manages the company's portal URL, users, one-time credentials, login activity, change requests and a read-only "view as subcontractor". The legacy token portal (`/portal/[token]`) keeps working as a quick-update link |
| Invoices | `/invoices` | Cross-project invoice queue: review, certify, approve, pay, reject |
| Approvals | `/approvals`, `/admin/approval-workflows` | Multi-level approval engine: inbox, history, delegations, workflow designer with live preview, per-document-type rules (Settings > Approvals) |
| Admin / RBAC | `/admin/users`, `/admin/roles`, `/admin/audit` | Users, roles and permission matrix, per-user overrides, lockout/unlock, audit log |
| Settings | `/settings` | Company (group), Countries (legal entity, currency, tax, VAT, prefix, approval limit), Currencies & FX rates (USD, re-value action), approval thresholds and "approval required" toggles per document type, departments |
| Search | `/search?q=` | Global search (tenders, projects, subcontractors) |

Business rules: `SPEC.md` (metrics are defined once in `src/lib/metrics.ts`). Developer reference: `docs/FOUNDATION.md`. Auth/RBAC/approvals: `AUTH_SPEC.md`. Theme: `THEME_SPEC.md`. Live Ops Map: `MAP_SPEC.md`.

## Demo credentials

Demo seed only - never use in production. `npm run seed` prints the full list.

| User | Email | Password | Role |
|---|---|---|---|
| Omar Al Farsi | `admin@alnoor.demo` | `Admin@12345` | Super admin |
| Layla Hassan | `layla.hassan@alnoor.demo` | `Password@123` | Project manager |
| Rahul Menon | `rahul.menon@alnoor.demo` | `Password@123` | Estimator |
| Sara Khalid | `sara.khalid@alnoor.demo` | `Password@123` | Engineer |
| Imran Qureshi | `imran.qureshi@alnoor.demo` | `Password@123` | Finance |
| Mariam Khoury | `mariam.khoury@alnoor.demo` | `Password@123` | Finance |
| Aisha Rahman | `aisha.rahman@alnoor.demo` | `Password@123` | Procurement |
| Hamdan Al Zaabi | `hamdan.al.zaabi@alnoor.demo` | `Password@123` | Management |
| Fatima Al Ali | `fatima.al.ali@alnoor.demo` | `Password@123` | HR |
| Noura Saeed | `noura.saeed@alnoor.demo` | `Password@123` | Viewer (read-only) |

Other seeded users (Daniel Cruz, Tariq Mahmood) use `first.last@alnoor.demo` / `Password@123`. Five wrong passwords lock an account until an admin unlocks it.

## Run it

```bash
npm install
npm run seed      # wipes data/ops.db and uploads/ in place and loads the UAE + Oman demo data (one company, two countries)
npm run dev       # http://localhost:3100
```

Other scripts: `npm run build`, `npm start` (port 3100), `npm run lint`, `npm run check:demo`, `npm run test:e2e`.

`npm run seed` also prints the subcontractor **portal links** (`http://localhost:3100/portal/<token>`) for active assignments; you can copy a link from a project's **Subcontracts** tab. New assignments start with the portal disabled.

### One company, two countries (UAE + Oman)
**Al Noor Infrastructure LLC** operates in the **UAE** (AED) and in **Oman** (OMR) from **one app and one database**. Everything a user sees (dashboard, lists, map, reports, approvals, invoices, search) belongs to the **active country**, chosen with the switcher in the top bar (left of the company pill: flag, country, currency; flag + code below 1280 px wide). Users only see the countries they are granted (Users > country access; administrators see both); a user with one country gets a static flag chip instead of the switcher. A detail page of the other country shows an info bar ("This project belongs to Oman · Switch to Oman") in that record's currency; a country the user cannot access is a 404 everywhere (pages, files, PDF, ERP payload, map, search, approvals).

- **Countries** (`entities`: AE and OM) carry legal name, currency, VAT, tax label / number (TRN / VATIN), CR no., address, map centre, document prefix (`""` / `OM-`, so `PRJ-2026-001` and `OM-PRJ-2026-001`, with a sequence per country) and the approval threshold. Settings > **Countries** edits them; Settings > **Currencies & FX rates** keeps the USD rate history and has the audited "Re-value from date" action.
- **USD equivalents** (reporting currency USD, stored at table level for later consolidation): every money table has `currency`, `fx_rate_usd` (locked at the row's date by an AFTER INSERT trigger) and `fx_date`, plus a virtual generated `<amount>_usd` column. Invoice detail shows "≈ USD 35,914.20 (rate 2.600780, 08 Aug 2026)", the project's contract value has a USD tooltip. Pegs: AED 0.272294, OMR 2.60078.
- Documentation of the model (entity inheritance rule, request-scoped currency, triggers): `docs/FOUNDATION.md` ("Multi-country operations"). Specification: `MULTI_COUNTRY_SPEC.md`.

`npm run seed` seeds the **UAE profile first** (ids unchanged), then the **Oman profile** (Al Noor Infrastructure LLC – Oman Branch; clients MTCIT, Omantel, PDO, Muscat Municipality, OXY, Ooredoo Oman, Nama Water Services; fictional Omani subcontractors; projects on real Oman geometry) into the same database. Both profiles live in `src/lib/seed-regions/{uae,oman}.ts`; the engine (`src/lib/seed-engine.ts`, `seed-portal`, `seed-client-portal`, `seed-invoices`, `approvals/seed-demo`) is region-neutral. `npm run check:demo` checks both countries (per-country coverage on an extract of that country's rows, the Oman leak scan restricted to Oman rows, USD-layer and consistency assertions).

| Who | Login | Countries |
|---|---|---|
| Admin (switcher visible) | `admin@alnoor.demo` / `Admin@12345` | UAE + Oman (starts in the UAE) |
| Oman-only staff (no switcher) | `aisha.al.lawati@alnoor.demo` (PM), `hamed.al.rawahi@alnoor.demo` (country manager), `maryam.al.balushi@alnoor.demo`, `fatma.al.hashmi@alnoor.demo`, `asma.al.harthy@alnoor.demo`, `noor.al.zadjali@alnoor.demo` (viewer), `mariam.al.kindi@alnoor.demo` (finance) / `Password@123` | Oman |
| Shared staff | `rahul.menon@`, `imran.qureshi@`, `daniel.cruz@`, `tariq.mahmood@`, `hamdan.al.zaabi@`, `mariam.khoury@` `…alnoor.demo` / `Password@123` | UAE + Oman |
| Client portals `/c/mtcit`, `/c/omantel`, `/c/pdo` (financials hidden), `/c/oxy` (subcontractor names hidden), `/c/ooredoo` | `nasser.riyami@mtcit-demo.om`, `fatma.shukaili@omantel-demo.om`, `ahmed.mahrouqi@pdo-demo.om`, `daniel.whitaker@oxy-demo.om`, `salma.dhahli@ooredoo-demo.om` / `Portal@123` | Oman (OMR, tenant "Al Noor Infrastructure LLC – Oman Branch") |
| Subcontractor portals `/p/al-hajar`, `/p/sohar-trenching`, `/p/muscat-fibre` ... | owner e-mails are printed by `npm run seed` / `Portal@123` | Oman |

### Subcontractor portal (login per company)
Every subcontractor has a portal address `http://localhost:3100/p/<slug>` (slug editable in **Subcontractors → Portal access**). Staff with `subcontractors/portal` create the portal users (temporary password shown once, copy / print) and can open a read-only admin view. Portal sessions are completely separate from internal sessions (`bbp_portal` cookie, `portal_*` tables, `lib/portal-auth.ts`): the subcontractor id always comes from the session, never from the URL; every query filters by it; foreign ids return 404 and foreign files 403. Specification: `PORTAL_SPEC.md`.

Demo portal logins (after `npm run seed`; password **`Portal@123`** for every demo portal user; one user must change it at first sign-in, one is locked, one disabled; the seed prints the full list):

| Company | Portal URL | Owner e-mail |
|---|---|---|
| Gulf Trench & Cable Works | `http://localhost:3100/p/gulf-trench` | `bilal.siddiqui@gulftrenchcabl-demo.ae` |
| Desert Rock Earthworks | `http://localhost:3100/p/desert-rock` | `mohammed.faisal@desertrockeart-demo.ae` |
| Emirates Asphalt & Paving | `http://localhost:3100/p/emirates-asphalt` | `ahmed.younis@emiratesasphal-demo.ae` |
| Falcon Telecom Infrastructure | `http://localhost:3100/p/falcon-telecom` | `karim.haddad@falcontelecomi-demo.ae` |

The sign-in page also shows the demo credentials as a hint in development. E2E: `tests/e2e/portal-auth.spec.ts` (credentials flow, company isolation, progress + invoice submission, lock-outs, read-only admin view).

### Client portal (read-only, one URL per client)
Every client with projects has a portal address `http://localhost:3100/c/<slug>` (slug editable in **Clients → Portal access**, permission `clients/portal`). Client users (roles `admin` and `viewer`, both read-only; admins also see the Team page) see **only their own projects** (optionally narrowed per user with a project scope): dashboard (KPIs, portfolio map, project health cards, S-curve, delays by cause, milestones, verified progress feed), projects with Overview / Map / Schedule / Progress / Photos / Issues & delays / Reports tabs, the **Live map** (the Live Ops Map in client mode: Health / Delay cause / Staleness colouring, time machine and forecast, no cost views), printable reports with CSV export (project progress, schedule & forecast, issues & delays, monthly summary), a photo gallery and issues. The portal has **no server actions except** sign in/out, change password and sign out other sessions.

Security model (same shape as the subcontractor portal, separate identity): cookie `bbp_client`, tables `client_users` / `client_sessions` / `client_auth_events`, `lib/client-portal-auth.ts` (`requireClientUser(slug)`; the client id always comes from the session, every query filters by it and the user's project scope; another client's project id is a 404, another client's slug redirects to the own portal). Internal, subcontractor-portal and client sessions never open each other's pages. **Data hygiene:** costs, CPI, budgets, subcontract values, invoices, internal notes and unverified reports never reach the browser; the map payload is stripped server side (`features/client-portal/map-server.ts`, hydrated client side by `map-payload.ts`). Subcontractor names show only when *Show subcontractor names* is on (otherwise "Contractor crew A/B"); contract value and value of work done only when *Show financials* is on. `/api/files/[id]` serves a client session only the files of **verified** progress reports and Drawings / Reports / Permits / Photos attachments of that client's projects. Specification: `CLIENT_PORTAL_SPEC.md`.

Demo client portals (after `npm run seed`; password **`Portal@123`** for every demo user; one user must change it at first sign-in, one is disabled; the seed prints the list). Clients without projects (Dubai Municipality, Gulf Logistics Cooperative) have no portal.

| Client | Portal URL | Admin e-mail | Notes |
|---|---|---|---|
| Roads & Transport Authority | `http://localhost:3100/c/rta` | `khalid.mansoori@rta-demo.ae` | viewer `noor.hashimi@rta-demo.ae` |
| Etisalat-like Telecom | `http://localhost:3100/c/etisalat-telecom` | `mona.suwaidi@telco-demo.ae` | `hassan.qureshi@telco-demo.ae` sees only PRJ-2026-002 |
| Water & Electricity Authority | `http://localhost:3100/c/water-electricity` | `yousef.rahimi@wea-demo.ae` | financials hidden; `latifa.ketbi@wea-demo.ae` must change the password |
| Skyline Developments | `http://localhost:3100/c/skyline` | `james.whitfield@skyline-demo.ae` | `amelia.grant@skyline-demo.ae` is disabled |
| Abu Dhabi Mobility | `http://localhost:3100/c/ad-mobility` | `saeed.dhaheri@admobility-demo.ae` | subcontractor names hidden |

E2E: `tests/e2e/client-portal.spec.ts` (credentials flow, client isolation, read-only by construction + stripped map payload, visibility switches, disabled portal / user / lock-out, read-only admin view).

Existing databases upgrade in place on first start (`src/lib/migrate.ts`: auth columns, roles, approval workflows, one-time grant of Live Ops Map access to every role that can view projects; SCHEMA_VERSION 9 adds supplier registration, the e-mail outbox and the procurement permissions; SCHEMA_VERSION 8 adds countries, currencies, FX rates, country access and the USD columns/triggers; existing rows become UAE).

### Supplier registration and prequalification
Suppliers (subcontractors) register themselves: public pages `http://localhost:3100/suppliers` (landing with country picker, categories and the tender notice board), `/suppliers/register` (account step; the other seven steps run in the portal at `/p/<slug>/registration`), `/suppliers/login` (one sign-in for all countries, chooser when an e-mail belongs to several suppliers, forgot password with a one-time reset link `/suppliers/reset/<token>`). Public forms are protected by a honeypot field and an in-memory rate limit. A supplier whose registration is not approved has a **restricted portal** (Dashboard, Registration, Documents, Account; everything else is refused on the server) with a status banner and, when referred back, a checklist of the queried items. Internal review: **Subcontractors > Registrations** (queue with SLA chips), review page `/subcontractors/<id>/registration` (accept / query per section and document, refer back, approve with categories + grade + validity through the `subcontractor_onboarding` workflow, reject; admins can reopen), **Categories** and **Document types** setup (`subcontractors/setup`). Every mail is recorded in **Admin > Email outbox** (`/admin/email-outbox`); with `SMTP_URL` + `MAIL_FROM` set it is also delivered through nodemailer, otherwise it is only logged (demo mode). Developer notes: `docs/FOUNDATION.md` (Supplier registration + procurement foundation).

Demo logins (password **`Portal@123`** for suppliers, **`Password@123`** for staff; `npm run seed` prints the list):

| Who | Login |
|---|---|
| Procurement users | `rashid.al.mazrouei@alnoor.demo` (Procurement Manager, UAE), `asma.al.harthy@alnoor.demo` (Oman), `aisha.rahman@alnoor.demo` (UAE) |
| UAE referred-back supplier | `pradeep.nair@sharjahcoating-demo.ae` (`/p/sharjah-coating`) |
| Oman referred-back supplier | `saud.hosni@soharpipe-demo.om` (`/p/sohar-pipe`) |
| Other pipeline suppliers | draft `fahad.nuaimi@ajmanducttrenc-demo.ae` / `majid.zadjali@barkahorizontal-demo.om`; rejected `imran.sheikh@gulfgeneraltra-demo.ae` / `vikram.singh@seebgeneral-demo.om`; resubmitted `hassan.zaabi@raktrafficsafe-demo.ae` / `ibrahim.shehhi@musandamtraffic-demo.om` |

### Supplier tendering (Procurement)

Tendering is the **optional** second route from a project to a subcontract (direct assignment on the project's Subcontracts tab stays as it is: **Assign directly** / **Float a tender**). Sidebar **Procurement** (`/procurement`): KPI tiles, status tabs and filters; `/procurement/new?project=..&stages=..` (scope, template), `/procurement/<id>/edit` (draft editor: details, dates, terms, BOQ, requirements and steps, board, invitees, documents), `/procurement/<id>` (tabs Overview, Requirements & BOQ, Suppliers, Clarifications, Addenda, Opening, Evaluation, Comparison, Recommendation & award, Approvals, Documents, Activity), `/procurement/setup/templates` (4 seeded templates, editable and duplicable). PDFs (react-pdf): `/procurement/<id>/opening-register`, `/recommendation`, `/award-letter`; the supplier gets the Letter of Award at `/p/<slug>/tenders/<id>/loa`. Lifecycle: draft -> pending approval (`rfx_publish`) -> published / scheduled -> closed (lazy, or the audited **Close bidding now**) -> opening -> evaluation -> recommended -> award pending (`rfx_award`) -> awarded (the subcontract is created automatically, `assignments.source = 'tender'`) / cancelled.

**Sealed-bid rule** (enforced in `src/features/procurement/bid-core.ts` and the files API, not only in the UI): before the opening internal users only see that a bid exists, its submission time and receipt hash; two-envelope tenders open the technical envelope first and unseal prices of the technically qualified bids at the commercial opening. Suppliers only ever see their own bid and, after the award, their own result. Separation of duties: scoring only by board members who declared no conflict of interest; the person who recommended the bidder cannot approve the award.

Supplier portal: **Tenders** (badge = open opportunities not yet bid, plus open requests): tabs Opportunities / My bids / Closed / Awarded, tender page (documents, addenda with acknowledge, public Q&A, interested / decline) and the 3-step bid workspace (technical envelope, priced BOQ with live totals, review and submit with receipt hash). Portal roles: owner and manager bid, the new **Tendering** role bids, viewer and site engineer only view.

Demo walkthrough (`npm run seed` prints it; both countries have the same 12 live tenders, `RFX-2026-033..044` in the UAE and `OM-RFX-2026-033..044` in Oman):

| Status | UAE (project / stage) | Oman |
|---|---|---|
| draft / pending approval / scheduled | PRJ-2026-012 S1 / S2 / S3 (FTTH Phase 2) | OM-PRJ-2026-012 S1 / S2 / S3 |
| published, closing in ~5 days (2 bids + a draft bid, clarification, addendum) | PRJ-2026-006 S1 | OM-PRJ-2026-011 S1 |
| published, selective, closing in ~14 days (invitations only) | PRJ-2026-006 S2 | OM-PRJ-2026-011 S2 |
| closed, bids sealed | PRJ-2026-011 S1 | OM-PRJ-2026-006 S1 |
| opened, evaluation not started | PRJ-2026-011 S2 | OM-PRJ-2026-006 S2 |
| technical evaluation (partially scored, prices sealed) | PRJ-2026-003 S4 | OM-PRJ-2026-003 S4 |
| commercial evaluation (comparison sheet, arithmetic check, open BAFO request) | PRJ-2026-008 S3 | OM-PRJ-2026-008 S3 |
| recommended | PRJ-2026-011 S3 | OM-PRJ-2026-011 S3 |
| award pending (open `rfx_award` task) | PRJ-2026-004 S4 | OM-PRJ-2026-004 S4 |
| cancelled | PRJ-2026-001 S6 | OM-PRJ-2026-001 S6 |

Portal demo suppliers: UAE `/p/gulf-trench` (`bilal.siddiqui@gulftrenchcabl-demo.ae`, password `Portal@123`) has an open opportunity (selective tender), a draft bid (published tender), a submitted bid (commercial evaluation) and awards; Oman `/p/al-hajar` (`said.busaidi@alhajar-demo.om`) the same with the road tenders. Staff: `rashid.al.mazrouei@alnoor.demo` / `aisha.rahman@alnoor.demo` (UAE) and `asma.al.harthy@alnoor.demo` (Oman) run the tenders; approvals go to `hamdan.al.zaabi@alnoor.demo` (management), finance and the project managers. Mails (invitations, receipts, Letter of Award, regrets) are in **Admin > Email outbox**. E2E: `tests/e2e/supplier-tendering.spec.ts`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPS_DB_PATH` | `data/ops.db` | SQLite file used by the app, the seed and the tests |
| `OPS_UPLOAD_DIR` | `uploads/` | Where uploaded files are stored |
| `NEXT_DIST_DIR` | `.next` | Next.js build/dev output folder; use another value to run a second build/server in parallel |
| `SMTP_URL`, `MAIL_FROM` | unset (demo mode) | Real mail delivery through nodemailer; unset = mails only logged in the outbox |
| `APP_URL` | `http://localhost:3100` | Base URL used in mails sent without a request (approval handlers) |
| `E2E_BASE_URL` | `http://localhost:3100` | Server the Playwright tests drive |
| `SEED_REGION` | `uae` | Only read by standalone scripts (`scripts/check-demo-entity.ts`); `npm run seed` always seeds both countries |

## Tests

- Type check and lint: `npx tsc --noEmit`, `npx eslint src tests`
- Map calculations: `npx tsx src/features/ops-map/calc.check.ts`
- Demo data coverage: `npm run seed && npm run check:demo` (`scripts/check-demo-coverage.ts` runs `scripts/check-demo-entity.ts` once per country, rules in `DEMO_DATA_SPEC.md`, plus multi-country / USD-layer assertions) prints a coverage table (RAG mix, segment statuses, delay causes, CPI/staleness spread, every status value per table, approvals, dashboard widgets) and exits 1 on any gap
- End to end (Playwright, Chromium): `tests/e2e/*.spec.ts` drive the real UI through the lifecycle (flow), authentication/RBAC (auth), approvals (approvals), the Live Ops Map (map) and the country switcher / data isolation / USD layer (multi-country). They also fail on browser console errors or hydration warnings. `portal-auth` and `client-portal` cover the two login portals.

The e2e tests **mutate data**, so run them against an isolated database and server instead of your dev data:

```bash
npx playwright install chromium            # once
export OPS_DB_PATH=/tmp/ops-e2e.db OPS_UPLOAD_DIR=/tmp/ops-e2e-uploads
npm run seed                               # seeds the scratch DB
NEXT_DIST_DIR=.next-build npm run build
NEXT_DIST_DIR=.next-build npx next start -p 3105 &     # inherits OPS_DB_PATH / OPS_UPLOAD_DIR
E2E_BASE_URL=http://localhost:3105 npm run test:e2e
kill %1                                    # stop the scratch server
```

The seed wipes tables in place (it does not delete the DB file), so a dev server that is already running stays connected: `npm run seed` against `data/ops.db` restores pristine demo data.

## Tech notes

- Next.js 15 App Router, TypeScript (strict), Tailwind CSS v4, Recharts, lucide-react. Brand/chart colours: `src/app/globals.css` tokens and `src/lib/theme.ts` (`BRAND`, `CHART`, `CHART_COLORS`, `MAP_COLORS`).
- SQLite via `better-sqlite3` (synchronous); schema in `src/lib/schema.sql` is applied on first connection. Uploads are served by `GET /api/files/[id]`. `data/`, `uploads/`, `.next*` and test output are git-ignored.
- Mutations are Server Actions (`src/features/<module>/actions.ts`) with `revalidatePath`; every mutation writes to `activity_log`. Actions that users commonly hit with validation problems (approvals, clients, tenders, subcontractors, invoices, settings) return `{ ok: false, error }` via `guard()` (`src/lib/action-result.ts`) and render it inline through `ActionForm`.
- Reads are server components calling `queries.ts`.

### Maps

- Project maps (`src/components/map/`): Leaflet + OpenStreetMap tiles, Esri World Imagery satellite switch, drawing with Leaflet-Geoman, measurement and route slicing with Turf.
- Live Ops Map (`src/features/ops-map/`): Leaflet with **Esri** keyless basemaps (Light Gray / Dark Gray canvas and World Imagery; CARTO tiles now need a key). Tile URLs and attributions are in `MapCanvas.tsx`. No API key is needed.

### Swapping to Google Maps later

Pages only use `ProjectMapLazy` (`src/components/map/ProjectMap.tsx`) and the props in `map/types.ts` (`features`, `editable`, `onSave(FeatureCollection)`, `drawKind`, `center`, `zoom`, `height`, `legend`). Re-implement `ProjectMapInner.tsx` with the Google Maps JavaScript API (Data layer or `@vis.gl/react-google-maps`, plus the Drawing/Geometry libraries) keeping the same props and GeoJSON in/out contract, and read the key from `NEXT_PUBLIC_GOOGLE_MAPS_KEY`. For the Live Ops Map, replace the Leaflet layer in `MapCanvas.tsx` (it exposes a small `MapApi`: `project`, `size`, `zoomIn/zoomOut`, fit bounds) and keep the overlay UI (`OpsMapApp.tsx`) as is.
