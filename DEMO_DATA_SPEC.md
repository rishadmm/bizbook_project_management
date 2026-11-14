# Demo data coverage + forecast RAG fix (build contract)

Goal: this is a **sales-demo** dataset. Whatever filter, tab, tile, status chip or colour mode a presenter clicks, something meaningful must appear. "Today" = real current date (seed is relative to today; keep it that way).

## A. Bug: forecast mode turns everything green (src/features/ops-map/calc.ts)
Measured: at asOf=2028-01-05 every project is `green` with SPI 1.00 and CPI up to 4.29, even PRJ-002/003 which are 190/321 days late.
Fix in `computeProject` (and anywhere else rag/cpi is computed for asOf > today):
- **Forecast RAG** (asOf > today): based on the projected outcome, not on SPI at that date: `delayDays > 30 → red`, `delayDays > 0 → amber`, else the RAG as of today (computed with the existing rule). A project already late today never becomes green in forecast.
- **Forecast CPI**: use today's CPI (EV/AC as of today), not future EV ÷ frozen AC.
- Segment status in forecast: a segment whose projected end > planned end shows `behind` (slip > 14 d) or `at_risk` (slip > 0) until its projected completion date, then `completed` (keep it completed after that; that's fine).
- Past dates (asOf < today) keep the current behaviour.
- Add cases to `calc.check.ts` for the above, and keep all existing checks passing.

## B. Seed coverage (src/lib/seed.ts; also any seed helper it uses)
Fix the data so these hold **as of today** (dates relative to today, like the existing seed):

### Live Ops Map / projects
- Project RAG today: **≥2 green, ≥2 amber, ≥2 red** (add 1–2 more active projects if needed, with real UAE geometry like the existing ones: lines for roads/pipelines/fibre, at least one polygon area). Keep the one `mobilizing` project (it may be grey/not started).
- Segment statuses across the portfolio: **each of not_started, on_track, at_risk, behind, completed, suspended ≥2**. Today there are 1 on_track, 1 at_risk, 0 suspended — fix this.
- Each red/amber project has a **mix**: at least one on-track sub next to one behind sub on the same project, so the map shows green and red parts side by side. At least one stage has 2+ assignments (sliced line).
- **Delay cause** colour mode: the delay events and issues cover every responsibility: subcontractor, company, client, authority, weather, utility_clash, other. Each one is the dominant cause of ≥1 segment.
- **Cost** colour mode: there is a CPI spread: some segments < 0.9 (overrun), some 0.9–1.0, some > 1.0.
- **Staleness** colour mode: in-progress segments have their last verified report at a spread of ages: some ≤ 7 d (marching ants), some 8–14 d, some > 14 d (stale).
- Every **category**, **project status**, **subcontractor** and **delay-cause** option in the rail dropdowns returns ≥1 project.
- KPI strip has non-zero values for: behind-plan km, at risk · behind, worst slip, completed km.
- "Who's causing the delay" shows ≥4 parties for the portfolio, and ≥2 for each red/amber project.
- Each segment with a sub has manpower reports over its last 4 weeks (sparkline not empty), and invoices certified/paid where progress > 30%.
- History is spread over time (weekly reports), so the time-machine replay visibly moves.

### Every other module: every status value has records
Read the status enums in `src/lib/status.ts` (and the tender workflow in `src/features/tenders/workflow.ts`). For **each** list page with status filters/tabs, every status value has **≥1 record (≥2 where cheap)**:
- Tenders: every status (draft, in_preparation, under_review, approved, submitted, negotiation, won, lost, no_bid, cancelled …) — also revisions, negotiation rounds, department sections and attachments metadata on a few.
- Lost tenders: loss analyses in every analysis status, with lessons learned.
- Subcontractors: every onboarding status (prospect, pending/under review, approved, suspended, blacklisted… whatever exists), with documents in every document status (valid, expiring within 30 d, expired, missing).
- Subcontract assignments, progress reports (submitted / verified / rejected — including portal-submitted ones waiting for verification), issues (open / in progress / resolved / closed), invoices (draft, submitted, under approval, approved, paid, partially paid, rejected), completion certificates (every status).
- Approvals: pending requests at L1 and L2 for **several** document types, several overdue, some approved/rejected/returned in history; at least one active delegation. Admin and the finance user each have ≥3 pending items.
- Dashboard: every widget (budget, delay, responsibility, S-curve, pipeline, win/loss) renders non-empty.
- Audit log and activity feed have recent entries.

### Rules
- Seed must stay idempotent: `npm run seed` clears tables in place (no file delete) and rebuilds. Demo logins unchanged (`admin@alnoor.demo` / `Admin@12345`, others `Password@123`).
- Data must be realistic for UAE infrastructure (AED, real road names, plausible quantities and dates); no lorem ipsum.
- Do not change UI components except where needed for Part A. No schema change unless unavoidable (then add a migration and bump SCHEMA_VERSION).

## C. Verification the agent must do
1. Add a script `scripts/check-demo-coverage.ts` (`npm run check:demo`) that loads the DB + `getOpsMapData()` + `computeAll(today)` and **asserts** every rule in B (RAG counts, segment status counts, each resp dominant, CPI/staleness spread, every status value per table has ≥1 row, every rail filter option non-empty). It prints a coverage table and exits 1 on any gap.
2. `npm run seed && npm run check:demo` passes; `npx tsc --noEmit`, `npm run lint`, `calc.check` pass; `npm run test:e2e` passes (update e2e assertions only if they depended on specific old seed numbers).
3. Forecast check: at asOf = today+400 d, the RAG counts still show red/amber projects.
