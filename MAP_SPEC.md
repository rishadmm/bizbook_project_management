# Live Ops Map — interactive project command centre (build contract)

Goal: from one map, a manager sees **what is happening on every project, which part each subcontractor owns, which parts are on track or slipping, planned vs projected completion, and who is causing delays** — and can drill down, filter, and replay history. Modern, dense, "mission-control" feel in the BizBook theme (THEME_SPEC.md).

## 1. Routes & entry points
- New page **`/map`** ("Live Ops Map"), permission `projects/view` (add module key `ops_map` with `view` to lib/permissions.ts + role defaults = same roles that have projects/view; sidebar item under PROJECTS with a radar/map icon).
- Fills the viewport under the topbar (no page padding); a **Full screen** button uses the browser Fullscreen API on the map container (Esc exits); also `?embed=1` hides the shell for wall displays (TV mode).
- Dashboard "Active projects map" card gets a **⤢ Full screen** button → `/map` (and project Map tab gets "Open in Live Ops Map" → `/map?project=<id>`). (The dashboard file is edited at the end, after the approvals agent finishes — see ownership.)
- URL state: `?project=&segment=&color=&date=&sub=` so views are shareable.

## 2. Data model for the map (server: `src/features/ops-map/queries.ts` → one JSON payload)
`getOpsMapData()` returns:
- `projects[]`: id, code, name, client, category, status, geometry, bbox, contract value, BAC, AC, EV, SPI, CPI, rag, actualPct, plannedPct, start, plannedFinish, **projectedFinish**, delayDays, totalQty+unit, completedQty, **behindPlanQty** (planned qty to date − actual), open issue count, sub-project ids.
- `segments[]` — the **subcontract segments** (the core unit): one per assignment. Geometry = its stage geometry; if a stage has several assignments, slice the stage line sequentially by each assignment's quantity share (turf `lineSliceAlong`); polygons are shared (shown as split hatch) . Each segment: assignmentId, projectId, stageId, stage code/name, subcontractor {id, name, rating}, scope, contract value, qty/unit, cumulativeQty, actualPct, plannedPct (today), SPI, status (`not_started|on_track|at_risk|behind|completed|suspended`), planned start/end, **projected end**, slip days, last report date + **staleness days**, recent rate (qty/week over last 4 verified weeks), manpower last 4 weeks (sparkline array), invoices certified/paid, open issues [{title, responsibility, impact_days}], delay days by responsibility, **history[]** = [{date, cumQty}] from verified reports (for replay).
- Stages without assignments become "self-performed" segments (subcontractor null).
- `issues[]` with lat/lng (stage midpoint, jittered) for markers.
- `parties[]` — delay attribution across visible projects: responsibility party or subcontractor, delay days, cost impact, segments affected.
- **Projected completion** (segment): if completed → actual end; else remaining qty / recent weekly rate (fallback overall rate since actual start; if no rate → planned end + current slip) → date. Project projected finish = max of its segments' projected ends (and never earlier than metrics forecastFinish if larger). Slip days = projected end − planned end.
- **Status rule**: completed (≥99.5%); not_started (no progress & planned start in future); behind (SPI < 0.85 or slip > 14 d); at_risk (SPI < 0.95 or slip > 0 or report stale > 10 d); else on_track. Suspended from assignment status.
- Put all computations in `src/features/ops-map/calc.ts` (pure, unit-testable); reuse lib/metrics functions where possible, do not modify them.

## 3. Map rendering (client, react-leaflet, dynamic ssr:false)
- Basemaps: **CARTO Positron (light, default)**, **CARTO Dark Matter** (night/TV mode), Esri satellite. No API keys. Attribution kept.
- Each line segment drawn as layered polylines:
  1. thick soft "halo" in status colour (low opacity) — visible at low zoom;
  2. **completed portion**: solid line in status colour (green on-track, amber at-risk, red behind, violet = completed);
  3. **remaining portion**: dashed grey;
  4. **"Plan line" marker**: a small perpendicular tick/diamond at the point where work *should* be today (plannedPct along the line), and a pulsing dot at the **actual work front** (actualPct). The gap between them is overdrawn as a **red hatched "slippage" band** (or green "ahead" band). This is the signature visual: you literally see how far behind each crew is.
  5. animated "marching ants" dash on segments with progress reported in the last 7 days (= active crews) — CSS stroke-dashoffset animation, respects prefers-reduced-motion.
