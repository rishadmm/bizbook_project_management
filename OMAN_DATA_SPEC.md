# Oman demo dataset (build contract)

Goal: a second, fully realistic demo dataset for **Oman** (currency **OMR**, maps in Oman, Omani clients and subcontractors). It must be exactly as rich and presentable as the UAE dataset (every screen, filter, colour mode, portal, report, invoice, approval has data) and it must **not change the UAE dataset**.

Read first: DEMO_DATA_SPEC.md, PORTAL_SPEC.md, CLIENT_PORTAL_SPEC.md, INVOICE_SPEC.md, README.md, docs/FOUNDATION.md, `src/lib/seed.ts`, `seed-portal.ts`, `seed-client-portal.ts`, `seed-invoices.ts`, `src/lib/approvals/seed-demo.ts`, `scripts/check-demo-coverage.ts`, `src/lib/db.ts`, `src/lib/format.ts`, `src/features/invoices/words.ts`.

## 1. How it runs: a separate database, side by side with UAE
- `SEED_REGION=uae|oman` (default `uae`). New npm scripts (macOS, plain env prefixes, no new deps):
  - `seed:oman` → `SEED_REGION=oman OPS_DB_PATH=data/ops-oman.db OPS_UPLOAD_DIR=uploads-oman tsx src/lib/seed.ts`
  - `dev:oman` → `OPS_DB_PATH=data/ops-oman.db OPS_UPLOAD_DIR=uploads-oman NEXT_DIST_DIR=.next-oman next dev -p 3200`
  - `check:demo:oman` → same env + `tsx scripts/check-demo-coverage.ts`
- `npm run seed` / `dev` / `check:demo` keep meaning UAE on `data/ops.db`, port 3100. Add `uploads-oman/`, `data/ops-oman.db*` to .gitignore if `uploads/` / `data/` are ignored the same way.
- **Never touch the running :3100 server or `data/ops.db`** except through your own isolated copies (see §6). Never `pkill next-server`; kill only PIDs you started.

## 2. Refactor: one seed engine + region profiles
- Move every region-specific value out of the seed files into `src/lib/seed-regions/types.ts` (`RegionProfile`), `uae.ts` (current values, verbatim) and `oman.ts`. `seed.ts`, `seed-portal.ts`, `seed-client-portal.ts`, `seed-invoices.ts`, `approvals/seed-demo.ts` read `getRegionProfile()` (from `SEED_REGION`).
- The profile covers at least: tenant settings (company name, address, tax number, `tax_label`, currency, approval threshold, `map_center`, `country`), internal users (names, email domain, admin email), clients, subcontractors (names, trades, contacts, licence/tax number formats, bank names, IBAN formats), tenders, projects (names, codes, regions, locations, geometry), stage/zone names, budget templates (unit costs in the region currency), issue/delay texts, report remarks/weather, invoice/payment refs, approval request texts, portal slugs/emails, demo document filenames/contents, phone formats.
- **UAE must stay identical.** Before refactoring, seed UAE into an isolated DB and dump the business tables (`sqlite3 <db> .dump` of all tables except sessions, auth events, activity timestamps and password hashes; normalise `seed-<nanoid>` filenames and tokens). After refactoring, do the same and `diff`. The diff must be empty (or explain every line in your report). UAE e2e, `check:demo` and `calc.check` (if present) must stay green.
- Same deterministic PRNG seed for both regions is fine; keep the engine's status mix (health on track / at risk / behind, completed, closed, future, sub-projects, rejected reports, locked/disabled users, expiring docs, ERP sync failure, etc.) so check:demo passes for Oman too.

