# BizBook Project - Tender-to-Project Management (Project module of BizBook ERP)

Single-company web app for an infrastructure contractor (road, cable, pipeline, telecom, civil). It follows work from bid to delivery:

**Tender -> departmental preparation -> detailed budget (BOQ) with per-line margin -> internal review -> submission -> negotiation and revisions -> Won / Lost.**
Lost tenders get a loss analysis. Won tenders become **projects** with map, stages, subcontract assignments, progress, invoices, completion certificates and budget/schedule control dashboards (EVM, delay attribution). Subcontractors work through a **login-based portal** per company (`/p/<slug>`: dashboard, project monitoring, progress updates, invoices, payments, issues/RFIs, documents, team) and the legacy token quick-update link (`/portal/<token>`). Sensitive steps run through a configurable **approval engine**, and access is controlled by **roles and permissions (RBAC)**.

## Modules

| Module | Routes | What it does |
|---|---|---|
| Dashboard | `/` | Executive dashboard: pipeline funnel, win rate, deadlines, project health (RAG), portfolio SPI/CPI, delay attribution, late subcontractors, pending approvals, expiring documents, active-projects map (with a Full screen link to the Live Ops Map) |
| Tenders | `/tenders`, `/tenders/new`, `/tenders/[id]` | Kanban/table pipeline. Detail tabs: Overview (workflow actions, Mark Won/Lost), Departments, Budget/BOQ (inline edit, margin reason log, bulk markup, CSV import/export), Commercial & Negotiation (revisions, negotiation log), Reviews, Documents, Approvals, Activity |
| Loss analysis | `/lost-analysis`, `/lost-analysis/[id]` | Loss register, charts, lessons-learned library |
| Clients | `/clients`, `/clients/[id]` | Client master with tender/project history |
| Projects | `/projects`, `/projects/[id]`, `/projects/[id]/stages/[stageId]` | Cards/table/map views; tabs Overview, Map (draw/edit, split a route into stages, open in Live Ops Map), Stages, Sub-projects, Subcontracts (portal links), Progress (verify portal reports), Budget & Cost, Invoices & Certificates, Delays & Issues, Documents, Activity |
| Live Ops Map | `/map` (`?project=<id>&segment=<key>&color=<mode>&date=YYYY-MM-DD`) | Full-screen operations map: projects rail, project drawer with line of balance and delay causes, colour-by (health, subcontractor, delay cause, cost, staleness), time slider with playback, plan-vs-actual comparison, shareable URL state |
| Subcontractors & portal | `/subcontractors`, `/subcontractors/[id]` (tab `?tab=portal`), `/p/[slug]/…`, `/portal/[token]` | Directory, onboarding checklist and approval, documents with expiry, assignments with performance, invoices, certificates. The **Portal access** tab manages the company's portal URL, users, one-time credentials, login activity, change requests and a read-only "view as subcontractor". The legacy token portal (`/portal/[token]`) keeps working as a quick-update link |
| Invoices | `/invoices` | Cross-project invoice queue: review, certify, approve, pay, reject |
| Approvals | `/approvals`, `/admin/approval-workflows` | Multi-level approval engine: inbox, history, delegations, workflow designer with live preview, per-document-type rules (Settings > Approvals) |
| Admin / RBAC | `/admin/users`, `/admin/roles`, `/admin/audit` | Users, roles and permission matrix, per-user overrides, lockout/unlock, audit log |
| Settings | `/settings` | Company, currency, approval thresholds and "approval required" toggles per document type, departments |
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
npm run seed      # wipes data/ops.db and uploads/ in place and loads UAE-style demo data
npm run dev       # http://localhost:3100
```

Other scripts: `npm run build`, `npm start` (port 3100), `npm run lint`, `npm run check:demo`, `npm run test:e2e`.

`npm run seed` also prints the subcontractor **portal links** (`http://localhost:3100/portal/<token>`) for active assignments; you can copy a link from a project's **Subcontracts** tab. New assignments start with the portal disabled.

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

Existing databases upgrade in place on first start (`src/lib/migrate.ts`: auth columns, roles, approval workflows, one-time grant of Live Ops Map access to every role that can view projects).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPS_DB_PATH` | `data/ops.db` | SQLite file used by the app, the seed and the tests |
| `OPS_UPLOAD_DIR` | `uploads/` | Where uploaded files are stored |
| `NEXT_DIST_DIR` | `.next` | Next.js build/dev output folder; use another value to run a second build/server in parallel |
| `E2E_BASE_URL` | `http://localhost:3100` | Server the Playwright tests drive |

## Tests

- Type check and lint: `npx tsc --noEmit`, `npx eslint src tests`
- Map calculations: `npx tsx src/features/ops-map/calc.check.ts`
- Demo data coverage: `npm run seed && npm run check:demo` (`scripts/check-demo-coverage.ts`, rules in `DEMO_DATA_SPEC.md`) prints a coverage table (RAG mix, segment statuses, delay causes, CPI/staleness spread, every status value per table, approvals, dashboard widgets) and exits 1 on any gap
- End to end (Playwright, Chromium): `tests/e2e/*.spec.ts` drive the real UI through the lifecycle (flow), authentication/RBAC (auth), approvals (approvals) and the Live Ops Map (map). They also fail on browser console errors or hydration warnings.

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
