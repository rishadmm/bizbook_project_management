# Foundation reference (for module agents)

Run: `npm run seed` (wipes `data/ops.db` + `uploads/`, reseeds), `npm run dev` (port 3100), `npm run build`.

## Route conventions
- App shell (sidebar + topbar) lives in `src/app/(main)/layout.tsx`. **Modules go under `src/app/(main)/<route>`** (tenders, lost-analysis, projects, subcontractors, invoices, clients, settings, search; dashboard = `(main)/page.tsx`). Placeholder pages already exist for each: **overwrite** `(main)/<route>/page.tsx`.
- **Portal goes under `src/app/portal/[token]`** (outside the shell; `src/app/portal/layout.tsx` is a bare wrapper you may edit). Root layout is minimal (html/body/css only; Leaflet + geoman CSS imported globally).
- Pages are server components; `(main)` layout is `force-dynamic`. `params`/`searchParams` are Promises (Next 15): `const { id } = await params`.
- Server actions: `src/features/<module>/actions.ts` with `"use server"`, validate, transaction, `await logActivity(...)`, `revalidatePath(...)`. Queries in `src/features/<module>/queries.ts`. `src/features/settings/actions.ts` is an example.
- `formatMoney()` etc. are pure and safe in client components; currency is read from settings (published to a global by `db.ts`). In client components pass `{currency}` if needed.
- `@/lib/session.ts` (getCurrentUser) imports server-only APIs - never import it from a client component; `setCurrentUser` lives in `session-actions.ts` ("use server") and is re-exported from `session.ts`.

## lib/db.ts
- `getDb(): Database` singleton (WAL, FK on, schema applied from `src/lib/schema.sql`, hot-reload safe). `getSetting(key, fallback?)`, `setSetting(key, value)`, `DB_PATH`.
- Synchronous: `getDb().prepare(sql).all(...) / .get(...) / .run(...)`, `getDb().transaction(() => {...})()`.
- Row types for every table in `src/lib/types.ts` (`Tender`, `Project`, `Stage`, `Assignment`, `ProgressReport`, ...; enum unions `TenderStatus`, ...).

## lib/session.ts
- `getCurrentUser(): Promise<User>` (cookie `ops_user_id`, defaults to user 1)
- `setCurrentUser(userId: number): Promise<void>` (server action)

## lib/activity.ts
- `logActivity(entityType: EntityType, entityId: number, action: string, message: string, userId?: number | null): Promise<void>` (userId undefined = current user; pass `null` for portal)
- `getActivity(entityType, entityId, limit = 100): (ActivityLog & { user_name })[]`

## lib/files.ts
- `saveUpload(file: File, entityType, entityId, category?: string|null, opts?: { note?, uploadedBy? }): Promise<Attachment>` (uploadedBy `null` = anonymous/portal)
- `saveUploadsFromForm(form: FormData, fieldName, entityType, entityId, category?, opts?): Promise<Attachment[]>`
- `listAttachments(entityType, entityId)`, `deleteAttachmentFile(a)`, `UPLOAD_DIR`
- Download: `GET /api/files/:id` (inline for images/pdf/text; `?download=1` forces download).

## lib/status.ts
- `ENUMS` (kinds: role, clientType, tenderKind, category, quantityUnit, tenderStatus, sectionStatus, revisionStatus, budgetCategory, reviewDecision, negotiationChannel, lossReason, lossStatus, projectStatus, stageStatus, subcontractorStatus, docType, docStatus, assignmentStatus, responsibility, progressSource, progressStatus, invoiceStatus, certType, certStatus, issueStatus, rag), each value `{label, tone}`.
- `statusLabel(kind, value)`, `statusBadgeClass(kind, value)`, `statusTone`, `statusHex(kind, value)` (maps/charts), `statusOptions(kind): {value,label}[]`, `enumDef`, `RAG_HEX`, `TONE_HEX`, `TONE_CLASSES`.
- Constants: `TENDER_PIPELINE`, `OPEN_TENDER_STATUSES`, `REVIEW_DEPARTMENTS` (Technical, Finance, Operations, Management), `DEFAULT_TENDER_SECTIONS: [dept, title][]`, `DEFAULT_ONBOARDING_ITEMS`, `DEPARTMENTS`, `ATTACHMENT_CATEGORIES`.