## 3. App changes needed for a non-AED tenant (small, generic, settings-driven)
- `src/lib/format.ts`: `currencyDecimals(cur)` → 3 for OMR, BHD, KWD, JOD; otherwise 2. Every place that shows invoice/statement money with decimals (`decimals: 2`, `toFixed(2)`) uses `currencyDecimals(cur)`. Dashboards keep 0 decimals / compact.
- `words.ts` `amountInWords`: 3-decimal currencies use `/1000` → "OMR One Thousand Two Hundred and 250/1000 Only".
- New setting `tax_label` (default `TRN`; Oman `VATIN`) replaces the hard-coded "TRN" labels in InvoicePaper, InvoicePdf, seed invoice PDFs, portal documents page. Settings page: editable field "Tax registration label".
- Remove hard-coded tenant/currency text: `p/[slug]/(app)/projects/page.tsx` "Your subcontracts with Al Noor" → tenant setting; `tabs3.tsx` "Claimed (AED)" → current currency. Grep for any other `AED`, `Al Noor`, `Dubai`, `fils` literals in UI code (not seed) and make them settings-driven.
- Map: setting `map_center` ("lat,lng"; default Dubai). Map components that use a hard-coded fallback centre use it when there are no features. Ops map / dashboard maps already fit to features: check they open on Oman.
- Login page demo hints (internal, `/p`, `/c`) must show the emails that exist in the current DB (read from settings `demo_admin_email` written by the seed, or from the DB), not hard-coded UAE emails. `DEMO_ADMIN_EMAIL` stays for UAE; migrate.ts must not create a stray `admin@alnoor.demo` in the Oman DB.
- Client type: add `oil_gas` ("Oil & gas", amber/orange tone) to `ClientType` and the status label map (no CHECK constraint exists? verify; if a CHECK exists, add a migration or use `private`).

## 4. The Oman dataset (realistic, presentable)
Tenant (fictional contractor): **Al Raed Infrastructure & Contracting LLC**, "Office 504, Al Khuwair Business Tower, Sultan Qaboos Street, Al Khuwair, Muscat, Sultanate of Oman", VATIN `OM1100248613`, CR No. `1248613`, currency **OMR**, VAT **5 %** (Oman VAT since April 2021), approval cost threshold **5,000 OMR**, `map_center` `23.588,58.383`. Internal email domain `@alraed.demo`, admin `admin@alraed.demo` / `Admin@12345`, other users `first.last@alraed.demo` / `Password@123`.

Internal users (same roles/order as UAE): Hamed Al Rawahi (GM, super admin), Aisha Al Lawati (PM), Rahul Menon (estimator), Maryam Al Balushi (engineer), Imran Qureshi (finance), Fatma Al Hashmi (HR), Daniel Cruz (engineer), Asma Al Harthy (procurement), Tariq Mahmood (HSE engineer), Noor Al Zadjali (viewer), Khalid Al Maskari (management), Mariam Al Kindi (finance 2).

### Clients (real organisations as demo customers; all contact persons, emails and phones are fictional, `(demo)`-style domains `*-demo.om`)
| # | Client | Type | Portal slug | Projects |
|---|---|---|---|---|
| 1 | Ministry of Transport, Communications and Information Technology (MTCIT) | road_authority | `mtcit` | P1, P7, P11 |
| 2 | Omantel | telecom | `omantel` | P2, P2A, P2B, P12 |
| 3 | Petroleum Development Oman (PDO) | oil_gas | `pdo` | P3, P9 |
| 4 | Muscat Municipality | government | — (no projects) | — |
| 5 | Occidental of Oman (OXY) | oil_gas | `oxy` | P4, P10 |
| 6 | Ooredoo Oman | telecom | `ooredoo` | P8 |
| 7 | Nama Water Services | utility | — (no projects; has tenders) | — |
Keep the client-portal seed rules (1 admin + 1–2 viewers, `Portal@123`, one forced change, one disabled, one client with financials off — use **PDO**, one with subcontractor names off — use **OXY**, one viewer scoped to one project — Omantel).
Client display names: use the real names **without** "(demo)" in the name, but keep emails on `*-demo.om` domains (e.g. `projects@mtcit-demo.om`, `network.build@omantel-demo.om`, `contracts@pdo-demo.om`, `projects@oxy-demo.om`, `fixed.network@ooredoo-demo.om`). Phones `+968 2xxx xxxx` with `000` blocks like UAE (e.g. `+968 2400 1100`), mobiles `+968 9xxx xxxx` with `000` blocks. Addresses: MTCIT Al Khuwair Muscat; Omantel Head Office, Al Mawaleh / Muscat; PDO Mina Al Fahal; OXY Muscat Hills / Qurum; Ooredoo Al Khuwair; Muscat Municipality Ruwi; Nama Water Services Al Khuwair.