- Segment boundaries: small chainage labels (e.g. "km 6.0") at zoom ≥ 12; subcontractor name label along the segment at zoom ≥ 13.
- Polygons: fill by status colour at 15–35% opacity scaled by progress, dashed outline for remaining.
- Issue markers: small circular icons (⚠ with colour by responsibility); clustered count at low zoom (simple own grouping, no extra lib needed — or `leaflet.markercluster` if trivial).
- Hover: segment highlights + tooltip (sub, %, SPI). Click: opens segment card (§4). Click empty: clears.
- Fit to all projects initially; `?project=` zooms to it with fly-to animation.

## 4. Panels & interactions (glass-morphism overlay panels: white/80 + backdrop-blur, radius 16, BizBook shadows; dark variant in night mode)
- **Top KPI strip** (overlay, horizontally scrollable on mobile): Active projects · Total length (km) · Completed km · **Behind plan km** · Segments at risk/behind · Portfolio SPI/CPI · Worst projected slip. Each tile clickable as a filter (e.g. click "Behind" → only behind segments emphasised, others dimmed).
- **Left rail — Projects** (collapsible): search; filters (RAG, category, status, subcontractor multi-select, responsibility); list of projects with mini progress bar (actual vs planned tick), RAG dot, projected vs planned finish ("+38 d"). Click → fly to project and open the project drawer. Sub-projects nested.
- **Colour-by switch** (segmented control on map): **Health** (status) · **Subcontractor** (categorical palette, legend lists subs) · **Delay cause** (colour by dominant responsibility of the segment's delay) · **Cost** (CPI on certified vs earned) · **Staleness** (days since last report). Legend updates.
- **Right drawer — Project** (when a project is selected):
  - header: code, name, client, RAG pill, Open project ↗ link.
  - **Completion forecast card**: Planned finish vs **Projected finish** with slip days, big progress ring (actual) with planned arc overlay.
  - **Mini-Gantt / Line-of-balance**: one row per segment: planned bar (light) vs actual-to-date fill vs projected bar extension (hatched red if beyond planned end); today line. Click row → select segment.
  - **"Who's causing the delay"**: horizontal bar chart of delay days by party (subcontractors by name + client/authority/weather/etc.), click a bar → highlight those segments on map & dim the rest.
  - **Subcontractor scorecard table**: sub, segments, % done, SPI, slip, open issues, last report (stale in amber/red).
  - Top open issues with responsibility chips.
- **Segment card** (popover anchored near click, or drawer section): sub name + rating, stage/chainage, scope, progress bar with planned tick, qty done/total, SPI, planned end vs projected end (+slip), recent rate vs **required rate** to finish on time (e.g. "0.21 km/wk now · needs 0.48 km/wk"), manpower sparkline, last report date (staleness), open issues, invoices certified/paid, buttons: Open stage ↗, Progress reports ↗, Copy portal link.
- **Time machine** (bottom bar): date slider from earliest project start to latest projected finish, ▶ play (≈ 1 week per 150 ms), speed 1×/2×/4×, "Today" snap. When scrubbing to past dates: actual progress from `history[]`, planned position recomputed for that date, KPIs recompute client-side. Future dates: show planned position + projected work front (extrapolated at recent rate) as ghost dashed — "forecast mode" label.
- **Compare mode toggle** "Plan vs Actual": shows planned work front ghost markers for every segment simultaneously (default on).
- Night/TV mode button (dark basemap + dark panels), Full screen button, Reset view button, share-link button (copies URL).
- Keyboard: `F` full screen, `Esc` close drawer/card, `←/→` step time machine by a week, `Space` play/pause.
- Responsive: ≥1024 rails/drawers; <1024 panels become bottom sheets with tabs (Projects / Details / Delays).

## 5. Ownership & quality
- New files only: `src/app/(main)/map/**`, `src/features/ops-map/**`, plus: add nav item in `src/components/shell/Sidebar.tsx`, permission key in `src/lib/permissions.ts` + `src/lib/role-defaults.ts` (do not touch anything else in those files). Do NOT edit `src/app/(main)/page.tsx`, `src/features/dashboard/**`, or `src/features/projects/**` — another agent is editing them; list the two small link-button changes needed (dashboard card, project Map tab) in the final report.
- Use `CHART_COLORS`, `MAP_COLORS`, `BRAND` from `src/lib/theme.ts`; recharts for drawer charts (animation off); lucide icons.
- Performance: payload computed server-side once per request; client memoises per date; ≤ 60 segments fine.
- Seed data already contains multiple assignments per project with varying health; if a project has a stage with 2+ assignments the slicing must be visible — if the seed has none, add a small migration-free seed tweak ONLY via a note in the report (do not edit seed.ts — another agent owns it).