## lib/format.ts (pure)
`formatMoney(v, {decimals?, currency?, compact?})`, `compactNumber`, `formatNumber(v, decimals=0)`, `formatDate(iso)` -> "DD MMM YYYY", `formatDateTime`, `pct(v, decimals=1)`, `formatRatio(v)` (SPI/CPI), `formatKm`, `todayISO()`, `addDays(iso, n)`, `daysBetween(a, b)`, `daysUntil(iso)`, `countdownLabel(iso)`, `getCurrency()`.

## lib/metrics.ts (single source of truth, SPEC s5)
Pure:
- `lineAmounts(qty, unitCost, marginPct): {cost, price, margin_value}`
- `computeTotals(lines: {quantity, unit_cost, margin_pct}[]): {cost, price, margin_value, margin_pct (on price), markup_pct (on cost)}`
- `plannedPctAt(start, end, date): number`, `ragFromIndices(spi, cpi): RagStatus`, `stageWeights(stages)`, `stageActualPct(stage, verifiedReports, asOf?)`

DB-backed (verified progress reports only):
- `getRevisionTotals(revisionId): RevisionTotals` = Totals + `{revisionId, lineCount, byCategory: {category, cost, price, margin_value}[]}`
- `refreshRevisionTotals(revisionId)` - **call after any budget line change**; writes total_cost/total_price/margin_pct onto tender_revisions.
- `getStageProgress(stageId, asOf?): {stageId, actualPct, plannedPct, cumulativeQty, plannedQty, spi, lastReportDate, delayDays, rag}`
- `getProjectMetrics(projectId, asOf?): {projectId, bac, ev, pv, ac, spi, cpi, eac, vac, actualPct, plannedPct, committed, delayDays, reportedDelayDays, forecastFinish, rag, stages: (StageProgress & {weight})[]}` (spi/cpi null when undefined; rag `green|amber|red|grey`). Sub-projects are separate projects (parent metrics do not include children).
- `getProjectSCurve(projectId): {date, planned, actual|null}[]` (weekly)
- `getDelayAttribution(projectId | null): {total:{days,cost}, byResponsibility:{responsibility,days,cost,count}[], bySubcontractor:{subcontractorId,name,days,cost}[]}` (null = portfolio)
- `getAssignmentProgress(assignmentId, asOf?): {actualPct, plannedPct, spi, cumulativeQty, delayDays, lastReportDate, invoiced, certified, paid, certifiedPct}`
- `getSubcontractorPerformance(subcontractorId?): SubcontractorPerformance[]` (`{subcontractorId, name, trade, status, rating, assignmentCount, activeAssignments, contractValue, progressPct, plannedPct, spi, delayDays, invoiced, certified, paid}`; sorted worst SPI first; all subs with assignments when id omitted)
- Cost auto-posting (idempotent, call from your actions): `syncInvoiceCost(invoiceId)` (posts `subcontract` cost = certified_amount when invoice is approved/paid, removes otherwise; source_type `sub_invoice`), `syncProgressMaterialCosts(reportId)` (posts `material` costs when report is verified, removes otherwise; source_type `progress_material`, source_id = progress_materials.id). Call after verify/reject, invoice status change, or material edits.