### Projects (same codes/statuses/health/timing as UAE PRJ-2026-001…012, Oman geography; lng, lat)
- **P1** MTCIT, road, on track: "Muscat Expressway Widening – Al Mabaila to Halban", line ≈ [58.135, 23.650] → [57.960, 23.615], 6 sections. Region "Muscat / South Al Batinah".
- **P2** Omantel, cable: "Muscat–Barka Fibre Backbone (Sultan Qaboos Highway)", ≈ [58.200, 23.600] → [57.870, 23.700], 5 segments. **P2A** "Fibre Link A – Rusayl Industrial Estate Handholes & Spurs" (first 8 km), **P2B** "Fibre Link B – Barka Interconnect" (last 7 km).
- **P3** PDO, pipeline: "Fahud–Natih 12-inch Crude Flowline Replacement", ≈ [56.470, 22.330] → [56.620, 22.420], 4 reaches. Region "Fahud, Al Dhahirah".
- **P4** OXY, civil polygon: "Mukhaizna Block 53 Well-Pad & Utilities Enabling Works", rectangle at x0 56.380, y0 19.960 (same size as UAE P4); zones "Zone A – Well-pad cluster", "Zone B – Steam & water manifold", "Zone C – Access roads & graded tracks", "Zone D – Flowline corridor & drainage". Region "Al Wusta".
- **P7** MTCIT, road, amber: "Sur Industrial Area Access Road Rehabilitation", ≈ [59.470, 22.530] → [59.530, 22.572]. Region "South Al Sharqiyah".
- **P8** Ooredoo, telecom, green: "Ooredoo 5G Backhaul Duct Bank – Al Khoud to Al Mawaleh", ≈ [58.120, 23.585] → [58.180, 23.625].
- **P9** PDO, pipeline, completed: "Yibal Produced-Water Disposal Line Replacement", ≈ [56.030, 22.150] → [56.075, 22.170].
- **P10** OXY, other polygon, closed: "Safah Field Laydown Yard Paving (Block 9)", rectangle at x0 56.270, y0 23.270 (same size as UAE P10). Region "Al Dhahirah".
- **P11** MTCIT, road, future: "Al Batinah Coastal Road – Shinas to Liwa Link", ≈ [56.470, 24.740] → [56.565, 24.530].
- **P12** Omantel, telecom, future: "Al Mouj Muscat FTTH – Phase 2 Build", around 58.285, 23.620 (keep UAE P12 geometry type/size).
Tenders: mirror the UAE tender list with Oman equivalents (MTCIT road packages, Omantel/Ooredoo fibre, PDO/OXY flowlines & well-pad civil, Nama Water Services transmission main in Barka, Muscat Municipality storm-water in Al Amerat, OQ Gas Networks (OQGN) gas line crossing). Tender refs in the client's style (e.g. `MTCIT/RD/2026/014`, `PDO-C-26-0381`, `OTEL/FN/2026/22`).

### Subcontractors (fictional Omani companies, same slots/status mix as UAE; slugs from names)
1 Al Hajar Earthmoving & Excavation LLC (earthworks) · 2 Batinah Asphalt & Road Paving Co. LLC (asphalt) · 3 Sohar Trenching & Cable Laying LLC (trenching & cable, the low-rated/behind one) · 4 Muscat Fibre Networks & Splicing LLC (fibre) · 5 Al Wusta Pipeline & Mechanical Contractors LLC (pipe laying, carbon-steel welding) · 6 Sharqiyah Civil & Shoring Works LLC · 7 Dhofar Survey & Materials Testing LLC · 8 Seeb Traffic Management & Safety Services LLC (onboarding) · 9 Rusayl Directional Drilling LLC (prospect) · 10 Qurum Landscaping & Finishing LLC (suspended) · 11 Al Khuwair Manpower & Rigging LLC (blacklisted).
Contacts: mix of Omani and expat names (e.g. Said Al Busaidi, Hilal Al Hinai, Khalfan Al Rawahi, Ahmed Al Balushi, Salim Al Harthy, Yaqoob Al Kindi, Rajesh Nair, Shahid Iqbal, Joseph Thomas). Emails `*-demo.om`. CR numbers 7 digits, VATIN `OM11000xxxxx`, banks: Bank Muscat, National Bank of Oman, Sohar International, Bank Dhofar, Oman Arab Bank, HSBC Oman; IBAN format `OMkk BBB0 CCCC CCCC CCCC CCC` (23 chars, fictional digits). Documents: CR certificate, Chamber of Commerce (OCCI) membership, insurance, VAT certificate, HSE certificate, **PDO/OXY contractor registration (Joint Supplier Registration System – JSRS)**, Omanisation compliance letter (Ministry of Labour).

