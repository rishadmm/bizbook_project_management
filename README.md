# Operations Module - Tender-to-Project Management

Single-company web app for an infrastructure contractor (road, cable, pipeline, telecom, civil). It follows work from bid to delivery:

**Tender -> departmental preparation -> detailed budget (BOQ) with per-line margin -> internal review -> submission -> negotiation and revisions -> Won / Lost.**
Lost tenders get a loss analysis. Won tenders become **projects** with map, stages, subcontract assignments, progress, invoices, completion certificates and budget/schedule control dashboards (EVM, delay attribution). Subcontractors report through a public, token-based **portal**.

## Modules

| Route | What it does |
|---|---|
| `/` | Executive dashboard: pipeline funnel, win rate, deadlines, project health (RAG), portfolio SPI/CPI, delay attribution, late subcontractors, pending approvals, expiring documents, map |
| `/tenders`, `/tenders/new`, `/tenders/[id]` | Kanban/table pipeline. Detail tabs: Overview (workflow actions, Mark Won/Lost), Departments, Budget/BOQ (inline edit, margin reason log, bulk markup, CSV import/export), Commercial & Negotiation (revisions, negotiation log), Reviews, Documents, Activity |
| `/lost-analysis` | Loss register, charts, lessons-learned library; `/lost-analysis/[id]` edit |
| `/clients`, `/clients/[id]` | Client master with tender/project history |
| `/projects`, `/projects/[id]`, `/projects/[id]/stages/[stageId]` | Cards/table/map views; tabs Overview, Map (draw/edit, split route into stages), Stages, Sub-projects, Subcontracts (portal links), Progress (verify portal reports), Budget & Cost, Invoices & Certificates, Delays & Issues, Documents, Activity |
| `/subcontractors`, `/subcontractors/[id]` | Directory, onboarding checklist and approval, documents with expiry, assignments with performance, invoices, certificates |
| `/invoices` | Cross-project invoice queue: review, certify, approve, pay, reject |
| `/portal/[token]` | Public subcontractor self-service (progress report, invoice, completion-certificate request) |
| `/settings` | Company, currency, users, departments |
| `/search?q=` | Global search (tenders, projects, subcontractors) |

Business rules: see `SPEC.md` (metrics are defined once in `src/lib/metrics.ts`); developer reference: `docs/FOUNDATION.md`.

## Run it

```bash
npm install
npm run seed      # wipes data/ops.db and uploads/ in place and loads UAE-style demo data
npm run dev       # http://localhost:3100
```

Other scripts: `npm run build`, `npm start` (port 3100), `npm run lint`, `npm run test:e2e`.

`npm run seed` prints the subcontractor **portal links** (`http://localhost:3100/portal/<token>`) for active assignments. You can also copy a link from a project's **Subcontracts** tab. New assignments start with the portal disabled; toggle it there. An invalid or disabled token shows a friendly "link not available" page.

There is no real authentication in v1: pick the current user in the top bar (cookie `ops_user_id`). Review rows can be decided by the user whose department matches (admins can decide any). Seeded users: 1 Omar (admin, Management), 4 Sara (Technical), 5 Imran (Finance), 2 Layla (Operations).

## End-to-end test

`tests/e2e/flow.spec.ts` (Playwright, Chromium) drives the real UI through the whole lifecycle and checks results in the database. It also fails on any browser console error or hydration warning on the main pages.

```bash
npx playwright install chromium         # once
npm run seed
npm run dev                             # in another terminal
npm run test:e2e                        # or E2E_BASE_URL=http://localhost:3101 npm run test:e2e
npm run seed                            # the test mutates data: reseed afterwards
```

## Tech notes

- Next.js 15 App Router, TypeScript (strict), Tailwind CSS v4, Recharts, lucide-react.
- SQLite via `better-sqlite3` (synchronous). File `data/ops.db` (override with `OPS_DB_PATH`); schema in `src/lib/schema.sql` is applied on first connection. Uploads go to `uploads/` and are served by `GET /api/files/[id]`. Both folders are git-ignored.
- Mutations are Server Actions (`src/features/<module>/actions.ts`) with `revalidatePath`; every mutation writes to `activity_log`. Reads are server components calling `queries.ts`.
- `next.config.ts` honours `NEXT_DIST_DIR` (default `.next`), handy for running a second instance/build in parallel: `NEXT_DIST_DIR=.next-alt npx next dev -p 3101`.
- The seed wipes tables in place (it does not delete the DB file), so a running server stays connected.
- Maps: Leaflet + OpenStreetMap tiles (Esri satellite switch), drawing with Leaflet-Geoman, measurement and route slicing with Turf. No API key needed.

### Swapping to Google Maps later

All map code lives in `src/components/map/`. Pages only use `ProjectMapLazy` (`ProjectMap.tsx`) and the props in `map/types.ts` (`features`, `editable`, `onSave(FeatureCollection)`, `drawKind`, `center`, `zoom`, `height`, `legend`). To switch, re-implement `ProjectMapInner.tsx` with the Google Maps JavaScript API (Data layer or `@vis.gl/react-google-maps`, plus the Drawing/Geometry libraries for editing and length/area) while keeping the same props and the GeoJSON in/out contract, and put the API key in an env var (`NEXT_PUBLIC_GOOGLE_MAPS_KEY`). Nothing else in the app needs to change.