## UI (`src/components/ui`, barrel `@/components/ui`)
- `Button({variant: primary|secondary|danger|ghost|success, size: sm|md, ...button props})`, `LinkButton({href, variant, size})`, `buttonClass(variant,size)`
- `Card({className})`, `CardSection({title, subtitle, actions, flush, className})`
- `Badge({tone, className})`, `StatusBadge({kind: EnumKind, value})`
- `Table, THead, TBody, TR, TH({num}), TD({num})` (num = right-aligned tabular)
- `Tabs({tabs: {key,label,count?}[], active, basePath, extraQuery?})` + `resolveTab(searchParams, tabs, fallback?)` - URL `?tab=`
- `Stat({label, value, hint, tone: default|good|warn|bad, icon})`
- `Modal({open,onClose,title,wide})` (client); `ModalButton({label, title, variant, size, wide, icon, children})` - opens a modal with server-rendered children (e.g. `<form action={serverAction}>`), auto-closes after form submit
- `Field({label, hint})`, `Input`, `Textarea`, `Select({options?: {value,label}[], placeholder?})`
- `EmptyState({title, description, action})`, `ProgressBar({value, planned?, tone, showLabel})`, `PageHeader({title, description, actions, breadcrumbs, badges})`, `cn()`
- `AttachmentsPanel({entityType, entityId, revalidate: string, categories?, readOnly?, title?})` (server comp; `revalidate` = current page path) in `@/components/AttachmentsPanel`
- `ActivityTimeline({entityType, entityId, limit?, title?})` in `@/components/ActivityTimeline`
- `ComingSoon({title})` placeholder.

## Map (`src/components/map`)
`import { ProjectMapLazy } from "@/components/map/ProjectMap"` (alias `ProjectMap`; client-only, ssr:false; usable from server components). Types in `map/types.ts`:
`features: MapFeature[]` (`{id, kind: 'project'|'stage', geometry (GeoJSON), color?, label?, progressPct?, popupHtml?, href?, editable?}`), `editable?`, `onSave?(FeatureCollection)` (function prop => pass from a client component wrapper), `drawKind?`, `center?: [lat,lng]`, `zoom?`, `height?`, `legend?: {label,color}[]`.
Lines with `progressPct` render grey base + green completed slice (turf lineSliceAlong). Edit mode: geoman toolbar, live length/area (km / sqm / ha) panel, Save button; saved FeatureCollection holds all editable layers (`properties: {id, kind}` for existing, `{kind, isNew:true}` for new). Fit-to-bounds on feature set change. OSM / Esri satellite switch. Verified rendering in the browser (draw toolbar + measurements).

## Seed summary (npm run seed)
Sales-demo dataset (rules: `DEMO_DATA_SPEC.md`, verified by `npm run check:demo`). 8 departments, 12 users (id 1 = admin Omar Al Farsi), 7 clients (every client type), 18 tenders (every status; 6 lost with loss analyses in every analysis status; negotiation rounds on every channel; one rejected and one changes-requested department review), 12 projects: PRJ-001 Emirates Road (green), 002 fibre (red, failing sub terminated on the last section), 003 pipeline (red, authority/client delays), 004 Dubai South polygon (amber), 005 / 006 sub-projects of 002 (006 mobilizing), 007 Abu Dhabi street rehabilitation (amber, cable clash, event closure, suspended landscaping sub), 008 Sharjah 5G duct bank (green, suspended chambers sub), 009 Al Quoz main (completed), 010 Khalifa Port yard (closed), 011 Fujairah link (on hold), 012 Dubai Hills FTTH (planning). 11 subcontractors (every onboarding status incl. blacklisted; documents valid / expiring / expired / pending / rejected), assignments in every status (draft, active, suspended, completed, terminated), progress reports (verified, portal-submitted awaiting verification, rejected), invoices and certificates in every status, issues for every responsibility, approvals pending at L1/L2 across 7 document types (several overdue; admin and both finance users have 3+ pending; one active delegation), 32 auth events + recent activity for the audit log.

Won-tender budget lines use `wbs_stage` = stage name, plus project-wide lines with `wbs_stage = "General"` (overhead + contingency) which have `stage_id = NULL` in project_budget_lines - tender-to-project conversion should do the same (no stage for "General").

Portal links are printed by the seed (`http://localhost:3100/portal/<token>`); query `assignments WHERE portal_enabled=1` for tokens.