### Money (OMR, realistic Oman rates; 1 OMR ≈ 9.55 AED — never just divide blindly, round to sensible OMR figures)
Budget templates in OMR. Road: labour 17 OMR/man-day, asphalt 28 OMR/ton, aggregate base 8.5 OMR/m3, paving fleet 420 OMR/day, earthworks 6 OMR/m3, survey/QA 9,500 OMR/month. Cable/telecom: crew 16 OMR/man-day, fibre 96F 1.35 OMR/m, HDPE duct 1.05 OMR/m, trenching/HDD 380 OMR/day. **Pipeline (oil & gas)**: welding & coating crew 22 OMR/man-day, **API 5L X52 carbon-steel line pipe 12"** 46 OMR/m, field joint coating & CP 9 OMR/m, side-booms & welding fleet 650 OMR/day, radiography/NDT 7,500 OMR/month, hydrotest & pre-commissioning. Civil (well-pad): earthworks, compacted marl fill, concrete foundations, cathodic protection. Contract values therefore land in typical Oman ranges (road ≈ 3–9 M OMR, fibre ≈ 0.8–3 M, flowline ≈ 2–6 M, well-pad ≈ 1.5–4 M). Invoice amounts, payments, retention (10 %), advance (10 %) all in OMR with 3 decimals where shown.

### Texts that make it feel Omani (issues, delays, remarks, approvals)
- Permits/NOCs: Muscat Municipality excavation permit, Royal Oman Police (ROP) traffic diversion approval, MTCIT right-of-way NOC, Nama Electricity/Nama Water utility clearance, Omantel/Ooredoo existing-asset NOC, OQGN crossing permit, **PDO Permit to Work (PTW)**, H2S zone restriction, IVMS/journey-management for interior driving.
- Weather: summer heat — Ministry of Labour **midday work ban 12:30–15:30 (June–August)**, sandstorm in Al Wusta, wadi flooding after heavy rain (low-pressure system), Khareef only for Dhofar if used.
- Ground: hard rock/ophiolite excavation near the Hajar mountains, sabkha in coastal Batinah, unmarked existing flowlines (PDO), shallow groundwater in Seeb.
- Omanisation: manpower lists include Omani nationals; one issue about Omanisation quota visas.
- Holidays: delays around Eid Al Adha, National Day (18 November) — but keep dates relative to TODAY like the engine does.

## 5. Coverage
- `npm run check:demo:oman` passes with the same assertions as UAE (extend the script so it reads region-specific expectations from the profile, e.g. client slugs and admin emails). Also assert: currency setting is OMR, every project geometry lies inside Oman's bounding box (lng 51.8–59.9, lat 16.6–26.4), no `AED`, `Dubai`, `Abu Dhabi`, `Sharjah`, `alnoor`, `demo.ae` string anywhere in the Oman DB (scan all TEXT columns) or in Oman upload files.
- Seed end prints the Oman URLs: internal `http://localhost:3200` admin, subcontractor portals, client portals (`/c/omantel`, `/c/pdo`, …) with admin emails.
- README: "Oman demo dataset" section (commands, ports, logins).

## 6. Quality gates (report results)
- tsc, lint, UAE `check:demo`, Oman `check:demo:oman`, the UAE identity diff (§2), full UAE e2e (isolated: own OPS_DB_PATH/OPS_UPLOAD_DIR/NEXT_DIST_DIR/port, never :3100 or :3200).
- Smoke test Oman on an isolated production build or `dev:oman`: `/` dashboard, `/projects/1`, `/map`, `/invoices/<id>` (OMR 3 decimals, VATIN, amount in words with /1000), `/p/<slug>` login + dashboard, `/c/omantel` login + dashboard + map. Leave `dev:oman` NOT running at the end unless I ask (I will start it myself).