## Deviations from SPEC
- 15 tenders (not 12) so every status appears; no_bid/cancelled included.
- `format.ts` is pure (no DB import) and reads currency from a global set by db.ts.
- `setCurrentUser` is defined in `lib/session-actions.ts` and re-exported from `lib/session.ts` (a client component cannot import session.ts).
- `ProjectMapLazy` wraps `ProjectMapInner.tsx` (cannot self-import).
- System font stack instead of next/font (offline-safe). Clients page is a placeholder (not in module list).

## Approvals (AUTH_SPEC section D)
- Engine: `src/lib/approvals/engine.ts` (sync, transactional, takes the acting user id explicitly): `submitForApproval(type, docId, {userId, note?, payload?}) -> {status: 'pending'|'auto_approved', requestId}`, `decide(taskId, 'approve'|'reject'|'return', comment, actorId)`, `cancelRequest(requestId, actorId)`, `withdrawOpenRequest(type, docId, actorId)` (module actions that withdraw/close a document), `getApprovalStatus(type, docId)`, `getMyPendingTasks(userId)`, `getPendingCount(userId)`, `hasOpenRequest(type, docId)`, `selectWorkflow`, `applicableLevels`, `resolveApprovers`, `activeDelegate`.
- Registry: `src/lib/approvals/registry.ts` holds the 10 document types (`getDocument`, `canSubmit`, `onApproved/onRejected/onReturned/onCancelled`). Add a type there + a label in `meta.ts` + a default workflow in `defaults.ts`.
- A module action that used to jump to the final status now calls `submitForApproval` (inside its own transaction); when no workflow matches the engine auto-approves and the handler applies the old transition. Never set the final status directly.
- UI: `<ApprovalPanel type documentId path user canSubmit? compact? />` (`@/components/approvals/ApprovalPanel`); inbox `/approvals`; designer `/admin/approval-workflows`.
- Tables: approval_workflows, approval_levels, approval_requests (levels snapshot in `levels_json`, action payload in `payload`), approval_tasks, approval_delegations, approval_events, project_cost_requests. Settings: `approval_cost_threshold` (default 50000), `approval_required_<type>` = 1 blocks submission when no workflow matches.
- Seed adds users Hamdan Al Zaabi (management) and Mariam Khoury (finance) so that every default level has an approver other than the requester.

## Subcontractor invoices (INVOICE_SPEC)
- Convention: **claimed (gross incl. VAT) -> certified (gross) -> less retention -> less advance recovery -> net payable**. `claimed_amount = gross_amount = subtotal + vat_amount`; `sub_invoice_lines.amount` is ex-VAT (`this_qty x rate`). Certifying spreads the certified subtotal over the lines pro rata.
- Code: `src/features/invoices/` (`calc.ts` pure maths, `lines.ts` BOQ/line parsing, `queries.ts` `getInvoiceDetail`, `erp.ts`, `pdf/`, `components/`). Page `/invoices/[id]`, PDF `/invoices/[id]/pdf`, ERP `/api/erp/invoices/[id]` (see `docs/ERP_INTEGRATION.md`).
- Attachments use `entity_type = 'sub_invoice'` (legacy `invoice` rows are renamed by the migration); activity stays under `invoice`. Upload permission = `invoices/certify` (the module has no `edit` action).
- BOQ of a subcontract = distinct items of its earlier invoice lines (or one item from the assignment); used to prefill the Record-invoice and portal forms. Portal submissions only accept BOQ items and require a `tax_invoice` file.
- PDF fonts: Manrope TTFs in `src/assets/fonts` (OFL). Seed files are written by `src/lib/seed-invoices.ts` (react-pdf is loaded with dynamic import because tsx runs the seed as CJS).

## Subcontractor portal (PORTAL_SPEC)
- Login portal under `src/app/p/[slug]` (route group `(app)` = shell + guarded pages; `login` and `change-password` use the split auth layout). The legacy token page `/portal/[token]` is unchanged (plus a "Sign in" banner when the company has portal users).
- Auth: `src/lib/portal-auth.ts` (`getPortalSession`, `requirePortalUser(slug, perm)` for pages, `requirePortalAction(perm)` for server actions, `portalOwnsAttachment` for `/api/files/:id`); pure role/permission matrix + slug rules in `src/lib/portal-perms.ts`, DB helpers in `src/lib/portal-core.ts`. Cookie `bbp_portal` (path `/` so the file viewer can use it; SHA-256 token hash in `portal_sessions`). Admin view = a `portal_sessions` row with `impersonated_by` (2 h, read-only: every mutating action calls `requirePortalAction`, which refuses it).
- Tables: `portal_users`, `portal_sessions`, `portal_auth_events`, `issue_comments`, `portal_change_requests`; new columns on `subcontractors` (`portal_slug`, `portal_enabled`), `progress_reports` (`submitted_by_name`, `portal_user_id`, `reject_reason`, `weather`), `issues` (`source`, `kind`, `category`, `awaiting_party`, ...), `subcontractor_documents` (`source`, `uploaded_by_name`, `review_note`, status `pending_review`).
- Shared write logic for both portals: `src/features/portal/core.ts`. Read models (always company + scope filtered): `src/features/portal/data.ts`; schedule health / map / series: `src/features/portal/ops.ts` (reuses the Live Ops Map maths).
- Forms in the portal use `useServerForm` (no automatic form reset on validation errors).

## Client portal (CLIENT_PORTAL_SPEC)
- Read-only portal under `src/app/c/[slug]` (route group `(app)` = shell + guarded pages; `login`, `change-password`, `forbidden` use the split auth layout). Middleware leaves `/c/**` open at the edge; the guards are server side.
- Auth: `src/lib/client-portal-auth.ts` (`getClientSession`, `requireClientUser(slug, perm?)` for pages, `requireClientAction()` for the few account actions, `visibleProjectIds(session)` = projects of the session's client narrowed by `project_scope`, `clientOwnsAttachment` for `/api/files/:id`). Pure roles/slug rules in `client-portal-perms.ts`; DB helpers (slug, `insertClientUser`) in `client-portal-core.ts`; cookie `bbp_client` (path `/`, SHA-256 token hash in `client_sessions`). Admin view = a `client_sessions` row with `impersonated_by` (2 h, read-only banner).
- Tables: `client_users`, `client_sessions`, `client_auth_events`; new columns on `clients`: `portal_slug` (unique), `portal_enabled`, `portal_show_subcontractors`, `portal_show_financials`. Migration `migrateClientPortal` (SCHEMA_VERSION 7) also backfills the `clients/portal` permission for the admin and project_manager roles. New permission action `portal` on module `clients`.
- Internal side: `src/features/client-portal-admin/` (actions, queries, `ClientPortalTab`, URL card with visibility switches, user forms; reuses `portal-admin` `CredentialsCard` with `basePath`/`portalLabel` props) and `src/app/(main)/clients/[id]/portal-view/route.ts` (read-only impersonation).
- Read models: `src/features/client-portal/data.ts` (every function takes the session; client-safe fields only), `reports.ts` (the four printable reports + CSV tables), `map-server.ts` (server: Live Ops Map data of the client's projects with costs, CPI inputs, subcontract values, invoices, portal tokens, ratings, internal RFIs removed and subcontractor identities anonymised unless allowed) and `map-payload.ts` (pure: payload type + `hydrateClientMap`, which fills neutral defaults client-side: budget weight 100, cost 0). `getOpsMapData({ projectIds })` restricts the computation.
- Live Ops Map client mode: `OpsMapApp` takes `clientMode` (`ClientMode` in `ops-map/types.ts`): no Cost colour mode, no Subcontractor mode when names are hidden, SPI only in the KPI strip and drawer, no contract/certified/paid, portal links or internal links (links go to `/c/<slug>/projects/<id>`). Loaded with `next/dynamic` (`ClientMapLoader`); embedded maps use `ClientPortfolioMap` (MapCanvas only).
- Read-only rule for tests: a page may contain only forms marked `data-readonly-ok` (`logout`, `password`, `account`); filters are plain inputs / links that change the query string.
